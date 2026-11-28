// 교과진도평가계획 — 주별 진도표 셈 · 단원 나누기 · 문서 글 (빌드 없이)
const { loadShared } = require('./tsload.cjs')
const cal = loadShared('courseCalendar')
const cp = loadShared('coursePlan')

let fail = 0
const ok = (c, msg) => {
  console.log(`${c ? '✓' : '✗'} ${msg}`)
  if (!c) fail = 1
}
const throws = (f, re, msg) => {
  try {
    f()
    ok(false, `${msg} (오류가 안 남)`)
  } catch (e) {
    ok(e instanceof cal.CalendarError && re.test(e.message), `${msg} — ${e.message.slice(0, 60)}`)
  }
}

const SPRING = {
  start: '2026-03-03',
  end: '2026-07-17',
  weeklyHours: 4,
  noClass: [
    { from: '2026-03-02', to: '2026-03-02', label: '대체공휴일(삼일절)' },
    { from: '2026-05-05', to: '2026-05-05', label: '어린이날' },
    { from: '2026-04-27', to: '2026-04-30', label: '1회 정기시험' }
  ],
  events: [{ date: '2026-03-03', label: '개학식' }]
}
const S = (patch = {}) => ({ ...SPRING, ...patch })
const W = cal.planWeeks(S())

ok(W[0].week === '1' && W[0].start === '2026-03-03' && W[0].end === '2026-03-06', '1주는 개학일부터 그 주 금요일까지')
ok(W[0].classDays === 4 && W[0].deducted === 0, '개학 전 공휴일(3.2.)은 공제가 아니다')
const may = W.find((w) => w.start <= '2026-05-05' && '2026-05-05' <= w.end)
ok(may.deducted === 1 && may.notes.includes('5.5. 어린이날'), '평일 공휴일은 공제하고 비고에 적는다')
const exam = W.find((w) => w.start <= '2026-04-28' && '2026-04-28' <= w.end)
ok(exam.deducted === 4 && exam.classDays === 1 && exam.hours === 1, '기간으로 적은 정기시험은 그 날들을 모두 공제')
const days = W.reduce((n, w) => n + w.classDays, 0)
ok(W[W.length - 1].cumulative === Math.round((4 * days) / 5), '누계 = 주당 시수 × 수업일 ÷ 5')
ok(W.every((w, i) => w.cumulative === W.slice(0, i + 1).reduce((n, x) => n + x.hours, 0)), '주마다 시간을 더하면 누계와 같다')
const full = W.find((w) => w.start === '2026-03-09')
ok(full.classDays === 5 && full.hours === 4, '다 채운 주는 주당 시수 그대로')
const two = cal.planWeeks(S({ group: 2 }))
ok(two[0].week === '1~2' && two[0].start === '2026-03-03' && two[0].end === '2026-03-13', '두 주씩 묶기')
ok(two[two.length - 1].cumulative === W[W.length - 1].cumulative, '묶어도 누계는 같다')
ok(cal.periodText('2026-03-03', '2026-03-13') === '3.3.~3.13.', '학교 문서식 기간')
ok(W[0].notes.includes('3.3. 개학식'), '행사는 그 주 비고에')

