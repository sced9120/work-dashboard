// 세특 작성실 — 예시 · 내 문체. 빌드된 앱의 IPC 로. AI 는 가로채 가짜로 답한다(진짜 키를 쓰지 않는다). 이름은 지어낸 것
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

console.log('0. 프롬프트 조립 (빌드 없이)')
const base = S.newActivity('a1', { name: '함수 탐구', rec: '과세특', bytes: 600 })
const plain = S.buildSeteukPrompt(base)
ok(!plain.includes('# 예시') && !plain.includes('# 내 문체') && !plain.includes('# 문체 예시'), '예시 · 문체가 없으면 그 칸도 없음')
const withEx = S.newActivity('a1', { name: '함수 탐구', rec: '과세특', bytes: 600, examples: [{ note: '그래프를\n그림', result: '그래프를 그려 설명함.' }, { note: '', result: '  ' }] })
const style = { on: true, samples: ['예전 글 하나.', '예전 글 둘.'], card: '- 세 문장 안팎\n- ~함 으로 끝맺음' }
const full = S.buildSeteukPrompt(withEx, { style })
const heads = (full.match(/^# .+$/gm) || []).map((h) => h.split(' — ')[0].replace(/ \(.*/, ''))
ok(heads.join(' | ') === '# 역할 | # 과제 | # 서술 규칙 | # 피할 표현 | # 학생부 기재 금지사항 | # 서술 관점과 역량 | # 분량 | # 입력 자료 형식 | # 성취수준 반영 | # 문체 예시 | # 예시 | # 내 문체 | # 출력', `차례: ${heads.join(' | ')}`)
ok(full.includes('## 예시1 입력\n관찰 메모: 그래프를 그림\n## 예시1 결과\n그래프를 그려 설명함.') && !full.includes('## 예시2'), '예시 — 입력(한 줄로) · 결과, 빈 예시는 뺌')
ok(full.includes('학생 자료가 예시 입력보다 적으면 예시보다 짧아도 된다.') && full.includes('## 문체 예시2\n예전 글 둘.') && full.includes('내용·소재는 따르지 말고'), '분량 안내 · 문체 예시는 쓰는 방식만')
ok(!S.buildSeteukPrompt(withEx, { style: { ...style, on: false } }).includes('문체'), '문체를 끄면 들어가지 않음(예시는 그대로)')
ok(S.buildSeteukPrompt(S.newActivity('x', { examples: Array.from({ length: 8 }, (_x, i) => ({ note: 'n', result: 'r' + i })) })).split('## 예시').length - 1 === 10, '예시는 앞의 다섯 개까지(입력 · 결과 열 줄)')
ok(S.seteukUser('메모', style).endsWith('# 쓰기 직전 확인 — 내 문체 (예시·규칙과 함께 그대로 따른다)\n' + style.card) && S.seteukUser('메모', { ...style, on: false }) === '[학생 자료]\n메모', '문체 카드는 학생 자료 뒤에 한 번 더')
ok(S.readStyle('망가짐').on === false && S.readStyle(JSON.stringify({ on: 'yes', samples: [' 글 ', '', 3], card: 5 })).samples.join() === '글,3' && S.readActs(JSON.stringify([{ id: 'a', examples: [{ note: 1, result: ' 글 ' }, { result: '' }, null] }]))[0].examples.length === 1, '망가진 설정 · 예시 읽기')

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('seteuk:styleCard'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'exaone', exaone_key: 'TEST-EXAONE', gemini_key: '', openai_key: '', claude_key: '' })
  await call('seteuk:roster', 'subject', [{ id: '1-1', cls: '1', no: '1', name: '가나다' }, { id: '1-2', cls: '1', no: '2', name: '라마바' }])
  await call('seteuk:acts', [{ id: 'a1', name: '함수 탐구', rec: '과세특', bytes: 600, examples: [{ note: '가나다가 그래프를 그림', result: '그래프를 그려 기울기를 설명함.' }] }])
  await call('seteuk:rows', 'a1', { '1-2': { note: '마바가 풀이를 고침' } })

  console.log('\n1. 저장 · 다시 읽기')
  let all = await call('seteuk:load')
  ok(all.style.on === false && all.style.samples.length === 0 && all.acts[0].examples.length === 1, '처음엔 문체 꺼짐 · 활동의 예시는 저장됨')
  await call('seteuk:style', { on: true, samples: ['라마바는 토론에서 근거를 들어 말함. 끝까지 들음.', '자료를 모아 표로 정리하였고 발표함.'], card: '- 두 문장\n- ~함' })
  all = await call('seteuk:load')
  ok(all.style.on && all.style.samples.length === 2 && all.style.card.includes('두 문장'), '내 문체 저장')

  console.log('\n2. 초안 — 예시 · 문체가 규칙에 들어가고, 그 안의 이름도 가림')
  script = [answer('풀이를 고쳐 다시 설명함.')]
  let r = await call('seteuk:write', { job: 's1', actId: 'a1', ids: ['1-2'] })
  ok(r.ok && r.written === 1, '받음')
  const sys = log[0].body.messages[0].content
  const user = log[0].body.messages[1].content
  ok(sys.includes('# 예시') && sys.includes('그래프를 그려 기울기를 설명함.') && sys.includes('# 문체 예시') && sys.includes('# 내 문체'), '예시 · 문체 예시 · 문체 카드')
  ok(!JSON.stringify(log[0].body).includes('가나다') && !JSON.stringify(log[0].body).includes('라마바') && sys.includes('학생1가 그래프를 그림') && sys.includes('학생2는 토론에서'), '예시 입력 · 예전 세특에 든 이름도 가명으로')
  ok(sys.includes('명사형') || sys.includes('# 서술 규칙'), '규칙 글은 그대로')
  ok(user.includes('쓰기 직전 확인 — 내 문체') && user.includes('- 두 문장'), '문체 카드는 학생 자료 뒤에도')

  console.log('\n3. 문체를 끄면')
  await call('seteuk:style', { ...(await call('seteuk:load')).style, on: false })
  script = [answer('다시 받음.')]
  await call('seteuk:write', { job: 's2', actId: 'a1', ids: ['1-2'] })
  ok(!log[1].body.messages[0].content.includes('문체') && log[1].body.messages[0].content.includes('# 예시') && !log[1].body.messages[1].content.includes('문체'), '문체는 빠지고 예시는 남음')

  console.log('\n4. 키 없이 쓰는 요청 글에도')
  await call('seteuk:style', { ...(await call('seteuk:load')).style, on: true })
  const q = await call('seteuk:request', 'a1', '1-2')
  ok(q.ok && q.text.includes('# 예시') && q.text.includes('# 내 문체') && q.text.includes('쓰기 직전 확인') && !q.text.includes('가나다') && !q.text.includes('라마바'), '예시 · 문체 포함, 이름 가림')

  console.log('\n5. 문체 카드 만들기')
  script = [answer('- 두 문장 안팎\n- 한 일을 먼저 쓰고 고친 점으로 맺음')]
  let c = await call('seteuk:styleCard', null, false)
  ok(c.ok && c.card.startsWith('- 두 문장 안팎'), '카드 받음')
  const cb = log[log.length - 1].body
  ok(cb.messages[0].content.includes('문체를 분석하는 교사') && cb.messages[1].content.startsWith('# 예전에 쓴 세특\n## 1\n학생2는 토론에서') && !JSON.stringify(cb).includes('라마바'), '쓰는 방식만 뽑으라는 규칙 · 예전 세특은 이름을 가려 보냄')
  ok((await call('seteuk:load')).style.card === '- 두 문장\n- ~함', '받은 카드는 화면이 저장할 때까지 바꾸지 않음')
  const before = log.length
  c = await call('seteuk:styleCard', null, true)
  ok(c.ok && c.text.includes('# 예전에 쓴 세특') && !c.text.includes('라마바') && log.length === before, '키 없이 — 요청 글만 돌려주고 보내지 않음')
  await call('seteuk:style', { on: true, samples: ['한 편뿐'], card: '' })
  c = await call('seteuk:styleCard', null, false)
  ok(!c.ok && /두 편/.test(c.error) && log.length === before, `한 편이면 만들지 않음: ${c.error}`)
  script = [() => json({ error: { message: 'x' } }, 401)]
  await call('seteuk:style', { on: true, samples: ['하나.', '둘.'], card: '' })
  c = await call('seteuk:styleCard', null, false)
  ok(!c.ok && c.error, '오류는 까닭과 함께')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
