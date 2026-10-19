// 卡片详情：标题、所在列表、完成、标签、截止日期与提醒、描述（Markdown）、清单、颜色、附件。
// 修改实时保存；关闭窗口时整次编辑合并为一个撤销步骤（与 macOS 版一致）。
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { coverImage, isImageFile, isoDate, labelsOf, newID, parseDate, type Attachment, type Card } from '../../shared/model.ts'
import { t } from '../../shared/i18n/index.ts'
import { getStore, useData } from '../store.ts'
import { formatDateTime, ui } from '../ui.ts'
import { confirmDeleteCard, previewAttachments } from '../actions.ts'
import { cardColors, DueBadge, LabelPill } from './CardFace.tsx'
import { ColorPicker } from './ColorPicker.tsx'
import { Icon } from './Icon.tsx'
import { LabelPicker } from './LabelPicker.tsx'
import { Markdown } from './Markdown.tsx'
import { Modal, Popover, showMenu } from './common.tsx'

export const REMINDER_OPTIONS: [number | undefined, string][] = [
  [undefined, '不提醒'],
  [0, '到期时'],
  [15, '提前 15 分钟'],
  [60, '提前 1 小时'],
  [24 * 60, '提前 1 天']
]

/** ISO 时间 ↔ <input type="datetime-local"> 的本地时间 */
function toLocalInput(iso: string | undefined): string {
  const d = parseDate(iso)
  if (!d) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : isoDate(d)
}

