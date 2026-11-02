// shared/timetable.ts — 그 날만 바꾼 수업 (timetable_dated)
const { loadShared: load } = require('./tsload.cjs')
const T = load('timetable.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

// 월~금 · 4교시, 화 2교시 2-3 수학 · 목 1교시 1-5 공통수학 인 가짜 시간표 (이름 없음)
const blank = () => Array.from({ length: 5 }, () => Array.from({ length: 4 }, () => null))
const grid = blank()
grid[1][1] = { cls: '2-3', subject: '수학', group: '' }
grid[3][0] = { cls: '1-5', subject: '공통수학', group: '' }
const base = {
  days: ['월', '화', '수', '목', '금'],
  periods: [1, 2, 3, 4].map((n) => ({ no: n, label: `${n}교시`, start: '' })),
  dayPeriods: [4, 4, 4, 4, 4],
  grid,
  from: '학교 시간표'
}

console.log('\n1. 주 고르기')
ok(T.mondayOf('2026-11-05') === '2026-11-02', '목요일 → 그 주 월요일')
ok(T.mondayOf('2026-11-08') === '2026-11-09', '일요일 → 다음 주 월요일')
ok(T.mondayOf('2026-11-07') === '2026-11-02', '토요일 → 그 주 월요일')

console.log('\n2. 바꾸기 · 되돌리기')
let d = {}
d = T.setDated(d, '2026-11-03', 1, '1-5 공통수학', '2-3 수학', '2026-11-02')
d = T.setDated(d, '2026-11-05', 0, '', '1-5 공통수학', '2026-11-02')
d = T.setDated(d, '2026-11-05', 3, '창체', '', '2026-11-02')
ok(d['2026-11-03']['1'] === '1-5 공통수학' && d['2026-11-05']['0'] === '' && d['2026-11-05']['3'] === '창체', '바꾼 글 · 비운 칸 · 빈 시간에 더한 것')
ok(!T.setDated(d, '2026-11-03', 1, ' 2-3 수학 ', '2-3 수학', '2026-11-02')['2026-11-03'], '원래 글로 적으면 바꾼 것에서 빠지고, 빈 날은 지움')
ok(!T.setDated(d, '2026-11-05', 0, null, '1-5 공통수학', '2026-11-02')['2026-11-05']['0'], '되돌리기(null)')
const old = T.setDated({ '2026-08-01': { '0': 'x' }, '2026-10-20': { '1': 'y' } }, '2026-11-03', 2, 'z', '', '2026-11-02')
ok(!old['2026-08-01'] && old['2026-10-20'] && old['2026-11-03'], '60일 넘게 지난 날은 저장할 때 지움')

console.log('\n3. 그 주에 얹기')
const w = T.withDated(base, '2026-11-02', d)
ok(w.dates.join() === '2026-11-02,2026-11-03,2026-11-04,2026-11-05,2026-11-06', '요일마다 날짜')
ok(w.grid[1][1].cls === '1-5' && w.grid[1][1].subject === '공통수학', '화 2교시가 바뀐 수업으로')
ok(w.grid[3][0] === null && w.grid[3][3].subject === '창체', '목 1교시는 비고, 4교시엔 창체')
ok(w.changes['1-1'] === '2-3 수학' && w.changes['3-0'] === '1-5 공통수학' && w.changes['3-3'] === '', '바뀐 칸마다 원래 글 (빈 시간은 빈 글)')
ok(Object.keys(w.changes).length === 3, '바뀐 칸만 표시')
ok(base.grid[1][1].cls === '2-3' && !base.changes, '매주 시간표는 그대로')
const next = T.withDated(base, '2026-11-09', d)
ok(!next.changes && next.grid[1][1].cls === '2-3', '다른 주에는 안 얹힘')
ok(!T.withDated(base, '2026-11-02', { '2026-11-03': { '1': '2-3 수학' } }).changes, '학교 시간표와 같은 글이면 바뀐 것으로 안 침')

console.log('\n4. 깨진 값')
ok(Object.keys(T.parseDated('{"2026-11-03":{"1":"a","x":"b","2":3},"bad":{"1":"c"},"2026-11-04":[]}')).join() === '2026-11-03' &&
  Object.keys(T.parseDated('{"2026-11-03":{"1":"a","x":"b","2":3}}')['2026-11-03']).join() === '1', '날짜 · 교시 · 글 모양이 아니면 뺌')
ok(JSON.stringify(T.parseDated('깨짐')) === '{}' && JSON.stringify(T.parseDated('')) === '{}', '읽을 수 없으면 빈 것')

console.log(fails ? `\n${fails}개 실패` : '\n모두 통과')
process.exit(fails ? 1 : 0)
