// 数据与撤销 / 重做。与 macOS 版的 Store 一一对应：
// 每个操作先记录撤销点（整份数据的快照，Immer 保证未修改的部分共享，开销很小），再修改数据；
// 修改后 0.4 秒自动保存。卡片编辑窗口中的修改在关闭窗口时合并为一个撤销步骤。
import { produce, type Draft } from 'immer'
import { useSyncExternalStore } from 'react'
import {
  applyAutoArchive,
  CURRENT_SCHEMA_VERSION,
  encodeJSON,
  isoDate,
  makeBoard,
  makeCard,
  newID,
  paletteColor,
  PALETTE,
  parseDate,
  reminderDate,
  type AppData,
  type Board,
  type Card,
  type CardLabel,
  type RGBA
} from '../shared/model.ts'
import { localeTag, t } from '../shared/i18n/index.ts'
import type { Reminder, TaskBoardAPI } from '../shared/api.ts'

type Listener = () => void

interface UndoEntry {
  name: string
  snapshot: AppData
}

export function sampleData(): AppData {
  const board = makeBoard(t('我的看板'), [t('待办'), t('进行中'), t('已完成')])
  const [todo, doing, done] = board.columns.map((c) => c.id)
  board.cards = [
    makeCard({
      columnID: todo,
      title: t('欢迎使用任务看板 👋'),
      details: t('• 点击卡片可编辑标题、内容、颜色和附件\n• 拖拽卡片可在列表之间移动\n• 点击左侧圆圈标记完成\n• 右键卡片可快速设置颜色、归档或删除\n• 误操作可以用 ⌘Z 撤销').replace('⌘Z', 'Ctrl+Z')
    }),
    makeCard({ columnID: todo, title: t('双击列表名称可以重命名'), color: paletteColor('yellow') }),
    makeCard({ columnID: doing, title: t('试试给卡片添加一张图片附件'), color: paletteColor('lightBlue') }),
    makeCard({ columnID: done, title: t('点击工具栏的调色板修改背景颜色'), isDone: true })
  ]
  return { schemaVersion: CURRENT_SCHEMA_VERSION, boards: [board], selectedBoardID: board.id }
}

export class Store {
  data: AppData
  private api: TaskBoardAPI
  private listeners = new Set<Listener>()
  private undoStack: UndoEntry[] = []
  private redoStack: UndoEntry[] = []
  private lastCheckpoint?: { name: string; time: number }
  private saveTimer?: ReturnType<typeof setTimeout>
  private dirty = false

  constructor(api: TaskBoardAPI, data: AppData) {
    this.api = api
    this.data = { ...data, schemaVersion: CURRENT_SCHEMA_VERSION }
    if (!this.data.boards.some((b) => b.id === this.data.selectedBoardID)) {
      this.data = { ...this.data, selectedBoardID: this.data.boards[0]?.id }
    }
    this.data = applyAutoArchive(this.data)
    this.syncReminders()
    setInterval(() => this.set(applyAutoArchive(this.data)), 30 * 60 * 1000)
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }

  private set(next: AppData): void {
    if (next === this.data) return
    this.data = next
    this.emit()
    this.scheduleSave()
  }

  private mutate(fn: (draft: Draft<AppData>) => void): void {
    this.set(produce(this.data, fn))
  }

  private updateBoard(boardID: string, fn: (board: Draft<Board>) => void): void {
    this.mutate((d) => {
      const b = d.boards.find((x) => x.id === boardID)
      if (b) fn(b)
    })
  }

  private updateCard(boardID: string, cardID: string, fn: (card: Draft<Card>) => void): void {
    this.updateBoard(boardID, (b) => {
      const c = b.cards.find((x) => x.id === cardID)
      if (c) fn(c)
    })
  }

  board(id: string | undefined): Board | undefined {
    return this.data.boards.find((b) => b.id === id)
  }

