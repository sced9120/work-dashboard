/**
 * 학교 시간표 — 엑셀 파일에서 읽고, 내 시간표를 뽑고, 수업을 바꿀 짝(교체·보강)을 찾는다.
 *
 * 학교마다 시간표 파일 모양이 다르다. 칸 자리를 정해 두지 않고 머리 칸을 찾아 세 가지 모양을 읽는다.
 * - 학급 묶음: "1학년 1반"(또는 1-1) 칸 오른쪽에 월~금, 아래에 1교시~. 칸은 "과목⏎선생님"
 * - 교사 묶음: 선생님 이름 칸 오른쪽에 월~금, 아래에 1교시~. 칸은 "103⏎국어"(반 번호 + 과목)
 * - 주간 시간표: 한 장짜리 표. 위 두 줄이 요일(월월월…)·교시(1 2 3…), 줄마다 선생님, 칸은 "103⏎국어"
 * 셋 다 "누가 · 언제 · 어느 반 · 무슨 과목" 목록으로 바꾼 뒤 반별 시간표로 모은다. 시트가 여러 장이면
 * 모두 읽고 같은 줄은 한 번만 센다(부장·부서별로 나눠 둔 시트가 같은 시간표의 일부인 경우).
 * 다만 시트끼리 같은 시간에 다른 수업이 있으면(교체를 반영한 판을 시트마다 따로 둔 경우) 합치면 수업이 꼬이므로
 * 한 시트만 읽는다(selectSheets).
 * "A_사문" 처럼 글자_과목은 여러 반이 함께 움직이는 이동수업 묶음이다. 칸 색깔도 읽어 두어(블록 표시) 블록 설정을 짐작한다.
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
  /** 엑셀 칸 색 #RRGGBB (칠하지 않았으면 없음) — 학교가 블록을 색으로 칠해 두는 경우가 많다 */
  color?: string
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

export type TtLayout = '학급 묶음' | '교사 묶음' | '주간 시간표' | '표준 목록' | 'AI로 읽음'

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
  /** 불러온 때 (ISO). 블록 설정을 이 시간표로 확인했는지 가릴 때 쓴다 */
  stamp?: string
  /** 불러온 파일 경로 — 다른 시트로 다시 읽을 때 쓴다. 이 PC 에만 둔다 */
  sources?: string[]
  /** 시트끼리 수업이 달라 한 판만 읽었을 때: 고를 수 있는 시트와 읽은 시트 */
  versions?: { sheets: string[]; used: string[] }
  /** 파일에 적힌 선생님별 한 주 시수 — "홍길동(16)" 의 16. 읽은 수업 수와 맞춰 본다 */
  expected?: Record<string, number>
  /** 표준 목록에서 읽은 창체 · 동아리 시간 (grade 0 = 모든 학년) */
  fixed?: TtFixed[]
  /** 담임 칸이 있는 파일: 선생님 → 담임 반. 이름을 고르면 우리 반을 채워 준다 */
  homerooms?: Record<string, string>
}

/** 창체 · 동아리처럼 학년 전체가 함께 하는 고정 시간 */
export type FixedKind = '창체' | '동아리'

export interface TtFixed {
  kind: FixedKind
  grade: number
  day: number
  /** 0부터 */
  period: number
}

/** 시트 하나를 글자 칸으로 */
export interface SheetText {
  name: string
  rows: string[][]
  /** 칸 색 #RRGGBB, 칠하지 않았으면 빈 문자열 (rows 와 같은 모양) */
  fills?: string[][]
}

export interface ParseOptions {
  /** 시트끼리 수업이 다를 때 먼저 읽을 시트 이름 */
  sheet?: string
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
  color: string
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
  const first = text.replace(/\r/g, '').split('\n').map((s) => s.trim()).find(Boolean) ?? ''
  return norm(first)
    .replace(/\s*[(（][^)）]*[)）]\s*$/, '')
    .replace(/\s*(선생님|교사)$/, '')
}

/** 블록 글자 한 자 — 3학년 A~Z, 2학년 가~하 처럼 적는 학교가 있다 */
const BLOCK_LETTER = /^([A-Z]|[가나다라마바사아자차카타파하])$/

/** 반이 아닌 줄 글이 창체 · 동아리인지 */
const fixedWord = (t: string): FixedKind | '' => (/^창체|^자율|^진로활동/.test(t) ? '창체' : /^동아리/.test(t) ? '동아리' : '')

/** "홍길동(16)" → 16 */
function hoursIn(text: string): number | null {
  const m = norm(text).match(/[(（]\s*(\d{1,2})\s*[)）]\s*$/)
  return m ? Number(m[1]) : null
}

const looksTeacher = (s: string): boolean => /^[가-힣]{2,4}$/.test(teacherName(s)) && !classOf(s) && !DAY_RE.test(norm(s))

/* ---------- 모양별로 읽기 ---------- */

interface Found {
  entries: Entry[]
  periods: Map<number, TtPeriod>
  layout: TtLayout
  unknown: number
  /** 선생님 이름 칸에 적힌 시수 */
  expected: Map<string, number>
  fixed: TtFixed[]
  /** 담임 칸에서 읽은 선생님 → 담임 반 */
  homerooms: Map<string, string>
}

