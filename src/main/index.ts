// 主进程：窗口、通知区域图标、文件对话框、原生菜单、数据读写和自动更新。
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, shell, systemPreferences, Tray } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AppData, Board } from '../shared/model.ts'
import { isSafeFileName } from '../shared/model.ts'
import { resolveLanguage } from '../shared/i18n/index.ts'
import type { AttachmentCopy, ConfirmOptions, ExportResult, ImportResult, InitialState, MenuItemSpec, Prefs, Reminder, UpdateStatus } from '../shared/api.ts'
import { initPaths, listBackups, loadData, makeBackup, paths, readBackup, readPrefs, saveData, writePrefs } from './storage.ts'
import { handleAttachmentProtocol, importFiles, importImageData, openAttachment, registerAttachmentScheme, revealAttachment } from './attachments.ts'
import { ArchiveError, createArchive, readArchive, type ArchiveContents } from './archive.ts'
import { setReminders, show as showNotification, startReminders } from './reminders.ts'
import { checkForUpdates, initUpdater, installUpdate, updatesAvailable } from './updater.ts'

const isWindows = process.platform === 'win32'
const isMac = process.platform === 'darwin'

// MARK: - 冒烟测试模式：使用临时数据目录，界面跑完自测后退出

const smokeTest = process.argv.includes('--smoke-test')
const smokeOut = process.argv.find((a) => a.startsWith('--smoke-out='))?.slice('--smoke-out='.length)
if (smokeTest) {
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-smoke-')))
  // 自动化测试环境（例如 GitHub Actions）通常没有可用的显卡
  app.disableHardwareAcceleration()
} else if (!app.isPackaged) {
  // 开发时使用单独的数据目录。在 Mac 上，默认目录与 macOS 版任务看板的数据目录同名，不能混用。
  app.setPath('userData', path.join(app.getPath('appData'), 'TaskBoard-Windows-dev'))
}

registerAttachmentScheme()
app.setAppUserModelId('com.winglok.taskboard')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let trayStrings = { open: 'Open TaskBoard', quit: 'Quit', tooltip: 'TaskBoard' }
const pendingOpenFiles: string[] = []
const importSessions = new Map<string, ArchiveContents>()

function taskboardFilesIn(argv: string[]): string[] {
  return argv.filter((a) => a.toLowerCase().endsWith('.taskboard') && fs.existsSync(a))
}

function resourcePath(name: string): string {
  const base = path.join(app.getAppPath(), 'resources', name)
  return app.isPackaged ? base.replace('app.asar', 'app.asar.unpacked') : base
}

