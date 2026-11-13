// 구글 설문지 응답 가져오기 (relay:form, 3.7.1~) — 빌드된 앱의 IPC 로. 우편함은 가짜로 답한다
const path = require('path')
const { handlers } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({ sender: { send: () => {} } }, ...args)
const log = []
let script = []
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
global.fetch = async (url) => {
  log.push(String(url))
  const step = script.shift()
  if (!step) throw new Error('예상 못 한 요청 ' + url)
  return step(String(url))
}
const q = (u) => Object.fromEntries(new URL(u).searchParams)
const SHEET = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit#gid=0'

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('relay:form'); i++) await new Promise((r) => setTimeout(r, 50))

  console.log('1. 이어지지 않았으면')
  let r = await call('relay:form', SHEET, 0)
  ok(!r.ok && r.needVer === 3 && /폰 연결/.test(r.error), r.error)

  await call('relay:newKey')
  script = [() => json({ ok: true, v: 2, n: 0 })]
  await call('relay:connect', 'https://script.google.com/macros/s/AKfycbTEST1234567890abcdefgh/exec')

  console.log('\n2. 예전 판(v2) 스크립트')
  script = [() => new Response('<html>폰 화면</html>', { status: 200 })]
  r = await call('relay:form', SHEET, 0)
  ok(!r.ok && r.needVer === 3 && /새 판/.test(r.error), `v2 는 새 판 안내: ${r.error}`)
  script = [() => json({ ok: true, v: 2, items: [] })]
  r = await call('relay:form', SHEET, 0)
  ok(!r.ok && r.needVer === 3, 'v2 가 답을 주어도 판을 보고 안내')

  console.log('\n3. v3 — 시트 ID 만 보내고, 많으면 이어 받기')
  const page = (n, from, more) => ({ ok: true, v: 3, title: '탐구 설문', head: ['타임스탬프', '학번', '이름', '주제'], rows: Array.from({ length: n }, (_, i) => ['t', '20301', 'x', 'r' + (from + i)]), times: Array.from({ length: n }, (_, i) => 1000 + from + i), last: 1000 + from + n - 1, more })
  script = [(u) => json(page(300, 0, true)), (u) => json(page(20, 300, false))]
  r = await call('relay:form', SHEET, 5)
  const p1 = q(log[log.length - 2])
  const p2 = q(log[log.length - 1])
  ok(r.ok && r.data.rows.length === 320 && r.data.last === 1319 && r.data.title === '탐구 설문' && r.data.more === false, `두 번에 나눠 받아 합침 (${r.data && r.data.rows.length}행)`)
  ok(p1.op === 'form' && p1.sheet === '1AbCdEfGhIjKlMnOpQrStUvWxYz012345' && p1.after === '5' && p2.after === '1299', '시트 ID · after 로 이어 묻기')
  ok(!log.some((u) => /이름|학생|%EA%B0%80/.test(decodeURIComponent(u).replace(/sheet=[^&]+/, ''))), '주소에 학생 정보가 없음 (시트 ID 와 시각만)')
  ok((await call('relay:info')).ver === 3, '판 3 으로 기억')

  console.log('\n4. 그 밖')
  r = await call('relay:form', 'https://example.com/x', 0)
  ok(!r.ok && /주소 모양/.test(r.error) && !r.needVer, '시트 주소가 아니면 보내지 않음')
  script = [() => json({ ok: false, v: 3, error: '응답 시트를 열지 못했습니다.' })]
  r = await call('relay:form', SHEET, 0)
  ok(!r.ok && /열지 못했/.test(r.error), '스크립트의 까닭을 그대로')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
