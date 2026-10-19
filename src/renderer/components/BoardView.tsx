// 看板：工具栏（搜索、筛选、看板设置、背景、归档）、筛选提示条、列表和拖动排序、键盘快捷键。
//
// 拖动（dnd-kit）：
// - 拖动时一个与原物一模一样的副本跟随鼠标（DragOverlay），原位置显示半透明占位，其他卡片 / 列表实时让位；
// - 放下时副本滑入占位的位置，结束后才显示真正的卡片 / 列表（不会出现两个副本）；
// - 拖到看板外松开或按 Esc 取消；靠近边缘时自动滚动。
// 拖动过程中的顺序只保存在本组件的预览状态里，放下时一次性写入数据（一个撤销步骤）。
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  closestCenter,
  defaultDropAnimationSideEffects,
  DndContext,
  DragOverlay,
  getFirstCollision,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  type UniqueIdentifier
} from '@dnd-kit/core'
import { arrayMove, horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable'
import {
  cardMatches,
  EMPTY_FILTER,
  filterActiveCount,
  filterIsActive,
  filterMatches,
  labelsOf,
  prefersDarkText,
  rgbaToCss,
  type Board,
  type BoardFilter,
  type Card,
  type DueFilter,
  type StatusFilter
} from '../../shared/model.ts'
import { t } from '../../shared/i18n/index.ts'
import { getStore, useData } from '../store.ts'
import { ui } from '../ui.ts'
import { exportBoard, openCard, previewAttachments } from '../actions.ts'
import { Column, ColumnFace, columnKey, cardKey, InlineInput } from './Column.tsx'
import { CardFace, LabelPill, labelDisplayName } from './CardFace.tsx'
import { ColorPicker } from './ColorPicker.tsx'
import { Icon } from './Icon.tsx'
import { isTyping, Popover, showMenu } from './common.tsx'

interface Arrangement {
  columns: string[]
  cards: Record<string, string[]>
}

/** 只在指针拖动、且不是从输入框 / 按钮上开始时激活 */
class BoardPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent }: { nativeEvent: PointerEvent }) => {
        if (nativeEvent.button !== 0) return false
        const target = nativeEvent.target as HTMLElement | null
        return !target?.closest('input, textarea, select, button, a, [contenteditable="true"], .no-drag')
      }
    }
  ]
}

const dropAnimation: DropAnimation = {
  duration: 260,
  easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  sideEffects: (args) => {
    // 落下时：占位隐藏，副本从“拿起”状态恢复正常大小并滑入位置
    const cleanup = defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } })(args)
    args.dragOverlay.node.classList.add('dropping')
    return () => cleanup?.()
  }
}

const COLUMN_PREFIX = 'col:'
const CARD_PREFIX = 'card:'

export function BoardView({ boardID }: { boardID: string }) {
  const board = useData((d) => d.boards.find((b) => b.id === boardID))
  if (!board) return null
  return <BoardContent board={board} />
}

