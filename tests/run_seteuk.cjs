// 세특 작성실 — 빌드된 앱의 IPC 로. AI 는 가로채 가짜로 답한다(진짜 키를 쓰지 않는다). 이름은 지어낸 것
const path = require('path')
const fs = require('fs')
const { handlers, next, calls, USER_DATA } = global.__it

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
  for (let i = 0; i < 100 && !handlers.has('seteuk:load'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'exaone', exaone_key: 'TEST-EXAONE', gemini_key: '', openai_key: '', claude_key: '' })

  console.log('1. 명단 · 활동 · 글 저장')
  let all = await call('seteuk:load')
  ok(all.rosters.subject.length === 0 && all.rosters.club.length === 0 && all.rosters.homeroom.length === 0 && all.acts.map((a) => a.rec).join() === '과세특,동아리,자율,진로,행발' && all.demo.canFill && !all.demo.filled, '처음엔 명단은 비고, 모드마다 쓸 활동은 만들어 둠')
  const roster = [
    { id: '1-1', cls: '1', no: '1', name: '가나다' },
    { id: '1-2', cls: '1', no: '2', name: '라마바' },
    { id: '1-3', cls: '1', no: '3', name: '사아자' },
    { id: '1-4', cls: '1', no: '4', name: '차카타' }
  ]
  await call('seteuk:roster', 'subject', roster)
  await call('seteuk:acts', [
    { id: 'a1', name: '함수 탐구', rec: '과세특', subject: '공통수학2', desc: '그래프로 변화율 설명', bytes: 600, amount: '보통' },
    { id: 'a2', name: '독서 토론', rec: '자율', subject: '', desc: '', bytes: 0, amount: '메모만큼' }
  ])
  await call('seteuk:rows', 'a1', {
    '1-1': { note: '가나다는 기울기를 구간마다 비교해 발표함. 마바가 물은 것에 그래프로 답함' },
    '1-2': { note: '마바가 풀이를 고쳐 다시 설명함', final: '선생님이 미리 쓴 최종본' },
    '1-3': { note: '   ' },
    '1-4': { note: '수업 뒤 질문을 정리해 옴' }
  })
  await call('seteuk:rows', 'a2', { '1-1': { note: '책을 읽고 토론함' } })
  await call('seteuk:rows', '없는활동', { '1-1': { note: '들어가면 안 됨' } })
  all = await call('seteuk:load')
  ok(all.rosters.subject.length === 4 && all.rosters.homeroom.length === 0 && all.acts.length === 2 && all.rows.a1['1-2'].final === '선생님이 미리 쓴 최종본' && !('없는활동' in all.rows), '저장 · 다시 읽기 (없는 활동에는 안 넣음)')
  await call('seteuk:rows', 'a1', { '1-2': { ai: '옛 초안' } })
  all = await call('seteuk:load')
  ok(all.rows.a1['1-2'].ai === '옛 초안' && all.rows.a1['1-2'].note.includes('풀이') && all.rows.a1['1-2'].final.includes('최종본'), '고친 칸만 바뀜')

  console.log('\n2. 초안 받기 — 이름은 보내지 않음')
  script = [answer('\n"학생1은 구간마다 기울기를 비교하여 **변화율**을 설명함.\n질문에 그래프로 답함."'), answer('풀이를 고쳐 다시 설명함.'), answer('질문을 정리해 옴.')]
  calls.sent.length = 0
  let r = await call('seteuk:write', { job: 'j1', actId: 'a1', ids: ['1-1', '1-2', '1-3', '1-4', '9-9'], model: { provider: 'exaone', model: 'k-exaone_v2.5' } })
  ok(r.ok && r.written === 3 && r.failed === 0 && r.empty === 1, `세 명 받음 · 빈 관찰 기록 1명은 건너뜀 (${JSON.stringify(r)})`)
  ok(log.length === 3 && log.every((e) => e.url === 'https://api.exaone.ai/v1/chat/completions' && e.body.model === 'k-exaone_v2.5' && !('response_format' in e.body)), '학생마다 요청 한 번 · 고른 모델 · JSON 으로 받지 않음')
  const sent = JSON.stringify(log.map((e) => e.body))
  ok(!roster.some((x) => sent.includes(x.name)) && !sent.includes('마바가'), '이름(성 없는 이름 포함)이 요청에 없음')
  const m0 = log[0].body.messages
  ok(m0[0].role === 'system' && m0[0].content.includes('# 역할') && m0[0].content.includes('600바이트') && m0[0].content.includes('함수 탐구'), '규칙은 system 으로 — 활동 · 분량 포함')
  ok(m0[1].role === 'user' && m0[1].content.startsWith('[학생 자료]\n학생1') && m0[1].content.includes('학생2가 물은'), `관찰 기록은 가명으로: ${m0[1].content}`)
  all = await call('seteuk:load')
  ok(all.rows.a1['1-1'].ai === '가나다은 구간마다 기울기를 비교하여 변화율을 설명함. 질문에 그래프로 답함.', `가명 되돌림 · 따옴표 · 굵게 · 줄바꿈 걷어 냄: ${all.rows.a1['1-1'].ai}`)
  ok(all.rows.a1['1-2'].ai === '풀이를 고쳐 다시 설명함.' && all.rows.a1['1-2'].final === '선생님이 미리 쓴 최종본', '초안만 바뀌고 최종본은 그대로')
  const prog = calls.sent.filter((x) => x.ch === 'seteuk:progress').map((x) => x.payload)
  ok(prog.length === 3 && prog[2].done === 3 && prog[2].total === 3 && prog[0].id === '1-1' && prog[0].row.ai.includes('변화율') && prog.every((x) => x.job === 'j1'), '진행 소식 — 학생마다 한 번, 받은 글과 함께')

  console.log('\n3. 오류 · 멈추기')
  script = [() => json({ error: { message: 'bad key' } }, 401), answer('두 번째는 받음.')]
  calls.sent.length = 0
  r = await call('seteuk:write', { job: 'j2', actId: 'a1', ids: ['1-1', '1-4'] })
  all = await call('seteuk:load')
  const p2 = calls.sent.filter((x) => x.ch === 'seteuk:progress').map((x) => x.payload)
  ok(r.ok && r.written === 1 && r.failed === 1 && p2[0].error && !p2[0].row && all.rows.a1['1-1'].ai.includes('변화율') && all.rows.a1['1-4'].ai === '두 번째는 받음.', '한 명이 실패해도 다음 학생은 받고, 실패한 학생의 옛 초안은 그대로')
  script = [async () => { await call('seteuk:cancel', 'j3'); return json({ choices: [{ message: { content: '첫 학생.' } }] }) }, answer('오면 안 됨')]
  r = await call('seteuk:write', { job: 'j3', actId: 'a1', ids: ['1-1', '1-2', '1-4'] })
  ok(r.canceled && r.written === 1 && script.length === 1, '멈추면 받던 학생까지만')
  script = []
  r = await call('seteuk:write', { job: 'j4', actId: 'a1', ids: ['1-3'] })
  ok(!r.ok && /관찰 기록/.test(r.error) && r.empty === 1, `관찰 기록이 없으면 보내지 않음: ${r.error}`)
  r = await call('seteuk:write', { job: 'j5', actId: '없음', ids: ['1-1'] })
  ok(!r.ok, '없는 활동')
  await call('local:save', { ...(await call('local:load')), exaone_key: '' })
  r = await call('seteuk:write', { job: 'j6', actId: 'a1', ids: ['1-1'] })
  ok(r.ok && r.failed === 1 && r.written === 0, '키가 없으면 받지 못함으로')

  console.log('\n4. 인수인계 파일 · 활동 지우기')
  const out = path.join(USER_DATA, 'h.db')
  next.save.push(out)
  ok((await call('data:export', true)).ok, '내보내기(개인 설정 포함으로 골라도)')
  const bytes = fs.readFileSync(out).toString('utf8')
  ok(!bytes.includes('가나다') && !bytes.includes('기울기') && !bytes.includes('함수 탐구') && !bytes.includes('seteuk_'), '명단 · 관찰 기록 · 글 · 활동이 파일에 없음')
  await call('seteuk:acts', [{ id: 'a2', name: '독서 토론', rec: '자율', subject: '', desc: '', bytes: 0, amount: '메모만큼' }])
  all = await call('seteuk:load')
  ok(all.acts.length === 1 && !('a1' in all.rows) && all.rows.a2['1-1'].note === '책을 읽고 토론함', '지운 활동의 글도 지움 · 남은 활동은 그대로')
  await call('seteuk:acts', [{ id: 'a1', name: '다시 만든 활동', rec: '과세특' }, { id: 'a2', name: '독서 토론', rec: '자율' }])
  ok(Object.keys((await call('seteuk:load')).rows.a1).length === 0, '같은 id 로 다시 만들어도 옛 글이 돌아오지 않음')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
