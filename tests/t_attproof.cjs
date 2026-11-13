// 출결 서류 기한 (shared/attendance.ts) — 평일 n일 뒤 · 서류 아직인 것만 · 기한 순 · 알림 글에 이름 없음 (빌드 없이)
const { loadShared: load } = require('./tsload.cjs')
const A = load('attendance.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

// 2026-11-13 은 금요일
ok(A.addSchoolDays('2026-11-13', 1) === '2026-11-16', '금요일 + 평일 1일 = 다음 월요일')
ok(A.addSchoolDays('2026-11-13', 5) === '2026-11-20', '금요일 + 평일 5일 = 다음 금요일')
ok(A.addSchoolDays('2026-11-14', 1) === '2026-11-16', '토요일 + 1 = 월요일')
ok(A.addSchoolDays('2026-11-16', 3) === '2026-11-19', '월요일 + 3 = 목요일')
ok(A.addSchoolDays('모름', 3) === '모름', '날짜가 아니면 그대로')
ok(A.readProofDays('') === 5 && A.readProofDays('7') === 7 && A.readProofDays('0') === 5 && A.readProofDays('99') === 5 && A.readProofDays('2.9') === 2, '기한 일수 — 기본 5, 1~30')

const recs = A.readRecords(JSON.stringify([
  { id: 'a', date: '2026-11-16', no: 3, type: '결석', reason: '질병', note: '', proof: '필요', neis: false },
  { id: 'b', date: '2026-11-10', no: 7, type: '지각', reason: '기타', note: '', proof: '필요', neis: true },
  { id: 'c', date: '2026-11-09', no: 2, type: '결석', reason: '미인정', note: '', proof: '없음', neis: false },
  { id: 'd', date: '2026-11-09', no: 5, type: '조퇴', reason: '질병', note: '', proof: '냄', neis: false }
]))
const todos = A.proofTodos(recs, 5)
ok(todos.length === 2 && todos[0].rec.id === 'b' && todos[0].due === '2026-11-17' && todos[1].due === '2026-11-23', '서류 아직인 것만, 기한 빠른 것부터')
ok(A.proofTitle(todos[0].rec) === '출결 서류 받기 — 7번 지각(기타)', '알림 글은 번호로만 (이름 없음)')

console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
process.exit(fails ? 1 : 0)
