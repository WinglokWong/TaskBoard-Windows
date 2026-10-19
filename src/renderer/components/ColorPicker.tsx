// 预设色板（与 macOS 版相同的 24 种颜色）+ 自定义颜色
import { PALETTE, isCloseColor, rgbaFromCssHex, rgbaToCss, rgbaToHex, type RGBA } from '../../shared/model.ts'
import { t } from '../../shared/i18n/index.ts'
import { Icon } from './Icon.tsx'

export function ColorPicker({
  value,
  onChange,
  allowsNone = true
}: {
  value: RGBA | undefined
  onChange: (color: RGBA | undefined) => void
  allowsNone?: boolean
}) {
  return (
    <div className="color-picker">
      <div className="swatches">
        {PALETTE.map((p) => (
          <button
            key={p.key}
            className={`swatch ${isCloseColor(p.value, value) ? 'selected' : ''}`}
            style={{ background: rgbaToCss(p.value) }}
            title={t(p.name)}
            aria-label={t(p.name)}
            onClick={() => onChange(p.value)}
          />
        ))}
      </div>
      <div className="color-picker-row">
        {allowsNone && (
          <button className={`button small ${value === undefined ? 'selected' : ''}`} onClick={() => onChange(undefined)}>
            <Icon name={value === undefined ? 'checkCircle' : 'slash'} size={14} />
            {t('默认')}
          </button>
        )}
        <label className="custom-color">
          <input
            type="color"
            value={value ? rgbaToHex(value) : '#ffffff'}
            onChange={(e) => onChange(rgbaFromCssHex(e.target.value, value?.a ?? 1))}
          />
          {t('自定义颜色')}
        </label>
        {value && (
          <label className="opacity-control" title={t('不透明度')}>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={value.a}
              onChange={(e) => onChange({ ...value, a: Number(e.target.value) })}
            />
          </label>
        )}
      </div>
    </div>
  )
}
