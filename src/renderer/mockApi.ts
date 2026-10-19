// 在普通浏览器中运行界面时使用的模拟桌面接口（npm run web）。
// 数据保存在 localStorage；菜单显示为页面内的简单菜单；附件保存在内存中。
// 仅用于开发和测试界面交互；在 Windows 版中不会加载（window.taskboard 由 preload 提供）。
import type { MenuItemSpec, Prefs, TaskBoardAPI } from '../shared/api.ts'
import { DEFAULT_PREFS } from '../shared/api.ts'
import { decodeAppData, newID } from '../shared/model.ts'
import { detectLanguage, resolveLanguage } from '../shared/i18n/index.ts'

const DATA_KEY = 'taskboard-web-data'
const PREFS_KEY = 'taskboard-web-prefs'
const files = new Map<string, string>()

function readPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = () => resolve([...(input.files ?? [])])
    input.click()
  })
}

function fileToAttachment(file: File) {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : ''
  const fileName = newID() + (ext ? `.${ext}` : '')
  files.set(fileName, URL.createObjectURL(file))
  return { id: newID(), fileName, originalName: file.name }
}

/** 页面内的简单菜单（替代原生菜单） */
function domMenu(items: MenuItemSpec[], position?: { x: number; y: number }): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'mock-menu-overlay'
    const menu = document.createElement('div')
    menu.className = 'mock-menu'
    const x = position?.x ?? lastPointer.x
    const y = position?.y ?? lastPointer.y
    menu.style.left = `${Math.min(x, window.innerWidth - 240)}px`
    menu.style.top = `${Math.min(y, window.innerHeight - 40)}px`
    const finish = (id: string | null) => {
      overlay.remove()
      resolve(id)
    }
    const add = (list: MenuItemSpec[], depth: number) => {
      for (const item of list) {
        if (item.type === 'separator') {
          menu.appendChild(Object.assign(document.createElement('hr'), {}))
          continue
        }
        const row = document.createElement('button')
        row.className = 'mock-menu-item'
        row.style.paddingLeft = `${12 + depth * 14}px`
        row.textContent = `${item.checked ? '✓ ' : ''}${item.label ?? ''}${item.submenu ? ' ›' : ''}`
        row.disabled = item.enabled === false || (!item.id && !item.submenu)
        if (item.id) row.onclick = () => finish(item.id!)
        menu.appendChild(row)
        if (item.submenu) add(item.submenu, depth + 1)
      }
    }
    add(items, 0)
    overlay.onclick = (e) => e.target === overlay && finish(null)
    overlay.appendChild(menu)
    document.body.appendChild(overlay)
    const top = Math.max(8, Math.min(parseFloat(menu.style.top), window.innerHeight - menu.offsetHeight - 8))
    menu.style.top = `${top}px`
  })
}

const lastPointer = { x: 100, y: 100 }
document.addEventListener('pointerdown', (e) => {
  lastPointer.x = e.clientX
  lastPointer.y = e.clientY
}, true)
document.addEventListener('contextmenu', (e) => {
  lastPointer.x = e.clientX
  lastPointer.y = e.clientY
}, true)

export function createMockApi(): TaskBoardAPI {
  const noop = () => () => {}
  return {
    getInitialState: async () => {
      const prefs = readPrefs()
      return {
        prefs,
        language: resolveLanguage(prefs.language, navigator.languages ?? [detectLanguage([navigator.language])]),
        version: 'web',
        platform: 'web',
        dataPath: 'localStorage',
        openFiles: [],
        isPackaged: false,
        smokeTest: false
      }
    },
    setPrefs: async (update) => {
      const next = { ...readPrefs(), ...update }
      localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      return next
    },
    relaunch: async () => location.reload(),
    loadData: async () => {
      const raw = localStorage.getItem(DATA_KEY)
      if (!raw) return { data: null }
      try {
        return { data: decodeAppData(JSON.parse(raw)) }
      } catch {
        return { data: null, unreadableBackup: 'localStorage' }
      }
    },
    saveData: async (json) => localStorage.setItem(DATA_KEY, json),
    saveDataSync: (json) => localStorage.setItem(DATA_KEY, json),
    listBackups: async () => [],
    readBackup: async () => null,
    backupNow: async () => {},
    revealBackups: async () => {},
    revealData: async () => {},
    attachmentURL: (fileName) => files.get(fileName) ?? '',
    pickAttachments: async () => (await pickFiles()).map(fileToAttachment),
    importAttachmentPaths: async () => [],
    importImageData: async (data, extension, originalName) => {
      const file = new File([data as BlobPart], originalName, { type: `image/${extension}` })
      return fileToAttachment(file)
    },
    pathForFile: () => '',
    openAttachment: async (fileName) => {
      const url = files.get(fileName)
      if (url) window.open(url)
    },
    revealAttachment: async () => {},
    exportBoard: async () => ({ ok: false, cancelled: true }),
    exportAll: async () => ({ ok: false, cancelled: true }),
    revealPath: async () => {},
    chooseImportFile: async () => null,
    readImportFile: async () => ({ ok: false, error: 'notAnArchive' }),
    copyImportedAttachments: async () => [],
    discardImport: async () => {},
    onOpenFile: noop,
    showMenu: domMenu,
    confirm: async (o) => window.confirm(`${o.message}\n\n${o.detail ?? ''}`),
    alert: async (message, detail) => window.alert(`${message}\n\n${detail ?? ''}`),
    setReminders: async () => {},
    requestNotificationTest: async () => {},
    onOpenCard: noop,
    openExternal: async (url) => void window.open(url, '_blank', 'noopener'),
    checkForUpdates: async () => {},
    installUpdate: async () => {},
    onUpdateStatus: noop,
    setTrayStrings: async () => {},
    onCommand: noop,
    smokeResult: (ok, detail) => console.log('smoke', ok, detail)
  }
}
