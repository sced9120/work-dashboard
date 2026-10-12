// shared/catalog.ts 규칙 시험 — 받은 글을 어떻게 거르는지
const fs = require('fs')
const path = require('path')
const ts = require(path.join(__dirname, '../node_modules/typescript'))
const src = fs.readFileSync(path.join(__dirname, '../shared/catalog.ts'), 'utf8')
const code = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const mod = { exports: {} }
new Function('module', 'exports', 'require', code)(mod, mod.exports, require)
const { sanitizeCatalog, isNewTool, THEME_VARS, fillFeedback } = mod.exports

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

const good = { id: 'setuk', name: '세특 도우미', desc: '설명', icon: '✍️', url: 'https://example.com/a?b=1', category: '학생부', tags: ['세특'], added: '2026-10-01' }
const r = sanitizeCatalog({
  schema: 1,
  tools: [
    good,
    { ...good, id: 'setuk' },
    { ...good, id: 'http-one', url: 'http://example.com' },
    { ...good, id: 'js', url: 'javascript:alert(1)' },
    { ...good, id: 'file', url: 'file:///C:/a.exe' },
    { ...good, id: 'cred', url: 'https://user:pw@example.com' },
    { ...good, id: 'Bad ID' },
    { ...good, id: 'noname', name: '  ' },
    { ...good, id: 'longicon', icon: '아주긴글자아이콘' },
    'not an object'
  ],
  themes: [
    { id: 'forest', name: '숲', base: 'bento', light: { '--bg': '#dfe5df', accent: '#2f5d46', '--app-bg': 'linear-gradient(160deg, #c3cce6, #93a2c8)', '--shadow': '0 1px 2px rgba(0, 0, 0, 0.05)' }, dark: {} },
    { id: 'evil', name: '나쁜', base: 'glass', light: { '--bg': 'url(https://x.example/a.png)', '--surface': 'red;background:url(x)', '--side-w': '900px', '--text': '"a"', '--muted': 'image-set(x)', '--accent': '#123456' } },
    { id: 'nobase', name: '모양없음', base: 'neon', light: { '--bg': '#000' } },
    { id: 'empty', name: '빈', base: 'classic', light: { '--bg': 'url(x)' } }
  ]
})
const ids = r.catalog.tools.map((t) => t.id)
ok(ids.join(',') === 'setuk,longicon', `쓸 수 있는 도구만: ${ids.join(',')}`)
ok(r.catalog.tools[1].icon === '', '긴 아이콘 글자는 비움')
ok(r.catalog.tools[0].url === 'https://example.com/a?b=1', 'https 주소 그대로')
ok(r.dropped.some((d) => d.includes('겹칩니다')) && r.dropped.some((d) => d.includes('https://')), '겹친 id · https 아닌 주소는 까닭과 함께 뺌')
const th = r.catalog.themes
ok(th.map((t) => t.id).join(',') === 'forest,evil', `테마: ${th.map((t) => t.id).join(',')}`)
ok(th[0].light['--accent'] === '#2f5d46' && th[0].light['--app-bg'].startsWith('linear-gradient') && th[0].light['--shadow'].includes('rgba'), '-- 없이 적은 이름 · 그러데이션 · 그림자 값은 씀')
ok(JSON.stringify(th[1].light) === JSON.stringify({ '--accent': '#123456' }), `주소 · ; · 따옴표 · image · 배치 토큰은 뺌: ${JSON.stringify(th[1].light)}`)
ok(r.dropped.some((d) => d.includes('bento · glass · classic · midnight · lavender')) && r.dropped.some((d) => d.includes('바꿀 색이 하나도')), '모양이 틀리거나 색이 하나도 없으면 뺌')
ok(sanitizeCatalog([]).catalog.tools.length === 0 && sanitizeCatalog(null).dropped.length === 1, '묶음이 아니면 빈 목록')
ok(sanitizeCatalog({ schema: 2, tools: [good] }).dropped[0].includes('schema 2') && sanitizeCatalog({ schema: 2, tools: [good] }).catalog.tools.length === 1, '모르는 schema 여도 아는 칸은 씀')
ok(isNewTool({ added: '2026-10-01' }, '2026-10-08') && !isNewTool({ added: '2026-08-01' }, '2026-10-08') && !isNewTool({ added: '' }, '2026-10-08') && !isNewTool({ added: '2026-10-20' }, '2026-10-08'), '30일 안만 새로')
const many = sanitizeCatalog({ tools: Array.from({ length: 205 }, (_, i) => ({ ...good, id: `t${i}` })) })
ok(many.catalog.tools.length === 200 && many.dropped.some((d) => d.includes('200개')), '도구는 200개까지')

