// 列表：标题（双击重命名）、卡片、底部“添加卡片”。整个列表可以拖动排序（从卡片上开始拖动时拖的是卡片）。
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { labelsOf, prefersDarkText, rgbaToCss, type Board, type BoardColumn, type Card } from '../../shared/model.ts'
import { t } from '../../shared/i18n/index.ts'
import { getStore } from '../store.ts'
import { cardContextMenu, confirmDeleteColumn } from '../actions.ts'
import { CardFace } from './CardFace.tsx'
import { ColorPicker } from './ColorPicker.tsx'
import { Icon } from './Icon.tsx'
import { Popover, showMenu } from './common.tsx'

export const cardKey = (id: string) => `card:${id}`
export const columnKey = (id: string) => `col:${id}`

function columnStyle(column: BoardColumn): CSSProperties {
  if (!column.color) return {}
  const fg = prefersDarkText(column.color) ? 'rgba(0,0,0,0.85)' : '#fff'
  return { background: rgbaToCss(column.color), color: fg, ['--column-fg' as string]: fg }
}

// MARK: - 可拖动的卡片

const SortableCard = memo(function SortableCard({
  board,
  card,
  selected,
  onOpen,
  onHover
}: {
  board: Board
  card: Card
  selected: boolean
  onOpen: (card: Card) => void
  onHover: (cardID: string) => void
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: cardKey(card.id),
    data: { type: 'card' }
  })
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card ${isDragging ? 'placeholder' : ''}`}
      data-card-id={card.id}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={-1}
      onClick={() => onOpen(card)}
      onMouseEnter={() => onHover(card.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        void cardContextMenu(board, card)
      }}
    >
      <CardFace card={card} labels={labelsOf(board, card)} selected={selected} onToggleDone={() => getStore().toggleDone(board.id, card.id)} />
    </div>
  )
})

// MARK: - 列表

export const Column = memo(function Column({
  board,
  column,
  cards,
  index,
  selectedCardID,
  isCardDropTarget,
  addRequest,
  onAddRequestHandled,
  onOpenCard,
  onHoverCard
}: {
  board: Board
  column: BoardColumn
  cards: Card[]
  index: number
  selectedCardID: string | null
  isCardDropTarget: boolean
  addRequest: boolean
  onAddRequestHandled: () => void
  onOpenCard: (card: Card) => void
  onHoverCard: (cardID: string) => void
}) {
  const store = getStore()
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: columnKey(column.id),
    data: { type: 'column' }
  })
  const [renaming, setRenaming] = useState(false)
  const [adding, setAdding] = useState(false)
  const [showColor, setShowColor] = useState(false)
  const paletteRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (addRequest) {
      setAdding(true)
      onAddRequestHandled()
    }
  }, [addRequest, onAddRequestHandled])

  const style: CSSProperties = { ...columnStyle(column), transform: CSS.Translate.toString(transform), transition }

  async function openMenu() {
    const choice = await showMenu(
      [
        { id: 'rename', label: t('重命名') },
        { id: 'add', label: t('添加卡片') },
        { type: 'separator' },
        { id: 'left', label: t('向左移动'), enabled: index > 0 },
        { id: 'right', label: t('向右移动'), enabled: index < board.columns.length - 1 },
        { type: 'separator' },
        { id: 'archiveDone', label: t('归档本列已完成的卡片') },
        { id: 'archiveAll', label: t('归档本列全部卡片') },
        { type: 'separator' },
        { id: 'delete', label: t('删除列表…') }
      ],
      moreRef.current
    )
    if (choice === 'rename') setRenaming(true)
    else if (choice === 'add') setAdding(true)
    else if (choice === 'left') store.moveColumnBy(board.id, column.id, -1)
    else if (choice === 'right') store.moveColumnBy(board.id, column.id, 1)
    else if (choice === 'archiveDone') store.archiveCards(board.id, column.id, true)
    else if (choice === 'archiveAll') store.archiveCards(board.id, column.id, false)
    else if (choice === 'delete') await confirmDeleteColumn(board.id, column)
  }

  return (
    <section
      ref={setNodeRef}
      className={`column ${column.color ? 'colored' : ''} ${isDragging ? 'placeholder' : ''} ${isCardDropTarget ? 'drop-target' : ''}`}
      style={style}
      {...attributes}
      {...listeners}
      tabIndex={-1}
      aria-label={column.name}
    >
      <header className="column-header">
        <span className="grip" title={t('拖动调整列表顺序')}>
          <Icon name="grip" size={13} />
        </span>
        {renaming ? (
          <InlineInput
            initial={column.name}
            placeholder={t('列表名称')}
            onCommit={(name) => {
              store.renameColumn(board.id, column.id, name)
              setRenaming(false)
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <>
            <h2 className="column-title" title={t('双击重命名，拖动调整顺序')} onDoubleClick={() => setRenaming(true)}>
              {column.name}
            </h2>
            <span className="count-pill">{cards.length}</span>
          </>
        )}
        <span className="spacer" />
        <button ref={paletteRef} className="icon-button subtle" title={t('列表颜色')} onClick={() => setShowColor((v) => !v)}>
          <Icon name="palette" />
        </button>
        <button ref={moreRef} className="icon-button subtle" title={t('更多')} onClick={() => void openMenu()}>
          <Icon name="more" />
        </button>
        {showColor && (
          <Popover anchor={paletteRef} onClose={() => setShowColor(false)} width={292}>
            <div className="popover-title">{t('列表颜色')}</div>
            <ColorPicker value={column.color} onChange={(c) => store.setColumnColor(board.id, column.id, c)} />
          </Popover>
        )}
      </header>

      <div className="column-cards">
        <SortableContext items={cards.map((c) => cardKey(c.id))} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <SortableCard key={card.id} board={board} card={card} selected={card.id === selectedCardID} onOpen={onOpenCard} onHover={onHoverCard} />
          ))}
        </SortableContext>
      </div>

      <footer className="column-footer">
        {adding ? (
          <AddCardForm
            onAdd={(title) => store.addCard(board.id, column.id, title)}
            onClose={() => setAdding(false)}
          />
        ) : (
          <button className="add-card-button" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} />
            {t('添加卡片')}
          </button>
        )}
      </footer>
    </section>
  )
})

/** 拖动列表时跟随鼠标的副本：列表本来的样子（标题、卡片、底部） */
export function ColumnFace({ board, column, cards }: { board: Board; column: BoardColumn; cards: Card[] }) {
  return (
    <section className={`column face ${column.color ? 'colored' : ''}`} style={columnStyle(column)}>
      <header className="column-header">
        <span className="grip">
          <Icon name="grip" size={13} />
        </span>
        <h2 className="column-title">{column.name}</h2>
        <span className="count-pill">{cards.length}</span>
        <span className="spacer" />
        <span className="icon-button subtle">
          <Icon name="palette" />
        </span>
        <span className="icon-button subtle">
          <Icon name="more" />
        </span>
      </header>
      <div className="column-cards face-cards">
        {cards.map((card) => (
          <div className="card" key={card.id}>
            <CardFace card={card} labels={labelsOf(board, card)} />
          </div>
        ))}
      </div>
      <footer className="column-footer">
        <span className="add-card-button">
          <Icon name="plus" size={14} />
          {t('添加卡片')}
        </span>
      </footer>
    </section>
  )
}

// MARK: - 输入

export function InlineInput({
  initial,
  placeholder,
  onCommit,
  onCancel
}: {
  initial: string
  placeholder: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      className="text-field inline"
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(value)
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        }
      }}
    />
  )
}

function AddCardForm({ onAdd, onClose }: { onAdd: (title: string) => void; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const commit = () => {
    if (title.trim()) onAdd(title)
    setTitle('')
    ref.current?.focus()
  }
  return (
    <div className="add-card-form">
      <input
        ref={ref}
        className="text-field"
        value={title}
        placeholder={t('输入卡片标题，回车添加')}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}
        onBlur={() => !title.trim() && onClose()}
      />
      <div className="form-buttons">
        <button className="button primary" onMouseDown={(e) => e.preventDefault()} onClick={commit}>
          {t('添加卡片')}
        </button>
        <button className="icon-button" onMouseDown={(e) => e.preventDefault()} onClick={onClose} aria-label={t('取消')}>
          <Icon name="close" />
        </button>
      </div>
    </div>
  )
}
