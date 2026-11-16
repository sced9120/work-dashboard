// 상담 기록 (shared/counsel.ts) — 학년도 · 달 칸 · 학부모에게 보낼 글 · 입력 다듬기 (빌드 없이, 가짜 자료만)
const { loadShared: load } = require('./tsload.cjs')
const C = load('counsel.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

console.log('1. 학년도')
ok(C.schoolYearOf('2027-02-28') === 2026 && C.schoolYearOf('2027-03-01') === 2027 && C.schoolYearOf('2026-12-31') === 2026 && C.schoolYearOf('2027-01-05') === 2026, '3월에 시작 (2027-02 → 2026)')
ok(C.monthKey(2026, 3) === '2026-03' && C.monthKey(2026, 12) === '2026-12' && C.monthKey(2026, 1) === '2027-01' && C.monthKey(2026, 2) === '2027-02', '1 · 2월은 다음 해')
ok(C.semesterOf('2026-08-31') === 1 && C.semesterOf('2026-09-01') === 2 && C.semesterOf('2027-02-10') === 2, '1학기 3~8월 · 2학기 9~2월')

console.log('\n2. 달 칸')
const now = '2026-11-16 09:00:00'
const mk = (no, name, date, extra = {}) => C.cleanRecord({ no, name, date, text: '가나다', ...extra }, now)
const recs = [mk(1, '가나다', '2026-03-05'), mk(1, '가나다', '2026-03-20'), mk(1, '가나다', '2027-02-03'), mk(2, '라마바', '2026-11-10'), mk(2, '라마바', '2027-03-02')]
const plans = [C.cleanPlan({ no: 2, name: '라마바', date: '2026-12-02', time: '15:30' }), C.cleanPlan({ no: 3, name: '가나다', date: '2027-01-12' })]
const cells = C.monthCells(recs, plans, 2026)
ok(cells[1][0].count === 2 && cells[1][11].count === 1 && cells[1][1].count === 0, '번호 1 — 3월 2건 · 2월 1건')
ok(cells[2][8].count === 1 && cells[2].reduce((s, c) => s + c.count, 0) === 1, '다음 학년도 3월은 안 센다')
ok(cells[2][9].planned === 1 && cells[3][10].planned === 1 && cells[3][10].count === 0, '예정 표시 (12월 · 1월)')
ok(C.monthTotals(cells).join() === '2,0,0,0,0,0,0,0,1,0,0,1', '달별 합계')
ok(C.hasRecordInSemester(recs, 1, '2026-04-10') && !C.hasRecordInSemester(recs, 2, '2026-04-10') && C.hasRecordInSemester(recs, 2, '2026-10-10') && !C.hasRecordInSemester(recs, 3, '2026-10-10'), '이 학기 기록 없는 학생 찾기')

console.log('\n3. 학부모에게 보낼 글')
const r = mk(1, '가나다', '2026-11-05', { text: '교우 관계 고민을 들었습니다.', follow: '다음 달에 한 번 더 이야기 나누겠습니다.' })
const msg = C.parentMessage(r, '라마바')
ok(msg.startsWith('안녕하세요, 가나다 학생 담임 라마바입니다.') && msg.includes('11월 5일 상담 내용을 알려 드립니다.'), '인사 · 날짜')
ok(msg.includes('교우 관계') && msg.includes('앞으로는 다음 달에') && msg.includes('궁금하신 점은 언제든 연락 주세요.'), '내용 · 후속 조치 · 맺음')
ok(C.parentMessage(r).includes('담임 ○○○입니다'), '담임 이름 없으면 ○○○')
ok(!C.parentMessage({ ...r, follow: '' }).includes('앞으로는'), '후속 조치 없으면 그 줄 없음')

console.log('\n4. 입력 다듬기')
ok(C.cleanRecord({ no: 0, name: 'x', date: '2026-11-05', text: 'a' }, now) === null, '번호 없으면 거절')
ok(C.cleanRecord({ no: 1, name: 'x', date: '2026-13-05', text: 'a' }, now) === null && C.cleanRecord({ no: 1, name: 'x', date: '날짜', text: 'a' }, now) === null, '날짜가 틀리면 거절')
ok(C.cleanRecord({ no: 1, name: 'x', date: '2026-11-05', text: '  ', follow: '', topics: [] }, now) === null, '내용 · 주제가 모두 비면 거절')
const d = C.cleanRecord({ no: 1, name: '가나다', date: '2026-11-05', who: '이상한값', how: '??', topics: ['진로', '진로', ' 학업 ', ''], text: 'a'.repeat(9000) }, now)
ok(d.who === '학생' && d.how === '대면' && d.topics.join() === '진로,학업' && d.text.length === 5000, '대상 · 방법 기본값 · 주제 중복 제거 · 길이 제한')
const e = C.cleanRecord({ id: d.id, no: 1, name: '가나다', date: '2026-11-06', text: '고침' }, '2026-11-17 10:00:00', d)
ok(e.id === d.id && e.created === d.created && e.updated === '2026-11-17 10:00:00', '고칠 때 id · 만든 때 유지')
ok(C.cleanPlan({ no: 1, name: 'x', date: '2026-11-05', time: '25:99' }).time === '' && C.cleanPlan({ no: 1, name: 'x', date: '2026-11-05', time: '09:05' }).time === '09:05', '시각 형식')
ok(C.planTitle(7) === '상담 — 7번' && !C.planTitle(7).includes('가나다'), '일정 제목에 이름 없음')

console.log('\n5. 읽기 · 거르기 · 표')
const back = C.readStore(JSON.stringify({ records: [...recs, { no: 'x' }, null], plans: [...plans, 5] }))
ok(back.records.length === 5 && back.plans.length === 2, '망가진 줄은 버리고 읽음')
ok(C.readStore('{{').records.length === 0 && C.readMeta('').teacher === '', '깨진 글은 빈 값')
const meta = C.readMeta(JSON.stringify({ teacher: ' 라마바 ', students: { 1: { contact: '어머니 010-0000-0000', memo: '' }, x: { contact: 'a' }, 2: { contact: '', memo: '' } } }))
ok(meta.teacher === '라마바' && Object.keys(meta.students).join() === '1', '연락처 · 메모 — 번호만, 빈 것은 뺌')
ok(C.filterRecords(recs, { q: '라마' }).length === 2 && C.filterRecords(recs, { q: '1번' }).length === 3 && C.filterRecords([d], { topic: '학업' }).length === 1 && C.filterRecords([d], { topic: '건강' }).length === 0, '이름 · 번호 · 주제 거르기')
ok(C.newestFirst(recs)[0].date === '2027-03-02', '최신 순')
const t = C.recordsTable(recs, 2026)
ok(t.header.join() === '날짜,번호,이름,대상,방법,주제,내용,후속 조치' && t.rows.length === 5 && t.rows[0][0] === '2026-03-05', '엑셀 표 머리 · 날짜순')

console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
process.exit(fails ? 1 : 0)
