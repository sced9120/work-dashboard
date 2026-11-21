// 세특 작성실 — 프롬프트 전체 직접 쓰기. 빌드된 앱의 IPC 로. AI 는 가로채 가짜로 답한다(진짜 키를 쓰지 않는다). 이름은 지어낸 것
const path = require('path')
const { handlers } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

const log = []
let script = []
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const answer = (text) => () => json({ choices: [{ message: { role: 'assistant', content: text } }] })
global.fetch = async (url, opts = {}) => {
  log.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null })
  const step = script.shift()
  if (!step) throw new Error('예상 못 한 요청 ' + url)
  return step()
}

const CUSTOM = '나의 지침: {{활동이름}}은 {{한도바이트}}바이트({{한도글자}}자) 이내로 쓴다. 가나다 이름을 예로 들지 않는다.'
const GOOD = '모둠 발표에서 그래프의 기울기를 비교함.'
const BAD = '지역 통계 대회에서 장려상을 받음.'

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('seteuk:write'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'exaone', exaone_key: 'TEST-EXAONE', gemini_key: '', openai_key: '', claude_key: '' })
  await call('seteuk:roster', 'subject', [{ id: '1-1', cls: '1', no: '1', name: '가나다' }])
  await call('seteuk:acts', [{ id: 'a1', name: '함수 탐구', rec: '과세특', bytes: 600, customOn: true, customPrompt: CUSTOM }])
  await call('seteuk:rows', 'a1', { '1-1': { note: '가나다가 기울기 비교해 발표' } })

  console.log('1. 저장 · 읽기')
  let a = (await call('seteuk:load')).acts.find((x) => x.id === 'a1')
  ok(a.customOn === true && a.customPrompt === CUSTOM, '직접 쓴 글과 스위치가 저장됨')

  console.log('\n2. 켜면 AI 요청의 규칙이 직접 쓴 글')
  script = [answer(GOOD)]
  let r = await call('seteuk:write', { job: 'c1', actId: 'a1', ids: ['1-1'] })
  const sys = log[0].body.messages[0].content
  ok(r.ok && r.written === 1 && log.length === 1, '초안을 받음')
  ok(sys === '나의 지침: 함수 탐구은 600바이트(200자) 이내로 쓴다. 학생1 이름을 예로 들지 않는다.', `자리표시자는 값으로, 직접 쓴 글의 학생 이름은 가명으로: ${sys.slice(0, 80)}`)
  ok(!sys.includes('# 배경') && !sys.includes('# 학생부 기재 금지사항'), '기본 구조(배경 · 금지사항 …)는 쓰지 않음')
  ok(!JSON.stringify(log.map((e) => e.body)).includes('가나다'), '어느 요청에도 실제 이름은 없음')

  console.log('\n3. 생성 뒤 검사 · 자동 고쳐쓰기는 그대로')
  log.length = 0
  script = [answer(BAD), answer(GOOD)]
  r = await call('seteuk:write', { job: 'c2', actId: 'a1', ids: ['1-1'] })
  const row = (await call('seteuk:load')).rows.a1['1-1']
  ok(log.length === 2 && row.ai === GOOD && row.repaired === true, `기재 금지(수상)가 나오면 고쳐 씀 (요청 ${log.length}번)`)
  ok(log[1].body.messages[0].content === log[0].body.messages[0].content, '고쳐 쓰기도 같은 직접 쓴 규칙으로')

  console.log('\n4. 끄면 기본 구조로')
  await call('seteuk:acts', [{ id: 'a1', name: '함수 탐구', rec: '과세특', bytes: 600, customOn: false, customPrompt: CUSTOM }])
  log.length = 0
  script = [answer(GOOD)]
  await call('seteuk:write', { job: 'c3', actId: 'a1', ids: ['1-1'] })
  const sys2 = log[0].body.messages[0].content
  ok(sys2.includes('# 배경') && sys2.includes('# 학생부 기재 금지사항') && !sys2.includes('나의 지침'), '스위치를 끄면 기본 구조 (쓴 글은 남아 있음)')
  a = (await call('seteuk:load')).acts.find((x) => x.id === 'a1')
  ok(a.customPrompt === CUSTOM && !a.customOn, '끈 뒤에도 글은 저장돼 있음')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
