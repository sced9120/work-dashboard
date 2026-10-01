/**
 * 학교 시간표 — 엑셀 파일에서 읽고, 내 시간표를 뽑고, 수업을 바꿀 짝(교체·보강)을 찾는다.
 *
 * 학교마다 시간표 파일 모양이 다르다. 칸 자리를 정해 두지 않고 머리 칸을 찾아 세 가지 모양을 읽는다.
 * - 학급 묶음: "1학년 1반"(또는 1-1) 칸 오른쪽에 월~금, 아래에 1교시~. 칸은 "과목⏎선생님"
 * - 교사 묶음: 선생님 이름 칸 오른쪽에 월~금, 아래에 1교시~. 칸은 "103⏎국어"(반 번호 + 과목)
 * - 주간 시간표: 한 장짜리 표. 위 두 줄이 요일(월월월…)·교시(1 2 3…), 줄마다 선생님, 칸은 "103⏎국어"
 * 셋 다 "누가 · 언제 · 어느 반 · 무슨 과목" 목록으로 바꾼 뒤 반별 시간표로 모은다. 시트가 여러 장이면
 * 모두 읽고 같은 줄은 한 번만 센다(부장·부서별로 나눠 둔 시트가 같은 시간표의 일부인 경우).
 * "A_사문" 처럼 글자_과목은 여러 반이 함께 움직이는 이동수업 묶음이다.
 *
 * 선생님 이름이 들어 있어 인수인계 파일에는 넣지 않는다(electron/main/db.ts exportTo).
 */

export const TT_SCHOOL_KEY = 'timetable_school'
/** 내 이름 (학교 시간표에서 내 수업을 뽑을 때) */
export const TT_ME_KEY = 'timetable_me'
/** 내가 손으로 고친 칸 { "요일-교시": 글 } — 창체 · 동아리처럼 파일에 없는 것 */
export const TT_MANUAL_KEY = 'timetable_manual'
/** 교시 시각을 손으로 고친 것 { starts: ["08:40", …], length: 50 } */
export const TT_TIMES_KEY = 'timetable_times'
/** 우리 반 (담임 학급) 예: "2-4" */
export const MY_CLASS_KEY = 'my_class'

export const DAY_NAMES = ['월', '화', '수', '목', '금', '토']

export interface TtCell {
  subject: string
  teachers: string[]
  /** 이동수업 묶음 글자 (A_사문 → A). 없으면 빈 문자열 */
  group: string
}

export interface TtPeriod {
  no: number
  label: string
  /** 시작 시각 HH:MM. 모르면 빈 문자열 */
  start: string
}

export interface TtClass {
  /** 2-4 */
  id: string
  grade: number
  cls: number
  /** [요일][교시] */
  grid: (TtCell | null)[][]
}

export type TtLayout = '학급 묶음' | '교사 묶음' | '주간 시간표'

export interface SchoolTimetable {
  days: string[]
  periods: TtPeriod[]
  /** 요일마다 몇 교시까지 있는지 (수요일 4교시 등) */
  dayPeriods: number[]
  classes: TtClass[]
  teachers: string[]
  file: string
  loadedAt: string
  layouts: TtLayout[]
  warnings: string[]
}

/** 시트 하나를 글자 칸으로 */
export interface SheetText {
  name: string
  rows: string[][]
}

/** 내 시간표 한 칸 */
export interface MySlot {
  /** 2-4 · 이동수업이면 3-1·2 (모르면 빈 문자열) */
  cls: string
  subject: string
  group: string
  /** 손으로 적은 칸 (창체 · 동아리 등) */
  manual?: boolean
}

export interface MyTimetable {
  days: string[]
  periods: TtPeriod[]
  dayPeriods: number[]
  /** [요일][교시] */
  grid: (MySlot | null)[][]
  /** 학교 파일에서 뽑았는지, 손으로만 적었는지 */
  from: '학교 시간표' | '직접 적음'
}

/** 수업 한 칸 (누가 · 언제 · 어느 반 · 무슨 과목) */
interface Entry {
  teacher: string
  day: number
  period: number
  cls: string
  subject: string
  group: string
}

