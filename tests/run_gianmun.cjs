// 받은 공문으로 기안문 쓰기 — 빌드된 앱의 IPC 로 (gianmun:draft · gianmun:save). AI 는 가로채 가짜로 답한다.
const path = require('path')
const fs = require('fs')
const AdmZip = require(path.join(__dirname, '../node_modules/adm-zip'))
const { handlers, next, USER_DATA } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

const log = []
let reply = ''
global.fetch = async (url, opts = {}) => {
  log.push({ url: String(url), body: opts.body ? String(opts.body) : '' })
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
}

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('gianmun:draft'); i++) await new Promise((r) => setTimeout(r, 50))
  ok(handlers.has('gianmun:draft') && handlers.has('gianmun:save'), 'gianmun:draft · gianmun:save 처리기가 있음')
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'exaone', exaone_key: 'TEST-EXAONE', gemini_key: '', openai_key: '', claude_key: '' })

  const content = [
    '○○교육청',
    '수신 각급학교장',
    '제목 2026학년도 가나다 연수 참가 신청 안내',
    '1. 관련: 교육부 정책과-1(2026. 1. 2.)',
    '2. 담당자 연락처는 010-1234-5678, 이메일 kana@example.com 입니다.',
    '시행 교육과-1234 (2026. 3. 5.)'
  ].join('\n')
  const id = await call('docs:add', { filename: '가나다 안내.txt', doc_kind: '개별 공문', doc_date: '2026. 3. 5.', added_at: '2026-03-06', content })
  ok(id > 0, `보관 공문 추가: ${id}`)

  console.log('1. 초안 만들기')
  reply = '가나다 연수 참가 신청\n1.관련: ○○교육청 교육과-1234(2026. 3. 5.) 「2026학년도 가나다 연수 참가 신청 안내」\n2.위 호와 관련하여 아래와 같이 신청합니다.\n  가.참가 대상: ○○명\n붙임 1. 신청서 1부.'
  const r = await call('gianmun:draft', { docId: id, kind: 'apply', extra: '문의는 010-9999-8888 로', model: { provider: 'exaone', model: 'k-exaone_v2.5' } })
  ok(r.ok, `성공: ${r.error || ''}`)
  const req = log[log.length - 1].body
  ok(req.includes('가나다 연수 참가 신청 안내') && req.includes('교육과-1234'), '공문 내용과 관련 줄이 감')
  ok(!req.includes('010-1234-5678') && !req.includes('kana@example.com') && !req.includes('010-9999-8888'), '전화번호 · 이메일은 가려서 보냄')
  ok(r.text.includes('1. 관련: ○○교육청') && r.text.includes('  가. 참가 대상') && r.text.includes('붙임  1. 신청서 1부.'), '번호 · 붙임 다듬음')
  ok(r.text.endsWith('끝.'), `끝. 로 끝남: ${r.text.slice(-10)}`)
  const bad = await call('gianmun:draft', { docId: 99999, kind: 'reply' })
  ok(!bad.ok && bad.error, '없는 공문이면 오류')

  console.log('\n2. 한글로 저장')
  const out = path.join(USER_DATA, 'gianmun.hwpx')
  next.save.push(out)
  const sv = await call('gianmun:save', { name: '가나다 연수 참가 신청', text: r.text })
  ok(sv.ok && sv.path === out && fs.existsSync(out), `저장함: ${sv.message}`)
  const zip = new AdmZip(out)
  ok(zip.getEntries()[0].entryName === 'mimetype', '첫 항목은 mimetype')
  const sec = zip.readAsText('Contents/section0.xml')
  ok(sec.includes('관련'), 'section0.xml 에 관련')
  ok(sec.includes('1. 관련'), '글자 그대로 "1. 관련" (목록으로 바뀌지 않음)')
  ok(sec.includes('가. 참가 대상') && sec.includes('끝.'), '가. 항목 · 끝. 도 글자로 있음')
  ok(!/\\./.test(sec), '역슬래시 흔적 없음')
  const cancel = await call('gianmun:save', { name: 'x', text: '1. 가나다' })
  ok(!cancel.ok && cancel.message === '저장을 취소했습니다.', '저장 창에서 취소하면 파일 없음')
  ok(!(await call('gianmun:save', { text: '  ' })).ok, '빈 글은 저장 안 함')

  if (fails) { console.log(`\n실패 ${fails}`); process.exit(1) }
  console.log('\n모두 통과')
  process.exit(0)
})().catch((e) => { console.error(e); process.exit(1) })
