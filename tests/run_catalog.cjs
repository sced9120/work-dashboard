// 도구 모음 목록 받기 (electron/main/catalog.ts) — 빌드된 앱의 IPC 로. 바깥 요청은 가로채 가짜로 답한다.
const path = require('path')
const fs = require('fs')
const { handlers, USER_DATA } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

const RAW = 'https://raw.githubusercontent.com/sced9120/work-dashboard/main/remote/catalog.json'
const CDN = 'https://cdn.jsdelivr.net/gh/sced9120/work-dashboard@main/remote/catalog.json'
const mode = { raw: '404', cdn: '404' }
const fetched = []
const body = (tools) => JSON.stringify({ schema: 1, tools, themes: [{ id: 'forest', name: '숲', base: 'bento', light: { '--accent': '#2f5d46', '--bg': 'url(https://evil.example/x.png)' } }] })
const tool = (id, url = `https://example.com/${id}`) => ({ id, name: `도구 ${id}`, url, added: '2026-10-08' })
global.fetch = async (url, opts) => {
  const u = String(url)
  fetched.push(u)
  const m = u === RAW ? mode.raw : u === CDN ? mode.cdn : 'other'
  if (m === 'other') throw new Error('예상 못 한 주소 ' + u)
  if (m === '404') return new Response('nope', { status: 404 })
  if (m === 'down') throw new TypeError('fetch failed')
  if (m === 'broken') return new Response('{ "tools": [ ,, ', { status: 200 })
  if (m === 'one') return new Response(body([tool('a')]), { status: 200 })
  if (m === 'two') return new Response(body([tool('a'), tool('b'), tool('bad', 'http://plain.example')]), { status: 200 })
  throw new Error('mode?')
}

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('catalog:get'); i++) await new Promise((r) => setTimeout(r, 50))
  const store = path.join(USER_DATA, 'catalog.json')
  const builtinN = JSON.parse(fs.readFileSync(path.join(__dirname, '../remote/catalog.json'), 'utf8')).tools.length

  console.log('1. 처음 · 인터넷이 안 될 때')
  let r = await call('catalog:get')
  ok(r.from === 'builtin' && r.fetchedAt === 0 && r.error && r.catalog.tools.length === builtinN, `설치파일에 든 목록 + 까닭: ${r.error}`)
  ok(fetched.includes(RAW) && fetched.includes(CDN), 'GitHub 이 안 되면 jsDelivr 도 물어봄')
  ok(!fs.existsSync(store), '못 받았으면 이 PC 에 적지 않음')

  console.log('\n2. 받기')
  mode.raw = 'one'
  fetched.length = 0
  r = await call('catalog:get')
  ok(r.from === 'net' && r.catalog.tools.length === 1 && fetched.length === 1 && fetched[0] === RAW, 'GitHub 에서 받음 (한 곳만)')
  ok(r.catalog.themes[0].light['--accent'] === '#2f5d46' && !('--bg' in r.catalog.themes[0].light), '받은 테마의 주소 값은 걸러 냄')
  ok(fs.existsSync(store) && JSON.parse(fs.readFileSync(store, 'utf8')).catalog.tools.length === 1, '이 PC 에 둠')

  console.log('\n3. 3시간 안에는 다시 받지 않음')
  mode.raw = 'two'
  fetched.length = 0
  r = await call('catalog:get')
  ok(r.from === 'cache' && r.catalog.tools.length === 1 && fetched.length === 0, '둔 것을 씀')
  const [a, b] = await Promise.all([call('catalog:get', true), call('catalog:get', true)])
  ok(a.from === 'net' && a.catalog.tools.map((t) => t.id).join() === 'a,b' && b === a && fetched.length === 1, '새로 받기 — 두 번 눌러도 한 번만 받음, http 주소 도구는 뺌')

  console.log('\n4. GitHub 이 막히면 jsDelivr')
  mode.raw = 'down'
  mode.cdn = 'one'
  fetched.length = 0
  r = await call('catalog:get', true)
  ok(r.from === 'net' && r.catalog.tools.length === 1 && fetched.join() === `${RAW},${CDN}`, 'jsDelivr 에서 받음')

  console.log('\n5. 깨진 파일을 받으면')
  mode.raw = 'broken'
  mode.cdn = 'broken'
  r = await call('catalog:get', true)
  ok(r.from === 'cache' && r.catalog.tools.length === 1 && r.error.includes('형식'), `마지막에 제대로 받은 것을 계속 씀: ${r.error}`)
  fs.writeFileSync(store, '{ 망가짐')
  r = await call('catalog:get', true)
  ok(r.from === 'builtin' && r.catalog.tools.length === builtinN, `PC 에 둔 것도 깨졌으면 설치파일 목록 (도구 ${builtinN}개)`)

  console.log('\n6. 인수인계 파일')
  mode.raw = 'two'
  await call('catalog:get', true)
  const out = path.join(USER_DATA, 'h.db')
  global.__it.next.save.push(out)
  ok((await call('data:export', true)).ok, '내보내기')
  ok(!fs.readFileSync(out).toString('utf8').includes('example.com/a'), '도구 목록은 인수인계 파일에 없음')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
