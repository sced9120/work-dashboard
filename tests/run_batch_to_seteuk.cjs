// 문서 스캔 · 정리 결과 → 세특 활동으로 보내기. 화면이 하는 차례 그대로(seteuk:load → 계획 → seteuk:rows → 다시 읽기)
// 빌드된 앱의 IPC 로. 이름은 지어낸 것
const path = require('path')
const { handlers } = global.__it
const { loadShared: load } = require('./tsload.cjs')
const S = load('seteuk.ts')
const B = load('batchSend.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('seteuk:load'); i++) await new Promise((r) => setTimeout(r, 50))

  const roster = S.parseRoster('1\t1\t가나다\n1\t2\t라마바\n1\t3\t사아자').students
  await call('seteuk:roster', 'subject', roster)
  await call('seteuk:acts', [{ id: 'a1', name: '함수 탐구', rec: '과세특' }])
  await call('seteuk:rows', 'a1', { '1-2': { note: '이미 적은 관찰', final: '다듬은 글' } })

  const items = ['주제', '느낀 점']
  const mk = (sid, name) => ({ sid, name, files: [], result: { items: { 주제: `${name} 주제`, '느낀 점': `${name} 소감` }, score: '', scoreReason: '', seteuk: `${name} 세특 초안`, note: '' } })
  const batch = [mk('10101', '가나다'), mk('10102', '라마바'), mk('10399', '없는이')]

  const send = async (opt) => {
    const all = await call('seteuk:load')
    const act = all.acts.find((a) => a.id === 'a1')
    const plan = B.planBatchSend(batch, all.rosters[S.modeOfRec(act.rec)], act, all.rows[act.id] ?? {}, items, opt)
    await call('seteuk:rows', act.id, plan.patch)
    return { plan, after: (await call('seteuk:load')).rows.a1 }
  }

  console.log('1. 빈 칸에만 넣기')
  const r1 = await send({ note: true, ai: true, overwrite: false })
  ok(r1.plan.matched === 2 && r1.plan.missed.length === 1 && r1.plan.missed[0] === '10399 없는이', `2명 맞춤 · 1명 못 찾음: ${JSON.stringify(r1.plan.missed)}`)
  ok(r1.after['1-1'].note === '주제: 가나다 주제\n느낀 점: 가나다 소감' && r1.after['1-1'].ai === '가나다 세특 초안', '가나다에게 관찰 기록 · AI 초안이 들어감')
  ok(r1.after['1-2'].note === '이미 적은 관찰', '라마바의 있던 관찰 기록은 그대로')
  ok(r1.after['1-2'].ai === '라마바 세특 초안' && r1.after['1-2'].final === '다듬은 글', '라마바의 빈 초안은 채우고 최종본은 그대로(다른 칸을 덮지 않음)')
  ok(!r1.after['1-3'], '명단에 없는 학생은 아무것도 안 생김')

  console.log('2. 다시 보내면 — 빈 칸에만이라 그대로')
  const r2 = await send({ note: true, ai: true, overwrite: false })
  ok(Object.keys(r2.plan.patch).length === 0 && r2.plan.kept === 2, '넣을 칸이 없어 건너뜀')

  console.log('3. 덮어쓰기 · 초안만')
  const r3 = await send({ note: false, ai: true, overwrite: true })
  ok(r3.after['1-2'].note === '이미 적은 관찰' && r3.after['1-2'].ai === '라마바 세특 초안', '초안만 보내면 관찰 기록은 안 건드림')
  const r4 = await send({ note: true, ai: false, overwrite: true })
  ok(r4.after['1-2'].note.startsWith('주제: 라마바 주제') && r4.after['1-2'].final === '다듬은 글', '덮어쓰기는 관찰 기록을 바꾸고 최종본은 그대로')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})()