  card(boardID: string, cardID: string): Card | undefined {
    return this.board(boardID)?.cards.find((c) => c.id === cardID)
  }

  // MARK: - 保存

  private scheduleSave(): void {
    this.dirty = true
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.saveNow(), 400)
  }

  async saveNow(): Promise<void> {
    clearTimeout(this.saveTimer)
    if (!this.dirty) return
    this.dirty = false
    try {
      await this.api.saveData(encodeJSON(this.data))
    } catch (error) {
      console.error('save failed', error)
      this.dirty = true
    }
    this.syncReminders()
  }

  /** 窗口关闭前同步保存 */
  flushSync(): void {
    clearTimeout(this.saveTimer)
    if (!this.dirty) return
    this.dirty = false
    this.api.saveDataSync(encodeJSON(this.data))
  }

  /** 把需要提醒的卡片交给主进程（只安排最近的 60 个，与 macOS 版一致） */
  syncReminders(): void {
    const now = Date.now()
    const list: Reminder[] = []
    for (const board of this.data.boards) {
      for (const card of board.cards) {
        if (card.isDone || card.isArchived) continue
        const fire = reminderDate(card)
        const due = parseDate(card.dueDate)
        if (!fire || !due || fire.getTime() <= now - 60_000) continue
        list.push({
          key: card.id,
          fireAt: fire.toISOString(),
          title: card.title || t('卡片到期'),
          body: t('截止时间：%@ · %@', formatLongDate(due), board.name),
          boardID: board.id,
          cardID: card.id
        })
      }
    }
    list.sort((a, b) => a.fireAt.localeCompare(b.fireAt))
    void this.api.setReminders(list.slice(0, 60))
  }

  // MARK: - 撤销

  private checkpoint(name: string, coalesce = false): void {
    const now = Date.now()
    if (coalesce && this.lastCheckpoint?.name === name && now - this.lastCheckpoint.time < 1500) {
      this.lastCheckpoint = { name, time: now }
      return
    }
    this.undoStack.push({ name, snapshot: this.data })
    if (this.undoStack.length > 200) this.undoStack.shift()
    this.redoStack = []
    this.lastCheckpoint = { name, time: now }
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** 撤销；返回撤销的操作名称 */
  undo(): string | undefined {
    const entry = this.undoStack.pop()
    if (!entry) return undefined
    this.redoStack.push({ name: entry.name, snapshot: this.data })
    this.lastCheckpoint = undefined
    this.set(entry.snapshot)
    return entry.name
  }

  redo(): string | undefined {
    const entry = this.redoStack.pop()
    if (!entry) return undefined
    this.undoStack.push({ name: entry.name, snapshot: this.data })
    this.lastCheckpoint = undefined
    this.set(entry.snapshot)
    return entry.name
  }

  /** 卡片编辑窗口关闭时调用：把整次编辑合并为一个撤销步骤 */
  registerCardEdit(original: Card, boardID: string): void {
    const current = this.card(boardID, original.id)
    if (!current || JSON.stringify(current) === JSON.stringify(original)) return
    const before = produce(this.data, (d) => {
      const b = d.boards.find((x) => x.id === boardID)
      const i = b?.cards.findIndex((c) => c.id === original.id) ?? -1
      if (b && i >= 0) b.cards[i] = original as Draft<Card>
    })
    this.undoStack.push({ name: t('编辑卡片'), snapshot: before })
    this.redoStack = []
    this.lastCheckpoint = undefined
  }

  // MARK: - 看板

  selectBoard(id: string): void {
    if (this.data.selectedBoardID === id) return
    this.set({ ...this.data, selectedBoardID: id })
  }

  addBoard(): string {
    this.checkpoint(t('新建看板'))
    const board = makeBoard(t('新看板'), [t('待办'), t('进行中'), t('已完成')])
    const dark = PALETTE.filter((p) => 0.2126 * p.value.r + 0.7152 * p.value.g + 0.0722 * p.value.b < 0.6)
    board.background = dark[Math.floor(Math.random() * dark.length)].value
    this.set({ ...this.data, boards: [...this.data.boards, board], selectedBoardID: board.id })
    return board.id
  }

  renameBoard(id: string, name: string): void {
    const trimmed = name.trim()
    if (!trimmed || this.board(id)?.name === trimmed) return
    this.checkpoint(t('重命名看板'))
    this.updateBoard(id, (b) => {
      b.name = trimmed
    })
  }

  setBackground(id: string, color: RGBA): void {
    this.checkpoint(t('修改背景颜色'), true)
    this.updateBoard(id, (b) => {
      b.background = color
    })
  }

  deleteBoard(id: string): void {
    this.checkpoint(t('删除看板'))
    const boards = this.data.boards.filter((b) => b.id !== id)
    const selected = this.data.selectedBoardID === id ? boards[0]?.id : this.data.selectedBoardID
    this.set({ ...this.data, boards, selectedBoardID: selected })
  }

  // MARK: - 列表

  addColumn(boardID: string, name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    this.checkpoint(t('添加列表'))
    this.updateBoard(boardID, (b) => {
      b.columns.push({ id: newID(), name: trimmed })
    })
  }

  renameColumn(boardID: string, columnID: string, name: string): void {
    const trimmed = name.trim()
    const board = this.board(boardID)
    if (!trimmed || board?.columns.find((c) => c.id === columnID)?.name === trimmed) return
    this.checkpoint(t('重命名列表'))
    this.updateBoard(boardID, (b) => {
      const c = b.columns.find((x) => x.id === columnID)
      if (c) c.name = trimmed
    })
  }

  setColumnColor(boardID: string, columnID: string, color: RGBA | undefined): void {
    this.checkpoint(t('修改列表颜色'), true)
    this.updateBoard(boardID, (b) => {
      const c = b.columns.find((x) => x.id === columnID)
      if (!c) return
      if (color) c.color = color
      else delete c.color
    })
  }

  moveColumnBy(boardID: string, columnID: string, offset: number): void {
    const board = this.board(boardID)
    if (!board) return
    const i = board.columns.findIndex((c) => c.id === columnID)
    const j = i + offset
    if (i < 0 || j < 0 || j >= board.columns.length) return
    const order = board.columns.map((c) => c.id)
    ;[order[i], order[j]] = [order[j], order[i]]
    this.reorderColumns(boardID, order)
  }

  /** 拖拽排序完成：按给定顺序排列列表（一个撤销步骤） */
  reorderColumns(boardID: string, order: string[]): void {
    const board = this.board(boardID)
    if (!board) return
    const current = board.columns.map((c) => c.id)
    if (current.join() === order.join() || new Set(order).size !== current.length || !order.every((id) => current.includes(id))) return
    this.checkpoint(t('移动列表'))
    this.updateBoard(boardID, (b) => {
      const byID = new Map(b.columns.map((c) => [c.id, c]))
      b.columns = order.map((id) => byID.get(id)!)
    })
  }

  /** 删除列表；其中未归档的卡片会被移入归档 */
  deleteColumn(boardID: string, columnID: string): void {
    this.checkpoint(t('删除列表'))
    const now = isoDate()
    this.updateBoard(boardID, (b) => {
      for (const c of b.cards) {
        if (c.columnID === columnID && !c.isArchived) {
          c.isArchived = true
          c.archivedAt = now
        }
      }
      b.columns = b.columns.filter((c) => c.id !== columnID)
    })
  }

  archiveCards(boardID: string, columnID: string, onlyDone: boolean): void {
    this.checkpoint(onlyDone ? t('归档已完成的卡片') : t('归档全部卡片'))
    const now = isoDate()
    this.updateBoard(boardID, (b) => {
      for (const c of b.cards) {
        if (c.columnID === columnID && !c.isArchived && (!onlyDone || c.isDone)) {
          c.isArchived = true
          c.archivedAt = now
        }
      }
    })
  }

  // MARK: - 卡片

  addCard(boardID: string, columnID: string, title: string): void {
    const trimmed = title.trim()
    if (!trimmed) return
    this.checkpoint(t('添加卡片'))
    this.updateBoard(boardID, (b) => {
      b.cards.push(makeCard({ columnID, title: trimmed }) as Draft<Card>)
    })
  }

  /** 卡片编辑窗口中的实时保存（不单独记录撤销，见 registerCardEdit） */
  saveCard(boardID: string, card: Card): void {
    this.updateBoard(boardID, (b) => {
      const i = b.cards.findIndex((c) => c.id === card.id)
      if (i < 0) return
      const old = b.cards[i]
      // 编辑窗口里的草稿不维护完成时间，这里统一处理
      const next: Card = { ...card }
      const completedAt = card.isDone ? (old.isDone ? (old.completedAt ?? isoDate()) : isoDate()) : undefined
      if (completedAt) next.completedAt = completedAt
      else delete next.completedAt
      b.cards[i] = next as Draft<Card>
    })
  }

  toggleDone(boardID: string, cardID: string): void {
    const done = this.card(boardID, cardID)?.isDone ?? false
    this.checkpoint(done ? t('标记为未完成') : t('标记为已完成'))
    this.updateCard(boardID, cardID, (c) => {
      c.isDone = !c.isDone
      if (c.isDone) c.completedAt = isoDate()
      else delete c.completedAt
    })
  }

  setCardColor(boardID: string, cardID: string, color: RGBA | undefined): void {
    this.checkpoint(t('修改卡片颜色'))
    this.updateCard(boardID, cardID, (c) => {
      if (color) c.color = color
      else delete c.color
    })
  }

  archiveCard(boardID: string, cardID: string): void {
    this.checkpoint(t('归档卡片'))
    this.updateCard(boardID, cardID, (c) => {
      c.isArchived = true
      c.archivedAt = isoDate()
    })
  }

  /** 从归档恢复；原列表若已删除，则放入第一个列表 */
  restoreCard(boardID: string, cardID: string): void {
    this.checkpoint(t('恢复卡片'))
    this.updateBoard(boardID, (b) => {
      const i = b.cards.findIndex((c) => c.id === cardID)
      if (i < 0) return
      const [card] = b.cards.splice(i, 1)
      if (!b.columns.some((c) => c.id === card.columnID)) {
        if (b.columns.length === 0) b.columns.push({ id: newID(), name: t('待办') })
        card.columnID = b.columns[0].id
      }
      card.isArchived = false
      delete card.archivedAt
      // 重新计时，避免刚恢复就被自动归档
      if (card.isDone) card.completedAt = isoDate()
      b.cards.push(card)
    })
  }

  deleteCard(boardID: string, cardID: string): void {
    this.checkpoint(t('删除卡片'))
    this.updateBoard(boardID, (b) => {
      b.cards = b.cards.filter((c) => c.id !== cardID)
    })
  }

  deleteArchivedCards(boardID: string): void {
    this.checkpoint(t('清空归档'))
    this.updateBoard(boardID, (b) => {
      b.cards = b.cards.filter((c) => !c.isArchived)
    })
  }

  /** 将卡片移动到指定列表，放在 beforeCardID 之前；为 undefined 则放到末尾 */
  moveCard(boardID: string, cardID: string, columnID: string, beforeCardID?: string): void {
    if (cardID === beforeCardID) return
    const board = this.board(boardID)
    const card = board?.cards.find((c) => c.id === cardID)
    if (!board || !card) return
    // 位置没有变化时不记录撤销
    const sameColumn = board.cards.filter((c) => c.columnID === columnID && !c.isArchived)
    const index = sameColumn.findIndex((c) => c.id === cardID)
    if (card.columnID === columnID && index >= 0) {
      const next = sameColumn[index + 1]?.id
      if (next === beforeCardID) return
    }
    this.checkpoint(t('移动卡片'))
    this.updateBoard(boardID, (b) => {
      const from = b.cards.findIndex((c) => c.id === cardID)
      const [moved] = b.cards.splice(from, 1)
      moved.columnID = columnID
      const target = beforeCardID ? b.cards.findIndex((c) => c.id === beforeCardID) : -1
      if (target >= 0) b.cards.splice(target, 0, moved)
      else b.cards.push(moved)
    })
  }

  // MARK: - 标签

  addLabel(boardID: string, color: RGBA): string {
    this.checkpoint(t('新建标签'))
    const label: CardLabel = { id: newID(), name: '', color }
    this.updateBoard(boardID, (b) => {
      b.labels.push(label)
    })
    return label.id
  }

  renameLabel(boardID: string, labelID: string, name: string): void {
    this.checkpoint(t('重命名标签'), true)
    this.updateBoard(boardID, (b) => {
      const l = b.labels.find((x) => x.id === labelID)
      if (l) l.name = name
    })
  }

  setLabelColor(boardID: string, labelID: string, color: RGBA): void {
    this.checkpoint(t('修改标签颜色'), true)
    this.updateBoard(boardID, (b) => {
      const l = b.labels.find((x) => x.id === labelID)
      if (l) l.color = color
    })
  }

  /** 删除标签，并从所有卡片上移除 */
  deleteLabel(boardID: string, labelID: string): void {
    this.checkpoint(t('删除标签'))
    this.updateBoard(boardID, (b) => {
      b.labels = b.labels.filter((l) => l.id !== labelID)
      for (const c of b.cards) c.labelIDs = c.labelIDs.filter((l) => l !== labelID)
    })
  }

  toggleLabel(boardID: string, cardID: string, labelID: string): void {
    this.checkpoint(t('修改卡片标签'))
    this.updateCard(boardID, cardID, (c) => {
      c.labelIDs = c.labelIDs.includes(labelID) ? c.labelIDs.filter((l) => l !== labelID) : [...c.labelIDs, labelID]
    })
  }

  // MARK: - 自动归档

  setAutoArchive(boardID: string, days: number | undefined): void {
    if (this.board(boardID)?.autoArchiveDays === days) return
    this.checkpoint(t('修改自动归档设置'))
    this.updateBoard(boardID, (b) => {
      if (days === undefined) delete b.autoArchiveDays
      else b.autoArchiveDays = days
    })
    this.set(applyAutoArchive(this.data))
  }

  // MARK: - 导入与恢复

  /** 用另一份数据整体替换（从备份恢复、导入全部数据时“替换”） */
  replaceAll(data: AppData, undoName: string): void {
    this.checkpoint(undoName)
    const next = { ...data, schemaVersion: CURRENT_SCHEMA_VERSION }
    if (!next.boards.some((b) => b.id === next.selectedBoardID)) next.selectedBoardID = next.boards[0]?.id
    this.set(next)
  }

  appendBoards(boards: Board[]): void {
    if (boards.length === 0) return
    this.checkpoint(t('导入看板'))
    this.set({ ...this.data, boards: [...this.data.boards, ...boards], selectedBoardID: boards[0].id })
  }
}

export function formatLongDate(date: Date): string {
  return date.toLocaleString(localeTag(), { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

let instance: Store | undefined

export function setStore(store: Store): void {
  instance = store
}

export function getStore(): Store {
  if (!instance) throw new Error('store not initialized')
  return instance
}

/** 订阅数据中的一部分；selector 应返回数据中已有的对象（Immer 保证未修改的部分引用不变） */
export function useData<T>(selector: (data: AppData) => T): T {
  const store = getStore()
  return useSyncExternalStore(store.subscribe, () => selector(store.data))
}
