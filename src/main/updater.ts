// 自动更新：从 GitHub Releases（WinglokWong/TaskBoard-Windows）检查、下载新版本，
// 下载完成后提示重启安装。只在安装版（Windows 打包后）中启用。
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '../shared/api.ts'

const { autoUpdater } = electronUpdater

let send: (status: UpdateStatus) => void = () => {}
let wired = false

export function updatesAvailable(): boolean {
  return app.isPackaged && process.platform === 'win32'
}

export function initUpdater(sendStatus: (status: UpdateStatus) => void): void {
  send = sendStatus
  if (!updatesAvailable() || wired) return
  wired = true
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => send({ state: 'upToDate' }))
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => send({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (error) => send({ state: 'error', message: error?.message ?? String(error) }))
}

export async function checkForUpdates(): Promise<void> {
  if (!updatesAvailable()) {
    send({ state: 'unavailable' })
    return
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    send({ state: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

export function installUpdate(): void {
  if (updatesAvailable()) autoUpdater.quitAndInstall()
}
