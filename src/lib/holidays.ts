/**
 * 우리나라 공휴일.
 *
 * 「관공서의 공휴일에 관한 규정」 을 그대로 옮겼다. 인터넷을 쓰지 않고
 * 프로그램 안에서 계산하므로, 학교 컴퓨터가 밖으로 나가지 못해도 달력에 뜬다.
 *
 * 날짜가 딱 정해진 공휴일(신정·삼일절·어린이날…)은 규칙으로 만들고,
 * 음력을 따르는 설날·부처님오신날·추석만 아래 표에서 읽어 온다.
 * 대체공휴일은 규정대로 계산한다.
 *
 * 해마다 그때그때 정해지는 날 — 선거일과 임시공휴일 — 은 규칙이 없어
 * 넣지 못한다. 그런 날은 일정으로 직접 넣어 두면 된다.
 */

/* ---------- 음력을 따르는 날 ---------- */

/**
 * [설날, 부처님오신날, 추석] 의 양력 날짜.
 *
 * 음력은 식으로 뽑는 것이 아니라 천문 관측으로 정해지므로 표로 둔다.
 * 표에 없는 해는 음력 명절이 뜨지 않고, 달력이 그 사실을 알려 준다.
 * 해가 지나 표가 모자라면 여기에 줄만 더 넣으면 된다.
 *
 * 먼 뒷해는 하루쯤 달라질 수 있으니, 실제 계획에 쓰기 전에 그 해 관보나
 * 한국천문연구원 발표로 한 번 확인하는 편이 안전하다.
 */
const LUNAR: Record<number, [string, string, string]> = {
  2024: ['02-10', '05-15', '09-17'],
  2025: ['01-29', '05-05', '10-06'],
  2026: ['02-17', '05-24', '09-25'],
  2027: ['02-06', '05-13', '09-15'],
  2028: ['01-26', '05-02', '10-03'],
  2029: ['02-13', '05-20', '09-22'],
  2030: ['02-03', '05-09', '09-12'],
  2031: ['01-23', '05-28', '10-01'],
  2032: ['02-11', '05-16', '09-19'],
  2033: ['01-31', '05-06', '09-08'],
  2034: ['02-19', '05-25', '09-27'],
  2035: ['02-08', '05-15', '09-16']
}

const KNOWN_YEARS = Object.keys(LUNAR).map(Number)
export const LUNAR_FROM = Math.min(...KNOWN_YEARS)
export const LUNAR_TO = Math.max(...KNOWN_YEARS)

/** 그 해의 음력 명절을 알고 있는가 */
export function lunarKnown(year: number): boolean {
  return year in LUNAR
}

/* ---------- 날짜가 정해진 날 ---------- */

/**
 * 공휴일마다 대체공휴일 규칙이 다르다.
 *  none   — 대체공휴일이 없다 (신정, 현충일)
 *  sunday — 일요일과 겹칠 때만 (설날·추석 연휴)
 *  full   — 토·일이거나 다른 공휴일과 겹칠 때 (나머지)
 */
type SubRule = 'none' | 'sunday' | 'full'

const FIXED: { md: string; name: string; rule: SubRule }[] = [
  { md: '01-01', name: '신정', rule: 'none' },
  { md: '03-01', name: '삼일절', rule: 'full' },
  { md: '05-05', name: '어린이날', rule: 'full' },
  { md: '06-06', name: '현충일', rule: 'none' },
  { md: '08-15', name: '광복절', rule: 'full' },
  { md: '10-03', name: '개천절', rule: 'full' },
  { md: '10-09', name: '한글날', rule: 'full' },
  { md: '12-25', name: '성탄절', rule: 'full' }
]

/* ---------- 날짜 셈 ---------- */

/**
 * 날짜 계산은 모두 UTC 로 한다.
 * 지역 시간으로 하면 서머타임이 있는 곳에서 하루가 밀릴 수 있다.
 */