const emptyFound = (layout: TtLayout): Found => ({ entries: [], periods: new Map(), layout, unknown: 0, expected: new Map(), fixed: [], homerooms: new Map() })

/** 머리 칸 오른쪽에 요일이 늘어서고 아래에 교시가 내려가는 묶음 */
function readBlocks(sheet: SheetText, mode: '학급 묶음' | '교사 묶음'): Found {
  const out = emptyFound(mode)
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
      const hours = mode === '교사 묶음' ? hoursIn(head) : null
      if (hours !== null) out.expected.set(teacherName(head), hours)
      for (const { period } of periodRows) {
        const had = out.periods.get(period.no)
        if (!had || (!had.start && period.start)) out.periods.set(period.no, period)
      }
      for (const { col, day } of dayCols) {
        for (const { row: pr, period } of periodRows) {
          const raw = (sheet.rows[pr]?.[col] ?? '').trim()
          if (!raw) continue
          const color = sheet.fills?.[pr]?.[col] ?? ''
          if (mode === '학급 묶음') {
            const [g, n] = classOf(head)!
            const cell = parseCell(raw)
            if (!cell) continue
            const who = cell.teachers.length ? cell.teachers : ['']
            for (const t of who)
              out.entries.push({ teacher: t, day, period: period.no, cls: `${g}-${n}`, subject: cell.subject, group: cell.group, color })
          } else {
            const found = classIn(raw.replace(/\n/g, ' '))
            if (!found) {
              out.unknown++
              continue
            }
            out.entries.push({ teacher: teacherName(head), day, period: period.no, cls: found.id, ...subjectOf(found.rest || '수업'), color })
          }
        }
      }
    })
  })
  return out
}

/** 주간 시간표 — 요일 줄과 교시 줄이 위에 있고, 줄마다 선생님 */
/**
 * 주간 시간표.
 * - 한 줄 판: 줄마다 선생님, 칸은 "103⏎국어"
 * - 두 줄 판: 선생님 한 분이 두 줄(이름 칸을 합쳐 둠). 윗줄은 과목 또는 블록 글자(A · 가), 아랫줄은 반(1-7)
 */
function readMatrix(sheet: SheetText): Found {
  const out = emptyFound('주간 시간표')
  let fixedSeenRef: Set<string> = new Set()
  const addFixed = (kind: FixedKind, x: { day: number; period: number }): void => {
    const key = `${kind}|${x.day}|${x.period}`
    if (fixedSeenRef.has(key)) return
    fixedSeenRef.add(key)
    out.fixed.push({ kind, grade: 0, day: x.day, period: x.period - 1 })
  }
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
    // 머리 줄의 담임 · 시수 칸 (요일 칸 오른쪽)
    const lastCol = Math.max(...cols.map((x) => x.col))
    const headCol = (re: RegExp): number => row.findIndex((v, c) => c > lastCol && re.test(norm(v ?? '')))
    const homeCol = headCol(/^담임$/)
    const hoursCol = headCol(/^(시수|계|합계)$/)
    const isClassText = (t: string): boolean => !!classIn(t.replace(/\n/g, ' '))
    fixedSeenRef = new Set<string>()
    for (let k = r + 2; k < sheet.rows.length; k++) {
      const head = sheet.rows[k]?.[nameCol] ?? ''
      if (!looksTeacher(head)) continue
      const teacher = teacherName(head)
      const hours = hoursIn(head) ?? (hoursCol >= 0 ? Number(norm(sheet.rows[k]?.[hoursCol] ?? '')) || null : null)
      if (hours !== null) out.expected.set(teacher, hours)
      if (homeCol >= 0) {
        const home = classIn(norm(sheet.rows[k]?.[homeCol] ?? ''))
        if (home) out.homerooms.set(teacher, home.id)
      }
      // 두 줄 판: 다음 줄도 같은 선생님(이름 칸을 합쳐 둠)이고, 윗줄에는 반이 없고 아랫줄에는 반이 있다
      const next = sheet.rows[k + 1]
      const nextHead = next?.[nameCol] ?? ''
      const topCells = cols.map((x) => (sheet.rows[k]?.[x.col] ?? '').trim())
      const botCells = cols.map((x) => (next?.[x.col] ?? '').trim())
      const paired =
        !!next &&
        teacherName(nextHead) === teacher &&
        !topCells.some(isClassText) &&
        botCells.some(isClassText)
      cols.forEach((x, i) => {
        const color = sheet.fills?.[k]?.[x.col] || (paired ? sheet.fills?.[k + 1]?.[x.col] : '') || ''
        if (!paired) {
          const raw = topCells[i]
          if (!raw) return
          const found = classIn(raw.replace(/\n/g, ' '))
          if (!found) {
            const fx = fixedWord(norm(raw))
            if (fx) addFixed(fx, x)
            else if (!isFree({ subject: norm(raw) })) out.unknown++
            return
          }
          out.entries.push({ teacher, day: x.day, period: x.period, cls: found.id, ...subjectOf(found.rest || '수업'), color })
          return
        }
        const top = norm(topCells[i])
        const bot = botCells[i]
        const found = bot ? classIn(bot.replace(/\n/g, ' ')) : null
        if (!found) {
          // 반이 없는 칸 — 창체 · 동아리 · 공강, 그 밖(연수 · 협의회 · 소인수 반 등)은 세기만 한다
          const fx = fixedWord(top) || fixedWord(norm(bot))
          if (fx) addFixed(fx, x)
          else if ((top || bot) && !isFree({ subject: top || norm(bot) })) out.unknown++
          return
        }
        const letter = top.match(BLOCK_LETTER)
        const sj = letter ? { subject: `${letter[1]}블록`, group: letter[1] } : subjectOf(top || found.rest || '수업')
        out.entries.push({ teacher, day: x.day, period: x.period, cls: found.id, ...sj, color })
      })
      if (paired) k++
    }
    break
  }
  return out
}

