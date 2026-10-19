// 多个界面共用的操作流程：确认删除、撤销提示、导入导出、从备份恢复、右键菜单等。
import { t } from '../shared/i18n/index.ts'
import {
  coverImage,
  isImageFile,
  isSafeFileName,
  newID,
  PALETTE,
  placeOrphanedCards,
  reidentifyBoard,
  type AppData,
  type Board,
  type BoardColumn,
  type Card
} from '../shared/model.ts'
import type { ArchiveErrorCode, AttachmentCopy, ImportedArchive, ImportResult, MenuItemSpec } from '../shared/api.ts'
import { getStore } from './store.ts'
import { ui } from './ui.ts'
import { labelDisplayName } from './components/CardFace.tsx'

const api = () => window.taskboard

// MARK: - 撤销 / 重做

export function undo(): void {
  const name = getStore().undo()
  if (name) ui.toast(t('已撤销：%@', name), t('重做'), redo)
}

export function redo(): void {
  const name = getStore().redo()
  if (name) ui.toast(t('已重做：%@', name), t('撤销'), undo)
}

// MARK: - 打开卡片

export function openCard(boardID: string, cardID: string): void {
  ui.set({ showingUpcoming: false })
  getStore().selectBoard(boardID)
  ui.openDialog({ kind: 'card', boardID, cardID })
}

/** 用内置预览查看卡片的图片附件；没有图片时用默认应用打开第一个附件 */
export function previewAttachments(card: Card, startFileName?: string): void {
  const images = card.attachments.filter((a) => isImageFile(a.fileName))
  if (images.length === 0) {
    const first = card.attachments.find((a) => a.fileName === startFileName) ?? card.attachments[0]
    if (first) void api().openAttachment(first.fileName)
    return
  }
  const index = Math.max(0, images.findIndex((a) => a.fileName === (startFileName ?? coverImage(card)?.fileName)))
  ui.openDialog({ kind: 'preview', fileNames: images.map((a) => a.fileName), names: images.map((a) => a.originalName), index })
}

// MARK: - 删除确认

export async function confirmDeleteCard(boardID: string, card: Card): Promise<void> {
  const ok = await api().confirm({
    message: t('确定删除卡片「%@」吗？', card.title),
    detail: t('可以用 ⌘Z 撤销。如果只是暂时不需要，也可以选择归档。').replace('⌘Z', 'Ctrl+Z'),
    confirmLabel: t('删除'),
    cancelLabel: t('取消'),
    destructive: true
  })
  if (ok) getStore().deleteCard(boardID, card.id)
}

export async function confirmDeleteColumn(boardID: string, column: BoardColumn): Promise<void> {
  const ok = await api().confirm({
    message: t('确定删除列表「%@」吗？', column.name),
    detail: t('列表中的卡片会被移入归档，可以稍后恢复。'),
    confirmLabel: t('删除列表'),
    cancelLabel: t('取消'),
    destructive: true
  })
  if (ok) getStore().deleteColumn(boardID, column.id)
}

export async function confirmDeleteBoard(board: Board): Promise<void> {
  const ok = await api().confirm({
    message: t('确定删除看板「%@」吗？', board.name),
    detail: t('看板中的所有卡片和附件（包括归档）都会被永久删除。') + '\n' + t('可以用 Ctrl+Z 撤销。'),
    confirmLabel: t('删除'),
    cancelLabel: t('取消'),
    destructive: true
  })
  if (ok) getStore().deleteBoard(board.id)
}

// MARK: - 右键菜单