/* ---------- 칸 글 읽기 ---------- */

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** "2학년 4반" "2-4" "2학년4반" → [2, 4] */
export function classOf(text: string): [number, number] | null {
  const t = norm(text)
  let m = t.match(/^(\d)\s*학년\s*(\d{1,2})\s*반$/)
  if (m) return [Number(m[1]), Number(m[2])]
  m = t.match(/^(\d)\s*-\s*(\d{1,2})(?:\s*반)?$/)
  if (m) return [Number(m[1]), Number(m[2])]
  return null
}

/** 칸 안의 반 표시 — "103", "2-4", "2학년 4반" 과 나머지 글(과목) */
export function classIn(text: string): { id: string; rest: string } | null {
  const t = norm(text)
  const tries: RegExp[] = [/(\d)\s*학년\s*(\d{1,2})\s*반/, /(?:^|\s)(\d)\s*-\s*(\d{1,2})(?=\s|$)/, /(?:^|\s)([1-6])(0[1-9]|1[0-9])(?=\s|$)/]
  for (const re of tries) {
    const m = t.match(re)
    if (m) return { id: `${Number(m[1])}-${Number(m[2])}`, rest: norm(t.replace(m[0], ' ')) }
  }
  return null
}

const DAY_RE = /^(월|화|수|목|금|토)(요일)?$/

/** "3교시⏎(10:40)" "3교시" "3" → 3교시 */
function periodOf(text: string): TtPeriod | null {
  const t = norm(text)
  const m = t.match(/^(\d{1,2})\s*(교시)?(?:\s*\(?\s*(\d{1,2})\s*[:시]\s*(\d{2})?\s*\)?)?$/)
  if (!m) return null
  const no = Number(m[1])
  if (no < 1 || no > 12) return null
  const start = m[3] ? `${m[3].padStart(2, '0')}:${(m[4] ?? '00').padStart(2, '0')}` : ''
  return { no, label: `${no}교시`, start }
}

/** "A_사문" → { subject: 사문, group: A } */
function subjectOf(text: string): { subject: string; group: string } {
  const t = norm(text)
  const g = t.match(/^([A-Z])_(.+)$/)
  return g ? { subject: g[2], group: g[1] } : { subject: t, group: '' }
}

/** "과목⏎선생님" · "과목(선생님)" · "과목 선생님" */
export function parseCell(raw: string): TtCell | null {
  const text = raw.replace(/\r/g, '').trim()
  if (!text) return null
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean)
  let subject = lines[0]
  let teachers = lines.slice(1).join(',')
  if (lines.length === 1) {
    const paren = subject.match(/^(.+?)\s*[(（]\s*([가-힣 ,·]{2,})\s*[)）]$/)
    const spaced = subject.match(/^(\S+)\s+([가-힣]{2,4}(?:\s*[,·]\s*[가-힣]{2,4})*)$/)
    if (paren) {
      subject = paren[1]
      teachers = paren[2]
    } else if (spaced) {
      subject = spaced[1]
      teachers = spaced[2]
    }
  }
  const names = teachers
    .split(/[,·/]|\s+/)
    .map((s) => s.trim())
    .filter((s) => /^[가-힣A-Za-z]{2,5}$/.test(s))
  return { ...subjectOf(subject), teachers: names }
}

/** 빈 시간(공강 · 자습)인지 */
export const isFree = (c: { subject: string } | null): boolean => !c || /^\[?(공강|자습|없음)\]?$/.test(c.subject)

/** "홍길동(16)" "홍길동 선생님" → 홍길동 */
function teacherName(text: string): string {
  return norm(text)
    .replace(/\s*[(（]\s*\d+\s*[)）]\s*$/, '')
    .replace(/\s*(선생님|교사)$/, '')
}

const looksTeacher = (s: string): boolean => /^[가-힣]{2,4}$/.test(teacherName(s)) && !classOf(s) && !DAY_RE.test(norm(s))

/* ---------- 모양별로 읽기 ---------- */

interface Found {
  entries: Entry[]
  periods: Map<number, TtPeriod>
  layout: TtLayout
  unknown: number
}

