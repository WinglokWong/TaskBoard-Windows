// 从 macOS 版的字符串目录（Localizable.xcstrings）导入英文和繁体中文翻译。
// 两个版本使用同一套简体中文源文字作为键，所以翻译可以直接复用。
// 用法：node scripts/import-mac-strings.mjs ../trello/Resources/Localizable.xcstrings
import { readFileSync, writeFileSync } from 'node:fs'

const [source] = process.argv.slice(2)
if (!source) {
  console.error('用法: node scripts/import-mac-strings.mjs <Localizable.xcstrings>')
  process.exit(1)
}
const catalog = JSON.parse(readFileSync(source, 'utf8'))

function value(localization) {
  if (!localization) return undefined
  if (localization.stringUnit) return localization.stringUnit.value
  const plural = localization.variations?.plural
  if (plural) {
    const forms = {}
    for (const [form, unit] of Object.entries(plural)) forms[form] = unit.stringUnit.value
    return forms
  }
  return undefined
}

const table = {}
for (const [key, entry] of Object.entries(catalog.strings)) {
  if (!key || entry.extractionState === 'stale') continue
  const en = value(entry.localizations?.en)
  const hant = value(entry.localizations?.['zh-Hant'])
  if (en === undefined && hant === undefined) continue
  table[key] = { en, 'zh-Hant': hant }
}
writeFileSync('src/shared/i18n/mac.json', JSON.stringify(table, null, 2) + '\n')
console.log(`imported ${Object.keys(table).length} strings`)
