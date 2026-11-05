// 메신저 정리 · 폰에서 보내기 — 빌드된 앱의 IPC 로 (이름은 모두 지어낸 것)
const path = require('path')
const fs = require('fs')
const { handlers, next, USER_DATA } = global.__it
let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

const log = []
let script = []
const json = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) })
global.fetch = async (url, opts = {}) => {
  const entry = { url: String(url), body: opts.body }
  log.push(entry)
  const step = script.shift()
  if (!step) throw new Error('예상 못 한 요청 ' + url)
  return step(entry)
}
const gemini = (text) => () => json({ candidates: [{ content: { parts: [{ text }] } }] })

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('msg:extract'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'gemini', gemini_key: 'TEST-GEMINI', gemini_model: 'gemini-test' })
  await call('setting:set', 'att_roster', JSON.stringify({ cls: '2-4', students: [{ no: 3, name: '강하늘' }, { no: 7, name: '서민준' }, { no: 8, name: '이민준' }, { no: 12, name: '윤채원' }] }))

  console.log('1. 가리기')
  const text = '[교무부 박서준 부장] 11/14(금)까지 수행평가 계획서를 올려 주세요. 문의 010-1234-5678\n선생님, 2학년 4반 12번 채원이 엄마입니다. 오늘 장염으로 병원 들렀다 늦게 갑니다.\n강하늘 학생 체험학습 신청서 냈습니다. 민준이는 내일 결석해요.'
  const masked = await call('msg:mask', text)
  ok(!/강하늘|윤채원|채원이|박서준/.test(masked), '학생 · 교사 이름이 남지 않음')
  ok(masked.includes('학생12') && masked.includes('학생3') && masked.includes('사람A'), `학생은 번호, 다른 사람은 사람A: ${masked.split('\n')[1].slice(0, 40)}`)
  ok(!masked.includes('010-1234-5678'), '전화번호 지움')
  ok(masked.includes('민준이는'), '성 없는 이름이 두 학생과 같으면(서민준 · 이민준) 건드리지 않음')

  console.log('\n2. 뽑기 — 보낸 글 · 되돌린 답')
  script = [gemini(JSON.stringify({
    todos: [{ title: '수행평가 계획서 제출', due: '2026-11-14', time: '', kind: '기한', from: '교무부 사람A 부장', note: '' }],
    attendance: [
      { who: '학생12', date: '2026-11-05', type: '지각', reason: '질병', note: '장염, 병원 들렀다 등교', proof: '필요' },
      { who: '학생3', date: '2026-11-06', type: '결석', reason: '출석인정', note: '체험학습', proof: '냄' }
    ]
  }))]
  const r = await call('msg:extract', text, { provider: 'gemini', model: 'gemini-test' })
  const sent = JSON.parse(log[log.length - 1].body)
  const prompt = JSON.stringify(sent)
  ok(r.ok, `정리됨 ${r.error ?? ''}`)
  ok(!/강하늘|윤채원|박서준|010-1234/.test(prompt) && prompt.includes('학생12'), 'AI 에는 가린 글만 감')
  ok(r.result.todos[0].from === '교무부 박서준 부장', '답의 가명은 실명으로 되돌림')
  ok(r.result.attendance[0].no === 12 && r.result.attendance[0].who === '윤채원' && r.result.attendance[1].no === 3, '학생N → 명단 번호 · 이름')

  console.log('\n3. 키가 없으면')
  await call('local:save', { ...(await call('local:load')), gemini_key: '' })
  const r2 = await call('msg:extract', '내일 회의', { provider: 'gemini', model: 'gemini-test' })
  ok(!r2.ok && /키/.test(r2.error), `오류 안내: ${r2.error}`)

  console.log('\n4. 폰에서 보내기')
  let info = await call('relay:info')
  ok(!info.hasKey && !info.connected, '처음엔 없음')
  info = await call('relay:newKey')
  ok(info.hasKey && info.script.includes('function doGet') && !info.connected, '코드 만들기')
  const key = info.script.match(/var KEY = '([A-Za-z0-9]+)'/)[1]
  const bad = await call('relay:connect', 'https://example.com/x')
  ok(!bad.ok && /모양/.test(bad.error), '주소 모양 확인')
  const url = 'https://script.google.com/macros/s/AKfycbTEST1234567890abcdefgh/exec'
  script = [(e) => (e.url.includes(`k=${key}`) && e.url.includes('op=ping') ? json({ ok: true, n: 0 }) : json({ ok: false }))]
  const c = await call('relay:connect', url)
  ok(c.ok && c.info.connected && c.info.phone === `${url}?k=${key}`, '잇기 → 폰 주소')
  script = [() => json({ ok: true, items: [{ id: '1-1', t: 1, text: '폰에서 온 글 하나' }, { id: '2-2', t: 2, text: '둘' }] }), (e) => (e.url.includes('op=ack') && e.url.includes('ids=1-1%2C2-2') ? json({ ok: true }) : json({ ok: false }))]
  const p = await call('relay:pull')
  ok(p.ok && p.added === 2 && script.length === 0, '가져오고 우편함에서 지움(ack)')
  ok((await call('inbox:list')).length === 2, '받은 글함에 둘')
  script = [() => json({ ok: true, items: [{ id: '2-2', t: 2, text: '둘' }] }), () => json({ ok: true })]
  ok((await call('relay:pull')).added === 0 && (await call('inbox:list')).length === 2, '같은 글은 두 번 넣지 않음')
  await call('inbox:remove', ['1-1'])
  ok((await call('inbox:list')).length === 1, '받은 글 지우기')
  script = [() => ({ ok: true, status: 200, text: async () => '<html>로그인</html>', json: async () => { throw new Error('x') } })]
  const p2 = await call('relay:pull')
  ok(!p2.ok && /모든 사용자/.test(p2.error), `HTML 이 오면 배포 설정 안내: ${p2.error}`)

  console.log('\n5. 인수인계 파일에는 명단 · 출결 · 받은 글이 들어가지 않음')
  await call('setting:set', 'att_records', JSON.stringify([{ id: 'a', date: '2026-11-05', no: 12, type: '지각', reason: '질병', note: '장염', proof: '필요', neis: false }]))
  const out = path.join(USER_DATA, 'h.db')
  next.save.push(out)
  ok((await call('data:export', false)).ok, '내보내기')
  const bytes = fs.readFileSync(out).toString('utf8')
  ok(!bytes.includes('윤채원') && !bytes.includes('장염') && !bytes.includes('폰에서 온 글'), '학생 이름 · 출결 · 받은 글 없음')
  // 시험 환경은 암호화를 못 쓰는 PC 처럼 꾸며져 있어 plain 칸에 들어간다 — AI 키와 같은 자리인지만 본다
  const local = JSON.parse(fs.readFileSync(path.join(USER_DATA, 'settings.json'), 'utf8'))
  ok((local.plain?.relay_key === key || !!local.enc?.relay_key) && !('relay_key' in local), '열쇠는 AI 키와 같은 칸에 (암호화되는 PC 에서는 암호화)')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
