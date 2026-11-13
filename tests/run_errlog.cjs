// 오류 기록 (logs/error.log) — 화면에서 보낸 오류 · 길이 자르기 · 넘치면 error.1.log 로 밀기. 빌드된 앱의 IPC 로
const path = require('path')
const fs = require('fs')
const { handlers, USER_DATA } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('log:error'); i++) await new Promise((r) => setTimeout(r, 50))
  const file = path.join(USER_DATA, 'logs', 'error.log')

  console.log('1. 화면에서 보낸 오류')
  await call('log:error', { where: '세특', message: 'TypeError: x is undefined', stack: 'TypeError: x is undefined\n    at Seteuk (a.js:1:2)' })
  let text = fs.readFileSync(file, 'utf8')
  ok(/\[화면:세특\] v\d+\.\d+\.\d+ TypeError: x is undefined\n {8}at Seteuk/.test(text), '시각 · 어디서 · 판 · 내용, 여러 줄은 들여 씀')
  await call('log:error', { where: 7, message: { a: 1 } })
  ok(fs.readFileSync(file, 'utf8').includes('[화면:renderer]') && fs.readFileSync(file, 'utf8').includes('(내용 없음)'), '모양이 틀린 값도 죽지 않고 적음')
  await call('log:error', null)
  ok(true, 'null 을 보내도 죽지 않음')

  console.log('\n2. 길이 · 크기')
  await call('log:error', { where: 'x', message: '가'.repeat(20000) })
  const last = fs.readFileSync(file, 'utf8').trim().split('\n').pop()
  ok(last.length < 4200, `한 건은 4,000자까지 (${last.length})`)
  fs.appendFileSync(file, 'x'.repeat(600_000))
  await call('log:error', { where: '다음', message: '새 파일에' })
  ok(fs.existsSync(path.join(USER_DATA, 'logs', 'error.1.log')) && fs.readFileSync(file, 'utf8').includes('새 파일에') && fs.statSync(file).size < 1000, '500KB 를 넘으면 error.1.log 로 밀고 새로 시작')

  console.log('\n3. 폴더 열기')
  const r = await call('log:open')
  ok(r === '' || typeof r === 'string', '오류 기록 폴더 열기')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
