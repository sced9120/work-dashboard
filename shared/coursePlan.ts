/**
 * 교과진도평가계획 (3.8.0~) — 주별 진도표(courseCalendar) 위에 단원 · 성취기준 · 평가 계획을 얹어
 * 학교에 내는 문서의 글(마크다운)을 만든다. 마크다운은 hwp:answerDoc 으로 표가 살아 있는 한글 문서가 된다.
 *
 * AI 를 쓰지 않는다. 단원은 선생님이 적은 시수대로 주마다 차례로 나눈다.
 * 학업성적관리규정에 따라 학교마다 다른 값(반영 비율 · 기본점수 · 결시 처리)은 예시로 두고 [학교 규정 확인] 을 붙인다.
 */
import type { CalendarSpec, DayEvent, DaySpan, WeekRow } from './courseCalendar'
import { CalendarError, holidayWarnings, periodText, planWeeks, spanWarnings } from './courseCalendar'
import type { KnownHoliday } from './courseCalendar'

export interface CourseUnit {
  id: string
  name: string
  /** 이 단원에 쓸 시간(차시) */
  hours: number
  /** 관련 성취기준 — 한 줄에 하나 "[코드] 문장" */
  standards: string
}

export type EvalKind = '지필' | '수행'

export interface CourseEval {
  id: string
  kind: EvalKind
  name: string
  /** 반영 비율 % */
  ratio: number
  /** 시기 (예: 4월 4주) */
  when: string
  /** 영역 · 방법 · 내용 */
  detail: string
}

export interface CoursePlan {
  year: number
  term: 1 | 2
  grade: string
  subject: string
  teacher: string
  weeklyHours: number
  start: string
  end: string
  group: 1 | 2
  noClass: DaySpan[]
  events: DayEvent[]
  units: CourseUnit[]
  evals: CourseEval[]
  /** 평가 계획 아래 붙일 글 (결시 처리 · 재평가 등) */
  extra: string
}

export const REGULATION_MARK = '[학교 규정 확인]'