export function CardEditor({ boardID, cardID }: { boardID: string; cardID: string }) {
  const board = useData((d) => d.boards.find((b) => b.id === boardID))
  const initial = useRef(getStore().card(boardID, cardID))
  const [draft, setDraft] = useState<Card | undefined>(initial.current)
  const [editingDescription, setEditingDescription] = useState(!initial.current?.details)
  const [showLabels, setShowLabels] = useState(false)
  const [newItem, setNewItem] = useState('')
  const [dropTarget, setDropTarget] = useState(false)
  const labelsRef = useRef<HTMLButtonElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const newItemRef = useRef<HTMLInputElement>(null)
  const closing = useRef(false)

  // 关闭时把整次编辑合并为一个撤销步骤
  useEffect(() => {
    const original = initial.current
    return () => {
      if (original) getStore().registerCardEdit(original, boardID)
    }
  }, [boardID])

  if (!board || !draft) return null

  function update(next: Card) {
    setDraft(next)
    getStore().saveCard(boardID, next)
  }

  function close() {
    closing.current = true
    ui.closeDialog()
  }

  async function addFiles(promise: Promise<Attachment[]>) {
    const added = await promise
    if (added.length > 0) {
      setDraft((d) => {
        if (!d) return d
        const next = { ...d, attachments: [...d.attachments, ...added] }
        getStore().saveCard(boardID, next)
        return next
      })
    }
  }

  async function pasteImage(blob: Blob) {
    const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
    const stamp = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const name = `${t('粘贴的图片 %@', `${stamp.getFullYear()}${p(stamp.getMonth() + 1)}${p(stamp.getDate())}-${p(stamp.getHours())}${p(stamp.getMinutes())}${p(stamp.getSeconds())}`)}.${ext}`
    const attachment = await window.taskboard.importImageData(new Uint8Array(await blob.arrayBuffer()), ext, name)
    if (attachment) await addFiles(Promise.resolve([attachment]))
  }

  async function pasteFromClipboard() {
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const type = item.types.find((x) => x.startsWith('image/'))
        if (type) {
          await pasteImage(await item.getType(type))
          return
        }
      }
    } catch {
      /* 没有可用的图片 */
    }
    ui.toast(t('剪贴板中没有图片'))
  }

  function onPaste(e: ClipboardEvent) {
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
    const file = [...e.clipboardData.items].find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile()
    if (file) {
      e.preventDefault()
      void pasteImage(file)
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDropTarget(false)
    const paths = [...e.dataTransfer.files].map((f) => window.taskboard.pathForFile(f)).filter(Boolean)
    if (paths.length > 0) void addFiles(window.taskboard.importAttachmentPaths(paths))
  }

  async function attachmentMenu(attachment: Attachment) {
    const isCover = coverImage(draft!)?.id === attachment.id
    const choice = await showMenu([
      { id: 'preview', label: t('快速查看') },
      { id: 'open', label: t('用默认应用打开') },
      { id: 'reveal', label: t('在资源管理器中显示') },
      ...(isImageFile(attachment.fileName) && !isCover ? [{ id: 'cover', label: t('设为封面') }] : []),
      { type: 'separator' as const },
      { id: 'delete', label: t('删除附件') }
    ])
    if (choice === 'preview') previewAttachments(draft!, attachment.fileName)
    else if (choice === 'open') void window.taskboard.openAttachment(attachment.fileName)
    else if (choice === 'reveal') void window.taskboard.revealAttachment(attachment.fileName)
    else if (choice === 'cover') update({ ...draft!, attachments: [attachment, ...draft!.attachments.filter((a) => a.id !== attachment.id)] })
    else if (choice === 'delete') update({ ...draft!, attachments: draft!.attachments.filter((a) => a.id !== attachment.id) })
  }

  function addChecklistItem() {
    const text = newItem.trim()
    if (!text) return
    update({ ...draft!, checklist: [...draft!.checklist, { id: newID(), text, isDone: false }] })
    setNewItem('')
    newItemRef.current?.focus()
  }

  const due = parseDate(draft.dueDate)
  const labels = labelsOf(board, draft)
  const doneCount = draft.checklist.filter((i) => i.isDone).length
  const cover = coverImage(draft)

  const footer = (
    <>
      {draft.isArchived ? (
        <button
          className="button"
          onClick={() => {
            close()
            getStore().restoreCard(boardID, draft.id)
          }}
        >
          <Icon name="undo" size={14} />
          {t('从归档恢复')}
        </button>
      ) : (
        <button
          className="button"
          onClick={() => {
            update({ ...draft, isArchived: true, archivedAt: isoDate() })
            close()
          }}
        >
          <Icon name="archive" size={14} />
          {t('归档')}
        </button>
      )}
      <button
        className="button danger"
        onClick={async () => {
          const before = getStore().card(boardID, draft.id)
          await confirmDeleteCard(boardID, draft)
          if (before && !getStore().card(boardID, draft.id)) close()
        }}
      >
        <Icon name="trash" size={14} />
        {t('删除')}
      </button>
      <span className="spacer" />
      <button className="button primary" onClick={close}>
        {t('完成')}
      </button>
    </>
  )

  return (
    <Modal onClose={close} footer={footer} width={640} className="card-editor">
      <div className="card-editor-strip" style={draft.color ? cardColors(draft) : undefined} />
      <div className="card-editor-content" onPaste={onPaste}>
        <div className="editor-title-row">
          <button
            className={`done-toggle large ${draft.isDone ? 'checked' : ''}`}
            onClick={() => update({ ...draft, isDone: !draft.isDone })}
            title={draft.isDone ? t('标记为未完成') : t('标记为已完成')}
          >
            <Icon name={draft.isDone ? 'checkCircle' : 'circle'} size={24} />
          </button>
          <textarea
            className={`title-input ${draft.isDone ? 'done' : ''}`}
            value={draft.title}
            rows={1}
            placeholder={t('卡片标题')}
            onChange={(e) => update({ ...draft, title: e.target.value.replace(/\n/g, ' ') })}
            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          />
        </div>

        <div className="editor-status-row">
          <label className="field-inline">
            {t('所在列表')}
            <select
              className="select"
              value={draft.columnID ?? ''}
              disabled={draft.isArchived}
              onChange={(e) => update({ ...draft, columnID: e.target.value })}
            >
              {board.columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={draft.isDone} onChange={(e) => update({ ...draft, isDone: e.target.checked })} />
            {t('已完成')}
          </label>
          <span className="spacer" />
          {draft.isArchived && (
            <span className="archived-flag">
              <Icon name="archive" size={14} />
              {t('已归档')}
            </span>
          )}
          <span className="muted small">{t('创建于 %@', formatDateTime(parseDate(draft.createdAt) ?? new Date()))}</span>
        </div>

        <section className="editor-section">
          <h3>
            <Icon name="tag" size={15} />
            {t('标签')}
          </h3>
          <div className="editor-labels">
            {labels.map((l) => (
              <LabelPill key={l.id} label={l} />
            ))}
            <button ref={labelsRef} className="button small" onClick={() => setShowLabels((v) => !v)}>
              <Icon name={labels.length === 0 ? 'plus' : 'edit'} size={13} />
              {labels.length === 0 ? t('添加标签') : t('编辑')}
            </button>
            {showLabels && (
              <Popover anchor={labelsRef} onClose={() => setShowLabels(false)} width={320}>
                <LabelPicker board={board} selection={draft.labelIDs} onChange={(ids) => update({ ...draft, labelIDs: ids })} />
              </Popover>
            )}
          </div>
        </section>

        <section className="editor-section">
          <h3>
            <Icon name="calendar" size={15} />
            {t('截止日期')}
          </h3>
          {due ? (
            <div className="due-row">
              <input
                type="datetime-local"
                className="text-field"
                value={toLocalInput(draft.dueDate)}
                onChange={(e) => {
                  const value = fromLocalInput(e.target.value)
                  if (value) update({ ...draft, dueDate: value })
                }}
              />
              <label className="field-inline">
                {t('提醒')}
                <select
                  className="select"
                  value={draft.reminderMinutes ?? 'none'}
                  onChange={(e) => {
                    const next = { ...draft }
                    if (e.target.value === 'none') delete next.reminderMinutes
                    else next.reminderMinutes = Number(e.target.value)
                    update(next)
                  }}
                >
                  {REMINDER_OPTIONS.map(([minutes, title]) => (
                    <option key={title} value={minutes ?? 'none'}>
                      {t(title)}
                    </option>
                  ))}
                </select>
              </label>
              <DueBadge due={due} done={draft.isDone} reminder={draft.reminderMinutes !== undefined} />
              <span className="spacer" />
              <button
                className="button small"
                onClick={() => {
                  const next = { ...draft }
                  delete next.dueDate
                  delete next.reminderMinutes
                  update(next)
                }}
              >
                {t('移除')}
              </button>
            </div>
          ) : (
            <button
              className="button small"
              onClick={() => {
                const prefs = ui.state.prefs
                const tomorrow = new Date()
                tomorrow.setDate(tomorrow.getDate() + 1)
                tomorrow.setHours(Math.floor(prefs.defaultDueMinutes / 60), prefs.defaultDueMinutes % 60, 0, 0)
                const next: Card = { ...draft, dueDate: isoDate(tomorrow) }
                if (prefs.defaultReminderMinutes >= 0) next.reminderMinutes = prefs.defaultReminderMinutes
                update(next)
              }}
            >
              <Icon name="plus" size={13} />
              {t('添加截止日期')}
            </button>
          )}
        </section>

        <section className="editor-section">
          <h3>
            <Icon name="textLines" size={15} />
            {t('描述')}
            <span className="spacer" />
            {editingDescription ? (
              <>
                <span className="muted small" title={t('# 标题、- 列表、- [ ] 任务、**粗体**、*斜体*、`代码`、[链接](https://…)、> 引用、``` 代码块')}>
                  {t('支持 Markdown')}
                </span>
                {draft.details && (
                  <button className="button small" onClick={() => setEditingDescription(false)}>
                    {t('完成')}
                  </button>
                )}
              </>
            ) : (
              <button
                className="button small"
                onClick={() => {
                  setEditingDescription(true)
                  setTimeout(() => descriptionRef.current?.focus(), 0)
                }}
              >
                {t('编辑')}
              </button>
            )}
          </h3>
          {editingDescription ? (
            <textarea
              ref={descriptionRef}
              className="text-area"
              value={draft.details}
              rows={6}
              onChange={(e) => update({ ...draft, details: e.target.value })}
            />
          ) : (
            <div className="markdown-box" title={t('双击编辑')}>
              <Markdown text={draft.details} onDoubleClick={() => setEditingDescription(true)} />
            </div>
          )}
        </section>

        <section className="editor-section">
          <h3>
            <Icon name="checklist" size={15} />
            {t('清单')}
          </h3>
          {draft.checklist.length > 0 && (
            <div className="progress-row">
              <div className="progress">
                <div className={`progress-fill ${doneCount === draft.checklist.length ? 'complete' : ''}`} style={{ width: `${(doneCount / draft.checklist.length) * 100}%` }} />
              </div>
              <span className="muted small">
                {doneCount}/{draft.checklist.length}
              </span>
            </div>
          )}
          {draft.checklist.map((item) => (
            <div key={item.id} className="checklist-row">
              <input
                type="checkbox"
                checked={item.isDone}
                onChange={(e) => update({ ...draft, checklist: draft.checklist.map((i) => (i.id === item.id ? { ...i, isDone: e.target.checked } : i)) })}
              />
              <input
                className={`checklist-text ${item.isDone ? 'done' : ''}`}
                value={item.text}
                placeholder={t('清单项')}
                onChange={(e) => update({ ...draft, checklist: draft.checklist.map((i) => (i.id === item.id ? { ...i, text: e.target.value } : i)) })}
              />
              <button
                className="icon-button reveal-on-hover"
                title={t('删除清单项')}
                onClick={() => update({ ...draft, checklist: draft.checklist.filter((i) => i.id !== item.id) })}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
          <div className="checklist-add">
            <input
              ref={newItemRef}
              className="text-field"
              value={newItem}
              placeholder={t('添加清单项，回车确认')}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addChecklistItem()}
            />
            <button className="button" disabled={!newItem.trim()} onClick={addChecklistItem}>
              {t('添加')}
            </button>
          </div>
        </section>

        <section className="editor-section">
          <h3>
            <Icon name="palette" size={15} />
            {t('卡片颜色')}
          </h3>
          <ColorPicker value={draft.color} onChange={(c) => {
            const next = { ...draft }
            if (c) next.color = c
            else delete next.color
            update(next)
          }} />
        </section>

        <section
          className={`editor-section attachments-section ${dropTarget ? 'drop-target' : ''}`}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault()
              setDropTarget(true)
            }
          }}
          onDragLeave={() => setDropTarget(false)}
          onDrop={onDrop}
        >
          <h3>
            <Icon name="paperclip" size={15} />
            {t('附件')}
            <span className="spacer" />
            <span className="muted small">{t('也可以把文件拖到这里')}</span>
          </h3>
          <div className="attachment-buttons">
            <button className="button small" onClick={() => void addFiles(window.taskboard.pickAttachments())}>
              <Icon name="plus" size={13} />
              {t('添加文件…')}
            </button>
            <button className="button small" onClick={() => void pasteFromClipboard()}>
              <Icon name="image" size={13} />
              {t('粘贴图片')}
            </button>
          </div>
          {draft.attachments.length === 0 ? (
            <div className="attachments-empty">{t('暂无附件')}</div>
          ) : (
            <div className="attachment-grid">
              {draft.attachments.map((a) => (
                <button
                  key={a.id}
                  className="attachment-tile"
                  title={t('点击快速查看：%@', a.originalName)}
                  onClick={() => previewAttachments(draft, a.fileName)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    void attachmentMenu(a)
                  }}
                >
                  <span className="attachment-thumb">
                    {isImageFile(a.fileName) ? (
                      <img src={window.taskboard.attachmentURL(a.fileName)} alt="" loading="lazy" />
                    ) : (
                      <Icon name="file" size={30} />
                    )}
                    {cover?.id === a.id && <span className="cover-flag">{t('封面')}</span>}
                    <span
                      className="attachment-remove"
                      role="button"
                      title={t('删除附件')}
                      onClick={(e) => {
                        e.stopPropagation()
                        update({ ...draft, attachments: draft.attachments.filter((x) => x.id !== a.id) })
                      }}
                    >
                      <Icon name="close" size={12} />
                    </span>
                  </span>
                  <span className="attachment-name">{a.originalName}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </Modal>
  )
}