throws(() => cal.planWeeks(S({ start: '2026-07-20' })), /개학일/, '개학일이 뒤면 오류')
throws(() => cal.planWeeks(S({ weeklyHours: 0 })), /주당 수업 시수/, '주당 시수 0')
throws(() => cal.planWeeks(S({ weeklyHours: 40 })), /주당 수업 시수/, '주당 시수 40')
throws(() => cal.planWeeks(S({ weeklyHours: 2.5 })), /주당 수업 시수/, '주당 시수 소수')
throws(() => cal.planWeeks(S({ start: '2026-3-3' })), /YYYY-MM-DD/, '날짜 꼴')
throws(() => cal.planWeeks(S({ start: '２０２６-０３-０３' })), /YYYY-MM-DD/, '전각 숫자')
throws(() => cal.planWeeks(S({ end: '2027-12-31' })), /너무 깁니다/, '학기가 너무 김')
throws(() => cal.planWeeks(S({ noClass: [{ from: '2026-02-30' }] })), /YYYY-MM-DD/, '없는 날짜')
throws(() => cal.planWeeks(S({ noClass: [{ from: '2026-05-10', to: '2026-05-01' }] })), /앞서야/, '기간 앞뒤')
throws(() => cal.planWeeks(S({ group: 3 })), /1 또는 2/, '묶을 주 수')
throws(() => cal.planWeeks(S({ start: '2026-03-07', end: '2026-03-08' })), /평일이 하루도/, '평일이 없는 학기')
throws(() => cal.planWeeks(S({ events: [{ date: '2026-03-03' }] })), /비어 있습니다/, '이름 없는 행사')
throws(() => cal.planWeeks(S({ events: [{ date: '2026-03-03', label: '가'.repeat(3001) }] })), /너무 깁니다/, '너무 긴 이름')
throws(() => cal.planWeeks(S({ noClass: Array(101).fill({ from: '2026-05-05', label: '어린이날' }) })), /너무 많습니다/, '너무 많은 항목')

const long = cal.planWeeks(S({ noClass: [{ from: '2000-01-01', to: '2099-12-31', label: '휴업' }] }))
ok(long[long.length - 1].cumulative === 0 && long[0].notes[0] === '3.3.~3.6. 휴업', '아주 긴 기간은 학기 안으로 자른다')

const HOL = [
  { date: '2026-03-02', name: '대체공휴일(삼일절)' },
  { date: '2026-05-05', name: '어린이날' },
  { date: '2026-05-25', name: '대체공휴일(부처님오신날)' }
]
const hw = cal.holidayWarnings(S({ noClass: SPRING.noClass.filter((n) => n.label !== '어린이날') }), HOL, [2026])
ok(hw.some((w) => w.includes('5.5.') && w.includes('어린이날')), '빠진 공휴일을 알린다')
ok(!hw.some((w) => w.includes('3.2.')), '개학 전 공휴일은 알리지 않는다')
ok(!cal.holidayWarnings(S(), HOL, [2026]).some((w) => w.includes('어린이날')), '넣어 둔 공휴일은 알리지 않는다')
ok(cal.holidayWarnings(S({ start: '2027-03-02', end: '2027-07-16' }), [], [2026]).some((w) => w.includes('2027년')), '공휴일 표 없는 해')
const sw = cal.spanWarnings(
  S({ noClass: [{ from: '2025-04-27', to: '2025-04-30', label: '1회 정기시험' }, { from: '2026-03-07', label: '토요 행사' }, { from: '2026-05-05', label: '어린이날' }] })
)
ok(sw.some((w) => w.includes('1회 정기시험') && w.includes('밖')), '학기 밖 기간을 알린다')
ok(sw.some((w) => w.includes('토요 행사') && w.includes('평일이 없습니다')), '주말만 있는 기간을 알린다')
ok(!sw.some((w) => w.includes('어린이날')), '맞는 날은 알리지 않는다')

const sp2 = { start: '2026-03-02', end: '2026-04-30', weeklyHours: 4, group: 2, noClass: [{ from: '2026-03-12', to: '2026-03-18', label: '시험' }] }
const r2 = cal.planWeeks(sp2)
ok(r2[0].notes.join() === '3.12.~3.13. 시험' && r2[1].notes.join() === '3.16.~3.18. 시험', '두 주 묶음 경계에서 기간을 나눠 적는다')
const odd = cal.planWeeks(S({ group: 2, end: '2026-07-21' }))
ok(odd[odd.length - 1].week === '21' && odd[odd.length - 2].week === '19~20', '홀수 주면 마지막 줄은 한 주')