/* ---------- 표준 목록 ---------- */

/** 표준 자료의 열 — 학교마다 다른 시간표를 이 모양으로 바꿔 쓴다. 엑셀로 저장하고 다시 읽을 수 있다 */
export const STD_COLUMNS = ['교사', '요일', '교시', '반', '과목', '블록', '구분'] as const

/** 표준 자료 한 줄의 구분 */
export type TtKind = '수업' | '블록' | '공강' | FixedKind

const HEAD_RE: Record<string, RegExp> = {
  teacher: /^(교사|교사명|선생님|성명|이름|담당|담당 교사)$/,
  day: /^요일$/,
  period: /^교시$/,
  cls: /^(반|학급|학반|교실)$/,
  subject: /^(과목|과목명)$/,
  block: /^(블록|묶음|블록 구분)$/,
  kind: /^(구분|종류)$/,
  // AI 로 읽은 자료에만 붙는 칸 색
  color: /^색$/
}

/** 표준 목록 — 머리 줄에 교사 · 요일 · 교시 · 반 · 과목 (· 블록 · 구분), 아래로 한 줄에 수업 하나 */
function readList(sheet: SheetText): Found {
  const out = emptyFound('표준 목록')
  for (let r = 0; r < Math.min(sheet.rows.length, 30); r++) {
    const col: Record<string, number> = {}
    ;(sheet.rows[r] ?? []).forEach((v, c) => {
      const t = norm(v ?? '')
      for (const [k, re] of Object.entries(HEAD_RE)) if (col[k] === undefined && re.test(t)) col[k] = c
    })
    if (['teacher', 'day', 'period', 'cls', 'subject'].some((k) => col[k] === undefined)) continue
    const at = (row: string[], k: string): string => (col[k] === undefined ? '' : norm(row[col[k]] ?? ''))
    for (let k = r + 1; k < sheet.rows.length; k++) {
      const row = sheet.rows[k] ?? []
      const dm = at(row, 'day').match(DAY_RE)
      const p = periodOf(at(row, 'period'))
      if (!dm || !p) continue
      const day = DAY_NAMES.indexOf(dm[1])
      const kind = at(row, 'kind')
      const clsText = at(row, 'cls')
      let subject = at(row, 'subject')
      if (kind === '창체' || kind === '동아리') {
        const found = classIn(clsText)
        if (!found) {
          // 반 없이 학년(또는 전체)만 적은 고정 시간
          const g = clsText.match(/^(\d)\s*학년$/)
          out.fixed.push({ kind, grade: g ? Number(g[1]) : 0, day, period: p.no - 1 })
          continue
        }
        if (!subject) subject = kind
      }
      if (kind === '공강' && !isFree({ subject })) subject = '[공강]'
      const found = classIn(clsText)
      if (!found) {
        out.unknown++
        continue
      }
      if (!out.periods.has(p.no)) out.periods.set(p.no, p)
      const sj = subjectOf(subject || '수업')
      const block = at(row, 'block').replace(/\s*블록$/, '')
      const color = /^#[0-9A-Fa-f]{6}$/.test(at(row, 'color')) ? at(row, 'color').toUpperCase() : ''
      out.entries.push({ teacher: teacherName(at(row, 'teacher')), day, period: p.no, cls: found.id, subject: sj.subject, group: block || sj.group, color })
    }
    break
  }
  return out
}

interface SheetFound {
  name: string
  found: Found[]
}

/**
 * 두 시트가 서로 부딪히는 칸 수 — 같은 반 · 같은 시간에 서로 다른 선생님, 또는 같은 선생님 · 같은 시간에 서로 다른 반.
 * 부서별로 나눈 시트(서로 다른 선생님)나 같은 시간표를 다른 모양으로 적은 파일은 0 이고,
 * 수업을 바꾼 판을 시트마다 따로 둔 경우에만 생긴다. 이동수업 묶음 칸은 파일 모양마다 반을 다르게 적어 세지 않는다.
 */
