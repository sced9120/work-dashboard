// 세특 작성실 — Gemini 호출 한도(429) 때 쉬었다 다시 · Gemini 는 2명씩. 빌드된 앱의 IPC 로. AI 는 가로채 가짜로 답한다(진짜 키를 쓰지 않는다). 이름은 지어낸 것
const path = require('path')
const { handlers } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

const GOOD = '모둠 발표에서 그래프의 기울기를 비교함.'
const gemOk = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: GOOD }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
const exaOk = () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: GOOD } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
const tooMany = () =>
  new Response(JSON.stringify({ error: { code: 429, message: 'Resource exhausted. Please try again later.', status: 'RESOURCE_EXHAUSTED' } }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'retry-after-ms': '20' }
  })

let log = []
let handler = null
let inflight = 0
let maxInflight = 0
global.fetch = async (url, opts = {}) => {
  log.push(String(url))
  inflight++
  maxInflight = Math.max(maxInflight, inflight)
  try {
    return await handler(String(url), opts.body ? String(opts.body) : '', inflight)
  } finally {
    inflight--
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('seteuk:write'); i++) await sleep(50)
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'gemini', gemini_key: 'TEST-GEMINI', gemini_model: 'gemini-3.8-flash', openai_key: '', claude_key: '', exaone_key: '' })
  const people = ['가나다', '라마바', '사아자', '차카타', '파하갸']
  await call('seteuk:roster', 'subject', people.map((name, i) => ({ id: `1-${i + 1}`, cls: '1', no: String(i + 1), name })))
  await call('seteuk:acts', [{ id: 'a1', name: '함수 탐구', rec: '과세특', bytes: 600 }])
  await call('seteuk:rows', 'a1', Object.fromEntries(people.map((n, i) => [`1-${i + 1}`, { note: `${n}가 기울기 비교해 발표` }])))

  console.log('1. 한 번 걸려도 쉬었다 다시 받음')
  let n = 0
  handler = async () => (n++ === 0 ? tooMany() : gemOk())
  let r = await call('seteuk:write', { job: 'q1', actId: 'a1', ids: ['1-1'] })
  ok(r.ok && r.written === 1 && r.failed === 0 && log.length === 2, `429 한 번 → 두 번째에 성공 (요청 ${log.length}번)`)

  console.log('\n2. 공유 용량 붐빔(Resource exhausted)이 계속되면 네 번까지만 다시 — 그래도 안 되면 실패로')
  log = []
  handler = async () => tooMany()
  r = await call('seteuk:write', { job: 'q2', actId: 'a1', ids: ['1-2'] })
  ok(r.ok && r.written === 0 && r.failed === 1 && log.length === 5, `처음 + 다시 4번 = 5번 (요청 ${log.length}번)`)
  const rows = (await call('seteuk:load')).rows.a1
  ok(!rows['1-2']?.ai, '실패한 학생의 칸은 비어 있음')
  log = []
  handler = async () =>
    new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded for metric x', status: 'RESOURCE_EXHAUSTED' } }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after-ms': '20' }
    })
  r = await call('seteuk:write', { job: 'q2b', actId: 'a1', ids: ['1-2'] })
  ok(r.failed === 1 && log.length === 3, `다른 429(할당량)는 두 번까지만 (요청 ${log.length}번)`)

  console.log('\n2-1. 받는 중에 한 번 걸리면 남은 학생은 한 명씩')
  await call('seteuk:options', { autoRepair: true, ground: false, parallel: 3 })
  log = []
  let first = true
  const lateStart = [] // 4 · 5번째 학생 요청이 시작될 때 함께 떠 있던 요청 수
  handler = async (_url, body, now) => {
    if (first) {
      first = false
      return tooMany()
    }
    if (/학생[45]/.test(body)) lateStart.push(now)
    await sleep(80)
    return gemOk()
  }
  r = await call('seteuk:write', { job: 'q2c', actId: 'a1', ids: ['1-1', '1-2', '1-3', '1-4', '1-5'] })
  ok(r.ok && r.written === 5, `5명 모두 받음 (${JSON.stringify(r)})`)
  // 처음 3명은 이미 함께 보냈고, 걸린 뒤 새로 시작하는 학생(4 · 5번)은 혼자 떠 있어야 한다
  ok(lateStart.length === 2 && lateStart.every((n) => n === 1), `걸린 뒤엔 한 명씩 (4 · 5번 시작 때 떠 있던 요청: ${lateStart.join(', ')})`)
  log = []
  handler = async () => {
    await sleep(80)
    return gemOk()
  }
  r = await call('seteuk:write', { job: 'q2e', actId: 'a1', ids: ['1-1', '1-2', '1-3'] })
  ok(r.written === 3 && maxInflight === 3, `새 작업은 다시 정한 수(3명)로 시작 (동시에 최대 ${maxInflight}명)`)
  await call('seteuk:options', { autoRepair: true, ground: false, parallel: 0 })

  console.log('\n3. Gemini 는 2명씩 동시에')
  log = []
  maxInflight = 0
  handler = async () => {
    await sleep(60)
    return gemOk()
  }
  r = await call('seteuk:write', { job: 'q3', actId: 'a1', ids: ['1-1', '1-2', '1-3', '1-4', '1-5'] })
  ok(r.ok && r.written === 5 && maxInflight === 2, `동시에 최대 ${maxInflight}명 (5명 받음)`)

  console.log('\n4. K-EXAONE 은 그대로 3명씩')
  await call('local:save', { ...(await call('local:load')), provider: 'exaone', exaone_key: 'TEST-EXAONE', gemini_key: '' })
  log = []
  maxInflight = 0
  handler = async () => {
    await sleep(60)
    return exaOk()
  }
  r = await call('seteuk:write', { job: 'q4', actId: 'a1', ids: ['1-1', '1-2', '1-3', '1-4', '1-5'] })
  ok(r.ok && r.written === 5 && maxInflight === 3, `동시에 최대 ${maxInflight}명 (5명 받음)`)

  console.log('\n5. 동시 요청을 1명씩으로 정하면 차례로 (3.7.11~)')
  const saved = await call('seteuk:options', { autoRepair: true, ground: false, parallel: 1 })
  ok(saved.parallel === 1, '설정이 저장됨')
  log = []
  maxInflight = 0
  r = await call('seteuk:write', { job: 'q5', actId: 'a1', ids: ['1-1', '1-2', '1-3', '1-4', '1-5'] })
  ok(r.ok && r.written === 5 && maxInflight === 1, `동시에 최대 ${maxInflight}명 (5명 받음)`)
  await call('local:save', { ...(await call('local:load')), provider: 'gemini', gemini_key: 'TEST-GEMINI', exaone_key: '' })
  maxInflight = 0
  handler = async () => {
    await sleep(60)
    return gemOk()
  }
  r = await call('seteuk:write', { job: 'q6', actId: 'a1', ids: ['1-1', '1-2', '1-3'] })
  ok(r.ok && r.written === 3 && maxInflight === 1, `Gemini 도 1명씩 (동시에 최대 ${maxInflight}명)`)
  await call('seteuk:options', { autoRepair: true, ground: false, parallel: 3 })
  maxInflight = 0
  r = await call('seteuk:write', { job: 'q7', actId: 'a1', ids: ['1-1', '1-2', '1-3'] })
  ok(r.ok && r.written === 3 && maxInflight === 3, `3명씩으로 정하면 Gemini 도 3명 (동시에 최대 ${maxInflight}명)`)
  const back = await call('seteuk:options', { autoRepair: true, ground: false, parallel: 9 })
  ok(back.parallel === 0, '이상한 값은 자동으로')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
