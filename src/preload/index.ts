// 把主进程的功能以受限的接口暴露给界面（window.taskboard），界面本身无法访问 Node.js。
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { TaskBoardAPI, UpdateStatus } from '../shared/api.ts'

function subscribe<T extends unknown[]>(channel: string, callback: (...args: T) => void): () => void {
  const listener = (_event: unknown, ...args: unknown[]) => callback(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: TaskBoardAPI = {
  getInitialState: () => ipcRenderer.invoke('state:initial'),
  setPrefs: (prefs) => ipcRenderer.invoke('prefs:set', prefs),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),

  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (json) => ipcRenderer.invoke('data:save', json),
  saveDataSync: (json) => {
    ipcRenderer.sendSync('data:save-sync', json)
  },

  listBackups: () => ipcRenderer.invoke('backups:list'),
  readBackup: (name) => ipcRenderer.invoke('backups:read', name),
  backupNow: (note) => ipcRenderer.invoke('backups:create', note),
  revealBackups: () => ipcRenderer.invoke('backups:reveal'),
  revealData: () => ipcRenderer.invoke('data:reveal'),

  attachmentURL: (fileName) => `tbfile://attachment/${encodeURIComponent(fileName)}`,
  pickAttachments: () => ipcRenderer.invoke('attachments:pick'),
  importAttachmentPaths: (paths) => ipcRenderer.invoke('attachments:import-paths', paths),
  importImageData: (data, extension, originalName) => ipcRenderer.invoke('attachments:import-image', data, extension, originalName),
  pathForFile: (file) => webUtils.getPathForFile(file),
  openAttachment: (fileName) => ipcRenderer.invoke('attachments:open', fileName),
  revealAttachment: (fileName) => ipcRenderer.invoke('attachments:reveal', fileName),

  exportBoard: (board, name) => ipcRenderer.invoke('archive:export-board', board, name),
  exportAll: (data, name) => ipcRenderer.invoke('archive:export-all', data, name),
  revealPath: (path) => ipcRenderer.invoke('path:reveal', path),
  chooseImportFile: () => ipcRenderer.invoke('archive:choose'),
  readImportFile: (path) => ipcRenderer.invoke('archive:read', path),
  copyImportedAttachments: (token, copies) => ipcRenderer.invoke('archive:copy-attachments', token, copies),
  discardImport: (token) => ipcRenderer.invoke('archive:discard', token),
  onOpenFile: (callback) => subscribe<[string]>('open-file', callback),

  showMenu: (items, position) => ipcRenderer.invoke('menu:show', items, position),
  confirm: (options) => ipcRenderer.invoke('dialog:confirm', options),
  alert: (message, detail) => ipcRenderer.invoke('dialog:alert', message, detail),

  setReminders: (reminders) => ipcRenderer.invoke('reminders:set', reminders),
  requestNotificationTest: () => ipcRenderer.invoke('reminders:test'),
  onOpenCard: (callback) => subscribe<[string, string]>('open-card', callback),

  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateStatus: (callback) => subscribe<[UpdateStatus]>('update-status', callback),

  setTrayStrings: (strings) => ipcRenderer.invoke('tray:strings', strings),
  onCommand: (callback) => subscribe<[string]>('command', callback),

  smokeResult: (ok, detail) => ipcRenderer.send('smoke:result', ok, detail)
}

contextBridge.exposeInMainWorld('taskboard', api)