function clashCount(a: SheetFound, b: SheetFound): number {
  const index = (s: SheetFound): { byCls: Map<string, Set<string>>; byTeacher: Map<string, Set<string>> } => {
    const byCls = new Map<string, Set<string>>()
    const byTeacher = new Map<string, Set<string>>()
    const add = (m: Map<string, Set<string>>, k: string, v: string): void => {
      if (!m.has(k)) m.set(k, new Set())
      m.get(k)!.add(v)
    }
    for (const f of s.found)
      for (const e of f.entries) {
        if (!e.teacher || isFree(e) || e.group) continue
        add(byCls, `${e.cls}|${e.day}|${e.period}`, e.teacher)
        add(byTeacher, `${e.teacher}|${e.day}|${e.period}`, e.cls)
      }
    return { byCls, byTeacher }
  }
  const A = index(a)
  const B = index(b)
  const disjoint = (x: Set<string>, y: Set<string>): boolean => ![...x].some((v) => y.has(v))
  let n = 0
  for (const [k, t] of A.byCls) if (B.byCls.has(k) && disjoint(t, B.byCls.get(k)!)) n++
  for (const [k, c] of A.byTeacher) if (B.byTeacher.has(k) && disjoint(c, B.byTeacher.get(k)!)) n++
  return n
}

/** 서로 부딪히지 않는 시트만 고른다. 고른 시트(opts.sheet)를 맨 앞에, 아니면 파일 순서대로 */
function selectSheets(all: SheetFound[], prefer?: string): { used: SheetFound[]; skipped: SheetFound[]; clashes: number } {
  const order = [...all.filter((s) => s.name === prefer), ...all.filter((s) => s.name !== prefer)]
  const used: SheetFound[] = []
  const skipped: SheetFound[] = []
  let clashes = 0
  for (const s of order) {
    const n = used.reduce((sum, u) => sum + clashCount(u, s), 0)
    if (n === 0) used.push(s)
    else {
      skipped.push(s)
      clashes = Math.max(clashes, n)
    }
  }
  return { used, skipped, clashes }
}