function parse(s: string): number {
  const [y, m, d] = s.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function fmt(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

/** 0 = 일요일 … 6 = 토요일 */
export function dayOfWeek(date: string): number {
  return new Date(parse(date)).getUTCDay()
}

function shift(date: string, days: number): string {
  return fmt(parse(date) + days * 86400000)
}

/* ---------- 공휴일 만들기 ---------- */

export interface Holiday {
  /** YYYY-MM-DD */
  date: string
  /** 달력 칸에 보일 이름 */
  name: string
  /** 대체공휴일인가 */
  substitute: boolean
  /** 대체공휴일이면 무엇 때문에 생긴 것인지 */
  source?: string
}

/** 한 해의 공휴일. 날짜 순으로 준다. */
export function holidaysOfYear(year: number): Holiday[] {
  // 1) 대체공휴일을 빼고 먼저 모은다
  const base: (Holiday & { rule: SubRule })[] = []
  const put = (date: string, name: string, rule: SubRule): void => {
    base.push({ date, name, substitute: false, rule })
  }

  for (const f of FIXED) put(`${year}-${f.md}`, f.name, f.rule)

  const lunar = LUNAR[year]
  if (lunar) {
    const [seol, buddha, chuseok] = lunar
    // 부처님오신날은 하루, 설날·추석은 앞뒤로 사흘이다.
    put(`${year}-${buddha}`, '부처님오신날', 'full')
    for (const [md, label] of [
      [seol, '설날'],
      [chuseok, '추석']
    ] as const) {
      const day = `${year}-${md}`
      put(shift(day, -1), `${label} 전날`, 'sunday')
      put(day, label, 'sunday')
      put(shift(day, 1), `${label} 다음날`, 'sunday')
    }
  }

  // 같은 날에 겹친 공휴일끼리 묶는다 (2025년 5월 5일 = 어린이날 + 부처님오신날)
  const onDate = new Map<string, (Holiday & { rule: SubRule })[]>()
  for (const h of base) {
    const list = onDate.get(h.date)
    if (list) list.push(h)
    else onDate.set(h.date, [h])
  }

  /** 그 날이 이미 쉬는 날인가 — 일요일도 공휴일이다 */
  const isOff = (date: string): boolean => onDate.has(date) || dayOfWeek(date) === 0

  // 2) 대체공휴일을 붙인다.
  //    날짜 순으로 처리해야 뒤엣것이 앞엣것의 자리를 건너뛰며 잡는다.
  const subs: Holiday[] = []
  const taken = new Set<string>()

  for (const date of [...onDate.keys()].sort()) {
    const here = onDate.get(date)!
    const dow = dayOfWeek(date)
    const overlap = here.length > 1

    // 규칙이 다른 것이 한 날에 겹치면(2028년 추석 = 개천절) 너그러운 쪽을 따른다
    const need = here.some((h) => {
      if (h.rule === 'none') return false
      if (h.rule === 'sunday') return dow === 0
      return dow === 0 || dow === 6 || overlap
    })
    if (!need) continue

    // 그 다음 첫 번째 "쉬지 않는 날" 을 찾는다.
    // 이미 다른 대체공휴일이 차지한 날도 건너뛴다.
    let next = shift(date, 1)
    let guard = 0
    while ((isOff(next) || taken.has(next)) && guard++ < 30) next = shift(next, 1)

    // 한 날에 공휴일이 둘 겹쳐 있어도 대체공휴일은 하루만 준다.
    taken.add(next)
    subs.push({ date: next, name: '대체공휴일', substitute: true, source: sourceLabel(here) })
  }

  // 3) 그 해 것만 남기고, 같은 날에 겹친 것은 한 칸으로 합친다.
  //    (해를 넘긴 대체공휴일은 이듬해 계산에서 다시 나온다)
  const all = [...base.map(({ rule: _rule, ...h }) => h), ...subs]
    .filter((h) => h.date.startsWith(`${year}-`))
    .sort((a, b) => a.date.localeCompare(b.date))

  const out: Holiday[] = []
  for (const h of all) {
    const prev = out[out.length - 1]
    if (prev && prev.date === h.date) prev.name = `${prev.name}·${h.name}`
    else out.push({ ...h })
  }
  return out
}

/**
 * 대체공휴일이 무엇 때문에 생겼는지 적을 때 쓰는 이름.
 * "설날 다음날" 처럼 하루하루 부르지 않고 "설날 연휴" 로 묶어 읽는다.
 */
function sourceLabel(here: { name: string }[]): string {
  const names = here.map((h) =>
    h.name.startsWith('설날') ? '설날 연휴' : h.name.startsWith('추석') ? '추석 연휴' : h.name
  )
  return [...new Set(names)].join('·')
}

/**
 * 달력에 깔 표. 여러 해를 한꺼번에 담을 수 있다 —
 * 달력 격자에는 앞뒤 달이 함께 나오므로 해가 걸칠 때가 있다.
 *
 * 같은 날에 공휴일이 겹치면 이름을 가운뎃점으로 잇는다.
 * (2025년 5월 5일 = 어린이날·부처님오신날)
 */
export function holidayMap(yearList: number[]): Map<string, Holiday> {
  const out = new Map<string, Holiday>()
  for (const y of yearList) {
    for (const h of holidaysOfYear(y)) {
      const found = out.get(h.date)
      if (found) found.name = `${found.name}·${h.name}`
      else out.set(h.date, { ...h })
    }
  }
  return out
}

/** 대체공휴일이면 무엇 때문인지까지 붙여 읽어 준다 */
export function holidayLabel(h: Holiday): string {
  return h.substitute && h.source ? `${h.source} 대체공휴일` : h.name
}
