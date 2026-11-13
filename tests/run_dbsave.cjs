// 저장 모으기 (3.8.0~) — 잇달아 바꾸면 한 번만 쓰고, 0.4초 안에는 파일에 들어가며, 내보내기 · 정보 보기 전에는 바로 쓴다
const path = require('path')
const fs = require('fs')
const { handlers, USER_DATA } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const file = path.join(USER_DATA, 'work-dashboard.db')
const inFile = (s) => fs.existsSync(file) && fs.readFileSync(file).includes(Buffer.from(s))

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('setting:set'); i++) await sleep(50)
  await sleep(700)

  console.log('1. 잇달아 바꾸면 모아서 한 번')
  let writes = 0
  const watcher = fs.watch(path.dirname(file), (ev, name) => { if (name === 'work-dashboard.db' && ev === 'rename') writes++ })
  for (let i = 0; i < 50; i++) await call('setting:set', 'save_test', `값-${i}-모으기`)
  ok(!inFile('값-49-모으기'), '바꾼 바로 그때는 아직 파일에 쓰지 않음')
  await sleep(700)
  watcher.close()
  ok(inFile('값-49-모으기'), '0.4초 뒤에는 파일에 들어감')
  ok(writes <= 3, `50번 바꿨는데 파일 쓰기는 ${writes}번`)

  console.log('\n2. 계속 바뀌어도 2초에 한 번은')
  const until = Date.now() + 2600
  let i = 0
  while (Date.now() < until) {
    await call('setting:set', 'save_test2', `계속-${i++}-끝`)
    await sleep(100)
  }
  ok(inFile('계속-') , `쉬지 않고 바꾸는 중에도 파일에 씀 (${i}번 바꿈)`)

  console.log('\n3. 정보 보기 · 내보내기 전에는 바로')
  await call('setting:set', 'save_test3', '바로-쓰기-확인')
  ok(!inFile('바로-쓰기-확인'), '아직 안 씀')
  const info = await call('data:info')
  ok(inFile('바로-쓰기-확인') && info.sizeKb > 0, 'data:info 가 먼저 씀 (파일 크기가 맞게)')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
