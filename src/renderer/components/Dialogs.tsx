// 对话框：归档、备份、设置、键盘快捷键、导入确认、图片预览
import { useEffect, useMemo, useState } from 'react'
import { cardMatches, parseDate, rgbaToCss } from '../../shared/model.ts'
import { t, type LanguageSetting } from '../../shared/i18n/index.ts'
import type { BackupInfo, BackupSummary, ImportedArchive, Prefs } from '../../shared/api.ts'
import { getStore, useData } from '../store.ts'
import { formatDateTime, ui, useUI } from '../ui.ts'
import { cancelImport, chooseImport, exportAll, importAsNewBoards, openCard, replaceAllData, restoreBackup } from '../actions.ts'
import { REMINDER_OPTIONS } from './CardEditor.tsx'
import { Icon } from './Icon.tsx'
import { EmptyState, Modal } from './common.tsx'
import { refreshLanguage } from '../language.ts'

// MARK: - 归档

export function ArchiveDialog({ boardID }: { boardID: string }) {
  const board = useData((d) => d.boards.find((b) => b.id === boardID))
  const [query, setQuery] = useState('')
  if (!board) return null
  const store = getStore()
  const q = query.trim()
  const archived = board.cards
    .filter((c) => c.isArchived && (!q || cardMatches(c, q)))
    .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''))
  const hasArchived = board.cards.some((c) => c.isArchived)

  async function remove(cardID: string, title: string) {
    const ok = await window.taskboard.confirm({
      message: t('确定永久删除「%@」吗？', title),
      confirmLabel: t('删除'),
      cancelLabel: t('取消'),
      destructive: true
    })
    if (ok) store.deleteCard(boardID, cardID)
  }

  async function empty() {
    const ok = await window.taskboard.confirm({
      message: t('确定清空所有归档卡片吗？'),
      detail: t('所有归档卡片及其附件将被永久删除。'),
      confirmLabel: t('全部删除'),
      cancelLabel: t('取消'),
      destructive: true
    })
    if (ok) store.deleteArchivedCards(boardID)
  }

  return (
    <Modal
      title={t('已归档的卡片')}
      icon="archive"
      onClose={() => ui.closeDialog()}
      width={620}
      footer={
        <>
          <button className="button danger" disabled={!hasArchived} onClick={() => void empty()}>
            {t('清空归档…')}
          </button>
          <span className="spacer" />
          <button className="button primary" onClick={() => ui.closeDialog()}>
            {t('关闭')}
          </button>
        </>
      }
    >
      <div className="search-field wide">
        <Icon name="search" size={14} />
        <input value={query} placeholder={t('搜索归档')} onChange={(e) => setQuery(e.target.value)} autoFocus />
      </div>
      {archived.length === 0 ? (
        <EmptyState icon="archive" title={q ? t('没有匹配的卡片') : t('没有归档的卡片')} description={t('右键卡片或在卡片详情中选择“归档”')} />
      ) : (
        <div className="list">
          {archived.map((card) => {
            const column = board.columns.find((c) => c.id === card.columnID)?.name ?? t('已删除的列表')
            const date = card.archivedAt ? formatDateTime(parseDate(card.archivedAt)!) : '-'
            return (
              <div key={card.id} className="list-row" onDoubleClick={() => openCard(boardID, card.id)}>
                <span className="color-strip" style={{ background: card.color ? rgbaToCss(card.color) : undefined }} />
                <div className="list-main">
                  <div className="list-title">
                    {card.isDone && <Icon name="checkCircle" size={14} className="green" />}
                    {card.title}
                  </div>
                  <div className="muted small">{t('来自「%@」· 归档于 %@', column, date)}</div>
                </div>
                <button className="button small" onClick={() => store.restoreCard(boardID, card.id)}>
                  <Icon name="undo" size={13} />
                  {t('恢复')}
                </button>
                <button className="icon-button" title={t('永久删除')} onClick={() => void remove(card.id, card.title)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}

// MARK: - 备份

function backupLabel(note?: string): string | undefined {
  switch (note) {
    case undefined:
      return undefined
    case 'manual':
      return t('手动')
    case 'before-restore':
      return t('恢复前')
    case 'before-import':
      return t('导入前')
    case 'unreadable':
      return t('无法读取的原文件')
    default:
      return note
  }
}

export function BackupsDialog() {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null)
  const [summaries, setSummaries] = useState<Record<string, BackupSummary | null>>({})
  const maxBackups = useUI((s) => s.prefs.maxBackups)

  async function reload() {
    const list = await window.taskboard.listBackups()
    setBackups(list)
    const result: Record<string, BackupSummary | null> = {}
    for (const b of list) {
      const data = await window.taskboard.readBackup(b.name)
      result[b.name] = data ? { boards: data.boards.length, cards: data.boards.reduce((n, x) => n + x.cards.length, 0) } : null
    }
    setSummaries(result)
  }

  useEffect(() => {
    void reload()
  }, [])

  async function restore(backup: BackupInfo) {
    const ok = await window.taskboard.confirm({
      message: t('从这个备份恢复吗？'),
      detail: t('当前数据会先自动备份，恢复后也可以用 ⌘Z 撤销。').replace('⌘Z', 'Ctrl+Z'),
      confirmLabel: t('恢复'),
      cancelLabel: t('取消')
    })
    if (!ok) return
    if (await restoreBackup(backup.name)) ui.closeDialog()
    else await window.taskboard.alert(t('恢复失败'), t('这个备份文件无法读取。'))
  }

  return (
    <Modal
      title={t('备份')}
      icon="history"
      onClose={() => ui.closeDialog()}
      width={580}
      footer={
        <>
          <button
            className="button"
            onClick={async () => {
              await getStore().saveNow()
              await window.taskboard.backupNow('manual')
              void reload()
            }}
          >
            <Icon name="plus" size={14} />
            {t('立即备份')}
          </button>
          <button className="button" onClick={() => void window.taskboard.revealBackups()}>
            {t('在资源管理器中显示')}
          </button>
          <span className="spacer" />
          <button className="button primary" onClick={() => ui.closeDialog()}>
            {t('关闭')}
          </button>
        </>
      }
    >
      <div className="muted small">{t('每天自动备份一次，保留最近 %lld 份', maxBackups)}</div>
      {backups && backups.length === 0 ? (
        <EmptyState icon="history" title={t('还没有备份')} description={t('应用每天会自动备份一次，也可以点击“立即备份”')} />
      ) : (
        <div className="list">
          {(backups ?? []).map((b) => {
            const summary = summaries[b.name]
            const label = backupLabel(b.note)
            return (
              <div key={b.name} className="list-row">
                <Icon name={b.note === 'manual' ? 'download' : b.note === 'unreadable' ? 'close' : 'clock'} size={16} className="muted" />
                <div className="list-main">
                  <div className="list-title">
                    {formatDateTime(new Date(b.date))}
                    {label && <span className="chip">{label}</span>}
                  </div>
                  <div className="muted small">
                    {summary === undefined ? '' : summary === null ? t('无法读取') : t('%lld 个看板 · %lld 张卡片', summary.boards, summary.cards)}
                  </div>
                </div>
                <button className="button small" onClick={() => void restore(b)}>
                  {t('恢复…')}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}

// MARK: - 设置

export function SettingsDialog() {
  const prefs = useUI((s) => s.prefs)
  const init = useUI((s) => s.init)
  const update = useUI((s) => s.update)
  const [tab, setTab] = useState<'general' | 'data' | 'updates'>('general')

  async function setPrefs(change: Partial<Prefs>) {
    const next = await window.taskboard.setPrefs(change)
    ui.set({ prefs: next })
  }

  const dueTime = `${String(Math.floor(prefs.defaultDueMinutes / 60)).padStart(2, '0')}:${String(prefs.defaultDueMinutes % 60).padStart(2, '0')}`
  const languages: [LanguageSetting, string][] = [
    ['system', t('跟随系统')],
    ['en', 'English'],
    ['zh-Hans', '简体中文'],
    ['zh-Hant', '繁體中文']
  ]

  const updateText = (() => {
    switch (update.state) {
      case 'checking':
        return t('正在检查更新…')
      case 'available':
        return t('发现新版本 %@，正在下载…', update.version ?? '')
      case 'downloading':
        return t('正在下载更新… %lld%', update.percent ?? 0)
      case 'ready':
        return t('新版本 %@ 已下载，点击重新启动以完成更新', update.version ?? '')
      case 'upToDate':
        return t('已是最新版本')
      case 'error':
        return t('检查更新失败：%@', update.message ?? '')
      case 'unavailable':
        return t('从源码运行时不提供自动更新。')
      default:
        return ''
    }
  })()

  return (
    <Modal title={t('设置')} icon="gear" onClose={() => ui.closeDialog()} width={600}>
      <div className="tabs">
        {(
          [
            ['general', t('通用'), 'gear'],
            ['data', t('数据'), 'folder'],
            ['updates', t('更新'), 'refresh']
          ] as const
        ).map(([key, label, icon]) => (
          <button key={key} className={`tab ${tab === key ? 'selected' : ''}`} onClick={() => setTab(key)}>
            <Icon name={icon} size={15} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="settings-group">
          <div className="settings-row">
            <div>
              <div>{t('界面语言')}</div>
            </div>
            <select
              className="select"
              value={prefs.language}
              onChange={async (e) => {
                await setPrefs({ language: e.target.value as LanguageSetting })
                await refreshLanguage()
              }}
            >
              {languages.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="settings-subtitle">{t('新截止日期的默认值')}</div>
          <div className="settings-row">
            <div>{t('默认时间')}</div>
            <input
              type="time"
              className="text-field narrow"
              value={dueTime}
              onChange={(e) => {
                const [h, m] = e.target.value.split(':').map(Number)
                if (!Number.isNaN(h) && !Number.isNaN(m)) void setPrefs({ defaultDueMinutes: h * 60 + m })
              }}
            />
          </div>
          <div className="settings-row">
            <div>{t('默认提醒')}</div>
            <select className="select" value={prefs.defaultReminderMinutes} onChange={(e) => void setPrefs({ defaultReminderMinutes: Number(e.target.value) })}>
              {REMINDER_OPTIONS.map(([minutes, title]) => (
                <option key={title} value={minutes ?? -1}>
                  {t(title)}
                </option>
              ))}
            </select>
          </div>
          {init.platform === 'win32' && (
            <>
              <div className="settings-subtitle">{t('通知区域')}</div>
              <label className="settings-row checkbox-row">
                <div>
                  <div>{t('关闭窗口后继续在通知区域运行')}</div>
                  <div className="muted small">{t('应用运行时才能按时发送截止日期提醒。')}</div>
                </div>
                <input type="checkbox" checked={prefs.closeToTray} onChange={(e) => void setPrefs({ closeToTray: e.target.checked })} />
              </label>
            </>
          )}
        </div>
      )}

      {tab === 'data' && (
        <div className="settings-group">
          <div className="settings-row">
            <div>
              <div>{t('数据位置')}</div>
              <div className="muted small mono">{init.dataPath}</div>
            </div>
            <button className="button" onClick={() => void window.taskboard.revealData()}>
              {t('在资源管理器中显示')}
            </button>
          </div>
          <div className="settings-subtitle">{t('备份')}</div>
          <div className="settings-row">
            <div>{t('保留备份')}</div>
            <select className="select" value={prefs.maxBackups} onChange={(e) => void setPrefs({ maxBackups: Number(e.target.value) })}>
              {[10, 30, 60, 100].map((n) => (
                <option key={n} value={n}>
                  {t('最近 %lld 份', n)}
                </option>
              ))}
            </select>
          </div>
          <div className="settings-buttons">
            <button
              className="button"
              onClick={async () => {
                await getStore().saveNow()
                await window.taskboard.backupNow('manual')
                ui.toast(t('已创建备份'))
              }}
            >
              {t('立即备份')}
            </button>
            <button className="button" onClick={() => ui.openDialog({ kind: 'backups' })}>
              {t('从备份恢复…')}
            </button>
          </div>
          <div className="settings-subtitle">{t('导入与导出')}</div>
          <div className="settings-buttons">
            <button className="button" onClick={() => void exportAll()}>
              <Icon name="upload" size={14} />
              {t('导出全部数据…')}
            </button>
            <button className="button" onClick={() => void chooseImport()}>
              <Icon name="download" size={14} />
              {t('导入…')}
            </button>
          </div>
          <div className="muted small">
            {t('导出的 .taskboard 文件包含看板和附件，可以在另一台 Mac 上导入。单个看板可以在看板的设置菜单中导出。').replace('Mac', t('电脑'))}
          </div>
        </div>
      )}

      {tab === 'updates' && (
        <div className="settings-group">
          <div className="settings-row">
            <div>{t('当前版本')}</div>
            <div className="mono">{init.version}</div>
          </div>
          <label className="settings-row checkbox-row">
            <div>{t('自动检查更新')}</div>
            <input type="checkbox" checked={prefs.autoUpdate} disabled={!init.isPackaged} onChange={(e) => void setPrefs({ autoUpdate: e.target.checked })} />
          </label>
          <div className="settings-row">
            <div className="muted">{updateText}</div>
            {update.state === 'ready' ? (
              <button className="button primary" onClick={() => void window.taskboard.installUpdate()}>
                {t('立即重新启动')}
              </button>
            ) : (
              <button className="button" disabled={update.state === 'checking' || update.state === 'downloading'} onClick={() => void window.taskboard.checkForUpdates()}>
                {t('立即检查更新')}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

// MARK: - 键盘快捷键

export function ShortcutsDialog() {
  const rows: [string, string][] = [
    ['↑ ↓ ← →', t('在卡片之间移动选择')],
    [t('鼠标悬停'), t('选中卡片')],
    ['Enter', t('打开选中的卡片')],
    ['Space', t('预览卡片附件')],
    ['D', t('标记完成 / 未完成')],
    ['Delete', t('归档选中的卡片')],
    ['N', t('在当前列表添加卡片')],
    ['Esc', t('取消选择')],
    ['Ctrl+F', t('搜索卡片')],
    ['Ctrl+Z / Ctrl+Y', t('撤销 / 重做')],
    ['Ctrl+Shift+N', t('新建看板')],
    ['Ctrl+Shift+I', t('导入…')],
    ['Ctrl+Shift+E', t('导出当前看板…')],
    ['Ctrl+,', t('设置')]
  ]
  return (
    <Modal title={t('键盘快捷键')} icon="keyboard" onClose={() => ui.closeDialog()} width={460} footer={<><span className="spacer" /><button className="button primary" onClick={() => ui.closeDialog()}>{t('好')}</button></>}>
      <div className="shortcuts">
        {rows.map(([key, action]) => (
          <div key={key} className="shortcut-row">
            <kbd>{key}</kbd>
            <span>{action}</span>
          </div>
        ))}
      </div>
      <div className="muted small">{t('在看板上（没有正在输入文字时）可用。')}</div>
    </Modal>
  )
}

// MARK: - 导入确认

export function ImportDialog({ archive }: { archive: ImportedArchive }) {
  const cards = archive.boards.reduce((n, b) => n + b.cards.length, 0)
  const isLibrary = archive.kind === 'library'
  return (
    <Modal
      title={isLibrary ? t('导入全部数据') : t('导入看板「%@」？', archive.boards[0]?.name ?? '')}
      icon="download"
      onClose={() => cancelImport(archive)}
      width={500}
      footer={
        <>
          <button className="button" onClick={() => cancelImport(archive)}>
            {t('取消')}
          </button>
          <span className="spacer" />
          {isLibrary ? (
            <>
              <button className="button danger" onClick={() => void replaceAllData(archive)}>
                {t('替换全部数据')}
              </button>
              <button className="button primary" onClick={() => void importAsNewBoards(archive)}>
                {t('作为新看板添加')}
              </button>
            </>
          ) : (
            <button className="button primary" onClick={() => void importAsNewBoards(archive)}>
              {t('导入')}
            </button>
          )}
        </>
      }
    >
      <p>
        {isLibrary
          ? t('包含 %lld 个看板、%lld 张卡片。“替换全部数据”会用文件内容取代当前所有看板，替换前会自动备份，也可以用 ⌘Z 撤销。', archive.boards.length, cards).replace('⌘Z', 'Ctrl+Z')
          : t('将作为新看板加入，现有看板不受影响。包含 %lld 张卡片。', cards)}
      </p>
    </Modal>
  )
}

// MARK: - 图片预览（相当于 macOS 版的 Quick Look）

export function PreviewDialog({ fileNames, names, index: start }: { fileNames: string[]; names: string[]; index: number }) {
  const [index, setIndex] = useState(start)
  const count = fileNames.length
  const go = useMemo(() => (step: number) => setIndex((i) => (i + step + count) % count), [count])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === ' ') {
        e.preventDefault()
        ui.closeDialog()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [go])
  return (
    <div className="preview-backdrop" onClick={() => ui.closeDialog()}>
      <div className="preview-toolbar" onClick={(e) => e.stopPropagation()}>
        <span className="preview-name">{names[index]}</span>
        {count > 1 && (
          <span className="muted">
            {index + 1} / {count}
          </span>
        )}
        <span className="spacer" />
        <button className="icon-button light" title={t('用默认应用打开')} onClick={() => void window.taskboard.openAttachment(fileNames[index])}>
          <Icon name="external" />
        </button>
        <button className="icon-button light" title={t('关闭')} onClick={() => ui.closeDialog()}>
          <Icon name="close" />
        </button>
      </div>
      {count > 1 && (
        <button
          className="preview-nav left"
          onClick={(e) => {
            e.stopPropagation()
            go(-1)
          }}
        >
          <Icon name="chevronLeft" size={28} />
        </button>
      )}
      <img className="preview-image" src={window.taskboard.attachmentURL(fileNames[index])} alt={names[index]} onClick={(e) => e.stopPropagation()} />
      {count > 1 && (
        <button
          className="preview-nav right"
          onClick={(e) => {
            e.stopPropagation()
            go(1)
          }}
        >
          <Icon name="chevronRight" size={28} />
        </button>
      )}
    </div>
  )
}
