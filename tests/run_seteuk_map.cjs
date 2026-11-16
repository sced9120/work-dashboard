// 학생부 주제 지도 — 빌드된 앱의 IPC 로. AI 는 가로채 가짜로 답한다. 이름은 지어낸 것
const fs = require('fs')
const os = require('os')
const path = require('path')
const { handlers, next } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

const log = []
let script = []
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const answer = (text) => () => json({ choices: [{ message: { role: 'assistant', content: text } }] })
global.fetch = async (url, opts = {}) => {
  const entry = { url: String(url), body: opts.body ? JSON.parse(opts.body) : null }
  log.push(entry)
  const step = script.shift()
  if (!step) throw new Error('예상 못 한 요청 ' + url)
  return step(entry)
}

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('seteuk:map'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'exaone', exaone_key: 'TEST-EXAONE', gemini_key: '', openai_key: '', claude_key: '' })
  await call('seteuk:roster', 'subject', [{ id: '1-1', cls: '1', no: '1', name: '가나다' }])
  await call('seteuk:roster', 'club', [{ id: '2-5', cls: '2', no: '5', name: '라마바' }])
  const text = '[수학] 교과서의 공식 대신 좌표 차를 이용하는 방법을 탐구하고 교사와 함께 검토함. 가나다는 유리함수 그래프를 점근선으로 판단함.\n[동아리] 라마바와 함께 암호를 만들어 풀어 봄. 빈도 분석으로 깨지는 것을 확인하고 치환표를 고침.'

  console.log('1. 주제 지도 — 이름은 가리고, 받은 글은 되돌림')
  const reply = {
    topics: [
      { id: 't1', name: '유리함수 점근선', areas: ['수학'], evidence: ['학생1는 유리함수 그래프를 점근선으로 판단함'], competency: '수학적 추론' },
      { id: 't2', name: '암호 빈도 분석', areas: ['동아리'], evidence: ['학생2와 함께 암호를 만들어 풀어 봄'], competency: '협력' }
    ],
    links: [{ a: 't1', b: 't2', why: '규칙을 찾음' }],
    suggests: [{ topic: '수학적 모델링', area: '수학', kind: '교과', why: '수학 역량', from: 't1', competency: '모델링' }]
  }
  script = [answer('```json\n' + JSON.stringify(reply) + '\n```')]
  let r = await call('seteuk:map', { text, grade: '2', career: '통계' })
  ok(r.ok && r.map.topics.length === 2 && r.map.links.length === 1 && r.map.suggests[0].from === 't1', '결과 모양')
  ok(r.map.topics[0].evidence[0].includes('가나다는') && r.map.topics[1].evidence[0].includes('라마바와'), '인용의 가명을 이름으로 되돌림')
  const body = JSON.stringify(log[0].body)
  ok(!body.includes('가나다') && !body.includes('라마바'), '요청에 이름 없음')
  ok(log[0].body.messages[0].content.includes('주제 지도') && log[0].body.messages[1].content.startsWith('# 학생 정보\n- 학년: 2학년\n- 진로 희망: 통계'), '지시문 · 학생 정보')
  ok(log[0].body.messages[0].content.includes('JSON 하나만'), 'JSON 으로 내라고 지시(EXAONE 은 response_format 을 보내지 않음)')

  console.log('\n2. 보내지 않는 경우 · 오류')
  const n = log.length
  r = await call('seteuk:map', { text, grade: '2', career: '', dry: true })
  ok(r.ok && r.text.includes('# 학생부') && !r.text.includes('가나다') && log.length === n, '요청 글만(이름 가림)')
  ok(!(await call('seteuk:map', { text, grade: '', career: '' })).ok, '학년 없음')
  ok(/짧습니다/.test((await call('seteuk:map', { text: '짧음', grade: '1', career: '' })).error) && log.length === n, '너무 짧음')
  script = [answer('죄송합니다')]
  r = await call('seteuk:map', { text, grade: '1', career: '' })
  ok(!r.ok && /읽어 내지 못/.test(r.error), 'JSON 이 아니면 오류')

  console.log('\n3. 옵시디언 폴더로 내보내기')
  script = [answer(JSON.stringify(reply))]
  const map = (await call('seteuk:map', { text, grade: '2', career: '' })).map
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smap-'))
  r = await call('seteuk:mapExport', map, '2학년 5번')
  ok(!r.ok, '폴더를 고르지 않으면 취소')
  next.open.push([dir])
  r = await call('seteuk:mapExport', map, '2학년/5번')
  ok(r.ok && r.path.startsWith(dir) && path.basename(r.path).startsWith('학생부지도_2학년5번_'), '새 폴더 이름')
  const files = fs.readdirSync(r.path).sort()
  ok(r.count === files.length && files.includes('index.md') && files.includes('추천.md') && files.includes('유리함수 점근선.md'), '노트가 써짐: ' + files.join(', '))
  ok(fs.readFileSync(path.join(r.path, '유리함수 점근선.md'), 'utf8').includes('[[암호 빈도 분석]]'), '[[연결]] 이 들어감')
  next.open.push([dir])
  const r2 = await call('seteuk:mapExport', map, '2학년/5번')
  ok(r2.ok && r2.path !== r.path, '같은 날 다시 내보내면 새 폴더')
  next.open.push([dir])
  ok(!(await call('seteuk:mapExport', { topics: [] }, 'x')).ok, '빈 지도는 내보내지 않음')
  fs.rmSync(dir, { recursive: true, force: true })

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
