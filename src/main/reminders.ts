// 截止日期提醒。界面在每次保存后把需要提醒的卡片交给主进程；
// 主进程定时检查，到时间时显示系统通知（应用需要在运行，关闭窗口后会继续在通知区域运行）。
import { Notification } from 'electron'
import type { Reminder } from '../shared/api.ts'

let reminders: Reminder[] = []
const fired = new Set<string>()
let timer: NodeJS.Timeout | undefined
let onClick: (boardID: string, cardID: string) => void = () => {}

/** 超过这个时间仍未发出的提醒视为错过，不再补发（与 macOS 版一致） */
const GRACE_MS = 90_000

export function startReminders(clickHandler: (boardID: string, cardID: string) => void): void {
  onClick = clickHandler
  timer ??= setInterval(check, 15_000)
}

export function setReminders(list: Reminder[]): void {
  reminders = list
  check()
}

function check(): void {
  if (!Notification.isSupported()) return
  const now = Date.now()
  for (const r of reminders) {
    const at = new Date(r.fireAt).getTime()
    const key = `${r.key}@${r.fireAt}`
    if (at > now || at < now - GRACE_MS || fired.has(key)) continue
    fired.add(key)
    show(r.title, r.body, () => onClick(r.boardID, r.cardID))
  }
}

export function show(title: string, body: string, click?: () => void): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body })
  if (click) notification.on('click', click)
  notification.show()
}

export function stopReminders(): void {
  if (timer) clearInterval(timer)
  timer = undefined
}
