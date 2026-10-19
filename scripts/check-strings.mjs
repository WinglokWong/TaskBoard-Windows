// 检查界面文字是否都有英文和繁体中文翻译：
// 找出源码中所有包含中文的字符串字面量（注释除外），报告 mac.json / windows.json 中都没有的键。
// 用法：node scripts/check-strings.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const known = new Set([
  ...Object.keys(JSON.parse(readFileSync('src/shared/i18n/mac.json', 'utf8'))),
  ...Object.keys(JSON.parse(readFileSync('src/shared/i18n/windows.json', 'utf8')))
])
// 不需要翻译的文字：语言名称以各自的语言显示；数据默认值（与 macOS 版相同，保存在数据中）
const ignored = new Set(['简体中文', '繁體中文', '未命名列表', '未命名看板', '代码'])

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

const missing = new Map()
for (const file of walk('src')) {
  if (file.endsWith('smoke.ts') || file.endsWith('mockApi.ts')) continue
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '')
    if (/^\s*(\*|\/\*)/.test(line)) return
    for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1).)*?[一-鿿](?:\\.|(?!\1).)*?)\1/g)) {
      const key = m[2].replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"')
      if (m[1] === '`' && key.includes('${')) continue
      if (!known.has(key) && !ignored.has(key)) missing.set(key, `${file}:${i + 1}`)
    }
  })
}
for (const [key, where] of missing) console.log(`MISSING  ${JSON.stringify(key)}  (${where})`)
console.log(`${missing.size} missing`)
process.exit(missing.size ? 1 : 0)
