// 切换界面语言：立即生效（整个界面按新语言重新渲染），无需重新启动
import { setLanguage, t, type Language } from '../shared/i18n/index.ts'
import { ui } from './ui.ts'

export function applyLanguage(language: Language): void {
  setLanguage(language)
  document.documentElement.lang = language
  void window.taskboard.setTrayStrings({ open: t('打开任务看板'), quit: t('退出'), tooltip: t('任务看板') })
  ui.set({ language })
}

/** 偏好设置中的语言改变后，由主进程按系统语言解析出实际使用的语言 */
export async function refreshLanguage(): Promise<void> {
  const init = await window.taskboard.getInitialState()
  applyLanguage(init.language)
}
