// 폰 연결 v2 — 폰에서 온 수업 관찰 · 출결을 세특 관찰 기록 · 출결 기록에 넣고, 폰 판을 올린다. 업무 도우미의 출결 근거 · 출결 넣기.
// 빌드된 앱의 IPC 로. 우편함(Apps Script)과 AI 는 가로채 가짜로 답한다. 이름은 지어낸 것
const path = require('path')
const { handlers } = global.__it
const { loadShared: load } = require('./tsload.cjs')
const Ag = load('agent.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({ sender: { send: () => {} } }, ...args)

const log = []
let script = []
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
global.fetch = async (url, opts = {}) => {
  const entry = { url: String(url), body: opts.body ? String(opts.body) : '' }
  log.push(entry)
  const step = script.shift()
  if (!step) throw new Error('예상 못 한 요청 ' + url)
  return step(entry)
}
const q = (u) => Object.fromEntries(new URL(u).searchParams)
const putOk = (e) => json(q(e.url).op === 'put' ? { ok: true, v: 2 } : { ok: false })
/** log 에서 op=put 으로 올린 name 조각들을 모은다 (from 이후) */
const uploaded = (name, from = 0) => log.slice(from).map((e) => q(e.url)).filter((x) => x.op === 'put' && x.name === name).map((x) => x.b).join('')

console.log('0. 업무 도우미의 출결 일감 (빌드 없이)')
const acts = Ag.parseActions({ 할일: [
  { 종류: '출결', 날짜: '2026-11-13', 번호: 7, 구분: '결석', 사유: '질병', 메모: '병원' },
  { 종류: '출결', 날짜: '2026-11-13', 번호: 8, 구분: '지각', 사유: '모름' },
  { 종류: '출결', 날짜: '11월 13일', 번호: 7, 구분: '결석' },
  { 종류: '출결', 날짜: '2026-11-13', 번호: 7, 구분: '외출' },
  { 종류: '일정', 제목: '회의', 시작일: '2026-11-14' }
] })
ok(acts.length === 3 && acts[0].att.no === 7 && acts[0].att.reason === '질병' && acts[1].att.reason === '기타', '출결 — 날짜 · 구분이 맞는 것만, 모르는 사유는 기타')
const plan = Ag.buildPlan(acts)
ok(plan[0].kind === '출결' && plan[0].label.includes('7번 결석(질병) — 병원') && plan[0].att && !plan[0].event && plan[2].kind === '일정', '펼친 목록 — 출결 한 줄')
ok(Ag.actionGuide('2026-11-13').includes('"종류":"출결"') && Ag.actionGuide('2026-11-13').includes('번호'), '도우미 안내에 출결 넣는 법')

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('relay:pull'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'gemini', gemini_key: 'TEST-GEMINI', openai_key: '', claude_key: '', exaone_key: '' })

  // 세특 명단 · 활동 (교과: 1반 1~3번, 2반 1번) · 담임 반 명단 (2-4, 1~4번)
  await call('seteuk:roster', 'subject', [{ id: '1-1', cls: '1', no: '1', name: '가나다' }, { id: '1-2', cls: '1', no: '2', name: '라마바' }, { id: '1-3', cls: '1', no: '3', name: '사아자' }, { id: '2-1', cls: '2', no: '1', name: '차카타' }])
  await call('seteuk:acts', [{ id: 'a1', name: '함수 탐구', rec: '과세특', bytes: 1500 }, { id: 'a2', name: '실험 보고서', rec: '과세특', bytes: 1500, columns: ['실험 주제', '결과와 오차'] }])
  await call('seteuk:rows', 'a1', { '1-2': { note: '이미 적은 메모' } })
  await call('setting:set', 'att_roster', JSON.stringify({ cls: '2-4', students: [1, 2, 3, 4].map((no) => ({ no, name: '학생' + 'ㄱㄴㄷㄹ'[no - 1] + '이름' })) }))
  await call('setting:set', 'att_records', JSON.stringify([{ id: 'm1', date: '2026-11-13', no: 2, type: '지각', reason: '기타', note: '손으로 넣음', proof: '필요', neis: false }]))

  console.log('\n1. 잇기 — 판 2 를 알아본다')
  const info0 = await call('relay:newKey')
  const key = info0.script.match(/var KEY = '([A-Za-z0-9]+)'/)[1]
  ok(info0.script.includes('function sendItem') && info0.script.includes('(v3)') && info0.latest === 3, '새 코드는 v3')
  const url = 'https://script.google.com/macros/s/AKfycbTEST1234567890abcdefgh/exec'
  script = [() => json({ ok: true, v: 2, n: 0 })]
  const c = await call('relay:connect', url)
  ok(c.ok && c.info.ver === 2 && c.info.phone === `${url}?k=${key}`, '잇기 → 판 2')
  const nkey = c.info.nkey
  ok(/^[A-Za-z0-9_-]{43}$/.test(nkey) && !c.info.phone.includes(nkey) && c.info.rescan === false, '이름표 열쇠 — 폰 주소(쿼리)와 따로, 처음 잇기엔 다시 찍기 안내 없음')
  // 폰 화면의 풀기 함수를 꺼내 노드의 WebCrypto 로 돌린다
  const pageSrc = JSON.parse(info0.script.slice(info0.script.indexOf('var PAGE = ') + 11, info0.script.lastIndexOf(';')))
  const fnLine = (n) => pageSrc.split('\n').find((l) => l.startsWith('function ' + n + '('))
  const unseal = new Function('window', fnLine('unb') + '\n' + fnLine('unseal') + '\nreturn unseal;')(globalThis)
  const open = (sealed, k) => new Promise((res) => unseal(sealed, k, res))

  console.log('\n2. 가져오기 — 판을 먼저 올리고, 넣고, 지운다')
  const items = [
    { id: '10-1', t: 10, kind: 'obs', a: 'a1', c: '1', n: 2, d: '2026-11-13', x: '발표: 기울기를 비교해 설명함' },
    { id: '10-2', t: 11, kind: 'obs', a: 'a1', c: '1', n: 3, d: '2026-11-13', x: '질문: 왜\n음수인지 물음' },
    { id: '10-3', t: 12, kind: 'obs', a: 'a2', c: '1', n: 1, d: '2026-11-14', x: '오차 원인을 찾음' },
    { id: '10-4', t: 13, kind: 'obs', a: 'a1', c: '1', n: 9, d: '2026-11-13', x: '명단에 없는 번호' },
    { id: '10-5', t: 14, kind: 'att', n: 3, d: '2026-11-13', ty: '결석', r: '질병', x: '병원' },
    { id: '10-6', t: 15, kind: 'att', n: 2, d: '2026-11-13', ty: '조퇴', r: '질병', x: '' },
    { id: '10-7', t: 16, kind: 'att', n: 30, d: '2026-11-13', ty: '결석', r: '질병', x: '' },
    { id: '10-8', t: 17, text: '메신저 글 하나' },
    { id: '10-9', t: 18, kind: 'obs', a: 'a1', s: '2-1', g: '2반', c: '2', n: 0, d: '2026-11-13', x: '학생 id 로 찾기' },
    { id: '10-10', t: 19, kind: 'obs', a: 'a1', s: '없는-id', g: '1반', c: '1', n: 1, d: '2026-11-13', x: '모르는 id 면 반 · 번호로' }
  ]
  let ack = ''
  const from2 = log.length
  script = [
    putOk,
    putOk,
    (e) => json(q(e.url).op === 'pull' ? { ok: true, v: 2, items } : { ok: false }),
    (e) => { ack = q(e.url).ids; return json({ ok: true, v: 2 }) }
  ]
  const p = await call('relay:pull')
  ok(p.ok && p.obs === 5 && p.att === 2 && p.added === 3 && script.length === 0, `넣음: 관찰 ${p.obs} · 출결 ${p.att} · 받은 글 ${p.added}`)
  const puts = log.slice(from2, from2 + 2).map((e) => q(e.url))
  ok(puts[0].op === 'put' && puts[0].name === 'board' && puts[0].i === '0' && puts[0].n === '1' && puts[1].name === 'names' && puts[1].n === '1', '판 → 이름표 차례로 op=put 조각 올림')
  const board = JSON.parse(uploaded('board', from2))
  ok(JSON.stringify(board.m.subject) === JSON.stringify([['1반', ['1-1', '1-2', '1-3']], ['2반', ['2-1']]]) && board.a.map((x) => x.n).join() === '함수 탐구,실험 보고서' && board.h.c === '2-4' && board.h.r === '1-4', '판 — 수업반 · 학생 id · 활동 · 담임 반')
  const sealedNames = uploaded('names', from2)
  const allUrls = log.slice(from2).map((e) => decodeURIComponent(e.url)).join('\n')
  ok(!allUrls.includes('가나다') && !allUrls.includes('이름') && !allUrls.includes(nkey) && /^[A-Za-z0-9_-]+$/.test(sealedNames), '우편함으로 가는 주소 어디에도 학생 이름 · 이름표 열쇠 없음 (이름표는 잠근 글)')
  const named = await open(sealedNames, nkey)
  ok(named && JSON.stringify(named.s['1-2']) === JSON.stringify(['1반 2번', '라마바']) && named.s['2-1'][1] === '차카타' && named.h['3'] === '학생ㄷ이름', '폰 화면이 # 열쇠로 이름표를 풂 (학번 없으면 \'1반 2번\')')
  ok((await open(sealedNames, 'A'.repeat(43))) === null, '열쇠가 다르면 못 풂')
  ok(ack.split(',').length === 10, '모두 우편함에서 지움')

  const all = await call('seteuk:load')
  ok(all.rows.a1['1-2'].note === '이미 적은 메모\n[11/13] 발표: 기울기를 비교해 설명함' && all.rows.a1['1-3'].note === '[11/13] 질문: 왜 음수인지 물음', '관찰 기록 뒤에 날짜와 함께 · 줄바꿈은 한 줄로')
  ok(all.rows.a2['1-1'].fields['실험 주제'] === '[11/14] 오차 원인을 찾음' && all.rows.a2['1-1'].note === '실험 주제: [11/14] 오차 원인을 찾음', '입력 항목이 여럿이면 첫 칸에 붙이고 관찰 기록을 다시 이음')
  ok(all.rows.a1['2-1'].note === '[11/13] 학생 id 로 찾기' && all.rows.a1['1-1'].note === '[11/13] 모르는 id 면 반 · 번호로', '학생 id 로 먼저 찾고, 없는 id 면 반 · 번호로')
  const recs = JSON.parse(await call('setting:get', 'att_records', '[]'))
  const r3 = recs.find((r) => r.no === 3)
  ok(r3 && r3.id === 'ph-2026-11-13-3-결석' && r3.reason === '질병' && r3.note === '병원' && r3.proof === '필요' && r3.neis === false, '출결 기록 — 오늘 날짜 · 서류 필요 · 나이스 아직')
  ok(recs.some((r) => r.id === 'm1') && recs.some((r) => r.no === 2 && r.type === '조퇴'), '손으로 넣은 기록은 그대로, 같은 학생의 다른 구분은 따로')
  const inbox = await call('inbox:list')
  ok(inbox.length === 3 && inbox.some((x) => x.text === '메신저 글 하나') && inbox.some((x) => x.text.includes('넣을 곳을 찾지 못함') && x.text.includes('9번')) && inbox.some((x) => x.text.includes('명단에 없는 번호') && x.text.includes('30번')), '글 · 넣지 못한 관찰 · 출결은 받은 글함으로')

  console.log('\n3. 같은 것이 다시 와도 · 고쳐 보내면 · 지우면')
  script = [() => json({ ok: true, v: 2, items: [items[0], { id: '20-1', t: 20, kind: 'att', n: 3, d: '2026-11-13', ty: '지각', r: '미인정', x: '' }] }), () => json({ ok: true })]
  const p2 = await call('relay:pull')
  ok(p2.obs === 0 && (await call('seteuk:load')).rows.a1['1-2'].note.split('[11/13]').length === 2, 'ack 가 실패해 다시 온 관찰은 두 번 붙이지 않음 · 판이 같으면 다시 올리지 않음')
  let recs2 = JSON.parse(await call('setting:get', 'att_records', '[]')).filter((r) => r.no === 3)
  ok(recs2.length === 1 && recs2[0].type === '지각' && recs2[0].proof === '없음', '같은 날 같은 학생을 고쳐 보내면 폰 기록을 바꿈 (미인정은 서류 없음)')
  script = [() => json({ ok: true, v: 2, items: [{ id: '30-1', t: 30, kind: 'att', n: 3, d: '2026-11-13', ty: '지움', r: '', x: '' }] }), () => json({ ok: true })]
  const p3 = await call('relay:pull')
  recs2 = JSON.parse(await call('setting:get', 'att_records', '[]'))
  ok(p3.att === 1 && !recs2.some((r) => r.no === 3) && recs2.some((r) => r.id === 'm1'), '지움 — 폰 기록만 지움')

  console.log('\n4. 활동이 바뀌면 판을 다시 올림 · 예전 판(v1) 스크립트면 올리지 않음')
  await call('seteuk:acts', [{ id: 'a1', name: '함수 탐구 2차', rec: '과세특', bytes: 1500 }])
  const from4 = log.length
  script = [putOk, putOk, () => json({ ok: true, v: 2, items: [] })]
  await call('relay:pull')
  ok(script.length === 0 && JSON.parse(uploaded('board', from4)).a[0].n === '함수 탐구 2차', '바뀐 판을 올림')

  // 3.7.0 전 설정(이름표 열쇠 없음) — 열쇠를 만들고, 주소가 바뀌었으니 QR 을 다시 찍으라고 알림 · 판 · 이름표를 다시 올림
  await call('local:save', { ...(await call('local:load')), relay_nkey: '' })
  const old = await call('relay:info')
  ok(old.rescan === true && /^[A-Za-z0-9_-]{43}$/.test(old.nkey) && old.nkey !== nkey, '예전 설정 → 새 이름표 열쇠 · 다시 찍기 안내')
  const from5 = log.length
  script = [putOk, putOk, () => json({ ok: true, v: 2, items: [] })]
  await call('relay:pull')
  ok(script.length === 0 && (await open(uploaded('names', from5), old.nkey))?.s['1-1'][1] === '가나다', '새 열쇠로 이름표를 다시 잠가 올림')
  ok((await call('relay:seenQr')).rescan === false && (await call('relay:info')).nkey === old.nkey, '[다시 찍었습니다] → 안내 닫힘 · 열쇠 그대로')
  script = [() => json({ ok: true, v: 1, items: [] })]
  await call('relay:pull')
  ok(script.length === 0 && (await call('relay:info')).ver === 1, 'v1 답이면 판 1 로 알고(새 판 안내), 판을 올리지 않음')
  await call('seteuk:acts', [{ id: 'a1', name: '함수 탐구 3차', rec: '과세특', bytes: 1500 }])
  const before = log.length
  script = [() => json({ ok: true, v: 1, items: [] })]
  await call('relay:pull')
  ok(log.length === before + 1 && q(log[before].url).op === 'pull', 'v1 이면 pull 만')

  console.log('\n5. 업무 도우미 — 출결을 물으면 우리 반 출결을 번호로 근거에 싣는다')
  await call('setting:set', 'att_records', JSON.stringify([
    { id: 'ph-2026-11-13-3-결석', date: new Date().toISOString().slice(0, 10), no: 3, type: '결석', reason: '질병', note: '병원', proof: '필요', neis: false }
  ]))
  let body = ''
  script = [(e) => { body = e.body; return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '3번 결석입니다.' }] }, finishReason: 'STOP' }] })}\r\n\r\n`)); c.close() } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }) }]
  const r = await call('ai:chatStream', { reqId: 'z1', mode: 'work', jobTitle: '담임', instruction: '', history: [{ role: 'user', content: '오늘 우리 반 결석한 학생 정리해 줘. 학생ㄷ이름 서류는?' }], model: { provider: 'gemini', model: 'gemini-test' } })
  const sys = JSON.parse(body).systemInstruction.parts[0].text
  ok(r.ok !== false && sys.includes('우리 반 출결 기록') && /3번 결석\(질병\) — 병원 \[서류 아직 · \d+\. \d+\.\([일월화수목금토]\)까지\] \[나이스 아직\] \[폰으로 넣음\]/.test(sys), '오늘 출결 · 챙길 것 · 폰 표시')
  ok(sys.includes('학생ㄷ이름 = 3번') && !sys.includes('학생ㄱ이름'), '질문에 나온 학생만 이름 = 번호, 다른 이름은 싣지 않음')
  ok(sys.includes('"종류":"출결"'), '출결 넣는 법도 함께')
  script = [(e) => { body = e.body; return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '네' }] }, finishReason: 'STOP' }] })}\r\n\r\n`)); c.close() } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }) }]
  await call('ai:chatStream', { reqId: 'z2', mode: 'work', jobTitle: '담임', instruction: '', history: [{ role: 'user', content: '이번 시험 결과 분석 방법 알려 줘' }], model: { provider: 'gemini', model: 'gemini-test' } })
  ok(!JSON.parse(body).systemInstruction.parts[0].text.includes('우리 반 출결 기록'), '출결과 상관없는 질문(시험 결과)에는 싣지 않음')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
