// 数据文件、备份、附件清理和偏好设置。行为与 macOS 版一致：
// - 数据保存在 %APPDATA%\TaskBoard\Data\data.json，写入时先写临时文件再替换（不会写出半个文件）
// - 每天第一次保存（或启动）时自动备份，保留最近 N 份
// - 数据文件无法读取时保留一份副本，并使用新的示例看板
// - 删除卡片 / 附件时不立即删除文件（撤销和从备份恢复都需要）；启动时清理不再被引用的附件
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { decodeAppData, attachmentFileNames, type AppData } from '../shared/model.ts'
import { DEFAULT_PREFS, type BackupInfo, type LoadResult, type Prefs } from '../shared/api.ts'

export const paths = {
  root: '',
  data: '',
  attachments: '',
  backups: '',
  prefs: ''
}

export function initPaths(): void {
  paths.root = path.join(app.getPath('userData'), 'Data')
  paths.data = path.join(paths.root, 'data.json')
  paths.attachments = path.join(paths.root, 'Attachments')
  paths.backups = path.join(paths.root, 'Backups')
  paths.prefs = path.join(app.getPath('userData'), 'prefs.json')
  for (const dir of [paths.root, paths.attachments, paths.backups]) fs.mkdirSync(dir, { recursive: true })
}

// MARK: - 偏好设置

let prefsCache: Prefs | undefined

export function readPrefs(): Prefs {
  if (prefsCache) return prefsCache
  try {
    prefsCache = { ...DEFAULT_PREFS, ...JSON.parse(fs.readFileSync(paths.prefs, 'utf8')) }
  } catch {
    prefsCache = { ...DEFAULT_PREFS }
  }
  return prefsCache!
}

export function writePrefs(update: Partial<Prefs>): Prefs {
  const next = { ...readPrefs(), ...update }
  prefsCache = next
  writeFileAtomic(paths.prefs, JSON.stringify(next, null, 2))
  return next
}

// MARK: - 读写

function writeFileAtomic(file: string, contents: string | Uint8Array): void {
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, contents)
  fs.renameSync(temp, file)
}

function stamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

const launchTime = Date.now()

export function loadData(): LoadResult {
  if (!fs.existsSync(paths.data)) return { data: null }
  try {
    const data = decodeAppData(JSON.parse(fs.readFileSync(paths.data, 'utf8')))
    backupIfNeeded()
    setTimeout(() => cleanUpOrphanedAttachments(data), 2000)
    return { data }
  } catch {
    // 数据无法解析时保留一份副本，避免被新数据覆盖
    const name = `data-${stamp()}-unreadable.json`
    try {
      fs.copyFileSync(paths.data, path.join(paths.backups, name))
    } catch {
      /* 尽力而为 */
    }
    return { data: null, unreadableBackup: name }
  }
}

export function saveData(json: string): void {
  // 只写入有效的数据，避免把损坏的内容写进数据文件
  decodeAppData(JSON.parse(json))
  writeFileAtomic(paths.data, json)
  backupIfNeeded()
}

// MARK: - 备份

/** 每天第一次保存（或启动）时自动备份一次 */
function backupIfNeeded(): void {
  const today = `data-${stamp().slice(0, 8)}`
  const names = safeReaddir(paths.backups)
  if (!names.some((n) => n.startsWith(today))) makeBackup()
}

export function makeBackup(note?: string): string | undefined {
  if (!fs.existsSync(paths.data)) return undefined
  const name = `data-${stamp()}${note ? `-${note}` : ''}.json`
  try {
    fs.copyFileSync(paths.data, path.join(paths.backups, name))
  } catch {
    return undefined
  }
  pruneBackups()
  return name
}

function pruneBackups(): void {
  const max = readPrefs().maxBackups
  for (const old of listBackups().slice(max)) {
    try {
      fs.unlinkSync(path.join(paths.backups, old.name))
    } catch {
      /* 忽略 */
    }
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/** 所有备份，最新的在前 */
export function listBackups(): BackupInfo[] {
  return safeReaddir(paths.backups)
    .filter((n) => n.startsWith('data-') && n.endsWith('.json'))
    .flatMap((name): BackupInfo[] => {
      const base = name.slice(5, -5)
      const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(.+))?$/.exec(base)
      if (!m) return []
      const date = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
      return [{ name, date: date.toISOString(), note: m[7] }]
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1))
}

export function readBackup(name: string): AppData | null {
  if (!/^data-[\w-]+\.json$/.test(name)) return null
  try {
    return decodeAppData(JSON.parse(fs.readFileSync(path.join(paths.backups, name), 'utf8')))
  } catch {
    return null
  }
}

// MARK: - 附件清理

/** 删除不再被当前数据或任何备份引用的附件文件（跳过本次启动后新加入的文件） */
function cleanUpOrphanedAttachments(current: AppData): void {
  const referenced = attachmentFileNames(current)
  for (const backup of listBackups()) {
    const old = readBackup(backup.name)
    if (old) for (const n of attachmentFileNames(old)) referenced.add(n)
  }
  for (const file of safeReaddir(paths.attachments)) {
    if (referenced.has(file) || file.startsWith('.')) continue
    const full = path.join(paths.attachments, file)
    try {
      if (fs.statSync(full).birthtimeMs < launchTime) fs.unlinkSync(full)
    } catch {
      /* 忽略 */
    }
  }
}
