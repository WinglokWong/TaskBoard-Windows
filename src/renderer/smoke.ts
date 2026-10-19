// 冒烟测试（--smoke-test）：在真实的 Windows 环境中（GitHub Actions）启动打包后的应用，
// 走一遍主要流程——界面渲染、增删改、撤销、保存并从磁盘重新读取、导出再导入、备份——然后报告结果并退出。
import { decodeAppData, type AppData } from '../shared/model.ts'
import { getStore } from './store.ts'
import { ui } from './ui.ts'
import { importAsNewBoards } from './actions.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runSmokeTest(): Promise<void> {
  const api = window.taskboard
  const steps: string[] = []
  try {
    await wait(500)
    const store = getStore()

    // 1. 界面已渲染示例看板
    assert(document.querySelectorAll('.column').length === 3, 'sample board should render 3 lists')
    assert(document.querySelectorAll('.card').length === 4, 'sample board should render 4 cards')
    steps.push('render')

    // 2. 增删改与撤销
    const board = store.data.boards[0]
    store.addColumn(board.id, 'Smoke')
    const column = store.board(board.id)!.columns.at(-1)!
    store.addCard(board.id, column.id, 'Smoke card')
    const card = store.board(board.id)!.cards.at(-1)!
    store.toggleDone(board.id, card.id)
    store.moveCard(board.id, card.id, board.columns[0].id)
    assert(store.card(board.id, card.id)?.columnID === board.columns[0].id, 'card should move')
    store.undo()
    assert(store.card(board.id, card.id)?.columnID === column.id, 'undo should move the card back')
    store.redo()
    steps.push('edit+undo')

    // 3. 保存后从磁盘重新读取，日期格式与 macOS 版兼容（不带毫秒）
    await store.saveNow()
    const loaded = await api.loadData()
    assert(loaded.data, 'saved data should load')
    const reloaded: AppData = decodeAppData(JSON.parse(JSON.stringify(loaded.data)))
    const saved = reloaded.boards[0].cards.find((c) => c.id === card.id)
    assert(saved?.isDone && saved.completedAt && /T\d{2}:\d{2}:\d{2}Z$/.test(saved.completedAt), 'dates should be saved without milliseconds')
    steps.push('save+load')

    // 4. 导出看板，再作为新看板导入
    const exported = await api.exportBoard(store.board(board.id)!, 'smoke-export')
    assert(exported.ok, 'export should succeed')
    const imported = await api.readImportFile(exported.path)
    assert(imported.ok && imported.archive.boards.length === 1, 'exported file should import')
    const before = store.data.boards.length
    await importAsNewBoards(imported.archive)
    assert(store.data.boards.length === before + 1, 'import should add a board')
    const copy = store.data.boards.at(-1)!
    assert(copy.id !== board.id && copy.cards.length === store.board(board.id)!.cards.length, 'imported board should be a full copy with new IDs')
    steps.push('export+import')

    // 5. 备份
    await api.backupNow('manual')
    const backups = await api.listBackups()
    assert(backups.some((b) => b.note === 'manual'), 'manual backup should be listed')
    steps.push('backup')

    // 6. 对话框可以打开
    ui.openDialog({ kind: 'settings' })
    await wait(200)
    assert(document.querySelector('.modal'), 'settings dialog should open')
    ui.closeDialog()
    steps.push('dialogs')

    api.smokeResult(true, steps.join(', '))
  } catch (error) {
    api.smokeResult(false, `${steps.join(', ')} → ${error instanceof Error ? error.message : String(error)}`)
  }
}
