// 即将到期：汇总所有看板中有截止日期的卡片，按时间分组
import { useMemo, useState } from 'react'
import { DUE_CATEGORIES, dueCategory, labelsOf, parseDate, rgbaToCss, type Board, type Card, type DueCategory } from '../../shared/model.ts'
import { t } from '../../shared/i18n/index.ts'
import { getStore, useData } from '../store.ts'
import { ui } from '../ui.ts'
import { openCard } from '../actions.ts'
import { DueBadge, LabelPill } from './CardFace.tsx'
import { Icon } from './Icon.tsx'
import { EmptyState, showMenu, useNow } from './common.tsx'

const CATEGORY_TITLES: Record<DueCategory, string> = {
  overdue: '已过期',
  today: '今天',
  tomorrow: '明天',
  thisWeek: '7 天内',
  later: '以后'
}

interface Item {
  board: Board
  card: Card
  due: Date
}

export function UpcomingView() {
  const boards = useData((d) => d.boards)
  const [showDone, setShowDone] = useState(false)
  const now = useNow()

  const { sections, hiddenDone } = useMemo(() => {
    const open = new Map<DueCategory, Item[]>()
    const done: Item[] = []
    let hidden = 0
    for (const board of boards) {
      for (const card of board.cards) {
        const due = parseDate(card.dueDate)
        if (card.isArchived || !due) continue
        if (card.isDone) {
          if (showDone) done.push({ board, card, due })
          else hidden++
        } else {
          const cat = dueCategory(due, now)
          open.set(cat, [...(open.get(cat) ?? []), { board, card, due }])
        }
      }
    }
    const byDate = (a: Item, b: Item) => a.due.getTime() - b.due.getTime()
    const result: { key: string; title: string; items: Item[]; overdue: boolean }[] = DUE_CATEGORIES.filter((c) => open.has(c)).map((c) => ({
      key: c,
      title: t(CATEGORY_TITLES[c]),
      items: open.get(c)!.sort(byDate),
      overdue: c === 'overdue'
    }))
    if (done.length > 0) result.push({ key: 'done', title: t('已完成'), items: done.sort(byDate), overdue: false })
    return { sections: result, hiddenDone: hidden }
  }, [boards, showDone, now])

  return (
    <div className="upcoming">
      <div className="toolbar titlebar-drag">
        <h1 className="toolbar-title">{t('即将到期')}</h1>
        <span className="spacer" />
        <div className="toolbar-actions no-drag">
          <button className={`toolbar-button ${showDone ? 'active' : ''}`} onClick={() => setShowDone((v) => !v)}>
            <Icon name="checkCircle" />
            {t('显示已完成')}
          </button>
        </div>
      </div>
      {sections.length === 0 ? (
        <EmptyState
          icon="calendarClock"
          title={t('没有待完成的到期卡片')}
          description={
            hiddenDone > 0 ? t('有 %lld 张已完成的卡片设置了截止日期，已被隐藏。', hiddenDone) : t('给卡片设置截止日期后，未完成的卡片会在这里按时间汇总显示。')
          }
        >
          {hiddenDone > 0 && (
            <button className="button" onClick={() => setShowDone(true)}>
              {t('显示已完成的卡片')}
            </button>
          )}
        </EmptyState>
      ) : (
        <div className="upcoming-list">
          {sections.map((section) => (
            <section key={section.key}>
              <h2 className={`upcoming-header ${section.overdue ? 'overdue' : ''}`}>
                {section.title} <span className="muted">{section.items.length}</span>
              </h2>
              {section.items.map(({ board, card, due }) => (
                <div
                  key={card.id}
                  className="upcoming-row"
                  onClick={() => openCard(board.id, card.id)}
                  onContextMenu={async (e) => {
                    e.preventDefault()
                    const choice = await showMenu([
                      { id: 'open', label: t('打开') },
                      { id: 'go', label: t('前往看板') }
                    ])
                    if (choice === 'open') openCard(board.id, card.id)
                    else if (choice === 'go') {
                      ui.set({ showingUpcoming: false })
                      getStore().selectBoard(board.id)
                    }
                  }}
                >
                  <button
                    className={`done-toggle ${card.isDone ? 'checked' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      getStore().toggleDone(board.id, card.id)
                    }}
                    title={card.isDone ? t('标记为未完成') : t('标记为已完成')}
                  >
                    <Icon name={card.isDone ? 'checkCircle' : 'circle'} size={18} />
                  </button>
                  <span className="color-strip" style={{ background: card.color ? rgbaToCss(card.color) : undefined }} />
                  <div className="upcoming-main">
                    <div className={`upcoming-title ${card.isDone ? 'done' : ''}`}>{card.title}</div>
                    <div className="upcoming-meta">
                      <span className="board-swatch small" style={{ background: rgbaToCss(board.background) }} />
                      {board.name} · {board.columns.find((c) => c.id === card.columnID)?.name ?? ''}
                      {labelsOf(board, card).map((l) => (
                        <LabelPill key={l.id} label={l} />
                      ))}
                    </div>
                  </div>
                  <DueBadge due={due} done={card.isDone} reminder={card.reminderMinutes !== undefined} />
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
