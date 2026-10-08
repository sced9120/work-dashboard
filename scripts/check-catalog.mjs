// remote/catalog.json 검사 — 프로그램이 쓰는 규칙(shared/catalog.ts)을 그대로 돌려 본다.
// GitHub 에서 그 파일을 고치면 '타입 검사' 일이 이것을 돌려, 잘못 적힌 곳이 있으면 빨간 X 와 함께 까닭을 보여 준다.
//   node scripts/check-catalog.mjs
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = new URL('..', import.meta.url)

// shared/catalog.ts 는 다른 파일을 가져오지 않으므로 그대로 바꿔 돌릴 수 있다
const src = readFileSync(new URL('shared/catalog.ts', root), 'utf8')
const code = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const mod = { exports: {} }
new Function('module', 'exports', 'require', code)(mod, mod.exports, require)
const { sanitizeCatalog } = mod.exports

const text = readFileSync(new URL('remote/catalog.json', root), 'utf8')
let raw
try {
  raw = JSON.parse(text)
} catch (e) {
  console.error('✗ remote/catalog.json 이 JSON 형식이 아닙니다 (쉼표 · 따옴표 · 괄호를 확인해 주세요)')
  console.error('  ', e.message)
  process.exit(1)
}

const { catalog, dropped } = sanitizeCatalog(raw)
console.log(`도구 ${catalog.tools.length}개 · 받은 테마 ${catalog.themes.length}개`)
for (const t of catalog.tools) console.log(`  ✓ 도구 ${t.id} — ${t.name}`)
for (const t of catalog.themes) console.log(`  ✓ 테마 ${t.id} — ${t.name} (${t.base})`)
if (dropped.length) {
  console.error(`\n✗ 쓰지 못하는 곳 ${dropped.length}군데 (프로그램은 이것만 빼고 나머지를 씁니다):`)
  for (const d of dropped) console.error(`  - ${d}`)
  process.exit(1)
}
console.log('모두 맞습니다.')