const BoardContent = memo(function BoardContent({ board }: { board: Board }) {
  const store = getStore()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<BoardFilter>(EMPTY_FILTER)
  const [selectedCardID, setSelectedCardID] = useState<string | null>(null)
  const [addRequest, setAddRequest] = useState<string | null>(null)
  const [showBackground, setShowBackground] = useState(false)
  const [renamingTitle, setRenamingTitle] = useState(false)
  const backgroundRef = useRef<HTMLButtonElement>(null)
  const filterRef = useRef<HTMLButtonElement>(null)
  const settingsRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // MARK: 可见卡片

  const query = search.trim()
  const visible = useMemo(() => {
    const now = new Date()
    const result: Record<string, Card[]> = {}
    for (const column of board.columns) result[column.id] = []
    for (const card of board.cards) {
      if (card.isArchived || !card.columnID || !result[card.columnID]) continue
      if (query && !cardMatches(card, query)) continue
      if (!filterMatches(filter, card, now)) continue
      result[card.columnID].push(card)
    }
    return result
  }, [board, query, filter])

  const cardsByID = useMemo(() => new Map(board.cards.map((c) => [c.id, c])), [board.cards])
  const base: Arrangement = useMemo(
    () => ({ columns: board.columns.map((c) => c.id), cards: Object.fromEntries(Object.entries(visible).map(([k, v]) => [k, v.map((c) => c.id)])) }),
    [board.columns, visible]
  )

  // MARK: 拖动

  const [activeID, setActiveID] = useState<string | null>(null)
  const [preview, setPreview] = useState<Arrangement | null>(null)
  const arrangement = preview ?? base
  const arrangementRef = useRef(arrangement)
  arrangementRef.current = arrangement
  const lastOverID = useRef<UniqueIdentifier | null>(null)
  const recentlyMovedToNewColumn = useRef(false)
  const justDragged = useRef(0)

  useEffect(() => {
    requestAnimationFrame(() => {
      recentlyMovedToNewColumn.current = false
    })
  }, [preview])

  const sensors = useSensors(useSensor(BoardPointerSensor, { activationConstraint: { distance: 5 } }))

  const columnOf = (arr: Arrangement, cardID: string) => arr.columns.find((c) => arr.cards[c]?.includes(cardID))

  /** 拖列表时只比较列表；拖卡片时先找鼠标所在的列表，再找其中最近的卡片 */
  const collision: CollisionDetection = useCallback((args) => {
    const active = String(args.active.id)
    if (active.startsWith(COLUMN_PREFIX)) {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => String(c.id).startsWith(COLUMN_PREFIX)) })
    }
    const pointer = pointerWithin(args)
    const hits = pointer.length > 0 ? pointer : rectIntersection(args)
    let overID = getFirstCollision(hits, 'id')
    if (overID != null) {
      const key = String(overID)
      if (key.startsWith(COLUMN_PREFIX)) {
        const items = arrangementRef.current.cards[key.slice(COLUMN_PREFIX.length)] ?? []
        if (items.length > 0) {
          const inner = closestCenter({
            ...args,
            droppableContainers: args.droppableContainers.filter((c) => {
              const k = String(c.id)
              return k.startsWith(CARD_PREFIX) && items.includes(k.slice(CARD_PREFIX.length))
            })
          })
          if (inner.length > 0) overID = inner[0].id
        }
      }
      lastOverID.current = overID
      return [{ id: overID }]
    }
    if (recentlyMovedToNewColumn.current) lastOverID.current = args.active.id
    return lastOverID.current ? [{ id: lastOverID.current }] : []
  }, [])

  function onDragStart({ active }: DragStartEvent) {
    setActiveID(String(active.id))
    setPreview(base)
    setSelectedCardID(null)
  }

  function onDragOver({ active, over }: DragOverEvent) {
    const key = String(active.id)
    if (!key.startsWith(CARD_PREFIX) || !over) return
    const cardID = key.slice(CARD_PREFIX.length)
    const overKey = String(over.id)
    const arr = arrangementRef.current
    const from = columnOf(arr, cardID)
    const to = overKey.startsWith(COLUMN_PREFIX) ? overKey.slice(COLUMN_PREFIX.length) : columnOf(arr, overKey.slice(CARD_PREFIX.length))
    if (!from || !to || from === to) return
    const target = arr.cards[to] ?? []
    let index = target.length
    if (overKey.startsWith(CARD_PREFIX)) {
      const overIndex = target.indexOf(overKey.slice(CARD_PREFIX.length))
      const translated = active.rect.current.translated
      const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false
      index = overIndex >= 0 ? overIndex + (below ? 1 : 0) : target.length
    }
    recentlyMovedToNewColumn.current = true
    setPreview({
      columns: arr.columns,
      cards: { ...arr.cards, [from]: arr.cards[from].filter((x) => x !== cardID), [to]: [...target.slice(0, index), cardID, ...target.slice(index)] }
    })
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const key = String(active.id)
    const arr = arrangementRef.current
    setActiveID(null)
    justDragged.current = Date.now()
    if (!over) {
      setPreview(null)
      return
    }
    const overKey = String(over.id)
    if (key.startsWith(COLUMN_PREFIX)) {
      const columnID = key.slice(COLUMN_PREFIX.length)
      const overColumn = overKey.startsWith(COLUMN_PREFIX) ? overKey.slice(COLUMN_PREFIX.length) : columnOf(arr, overKey.slice(CARD_PREFIX.length))
      const fromIndex = arr.columns.indexOf(columnID)
      const toIndex = overColumn ? arr.columns.indexOf(overColumn) : fromIndex
      store.reorderColumns(board.id, arrayMove(arr.columns, fromIndex, toIndex))
    } else {
      const cardID = key.slice(CARD_PREFIX.length)
      const columnID = columnOf(arr, cardID)
      if (columnID) {
        let items = arr.cards[columnID]
        if (overKey.startsWith(CARD_PREFIX)) {
          const fromIndex = items.indexOf(cardID)
          const toIndex = items.indexOf(overKey.slice(CARD_PREFIX.length))
          if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) items = arrayMove(items, fromIndex, toIndex)
        }
        const others = items.filter((x) => x !== cardID)
        store.moveCard(board.id, cardID, columnID, others[items.indexOf(cardID)])
      }
    }
    setPreview(null)
  }

  function onDragCancel() {
    setActiveID(null)
    setPreview(null)
    justDragged.current = Date.now()
  }

  const openCardFromClick = useCallback(
    (card: Card) => {
      if (Date.now() - justDragged.current < 300) return
      openCard(board.id, card.id)
    },
    [board.id]
  )
  const activeIDRef = useRef(activeID)
  activeIDRef.current = activeID
  const hoverCard = useCallback((cardID: string) => {
    if (!activeIDRef.current) setSelectedCardID(cardID)
  }, [])
  const clearAddRequest = useCallback(() => setAddRequest(null), [])

  // MARK: 键盘

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (ui.state.dialog || isTyping(e.target) || activeIDRef.current) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const arr = arrangementRef.current
      const grid = arr.columns.map((c) => arr.cards[c] ?? [])
      let pos: [number, number] | null = null
      for (let c = 0; c < grid.length && selectedCardID; c++) {
        const r = grid[c].indexOf(selectedCardID)
        if (r >= 0) pos = [c, r]
      }
      const select = (id: string | undefined) => {
        if (!id) return
        setSelectedCardID(id)
        document.querySelector(`[data-card-id="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
      }
      const selected = selectedCardID ? cardsByID.get(selectedCardID) : undefined
      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault()
          if (!pos) {
            select(grid.find((g) => g.length > 0)?.[0])
            return
          }
          const [c, r] = pos
          if (e.key === 'ArrowUp') select(grid[c][r - 1])
          else if (e.key === 'ArrowDown') select(grid[c][r + 1])
          else {
            const step = e.key === 'ArrowLeft' ? -1 : 1
            for (let i = c + step; i >= 0 && i < grid.length; i += step) {
              if (grid[i].length > 0) {
                select(grid[i][Math.min(r, grid[i].length - 1)])
                break
              }
            }
          }
          return
        }
        case 'Enter':
          if (selected) openCard(board.id, selected.id)
          return
        case ' ':
          if (selected) {
            e.preventDefault()
            previewAttachments(selected)
          }
          return
        case 'd':
        case 'D':
          if (selected) store.toggleDone(board.id, selected.id)
          return
        case 'Delete':
        case 'Backspace':
          if (selected && pos) {
            const [c, r] = pos
            const next = grid[c][r + 1] ?? grid[c][r - 1] ?? null
            store.archiveCard(board.id, selected.id)
            setSelectedCardID(next)
          }
          return
        case 'n':
        case 'N':
          e.preventDefault()
          setAddRequest(pos ? arr.columns[pos[0]] : (arr.columns[0] ?? null))
          return
        case 'Escape':
          setSelectedCardID(null)
          return
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [board.id, selectedCardID, cardsByID, store])

  // MARK: 工具栏菜单

  async function openFilterMenu() {
    const choice = await showMenu(
      [
        ...(board.labels.length > 0
          ? [
              { label: t('标签（满足任意一个）'), enabled: false },
              ...board.labels.map((l) => ({ id: `label:${l.id}`, label: labelDisplayName(l), type: 'checkbox' as const, checked: filter.labelIDs.includes(l.id) })),
              { type: 'separator' as const }
            ]
          : []),
        { label: t('状态'), enabled: false },
        ...(['all', 'open', 'done'] as StatusFilter[]).map((s) => ({ id: `status:${s}`, label: statusTitle(s), type: 'radio' as const, checked: filter.status === s })),
        { type: 'separator' },
        { label: t('截止日期'), enabled: false },
        ...(['any', 'overdue', 'today', 'week', 'none'] as DueFilter[]).map((d) => ({ id: `due:${d}`, label: dueTitle(d), type: 'radio' as const, checked: filter.due === d })),
        { type: 'separator' },
        { id: 'clear', label: t('清除筛选'), enabled: filterIsActive(filter) }
      ],
      filterRef.current
    )
    if (!choice) return
    if (choice === 'clear') setFilter(EMPTY_FILTER)
    else if (choice.startsWith('label:')) {
      const id = choice.slice(6)
      setFilter((f) => ({ ...f, labelIDs: f.labelIDs.includes(id) ? f.labelIDs.filter((x) => x !== id) : [...f.labelIDs, id] }))
    } else if (choice.startsWith('status:')) setFilter((f) => ({ ...f, status: choice.slice(7) as StatusFilter }))
    else if (choice.startsWith('due:')) setFilter((f) => ({ ...f, due: choice.slice(4) as DueFilter }))
  }

  async function openSettingsMenu() {
    const options: [number | undefined, string][] = [
      [undefined, t('关闭')],
      [1, t('完成 1 天后')],
      [3, t('完成 3 天后')],
      [7, t('完成 7 天后')],
      [30, t('完成 30 天后')]
    ]
    const choice = await showMenu(
      [
        { label: t('自动归档已完成的卡片'), enabled: false },
        ...options.map(([days, title]) => ({ id: `auto:${days ?? 'off'}`, label: title, type: 'radio' as const, checked: board.autoArchiveDays === days })),
        { type: 'separator' },
        { id: 'rename', label: t('重命名…') },
        { id: 'export', label: t('导出看板…') }
      ],
      settingsRef.current
    )
    if (!choice) return
    if (choice === 'export') void exportBoard(board.id)
    else if (choice === 'rename') setRenamingTitle(true)
    else if (choice.startsWith('auto:')) {
      const v = choice.slice(5)
      store.setAutoArchive(board.id, v === 'off' ? undefined : Number(v))
    }
  }

  // MARK: 渲染

  const archivedCount = board.cards.filter((c) => c.isArchived).length
  const shownCount = arrangement.columns.reduce((n, c) => n + (arrangement.cards[c]?.length ?? 0), 0)
  const totalCount = board.cards.filter((c) => !c.isArchived).length
  const columnsByID = new Map(board.columns.map((c) => [c.id, c]))
  const activeCard = activeID?.startsWith(CARD_PREFIX) ? cardsByID.get(activeID.slice(CARD_PREFIX.length)) : undefined
  const activeColumn = activeID?.startsWith(COLUMN_PREFIX) ? columnsByID.get(activeID.slice(COLUMN_PREFIX.length)) : undefined
  const targetColumn = activeCard ? columnOf(arrangement, activeCard.id) : undefined
  const fg = prefersDarkText(board.background) ? 'rgba(0,0,0,0.85)' : '#fff'
  const boardStyle = { background: rgbaToCss(board.background), ['--board-fg' as string]: fg } as CSSProperties

  return (
    <div className="board" style={boardStyle}>
      <div className="toolbar titlebar-drag">
        {renamingTitle ? (
          <div className="no-drag toolbar-title-edit">
            <InlineInput
              initial={board.name}
              placeholder={t('看板名称')}
              onCommit={(name) => {
                store.renameBoard(board.id, name)
                setRenamingTitle(false)
              }}
              onCancel={() => setRenamingTitle(false)}
            />
          </div>
        ) : (
          <h1 className="toolbar-title" onDoubleClick={() => setRenamingTitle(true)} title={t('双击重命名')}>
            {board.name}
          </h1>
        )}
        <span className="spacer" />
        <div className="toolbar-actions no-drag">
          <div className="search-field">
            <Icon name="search" size={14} />
            <input
              ref={searchRef}
              value={search}
              placeholder={t('搜索卡片')}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearch('')
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
            />
          </div>
          <button ref={filterRef} className={`toolbar-button ${filterIsActive(filter) ? 'active' : ''}`} onClick={() => void openFilterMenu()} title={t('按标签、状态或截止日期筛选卡片')}>
            <Icon name="filter" />
            {filterIsActive(filter) ? t('筛选 (%lld)', filterActiveCount(filter)) : t('筛选')}
          </button>
          <button ref={settingsRef} className="toolbar-button icon-only" onClick={() => void openSettingsMenu()} title={board.autoArchiveDays !== undefined ? t('已开启自动归档：完成 %lld 天后', board.autoArchiveDays) : t('看板设置')}>
            <Icon name="gear" />
            {board.autoArchiveDays !== undefined && <span className="dot" />}
          </button>
          <button ref={backgroundRef} className="toolbar-button icon-only" onClick={() => setShowBackground((v) => !v)} title={t('背景颜色')}>
            <Icon name="palette" />
          </button>
          <button className="toolbar-button" onClick={() => ui.openDialog({ kind: 'archive', boardID: board.id })} title={t('查看已归档的卡片')}>
            <Icon name="archive" />
            {archivedCount > 0 ? t('归档 (%lld)', archivedCount) : t('归档')}
          </button>
        </div>
        {showBackground && (
          <Popover anchor={backgroundRef} onClose={() => setShowBackground(false)} width={292} align="end">
            <div className="popover-title">{t('看板背景')}</div>
            <ColorPicker value={board.background} allowsNone={false} onChange={(c) => c && store.setBackground(board.id, c)} />
          </Popover>
        )}
      </div>

      {(filterIsActive(filter) || query) && (
        <div className="filter-bar">
          <Icon name="filter" />
          <strong>{t('显示 %lld / %lld 张卡片', shownCount, totalCount)}</strong>
          {board.labels.filter((l) => filter.labelIDs.includes(l.id)).map((l) => (
            <LabelPill key={l.id} label={l} />
          ))}
          {filter.status !== 'all' && <span className="chip">{statusTitle(filter.status)}</span>}
          {filter.due !== 'any' && <span className="chip">{dueTitle(filter.due)}</span>}
          {query && <span className="chip">{t('搜索：%@', query)}</span>}
          <span className="spacer" />
          <button
            className="link-button"
            onClick={() => {
              setFilter(EMPTY_FILTER)
              setSearch('')
            }}
          >
            {t('清除')}
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        autoScroll={{ threshold: { x: 0.1, y: 0.15 }, acceleration: 12 }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="board-scroll">
          <div className="columns">
            <SortableContext items={arrangement.columns.map(columnKey)} strategy={horizontalListSortingStrategy}>
              {arrangement.columns.map((columnID, index) => {
                const column = columnsByID.get(columnID)
                if (!column) return null
                const cards = (arrangement.cards[columnID] ?? []).map((id) => cardsByID.get(id)).filter((c): c is Card => c !== undefined)
                return (
                  <Column
                    key={columnID}
                    board={board}
                    column={column}
                    cards={cards}
                    index={index}
                    selectedCardID={selectedCardID}
                    isCardDropTarget={targetColumn === columnID}
                    addRequest={addRequest === columnID}
                    onAddRequestHandled={clearAddRequest}
                    onOpenCard={openCardFromClick}
                    onHoverCard={hoverCard}
                  />
                )
              })}
            </SortableContext>
            <AddColumn board={board} />
          </div>
        </div>
        <DragOverlay dropAnimation={dropAnimation}>
          {activeCard ? (
            <div className="drag-lift card">
              <CardFace card={activeCard} labels={labelsOf(board, activeCard)} />
            </div>
          ) : activeColumn ? (
            <div className="drag-lift column-lift">
              <ColumnFace
                board={board}
                column={activeColumn}
                cards={(arrangement.cards[activeColumn.id] ?? []).map((id) => cardsByID.get(id)).filter((c): c is Card => c !== undefined)}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
})

export function statusTitle(s: StatusFilter): string {
  return s === 'all' ? t('全部') : s === 'open' ? t('未完成') : t('已完成')
}

export function dueTitle(d: DueFilter): string {
  switch (d) {
    case 'any':
      return t('不限')
    case 'overdue':
      return t('已过期')
    case 'today':
      return t('今天到期')
    case 'week':
      return t('7 天内到期')
    case 'none':
      return t('没有截止日期')
  }
}

function AddColumn({ board }: { board: Board }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (adding) ref.current?.focus()
  }, [adding])
  const commit = () => {
    getStore().addColumn(board.id, name)
    setName('')
    ref.current?.focus()
  }
  if (!adding) {
    return (
      <button className="add-column-button" onClick={() => setAdding(true)}>
        <Icon name="plus" />
        {t('添加列表')}
      </button>
    )
  }
  return (
    <div className="add-column-form">
      <input
        ref={ref}
        className="text-field"
        value={name}
        placeholder={t('输入列表名称')}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            e.preventDefault()
            setAdding(false)
          }
        }}
      />
      <div className="form-buttons">
        <button className="button primary" onClick={commit}>
          {t('添加列表')}
        </button>
        <button className="button" onClick={() => setAdding(false)}>
          {t('取消')}
        </button>
      </div>
    </div>
  )
}

