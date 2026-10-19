import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { MenuItemSpec } from '../../shared/api.ts'
import { t } from '../../shared/i18n/index.ts'
import { Icon } from './Icon.tsx'

/** 每分钟刷新一次的“现在”，用于截止日期徽章等 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** 显示原生菜单（右键菜单 / 下拉菜单）；返回选中项的 id */
export function showMenu(items: MenuItemSpec[], anchor?: HTMLElement | null): Promise<string | null> {
  if (anchor) {
    const r = anchor.getBoundingClientRect()
    return window.taskboard.showMenu(items, { x: r.left, y: r.bottom + 4 })
  }
  return window.taskboard.showMenu(items)
}

/** 锚定在某个元素旁边的弹出面板；点击外部或按 Esc 关闭 */
export function Popover({
  anchor,
  onClose,
  children,
  width = 300,
  align = 'start'
}: {
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
  width?: number
  align?: 'start' | 'end'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = anchor.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const height = ref.current?.offsetHeight ?? 0
    let left = align === 'end' ? r.right - width : r.left
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
    let top = r.bottom + 6
    if (top + height > window.innerHeight - 8) top = Math.max(8, r.top - height - 6)
    setPos({ left, top })
  }, [anchor, width, align])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [anchor, onClose])

  return createPortal(
    <div ref={ref} className="popover" style={{ width, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}>
      {children}
    </div>,
    document.body
  )
}

/** 对话框外壳：标题、内容、底部按钮；按 Esc 或点击背景关闭 */
export function Modal({
  title,
  icon,
  onClose,
  children,
  footer,
  width = 560,
  className
}: {
  title?: ReactNode
  icon?: Parameters<typeof Icon>[0]['name']
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
  className?: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className ?? ''}`} style={{ width }} role="dialog" aria-modal="true">
        {title !== undefined && (
          <div className="modal-header">
            <div className="modal-title">
              {icon && <Icon name={icon} size={18} />}
              {title}
            </div>
            <button className="icon-button" onClick={onClose} title={t('关闭')} aria-label={t('关闭')}>
              <Icon name="close" />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

/** 空状态 */
export function EmptyState({ icon, title, description, children }: { icon: Parameters<typeof Icon>[0]['name']; title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={40} />
      <div className="empty-title">{title}</div>
      {description && <div className="empty-description">{description}</div>}
      {children}
    </div>
  )
}

/** 正在输入文字时不处理全局快捷键 */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}
