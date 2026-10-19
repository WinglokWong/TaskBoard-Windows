// 卡片的外观（不含交互逻辑）。看板上的卡片和拖动时的浮动副本都使用它，保证拖动时看到的就是卡片本身。
import { memo, type CSSProperties } from 'react'
import { coverImage, paletteEntry, parseDate, prefersDarkText, rgbaToCss, type Card, type CardLabel } from '../../shared/model.ts'
import { t } from '../../shared/i18n/index.ts'
import { formatDueShort } from '../ui.ts'
import { Icon } from './Icon.tsx'
import { useNow } from './common.tsx'

export function cardColors(card: Card): CSSProperties {
  if (!card.color) return {}
  return {
    background: rgbaToCss(card.color),
    color: prefersDarkText(card.color) ? 'rgba(0,0,0,0.85)' : '#fff',
    ['--card-fg' as string]: prefersDarkText(card.color) ? 'rgba(0,0,0,0.85)' : '#fff'
  }
}

export function LabelPill({ label, expanded = false }: { label: CardLabel; expanded?: boolean }) {
  const name = label.name.trim()
  const fg = prefersDarkText(label.color) ? 'rgba(0,0,0,0.85)' : '#fff'
  if (!name) {
    return <span className={`label-pill bar ${expanded ? 'expanded' : ''}`} style={{ background: rgbaToCss(label.color) }} title={labelDisplayName(label)} />
  }
  return (
    <span className={`label-pill ${expanded ? 'expanded' : ''}`} style={{ background: rgbaToCss(label.color), color: fg }} title={name}>
      {name}
    </span>
  )
}

export function labelDisplayName(label: CardLabel): string {
  const trimmed = label.name.trim()
  if (trimmed) return trimmed
  const entry = paletteEntry(label.color)
  return entry ? t('%@色标签', t(entry.name)) : t('未命名标签')
}

/** 截止日期徽章：已完成为绿色，已过期为红色，24 小时内到期为橙色 */
export function DueBadge({ due, done, reminder }: { due: Date; done: boolean; reminder: boolean }) {
  const now = useNow()
  let tone = ''
  let help = t('截止日期')
  if (done) {
    tone = 'green'
    help = t('已完成')
  } else if (due < now) {
    tone = 'red'
    help = t('已过期')
  } else if (due.getTime() - now.getTime() < 24 * 3600 * 1000) {
    tone = 'orange'
    help = t('即将到期')
  }
  return (
    <span className={`due-badge ${tone}`} title={help}>
      <Icon name={reminder ? 'bell' : 'clock'} size={12} />
      {formatDueShort(due, now)}
    </span>
  )
}

export const CardFace = memo(function CardFace({
  card,
  labels,
  selected = false,
  onToggleDone
}: {
  card: Card
  labels: CardLabel[]
  selected?: boolean
  onToggleDone?: () => void
}) {
  const cover = coverImage(card)
  const due = parseDate(card.dueDate)
  const done = card.checklist.filter((i) => i.isDone).length
  const total = card.checklist.length
  const hasBadges = due || total > 0 || card.details || card.attachments.length > 0
  return (
    <div className={`card-face ${card.color ? 'colored' : ''} ${selected ? 'selected' : ''} ${card.isDone ? 'done' : ''}`} style={cardColors(card)}>
      {labels.length > 0 && (
        <div className="label-row">
          {labels.map((l) => (
            <LabelPill key={l.id} label={l} />
          ))}
        </div>
      )}
      {cover && <img className="card-cover" src={window.taskboard.attachmentURL(cover.fileName)} alt="" draggable={false} loading="lazy" />}
      <div className="card-title-row">
        <button
          className={`done-toggle ${card.isDone ? 'checked' : ''}`}
          title={card.isDone ? t('标记为未完成') : t('标记为已完成')}
          aria-label={card.isDone ? t('标记为未完成') : t('标记为已完成')}
          tabIndex={onToggleDone ? 0 : -1}
          onClick={(e) => {
            e.stopPropagation()
            onToggleDone?.()
          }}
        >
          <Icon name={card.isDone ? 'checkCircle' : 'circle'} size={17} />
        </button>
        <div className="card-title">{card.title}</div>
      </div>
      {hasBadges && (
        <div className="card-badges">
          {due && <DueBadge due={due} done={card.isDone} reminder={card.reminderMinutes !== undefined} />}
          {total > 0 && (
            <span className={`checklist-badge ${done === total ? 'complete' : ''}`} title={t('清单进度')}>
              <Icon name="checklist" size={12} />
              {done}/{total}
            </span>
          )}
          {card.details && (
            <span title={t('有描述')}>
              <Icon name="textLines" size={13} />
            </span>
          )}
          {card.attachments.length > 0 && (
            <span>
              <Icon name="paperclip" size={13} />
              {card.attachments.length}
            </span>
          )}
        </div>
      )}
    </div>
  )
})