/** 머리 칸 오른쪽에 요일이 늘어서고 아래에 교시가 내려가는 묶음 */
function readBlocks(sheet: SheetText, mode: '학급 묶음' | '교사 묶음'): Found {
  const out: Found = { entries: [], periods: new Map(), layout: mode, unknown: 0 }
  const isHead = mode === '학급 묶음' ? (t: string) => !!classOf(t) : looksTeacher
  sheet.rows.forEach((row, r) => {
    row.forEach((head, c) => {
      if (!head || !isHead(head)) return
      const dayCols: { col: number; day: number }[] = []
      for (let k = c + 1; k < row.length && dayCols.length < 6; k++) {
        const m = norm(row[k] ?? '').match(DAY_RE)
        if (!m) break
        dayCols.push({ col: k, day: DAY_NAMES.indexOf(m[1]) })
      }
      if (dayCols.length < 4) return
      const periodRows: { row: number; period: TtPeriod }[] = []
      for (let k = r + 1; k < sheet.rows.length && periodRows.length < 12; k++) {
        const p = periodOf(sheet.rows[k]?.[c] ?? '')
        if (!p) break
        periodRows.push({ row: k, period: p })
      }
      if (periodRows.length < 3) return
      for (const { period } of periodRows) {
        const had = out.periods.get(period.no)
        if (!had || (!had.start && period.start)) out.periods.set(period.no, period)
      }
      for (const { col, day } of dayCols) {
        for (const { row: pr, period } of periodRows) {
          const raw = (sheet.rows[pr]?.[col] ?? '').trim()
          if (!raw) continue
          if (mode === '학급 묶음') {
            const [g, n] = classOf(head)!
            const cell = parseCell(raw)
            if (!cell) continue
            const who = cell.teachers.length ? cell.teachers : ['']
            for (const t of who) out.entries.push({ teacher: t, day, period: period.no, cls: `${g}-${n}`, subject: cell.subject, group: cell.group })
          } else {
            const found = classIn(raw.replace(/\n/g, ' '))
            if (!found) {
              out.unknown++
              continue
            }
            out.entries.push({ teacher: teacherName(head), day, period: period.no, cls: found.id, ...subjectOf(found.rest || '수업') })
          }
        }
      }
    })
  })
  return out
}

/** 주간 시간표 — 요일 줄과 교시 줄이 위에 있고, 줄마다 선생님 */
function readMatrix(sheet: SheetText): Found {
  const out: Found = { entries: [], periods: new Map(), layout: '주간 시간표', unknown: 0 }
  for (let r = 0; r + 1 < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? []
    const cols: { col: number; day: number; period: number }[] = []
    row.forEach((v, c) => {
      const m = norm(v ?? '').match(DAY_RE)
      const p = periodOf(sheet.rows[r + 1]?.[c] ?? '')
      if (m && p) cols.push({ col: c, day: DAY_NAMES.indexOf(m[1]), period: p.no })
    })
    if (cols.length < 15) continue
    const nameCol = Math.min(...cols.map((x) => x.col)) - 1
    if (nameCol < 0) continue
    for (const x of cols) if (!out.periods.has(x.period)) out.periods.set(x.period, { no: x.period, label: `${x.period}교시`, start: '' })
    for (let k = r + 2; k < sheet.rows.length; k++) {
      const head = sheet.rows[k]?.[nameCol] ?? ''
      if (!looksTeacher(head)) continue
      const teacher = teacherName(head)
      for (const x of cols) {
        const raw = (sheet.rows[k]?.[x.col] ?? '').trim()
        if (!raw) continue
        const found = classIn(raw.replace(/\n/g, ' '))
        if (!found) {
          out.unknown++
          continue
        }
        out.entries.push({ teacher, day: x.day, period: x.period, cls: found.id, ...subjectOf(found.rest || '수업') })
      }
    }
    break
  }
  return out
}