// themes.css 에 실제로 있는 토큰만 허용하는지
const css = fs.readFileSync(path.join(__dirname, '../src/themes.css'), 'utf8') + fs.readFileSync(path.join(__dirname, '../src/styles.css'), 'utf8')
const missing = THEME_VARS.filter((v) => !new RegExp(`${v.replace(/-/g, '\\-')}\\s*:`).test(css))
ok(missing.length === 0, `허용 토큰이 모두 CSS 에 정의돼 있음 ${missing.join(' ')}`)

// 의견 보내기 설문지
const fb = sanitizeCatalog({ feedback: { url: 'https://docs.google.com/forms/d/e/X/viewform?usp=pp_url&entry.1={version}&entry.2={os}' } }).catalog.feedback
ok(fillFeedback(fb, '3.2.1', 'Windows 10.0.26200') === 'https://docs.google.com/forms/d/e/X/viewform?usp=pp_url&entry.1=3.2.1&entry.2=Windows%2010.0.26200', `설문지 주소에 버전 채우기: ${fillFeedback(fb, '3.2.1', 'Windows 10.0.26200').slice(-46)}`)
ok(sanitizeCatalog({ feedback: 'https://forms.gle/abc' }).catalog.feedback === 'https://forms.gle/abc' && sanitizeCatalog({}).catalog.feedback === '', '주소 글자만 적어도 되고, 없으면 빈칸')
const badFb = sanitizeCatalog({ feedback: { url: 'http://example.com/form' } })
ok(badFb.catalog.feedback === '' && badFb.dropped.some((d) => d.includes('feedback')), 'https 가 아니면 빼고 알림')
ok(sanitizeCatalog({ themes: [{ id: 'n', name: '밤', base: 'midnight', dark: { '--accent': '#ff0000' } }] }).catalog.themes.length === 1, '새 모양(midnight)도 받은 테마의 바탕으로')

// 스캔 문서 → 엑셀(OCR) 지침 · 모델
const oc = sanitizeCatalog({ ocr: { prompt: '  새 지침\n둘째 줄  ', model: 'gemini-3.9-flash' } }).catalog.ocr
ok(oc.prompt === '새 지침\n둘째 줄' && oc.model === 'gemini-3.9-flash', 'OCR 지침(줄바꿈 그대로) · 모델')
const badOcr = sanitizeCatalog({ ocr: { model: 'gpt-5; rm -rf' } })
ok(badOcr.catalog.ocr.model === '' && badOcr.dropped.some((d) => d.includes('ocr.model')), 'gemini- 모델이 아니면 빼고 알림')
ok(sanitizeCatalog({}).catalog.ocr.prompt === '' && sanitizeCatalog({ ocr: 'x' }).catalog.ocr.model === '', 'OCR 칸이 없거나 틀려도 빈칸')

// 저장소의 실제 파일
const real = sanitizeCatalog(JSON.parse(fs.readFileSync(path.join(__dirname, '../remote/catalog.json'), 'utf8')))
ok(real.dropped.length === 0, `remote/catalog.json 이 규칙에 맞음 (도구 ${real.catalog.tools.length} · 테마 ${real.catalog.themes.length})`)

console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
process.exit(fails ? 1 : 0)
