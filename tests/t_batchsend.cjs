// shared/batchSend.ts — 문서 스캔 결과를 세특 활동으로 보내는 계획(학생 맞추기 · 빈 칸에만 · 덮어쓰기 · 입력 항목 칸 · 못 찾음) (빌드 없이). 이름은 지어낸 것
const { loadShared: load } = require('./tsload.cjs')
const B = load('batchSend.ts')
const S = load('seteuk.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

const roster = S.parseRoster('1\t1\t가나다\n1\t2\t라마바\n1\t3\t사아자').students
const items = ['주제', '느낀 점']
const row = (sid, name, over = {}) => ({ sid, name, files: [], result: { items: { 주제: `${name} 주제`, '느낀 점': `${name} 소감` }, score: '', scoreReason: '', seteuk: `${name} 세특`, note: '', ...over } })
const rows = [row('10101', '가나다'), row('', '라마바'), row('10399', '없는이'), { sid: '10103', name: '사아자', files: [], error: '실패' }]
const act = { columns: [] }
const both = { note: true, ai: true, overwrite: false }

console.log('1. 학생 맞추기')
ok(B.matchBatchRow({ sid: '10101', name: '가나다' }, roster)?.id === '1-1', '학번 + 이름')
ok(B.matchBatchRow({ sid: '', name: '라마바' }, roster)?.id === '1-2', '이름만')
ok(B.matchBatchRow({ sid: '10103', name: '' }, roster)?.id === '1-3', '학번만')
ok(B.matchBatchRow({ sid: '10399', name: '없는이' }, roster) === null, '명단에 없음')

console.log('2. 보내기 계획')
const p = B.planBatchSend(rows, roster, act, {}, items, both)
ok(p.matched === 2 && Object.keys(p.patch).length === 2, '맞춘 2명 (실패한 줄은 건너뜀)')
ok(p.missed.length === 1 && p.missed[0] === '10399 없는이', `못 찾은 줄: ${JSON.stringify(p.missed)}`)
ok(p.patch['1-1'].note === '주제: 가나다 주제\n느낀 점: 가나다 소감' && p.patch['1-1'].ai === '가나다 세특', '항목이 여럿이면 항목: 값 줄 + 초안')
ok(B.noteOfItems(['주제'], { 주제: '하나뿐' }) === '하나뿐', '항목 하나면 값만')

console.log('3. 빈 칸에만 · 덮어쓰기')
const cur = { '1-1': { note: '이미 적음', ai: '', final: '다듬음' } }
const q = B.planBatchSend(rows, roster, act, cur, items, both)
ok(q.patch['1-1'].note === undefined && q.patch['1-1'].ai === '가나다 세특', '있는 관찰 기록은 두고 빈 초안만 채움')
ok(q.patch['1-1'].final === undefined, '최종본은 건드리지 않음')
const full = { '1-1': { note: 'x', ai: 'y', final: '' } }
const q2 = B.planBatchSend([row('10101', '가나다')], roster, act, full, items, both)
ok(q2.matched === 1 && q2.kept === 1 && Object.keys(q2.patch).length === 0, '다 차 있으면 건너뜀(kept 1)')
const q3 = B.planBatchSend([row('10101', '가나다')], roster, act, full, items, { ...both, overwrite: true })
ok(q3.patch['1-1'].note.startsWith('주제:') && q3.patch['1-1'].ai === '가나다 세특', '덮어쓰기')
const q4 = B.planBatchSend(rows, roster, act, {}, items, { note: true, ai: false, overwrite: false })
ok(q4.patch['1-1'].ai === undefined && q4.patch['1-1'].note, '초안 체크를 끄면 AI 초안은 안 보냄')
const q5 = B.planBatchSend(rows, roster, act, {}, items, { note: false, ai: true, overwrite: false })
ok(q5.patch['1-1'].note === undefined && q5.patch['1-1'].ai === '가나다 세특', '관찰 기록 체크를 끄면 초안만')

console.log('4. 입력 항목이 여럿인 활동')
const act2 = { columns: ['주제', '과정'] }
const w = B.planBatchSend([row('10101', '가나다')], roster, act2, {}, items, { note: true, ai: false, overwrite: false })
ok(w.patch['1-1'].fields['주제'] === '가나다 주제' && !('느낀 점' in w.patch['1-1'].fields) && w.patch['1-1'].note === '주제: 가나다 주제', '이름이 같은 항목만 그 칸으로 · 관찰 기록은 칸을 이은 것')
const act3 = { columns: ['가', '나'] }
const w3 = B.planBatchSend([row('10101', '가나다')], roster, act3, {}, items, { note: true, ai: false, overwrite: false })
ok(w3.patch['1-1'].fields['가'].includes('주제: 가나다 주제'), '맞는 이름이 없으면 첫 칸으로')
const w4 = B.planBatchSend([row('10101', '가나다')], roster, act2, { '1-1': { note: '', ai: '', final: '', fields: { 주제: '있음' } } }, items, { note: true, ai: false, overwrite: false })
ok(w4.matched === 1 && w4.kept === 1, '그 칸이 차 있으면 빈 칸에만 — 건너뜀')

console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
process.exit(fails ? 1 : 0)