/** 시간표 파일(시트들)을 읽는다. 못 읽으면 tt 가 null 이고 까닭을 돌려준다 */
export function parseTimetable(sheets: SheetText[], file: string, now: string): { tt: SchoolTimetable | null; error?: string } {
  const found: Found[] = []
  for (const s of sheets) {
    for (const f of [readMatrix(s), readBlocks(s, '학급 묶음'), readBlocks(s, '교사 묶음')]) {
      if (f.entries.length) found.push(f)
    }
  }
  if (!found.length) {
    return {
      tt: null,
      error:
        '시간표 모양을 찾지 못했습니다. 이런 표를 읽을 수 있습니다: ① 반 이름(1학년 1반 · 1-1) 칸 오른쪽에 월~금, 아래에 1교시~ ' +
        '② 선생님 이름 칸 오른쪽에 월~금, 아래에 1교시~ (칸에 103 국어처럼 반 번호) ③ 위에 요일 · 교시 두 줄, 줄마다 선생님인 주간 시간표'
    }
  }

  // 같은 수업은 한 번만
  const seen = new Set<string>()
  const entries: Entry[] = []
  for (const f of found)
    for (const e of f.entries) {
      const k = `${e.teacher}|${e.day}|${e.period}|${e.cls}`
      if (seen.has(k)) continue
      seen.add(k)
      entries.push(e)
    }

  const periodMap = new Map<number, TtPeriod>()
  for (const f of found)
    for (const [no, p] of f.periods) {
      const had = periodMap.get(no)
      if (!had || (!had.start && p.start)) periodMap.set(no, p)
    }

  const maxDay = Math.max(...entries.map((e) => e.day))
  const days = DAY_NAMES.slice(0, Math.max(5, maxDay + 1))
  const maxP = Math.max(...periodMap.keys(), ...entries.map((e) => e.period))
  const periods: TtPeriod[] = Array.from({ length: maxP }, (_, i) => periodMap.get(i + 1) ?? { no: i + 1, label: `${i + 1}교시`, start: '' })

  const classes = new Map<string, TtClass>()
  for (const e of entries) {
    const [g, n] = e.cls.split('-').map(Number)
    if (!classes.has(e.cls)) classes.set(e.cls, { id: e.cls, grade: g, cls: n, grid: days.map(() => periods.map(() => null)) })
    const grid = classes.get(e.cls)!.grid
    const prev = grid[e.day][e.period - 1]
    if (!prev) grid[e.day][e.period - 1] = { subject: e.subject, group: e.group, teachers: e.teacher ? [e.teacher] : [] }
    else if (e.teacher && !prev.teachers.includes(e.teacher)) prev.teachers.push(e.teacher)
  }

  const dayPeriods = days.map((_, d) => Math.max(0, ...entries.filter((e) => e.day === d).map((e) => e.period)))
  const warnings: string[] = []
  const unknown = found.reduce((n, f) => n + f.unknown, 0)
  if (unknown) warnings.push(`반을 알아보지 못한 칸 ${unknown}개는 뺐습니다.`)
  const noTeacher = entries.filter((e) => !e.teacher && !isFree(e)).length
  if (noTeacher) warnings.push(`선생님 이름이 없는 수업 칸이 ${noTeacher}개 있습니다. 그 칸은 교체 · 보강 후보에서 빠집니다.`)
  if (periods.some((p) => !p.start)) warnings.push('교시 시각이 파일에 없습니다. [교시 시각] 에서 적어 주시면 지금 몇 교시인지 보여 드립니다.')

  return {
    tt: {
      days,
      periods,
      dayPeriods,
      classes: [...classes.values()].sort((a, b) => a.grade - b.grade || a.cls - b.cls),
      teachers: [...new Set(entries.map((e) => e.teacher).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
      file,
      loadedAt: now,
      layouts: [...new Set(found.map((f) => f.layout))],
      warnings
    }
  }
}

/* ---------- 내 시간표 ---------- */

/** 학교 시간표에서 이 선생님의 수업을 뽑고, 손으로 적은 칸을 얹는다 */
export function myTimetable(tt: SchoolTimetable | null, name: string, manual: Record<string, string>): MyTimetable {
  const base = tt ?? blankSchool()
  const grid: (MySlot | null)[][] = base.days.map(() => base.periods.map(() => null))
  if (tt && name) {
    for (const c of tt.classes) {
      c.grid.forEach((col, d) =>
        col.forEach((cell, p) => {
          if (!cell || !cell.teachers.includes(name)) return
          const cur = grid[d][p]
          if (!cur) grid[d][p] = { cls: c.id, subject: cell.subject, group: cell.group }
          else if (cell.group && cur.group === cell.group) {
            // 이동수업은 여러 반이 한 묶음이다 → 3-1·2·3
            const [g, n] = c.id.split('-')
            if (cur.cls.startsWith(`${g}-`) && !cur.cls.split(/[-·]/).slice(1).includes(n)) cur.cls = `${cur.cls}·${n}`
          }
        })
      )
    }
  }
  for (const [k, v] of Object.entries(manual)) {
    const [d, p] = k.split('-').map(Number)
    if (!(d >= 0 && d < grid.length && p >= 0 && p < base.periods.length)) continue
    grid[d][p] = v.trim() ? { ...slotFromText(v)!, manual: true } : null
  }
  const dayPeriods = base.days.map((_, d) => {
    let n = base.dayPeriods[d] ?? 0
    grid[d].forEach((s, p) => {
      if (s) n = Math.max(n, p + 1)
    })
    return n
  })
  return { days: base.days, periods: base.periods, dayPeriods, grid, from: tt && name ? '학교 시간표' : '직접 적음' }
}

/** 시간표 파일이 없을 때의 빈 틀 (월~금 · 7교시) */
function blankSchool(): SchoolTimetable {
  return {
    days: DAY_NAMES.slice(0, 5),
    periods: Array.from({ length: 7 }, (_, i) => ({ no: i + 1, label: `${i + 1}교시`, start: '' })),
    dayPeriods: [7, 7, 7, 7, 7],
    classes: [],
    teachers: [],
    file: '',
    loadedAt: '',
    layouts: [],
    warnings: []
  }
}

/** 교시 시각을 손으로 고친 것이 있으면 얹는다 */
export function withTimes(periods: TtPeriod[], starts: string[]): TtPeriod[] {
  return periods.map((p, i) => (/^\d{2}:\d{2}$/.test(starts[i] ?? '') ? { ...p, start: starts[i] } : p))
}

/** 이 선생님이 그 시간에 수업이 있는가 */
export function busy(tt: SchoolTimetable, name: string, d: number, p: number): boolean {
  return tt.classes.some((c) => c.grid[d]?.[p]?.teachers.includes(name))
}

/** 한 주 수업 시수 (손으로 적은 창체 · 동아리는 빼고) */
export function hoursOf(my: MyTimetable): number {
  return my.grid.flat().filter((s) => s && !s.manual && !isFree(s)).length
}

/* ---------- 바꾸기 ---------- */

export interface SwapOption {
  day: number
  period: number
  /** 그 시간에 같은 반을 가르치는 선생님 */
  teacher: string
  subject: string
}

export interface CoverOption {
  teacher: string
  /** 그날 수업 수 */
  load: number
  /** 같은 과목을 가르치는가 */
  sameSubject: boolean
}

export interface ChangePlan {
  cls: string
  subject: string
  group: string
  swaps: SwapOption[]
  covers: CoverOption[]
  notes: string[]
}

/**
 * 내 수업(d1, p1)을 비울 때 찾을 수 있는 것.
 * - 맞교체: 같은 반을 같은 주에 가르치는 다른 선생님 수업 가운데, 그 시간에 내가 비고 그 선생님이 (d1,p1)에 비는 것
 * - 보강: (d1,p1)에 수업이 없는 선생님. 같은 과목이고 그날 수업이 적은 분을 앞에
 * 이동수업 묶음은 여러 반이 함께 움직여 한 반만 바꿀 수 없으므로 맞교체 후보를 내지 않는다.
 */
export function planChange(tt: SchoolTimetable, me: string, d1: number, p1: number): ChangePlan | null {
  const mine = tt.classes.filter((c) => c.grid[d1]?.[p1]?.teachers.includes(me))
  if (!mine.length) return null
  const cell = mine[0].grid[d1][p1]!
  const notes: string[] = []
  const swaps: SwapOption[] = []
  if (cell.group) {
    notes.push(`이동수업 묶음(${cell.group})이라 여러 반이 함께 움직입니다. 맞교체는 묶음 전체를 함께 봐야 해서 후보를 내지 않습니다.`)
  } else {
    const c = mine[0]
    c.grid.forEach((col, d) =>
      col.forEach((other, p) => {
        if ((d === d1 && p === p1) || !other || isFree(other) || other.group) return
        for (const t of other.teachers) {
          if (t === me || busy(tt, me, d, p) || busy(tt, t, d1, p1)) continue
          swaps.push({ day: d, period: p, teacher: t, subject: other.subject })
        }
      })
    )
    swaps.sort((a, b) => Math.abs(a.day - d1) - Math.abs(b.day - d1) || a.day - b.day || a.period - b.period)
  }
  const subjects = new Map<string, Set<string>>()
  for (const c of tt.classes)
    for (const col of c.grid)
      for (const x of col)
        for (const t of x?.teachers ?? []) {
          if (!subjects.has(t)) subjects.set(t, new Set())
          subjects.get(t)!.add(x!.subject)
        }
  const covers: CoverOption[] = tt.teachers
    .filter((t) => t !== me && !busy(tt, t, d1, p1))
    .map((t) => ({
      teacher: t,
      load: tt.periods.filter((_, p) => busy(tt, t, d1, p)).length,
      sameSubject: !!subjects.get(t)?.has(cell.subject)
    }))
    .sort((a, b) => Number(b.sameSubject) - Number(a.sameSubject) || a.load - b.load || a.teacher.localeCompare(b.teacher, 'ko'))
  if (p1 + 1 > (tt.dayPeriods[d1] ?? 99)) notes.push('그날 정규 교시 뒤의 수업입니다.')
  return { cls: mine.map((c) => c.id).join('·'), subject: cell.subject, group: cell.group, swaps, covers, notes }
}

/* ---------- 날짜 · 시각 ---------- */

/** 그 날의 요일 칸 (월=0). 일요일이면 -1 */
export function dayIndex(day: string): number {
  const w = new Date(`${day}T00:00:00`).getDay()
  return w >= 1 && w <= 6 ? w - 1 : -1
}

/** 그 날이 든 주의 월요일 + k 일 */
export function weekDate(day: string, k: number): string {
  const d = new Date(`${day}T00:00:00`)
  const w = d.getDay() === 0 ? 7 : d.getDay()
  d.setDate(d.getDate() - (w - 1) + k)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const toMin = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const toHHMM = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** 교시가 끝나는 시각 */
export const endOf = (p: TtPeriod, length = 50): string => (p.start ? toHHMM(toMin(p.start) + length) : '')

/** 점심 시간 — 앞 교시가 끝나고 다음 교시가 시작하기까지 30분 넘게 비는 곳. 없으면 null */
export function lunchOf(periods: TtPeriod[], length = 50): { after: number; from: string; to: string; minutes: number } | null {
  for (let i = 0; i + 1 < periods.length; i++) {
    if (!periods[i].start || !periods[i + 1].start) continue
    const end = toMin(periods[i].start) + length
    const gap = toMin(periods[i + 1].start) - end
    if (gap >= 30) return { after: i, from: toHHMM(end), to: periods[i + 1].start, minutes: gap }
  }
  return null
}

/** 지금 몇 교시인지 (수업 중이면 그 교시, 쉬는 시간이면 다음 교시). 시각을 모르면 -1 */
export function periodNow(periods: TtPeriod[], hhmm: string, length = 50): { index: number; during: boolean } {
  if (!periods.length || periods.some((p) => !p.start)) return { index: -1, during: false }
  const now = toMin(hhmm)
  for (let i = 0; i < periods.length; i++) {
    const s = toMin(periods[i].start)
    if (now < s) return { index: i, during: false }
    if (now < s + length) return { index: i, during: true }
  }
  return { index: periods.length, during: false }
}

/** "2-4 국어" "1-1 공통수학" "창체" 처럼 적은 칸을 나눈다 */
export function slotFromText(text: string): MySlot | null {
  const t = norm(text)
  if (!t) return null
  const found = classIn(t)
  if (found) return { cls: found.id, subject: found.rest || '수업', group: '' }
  return { cls: '', subject: t, group: '' }
}

export const slotText = (s: MySlot | null): string => (s ? `${s.cls ? `${s.cls} ` : ''}${s.subject}` : '')
