// 세특 작성실 — 내 규칙을 저장하면 메인의 초안 규칙 · 검사(자동 고쳐쓰기 · 나이스 파일)에 쓰인다. 빌드된 앱의 IPC 로. 가짜 AI. 이름은 지어낸 것
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

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('seteuk:config'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'exaone', exaone_key: 'TEST-EXAONE', gemini_key: '', openai_key: '', claude_key: '' })
  await call('seteuk:roster', 'subject', [{ id: '1-1', cls: '1', no: '1', name: '가나다' }])
  await call('seteuk:acts', [{ id: 'a1', name: '탐구', rec: '과세특', bytes: 600 }])
  await call('seteuk:rows', 'a1', { '1-1': { note: '자료를 모아 발표함' } })

  console.log('1. 저장 · 다시 읽기')
  ok((await call('seteuk:load')).config.sections.avoid === true, '처음엔 기본값')
  const saved = await call('seteuk:config', { off: [], mine: [{ words: '열정적', level: 'block', why: '' }], extra: '수업 차시를 밝히지 않는다', sections: { avoid: false, frame: true, view: true } })
  ok(saved.mine[0].words === '열정적' && (await call('seteuk:load')).config.extra === '수업 차시를 밝히지 않는다', '저장됨')

  console.log('\n2. 초안 규칙 · 자동 고쳐쓰기에 쓰임')
  script = [answer('열정적으로 자료를 모아 발표함.'), answer('자료를 모아 발표함.')]
  await call('seteuk:write', { job: 'c1', actId: 'a1', ids: ['1-1'] })
  const sys = log[0].body.messages[0].content
  ok(sys.includes('- 수업 차시를 밝히지 않는다') && sys.includes('선생님이 정한 금지어: 열정적') && !sys.includes('# 피할 표현'), '더한 규칙 · 내 금지어 · 끈 칸')
  const row = (await call('seteuk:load')).rows.a1['1-1']
  ok(log.length === 2 && log[1].body.messages[1].content.includes('내 금지어') && row.ai === '자료를 모아 발표함.' && row.repaired, "내 금지어(고침)는 자동 고쳐쓰기가 고침")

  console.log('\n3. 처음 설정으로')
  await call('seteuk:config', { off: [], mine: [], extra: '', sections: { avoid: true, frame: true, view: true } })
  log.length = 0
  script = [answer('자료를 모아 발표함.')]
  await call('seteuk:write', { job: 'c2', actId: 'a1', ids: ['1-1'] })
  ok(log[0].body.messages[0].content.includes('# 피할 표현') && !log[0].body.messages[0].content.includes('선생님이 정한 금지어'), '되돌리면 기본 규칙')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
