// 세특 작성실 — 이 글 조언 (3.7.2~). 빌드된 앱의 IPC 로. AI 는 가로채 가짜로 답한다(진짜 키를 쓰지 않는다). 이름은 지어낸 것
const path = require('path')
const { handlers } = global.__it
const { loadShared: load } = require('./tsload.cjs')
const R = load('seteukReview.ts')

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

console.log('0. 규칙 (빌드 없이)')
const sys = R.buildAdviceSystem()
ok(sys.startsWith('# 역할\n') && sys.includes('특기사항 한 편') && !sys.includes('한 학생의 학생부를 읽고'), '역할 — 한 편을 읽는 동료 교사')
ok(sys.includes('# 읽는 관점') && sys.includes('# 지킬 것') && sys.includes('새 문장을 대신 써 주지 않고') && sys.includes('입시 결과를 장담'), '학생부 살펴보기와 같은 관점 · 지킬 것')
ok(['## 잘 드러난 것', '## 흐름', '## 더 구체적으로 쓸 곳', '## 교사가 본 장면', '## 관찰 기록에 있는데 글에 빠진 것', '## 기재요령에 걸릴 수 있는 곳', '## 선생님이 확인할 질문'].every((h) => sys.includes(h)) && sys.includes('고쳐 쓴 문장을 내놓지 않는다'), '일곱 제목 · 문장을 대신 쓰지 않음')
// 3.7.3 — 2026 기재요령 · 대학 공개 자료를 대조해 더한 관점과 지킬 것
ok(sys.includes('교사가 수업과 수행평가에서 직접 관찰한 사실') && sys.includes('늘어놓기만') && sys.includes('성취기준에 이미 있는 지식') && sys.includes('학생을 바꿔도 통하는 문장'), '근거(교사 관찰) · 활동 나열 · 성취기준 옮겨 적기 · 개별화를 본다')
ok(sys.includes('없다고 흠잡지 않는다') && sys.includes('점수 · 등급 · 합격 가능성을 매기지 않는다') && sys.includes('모든 대학이 같다고 말하지 않는다'), '오차 · 한계가 없다고 흠잡지 않음 · 점수를 매기지 않음 · 대학마다 다름')
const low = R.buildReviewSystem('1')
const up = R.buildReviewSystem('3')
ok(low.includes('학교가 주최 · 주관하는 교육활동') && low.includes('온라인 공개강좌, 방과후학교, 소논문') && low.includes('교육과정 범위를 크게 넘는') && low.includes('한 단계 깊이') && low.includes('다른 과목의 개념으로 다시 보는 것'), '지킬 것 — 학교 활동 안 · 기재 불가 활동은 권하지 않음 · 깊이 먼저 · 다른 과목으로')
ok(up.includes('과목 선택과 탐색이 어떻게 이어지고 달라져 왔는가') && up.includes('영역끼리 같은 내용을 되풀이하지 않았는가') && up.includes('활동을 차례로 늘어놓기만 했거나'), '읽는 관점 — 과목 선택 흐름 · 영역 간 중복 · 나열')
ok(low.length < 3200 && up.length < 3200 && sys.length < 3200, `규칙 길이 ${low.length} · ${up.length} · ${sys.length} (3,200자 안)`)
ok(R.buildAdviceUser(' 글 ', '', '과목별 세특', '함수  탐구') === '# 기록 항목\n과목별 세특 — 함수 탐구\n\n[특기사항]\n글' && R.buildAdviceUser('글', ' 메모 ', 'x', '').endsWith('[관찰 기록]\n메모'), '보내는 글 — 기록 항목 · 특기사항 · (있으면) 관찰 기록')

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('seteuk:advice'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'exaone', exaone_key: 'TEST-EXAONE', gemini_key: '', openai_key: '', claude_key: '' })
  await call('seteuk:roster', 'subject', [{ id: '1-1', cls: '1', no: '1', name: '가나다' }, { id: '1-2', cls: '1', no: '2', name: '라마바' }])
  await call('seteuk:acts', [{ id: 'a1', name: '함수 탐구', rec: '과세특', bytes: 1500 }])
  const FINAL = '일차함수 모둠 발표에서 가나다와 함께 그래프의 기울기를 비교하여 변화율을 설명함. 탐구의 중요성을 깨달음.'
  await call('seteuk:rows', 'a1', { '1-2': { note: '라마바가 기울기 비교, 질문 4개에 답함', final: FINAL }, '1-1': { note: '메모만', ai: '짧음' } })

  console.log('\n1. 조언 받기')
  script = [answer('네, 의견입니다.\n## 잘 드러난 것\n- "기울기를 비교하여" — 학생2가 직접 한 일\n## 흐름\n- 끝맺음: 약함')]
  let r = await call('seteuk:advice', 'a1', '1-2', null)
  ok(r.ok && r.report.startsWith('## 잘 드러난 것') && r.report.includes('라마바가 직접 한 일') && !r.report.includes('학생2'), '머리말을 걷고, 가명은 이름으로 되돌림')
  const body = JSON.stringify(log[0].body)
  const user = log[0].body.messages[1].content
  ok(!body.includes('가나다') && !body.includes('라마바') && user.includes('[특기사항]') && user.includes('[관찰 기록]') && user.includes('과목별') && user.includes('함수 탐구'), '글 · 관찰 기록의 이름을 가려 보냄')
  ok(log[0].body.messages[0].content === sys, '규칙은 buildAdviceSystem 그대로')
  ok((await call('seteuk:load')).rows.a1['1-2'].final === FINAL, '글은 바꾸지 않음 (의견만)')

  console.log('\n2. 보내지 않는 경우')
  const before = log.length
  r = await call('seteuk:advice', 'a1', '1-1', null)
  ok(!r.ok && /짧습니다/.test(r.error) && log.length === before, '글이 없거나 너무 짧으면 보내지 않음')
  ok(!(await call('seteuk:advice', 'none', '1-2', null)).ok, '없는 활동')
  r = await call('seteuk:advice', 'a1', '1-2', null, true)
  ok(r.ok && r.text.includes('# 읽는 관점') && r.text.includes('[특기사항]') && !r.text.includes('라마바') && log.length === before, '키 없이 — 보낼 글만 돌려주고 보내지 않음')

  console.log('\n3. 오류')
  script = [() => json({ error: { message: 'x' } }, 401)]
  r = await call('seteuk:advice', 'a1', '1-2', null)
  ok(!r.ok && r.error, '오류는 까닭과 함께')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