export async function cardContextMenu(board: Board, card: Card): Promise<void> {
  const store = getStore()
  const items: MenuItemSpec[] = [
    { id: 'open', label: t('打开') },
    { id: 'done', label: card.isDone ? t('标记为未完成') : t('标记为已完成') },
    {
      label: t('颜色'),
      submenu: [
        { id: 'color:none', label: t('默认') },
        { type: 'separator' },
        ...PALETTE.map((p) => ({ id: `color:${p.key}`, label: t(p.name) }))
      ]
    }
  ]
  if (board.labels.length > 0) {
    items.push({
      label: t('标签'),
      submenu: board.labels.map((l) => ({ id: `label:${l.id}`, label: labelDisplayName(l), type: 'checkbox' as const, checked: card.labelIDs.includes(l.id) }))
    })
  }
  const others = board.columns.filter((c) => c.id !== card.columnID)
  if (others.length > 0) items.push({ label: t('移动到'), submenu: others.map((c) => ({ id: `move:${c.id}`, label: c.name })) })
  if (card.attachments.length > 0) items.push({ id: 'preview', label: t('快速查看') })
  items.push({ type: 'separator' }, { id: 'archive', label: t('归档') }, { id: 'delete', label: t('删除…') })

  const choice = await api().showMenu(items)
  if (!choice) return
  if (choice === 'open') openCard(board.id, card.id)
  else if (choice === 'done') store.toggleDone(board.id, card.id)
  else if (choice === 'preview') previewAttachments(card)
  else if (choice === 'archive') store.archiveCard(board.id, card.id)
  else if (choice === 'delete') await confirmDeleteCard(board.id, card)
  else if (choice === 'color:none') store.setCardColor(board.id, card.id, undefined)
  else if (choice.startsWith('color:')) store.setCardColor(board.id, card.id, PALETTE.find((p) => p.key === choice.slice(6))?.value)
  else if (choice.startsWith('label:')) store.toggleLabel(board.id, card.id, choice.slice(6))
  else if (choice.startsWith('move:')) store.moveCard(board.id, card.id, choice.slice(5))
}

// MARK: - 导出

const archiveErrorText: Record<ArchiveErrorCode, string> = {
  notAnArchive: '这不是任务看板的导出文件。',
  unsafeContents: '文件中包含不安全的路径，已拒绝导入。',
  unsupportedVersion: '这个文件来自更新版本的任务看板（格式版本 %lld），请先更新应用。',
  damaged: '文件已损坏或内容不完整。',
  writeFailed: '无法写入导出文件。'
}

function exportedToast(result: { ok: true; fileName: string; path: string }): void {
  ui.toast(t('已保存到「%@」。', result.fileName), t('在资源管理器中显示'), () => void api().revealPath(result.path), 6000)
}

export async function exportBoard(boardID: string): Promise<void> {
  const board = getStore().board(boardID)
  if (!board) return
  const result = await api().exportBoard(board, board.name)
  if (result.ok) exportedToast(result)
  else if (!result.cancelled) await api().alert(t('导出失败'), t(archiveErrorText[result.error ?? 'writeFailed']))
}

export async function exportAll(): Promise<void> {
  const date = new Date()
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const result = await api().exportAll(getStore().data, t('任务看板全部数据 %@', stamp))
  if (result.ok) exportedToast(result)
  else if (!result.cancelled) await api().alert(t('导出失败'), t(archiveErrorText[result.error ?? 'writeFailed']))
}

// MARK: - 导入

export async function chooseImport(): Promise<void> {
  const result = await api().chooseImportFile()
  if (result) await handleImportResult(result)
}

export async function importFromPath(path: string): Promise<void> {
  await handleImportResult(await api().readImportFile(path))
}

async function handleImportResult(result: ImportResult): Promise<void> {
  if (result.ok) {
    ui.openDialog({ kind: 'import', archive: result.archive })
  } else {
    await api().alert(t('无法导入'), t(archiveErrorText[result.error], result.version))
  }
}

export function cancelImport(archive: ImportedArchive): void {
  void api().discardImport(archive.token)
  ui.closeDialog()
}

interface Summary {
  boards: number
  cards: number
  attachments: number
  missing: number
}

