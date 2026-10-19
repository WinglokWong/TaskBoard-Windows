// 不保存到数据文件的界面状态：当前对话框、提示、更新状态、偏好设置。
import { useSyncExternalStore } from 'react'
import type { ImportedArchive, InitialState, Prefs, UpdateStatus } from '../shared/api.ts'
import { localeTag, t, type Language } from '../shared/i18n/index.ts'
import { isSameDay } from '../shared/model.ts'

export type Dialog =
  | { kind: 'card'; boardID: string; cardID: string }
  | { kind: 'archive'; boardID: string }
  | { kind: 'backups' }
  | { kind: 'settings' }
  | { kind: 'shortcuts' }
  | { kind: 'import'; archive: ImportedArchive }
  | { kind: 'preview'; fileNames: string[]; names: string[]; index: number }

export interface Toast {
  id: number
  text: string
  actionLabel?: string
  action?: () => void
}

export interface UIState {
  showingUpcoming: boolean
  dialog: Dialog | null
  toast: Toast | null
  update: UpdateStatus
  prefs: Prefs
  init: InitialState
  language: Language
}

type Listener = () => void

class UIStore {
  state!: UIState
  private listeners = new Set<Listener>()
  private toastTimer?: ReturnType<typeof setTimeout>

  init(state: UIState): void {
    this.state = state
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  set(update: Partial<UIState>): void {
    this.state = { ...this.state, ...update }
    for (const l of this.listeners) l()
  }

  openDialog(dialog: Dialog): void {
    this.set({ dialog })
  }

  closeDialog(): void {
    this.set({ dialog: null })
  }

  toast(text: string, actionLabel?: string, action?: () => void, duration = 4000): void {
    clearTimeout(this.toastTimer)
    this.set({ toast: { id: Date.now(), text, actionLabel, action } })
    this.toastTimer = setTimeout(() => this.set({ toast: null }), duration)
  }
}

export const ui = new UIStore()

export function useUI<T>(selector: (s: UIState) => T): T {
  return useSyncExternalStore(ui.subscribe, () => selector(ui.state))
}

// MARK: - 日期格式（跟随界面语言）

export function formatTime(date: Date): string {
  return date.toLocaleTimeString(localeTag(), { hour: 'numeric', minute: '2-digit' })
}

/** 卡片上的简短格式，例如「今天 14:00」「10月12日 09:00」/「Today 2:00 PM」「Oct 12 9:00 AM」 */
export function formatDueShort(date: Date, now: Date = new Date()): string {
  const time = formatTime(date)
  if (isSameDay(date, now)) return t('今天 %@', time)
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  if (isSameDay(date, tomorrow)) return t('明天 %@', time)
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (isSameDay(date, yesterday)) return t('昨天 %@', time)
  const sameYear = date.getFullYear() === now.getFullYear()
  const day = date.toLocaleDateString(localeTag(), sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' })
  return t('%@ %@', day, time)
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString(localeTag(), { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
