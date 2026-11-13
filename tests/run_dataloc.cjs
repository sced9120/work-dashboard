// 자료 폴더 고르기 (3.7.1~) — 다른 폴더로 켜기 · 잠금 · 옮기기 · 있던 자료 쓰기 / 덮어쓰기 · 기본으로 되돌리기. 빌드된 앱의 IPC 로
const path = require('path')
const fs = require('fs')
const os = require('os')
const { handlers, next, USER_DATA } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const has = (file, s) => fs.existsSync(file) && fs.readFileSync(file).includes(Buffer.from(s))

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-loc-'))
const dirA = path.join(root, 'USB')
const dirB = path.join(root, 'OneDrive', '오르빗')
const dirC = path.join(root, '다른PC가쓰는곳')
const dirD = path.join(root, '자료있는곳')
for (const d of [dirA, dirB, dirC, dirD]) fs.mkdirSync(d, { recursive: true })
// 켜기 전에 자료 폴더를 dirA 로 정해 둔다
fs.writeFileSync(path.join(USER_DATA, 'data-location.json'), JSON.stringify({ dir: dirA }))

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('data:location'); i++) await sleep(50)

  console.log('1. 정해 둔 폴더로 켜기')
  let loc = await call('data:location')
  ok(loc.custom && loc.dir === dirA && loc.defaultDir === USER_DATA, '자료 폴더 = USB 폴더')
  ok(fs.existsSync(path.join(dirA, 'work-dashboard.lock')) && JSON.parse(fs.readFileSync(path.join(dirA, 'work-dashboard.lock'), 'utf8')).pc === os.hostname(), '잠금 파일에 이 PC 이름')
  await call('setting:set', 'loc_test', 'USB-에-저장')
  await call('data:info')
  ok(has(path.join(dirA, 'work-dashboard.db'), 'USB-에-저장') && !has(path.join(USER_DATA, 'work-dashboard.db'), 'USB-에-저장'), '저장은 USB 폴더에 (기본 폴더에는 안 씀)')
  ok(fs.existsSync(path.join(USER_DATA, 'backups')) && !fs.existsSync(path.join(dirA, 'backups')), '백업은 이 PC 에 (USB 에 두지 않음)')

  console.log('\n2. 다른 PC 가 쓰는 폴더는 거절')
  fs.writeFileSync(path.join(dirC, 'work-dashboard.lock'), JSON.stringify({ pc: '교무실-PC', user: 'x', at: Date.now() - 60000 }))
  next.open.push([dirC])
  let r = await call('data:chooseLocation')
  ok(!r.ok && /교무실-PC/.test(r.message), r.message)
  fs.writeFileSync(path.join(dirC, 'work-dashboard.lock'), JSON.stringify({ pc: '교무실-PC', user: 'x', at: Date.now() - 3600000 }))

  console.log('\n3. 빈 폴더로 옮기기')
  next.open.push([dirB])
  r = await call('data:chooseLocation')
  ok(r.ok && has(path.join(dirB, 'work-dashboard.db'), 'USB-에-저장'), '지금 자료를 새 폴더로 씀')
  ok(JSON.parse(fs.readFileSync(path.join(USER_DATA, 'data-location.json'), 'utf8')).dir === dirB, '다음에 켤 때 그 폴더 (다시 시작)')
  await sleep(500)

  console.log('\n4. 자료가 있는 폴더 — [그 폴더의 자료 쓰기] (창의 첫 단추)')
  fs.copyFileSync(path.join(dirB, 'work-dashboard.db'), path.join(dirD, 'work-dashboard.db'))
  const before = fs.readdirSync(path.join(USER_DATA, 'backups')).length
  next.open.push([dirD])
  r = await call('data:chooseLocation')
  ok(r.ok && JSON.parse(fs.readFileSync(path.join(USER_DATA, 'data-location.json'), 'utf8')).dir === dirD && fs.readdirSync(path.join(USER_DATA, 'backups')).length === before + 1, '그 폴더로 정하고 지금 자료는 백업')
  next.open.push([dirC])
  r = await call('data:chooseLocation')
  ok(r.ok, '오래된 잠금이 있는 폴더는 옮길 수 있음')

  console.log('\n5. 이상한 폴더')
  next.open.push([])
  ok((await call('data:chooseLocation')).message === '취소했습니다.', '취소')
  next.open.push([dirA])
  ok(/지금 쓰는 폴더/.test((await call('data:chooseLocation')).message), '지금 쓰는 폴더')

  console.log('\n6. 이 PC 기본 폴더로 되돌리기 — [지금 자료를 이 PC 로 가져오기]')
  r = await call('data:resetLocation')
  ok(r.ok && has(path.join(USER_DATA, 'work-dashboard.db'), 'USB-에-저장') && !fs.existsSync(path.join(USER_DATA, 'data-location.json')), '지금 자료를 이 PC 로 · 정해 둔 폴더 지움')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
