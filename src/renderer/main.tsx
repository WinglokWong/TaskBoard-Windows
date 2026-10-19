import { createRoot } from 'react-dom/client'
import { setLanguage, t } from '../shared/i18n/index.ts'
import { DEFAULT_PREFS } from '../shared/api.ts'
import { sampleData, setStore, Store } from './store.ts'
import { ui } from './ui.ts'
import { applyLanguage } from './language.ts'
import { importFromPath, openCard } from './actions.ts'
import { App } from './App.tsx'
import './styles.css'

async function start(): Promise<void> {
  // 在普通浏览器中（开发 / 测试界面）使用模拟的桌面接口
  if (!window.taskboard) {
    const { createMockApi } = await import('./mockApi.ts')
    window.taskboard = createMockApi()
  }
  const api = window.taskboard
  const init = await api.getInitialState()
  setLanguage(init.language)
  document.body.dataset.platform = init.platform
  if (init.accentColor) document.documentElement.style.setProperty('--accent', init.accentColor)

  const loaded = await api.loadData()
  const store = new Store(api, loaded.data ?? sampleData())
  setStore(store)
  ui.init({
    showingUpcoming: false,
    dialog: null,
    toast: null,
    update: { state: 'idle' },
    prefs: init.prefs ?? DEFAULT_PREFS,
    init,
    language: init.language
  })
  applyLanguage(init.language)

  api.onOpenFile((path) => void importFromPath(path))
  api.onOpenCard((boardID, cardID) => openCard(boardID, cardID))
  api.onUpdateStatus((status) => ui.set({ update: status }))
  api.onCommand((command) => {
    if (command === 'tray-notice') ui.toast(t('任务看板仍在通知区域运行，以便按时提醒。可以在设置中更改。'), undefined, undefined, 7000)
  })
  // 窗口关闭前同步保存，确保最后的修改不会丢失
  window.addEventListener('beforeunload', () => store.flushSync())

  createRoot(document.getElementById('root')!).render(<App />)

  if (loaded.unreadableBackup) {
    void api.alert(t('数据读取失败'), t('数据文件无法读取，已创建新的示例看板。原文件已保存为备份「%@」，可以在侧边栏的 ⋯ 菜单中选择“从备份恢复”查看。', loaded.unreadableBackup))
  }
  for (const file of init.openFiles) await importFromPath(file)

  if (init.smokeTest) {
    const { runSmokeTest } = await import('./smoke.ts')
    await runSmokeTest()
  }
}

void start()