let seq = 0
export function newId(prefix: string): string {
  seq = (seq + 1) % 100000
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`
}

/** 학년도와 학기로 개학일 · 마지막 수업일을 짐작한다(학교 학사일정으로 꼭 고친다) */
export function defaultTerm(year: number, term: 1 | 2): { start: string; end: string } {
  return term === 1 ? { start: `${year}-03-02`, end: `${year}-07-17` } : { start: `${year}-08-17`, end: `${year + 1}-01-08` }
}

/** 학업성적관리 시행지침에서 흔한 꼴 — 예시 값이다 */
export function defaultEvals(): CourseEval[] {
  return [
    { id: newId('e'), kind: '지필', name: '1회고사', ratio: 30, when: '', detail: '선택형 · 서답형' },
    { id: newId('e'), kind: '지필', name: '2회고사', ratio: 30, when: '', detail: '선택형 · 서답형' },
    { id: newId('e'), kind: '수행', name: '수행평가', ratio: 40, when: '', detail: '영역 · 방법을 적어 주세요' }
  ]
}

export function emptyPlan(today = new Date()): CoursePlan {
  const month = today.getMonth() + 1
  // 9월 이후면 다음 해 1학기, 3~8월이면 2학기를 먼저 고른다 (계획은 학기 전에 쓰므로)
  const year = month >= 9 ? today.getFullYear() + 1 : today.getFullYear()
  const term: 1 | 2 = month >= 3 && month < 9 ? 2 : 1
  return {
    year,
    term,
    grade: '',
    subject: '',
    teacher: '',
    weeklyHours: 4,
    ...defaultTerm(year, term),
    group: 1,
    noClass: [],
    events: [],
    units: [],
    evals: defaultEvals(),
    extra: ''
  }
}

/** 저장해 둔 것을 읽는다 — 모양이 틀리면 버리고 기본값 */
export function readPlan(raw: unknown): CoursePlan {
  const base = emptyPlan()
  if (!raw || typeof raw !== 'object') return base
  const x = raw as Record<string, unknown>
  const str = (v: unknown, max = 3000): string => (typeof v === 'string' ? v.slice(0, max) : '')
  const num = (v: unknown, d: number, lo: number, hi: number): number => {
    const n = Math.floor(Number(v))
    return Number.isFinite(n) && n >= lo && n <= hi ? n : d
  }
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v.filter((i) => i && typeof i === 'object') as Record<string, unknown>[]) : [])
  return {
    year: num(x.year, base.year, 2020, 2100),
    term: x.term === 2 ? 2 : 1,
    grade: str(x.grade, 40),
    subject: str(x.subject, 80),
    teacher: str(x.teacher, 80),
    weeklyHours: num(x.weeklyHours, 4, 1, 35),
    start: str(x.start, 10) || base.start,
    end: str(x.end, 10) || base.end,
    group: x.group === 2 ? 2 : 1,
    noClass: arr(x.noClass)
      .map((s) => ({ from: str(s.from, 10), to: str(s.to, 10) || str(s.from, 10), label: str(s.label, 200) }))
      .filter((s) => s.from)
      .slice(0, 100),
    events: arr(x.events)
      .map((e) => ({ date: str(e.date, 10), label: str(e.label, 200) }))
      .filter((e) => e.date && e.label)
      .slice(0, 100),
    units: arr(x.units)
      .map((u) => ({ id: str(u.id, 40) || newId('u'), name: str(u.name, 200), hours: num(u.hours, 0, 0, 500), standards: str(u.standards, 5000) }))
      .slice(0, 60),
    evals: Array.isArray(x.evals)
      ? arr(x.evals)
          .map((e) => ({
            id: str(e.id, 40) || newId('e'),
            kind: (e.kind === '수행' ? '수행' : '지필') as EvalKind,
            name: str(e.name, 80),
            ratio: num(e.ratio, 0, 0, 100),
            when: str(e.when, 80),
            detail: str(e.detail, 1000)
          }))
          .slice(0, 20)
      : base.evals,
    extra: str(x.extra, 5000)
  }
}

export function specOf(p: CoursePlan): CalendarSpec {
  return { start: p.start, end: p.end, weeklyHours: p.weeklyHours, noClass: p.noClass, events: p.events, group: p.group }
}

export interface UnitSlot {
  unit: CourseUnit
  /** 이 주에 하는 차시 — 단원 안에서 몇째 시간부터 몇째까지 */
  from: number
  to: number
}

/** 주마다 단원을 시수대로 차례로 나눈다. 단원 시수가 다 차면 다음 단원으로 넘어간다 */
export function distributeUnits(rows: WeekRow[], units: CourseUnit[]): UnitSlot[][] {
  const list = units.filter((u) => u.hours > 0)
  // 단원마다 누계 시작 차시
  const starts: number[] = []
  let acc = 0
  for (const u of list) {
    starts.push(acc + 1)
    acc += u.hours
  }
  let prev = 0
  return rows.map((r) => {
    const lo = prev + 1
    const hi = r.cumulative
    prev = r.cumulative
    const out: UnitSlot[] = []
    if (hi < lo) return out
    list.forEach((u, i) => {
      const a = starts[i]
      const b = a + u.hours - 1
      const x = Math.max(a, lo)
      const y = Math.min(b, hi)
      if (x <= y) out.push({ unit: u, from: x - a + 1, to: y - a + 1 })
    })
    return out
  })
}

export function slotText(s: UnitSlot): string {
  const range = s.from === s.to ? `${s.from}차시` : `${s.from}~${s.to}차시`
  return `${s.unit.name.trim() || '(단원 이름)'} (${range})`
}

/** 표 칸에 넣을 글 — | 와 줄바꿈을 지운다 */
function cell(s: string): string {
  return s.replace(/\|/g, '/').replace(/\s*\n\s*/g, ' · ').trim()
}

/** 성취기준 줄에서 코드만 — 진도표 칸이 좁아 코드만 넣는다 */
export function codesOfLines(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const m = /^\s*(\[[^\]]+\])/.exec(line)
    if (m) out.push(m[1].replace(/\s+/g, ''))
  }
  return out
}

export interface PlanBuild {
  rows: WeekRow[]
  slots: UnitSlot[][]
  /** 진도표의 시간 합계 */
  total: number
  /** 단원 시수 합계 */
  unitHours: number
  /** 확인 필요 — 화면과 문서 끝에 함께 쓴다 */
  warnings: string[]
  /** 셈을 못 할 때의 까닭 */
  error?: string
}

export function buildPlan(p: CoursePlan, holidays: KnownHoliday[] = [], knownYears?: number[]): PlanBuild {
  let rows: WeekRow[] = []
  const warnings: string[] = []
  try {
    const spec = specOf(p)
    rows = planWeeks(spec)
    warnings.push(...holidayWarnings(spec, holidays, knownYears), ...spanWarnings(spec))
  } catch (e) {
    return { rows: [], slots: [], total: 0, unitHours: 0, warnings: [], error: e instanceof CalendarError ? e.message : String(e) }
  }
  const total = rows.length ? rows[rows.length - 1].cumulative : 0
  const unitHours = p.units.reduce((n, u) => n + Math.max(0, u.hours), 0)
  if (!p.units.length) warnings.push('단원을 넣지 않았습니다. 진도표의 단원 칸이 비어 나옵니다')
  else if (unitHours !== total) {
    warnings.push(
      unitHours < total
        ? `단원 시수 합계(${unitHours}시간)가 학기 예정 시간(${total}시간)보다 ${total - unitHours}시간 적습니다. 남는 주는 단원 칸이 비어 나옵니다`
        : `단원 시수 합계(${unitHours}시간)가 학기 예정 시간(${total}시간)보다 ${unitHours - total}시간 많습니다. 뒤 단원이 진도표에 다 들어가지 않습니다`
    )
  }
  for (const u of p.units) {
    if (!u.name.trim()) warnings.push('이름이 빈 단원이 있습니다')
    if (u.hours <= 0) warnings.push(`「${u.name.trim() || '이름 없는 단원'}」의 시수가 0 입니다`)
  }
  const ratio = p.evals.reduce((n, e) => n + e.ratio, 0)
  if (p.evals.length && ratio !== 100) warnings.push(`반영 비율의 합이 ${ratio}% 입니다. 100% 가 되게 고쳐 주세요`)
  return { rows, slots: distributeUnits(rows, p.units), total, unitHours, warnings }
}

const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ']

export function planTitle(p: CoursePlan): string {
  return `${p.year}학년도 ${p.term}학기 ${p.subject.trim() || '(과목)'} 교과진도평가계획`
}

/** 학교에 내는 문서의 글 (마크다운 — 표 · 제목 · 목록) */
export function planMarkdown(p: CoursePlan, b: PlanBuild): string {
  const L: string[] = []
  L.push(`# ${planTitle(p)}`)
  L.push('')
  const head = [
    p.grade.trim() ? `대상: ${p.grade.trim()}` : '',
    `주당 ${p.weeklyHours}시간`,
    `학기: ${periodText(p.start, p.end)} (${b.rows.length ? `${b.rows.length}${p.group === 2 ? '줄' : '주'}` : ''}, 예정 ${b.total}시간)`,
    p.teacher.trim() ? `담당: ${p.teacher.trim()}` : ''
  ].filter(Boolean)
  L.push(head.map((h) => `- ${h}`).join('\n'))
  L.push('')
  L.push(`## ${ROMAN[0]}. 교수 · 학습 운영 계획 (주별 진도표)`)
  L.push('')
  L.push('| 주 | 기간 | 수업일 | 공제 | 시간 | 누계 | 단원 (차시) | 성취기준 | 비고 |')
  L.push('|---|---|---|---|---|---|---|---|---|')
  b.rows.forEach((r, i) => {
    const slots = b.slots[i] ?? []
    const units = slots.map(slotText).join(', ')
    const codes = [...new Set(slots.flatMap((s) => codesOfLines(s.unit.standards)))].join(' ')
    L.push(
      `| ${r.week} | ${periodText(r.start, r.end)} | ${r.classDays} | ${r.deducted || ''} | ${r.hours} | ${r.cumulative} | ${cell(units)} | ${cell(codes)} | ${cell(r.notes.join(', '))} |`
    )
  })
  L.push('')
  L.push(`※ 예정 시간은 한 반 기준 "주당 시수 × 수업일 ÷ 5" 를 누계에서 반올림해 나눈 값입니다. 반마다 요일이 달라 실제 시간은 조금씩 다를 수 있습니다.`)
  L.push('')

  const withStd = p.units.filter((u) => u.standards.trim())
  if (withStd.length) {
    L.push('### 단원별 성취기준')
    L.push('')
    for (const u of withStd) {
      L.push(`**${u.name.trim() || '(단원 이름)'}** (${u.hours}시간)`)
      L.push('')
      for (const line of u.standards.split('\n').map((x) => x.trim()).filter(Boolean)) L.push(`- ${line}`)
      L.push('')
    }
  }

  L.push(`## ${ROMAN[1]}. 평가 계획`)
  L.push('')
  L.push('### 1. 평가 종류와 반영 비율')
  L.push('')
  if (p.evals.length) {
    L.push('| 구분 | 평가 | 반영 비율 | 시기 | 영역 · 방법 · 내용 |')
    L.push('|---|---|---|---|---|')
    for (const e of p.evals) L.push(`| ${e.kind}평가 | ${cell(e.name)} | ${e.ratio}% | ${cell(e.when)} | ${cell(e.detail)} |`)
    const sum = p.evals.reduce((n, e) => n + e.ratio, 0)
    L.push(`| 합계 |  | ${sum}% |  |  |`)
    L.push('')
  }
  L.push(`※ ${REGULATION_MARK} 반영 비율 · 수행평가 기본점수 · 결시생 처리 · 동점자 처리는 학교 학업성적관리규정에 따라 고쳐 써 주세요.`)
  L.push('')
  if (p.extra.trim()) {
    L.push('### 2. 그 밖의 사항')
    L.push('')
    for (const line of p.extra.split('\n').map((x) => x.trim()).filter(Boolean)) L.push(`- ${line}`)
    L.push('')
  }
  if (b.warnings.length) {
    L.push('## 확인 필요')
    L.push('')
    for (const w of b.warnings) L.push(`- ${w}`)
    L.push('')
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/* ---------- 학사일정 불러오기 ---------- */

export interface ScheduleDay {
  date: string
  name: string
  /** 나이스 수업공제일 구분: 휴업일 · 공휴일 · 해당없음 */
  off: string
}

/** 정기시험 날 — 학교마다 이름이 달라 몇 가지 꼴로 본다 */
const EXAM_RE = /(정기\s*고사|정기\s*시험|지필|중간\s*고사|기말\s*고사|[1-4]\s*회\s*고사|[1-4]\s*차\s*지필)/

/** 토 · 일이면 true */
function weekend(date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay()
  return d === 0 || d === 6
}

function nextDay(date: string, n = 1): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
}

/**
 * 나이스 학사일정 → 수업 없는 날. 휴업일 · 공휴일과 정기시험 날을 고르고,
 * 이름이 같은 날이 이어지면(주말을 건너뛰어도) 한 기간으로 묶는다. 토 · 일은 뺀다.
 */
export function scheduleToSpans(days: ScheduleDay[]): DaySpan[] {
  const picked = days
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && !weekend(d.date))
    .filter((d) => d.off === '휴업일' || d.off === '공휴일' || EXAM_RE.test(d.name))
    .map((d) => ({ date: d.date, label: (d.name || (d.off === '공휴일' ? '공휴일' : '휴업일')).trim() }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const seen = new Set<string>()
  const uniq = picked.filter((d) => (seen.has(d.date) ? false : (seen.add(d.date), true)))
  const out: DaySpan[] = []
  for (const d of uniq) {
    const last = out[out.length - 1]
    if (last && last.label === d.label) {
      // 다음 평일이면 잇는다 (금 → 월)
      let n = nextDay(last.to)
      while (weekend(n)) n = nextDay(n)
      if (n === d.date) {
        last.to = d.date
        continue
      }
    }
    out.push({ from: d.date, to: d.date, label: d.label })
  }
  return out
}

/** 이미 있는 수업 없는 날과 겹치지 않는 것만 더한다 (같은 날짜를 이미 덮고 있으면 뺀다) */
export function mergeSpans(have: DaySpan[], add: DaySpan[]): { list: DaySpan[]; added: number } {
  const covered = (date: string): boolean => have.some((s) => s.from <= date && date <= (s.to || s.from))
  const fresh = add.filter((s) => !covered(s.from) && !covered(s.to || s.from))
  const list = [...have, ...fresh].sort((a, b) => a.from.localeCompare(b.from))
  return { list, added: fresh.length }
}

/** 진도표를 엑셀에 붙여 넣을 탭 구분 글 */
export function planTsv(b: PlanBuild): string {
  const head = ['주', '기간', '수업일', '공제', '시간', '누계', '단원 (차시)', '성취기준', '비고']
  const rows = b.rows.map((r, i) => {
    const slots = b.slots[i] ?? []
    return [
      r.week,
      periodText(r.start, r.end),
      String(r.classDays),
      r.deducted ? String(r.deducted) : '',
      String(r.hours),
      String(r.cumulative),
      slots.map(slotText).join(', '),
      [...new Set(slots.flatMap((s) => codesOfLines(s.unit.standards)))].join(' '),
      r.notes.join(', ')
    ].map((c) => c.replace(/[\t\n]+/g, ' '))
  })
  return [head, ...rows].map((r) => r.join('\t')).join('\n')
}
