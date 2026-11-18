// 출결 기록 → 결석계: 연속 결석 묶기 · 칸 짐작 · 값 만들기 (빌드 없이)
const { loadShared: load } = require('./tsload.cjs')
const A = load('attdoc.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const rec = (date, no, o = {}) => ({ id: `${date}-${no}`, date, no, type: '결석', reason: '질병', note: '', proof: '필요', neis: false, ...o })
const students = [{ no: 1, name: '가나다' }, { no: 2, name: '라마바' }]

console.log('1. 연속한 평일 묶기')
ok(A.nextWeekday('2026-03-06') === '2026-03-09', '금요일 다음은 월요일')
const g = A.groupAbsences([rec('2026-03-06', 1, { note: 'B형 독감' }), rec('2026-03-09', 1), rec('2026-03-12', 1), rec('2026-03-06', 2)], students, '2-4')
ok(g.length === 3, `금 · 월은 한 건, 목요일은 따로, 다른 학생도 따로 (${g.length}건)`)
const a = g.find((x) => x.no === 1 && x.start === '2026-03-06')
ok(a && a.end === '2026-03-09' && a.days === 2 && a.reasonText === 'B형 독감' && a.name === '가나다' && a.cls === '2-4', '기간 · 일수 · 사유 · 이름')
ok(A.groupAbsences([rec('2026-03-06', 1, { type: '지각' })], students, '2-4').length === 0, '결석이 아닌 기록은 기본으로 빼 둠')
ok(A.groupAbsences([rec('2026-03-06', 1), rec('2026-03-09', 1, { reason: '미인정' })], students, '2-4').length === 2, '사유가 다르면 따로')
ok(A.groupAbsences([rec('2026-03-06', 1, { proof: '냄' }), rec('2026-03-09', 1, { proof: '필요' })], students, '2-4')[0].proof === '필요', '하나라도 서류가 필요면 필요')
ok(A.groupAbsences([rec('2026-03-06', 7)], students, '2-4')[0].name === '7번', '명단에 없으면 번호로')

console.log('\n2. 칸 짐작')
const ex = { 성명: 'name', 이름: 'name', '결석 기간': 'period', 결석일수: 'days', '사 유': 'reason', 증빙서류: 'proof', 작성일: 'today', '학년 반 번호': 'clsNo', 시작일: 'start', 종료일: 'end', 메모: '' }
for (const [label, want] of Object.entries(ex)) ok(A.guessField(label) === want, `${label} → ${want || '(비움)'} (${A.guessField(label)})`)

console.log('\n3. 값 · 짝 · 파일 이름')
const v = A.itemValues(a, '2026-11-17')
ok(v.period === '2026. 3. 6.(금) ~ 2026. 3. 9.(월)' && v.days === '2' && v.periodDays.endsWith('(2일간)'), `기간: ${v.period}`)
ok(v.clsNo === '2학년 4반 1번' && v.grade === '2' && v.klass === '4', `학년 반 번호: ${v.clsNo}`)
ok(v.today === '2026. 11. 17.' && v.proof === '미제출' && v.reasonType === '질병', '작성일 · 증빙 · 사유 종류')
const v2 = A.itemValues(a, '2026-11-17', { days: 1, reasonText: ' 감기 ' })
ok(v2.days === '1' && v2.reason === '감기', '일수 · 사유는 고쳐 쓸 수 있음')
ok(A.itemValues({ ...a, reasonText: '' }, '2026-11-17').reason === '질병', '사유 메모가 없으면 사유 종류로')
ok(A.itemValues({ ...a, start: '2026-03-06', end: '2026-03-06' }, '2026-11-17').period === '2026. 3. 6.(금)', '하루면 날짜 하나')
const map = A.autoMap(['성명', '결석기간'], [{ id: 'T0.1.1', label: '사유' }, { id: 'T0.2.1', label: '비고' }])
ok(map['slot:성명'] === 'name' && map['slot:결석기간'] === 'period' && map['T0.1.1'] === 'reason' && map['T0.2.1'] === '', '{{칸}} · 라벨 옆 칸 짝짓기')
const fa = A.fillArgs(map, v)
ok(fa.values['성명'] === '가나다' && fa.blanks['T0.1.1'] === 'B형 독감' && !('T0.2.1' in fa.blanks), '넣을 값만 골라냄(비운 칸은 안 넣음)')
ok(A.docFileName(a) === '결석계_가나다_20260306' && A.docFileName({ ...a, name: 'a/b' }, '결석:계') === '결석계_ab_20260306', '파일 이름에 못 쓰는 글자는 뺌')

console.log('\n4. 칸 안에 줄로 적힌 양식 (한 칸에 ○ 사유 · 기간 · 증빙서류)')
const cell = '다음과 같은 사유로 결석을 하였으므로 결석계를 제출합니다.\n○ 결석종류 : 병결\n○ 사    유 :\n○ 기    간 : 2023년  월  일 ~ 2023년  월  일까지 (   )일간\n○ 증빙서류 :\n2023년   월   일\n학  생 :               (인)\n보호자 :               (인)'
ok(A.isLineSpot(cell) && !A.isLineSpot('성명 :\n기간 :') && A.lineSpotKind(cell) === '병결', '줄 칸 알아보기 · 결석종류')
const filled = A.fillCellLines(cell, a, { proofName: '진료확인서' }).replace(/ /g, ' ').split('\n')
ok(filled[2] === '○ 사     유 : B형 독감' || filled[2].endsWith('유 : B형 독감'), `사유 줄: ${filled[2]}`)
ok(filled[3].includes('2026년 3월 6일 ~ 2026년 3월 9일까지 (2)일간'), `기간 줄: ${filled[3]}`)
ok(filled[4].endsWith('증빙서류 : 진료확인서') && filled[5] === '2026년 3월 10일', `증빙 · 서명일(마지막 날의 다음 평일): ${filled[4]} / ${filled[5]}`)
ok(filled[6].startsWith('학  생 :') && filled[7].startsWith('보호자 :') && filled[0].startsWith('다음과 같은') && filled[1] === '○ 결석종류 : 병결', '다른 줄은 그대로')
ok(A.fillCellLines(cell, a, {}).includes('증빙서류 :\n'), '증빙서류 이름이 없으면 그 줄은 비워 둠')
ok(A.fillCellLines(cell, { ...a, end: '2026-03-06', start: '2026-03-06' }, { days: 1 }).includes('2026년 3월 6일 ~ 2026년 3월 6일까지 (1)일간'), '하루 결석')
ok(A.fillCellLines('○ 기    간 : 2023년  월  일  교시 ~ 2023년  월  일  교시', a, {}).includes('2026년 3월 6일  교시'.replace('  교시', '')) , '교시 칸이 있는 줄은 날짜만 채움')
const vars = [{ table: 'T0', kind: '병결' }, { table: 'T1', kind: '인정조퇴/인정지각' }, { table: 'T2', kind: '인정결' }]
ok(A.pickVariant(vars, { type: '결석', reason: '질병' }) === 'T0' && A.pickVariant(vars, { type: '결석', reason: '출석인정' }) === 'T2' && A.pickVariant(vars, { type: '지각', reason: '출석인정' }) === 'T1', '사유 · 종류로 쓸 표 고르기')
ok(A.tableOf('T2.3.1') === 'T2' && A.tableOf('P3') === '' && A.tableOf('slot:성명') === '', '표 번호')
const om = A.onlyTable({ 'T0.3.3': 'klass', 'T1.3.3': 'klass', 'slot:x': 'name' }, 'T1')
ok(!('T0.3.3' in om) && om['T1.3.3'] === 'klass' && om['slot:x'] === 'name', '고른 표의 칸만 남김')
const spots = [{ id: 'T0.3.0', text: '3' }, { id: 'T0.3.2', text: '학년' }, { id: 'T0.3.3', text: '' }, { id: 'T0.3.4', text: '반' }, { id: 'T0.3.5', text: '' }, { id: 'T0.3.7', text: '이름 :' }, { id: 'T0.3.8', text: '' }]
const m2 = A.autoMap([], [{ id: 'T0.3.3', label: '학년' }, { id: 'T0.3.5', label: '반' }, { id: 'T0.3.8', label: '이름 :' }, { id: 'T0.5.0', label: '다음과 같은 사유로 결석을 하였으므로' }], spots)
ok(m2['T0.3.3'] === 'klass' && m2['T0.3.5'] === 'no' && m2['T0.3.8'] === 'name' && m2['T0.5.0'] === '', '"3 학년 [ ] 반 [ ] 번" 모양은 다음 단위로 · 긴 문장은 라벨이 아님')
const m3 = A.autoMap([], [{ id: 'T0.1.1', label: '학년' }, { id: 'T0.1.3', label: '반' }], [{ id: 'T0.1.0', text: '학년' }, { id: 'T0.1.1', text: '' }, { id: 'T0.1.2', text: '반' }, { id: 'T0.1.3', text: '' }])
ok(m3['T0.1.1'] === 'grade' && m3['T0.1.3'] === 'klass', '"학년 [ ] 반 [ ]" 모양은 라벨 오른쪽이 그 값')
ok(A.guessField('서명일') === 'signDay' && A.itemValues(a, '2026-11-17').signDay === '2026. 3. 10.', '서명일은 마지막 날의 다음 평일')

console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
process.exit(fails ? 1 : 0)
