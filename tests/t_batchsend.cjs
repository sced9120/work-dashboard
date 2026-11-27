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

console.log('5. 스캔한 표 → 활동 (3.7.7~)')
const sheet = [{ header: ['학번', '이름', '소감'], rows: [['10101', '가나다', '발표가 어려웠다'], ['10199', '없는애', '무시'], ['10102', '라마바', '그래프를 그렸다']] }]
const sr = [{ id: '1-1', cls: '1', no: '1', name: '가나다' }, { id: '1-2', cls: '1', no: '2', name: '라마바' }]
const e1 = B.planSheetSend(sheet, sr, { columns: [] }, {}, 'empty')
ok(e1.matched === 2 && e1.patch['1-1'].note === '발표가 어려웠다' && e1.missed.length === 1, '표 → 관찰 기록, 못 맞춘 줄은 따로')
const cur2 = { '1-1': { note: '먼저 적음', ai: '', final: '' } }
const e2 = B.planSheetSend(sheet, sr, { columns: [] }, cur2, 'empty')
ok(e2.kept === 1 && !e2.patch['1-1'] && e2.patch['1-2'], '빈 칸에만 — 적힌 학생은 건너뜀')
const e3 = B.planSheetSend(sheet, sr, { columns: [] }, cur2, 'append')
ok(e3.patch['1-1'].note === '먼저 적음\n발표가 어려웠다', '이어 붙이기')
const e4 = B.planSheetSend(sheet, sr, { columns: [] }, cur2, 'overwrite')
ok(e4.patch['1-1'].note === '발표가 어려웠다', '덮어쓰기')
const e5 = B.planSheetSend(sheet, sr, { columns: ['주제', '과정'] }, {}, 'empty')
ok(e5.patch['1-1'].fields['주제'] === '발표가 어려웠다' && e5.patch['1-1'].note === '주제: 발표가 어려웠다', '입력 항목이 여럿이면 첫 칸으로')

console.log('6. 스캔한 표로 새 활동 만들기 (3.7.11~)')
const multi = [{ header: ['학번', '이름', '탐구 주제', '소감', '비고'], rows: [['10101', '가나다', '급식 잔반', '그래프가 어려웠다', 'x'], ['10102', '라마바', '교통량', '단위를 맞춤', ''], ['10199', '없는애', '무시', '무시', '']] }]
const n1 = B.planNewActFromSheets(multi, sr, { id: 'act_scan1', name: ' 스캔 활동 ', rec: '과세특', subject: '통계' })
ok(n1.act.id === 'act_scan1' && n1.act.name === '스캔 활동' && n1.act.rec === '과세특' && n1.act.subject === '통계', '새 활동의 이름 · 영역 · 과목')
ok(JSON.stringify(n1.act.columns) === JSON.stringify(['탐구 주제', '소감']), `내용 칸이 입력 항목으로 (비고는 뺌): ${n1.act.columns}`)
ok(n1.matched === 2 && n1.missed.length === 1, '맞춘 학생 · 못 찾은 줄')
ok(n1.patch['1-1'].fields['탐구 주제'] === '급식 잔반' && n1.patch['1-1'].fields['소감'] === '그래프가 어려웠다' && n1.patch['1-1'].note === '탐구 주제: 급식 잔반\n소감: 그래프가 어려웠다', '학생마다 칸별로 나뉘어 들어감')
const one = [{ header: ['학번', '이름', '소감'], rows: [['10101', '가나다', '발표가 어려웠다']] }]
const n2 = B.planNewActFromSheets(one, sr, { id: 'act_scan2', name: '', rec: '자율' })
ok(n2.act.columns.length === 0 && n2.act.name === '스캔한 내용' && n2.patch['1-1'].note === '발표가 어려웠다' && !n2.patch['1-1'].fields, '내용 칸이 하나면 관찰 기록 한 칸')
const dup = [{ header: ['이름', '소감', '질문'], rows: [['가나다', 'a', 'q1'], ['가나다', 'b', '']] }]
const n3 = B.planNewActFromSheets(dup, sr, { id: 'act_scan3', name: 'x', rec: '과세특' })
ok(n3.patch['1-1'].fields['소감'] === 'a\nb' && n3.patch['1-1'].fields['질문'] === 'q1', '같은 학생의 줄이 여럿이면 칸마다 이어 붙임')
const rows6 = [{ sid: '10101', name: '가나다', result: { items: { 주제: '가나다 주제', '느낀 점': '가나다 소감' }, seteuk: '가나다 세특' } }]
const n4 = B.planNewActFromBatch(rows6, sr, ['주제', '느낀 점'], { id: 'act_scan4', name: '폴더 활동', rec: '과세특' }, { note: true, ai: true })
ok(JSON.stringify(n4.act.columns) === JSON.stringify(['주제', '느낀 점']) && n4.patch['1-1'].fields['주제'] === '가나다 주제' && n4.patch['1-1'].ai === '가나다 세특', '폴더째 정리 결과 → 입력 항목 + 초안')

