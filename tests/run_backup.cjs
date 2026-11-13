// 날마다 자동 백업 · 지금 백업 · 되돌리기 (3.8.0~). 빌드된 앱의 IPC 로
const path = require('path')
const fs = require('fs')
const { handlers, USER_DATA } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)
const dir = path.join(USER_DATA, 'backups')
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// 예전 날마다 백업 아홉 개 · 다른 종류 하나를 미리 둔다 (빈 파일이어도 지우기 시험에는 된다)
fs.mkdirSync(dir, { recursive: true })
for (let i = 1; i <= 9; i++) fs.writeFileSync(path.join(dir, `날마다_2026-01-0${i}.db`), '')
fs.writeFileSync(path.join(dir, '정리전_시험_1.db'), '')

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('backup:list'); i++) await new Promise((r) => setTimeout(r, 50))

  console.log('1. 날마다 자동 백업 (켠 뒤 잠시 뒤)')
  const today = path.join(dir, `날마다_${ymd(new Date())}.db`)
  for (let i = 0; i < 60 && !fs.existsSync(today); i++) await new Promise((r) => setTimeout(r, 500))
  ok(fs.existsSync(today) && fs.statSync(today).size > 0, '오늘 날짜 백업이 생김')
  const daily = fs.readdirSync(dir).filter((f) => f.startsWith('날마다_'))
  ok(daily.length === 7 && daily.includes(`날마다_${ymd(new Date())}.db`) && !daily.includes('날마다_2026-01-01.db') && !daily.includes('날마다_2026-01-03.db') && daily.includes('날마다_2026-01-09.db'), `최근 7개만 (${daily.length})`)
  ok(fs.existsSync(path.join(dir, '정리전_시험_1.db')), '다른 종류 백업은 지우지 않음')

  console.log('\n2. 목록 · 지금 백업')
  await call('setting:set', 'backup_test', '처음 값')
  const now = await call('backup:now')
  ok(now.ok && /직접_/.test(now.message), now.message)
  const list = await call('backup:list')
  ok(list.length >= 9 && list[0].kind === '직접' && list.some((x) => x.kind === '날마다') && list.some((x) => x.kind === '정리 전') && list.every((x) => typeof x.at === 'number'), '목록 — 새것부터, 종류 이름')

  console.log('\n3. 되돌리기')
  await call('setting:set', 'backup_test', '바뀐 값')
  const r = await call('backup:restore', list[0].file)
  ok(r.ok && (await call('setting:get', 'backup_test', '')) === '처음 값', `되돌림: ${r.message}`)
  ok(fs.readdirSync(dir).some((f) => f.startsWith('되돌리기전_')), '되돌리기 전 상태도 백업으로 남음')
  ok((await call('backup:list')).some((x) => x.kind === '되돌리기 전'), '목록에 "되돌리기 전"')

  console.log('\n4. 이상한 요청')
  ok(!(await call('backup:restore', '../../settings.json')).ok, '폴더 밖 경로는 거절')
  ok(!(await call('backup:restore', 'sub/날마다_x.db')).ok, '하위 경로도 거절')
  ok(!(await call('backup:restore', '없는파일.db')).ok, '없는 파일')
  fs.writeFileSync(path.join(dir, '직접_망가짐.db'), 'not a database')
  const bad = await call('backup:restore', '직접_망가짐.db')
  ok(!bad.ok && /망가져/.test(bad.message) && (await call('setting:get', 'backup_test', '')) === '처음 값', '망가진 백업은 열지 않고 지금 자료는 그대로')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
