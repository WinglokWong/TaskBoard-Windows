// 侧边栏：即将到期、看板列表（右键：重命名 / 导出 / 删除）、新建看板，以及应用菜单（⋯）
import { useRef, useState } from 'react'
import { parseDate, rgbaToCss } from '../../shared/model.ts'
import { t } from '../../shared/i18n/index.ts'
import { getStore, useData } from '../store.ts'
import { ui, useUI } from '../ui.ts'
import { chooseImport, confirmDeleteBoard, exportAll, exportBoard } from '../actions.ts'
import { Icon } from './Icon.tsx'
import { InlineInput } from './Column.tsx'
import { showMenu, useNow } from './common.tsx'

export function Sidebar() {
  const store = getStore()
  const boards = useData((d) => d.boards)
  const selectedID = useData((d) => d.selectedBoardID)
  const showingUpcoming = useUI((s) => s.showingUpcoming)
  const update = useUI((s) => s.update)
  const [renaming, setRenaming] = useState<string | null>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const now = useNow()

  // 已过期或今天到期的未完成卡片数
  const urgent = boards.reduce((n, b) => {
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    return n + b.cards.filter((c) => !c.isDone && !c.isArchived && (parseDate(c.dueDate)?.getTime() ?? Infinity) < endOfToday.getTime()).length
  }, 0)

  async function boardMenu(boardID: string) {
    const board = store.board(boardID)
    if (!board) return
    const choice = await showMenu([
      { id: 'rename', label: t('重命名…') },
      { id: 'export', label: t('导出看板…') },
      { type: 'separator' },
      { id: 'delete', label: t('删除看板…') }
    ])
    if (choice === 'rename') setRenaming(boardID)
    else if (choice === 'export') void exportBoard(boardID)
    else if (choice === 'delete') void confirmDeleteBoard(board)
  }

  async function appMenu() {
    const choice = await showMenu(
      [
        { id: 'new', label: t('新建看板') + '\tCtrl+Shift+N' },
        { type: 'separator' },
        { id: 'import', label: t('导入…') + '\tCtrl+Shift+I' },
        { id: 'exportBoard', label: t('导出当前看板…') + '\tCtrl+Shift+E', enabled: !showingUpcoming && !!selectedID },
        { id: 'exportAll', label: t('导出全部数据…') },
        { type: 'separator' },
        { id: 'backup', label: t('立即备份') },
        { id: 'restore', label: t('从备份恢复…') },
        { id: 'folder', label: t('在资源管理器中显示数据文件夹') },
        { type: 'separator' },
        { id: 'settings', label: t('设置') + '\tCtrl+,' },
        { id: 'shortcuts', label: t('键盘快捷键') + '\tCtrl+/' },
        { id: 'updates', label: t('检查更新…') }
      ],
      moreRef.current
    )
    if (choice === 'new') newBoard()
    else if (choice === 'import') void chooseImport()
    else if (choice === 'exportBoard' && selectedID) void exportBoard(selectedID)
    else if (choice === 'exportAll') void exportAll()
    else if (choice === 'backup') {
      await store.saveNow()
      await window.taskboard.backupNow('manual')
      ui.toast(t('已创建备份'))
    } else if (choice === 'restore') ui.openDialog({ kind: 'backups' })
    else if (choice === 'folder') void window.taskboard.revealData()
    else if (choice === 'settings') ui.openDialog({ kind: 'settings' })
    else if (choice === 'shortcuts') ui.openDialog({ kind: 'shortcuts' })
    else if (choice === 'updates') {
      ui.openDialog({ kind: 'settings' })
      void window.taskboard.checkForUpdates()
    }
  }

  function newBoard() {
    const id = store.addBoard()
    ui.set({ showingUpcoming: false })
    setRenaming(id)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header titlebar-drag">
        <img className="app-icon" src="./icon.png" alt="" />
        <span className="app-name">{t('任务看板')}</span>
      </div>
      <nav className="sidebar-list">
        <button className={`sidebar-item ${showingUpcoming ? 'selected' : ''}`} onClick={() => ui.set({ showingUpcoming: true })}>
          <Icon name="calendarClock" />
          <span className="sidebar-label">{t('即将到期')}</span>
          {urgent > 0 && (
            <span className="badge" title={t('已过期和今天到期的未完成卡片数')}>
              {urgent}
            </span>
          )}
        </button>
        <div className="sidebar-section">{t('看板')}</div>
        {boards.map((board) =>
          renaming === board.id ? (
            <div key={board.id} className="sidebar-item editing">
              <span className="board-swatch" style={{ background: rgbaToCss(board.background) }} />
              <InlineInput
                initial={board.name}
                placeholder={t('看板名称')}
                onCommit={(name) => {
                  store.renameBoard(board.id, name)
                  setRenaming(null)
                }}
                onCancel={() => setRenaming(null)}
              />
            </div>
          ) : (
            <button
              key={board.id}
              className={`sidebar-item ${!showingUpcoming && board.id === selectedID ? 'selected' : ''}`}
              onClick={() => {
                ui.set({ showingUpcoming: false })
                store.selectBoard(board.id)
              }}
              onDoubleClick={() => setRenaming(board.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                void boardMenu(board.id)
              }}
            >
              <span className="board-swatch" style={{ background: rgbaToCss(board.background) }} />
              <span className="sidebar-label">{board.name}</span>
            </button>
          )
        )}
      </nav>
      {update.state === 'ready' && (
        <button className="update-banner" onClick={() => void window.taskboard.installUpdate()}>
          <Icon name="download" size={14} />
          {t('新版本 %@ 已下载，点击重新启动以完成更新', update.version ?? '')}
        </button>
      )}
      <div className="sidebar-footer">
        <button className="sidebar-item" onClick={newBoard}>
          <Icon name="plus" />
          <span className="sidebar-label">{t('新建看板')}</span>
        </button>
        <button ref={moreRef} className="icon-button" onClick={() => void appMenu()} title={t('更多')}>
          <Icon name="more" />
        </button>
      </div>
    </aside>
  )
}
