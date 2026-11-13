// 세특 작성실 — 모드(교과 · 동아리 · 담임)별 명단 · 기본 활동 · 체험 자료 · 키 없이 쓰는 요청 글.
// 빌드된 앱의 IPC 로. AI 는 가로채 가짜로 답한다(진짜 키를 쓰지 않는다). 이름은 지어낸 것
const path = require('path')
const fs = require('fs')
const { handlers, next, USER_DATA } = global.__it
const { loadShared: load } = require('./tsload.cjs')
const S = load('seteuk.ts')
const D = load('seteukDemo.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

const log = []
let script = []
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
global.fetch = async (url, opts = {}) => {
  const entry = { url: String(url), body: opts.body ? JSON.parse(opts.body) : null }
  log.push(entry)
  const step = script.shift()
  if (!step) throw new Error('예상 못 한 요청 ' + url)
  return step(entry)
}

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('seteuk:demoFill'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'exaone', exaone_key: 'TEST-EXAONE', gemini_key: '', openai_key: '', claude_key: '' })

  console.log('1. 처음 — 모드마다 쓸 활동이 만들어져 있음')
  let all = await call('seteuk:load')
  ok(all.acts.length === 5 && S.SETEUK_MODES.every((m) => all.acts.some((a) => S.modeOfRec(a.rec) === m.key)), `기본 활동: ${all.acts.map((a) => a.name).join(', ')}`)
  ok((await call('seteuk:load')).acts.length === 5, '다시 열어도 겹쳐 만들지 않음')

  console.log('\n2. 체험 자료')
  ok(all.demo.canFill && !all.demo.filled, '명단이 비어 있으면 넣을 수 있음')
  ok((await call('seteuk:demoFill')).ok, '넣기')
  all = await call('seteuk:load')
  ok(all.rosters.subject.length === 6 && all.rosters.club.length === 5 && all.rosters.homeroom.length === 5, '교과 6명 · 동아리 5명 · 담임 5명 — 서로 다른 학생')
  ok(all.acts.length === 11 && all.acts[0].id === 'demo_model' && all.demo.filled && !all.demo.canFill, '체험 활동이 앞에 · 기본 활동은 그대로')
  ok(all.rows.demo_model['3-1'].final.includes('기울기') && all.rows.demo_club['2-7'].final.includes('암호') && all.rows.demo_behavior['4-4'].final.includes('급식실'), '관찰 기록 · 초안 · 최종본이 채워져 있음')
  ok(!(await call('seteuk:demoFill')).ok, '두 번 넣지 않음')

  console.log('\n3. 모드별 명단 — 초안은 그 활동의 모드 명단으로, 이름은 세 명단 모두 가림')
  await call('seteuk:rows', 'demo_club', { '3-21': { note: '차은호와 강하늘이 도와 줘서 주제를 정함. 은호가 만든 암호를 풀어 봄' } })
  script = [() => json({ choices: [{ message: { content: '주제를 정하고 암호를 풀어 봄.' } }] })]
  let r = await call('seteuk:write', { job: 'm1', actId: 'demo_club', ids: ['3-21', '3-1', '4-1'] })
  ok(r.ok && r.written === 1 && log.length === 1, `동아리 활동은 동아리 부원만 (교과 · 담임 학생 번호는 받지 않음): ${JSON.stringify(r)}`)
  const sent = JSON.stringify(log[0].body)
  ok(!sent.includes('차은호') && !sent.includes('강하늘') && !sent.includes('은호가'), '다른 명단의 학생 이름 · 성 없는 이름도 가려 보냄')
  ok(log[0].body.messages[0].content.includes('동아리활동 특기사항') && log[0].body.messages[0].content.includes('600바이트'), '동아리 규칙 · 분량으로')

  console.log('\n4. 키 없이 — 요청 글')
  let q = await call('seteuk:request', 'demo_club', '3-21')
  ok(q.ok && q.text.startsWith('# 역할') && q.text.includes('[학생 자료]') && !q.text.includes('차은호') && !q.text.includes('강하늘') && q.text.includes('학생'), '규칙 + 이름을 가린 관찰 기록')
  q = await call('seteuk:request', 'demo_club', '5-4')
  ok(!q.ok && /관찰 기록/.test(q.error), `관찰 기록이 없으면: ${q.error}`)
  ok(!(await call('seteuk:request', '없는활동', '3-21')).ok, '없는 활동')
  ok(log.length === 1, '요청 글을 만들 때는 바깥으로 나가지 않음')

  console.log('\n5. 취합 · 나이스도 그 영역의 모드 명단으로')
  script = [() => json({ choices: [{ message: { content: '두 활동을 하나로 줄인 글.' } }] })]
  r = await call('seteuk:compress', { job: 'm2', rec: '과세특', ids: ['3-1', '2-7', '4-1'] })
  ok(r.ok && r.written === 1, '과세특은 교과 명단 학생만')
  ok((await call('seteuk:sums')).과세특['3-1'].final === '두 활동을 하나로 줄인 글.', '한도를 넘던 학생(체험: 강하늘)은 압축본이 최종본으로')

  console.log('\n6. 엑셀 · 인수인계')
  const out = path.join(USER_DATA, '체험.xlsx')
  next.save.push(out)
  ok((await call('seteuk:xlsxExport')).ok && fs.statSync(out).size > 5000, '엑셀로 내보내기')
  const h = path.join(USER_DATA, 'h.db')
  next.save.push(h)
  await call('data:export', true)
  const bytes = fs.readFileSync(h).toString('utf8')
  ok(!bytes.includes('강하늘') && !bytes.includes('seteuk_roster_club') && !bytes.includes('seteuk_demo'), '모드별 명단 · 체험 표시도 인수인계 파일에 없음')

  console.log('\n7. 체험 자료 지우기 — 체험이 만든 것만')
  await call('seteuk:roster', 'homeroom', [...(await call('seteuk:load')).rosters.homeroom, { id: '4-9', cls: '4', no: '9', name: '진짜학생' }])
  const mine = (await call('seteuk:load')).acts.concat([{ id: 'my1', name: '내가 만든 활동', rec: '자율' }])
  await call('seteuk:acts', mine)
  await call('seteuk:rows', 'my1', { '4-9': { note: '내가 적은 글' } })
  await call('seteuk:demoClear')
  all = await call('seteuk:load')
  ok(all.rosters.subject.length === 0 && all.rosters.club.length === 0 && all.rosters.homeroom.map((x) => x.name).join() === '진짜학생', '체험 학생만 지우고 넣은 학생은 그대로')
  ok(all.acts.length === 6 && !all.acts.some((a) => a.id.startsWith('demo_')) && all.rows.my1['4-9'].note === '내가 적은 글', '체험 활동만 지우고 만든 활동 · 글은 그대로')
  ok(!('3-1' in (await call('seteuk:sums')).과세특) && !all.demo.filled && !all.demo.canFill, '취합에 남은 체험 글도 지움 · 실제 학생이 있으니 다시 넣을 수 없음')
  await call('seteuk:acts', [])
  ok((await call('seteuk:load')).acts.length === 0, '활동을 모두 지운 뒤에는 기본 활동을 다시 만들지 않음')

  console.log('\n8. 체험 글은 검사를 통과하는 글')
  let bad = []
  for (const a of D.DEMO_ACTS) for (const [id, row] of Object.entries(D.DEMO_ROWS[a.id] || {})) {
    if (!row.final) continue
    const v = S.validateSeteuk(row.final, S.limitOf(a))
    if (!v.ok || v.issues.some((x) => x.label !== '분량 부족')) bad.push(`${a.id} ${id}: ${v.issues.map((x) => x.label + '(' + x.hit + ')').join(', ')}`)
  }
  ok(!bad.length, `최종본에 고칠 곳 · 살펴볼 곳이 없음 ${bad.join(' / ')}`)
  const flawed = S.validateSeteuk(D.DEMO_FLAWED, 600)
  ok(!flawed.ok && flawed.issues.some((x) => x.label === '맞춤법') && flawed.issues.some((x) => x.label.startsWith('AI 투')) && flawed.issues.some((x) => x.level === 'block'), '일부러 넣은 초안은 어미 · AI 말투 · 띄어쓰기가 걸림')
  const names = Object.values(D.DEMO_ROSTERS).flat().map((x) => x.name)
  ok(new Set(names).size === 16 && Object.values(D.DEMO_ROWS).every((rows) => Object.values(rows).every((row) => !names.some((n) => (row.ai + row.final).includes(n)))), '지어낸 학생 16명 · 글에 이름이 없음')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
