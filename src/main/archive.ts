// .taskboard 导入 / 导出文件（与 macOS 版格式相同）。
//
// 文件是一个 zip，内容为：
//   manifest.json   格式信息（kind = board 单个看板 / library 全部数据）
//   data.json       Board 或 AppData
//   attachments/    被引用的附件文件
//
// 导入的文件来自外部，一律视为不可信：检查所有条目的路径，只读取已知的条目，
// 附件名必须是单纯的文件名；数据按 macOS 版相同的规则严格解码。
import { unzipSync, zipSync, type Zippable } from 'fflate'
import { decodeAppData, decodeBoard, encodeJSON, isoDate, isSafeFileName, DecodeError, type AppData, type Board } from '../shared/model.ts'
import type { ArchiveErrorCode } from '../shared/api.ts'

export const FORMAT_NAME = 'taskboard'
export const CURRENT_FORMAT_VERSION = 1

export interface ArchiveManifest {
  format: string
  formatVersion: number
  kind: 'board' | 'library'
  appVersion: string
  exportedAt: string
}

export class ArchiveError extends Error {
  code: ArchiveErrorCode
  version?: number

  constructor(code: ArchiveErrorCode, version?: number) {
    super(code)
    this.code = code
    this.version = version
  }
}

export interface ArchiveContents {
  manifest: ArchiveManifest
  boards: Board[]
  library?: AppData
  /** 文件中的附件（文件名 → 内容） */
  attachments: Map<string, Uint8Array>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** 生成 .taskboard 文件内容 */
export function createArchive(
  kind: 'board' | 'library',
  payload: Board | AppData,
  attachments: Iterable<[string, Uint8Array]>,
  appVersion: string
): Uint8Array {
  const manifest: ArchiveManifest = {
    appVersion,
    exportedAt: isoDate(),
    format: FORMAT_NAME,
    formatVersion: CURRENT_FORMAT_VERSION,
    kind
  }
  const files: Zippable = {
    'manifest.json': encoder.encode(encodeJSON(manifest)),
    'data.json': encoder.encode(encodeJSON(payload))
  }
  const folder: Zippable = {}
  for (const [name, data] of attachments) {
    if (isSafeFileName(name)) folder[name] = [data, { level: 0 }] // 图片等已压缩，直接存储
  }
  files['attachments'] = folder
  return zipSync(files, { level: 6 })
}

/** 条目路径必须是相对路径，且不包含 ".." */
export function isSafeEntryName(name: string): boolean {
  if (name.startsWith('/') || name.includes('\\') || /^[a-zA-Z]:/.test(name) || name.includes('\0')) return false
  return !name.split('/').includes('..')
}

/** 读取并校验 .taskboard 文件 */
export function readArchive(bytes: Uint8Array): ArchiveContents {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch {
    throw new ArchiveError('notAnArchive')
  }
  const names = Object.keys(entries)
  if (!names.includes('manifest.json') || !names.includes('data.json')) throw new ArchiveError('notAnArchive')
  if (!names.every(isSafeEntryName)) throw new ArchiveError('unsafeContents')

  let manifest: ArchiveManifest
  try {
    const raw = JSON.parse(decoder.decode(entries['manifest.json'])) as Partial<ArchiveManifest>
    manifest = {
      format: String(raw.format ?? ''),
      formatVersion: Number(raw.formatVersion ?? 0),
      kind: raw.kind === 'library' ? 'library' : 'board',
      appVersion: String(raw.appVersion ?? ''),
      exportedAt: String(raw.exportedAt ?? '')
    }
  } catch {
    throw new ArchiveError('damaged')
  }
  if (manifest.format !== FORMAT_NAME) throw new ArchiveError('notAnArchive')
  if (manifest.formatVersion > CURRENT_FORMAT_VERSION) throw new ArchiveError('unsupportedVersion', manifest.formatVersion)

  let boards: Board[]
  let library: AppData | undefined
  try {
    const raw = JSON.parse(decoder.decode(entries['data.json']))
    if (manifest.kind === 'library') {
      library = decodeAppData(raw)
      boards = library.boards
    } else {
      boards = [decodeBoard(raw)]
    }
  } catch (error) {
    if (error instanceof ArchiveError) throw error
    if (error instanceof DecodeError || error instanceof SyntaxError) throw new ArchiveError('damaged')
    throw new ArchiveError('damaged')
  }

  const attachments = new Map<string, Uint8Array>()
  for (const name of names) {
    if (!name.startsWith('attachments/')) continue
    const fileName = name.slice('attachments/'.length)
    if (isSafeFileName(fileName)) attachments.set(fileName, entries[name])
  }
  return { manifest, boards, library, attachments }
}
