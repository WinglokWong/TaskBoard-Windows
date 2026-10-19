// 数据模型。与 macOS 版的 data.json / .taskboard 格式完全一致，两个平台的数据可以互相导入。
//
// 兼容性要点：
// - 日期使用 ISO 8601、精确到秒、以 Z 结尾（例如 2026-10-09T06:27:11Z）。
//   macOS 版的解码器不接受毫秒，所以写入时必须去掉毫秒。
// - ID 使用大写 UUID（与 Swift 的 UUID 编码一致）。
// - 可选字段为空时省略。
// - 读取时与 macOS 版相同的容错规则：标量字段缺失或类型不对时使用默认值；
//   数组中的元素无法解析、或连 boards 都没有时视为文件损坏（避免悄悄丢数据后再保存覆盖）。

export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

export interface Attachment {
  id: string
  /** 存储在附件目录中的文件名 */
  fileName: string
  /** 导入时的原始文件名 */
  originalName: string
}

export interface ChecklistItem {
  id: string
  text: string
  isDone: boolean
}

export interface CardLabel {
  id: string
  /** 可以为空：只用颜色区分 */
  name: string
  color: RGBA
}

export interface Card {
  id: string
  columnID?: string
  title: string
  details: string
  attachments: Attachment[]
  checklist: ChecklistItem[]
  labelIDs: string[]
  color?: RGBA
  isDone: boolean
  isArchived: boolean
  dueDate?: string
  /** 提前多少分钟提醒；undefined 表示不提醒 */
  reminderMinutes?: number
  createdAt: string
  archivedAt?: string
  /** 标记完成的时间，用于自动归档 */
  completedAt?: string
}

export interface BoardColumn {
  id: string
  name: string
  color?: RGBA
}

export interface Board {
  id: string
  name: string
  background: RGBA
  columns: BoardColumn[]
  /** 所有卡片（包括已归档）。同一列内，数组顺序即显示顺序。 */
  cards: Card[]
  labels: CardLabel[]
  /** 已完成的卡片在多少天后自动归档；undefined 表示关闭 */
  autoArchiveDays?: number
}

export interface AppData {
  schemaVersion: number
  boards: Board[]
  selectedBoardID?: string
}

export const CURRENT_SCHEMA_VERSION = 4

// MARK: - 基础工具

export function newID(): string {
  return crypto.randomUUID().toUpperCase()
}

