// 세특 작성실 — 서술 흐름(쓰기 규칙) · 학생부 살펴보기. 빌드된 앱의 IPC 로. AI 는 가로채 가짜로 답한다(진짜 키를 쓰지 않는다). 이름은 지어낸 것
const path = require('path')
const { handlers } = global.__it
const { loadShared: load } = require('./tsload.cjs')
const S = load('seteuk.ts')
const V = load('seteukReview.ts')
const M = load('seteukSum.ts')

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

console.log('0. 서술 흐름 (빌드 없이)')
const study = S.sentenceFrame('과세특')
ok(study.includes('계기(수업 속 질문) → 직접 한 과정') && study.includes('이어간 탐구 → 결론') && study.includes('개념과 방법은 이름으로'), '교과 · 동아리 · 개세특 — 탐구 장면')
ok(S.sentenceFrame('동아리') === study && S.sentenceFrame('개세특') === study, '동아리 · 개세특도 같은 흐름')
ok(S.sentenceFrame('자율').includes('맡은 역할 → 그 자리에서 직접 한 일') && S.sentenceFrame('진로') === S.sentenceFrame('자율'), '자율 · 진로 — 역할 장면')
ok(S.sentenceFrame('행발').includes('여러 장면에서 되풀이해 본 행동') && !S.sentenceFrame('행발').includes('계기'), '행발 — 되풀이된 행동')
ok(['과세특', '자율', '행발'].every((r) => S.sentenceFrame(r).endsWith('- 문장은 학생이 한 일이나 낸 결론으로 끝맺는다.')), '끝맺음은 모든 영역에')
const p = S.buildSeteukPrompt(S.newActivity('x', { rec: '자율' }))
ok(p.includes('# 서술 규칙') && p.includes('맡은 역할') && !p.includes('계기(수업 속 질문)'), '프롬프트에 그 영역의 흐름이 들어감')
ok(['과세특', '동아리', '자율', '진로', '행발'].every((r) => S.byteLen(S.buildSeteukPrompt(S.newActivity('x', { rec: r }))) < 4500), '예시 없는 프롬프트는 4,500바이트 안')
ok(M.compressPrompt(S.recordOf('과세특')).includes('계기 → 직접 한 과정 → 이어간 탐구 → 결론'), '압축도 같은 흐름')

console.log('\n1. 살펴보기 규칙 (빌드 없이)')
const lower = V.buildReviewSystem('2')
const upper = V.buildReviewSystem('3')
ok(lower.includes('과목 선택 · 진로와 이어지는 지점') && upper.includes('학업역량 · 학업태도 · 학업 외 소양이 각각 어느 영역') && lower.includes('이어 갈 탐구 세 가지') && !lower.includes('짜임과 보완할 곳') && upper.includes('## 2. 흐름 진단\n표로 쓴다.') && !upper.includes('이어 갈 탐구 세 가지'), '1 · 2학년 / 3학년 할 일이 다름')
ok(V.buildReviewSystem('1') === lower, '1학년도 이어 갈 탐구')
for (const sys of [lower, upper]) {
  ok(['대회', '논문', '공인어학시험', '사교육', '대학명', '지어내지 않는다', '대신 써 주지 않고', '책 제목', '모든 대학이 같다고 말하지 않는다', '정규 수업', '남들이 흔히 하는 주제를 권하지 않는다', '도서명은 학생부에 나온 것만'].every((w) => sys.includes(w)), '기재요령 · 지어내지 않기 · 대필 금지 · 책 제목 · 한 대학 기준 · 자기 질문 · 도서명')
  ok(['학업역량', '학업태도', '학업 외 소양', '직책 이름이나 횟수가 아니라', '자신의 성취를 점검하고', '활동의 개수보다 깊이'].every((w) => sys.includes(w)), '서류평가 세 요소 · 점검 질문')
}
ok(V.buildReviewUser(' 글 ', '2', '  통계   분야 ') === '# 학생 정보\n- 학년: 2학년\n- 진로 희망: 통계 분야\n\n# 학생부\n글' && !V.buildReviewUser('글', '3', ' ').includes('진로'), '학생 정보 — 진로가 비면 넣지 않음')
ok(V.cleanReport('```markdown\n좋습니다.\n## 1. 강점\n내용\n```') === '## 1. 강점\n내용' && V.cleanReport('## 1\n가') === '## 1\n가', '머리말 · 코드 울타리 걷어 냄')

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('seteuk:review'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'exaone', exaone_key: 'TEST-EXAONE', gemini_key: '', openai_key: '', claude_key: '' })
  await call('seteuk:roster', 'subject', [{ id: '1-1', cls: '1', no: '1', name: '가나다' }])
  await call('seteuk:roster', 'club', [{ id: '2-5', cls: '2', no: '5', name: '라마바' }])
  const text = '[수학] 교과서의 공식 대신 좌표 차를 이용하는 방법을 탐구하고 교사와 함께 검토함. 가나다는 유리함수 그래프를 점근선으로 판단함.\n[동아리] 라마바와 함께 암호를 만들어 풀어 봄. 빈도 분석으로 깨지는 것을 확인하고 치환표를 고침.'

  console.log('\n2. 살펴보기 — 이름은 가리고 학년에 맞는 규칙으로')
  script = [answer('살펴보겠습니다.\n## 1. 지금 보이는 강점\n- 학생1는 점근선으로 판단함\n## 3. 이어 갈 탐구 세 가지\n학생2와 한 암호 활동에서')]
  let r = await call('seteuk:review', { text, grade: '2', career: '통계' })
  ok(r.ok && r.report.startsWith('## 1. 지금 보이는 강점') && r.report.includes('가나다는 점근선') && r.report.includes('라마바와 한 암호'), '받은 의견 — 머리말 걷고 가명 되돌림')
  const b = log[0].body.messages
  ok(b[0].content.includes('이어 갈 탐구 세 가지') && b[1].content.startsWith('# 학생 정보\n- 학년: 2학년\n- 진로 희망: 통계'), '2학년 규칙 · 학생 정보')
  ok(!JSON.stringify(log[0].body).includes('가나다') && !JSON.stringify(log[0].body).includes('라마바'), '교과 · 동아리 명단의 이름 모두 가림')
  ok(!('response_format' in log[0].body), '글로 받음(JSON 아님)')
  script = [answer('## 1. 전체 짜임\n…')]
  r = await call('seteuk:review', { text, grade: '3', career: '' })
  ok(r.ok && log[1].body.messages[0].content.includes('짜임과 보완할 곳') && !log[1].body.messages[1].content.includes('진로'), '3학년 규칙 · 진로 없음')

  console.log('\n3. 보내지 않는 경우')
  const n = log.length
  r = await call('seteuk:review', { text, grade: '2', career: '', dry: true })
  ok(r.ok && r.text.includes('# 학생부') && !r.text.includes('가나다') && log.length === n, '키 없이 — 요청 글만 (이름 가림, 보내지 않음)')
  ok(!(await call('seteuk:review', { text, grade: '', career: '' })).ok, '학년을 고르지 않으면')
  ok(/짧습니다/.test((await call('seteuk:review', { text: '짧은 글', grade: '1', career: '' })).error), '너무 짧으면')
  ok(/깁니다/.test((await call('seteuk:review', { text: '가'.repeat(30001), grade: '1', career: '' })).error) && log.length === n, '너무 길면')
  script = [() => json({ error: { message: 'x' } }, 401)]
  r = await call('seteuk:review', { text, grade: '1', career: '' })
  ok(!r.ok && r.error, '오류는 까닭과 함께')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
