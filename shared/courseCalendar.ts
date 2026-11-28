/**
 * 교과진도평가계획의 주별 진도표 셈 (3.8.0~).
 *
 * 학사일정(개학일 · 마지막 수업일 · 수업 없는 평일 · 행사)과 주당 시수로
 * 주마다 기간 · 수업일 · 공제일수 · 예정 시간 · 누계를 센다.
 *
 * 세는 법
 * - 주는 월~금. 개학일이 든 주가 1주다. 개학 전 · 종업 뒤 평일은 그 주에 넣지 않는다(공제도 아니다).
 * - 수업이 없는 평일 = 공제일.
 * - 예정 시간은 한 반 기준 "주당 시수 × 누계 수업일 ÷ 5" 를 누계에서 반올림해 나눈다.
 *   주마다 반올림하면 누계가 틀어지므로 누계를 먼저 셈하고 그 차이를 그 주 시간으로 쓴다.
 * - 여러 반을 맡아도 반마다 요일이 달라 한 반 기준으로 세고, 요일은 따지지 않는다.
 */

export interface DaySpan {
  /** YYYY-MM-DD */
  from: string
  /** YYYY-MM-DD (하루면 from 과 같다) */
  to: string
  label: string
}

export interface DayEvent {
  date: string
  label: string
}

export interface CalendarSpec {
  start: string
  end: string
  weeklyHours: number
  /** 수업이 없는 평일(공휴일 · 재량휴업일 · 정기시험 …) */
  noClass: DaySpan[]
  /** 비고 칸에만 적을 행사 — 수업일은 줄지 않는다 */
  events?: DayEvent[]
  /** 진도표 한 줄에 묶을 주 수 (1 또는 2) */
  group?: 1 | 2
}

export interface WeekRow {
  /** "1" 또는 묶었으면 "1~2" */
  week: string
  start: string
  end: string
  classDays: number
  deducted: number
  hours: number
  cumulative: number
  notes: string[]
}

export class CalendarError extends Error {}

const ISO = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/
export const MAX_DAYS = 200
export const MAX_WEEKLY = 35
export const MAX_ITEMS = 100
export const MAX_LABEL = 3000

/* 날짜는 모두 UTC 자정으로 다룬다 (시간대 · 일광절약 때문에 하루가 밀리지 않게) */
const DAY = 86400000

export function parseDay(value: unknown, field: string): number {
  const text = String(value ?? '').trim()
  const m = ISO.exec(text)
  if (m) {
    const y = Number(m[1])
    const mo = Number(m[2])
    const d = Number(m[3])
    const t = Date.UTC(y, mo - 1, d)
    const back = new Date(t)
    if (back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d) return t
  }
  throw new CalendarError(`${field} '${text.slice(0, 20)}' 은 YYYY-MM-DD 꼴의 있는 날짜여야 합니다 (예: 2026-03-03)`)
}