console.log('설문지로 새 활동 만들기')
{
  const head = ['타임스탬프', '이메일 주소', '학번을 적어 주세요', '이름', '탐구 주제, 한 줄', '느낀 점', '연락처', '느낀 점']
  const body = [
    ['t', 'a@b.c', '10101', '가나다', '함수', '재미', '010', '또'],
    ['t', 'a@b.c', '10102', '라마바', '도형', '', '010', ''],
    ['t', 'a@b.c', '10399', '없는이', '집합', '음', '010', '']
  ]
  const sheet = B.cleanFormSheet(S.formToSheet(head, body))
  const qs = B.formQuestions(sheet)
  ok(qs.map((q) => q.name).join('|') === '탐구 주제 · 한 줄|느낀 점|느낀 점 (2)', `문항 이름: ${qs.map((q) => q.name).join('|')}`)
  const spec = { id: 'act_f', name: ' ', rec: '과세특', desc: '  개요 ' }
  const two = B.planNewActFromForm(sheet, roster, [qs[0].index, qs[1].index], spec, '[설문 1/2]')
  ok(two.act.columns.join('|') === '탐구 주제 · 한 줄|느낀 점', '고른 문항만 입력 항목')
  ok(two.act.name === '설문지 응답' && two.act.desc === '개요', '빈 이름은 기본 이름 · 개요')
  ok(two.matched === 2 && two.missed.length === 1, '맞춤 2 · 못 찾음 1')
  ok(two.patch['1-1'].fields['느낀 점'] === '[설문 1/2] 재미' && two.patch['1-1'].note === '탐구 주제 · 한 줄: [설문 1/2] 함수\n느낀 점: [설문 1/2] 재미', '칸마다 머리표 · 관찰 기록 잇기')
  ok(!('느낀 점' in two.patch['1-2'].fields), '빈 답은 넣지 않음')
  ok(!JSON.stringify(two.patch).includes('010') && !JSON.stringify(two.patch).includes('a@b.c'), '연락처 · 이메일은 빠짐')
  const saved = S.readActs(JSON.stringify([two.act]))[0]
  ok(saved.columns.join('|') === two.act.columns.join('|') && S.readColumns(saved.columns.join(', ')).length === 2, '저장 · 쉼표 입력칸을 거쳐도 칸이 그대로')
  const one = B.planNewActFromForm(sheet, roster, [qs[1].index], spec, '[설문 1/2]')
  ok(one.act.columns.length === 0 && one.patch['1-1'].note === '[설문 1/2] 재미', '문항 하나면 관찰 기록 한 칸')
  const none = B.planNewActFromForm(sheet, roster, [], spec, '[설문 1/2]')
  ok(none.matched === 0 && Object.keys(none.patch).length === 0, '문항을 안 고르면 아무것도 없음')
  const cut = B.pickQuestions(sheet, ['느낀 점'])
  ok(B.formQuestions(cut).length === 1 && cut.rows[0].includes('10101'), '다음 가져오기는 고른 문항만 (학번 · 이름은 남김)')
  ok(B.formQuestions(B.pickQuestions(sheet, ['없는 문항'])).length === 3, '설문지가 바뀌어 하나도 안 맞으면 모두')
}

console.log('가져온 글 더하기')
{
  const cols = ['주제', '느낀 점']
  ok(B.mergeImportRow([], { note: '앞' }, { id: '1', text: '뒤' }).note === '앞\n뒤', '한 칸 활동은 줄 바꿔 뒤에')
  const m = B.mergeImportRow(cols, { note: '주제: 옛', fields: { 주제: '옛' } }, { id: '1', text: 'x', fields: { '느낀 점': '새', 다른: '글' } })
  ok(m.fields.주제 === '옛 다른: 글' && m.fields['느낀 점'] === '새', '같은 이름은 그 칸, 나머지는 첫 칸')
  ok(m.note === '주제: 옛 다른: 글\n느낀 점: 새', '관찰 기록 다시 잇기')
  const again = B.mergeImportRow(cols, m, { id: '1', text: 'x', fields: { '느낀 점': '새' } })
  ok(again.fields['느낀 점'] === '새', '같은 글은 두 번 넣지 않음')
  const legacy = B.mergeImportRow(cols, { note: '칸 나누기 전 글' }, { id: '1', text: '표에서\n온 글' })
  ok(legacy.fields.주제 === '칸 나누기 전 글 표에서 온 글', '예전 관찰 기록을 지키며 첫 칸에')
}

console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
process.exit(fails ? 1 : 0)