function send(channel: string, ...args: unknown[]): void {
  mainWindow?.webContents.send(channel, ...args)
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// MARK: - 单实例：第二次启动（例如双击 .taskboard 文件）交给已运行的实例处理

if (!smokeTest && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  pendingOpenFiles.push(...taskboardFilesIn(process.argv.slice(1)))

  app.on('second-instance', (_event, argv) => {
    showWindow()
    for (const file of taskboardFilesIn(argv.slice(1))) send('open-file', file)
  })

  // macOS（开发时）：在 Finder 中打开 .taskboard 文件
  app.on('open-file', (event, file) => {
    event.preventDefault()
    if (mainWindow) send('open-file', file)
    else pendingOpenFiles.push(file)
  })

  app.whenReady().then(() => {
    initPaths()
    handleAttachmentProtocol()
    setupMenu()
    registerIPC()
    createWindow()
    if (isWindows && !smokeTest) createTray()
    startReminders((boardID, cardID) => {
      showWindow()
      send('open-card', boardID, cardID)
    })
    initUpdater((status: UpdateStatus) => send('update-status', status))
    if (!smokeTest && readPrefs().autoUpdate && updatesAvailable()) {
      setTimeout(() => void checkForUpdates(), 10_000)
      setInterval(() => void checkForUpdates(), 6 * 3600 * 1000)
    }
    if (smokeTest) {
      setTimeout(() => finishSmokeTest(false, 'timeout: renderer did not report a result'), 120_000)
    }
  })

  app.on('activate', () => showWindow())
  app.on('before-quit', () => {
    quitting = true
  })
  app.on('window-all-closed', () => {
    if (!isMac || smokeTest) app.quit()
  })
}

// MARK: - 窗口

function createWindow(): void {
  const dark = nativeTheme.shouldUseDarkColors
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'TaskBoard',
    icon: resourcePath('icon.png'),
    backgroundColor: isWindows ? '#00000000' : dark ? '#202020' : '#f3f3f3',
    titleBarStyle: 'hidden',
    titleBarOverlay: isWindows ? { color: '#00000000', symbolColor: dark ? '#ffffff' : '#1b1b1b', height: 44 } : undefined,
    trafficLightPosition: isMac ? { x: 16, y: 15 } : undefined,
    backgroundMaterial: isWindows ? 'mica' : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    if (!smokeTest) mainWindow?.show()
  })

  // 链接一律用系统浏览器打开，窗口本身不跳转
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault()
  })

  // 关闭窗口时默认继续在通知区域运行，以便按时提醒
  mainWindow.on('close', (event) => {
    if (!isWindows || quitting || smokeTest || !readPrefs().closeToTray) return
    event.preventDefault()
    mainWindow?.hide()
    if (!readPrefs().trayNoticeShown) {
      writePrefs({ trayNoticeShown: true })
      send('command', 'tray-notice')
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  nativeTheme.on('updated', () => {
    if (isWindows && mainWindow) {
      mainWindow.setTitleBarOverlay({ color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#1b1b1b', height: 44 })
    }
  })

  const devURL = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devURL) void mainWindow.loadURL(devURL)
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function setupMenu(): void {
  if (!isMac) {
    // Windows 版不使用菜单栏（功能都在界面中），快捷键由界面处理
    Menu.setApplicationMenu(null)
    return
  }
  // macOS 开发时：保留标准菜单，保证复制粘贴等快捷键可用
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createTray(): void {
  const icon = nativeImage.createFromPath(resourcePath('tray.png')).resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.on('click', () => showWindow())
  updateTrayMenu()
}

function updateTrayMenu(): void {
  if (!tray) return
  tray.setToolTip(trayStrings.tooltip)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: trayStrings.open, click: () => showWindow() },
      { type: 'separator' },
      {
        label: trayStrings.quit,
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
}

// MARK: - 冒烟测试

function finishSmokeTest(ok: boolean, detail: string): void {
  const line = `SMOKE ${ok ? 'PASS' : 'FAIL'}: ${detail}\n`
  process.stdout.write(line)
  if (smokeOut) {
    try {
      fs.writeFileSync(smokeOut, line)
    } catch {
      /* 忽略 */
    }
  }
  app.exit(ok ? 0 : 1)
}

// MARK: - 与界面的通信

function registerIPC(): void {
  const window = () => mainWindow ?? undefined

  ipcMain.handle('state:initial', (): InitialState => {
    const prefs = readPrefs()
    const accent = isWindows || isMac ? systemPreferences.getAccentColor?.() : undefined
    return {
      prefs,
      language: resolveLanguage(prefs.language, app.getPreferredSystemLanguages()),
      version: app.getVersion(),
      platform: process.platform,
      dataPath: paths.root,
      accentColor: accent ? `#${accent.slice(0, 6)}` : undefined,
      openFiles: pendingOpenFiles.splice(0),
      isPackaged: app.isPackaged,
      smokeTest
    }
  })
  ipcMain.handle('prefs:set', (_e, update: Partial<Prefs>) => writePrefs(update))
  ipcMain.handle('app:relaunch', () => {
    app.relaunch()
    quitting = true
    app.exit(0)
  })

  ipcMain.handle('data:load', () => loadData())
  ipcMain.handle('data:save', (_e, json: string) => saveData(json))
  ipcMain.on('data:save-sync', (event, json: string) => {
    try {
      saveData(json)
      event.returnValue = true
    } catch {
      event.returnValue = false
    }
  })

  ipcMain.handle('backups:list', () => listBackups())
  ipcMain.handle('backups:read', (_e, name: string) => readBackup(name))
  ipcMain.handle('backups:create', (_e, note: string) => {
    makeBackup(/^[\w-]{1,32}$/.test(note) ? note : undefined)
  })
  ipcMain.handle('backups:reveal', () => shell.openPath(paths.backups))
  ipcMain.handle('data:reveal', () => shell.showItemInFolder(paths.data))

  ipcMain.handle('attachments:pick', async () => {
    const result = await dialog.showOpenDialog(window()!, { properties: ['openFile', 'multiSelections'] })
    return result.canceled ? [] : importFiles(result.filePaths)
  })
  ipcMain.handle('attachments:import-paths', (_e, filePaths: string[]) => importFiles(filePaths.filter((p) => typeof p === 'string')))
  ipcMain.handle('attachments:import-image', (_e, data: Uint8Array, ext: string, name: string) => importImageData(data, ext, name))
  ipcMain.handle('attachments:open', (_e, fileName: string) => openAttachment(fileName))
  ipcMain.handle('attachments:reveal', (_e, fileName: string) => revealAttachment(fileName))

  ipcMain.handle('archive:export-board', (_e, board: Board, name: string) =>
    exportArchive('board', board, board.cards.flatMap((c) => c.attachments.map((a) => a.fileName)), name)
  )
  ipcMain.handle('archive:export-all', (_e, data: AppData, name: string) =>
    exportArchive('library', data, data.boards.flatMap((b) => b.cards.flatMap((c) => c.attachments.map((a) => a.fileName))), name)
  )
  ipcMain.handle('archive:choose', async (): Promise<ImportResult | null> => {
    const result = await dialog.showOpenDialog(window()!, {
      properties: ['openFile'],
      filters: [{ name: 'TaskBoard', extensions: ['taskboard'] }]
    })
    return result.canceled || result.filePaths.length === 0 ? null : readImport(result.filePaths[0])
  })
  ipcMain.handle('archive:read', (_e, file: string) => readImport(file))
  ipcMain.handle('archive:copy-attachments', (_e, token: string, copies: AttachmentCopy[]) => {
    const session = importSessions.get(token)
    if (!session) return []
    const copied: string[] = []
    for (const { from, to } of copies) {
      if (!isSafeFileName(from) || !isSafeFileName(to)) continue
      const target = path.join(paths.attachments, to)
      if (fs.existsSync(target)) {
        copied.push(to)
        continue
      }
      const data = session.attachments.get(from)
      if (!data) continue
      try {
        fs.writeFileSync(target, data)
        copied.push(to)
      } catch {
        /* 跳过 */
      }
    }
    return copied
  })
  ipcMain.handle('archive:discard', (_e, token: string) => {
    importSessions.delete(token)
  })
  ipcMain.handle('path:reveal', (_e, file: string) => shell.showItemInFolder(file))

  ipcMain.handle('menu:show', (_e, items: MenuItemSpec[], position?: { x: number; y: number }) => {
    return new Promise<string | null>((resolve) => {
      let chosen: string | null = null
      const build = (specs: MenuItemSpec[]): MenuItemConstructorOptions[] =>
        specs.map((s) => ({
          label: s.label,
          type: s.type ?? (s.submenu ? 'submenu' : 'normal'),
          checked: s.checked,
          enabled: s.enabled ?? true,
          submenu: s.submenu ? build(s.submenu) : undefined,
          click: s.id ? () => (chosen = s.id!) : undefined
        }))
      const menu = Menu.buildFromTemplate(build(items))
      menu.popup({
        window: window(),
        x: position ? Math.round(position.x) : undefined,
        y: position ? Math.round(position.y) : undefined,
        callback: () => setTimeout(() => resolve(chosen), 0)
      })
    })
  })
  ipcMain.handle('dialog:confirm', async (_e, o: ConfirmOptions) => {
    const result = await dialog.showMessageBox(window()!, {
      type: o.destructive ? 'warning' : 'question',
      buttons: [o.confirmLabel, o.cancelLabel],
      defaultId: o.destructive ? 1 : 0,
      cancelId: 1,
      message: o.message,
      detail: o.detail,
      noLink: true
    })
    return result.response === 0
  })
  ipcMain.handle('dialog:alert', async (_e, message: string, detail?: string) => {
    await dialog.showMessageBox(window()!, { type: 'info', buttons: ['OK'], message, detail, noLink: true })
  })

  ipcMain.handle('reminders:set', (_e, list: Reminder[]) => setReminders(Array.isArray(list) ? list : []))
  ipcMain.handle('reminders:test', () => showNotification('TaskBoard', '✓'))
  ipcMain.handle('shell:open-external', (_e, url: string) => {
    if (/^(https?:|mailto:)/i.test(url)) return shell.openExternal(url)
  })

  ipcMain.handle('updates:check', () => checkForUpdates())
  ipcMain.handle('updates:install', () => {
    quitting = true
    installUpdate()
  })

  ipcMain.handle('tray:strings', (_e, strings: typeof trayStrings) => {
    trayStrings = strings
    updateTrayMenu()
  })

  ipcMain.on('smoke:result', (_e, ok: boolean, detail: string) => {
    if (smokeTest) finishSmokeTest(ok, detail)
  })
}

async function exportArchive(kind: 'board' | 'library', payload: Board | AppData, fileNames: string[], defaultName: string): Promise<ExportResult> {
  const safeName = defaultName.replace(/[\\/:*?"<>|]/g, '-').trim() || 'TaskBoard'
  const target = smokeTest
    ? path.join(app.getPath('userData'), `${safeName}.taskboard`)
    : (
        await dialog.showSaveDialog(mainWindow!, {
          defaultPath: path.join(app.getPath('documents'), `${safeName}.taskboard`),
          filters: [{ name: 'TaskBoard', extensions: ['taskboard'] }]
        })
      ).filePath
  if (!target) return { ok: false, cancelled: true }
  try {
    const attachments: [string, Uint8Array][] = []
    for (const name of new Set(fileNames)) {
      if (!isSafeFileName(name)) continue
      const file = path.join(paths.attachments, name)
      if (fs.existsSync(file)) attachments.push([name, fs.readFileSync(file)])
    }
    const bytes = createArchive(kind, payload, attachments, app.getVersion())
    const temp = `${target}.${process.pid}.tmp`
    fs.writeFileSync(temp, bytes)
    fs.renameSync(temp, target)
    return { ok: true, fileName: path.basename(target), path: target }
  } catch {
    return { ok: false, error: 'writeFailed' }
  }
}

function readImport(file: string): ImportResult {
  try {
    const contents = readArchive(new Uint8Array(fs.readFileSync(file)))
    const token = crypto.randomUUID()
    importSessions.set(token, contents)
    return {
      ok: true,
      archive: {
        token,
        kind: contents.manifest.kind,
        boards: contents.boards,
        library: contents.library,
        formatVersion: contents.manifest.formatVersion
      }
    }
  } catch (error) {
    if (error instanceof ArchiveError) return { ok: false, error: error.code, version: error.version }
    return { ok: false, error: 'notAnArchive' }
  }
}
