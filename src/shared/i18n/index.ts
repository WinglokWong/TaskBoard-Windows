// 界面文字的本地化。
//
// 与 macOS 版相同：以简体中文源文字作为键，英文和繁体中文的翻译来自
//   mac.json      —— 由 scripts/import-mac-strings.mjs 从 macOS 版的字符串目录导入（两个版本共用）
//   windows.json  —— Windows 版特有的文字
// 占位符沿用 macOS 的写法：%@（文字）、%lld（数字），也支持带序号的 %1$@ / %2$lld。
import macStrings from './mac.json' with { type: 'json' }
import windowsStrings from './windows.json' with { type: 'json' }

export type Language = 'en' | 'zh-Hans' | 'zh-Hant'
export type LanguageSetting = Language | 'system'

type PluralForms = { one?: string; other: string }
type Entry = { en?: string | PluralForms; 'zh-Hant'?: string | PluralForms }

const table: Record<string, Entry> = { ...(macStrings as Record<string, Entry>), ...(windowsStrings as Record<string, Entry>) }

let current: Language = 'zh-Hans'

export function setLanguage(language: Language): void {
  current = language
}

export function getLanguage(): Language {
  return current
}

/** 由系统的首选语言列表（例如 ["zh-Hant-TW", "en-US"]）推断界面语言；不支持的语言使用英文 */
export function detectLanguage(preferred: readonly string[]): Language {
  for (const raw of preferred) {
    const code = raw.toLowerCase()
    if (code.startsWith('zh')) {
      if (code.includes('hant') || /-(tw|hk|mo)\b/.test(code)) return 'zh-Hant'
      return 'zh-Hans'
    }
    if (code.startsWith('en')) return 'en'
  }
  return 'en'
}

export function resolveLanguage(setting: LanguageSetting, preferred: readonly string[]): Language {
  return setting === 'system' ? detectLanguage(preferred) : setting
}

/** BCP 47 语言代码，用于日期格式 */
export function localeTag(language: Language = current): string {
  return language === 'en' ? 'en' : language === 'zh-Hant' ? 'zh-Hant' : 'zh-Hans'
}

function pick(value: string | PluralForms | undefined, args: readonly unknown[]): string | undefined {
  if (value === undefined || typeof value === 'string') return value
  const count = args.find((a) => typeof a === 'number')
  return count === 1 && value.one !== undefined ? value.one : value.other
}

/** 按 macOS 的格式说明符填入参数 */
export function format(template: string, args: readonly unknown[]): string {
  let next = 0
  return template.replace(/%(?:(\d+)\$)?(@|lld|ld|d)/g, (_, position: string | undefined) => {
    const index = position ? Number(position) - 1 : next++
    const value = args[index]
    return value === undefined || value === null ? '' : String(value)
  })
}

/** 翻译：key 为简体中文源文字 */
export function t(key: string, ...args: unknown[]): string {
  const template = current === 'zh-Hans' ? key : (pick(table[key]?.[current], args) ?? key)
  return args.length > 0 ? format(template, args) : template
}

/** 所有已知的键（用于检查是否有遗漏的翻译） */
export function knownKeys(): Set<string> {
  return new Set(Object.keys(table))
}