export function isoOf(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

/** 월=0 … 일=6 */
function weekdayOf(t: number): number {
  return (new Date(t).getUTCDay() + 6) % 7
}

/** 학교 문서식 짧은 날짜: 3.3. */
export function shortDay(t: number | string): string {
  const d = new Date(typeof t === 'string' ? parseDay(t, '날짜') : t)
  return `${d.getUTCMonth() + 1}.${d.getUTCDate()}.`
}

export function periodText(a: number | string, b: number | string): string {
  const sa = shortDay(a)
  const sb = shortDay(b)
  return sa === sb ? sa : `${sa}~${sb}`
}

function label(value: unknown, field: string, fallback: string | null): string {
  if (value !== undefined && value !== null && typeof value !== 'string') throw new CalendarError(`${field} 은 글자여야 합니다`)
  const text = (value ?? '').trim()
  if (text.length > MAX_LABEL) throw new CalendarError(`${field} 이 너무 깁니다 (${text.length}자, ${MAX_LABEL}자까지)`)
  if (!text && fallback === null) throw new CalendarError(`${field} 이 비어 있습니다 (행사 이름을 적어 주세요)`)
  return text || (fallback as string)
}

interface Span {
  a: number
  b: number
  label: string
}

function spansOf(spec: CalendarSpec): Span[] {
  const list = Array.isArray(spec.noClass) ? spec.noClass : []
  if (list.length > MAX_ITEMS) throw new CalendarError(`수업 없는 날이 너무 많습니다 (${list.length}개, ${MAX_ITEMS}개까지)`)
  return list.map((x, i) => {
    const n = i + 1
    const a = parseDay(x?.from, `수업 없는 날 ${n}번째 시작일`)
    const b = x?.to ? parseDay(x.to, `수업 없는 날 ${n}번째 끝날`) : a
    if (a > b) throw new CalendarError(`수업 없는 날 ${n}번째: 시작일(${isoOf(a)})이 끝날(${isoOf(b)})보다 앞서야 합니다`)
    return { a, b, label: label(x?.label, `수업 없는 날 ${n}번째 이름`, '수업 없음') }
  })
}

function eventsOf(spec: CalendarSpec): { t: number; label: string }[] {
  const list = Array.isArray(spec.events) ? spec.events : []
  if (list.length > MAX_ITEMS) throw new CalendarError(`행사가 너무 많습니다 (${list.length}개, ${MAX_ITEMS}개까지)`)
  return list.map((x, i) => ({ t: parseDay(x?.date, `행사 ${i + 1}번째 날짜`), label: label(x?.label, `행사 ${i + 1}번째 이름`, null) }))
}

export function termOf(spec: CalendarSpec): { start: number; end: number } {
  const start = parseDay(spec.start, '개학일')
  const end = parseDay(spec.end, '마지막 수업일')
  if (start > end) throw new CalendarError(`개학일(${isoOf(start)})이 마지막 수업일(${isoOf(end)})보다 앞서야 합니다`)
  if ((end - start) / DAY > MAX_DAYS) throw new CalendarError(`학기가 너무 깁니다: ${isoOf(start)}~${isoOf(end)} (한 학기는 ${MAX_DAYS}일까지)`)
  return { start, end }
}

function weeklyOf(spec: CalendarSpec): number {
  const h = spec.weeklyHours
  if (typeof h !== 'number' || !Number.isInteger(h) || h < 1 || h > MAX_WEEKLY) {
    throw new CalendarError(`주당 수업 시수는 1~${MAX_WEEKLY} 사이의 정수여야 합니다 (받은 값: ${String(h)})`)
  }
  return h
}

function groupOf(spec: CalendarSpec): 1 | 2 {
  const g = spec.group ?? 1
  if (g !== 1 && g !== 2) throw new CalendarError(`묶을 주 수는 1 또는 2 여야 합니다 (받은 값: ${String(g)})`)
  return g
}

/** 수업이 없는 날 — 기간을 학기 안으로 잘라 펼친다(아주 긴 기간도 학기 길이만큼만) */
function offDays(spans: Span[], start: number, end: number): Set<number> {
  const s = new Set<number>()
  for (const sp of spans) {
    const lo = Math.max(sp.a, start)
    const hi = Math.min(sp.b, end)
    for (let t = lo; t <= hi; t += DAY) s.add(t)
  }
  return s
}

function notesOf(first: number, last: number, spans: Span[], events: { t: number; label: string }[]): string[] {
  const out = spans.filter((s) => s.a <= last && s.b >= first).map((s) => `${periodText(Math.max(s.a, first), Math.min(s.b, last))} ${s.label}`)
  for (const e of events) if (first <= e.t && e.t <= last) out.push(`${shortDay(e.t)} ${e.label}`)
  return out
}

interface Single {
  week: number
  start: number
  end: number
  classDays: number
  deducted: number
  hours: number
  cumulative: number
}

function singleWeeks(spec: CalendarSpec, spans: Span[]): Single[] {
  const { start, end } = termOf(spec)
  const weekly = weeklyOf(spec)
  const off = offDays(spans, start, end)
  const weeks: Single[] = []
  let monday = start - weekdayOf(start) * DAY
  let cumDays = 0
  let cumHours = 0
  while (monday <= end) {
    const days: number[] = []
    for (let i = 0; i < 5; i++) {
      const d = monday + i * DAY
      if (d >= start && d <= end) days.push(d)
    }
    monday += 7 * DAY
    if (!days.length) continue
    const classDays = days.filter((d) => !off.has(d)).length
    cumDays += classDays
    // 주당 시수 × 누계 수업일 ÷ 5 를 반올림 (0.5 는 올림)
    const total = Math.floor((2 * weekly * cumDays + 5) / 10)
    weeks.push({ week: weeks.length + 1, start: days[0], end: days[days.length - 1], classDays, deducted: days.length - classDays, hours: total - cumHours, cumulative: total })
    cumHours = total
  }
  if (!weeks.length) throw new CalendarError(`학기(${isoOf(start)}~${isoOf(end)})에 평일이 하루도 없습니다. 개학일과 마지막 수업일을 확인해 주세요`)
  return weeks
}

/** 주(또는 2주) 한 줄씩 */
export function planWeeks(spec: CalendarSpec): WeekRow[] {
  if (!spec || typeof spec !== 'object') throw new CalendarError('학사일정이 비어 있습니다')
  const group = groupOf(spec)
  const spans = spansOf(spec)
  const events = eventsOf(spec)
  const weeks = singleWeeks(spec, spans)
  const rows: WeekRow[] = []
  for (let i = 0; i < weeks.length; i += group) {
    const part = weeks.slice(i, i + group)
    const first = part[0]
    const last = part[part.length - 1]
    rows.push({
      week: part.length === 1 ? String(first.week) : `${first.week}~${last.week}`,
      start: isoOf(first.start),
      end: isoOf(last.end),
      classDays: part.reduce((n, w) => n + w.classDays, 0),
      deducted: part.reduce((n, w) => n + w.deducted, 0),
      hours: part.reduce((n, w) => n + w.hours, 0),
      cumulative: last.cumulative,
      notes: notesOf(first.start, last.end, spans, events)
    })
  }
  return rows
}

export interface KnownHoliday {
  date: string
  name: string
  /** false 면 날짜 · 공휴일 여부를 학사일정으로 확인하라고 덧붙인다 */
  certain?: boolean
}

/**
 * 학기 안의 평일 공휴일이 수업 없는 날에 없으면 알린다.
 * holidays 는 화면이 프로그램 안의 공휴일 계산(src/lib/holidays.ts)으로 넘긴다. knownYears 에 없는 해는 그 사실을 알린다.
 */
export function holidayWarnings(spec: CalendarSpec, holidays: KnownHoliday[], knownYears?: number[]): string[] {
  const { start, end } = termOf(spec)
  const off = offDays(spansOf(spec), start, end)
  const out: string[] = []
  if (knownYears) {
    const ys = new Set([new Date(start).getUTCFullYear(), new Date(end).getUTCFullYear()])
    for (const y of [...ys].sort()) if (!knownYears.includes(y)) out.push(`${y}년 공휴일 표가 없습니다. 빠진 공휴일이 없는지 학사일정으로 확인해 주세요`)
  }
  const seen = new Set<string>()
  for (const h of [...holidays].sort((a, b) => a.date.localeCompare(b.date))) {
    let t: number
    try {
      t = parseDay(h.date, '공휴일')
    } catch {
      continue
    }
    if (seen.has(h.date) || t < start || t > end || weekdayOf(t) > 4 || off.has(t)) continue
    seen.add(h.date)
    out.push(`${shortDay(t)} ${h.name}: 수업 없는 날에 없습니다${h.certain === false ? ' (공휴일 여부 · 날짜를 학사일정으로 확인)' : ''}`)
  }
  return out
}

/** 학기 밖에 있거나 학기 안 평일이 하루도 없는 수업 없는 날 (연도를 잘못 쓴 정기시험 등) */
export function spanWarnings(spec: CalendarSpec): string[] {
  const { start, end } = termOf(spec)
  const out: string[] = []
  for (const s of spansOf(spec)) {
    const where = s.a === s.b ? isoOf(s.a) : `${isoOf(s.a)}~${isoOf(s.b)}`
    if (s.b < start || s.a > end) {
      out.push(`수업 없는 날 '${s.label}'(${where})이 학기(${isoOf(start)}~${isoOf(end)}) 밖에 있습니다. 날짜를 확인해 주세요`)
      continue
    }
    const days = [...offDays([s], start, end)]
    if (!days.some((d) => weekdayOf(d) < 5)) out.push(`수업 없는 날 '${s.label}'(${where})에 학기 안 평일이 없습니다. 날짜를 확인해 주세요`)
  }
  return out
}
