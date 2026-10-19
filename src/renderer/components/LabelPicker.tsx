// 选择 / 管理看板标签：勾选、新建、重命名、改颜色、删除
import { useState } from 'react'
import { isCloseColor, PALETTE, type Board } from '../../shared/model.ts'
import { t } from '../../shared/i18n/index.ts'
import { getStore } from '../store.ts'
import { LabelPill } from './CardFace.tsx'
import { ColorPicker } from './ColorPicker.tsx'
import { Icon } from './Icon.tsx'

export function LabelPicker({ board, selection, onChange }: { board: Board; selection: string[]; onChange: (ids: string[]) => void }) {
  const store = getStore()
  const [editing, setEditing] = useState<string | null>(null)

  async function remove(id: string) {
    const ok = await window.taskboard.confirm({
      message: t('删除这个标签吗？'),
      detail: t('标签会从这个看板的所有卡片上移除。'),
      confirmLabel: t('删除'),
      cancelLabel: t('取消'),
      destructive: true
    })
    if (!ok) return
    onChange(selection.filter((x) => x !== id))
    store.deleteLabel(board.id, id)
    setEditing(null)
  }

  return (
    <div className="label-picker">
      <div className="popover-title">{t('标签')}</div>
      {board.labels.length === 0 && <div className="muted">{t('这个看板还没有标签')}</div>}
      {board.labels.map((label) => (
        <div key={label.id} className="label-picker-item">
          <div className="label-picker-row">
            <label className="label-check">
              <input
                type="checkbox"
                checked={selection.includes(label.id)}
                onChange={() => onChange(selection.includes(label.id) ? selection.filter((x) => x !== label.id) : [...selection, label.id])}
              />
              <LabelPill label={label} expanded />
            </label>
            <button className="icon-button" title={t('编辑标签')} onClick={() => setEditing(editing === label.id ? null : label.id)}>
              <Icon name={editing === label.id ? 'chevronDown' : 'edit'} size={14} />
            </button>
          </div>
          {editing === label.id && (
            <div className="label-editor">
              <input
                className="text-field"
                value={label.name}
                placeholder={t('标签名称（可留空）')}
                onChange={(e) => store.renameLabel(board.id, label.id, e.target.value)}
              />
              <ColorPicker value={label.color} allowsNone={false} onChange={(c) => c && store.setLabelColor(board.id, label.id, c)} />
              <button className="button small danger" onClick={() => void remove(label.id)}>
                <Icon name="trash" size={14} />
                {t('删除标签')}
              </button>
            </div>
          )}
        </div>
      ))}
      <div className="divider" />
      <button
        className="button subtle"
        onClick={() => {
          const color = PALETTE.find((p) => !board.labels.some((l) => isCloseColor(l.color, p.value)))?.value ?? PALETTE[0].value
          setEditing(store.addLabel(board.id, color))
        }}
      >
        <Icon name="plus" size={14} />
        {t('新建标签')}
      </button>
    </div>
  )
}