function summaryText(s: Summary): string {
  let text = t('已导入 %lld 个看板、%lld 张卡片、%lld 个附件。', s.boards, s.cards, s.attachments)
  if (s.missing > 0) text += '\n' + t('有 %lld 个附件在文件中缺失，已跳过。', s.missing)
  return text
}

async function backupBeforeImport(): Promise<void> {
  await getStore().saveNow()
  await api().backupNow('before-import')
}

/** 将导入的看板作为新看板加入（全部换新 ID，不影响现有数据） */
export async function importAsNewBoards(archive: ImportedArchive): Promise<void> {
  ui.closeDialog()
  const store = getStore()
  const copies: AttachmentCopy[] = []
  const renamed = archive.boards.map((board) =>
    reidentifyBoard(board, (attachment) => {
      if (!isSafeFileName(attachment.fileName)) return undefined
      const ext = attachment.fileName.includes('.') ? attachment.fileName.split('.').pop() : ''
      const to = newID() + (ext ? `.${ext}` : '')
      copies.push({ from: attachment.fileName, to })
      return { ...attachment, id: newID(), fileName: to }
    })
  )
  const copied = new Set(await api().copyImportedAttachments(archive.token, copies))
  void api().discardImport(archive.token)

  const summary: Summary = { boards: 0, cards: 0, attachments: 0, missing: 0 }
  const names = new Set(store.data.boards.map((b) => b.name))
  const boards = renamed.map((board) => {
    let b: Board = {
      ...board,
      cards: board.cards.map((card) => {
        const kept = card.attachments.filter((a) => copied.has(a.fileName))
        summary.attachments += kept.length
        summary.missing += card.attachments.length - kept.length
        return kept.length === card.attachments.length ? card : { ...card, attachments: kept }
      })
    }
    b = placeOrphanedCards(b, t('待办'))
    if (names.has(b.name)) b = { ...b, name: t('%@（导入）', b.name) }
    names.add(b.name)
    summary.boards += 1
    summary.cards += b.cards.length
    return b
  })
  if (boards.length === 0) return
  await backupBeforeImport()
  ui.set({ showingUpcoming: false })
  store.appendBoards(boards)
  ui.toast(summaryText(summary), undefined, undefined, 6000)
}

/** 用导入的全部数据替换当前数据（先自动备份，可撤销） */
export async function replaceAllData(archive: ImportedArchive): Promise<void> {
  ui.closeDialog()
  const library = archive.library
  if (!library) return
  const names = [...new Set(library.boards.flatMap((b) => b.cards.flatMap((c) => c.attachments.map((a) => a.fileName))))].filter(isSafeFileName)
  const copied = new Set(await api().copyImportedAttachments(archive.token, names.map((n) => ({ from: n, to: n }))))
  void api().discardImport(archive.token)

  const summary: Summary = { boards: library.boards.length, cards: 0, attachments: 0, missing: 0 }
  const boards = library.boards.map((board) => {
    const b: Board = {
      ...board,
      cards: board.cards.map((card) => {
        const kept = card.attachments.filter((a) => isSafeFileName(a.fileName) && copied.has(a.fileName))
        summary.attachments += kept.length
        summary.missing += card.attachments.length - kept.length
        return kept.length === card.attachments.length ? card : { ...card, attachments: kept }
      })
    }
    summary.cards += b.cards.length
    return placeOrphanedCards(b, t('待办'))
  })
  await backupBeforeImport()
  ui.set({ showingUpcoming: false })
  getStore().replaceAll({ ...library, boards }, t('替换全部数据'))
  ui.toast(summaryText(summary), undefined, undefined, 6000)
}

// MARK: - 备份

export async function restoreBackup(name: string): Promise<boolean> {
  const data: AppData | null = await api().readBackup(name)
  if (!data) return false
  await getStore().saveNow()
  await api().backupNow('before-restore')
  getStore().replaceAll(data, t('从备份恢复'))
  ui.set({ showingUpcoming: false })
  return true
}