/** 시간표 파일(시트들)을 읽는다. 못 읽으면 tt 가 null 이고 까닭을 돌려준다 */
export function parseTimetable(
  sheets: SheetText[],
  file: string,
  now: string,
  opts: ParseOptions = {}
): { tt: SchoolTimetable | null; error?: string } {
  const perSheet: SheetFound[] = []
  for (const s of sheets) {
    const fs = [readMatrix(s), readBlocks(s, '학급 묶음'), readBlocks(s, '교사 묶음'), readList(s)].filter((f) => f.entries.length || f.fixed.length)
    if (fs.length) perSheet.push({ name: s.name, found: fs })
  }
  const pick = selectSheets(perSheet, opts.sheet)
  const found: Found[] = pick.used.flatMap((s) => s.found)
  if (!found.some((f) => f.entries.length)) {
    return {
      tt: null,
      error:
        '시간표 모양을 찾지 못했습니다. 이런 표를 읽을 수 있습니다: ① 반 이름(1학년 1반 · 1-1) 칸 오른쪽에 월~금, 아래에 1교시~ ' +
        '② 선생님 이름 칸 오른쪽에 월~금, 아래에 1교시~ (칸에 103 국어처럼 반 번호) ③ 위에 요일 · 교시 두 줄, 줄마다 선생님인 주간 시간표 ' +
        '④ 표준 양식(머리 줄에 교사 · 요일 · 교시 · 반 · 과목). 다른 모양이면 [AI로 읽기] 를 써 보세요.'
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

  // 교시 시각은 뺀 시트에서도 가져온다 (수업이 다를 뿐 교시는 같다)
  const periodMap = new Map<number, TtPeriod>()
  for (const f of perSheet.flatMap((s) => s.found))
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
    if (!prev) {
      grid[e.day][e.period - 1] = { subject: e.subject, group: e.group, teachers: e.teacher ? [e.teacher] : [], ...(e.color ? { color: e.color } : {}) }
    } else {
      if (e.teacher && !prev.teachers.includes(e.teacher)) prev.teachers.push(e.teacher)
      if (!prev.color && e.color) prev.color = e.color
    }
  }

  const dayPeriods = days.map((_, d) => Math.max(0, ...entries.filter((e) => e.day === d).map((e) => e.period)))
  const expected = new Map<string, number>()
  for (const f of found) for (const [t, n] of f.expected) if (!expected.has(t)) expected.set(t, n)
  const homerooms: Record<string, string> = {}
  for (const f of found) for (const [t, c] of f.homerooms) if (!homerooms[t]) homerooms[t] = c
  const fixedSeen = new Set<string>()
  const fixed = found.flatMap((f) => f.fixed).filter((x) => {
    const k = `${x.kind}|${x.grade}|${x.day}|${x.period}`
    if (fixedSeen.has(k)) return false
    fixedSeen.add(k)
    return true
  })
  const warnings: string[] = []
  if (pick.skipped.length) {
    warnings.push(
      `시트마다 수업이 조금씩 다릅니다(같은 시간에 다른 수업 ${pick.clashes}칸). 수업을 바꾼 판을 시트마다 따로 둔 것으로 보고 ` +
        `「${pick.used.map((s) => s.name).join('」 「')}」 만 읽었습니다. 지금 시간표가 다른 시트면 아래에서 고르세요.`
    )
  }
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
      warnings,
      ...(pick.skipped.length ? { versions: { sheets: perSheet.map((s) => s.name), used: pick.used.map((s) => s.name) } } : {}),
      ...(expected.size ? { expected: Object.fromEntries(expected) } : {}),
      ...(fixed.length ? { fixed } : {}),
      ...(Object.keys(homerooms).length ? { homerooms } : {})
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

/* ---------- 블록 · 창체 ---------- */

/** 블록 · 창체 설정. 사용자가 이 시간표로 확인해야 수업 바꾸기를 쓸 수 있다 */
export const TT_RULES_KEY = 'timetable_rules'

/** 블록 — 여러 반이 함께 움직이는 선택 수업 시간. 이 시간의 이 반 수업은 한 반만 따로 바꿀 수 없다 */
export interface TtBlock {
  id: string
  /** A · G·H 처럼 파일의 묶음 글자, 없으면 비움 */
  name: string
  grade: number
  /** 이 블록에 드는 반 (2-1 …). 비면 그 학년 모든 반 */
  classes: string[]
  /** "요일-교시" (둘 다 0부터: 월 1교시 = "0-0") */
  slots: string[]
  /** #RRGGBB */
  color: string
}

export interface TtRules {
  blocks: TtBlock[]
  /** 창체 자리 — 학년마다 "요일-교시". 이 자리로는 수업을 옮기지 않는다 */
  cce: Record<string, string[]>
  /** 동아리 자리 — 창체와 같이 다룬다 (예전 설정에는 없을 수 있다) */
  club?: Record<string, string[]>
  /** 어느 시간표로 확인했는지 (stampOf). 시간표를 다시 불러오면 다시 확인한다 */
  confirmedFor: string
  confirmedAt: string
}

export const slotKey = (d: number, p: number): string => `${d}-${p}`
export const slotOf = (k: string): [number, number] => k.split('-').map(Number) as [number, number]
const bySlot = (a: string, b: string): number => slotOf(a)[0] - slotOf(b)[0] || slotOf(a)[1] - slotOf(b)[1]
const byClass = (a: string, b: string): number => a.localeCompare(b, 'ko', { numeric: true })
export const gradeOf = (cls: string): number => Number(cls.split('-')[0]) || 0

/** 이 시간표를 가리키는 표 — 다시 불러오면 바뀐다 */
export const stampOf = (tt: SchoolTimetable): string => tt.stamp || `${tt.file}|${tt.loadedAt}`

/** 이 시간표로 블록 · 창체를 확인했는가 */
export const rulesReady = (tt: SchoolTimetable | null, rules: TtRules | null): boolean => !!tt && !!rules && rules.confirmedFor === stampOf(tt)

/** 블록에 이 반이 드는가 */
export const blockHas = (b: TtBlock, cls: string): boolean => gradeOf(cls) === b.grade && (!b.classes.length || b.classes.includes(cls))

export type TtLock = { kind: 'block'; block: TtBlock } | { kind: 'fixed'; fixed: FixedKind }

/** 창체 · 동아리 자리 (학년마다) */
export const fixedSlots = (rules: TtRules, kind: FixedKind): Record<string, string[]> => (kind === '창체' ? rules.cce : rules.club ?? {})

/** 이 반 · 이 시간이 묶여 있는가 — 블록 시간이거나 창체 · 동아리 자리 */
export function lockAt(rules: TtRules | null, cls: string, d: number, p: number): TtLock | null {
  if (!rules) return null
  const k = slotKey(d, p)
  const g = String(gradeOf(cls))
  for (const kind of ['창체', '동아리'] as FixedKind[]) if (fixedSlots(rules, kind)[g]?.includes(k)) return { kind: 'fixed', fixed: kind }
  const block = rules.blocks.find((b) => b.slots.includes(k) && blockHas(b, cls))
  return block ? { kind: 'block', block } : null
}

/** 창체 · 동아리로 보는 과목 이름 (파일에 적어 둔 학교) */
export function fixedOf(c: { subject: string } | null): FixedKind | '' {
  if (!c) return ''
  if (/^동아리/.test(c.subject)) return '동아리'
  return /^(창체|창의적|자율|자치|봉사)/.test(c.subject) ? '창체' : ''
}

export const isCce = (c: { subject: string } | null): boolean => !!fixedOf(c)

/** 엑셀 색이 없을 때 블록에 쓸 색 */
export const BLOCK_PALETTE = ['#FDE68A', '#BFDBFE', '#BBF7D0', '#FBCFE8', '#DDD6FE', '#FED7AA', '#A5F3FC', '#E5E7EB', '#FECACA', '#D9F99D']

/** 블록 이름 (화면 · 안내 글) */
export const blockLabel = (b: TtBlock, i?: number): string => `${b.grade}학년 ${b.name ? `${b.name} 블록` : `블록${i !== undefined ? ` ${i + 1}` : ''}`}`

export interface RulesSuggestion {
  blocks: TtBlock[]
  cce: Record<string, string[]>
  club: Record<string, string[]>
  /** 한 학년 모든 반이 비어 있는 시간 (창체인지 수업이 없는 시간인지 모른다) */
  empty: Record<string, string[]>
  /** 파일에 없는 교시 — 요일마다 마지막 교시 뒤 (예: 수 5 · 6교시) */
  missing: string[]
  /** 블록을 무엇으로 찾았는지. 빈 문자열이면 못 찾음 */
  by: '' | '칸 색깔' | '묶음 글자' | '칸 색깔 · 묶음 글자'
  notes: string[]
}

/**
 * 시간표 파일에서 블록 · 창체를 짐작한다. 사용자가 확인하고 고친 뒤에 쓴다.
 * - 블록: 칸 색깔(같은 학년 · 같은 색)과 A_사문 같은 묶음 글자(같은 학년 · 같은 글자)로 칸을 이어 묶고,
 *   그 안에서 드는 반이 같은 시간끼리 한 블록으로 나눈다(같은 색이라도 드는 반이 다르면 다른 블록이다).
 *   거의 모든 칸이 칠해져 있으면 색은 과목 구분이라 보고 쓰지 않는다.
 * - 창체: 한 학년의 모든 반이 비어 있는 시간, 또는 창체 · 동아리처럼 적힌 칸만 있는 시간.
 */
export function suggestRules(tt: SchoolTimetable): RulesSuggestion {
  const notes: string[] = []
  const lessons: { cls: string; grade: number; d: number; p: number; cell: TtCell }[] = []
  for (const c of tt.classes)
    c.grid.forEach((col, d) =>
      col.forEach((cell, p) => {
        if (cell && !isFree(cell) && !isCce(cell)) lessons.push({ cls: c.id, grade: c.grade, d, p, cell })
      })
    )
  const colored = lessons.filter((x) => x.cell.color).length
  const useColor = colored > 0 && colored < lessons.length * 0.8
  if (colored && !useColor) notes.push('거의 모든 칸이 칠해져 있어 색은 과목 구분으로 보고 블록을 묶는 데 쓰지 않았습니다.')
  const marks = lessons.filter((x) => (useColor && x.cell.color) || x.cell.group)

  // 같은 학년에서 색이 같거나 묶음 글자가 같은 칸을 이어 묶는다
  const parent = marks.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const first = new Map<string, number>()
  marks.forEach((m, i) => {
    const keys = [useColor && m.cell.color ? `${m.grade}|색|${m.cell.color}` : '', m.cell.group ? `${m.grade}|글자|${m.cell.group}` : ''].filter(Boolean)
    for (const k of keys) {
      const j = first.get(k)
      if (j === undefined) first.set(k, i)
      else parent[find(i)] = find(j)
    }
  })
  const comps = new Map<number, typeof marks>()
  marks.forEach((m, i) => {
    const r = find(i)
    if (!comps.has(r)) comps.set(r, [])
    comps.get(r)!.push(m)
  })

  const blocks: TtBlock[] = []
  const split: string[] = []
  for (const ms of comps.values()) {
    const grade = ms[0].grade
    const all = tt.classes.filter((c) => c.grade === grade).map((c) => c.id)
    const classesAt = new Map<string, Set<string>>()
    for (const m of ms) {
      const k = slotKey(m.d, m.p)
      if (!classesAt.has(k)) classesAt.set(k, new Set())
      classesAt.get(k)!.add(m.cls)
    }
    // 드는 반이 같은 시간끼리 한 블록
    const bySig = new Map<string, string[]>()
    for (const [k, set] of classesAt) {
      const sig = [...set].sort(byClass).join(',')
      if (!bySig.has(sig)) bySig.set(sig, [])
      bySig.get(sig)!.push(k)
    }
    const made: TtBlock[] = []
    for (const [sig, slots] of bySig) {
      const classes = sig.split(',')
      const inside = ms.filter((m) => slots.includes(slotKey(m.d, m.p)))
      const colors = inside.map((m) => m.cell.color).filter((c): c is string => !!c)
      const color = colors.sort((a, b) => colors.filter((x) => x === b).length - colors.filter((x) => x === a).length)[0] ?? ''
      made.push({
        id: '',
        name: [...new Set(inside.map((m) => m.cell.group).filter(Boolean))].sort().join('·'),
        grade,
        classes: all.every((c) => classes.includes(c)) ? [] : classes,
        slots: slots.sort(bySlot),
        color
      })
    }
    if (made.length > 1 && useColor) {
      const names = made.map((b) => b.name).filter(Boolean)
      split.push(`${grade}학년 ${names.length === made.length ? names.join(' · ') : `${made.length}개`}`)
    }
    blocks.push(...made)
  }
  if (split.length) {
    notes.push(`같은 색으로 칠했지만 시간마다 드는 반이 달라 따로 나눈 블록이 있습니다: ${split.join(', ')}. 드는 반이 맞는지 확인해 주세요.`)
  }
  blocks.sort((a, b) => a.grade - b.grade || bySlot(a.slots[0], b.slots[0]))
  const count = new Map<number, number>()
  blocks.forEach((b, i) => {
    const n = (count.get(b.grade) ?? 0) + 1
    count.set(b.grade, n)
    b.id = `b${b.grade}-${n}`
    if (!b.color) b.color = BLOCK_PALETTE[i % BLOCK_PALETTE.length]
  })

  // 창체 · 동아리: 표준 목록에 적힌 것, 그리고 한 학년 모든 반이 창체 · 동아리라 적힌 칸(빈 칸 포함)인 시간.
  // 모든 반이 비기만 한 시간은 창체인지 수업이 없는 시간인지 몰라 칠하지 않고 알리기만 한다
  const grades = [...new Set(tt.classes.map((c) => c.grade))].sort((a, b) => a - b)
  const cce: Record<string, string[]> = {}
  const club: Record<string, string[]> = {}
  const empty: Record<string, string[]> = {}
  const put = (m: Record<string, string[]>, g: number, k: string): void => {
    const cur = m[String(g)] ?? (m[String(g)] = [])
    if (!cur.includes(k)) cur.push(k)
  }
  for (const f of tt.fixed ?? []) for (const g of f.grade ? [f.grade] : grades) put(f.kind === '창체' ? cce : club, g, slotKey(f.day, f.period))
  for (const g of grades) {
    const cs = tt.classes.filter((c) => c.grade === g)
    tt.days.forEach((_, d) => {
      for (let p = 0; p < (tt.dayPeriods[d] ?? 0); p++) {
        const cells = cs.map((c) => c.grid[d]?.[p] ?? null)
        const kinds = new Set(cells.map((x) => fixedOf(x)).filter(Boolean))
        if (cells.every((x) => !x)) put(empty, g, slotKey(d, p))
        else if (kinds.size === 1 && cells.every((x) => !x || fixedOf(x))) put([...kinds][0] === '창체' ? cce : club, g, slotKey(d, p))
      }
    })
  }
  const maxP = Math.max(0, ...tt.dayPeriods)
  const missing: string[] = []
  tt.days.forEach((_, d) => {
    for (let p = tt.dayPeriods[d] ?? 0; p < Math.max(maxP, 7); p++) missing.push(slotKey(d, p))
  })
  const at = (k: string): string => `${tt.days[slotOf(k)[0]]} ${slotOf(k)[1] + 1}교시`
  const emptyTold = Object.entries(empty)
    .filter(([, ks]) => ks.length <= 5)
    .map(([g, ks]) => `${g}학년 ${ks.map(at).join(' · ')}`)
  if (emptyTold.length) notes.push(`모든 반이 비어 있는 시간이 있습니다: ${emptyTold.join(', ')}. 창체 · 동아리 시간이면 표시하고, 수업이 없는 시간이면 그대로 두세요.`)

  const hasColor = useColor && marks.some((m) => m.cell.color)
  const hasLetter = marks.some((m) => m.cell.group)
  return { blocks, cce, club, empty, missing, by: hasColor && hasLetter ? '칸 색깔 · 묶음 글자' : hasColor ? '칸 색깔' : hasLetter ? '묶음 글자' : '', notes }
}

/* ---------- 표준 자료 ---------- */

/** 표준 자료 한 줄 — 교사 · 요일 · 교시 · 반 · 과목 · 블록 · 구분 */
export interface TtRow {
  teacher: string
  day: number
  /** 1부터 */
  period: number
  /** 2-4, 창체 · 동아리 줄은 "2학년" */
  cls: string
  subject: string
  block: string
  kind: TtKind
}

/**
 * 읽은 시간표를 표준 자료로 편다. 블록 · 창체 · 동아리는 사용자가 정한 설정(없으면 묶음 글자)을 따른다.
 * 학교마다 다른 시간표를 한 모양으로 맞춰 확인하고, 엑셀로 저장해 고친 뒤 다시 읽을 수 있게 한다.
 */
export function standardRows(tt: SchoolTimetable, rules: TtRules | null): TtRow[] {
  const rows: TtRow[] = []
  // 이름 없는 블록은 학년마다 블록1, 블록2 … (다시 읽을 때 서로 섞이지 않게)
  const blockName = new Map<string, string>()
  for (const g of new Set(rules?.blocks.map((b) => b.grade) ?? [])) {
    let n = 0
    for (const b of rules!.blocks.filter((x) => x.grade === g)) blockName.set(b.id, b.name || `블록${++n}`)
  }
  for (const c of tt.classes)
    c.grid.forEach((col, d) =>
      col.forEach((cell, p) => {
        if (!cell) return
        const named = fixedOf(cell)
        const lock = lockAt(rules, c.id, d, p)
        const block = lock?.kind === 'block' ? blockName.get(lock.block.id) ?? lock.block.name : rules ? '' : cell.group
        const kind: TtKind = isFree(cell) ? '공강' : named || (lock?.kind === 'fixed' ? lock.fixed : block ? '블록' : '수업')
        for (const t of cell.teachers.length ? cell.teachers : ['']) rows.push({ teacher: t, day: d, period: p + 1, cls: c.id, subject: cell.subject, block, kind })
      })
    )
  // 창체 · 동아리 자리 (파일에 없는 교시도) — 학년마다 한 줄
  if (rules)
    for (const kind of ['창체', '동아리'] as FixedKind[])
      for (const [g, ks] of Object.entries(fixedSlots(rules, kind)))
        for (const k of ks) {
          const [d, p] = slotOf(k)
          const cs = tt.classes.filter((c) => c.grade === Number(g))
          if (cs.length && cs.every((c) => fixedOf(c.grid[d]?.[p] ?? null))) continue // 칸에 이미 적혀 있다
          rows.push({ teacher: '', day: d, period: p + 1, cls: `${g}학년`, subject: kind, block: '', kind })
        }
  return rows.sort((a, b) => a.teacher.localeCompare(b.teacher, 'ko') || a.day - b.day || a.period - b.period || byClass(a.cls, b.cls))
}

export interface HoursCheck {
  teacher: string
  /** 파일에 적힌 시수 */
  expected: number
  /** 읽은 수업 시간 (같은 시간에 여러 반이면 한 번) */
  read: number
}

/** 파일에 적힌 시수(괄호 숫자)와 읽은 수업 시간이 다른 선생님. 시수가 적혀 있지 않으면 빈 목록 */
export function hoursCheck(tt: SchoolTimetable): { checked: number; diff: HoursCheck[] } {
  const exp = tt.expected ?? {}
  const diff: HoursCheck[] = []
  let checked = 0
  for (const [teacher, expected] of Object.entries(exp)) {
    const slots = new Set<string>()
    for (const c of tt.classes)
      c.grid.forEach((col, d) =>
        col.forEach((x, p) => {
          if (x?.teachers.includes(teacher) && !isFree(x)) slots.add(slotKey(d, p))
        })
      )
    checked++
    if (slots.size !== expected) diff.push({ teacher, expected, read: slots.size })
  }
  return { checked, diff }
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
  /** 동교과 선생님 명단에 있는가 (shared/ttpeers.ts) */
  peer: boolean
}

export interface ChangePlan {
  cls: string
  subject: string
  group: string
  /** 블록 · 창체라 맞교체 후보를 내지 않았는가 */
  locked: boolean
  swaps: SwapOption[]
  covers: CoverOption[]
  notes: string[]
}

/** 이 반 · 이 시간 수업을 따로 옮길 수 없는 까닭. 옮길 수 있으면 빈 문자열 */
function lockReason(rules: TtRules | null, cls: string, d: number, p: number, cell: TtCell | null): string {
  const named = fixedOf(cell)
  if (named) return named
  // 블록 설정이 없으면(예전 방식) 묶음 글자만 본다
  if (!rules) return cell?.group ? `이동수업 묶음(${cell.group})` : ''
  const l = lockAt(rules, cls, d, p)
  return !l ? '' : l.kind === 'fixed' ? l.fixed : blockLabel(l.block)
}

/**
 * 내 수업(d1, p1)을 비울 때 찾을 수 있는 것.
 * - 맞교체: 같은 반을 같은 주에 가르치는 다른 선생님 수업 가운데, 그 시간에 내가 비고 그 선생님이 (d1,p1)에 비는 것
 * - 보강: (d1,p1)에 수업이 없는 선생님. 동교과 · 같은 과목이고 그날 수업이 적은 분을 앞에
 * 블록(여러 반이 함께 움직이는 선택 수업) 시간의 수업은 한 반만 바꿀 수 없어 맞교체 후보를 내지 않고,
 * 블록 시간 · 창체 · 동아리 자리로도 옮기지 않는다. meBusy: 파일에 없지만 내가 비지 않은 시간(손으로 적은 칸 · 우리 반 창체 · 동아리)
 */
export function planChange(
  tt: SchoolTimetable,
  me: string,
  d1: number,
  p1: number,
  rules: TtRules | null = null,
  meBusy?: (d: number, p: number) => boolean,
  peers: ReadonlySet<string> = new Set()
): ChangePlan | null {
  const mine = tt.classes.filter((c) => c.grid[d1]?.[p1]?.teachers.includes(me))
  if (!mine.length) return null
  const cell = mine[0].grid[d1][p1]!
  const notes: string[] = []
  const swaps: SwapOption[] = []
  const myLock = mine.map((c) => lockReason(rules, c.id, d1, p1, c.grid[d1][p1])).find(Boolean) ?? ''
  if (myLock === '창체' || myLock === '동아리') {
    notes.push(`${myLock} 시간이라 맞바꾸지 않습니다.`)
  } else if (myLock) {
    notes.push(`${myLock} 수업이라 여러 반이 함께 움직여 한 반만 바꿀 수 없습니다. 블록 전체를 함께 옮겨야 해서 맞교체 후보를 내지 않습니다.`)
  } else {
    const c = mine[0]
    c.grid.forEach((col, d) =>
      col.forEach((other, p) => {
        if ((d === d1 && p === p1) || !other || isFree(other) || lockReason(rules, c.id, d, p, other)) return
        for (const t of other.teachers) {
          if (t === me || busy(tt, me, d, p) || meBusy?.(d, p) || busy(tt, t, d1, p1)) continue
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
      sameSubject: !!subjects.get(t)?.has(cell.subject),
      peer: peers.has(t)
    }))
    .sort(
      (a, b) =>
        Number(b.peer) - Number(a.peer) ||
        Number(b.sameSubject) - Number(a.sameSubject) ||
        a.load - b.load ||
        a.teacher.localeCompare(b.teacher, 'ko')
    )
  if (p1 + 1 > (tt.dayPeriods[d1] ?? 99)) notes.push('그날 정규 교시 뒤의 수업입니다.')
  return { cls: mine.map((c) => c.id).join('·'), subject: cell.subject, group: cell.group, locked: !!myLock, swaps, covers, notes }
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
