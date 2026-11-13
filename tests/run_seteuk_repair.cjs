// 세특 작성실 — 자동 고쳐쓰기 · 근거 확인. 빌드된 앱의 IPC 로. AI 는 가로채 가짜로 답한다(진짜 키를 쓰지 않는다). 이름은 지어낸 것
const path = require('path')
const { handlers } = global.__it
const { loadShared: load } = require('./tsload.cjs')
const S = load('seteuk.ts')

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

const BAD = '모둠 발표에서 그래프의 기울기를 비교하여 변화율을 설명했다.'
const GOOD = '모둠 발표에서 그래프의 기울기를 비교하여 변화율을 설명함.'
const WORSE = '토익 점수를 언급했다. 변화율을 설명했다.'

console.log('0. 규칙 (빌드 없이)')
const v = S.validateSeteuk(BAD, 600)
ok(S.needsRepair(v) && !S.needsRepair(S.validateSeteuk(GOOD, 600)) && !S.needsRepair(S.validateSeteuk('', 600)), "'고침'이 있을 때만 고쳐 쓰기 (빈 글은 아님)")
ok(S.betterCheck(v, S.validateSeteuk(GOOD, 600)) === 'b' && S.betterCheck(v, S.validateSeteuk(WORSE, 600)) === 'a' && S.betterCheck(v, v) === 'a', '나아졌을 때만 바꿈 (같으면 처음 것)')
const ru = S.buildRepairUser(' 메모 ', BAD, v.issues, 600)
ok(ru.startsWith('# 학생 자료\n메모\n\n# 고쳐 쓸 초안\n' + BAD) && ru.includes('- 존댓말/평서형 어미: "했다."') && !ru.includes('분량 부족'), "걸린 점은 '고침'만 · 확인은 넣지 않음")
ok(S.buildRepairUser('m', 'x'.repeat(700), S.validateSeteuk('x'.repeat(700), 600).issues, 600).includes('600바이트 이내가 되도록 덜 중요한 문장을 줄인다'), '분량 초과는 줄이라고')
ok(S.parseGround('```json\n{"unsupported":[{"quote":" 세 번 ","why":"자료에 횟수 없음"},{"quote":""}]}\n```').length === 1 && S.parseGround('설명 {"unsupported":[{"text":"x"}]} 끝')[0].quote === 'x' && S.parseGround('엉망').length === 0, '근거 확인 답 읽기')
ok(S.groundLeft([{ quote: '세 번 발표', why: '' }, { quote: '고친 구절', why: '' }], '수업에서 세 번  발표함.').map((g) => g.quote).join() === '세 번 발표', '고친 구절은 더 보이지 않음 (빈칸은 무시)')
ok(S.readOptions('').autoRepair === true && S.readOptions('').ground === false && S.readOptions('{"autoRepair":false,"ground":"y"}').autoRepair === false && S.readRows('{"a":{"note":"n","ground":[{"quote":"q"}],"repaired":true}}').a.ground[0].quote === 'q', '기본값 · 저장된 값 읽기')

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('seteuk:ground'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'exaone', exaone_key: 'TEST-EXAONE', gemini_key: '', openai_key: '', claude_key: '' })
  await call('seteuk:roster', 'subject', ['가나다', '라마바', '사아자'].map((name, i) => ({ id: `1-${i + 1}`, cls: '1', no: String(i + 1), name })))
  await call('seteuk:acts', [{ id: 'a1', name: '함수 탐구', rec: '과세특', bytes: 600 }])
  await call('seteuk:rows', 'a1', { '1-1': { note: '가나다가 기울기 비교해 발표' }, '1-2': { note: '라마바 발표' }, '1-3': { note: '사아자 발표' } })

  console.log('\n1. 자동 고쳐쓰기 (기본으로 켜짐)')
  ok((await call('seteuk:load')).options.autoRepair === true, '처음엔 켜짐 · 근거 확인은 꺼짐')
  script = [answer(BAD), answer(GOOD), answer(GOOD), answer(BAD), answer(WORSE)]
  let r = await call('seteuk:write', { job: 'r1', actId: 'a1', ids: ['1-1', '1-2', '1-3'] })
  let rows = (await call('seteuk:load')).rows.a1
  ok(r.ok && r.written === 3 && log.length === 5, `고칠 곳이 나온 학생만 한 번 더 (요청 ${log.length}번)`)
  ok(rows['1-1'].ai === GOOD && rows['1-1'].repaired === true, '나아졌으면 고친 글로 · 표시')
  ok(rows['1-2'].ai === GOOD && !rows['1-2'].repaired, '처음부터 괜찮으면 그대로')
  ok(rows['1-3'].ai === BAD && !rows['1-3'].repaired, '고친 글이 더 나쁘면 처음 글을 둠')
  const rep = log[1].body.messages
  ok(rep[0].content === log[0].body.messages[0].content && rep[1].content.includes('# 고쳐 쓸 초안') && rep[1].content.includes('존댓말/평서형 어미'), '규칙은 처음과 같게 · 걸린 점을 짚어')
  ok(!JSON.stringify(log.map((e) => e.body)).includes('가나다') && rep[1].content.includes('학생1가 기울기'), '고쳐 쓰기 요청에도 이름은 가명으로')

  console.log('\n2. 끄면 한 번만')
  await call('seteuk:options', { autoRepair: false, ground: false })
  log.length = 0
  script = [answer(BAD)]
  await call('seteuk:write', { job: 'r2', actId: 'a1', ids: ['1-1'] })
  rows = (await call('seteuk:load')).rows.a1
  ok(log.length === 1 && rows['1-1'].ai === BAD && !rows['1-1'].repaired, '고쳐 쓰지 않고 표시도 지움')

  console.log('\n3. 근거 확인을 켜면 초안 뒤에 한 번 더')
  await call('seteuk:options', { autoRepair: false, ground: true })
  log.length = 0
  script = [answer('세 번 발표하여 기울기를 비교함.'), answer('{"unsupported":[{"quote":"세 번 발표하여","why":"학생1 자료에 횟수가 없음"}]}')]
  await call('seteuk:write', { job: 'r3', actId: 'a1', ids: ['1-1'] })
  rows = (await call('seteuk:load')).rows.a1
  ok(log.length === 2 && log[1].body.messages[0].content.includes('문장을 검토하는 교사') && log[1].body.messages[1].content.startsWith('# 학생 자료\n학생1가 기울기'), '근거 확인 요청 — 관찰 기록과 초안 · 이름은 가림')
  ok(rows['1-1'].ground.length === 1 && rows['1-1'].ground[0].quote === '세 번 발표하여' && rows['1-1'].ground[0].why.includes('가나다'), '찾은 구절 저장 · 가명은 되돌림')
  script = [answer('발표함.'), answer('엉망인 답')]
  await call('seteuk:write', { job: 'r4', actId: 'a1', ids: ['1-2'] })
  ok((await call('seteuk:load')).rows.a1['1-2'].ground.length === 0, '읽을 수 없는 답이면 못 찾은 것으로')
  script = [answer('발표함.'), () => json({ error: { message: 'x' } }, 500)]
  r = await call('seteuk:write', { job: 'r5', actId: 'a1', ids: ['1-3'] })
  rows = (await call('seteuk:load')).rows.a1
  ok(r.written === 1 && rows['1-3'].ai === '발표함.' && rows['1-3'].ground === undefined, '근거 확인이 실패해도 초안은 받고, 확인 안 한 것으로')

  console.log('\n4. 한 학생만 근거 확인')
  await call('seteuk:rows', 'a1', { '1-2': { final: '라마바는 발표를 맡아 자료를 정리함.' } })
  log.length = 0
  script = [answer('{"unsupported":[]}')]
  let g = await call('seteuk:ground', 'a1', '1-2', null)
  ok(g.ok && g.row.ground.length === 0 && log[0].body.messages[1].content.includes('학생2는 발표를 맡아') && !log[0].body.messages[1].content.includes('라마바'), '최종본을 봄 · 이름 가림')
  ok(!(await call('seteuk:ground', 'a1', '9-9', null)).ok && !(await call('seteuk:ground', '없음', '1-1', null)).ok, '없는 학생 · 활동')
  await call('seteuk:rows', 'a1', { '1-2': { note: '' } })
  ok(/관찰 기록/.test((await call('seteuk:ground', 'a1', '1-2', null)).error), '관찰 기록이 없으면 묻지 않음')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