// 단원 나누기
const plan = cp.readPlan({
  ...cp.emptyPlan(new Date('2026-01-10')),
  year: 2026,
  term: 1,
  subject: '공통수학1',
  grade: '고1',
  ...S(),
  units: [
    { id: 'a', name: '다항식', hours: 10, standards: '[10공수1-01-01] 다항식의 사칙연산의 원리를 설명하고, 그 계산을 할 수 있다.' },
    { id: 'b', name: '방정식과 부등식', hours: 30, standards: '' }
  ]
})
const b = cp.buildPlan(plan, HOL, [2026])
ok(!b.error && b.rows.length === W.length, '계획이 셈된다')
ok(b.slots[0].length === 1 && b.slots[0][0].from === 1 && b.slots[0][0].to === b.rows[0].hours, '첫 주는 첫 단원 1차시부터')
const cross = b.slots.findIndex((s) => s.length === 2)
ok(cross > 0 && b.slots[cross][0].unit.id === 'a' && b.slots[cross][0].to === 10 && b.slots[cross][1].from === 1, '단원이 끝나는 주에 다음 단원이 이어진다')
ok(b.warnings.some((w) => w.includes('적습니다')), '단원 시수가 모자라면 알린다')
ok(b.unitHours === 40 && b.total === W[W.length - 1].cumulative, '합계')
const md = cp.planMarkdown(plan, b)
ok(md.startsWith('# 2026학년도 1학기 공통수학1 교과진도평가계획'), '문서 제목')
ok(md.includes('| 주 | 기간 | 수업일 | 공제 | 시간 | 누계 | 단원 (차시) | 성취기준 | 비고 |'), '진도표 머리줄')
ok(md.includes('[10공수1-01-01]') && md.includes('다항식 (1~'), '진도표에 단원 · 성취기준 코드')
ok(md.includes(cp.REGULATION_MARK), '학교 규정 확인 표시')
ok(md.includes('| 합계 |  | 100% |'), '반영 비율 합계')
ok(md.includes('## 확인 필요'), '확인 필요 목록')
const prog = md.split('\n## ')[1].split('\n').filter((l) => l.startsWith('|'))
ok(prog.length === b.rows.length + 2 && prog.every((l) => (l.match(/\|/g) || []).length === 10), '진도표 줄마다 칸 수가 같다 (칸 안에 | 가 새지 않음)')
const bad = cp.buildPlan({ ...plan, weeklyHours: 0 })
ok(!!bad.error && bad.rows.length === 0, '잘못된 입력은 오류 글로')
const r = cp.readPlan({ year: 'x', term: 7, weeklyHours: 99, evals: 'no', units: [{ name: 1, hours: -3 }] })
ok(r.term === 1 && r.weeklyHours === 4 && r.evals.length === 3 && r.units[0].hours === 0, '망가진 저장 자료를 기본값으로')
ok(cp.codesOfLines('[10공수1-01-01] 가\n그냥 글\n [10공수1-01-02] 나').join() === '[10공수1-01-01],[10공수1-01-02]', '줄에서 코드만')

// 나이스 학사일정 → 수업 없는 날
const sp = cp.scheduleToSpans([
  { date: '2026-04-27', name: '1회 정기고사', off: '해당없음' },
  { date: '2026-04-28', name: '1회 정기고사', off: '해당없음' },
  { date: '2026-04-24', name: '1회 정기고사', off: '해당없음' },
  { date: '2026-05-05', name: '어린이날', off: '공휴일' },
  { date: '2026-05-04', name: '재량휴업일', off: '휴업일' },
  { date: '2026-05-09', name: '토요휴업일', off: '휴업일' },
  { date: '2026-03-03', name: '입학식', off: '해당없음' },
  { date: '2026-05-05', name: '어린이날', off: '공휴일' }
])
ok(sp.length === 3, `휴업일 · 공휴일 · 정기시험만 고른다 (${sp.length})`)
ok(sp.some((s) => s.from === '2026-04-24' && s.to === '2026-04-28' && s.label === '1회 정기고사'), '금 → 월 로 이어지는 시험은 한 기간')
ok(!sp.some((s) => s.label.includes('토요') || s.label.includes('입학식')), '토요일 · 수업 있는 행사는 뺀다')
const mg = cp.mergeSpans([{ from: '2026-05-05', to: '2026-05-05', label: '어린이날' }], sp)
ok(mg.added === 2 && mg.list.length === 3, '이미 넣은 날은 다시 넣지 않는다')
const tsv = cp.planTsv(b)
ok(tsv.split('\n').length === b.rows.length + 1 && tsv.split('\n')[0].split('\t').length === 9, '엑셀용 표 글')

process.exit(fail)
