import { useEffect } from 'react'
import { t } from '../shared/i18n/index.ts'
import { getStore, useData } from './store.ts'
import { ui, useUI } from './ui.ts'
import { chooseImport, exportBoard, redo, undo } from './actions.ts'
import { Sidebar } from './components/Sidebar.tsx'
import { BoardView } from './components/BoardView.tsx'
import { UpcomingView } from './components/UpcomingView.tsx'
import { CardEditor } from './components/CardEditor.tsx'
import { ArchiveDialog, BackupsDialog, ImportDialog, PreviewDialog, SettingsDialog, ShortcutsDialog } from './components/Dialogs.tsx'
import { EmptyState, isTyping } from './components/common.tsx'
import { Icon } from './components/Icon.tsx'

export function App() {
  const language = useUI((s) => s.language)
  const showingUpcoming = useUI((s) => s.showingUpcoming)
  const dialog = useUI((s) => s.dialog)
  const toast = useUI((s) => s.toast)
  const selectedID = useData((d) => d.selectedBoardID)
  const hasBoard = useData((d) => d.boards.some((b) => b.id === d.selectedBoardID))

  // 全局快捷键
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) {
        if (e.key === 'F1') {
          e.preventDefault()
          ui.openDialog({ kind: 'shortcuts' })
        }
        return
      }
      const key = e.key.toLowerCase()
      // 撤销 / 重做：文本框中交给系统处理
      if ((key === 'z' || key === 'y') && !isTyping(e.target) && !ui.state.dialog) {
        e.preventDefault()
        if (key === 'y' || e.shiftKey) redo()
        else undo()
        return
      }
      if (e.shiftKey && key === 'n') {
        e.preventDefault()
        getStore().addBoard()
        ui.set({ showingUpcoming: false })
      } else if (e.shiftKey && key === 'i') {
        e.preventDefault()
        void chooseImport()
      } else if (e.shiftKey && key === 'e') {
        e.preventDefault()
        const id = getStore().data.selectedBoardID
        if (id && !ui.state.showingUpcoming) void exportBoard(id)
      } else if (key === ',') {
        e.preventDefault()
        ui.openDialog({ kind: 'settings' })
      } else if (key === '/') {
        e.preventDefault()
        ui.openDialog({ kind: 'shortcuts' })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app" key={language}>
      <Sidebar />
      <main className="content">
        {showingUpcoming ? (
          <UpcomingView />
        ) : hasBoard && selectedID ? (
          <BoardView key={selectedID} boardID={selectedID} />
        ) : (
          <div className="no-board">
            <div className="toolbar titlebar-drag" />
            <EmptyState icon="board" title={t('没有选中的看板')} description={t('在左侧选择或新建一个看板')} />
          </div>
        )}
      </main>

      {dialog?.kind === 'card' && <CardEditor key={dialog.cardID} boardID={dialog.boardID} cardID={dialog.cardID} />}
      {dialog?.kind === 'archive' && <ArchiveDialog boardID={dialog.boardID} />}
      {dialog?.kind === 'backups' && <BackupsDialog />}
      {dialog?.kind === 'settings' && <SettingsDialog />}
      {dialog?.kind === 'shortcuts' && <ShortcutsDialog />}
      {dialog?.kind === 'import' && <ImportDialog archive={dialog.archive} />}
      {dialog?.kind === 'preview' && <PreviewDialog fileNames={dialog.fileNames} names={dialog.names} index={dialog.index} />}

      {toast && (
        <div className="toast" key={toast.id} role="status">
          <span className="toast-text">{toast.text}</span>
          {toast.actionLabel && toast.action && (
            <button
              className="link-button"
              onClick={() => {
                toast.action?.()
                ui.set({ toast: null })
              }}
            >
              {toast.actionLabel}
            </button>
          )}
          <button className="icon-button small" onClick={() => ui.set({ toast: null })} aria-label={t('关闭')}>
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
    </div>
  )
}
