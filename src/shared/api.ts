// 主进程通过 preload 暴露给界面的接口（window.taskboard）。
// 在浏览器中开发 / 测试界面时，由 src/renderer/mockApi.ts 提供同样的接口。
import type { AppData, Attachment, Board } from './model.ts'
import type { Language, LanguageSetting } from './i18n/index.ts'

export interface Prefs {
  language: LanguageSetting
  /** 新截止日期的默认提醒（分钟）；-1 表示不提醒 */
  defaultReminderMinutes: number
  /** 新截止日期的默认时间（一天中的分钟数） */
  defaultDueMinutes: number
  maxBackups: number
  /** 关闭窗口时继续在通知区域运行（以便按时提醒） */
  closeToTray: boolean
  autoUpdate: boolean
  /** 是否已经提示过“仍在通知区域运行” */
  trayNoticeShown: boolean
}

export const DEFAULT_PREFS: Prefs = {
  language: 'system',
  defaultReminderMinutes: 0,
  defaultDueMinutes: 9 * 60,
  maxBackups: 30,
  closeToTray: true,
  autoUpdate: true,
  trayNoticeShown: false
}

export interface InitialState {
  prefs: Prefs
  language: Language
  version: string
  platform: string
  dataPath: string
  /** 系统强调色（#rrggbb） */
  accentColor?: string
  /** 启动时通过双击 .taskboard 文件打开的文件 */
  openFiles: string[]
  isPackaged: boolean
  /** 自动化冒烟测试模式（--smoke-test） */
  smokeTest: boolean
}

export interface LoadResult {
  /** null：没有数据文件，使用示例看板 */
  data: AppData | null
  /** 数据文件无法读取时保存的备份文件名 */
  unreadableBackup?: string
}

export interface BackupInfo {
  name: string
  date: string
  note?: string
}

export interface BackupSummary {
  boards: number
  cards: number
}

export type ArchiveErrorCode = 'notAnArchive' | 'unsafeContents' | 'unsupportedVersion' | 'damaged' | 'writeFailed'

export interface ImportedArchive {
  token: string
  kind: 'board' | 'library'
  boards: Board[]
  library?: AppData
  formatVersion: number
}

export type ImportResult = { ok: true; archive: ImportedArchive } | { ok: false; error: ArchiveErrorCode; version?: number }

export type ExportResult = { ok: true; fileName: string; path: string } | { ok: false; error?: ArchiveErrorCode; cancelled?: boolean }

export interface AttachmentCopy {
  from: string
  to: string
}

/** 原生菜单的描述（右键菜单、下拉菜单） */
export interface MenuItemSpec {
  id?: string
  label?: string
  type?: 'normal' | 'separator' | 'checkbox' | 'radio' | 'submenu'
  checked?: boolean
  enabled?: boolean
  submenu?: MenuItemSpec[]
}

export interface Reminder {
  key: string
  fireAt: string
  title: string
  body: string
  boardID: string
  cardID: string
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'upToDate' | 'error' | 'unavailable'
  version?: string
  percent?: number
  message?: string
}

export interface ConfirmOptions {
  message: string
  detail?: string
  confirmLabel: string
  cancelLabel: string
  destructive?: boolean
}

export interface TaskBoardAPI {
  getInitialState(): Promise<InitialState>
  setPrefs(prefs: Partial<Prefs>): Promise<Prefs>
  relaunch(): Promise<void>

  loadData(): Promise<LoadResult>
  saveData(json: string): Promise<void>
  /** 窗口关闭前同步保存，确保最后的修改不会丢失 */
  saveDataSync(json: string): void

  listBackups(): Promise<BackupInfo[]>
  readBackup(name: string): Promise<AppData | null>
  backupNow(note: string): Promise<void>
  revealBackups(): Promise<void>
  revealData(): Promise<void>

  /** 附件在界面中显示用的地址 */
  attachmentURL(fileName: string): string
  pickAttachments(): Promise<Attachment[]>
  importAttachmentPaths(paths: string[]): Promise<Attachment[]>
  importImageData(data: Uint8Array, extension: string, originalName: string): Promise<Attachment | null>
  /** 拖入的文件在磁盘上的路径 */
  pathForFile(file: File): string
  openAttachment(fileName: string): Promise<void>
  revealAttachment(fileName: string): Promise<void>

  exportBoard(board: Board, defaultName: string): Promise<ExportResult>
  exportAll(data: AppData, defaultName: string): Promise<ExportResult>
  revealPath(path: string): Promise<void>
  chooseImportFile(): Promise<ImportResult | null>
  readImportFile(path: string): Promise<ImportResult>
  /** 把导入文件中的附件复制到附件目录；返回成功复制的目标文件名 */
  copyImportedAttachments(token: string, copies: AttachmentCopy[]): Promise<string[]>
  discardImport(token: string): Promise<void>
  onOpenFile(callback: (path: string) => void): () => void

  showMenu(items: MenuItemSpec[], position?: { x: number; y: number }): Promise<string | null>
  confirm(options: ConfirmOptions): Promise<boolean>
  alert(message: string, detail?: string): Promise<void>

  setReminders(reminders: Reminder[]): Promise<void>
  requestNotificationTest(): Promise<void>
  onOpenCard(callback: (boardID: string, cardID: string) => void): () => void

  openExternal(url: string): Promise<void>

  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void

  /** 托盘菜单等主进程中显示的文字 */
  setTrayStrings(strings: { open: string; quit: string; tooltip: string }): Promise<void>
  onCommand(callback: (command: string) => void): () => void

  /** 自动化测试：报告结果后退出 */
  smokeResult(ok: boolean, detail: string): void
}

declare global {
  interface Window {
    taskboard: TaskBoardAPI
  }
}
