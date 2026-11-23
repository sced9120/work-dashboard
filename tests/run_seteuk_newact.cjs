// 스캔한 표 → 새 활동 만들기 — 빌드된 앱의 IPC 로 (seteuk:acts · seteuk:rows · seteuk:load). 이름은 지어낸 것
const path = require('path')
const { loadShared: load } = require('./tsload.cjs')
const B = load('batchSend.ts')
const { handlers } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('seteuk:acts'); i++) await new Promise((r) => setTimeout(r, 50))
  const students = [{ id: '1-1', cls: '1', no: '1', name: '가나다' }, { id: '1-2', cls: '1', no: '2', name: '라마바' }]
  await call('seteuk:roster', 'subject', students)
  const before = (await call('seteuk:load')).acts.length

  console.log('1. 표로 새 활동 만들기')
  const sheet = [{ header: ['학번', '이름', '탐구 주제', '소감'], rows: [['10101', '가나다', '급식 잔반', '그래프가 어려웠다'], ['10102', '라마바', '교통량', '단위를 맞춤']] }]
  const plan = B.planNewActFromSheets(sheet, students, { id: 'act_scan_t', name: '스캔한 표 활동', rec: '과세특', subject: '통계' })
  const all0 = await call('seteuk:load')
  await call('seteuk:acts', [...all0.acts, plan.act])
  await call('seteuk:rows', plan.act.id, plan.patch)
  const all = await call('seteuk:load')
  const a = all.acts.find((x) => x.id === 'act_scan_t')
  ok(all.acts.length === before + 1 && a && a.name === '스캔한 표 활동' && a.rec === '과세특' && a.subject === '통계', '새 활동이 만들어짐 (기존 활동은 그대로)')
  ok(JSON.stringify(a.columns) === JSON.stringify(['탐구 주제', '소감']), `입력 항목: ${a && a.columns}`)
  const r = all.rows.act_scan_t
  ok(r['1-1'].fields['탐구 주제'] === '급식 잔반' && r['1-1'].fields['소감'] === '그래프가 어려웠다', '학생마다 칸별로 저장됨')
  ok(r['1-1'].note === '탐구 주제: 급식 잔반\n소감: 그래프가 어려웠다' && r['1-2'].fields['소감'] === '단위를 맞춤', '관찰 기록은 항목: 글 로 이어짐')

  console.log('\n2. 폴더째 정리 결과로')
  const rows = [{ sid: '10101', name: '가나다', result: { items: { 주제: 'P', '느낀 점': 'Q' }, seteuk: '가나다 세특' } }]
  const p2 = B.planNewActFromBatch(rows, students, ['주제', '느낀 점'], { id: 'act_scan_b', name: '폴더 활동', rec: '과세특' }, { note: true, ai: true })
  await call('seteuk:acts', [...(await call('seteuk:load')).acts, p2.act])
  await call('seteuk:rows', p2.act.id, p2.patch)
  const r2 = (await call('seteuk:load')).rows.act_scan_b
  ok(r2['1-1'].fields['주제'] === 'P' && r2['1-1'].ai === '가나다 세특', '항목은 칸으로 · 세특 초안은 AI 초안으로')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})()