/** 秒级精度的 ISO 8601 时间（与 macOS 版一致，不带毫秒） */
export function isoDate(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export function rgbaFromHex(hex: number, alpha = 1): RGBA {
  return { r: ((hex >> 16) & 0xff) / 255, g: ((hex >> 8) & 0xff) / 255, b: (hex & 0xff) / 255, a: alpha }
}

export function rgbaToCss(c: RGBA): string {
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`
}

export function rgbaToHex(c: RGBA): string {
  const h = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`
}

export function rgbaFromCssHex(hex: string, alpha = 1): RGBA {
  return rgbaFromHex(parseInt(hex.replace('#', ''), 16), alpha)
}

/** 相对亮度（近似），用于决定前景文字颜色 */
export function luminance(c: RGBA): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

/** 在该背景色上应使用深色文字 */
export function prefersDarkText(c: RGBA): boolean {
  return c.a < 0.45 || luminance(c) > 0.6
}

export function isCloseColor(a: RGBA | undefined, b: RGBA | undefined): boolean {
  if (!a || !b) return false
  return Math.abs(a.r - b.r) < 0.01 && Math.abs(a.g - b.g) < 0.01 && Math.abs(a.b - b.b) < 0.01 && Math.abs(a.a - b.a) < 0.01
}

// MARK: - 色板（与 macOS 版相同的 24 种颜色）

export interface PaletteColor {
  /** 稳定的标识 */
  key: string
  /** 简体中文名称（也是翻译的键） */
  name: string
  value: RGBA
}

export const PALETTE: PaletteColor[] = [
  ['green', '绿', 0x4bce97], ['yellow', '黄', 0xf5cd47], ['orange', '橙', 0xfea362], ['red', '红', 0xf87168],
  ['purple', '紫', 0x9f8fef], ['blue', '蓝', 0x579dff], ['sky', '天蓝', 0x6cc3e0], ['pink', '粉', 0xe774bb],
  ['lightGreen', '浅绿', 0xbaf3db], ['lightYellow', '浅黄', 0xf8e6a0], ['lightOrange', '浅橙', 0xfedec8], ['lightRed', '浅红', 0xffd5d2],
  ['lightPurple', '浅紫', 0xdfd8fd], ['lightBlue', '浅蓝', 0xcce0ff], ['lightGray', '浅灰', 0xebecf0], ['white', '白', 0xffffff],
  ['darkGreen', '深绿', 0x1f845a], ['darkYellow', '深黄', 0x946f00], ['darkOrange', '深橙', 0xc25100], ['darkRed', '深红', 0xc9372c],
  ['darkPurple', '深紫', 0x6e5dc6], ['darkBlue', '深蓝', 0x0c66e4], ['gray', '灰', 0x626f86], ['navy', '墨', 0x172b4d]
].map(([key, name, hex]) => ({ key: key as string, name: name as string, value: rgbaFromHex(hex as number) }))

export function paletteColor(key: string): RGBA | undefined {
  return PALETTE.find((p) => p.key === key)?.value
}

export function paletteEntry(color: RGBA | undefined): PaletteColor | undefined {
  return color ? PALETTE.find((p) => isCloseColor(p.value, color)) : undefined
}

export const DEFAULT_BOARD_BACKGROUND = rgbaFromHex(0x0c66e4)

export function defaultLabels(): CardLabel[] {
  return ['green', 'yellow', 'orange', 'red', 'purple', 'blue'].map((key) => ({ id: newID(), name: '', color: paletteColor(key)! }))
}

// MARK: - 新建

/** 新卡片。title 等字段由调用方提供 */
export function makeCard(fields: Partial<Card> & { title: string }): Card {
  return {
    id: newID(),
    details: '',
    attachments: [],
    checklist: [],
    labelIDs: [],
    isDone: false,
    isArchived: false,
    createdAt: isoDate(),
    ...fields
  }
}

/** 新看板，默认三个列表。名称由调用方按当前语言提供 */
export function makeBoard(name: string, columnNames: [string, string, string]): Board {
  return {
    id: newID(),
    name,
    background: DEFAULT_BOARD_BACKGROUND,
    columns: columnNames.map((n) => ({ id: newID(), name: n })),
    cards: [],
    labels: defaultLabels()
  }
}

export function labelsOf(board: Board, card: Card): CardLabel[] {
  return board.labels.filter((l) => card.labelIDs.includes(l.id))
}

export function reminderDate(card: Card): Date | undefined {
  const due = parseDate(card.dueDate)
  if (!due || card.reminderMinutes === undefined) return undefined
  return new Date(due.getTime() - card.reminderMinutes * 60_000)
}

export function cardMatches(card: Card, query: string): boolean {
  const q = query.toLocaleLowerCase()
  return (
    card.title.toLocaleLowerCase().includes(q) ||
    card.details.toLocaleLowerCase().includes(q) ||
    card.checklist.some((i) => i.text.toLocaleLowerCase().includes(q))
  )
}

// MARK: - 容错解码

export class DecodeError extends Error {}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function str(o: Obj, key: string, fallback: string): string {
  return typeof o[key] === 'string' ? (o[key] as string) : fallback
}
function optStr(o: Obj, key: string): string | undefined {
  return typeof o[key] === 'string' ? (o[key] as string) : undefined
}
function bool(o: Obj, key: string, fallback: boolean): boolean {
  return typeof o[key] === 'boolean' ? (o[key] as boolean) : fallback
}
function optInt(o: Obj, key: string): number | undefined {
  const v = o[key]
  return typeof v === 'number' && Number.isInteger(v) ? v : undefined
}
function optDate(o: Obj, key: string): string | undefined {
  const v = optStr(o, key)
  const d = parseDate(v)
  return d ? isoDate(d) : undefined
}
function id(o: Obj, key = 'id'): string {
  const v = optStr(o, key)
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v.toUpperCase() : newID()
}
function optID(o: Obj, key: string): string | undefined {
  const v = optStr(o, key)
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v.toUpperCase() : undefined
}
function color(v: unknown): RGBA | undefined {
  if (!isObj(v)) return undefined
  const n = (k: string, d?: number) => (typeof v[k] === 'number' ? (v[k] as number) : d)
  const r = n('r'), g = n('g'), b = n('b')
  if (r === undefined || g === undefined || b === undefined) return undefined
  return { r, g, b, a: n('a', 1)! }
}
/** 数组：缺失时为空数组；存在但不是数组、或元素解析失败时抛错 */
function array<T>(o: Obj, key: string, decode: (v: unknown) => T): T[] {
  const v = o[key]
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw new DecodeError(`${key} is not an array`)
  return v.map(decode)
}

export function decodeAttachment(v: unknown): Attachment {
  if (!isObj(v) || typeof v.fileName !== 'string') throw new DecodeError('attachment without fileName')
  return { id: id(v), fileName: v.fileName, originalName: str(v, 'originalName', v.fileName) }
}

export function decodeChecklistItem(v: unknown): ChecklistItem {
  if (!isObj(v)) throw new DecodeError('invalid checklist item')
  return { id: id(v), text: str(v, 'text', ''), isDone: bool(v, 'isDone', false) }
}

export function decodeLabel(v: unknown): CardLabel {
  if (!isObj(v)) throw new DecodeError('invalid label')
  return { id: id(v), name: str(v, 'name', ''), color: color(v.color) ?? rgbaFromHex(0x8590a2) }
}

export function decodeCard(v: unknown): Card {
  if (!isObj(v)) throw new DecodeError('invalid card')
  const card: Card = {
    id: id(v),
    title: str(v, 'title', ''),
    details: str(v, 'details', ''),
    attachments: array(v, 'attachments', decodeAttachment),
    checklist: array(v, 'checklist', decodeChecklistItem),
    labelIDs: Array.isArray(v.labelIDs) ? v.labelIDs.filter((x): x is string => typeof x === 'string').map((x) => x.toUpperCase()) : [],
    isDone: bool(v, 'isDone', false),
    isArchived: bool(v, 'isArchived', false),
    createdAt: optDate(v, 'createdAt') ?? isoDate()
  }
  const columnID = optID(v, 'columnID')
  if (columnID) card.columnID = columnID
  const c = color(v.color)
  if (c) card.color = c
  const due = optDate(v, 'dueDate')
  if (due) card.dueDate = due
  const reminder = optInt(v, 'reminderMinutes')
  if (reminder !== undefined) card.reminderMinutes = reminder
  const archivedAt = optDate(v, 'archivedAt')
  if (archivedAt) card.archivedAt = archivedAt
  const completedAt = optDate(v, 'completedAt')
  if (completedAt) card.completedAt = completedAt
  return card
}

export function decodeColumn(v: unknown): BoardColumn {
  if (!isObj(v)) throw new DecodeError('invalid column')
  const column: BoardColumn = { id: id(v), name: str(v, 'name', '未命名列表') }
  const c = color(v.color)
  if (c) column.color = c
  return column
}

export function decodeBoard(v: unknown): Board {
  if (!isObj(v)) throw new DecodeError('invalid board')
  const board: Board = {
    id: id(v),
    name: str(v, 'name', '未命名看板'),
    background: color(v.background) ?? DEFAULT_BOARD_BACKGROUND,
    columns: array(v, 'columns', decodeColumn),
    cards: array(v, 'cards', decodeCard),
    // 旧版本没有标签：给一套默认颜色标签
    labels: v.labels === undefined || v.labels === null ? defaultLabels() : array(v, 'labels', decodeLabel)
  }
  const days = optInt(v, 'autoArchiveDays')
  if (days !== undefined) board.autoArchiveDays = days
  return board
}

export function decodeAppData(v: unknown): AppData {
  // boards 是唯一必须存在的字段：如果连它都读不到，说明文件确实损坏了
  if (!isObj(v) || !Array.isArray(v.boards)) throw new DecodeError('missing boards')
  const data: AppData = {
    schemaVersion: optInt(v, 'schemaVersion') ?? 1,
    boards: v.boards.map(decodeBoard)
  }
  const selected = optID(v, 'selectedBoardID')
  if (selected) data.selectedBoardID = selected
  return data
}

/** 写入文件的 JSON（与 macOS 版相同：两个空格缩进、键名排序） */
export function encodeJSON(value: unknown): string {
  return JSON.stringify(value, (_, v) => (isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v), 2)
}

// MARK: - 筛选与截止日期分组

export type DueCategory = 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'later'
export const DUE_CATEGORIES: DueCategory[] = ['overdue', 'today', 'tomorrow', 'thisWeek', 'later']

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
export const isSameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime()

export function dueCategory(due: Date, now: Date = new Date()): DueCategory {
  if (due < now) return 'overdue'
  if (isSameDay(due, now)) return 'today'
  if (isSameDay(due, addDays(now, 1))) return 'tomorrow'
  if (due < addDays(startOfDay(now), 7)) return 'thisWeek'
  return 'later'
}

export type StatusFilter = 'all' | 'open' | 'done'
export type DueFilter = 'any' | 'overdue' | 'today' | 'week' | 'none'

export interface BoardFilter {
  labelIDs: string[]
  status: StatusFilter
  due: DueFilter
}

export const EMPTY_FILTER: BoardFilter = { labelIDs: [], status: 'all', due: 'any' }

export function filterIsActive(f: BoardFilter): boolean {
  return f.labelIDs.length > 0 || f.status !== 'all' || f.due !== 'any'
}

export function filterActiveCount(f: BoardFilter): number {
  return (f.labelIDs.length > 0 ? 1 : 0) + (f.status !== 'all' ? 1 : 0) + (f.due !== 'any' ? 1 : 0)
}

export function filterMatches(f: BoardFilter, card: Card, now: Date = new Date()): boolean {
  if (f.labelIDs.length > 0 && !f.labelIDs.some((l) => card.labelIDs.includes(l))) return false
  if (f.status === 'open' && card.isDone) return false
  if (f.status === 'done' && !card.isDone) return false
  const due = parseDate(card.dueDate)
  switch (f.due) {
    case 'any':
      return true
    case 'none':
      return due === undefined
    case 'overdue':
      return due !== undefined && !card.isDone && due < now
    case 'today':
      return due !== undefined && isSameDay(due, now)
    case 'week': {
      if (!due) return false
      const cat = dueCategory(due, now)
      return cat !== 'later' && (cat !== 'overdue' || isSameDay(due, now))
    }
  }
}

// MARK: - 自动归档

/**
 * 在开启了自动归档的看板中，归档完成时间超过设定天数的卡片。
 * 没有完成时间的已完成卡片（升级前完成的）从现在开始计时。返回新数据；没有变化时返回原对象。
 */
export function applyAutoArchive(data: AppData, now: Date = new Date()): AppData {
  let changed = false
  const boards = data.boards.map((board) => {
    if (board.autoArchiveDays === undefined) return board
    const limit = board.autoArchiveDays * 24 * 3600 * 1000
    let boardChanged = false
    const cards = board.cards.map((card) => {
      if (!card.isDone || card.isArchived) return card
      const completed = parseDate(card.completedAt)
      if (!completed) {
        boardChanged = true
        return { ...card, completedAt: isoDate(now) }
      }
      if (now.getTime() - completed.getTime() >= limit) {
        boardChanged = true
        return { ...card, isArchived: true, archivedAt: isoDate(now) }
      }
      return card
    })
    if (!boardChanged) return board
    changed = true
    return { ...board, cards }
  })
  return changed ? { ...data, boards } : data
}

// MARK: - 导入时换新 ID

/**
 * 复制一份使用全新 ID 的看板（列表、卡片、标签、清单项、附件都换新 ID，并重新建立关联）。
 * copyAttachment 负责复制附件文件，返回 undefined 表示附件缺失、跳过。
 */
export function reidentifyBoard(board: Board, copyAttachment: (a: Attachment) => Attachment | undefined): Board {
  const columnMap = new Map<string, string>()
  const labelMap = new Map<string, string>()
  const columns = board.columns.map((c) => {
    const nid = newID()
    columnMap.set(c.id, nid)
    return { ...c, id: nid }
  })
  const labels = board.labels.map((l) => {
    const nid = newID()
    labelMap.set(l.id, nid)
    return { ...l, id: nid }
  })
  const cards = board.cards.map((card) => {
    const copy: Card = {
      ...card,
      id: newID(),
      labelIDs: card.labelIDs.map((l) => labelMap.get(l)).filter((x): x is string => x !== undefined),
      checklist: card.checklist.map((i) => ({ ...i, id: newID() })),
      attachments: card.attachments.map(copyAttachment).filter((a): a is Attachment => a !== undefined)
    }
    const mapped = card.columnID ? columnMap.get(card.columnID) : undefined
    if (mapped) copy.columnID = mapped
    else delete copy.columnID
    return copy
  })
  return { ...board, id: newID(), columns, labels, cards }
}

/** 没有所属列表的未归档卡片放进第一个列表，避免“看不见” */
export function placeOrphanedCards(board: Board, defaultColumnName: string): Board {
  const columnIDs = new Set(board.columns.map((c) => c.id))
  const orphaned = board.cards.some((c) => !c.isArchived && !(c.columnID && columnIDs.has(c.columnID)))
  if (!orphaned) return board
  const columns = board.columns.length > 0 ? board.columns : [{ id: newID(), name: defaultColumnName }]
  const first = columns[0].id
  return {
    ...board,
    columns,
    cards: board.cards.map((c) => (!c.isArchived && !(c.columnID && columnIDs.has(c.columnID)) ? { ...c, columnID: first } : c))
  }
}

/** 附件名只能是单纯的文件名 */
export function isSafeFileName(name: string): boolean {
  return name.length > 0 && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..' && !name.startsWith('.') && !name.includes('\0')
}

export function attachmentFileNames(data: AppData): Set<string> {
  return new Set(data.boards.flatMap((b) => b.cards.flatMap((c) => c.attachments.map((a) => a.fileName))))
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif', 'tif', 'tiff', 'svg', 'ico', 'avif'])

export function isImageFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTENSIONS.has(ext)
}

export function coverImage(card: Card): Attachment | undefined {
  return card.attachments.find((a) => isImageFile(a.fileName))
}
