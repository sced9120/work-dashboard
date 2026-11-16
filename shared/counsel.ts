/**
 * 상담 기록 — 학생별 상담 기록 · 상담 예정 · 학부모 연락처(메모) 의 순수 함수.
 *
 * 저장(electron/main/counsel.ts):
 *  - settings 표의 `counsel_<학년도>` 줄에 { records, plans } 를 학년도별로, `counsel_meta` 에 학부모 연락처 · 메모.
 *  - 상담 내용은 민감해서 'counsel_' 로 시작하는 줄은 인수인계 파일에 넣지 않는다(db.exportTo 가 지움).
 *    반면 이 PC 의 백업(날마다 · 직접 · 되돌리기)은 DB 통째라 상담 기록도 함께 들어 잃어버리지 않는다.
 *  - 우리 반 명단은 출결의 명단(att_roster)을 그대로 쓴다. 연락처 · 메모는 명단 모양을 바꾸지 않으려고 번호로 따로 둔다.
 */
import type { MdTable } from './mdtable'

export const COUNSEL_PREFIX = 'counsel_'
export const COUNSEL_META_KEY = 'counsel_meta'
export const counselKey = (year: number): string => `${COUNSEL_PREFIX}${year}`
export const isCounselYearKey = (key: string): boolean => /^counsel_\d{4}$/.test(key)

export const COUNSEL_WHO = ['학생', '학부모', '학생·학부모'] as const
export const COUNSEL_HOW = ['대면', '전화', '온라인', '문자'] as const
export const COUNSEL_TOPICS = ['진로', '학업', '교우', '생활', '건강', '가정', '기타'] as const
export type CounselWho = (typeof COUNSEL_WHO)[number]
export type CounselHow = (typeof COUNSEL_HOW)[number]

/** 학년도는 3월에 시작한다. 화면의 달 열 차례 */
export const SCHOOL_MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2] as const

export interface CounselRecord {
  id: string
  no: number
  /** 저장할 때의 이름(명단이 바뀌어도 기록은 그대로) */
  name: string
  /** YYYY-MM-DD */
  date: string
  who: CounselWho
  how: CounselHow
  topics: string[]
  text: string
  follow: string
  created: string
  updated: string
}

export interface CounselPlan {
  id: string
  no: number
  name: string
  date: string
  /** HH:MM, 없으면 빈 문자열 */
  time: string
  who: CounselWho
  memo: string
  /** 달력 일정 번호 */
  eventId?: number
}

export interface CounselStore {
  records: CounselRecord[]
  plans: CounselPlan[]
}

export interface StudentMeta {
  contact: string
  memo: string
}

export interface CounselMeta {
  teacher: string
  students: Record<string, StudentMeta>
}

const pad = (n: number): string => String(n).padStart(2, '0')
export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00`))
const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)

/** 날짜가 속한 학년도 — 1 · 2월은 앞 해의 학년도(2027-02 → 2026) */
export function schoolYearOf(date: string): number {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  return m < 3 ? y - 1 : y
}

/** 학년도 안의 달 → 'YYYY-MM' (3~12월은 그 해, 1~2월은 다음 해) */
export function monthKey(year: number, month: number): string {
  return `${month >= 3 ? year : year + 1}-${pad(month)}`
}

/** 1학기(3~8월) · 2학기(9~2월) */
export function semesterOf(date: string): 1 | 2 {
  const m = Number(date.slice(5, 7))
  return m >= 3 && m <= 8 ? 1 : 2
}

export interface MonthCell {
  count: number
  planned: number
}

/** 학생 번호별로 SCHOOL_MONTHS 차례의 12칸. 기록 · 예정이 없는 번호는 들어 있지 않다 */
export function monthCells(records: CounselRecord[], plans: CounselPlan[], year: number): Record<number, MonthCell[]> {
  const out: Record<number, MonthCell[]> = {}
  const idx = new Map<string, number>(SCHOOL_MONTHS.map((m, i) => [monthKey(year, m), i]))
  const cells = (no: number): MonthCell[] => (out[no] ??= SCHOOL_MONTHS.map(() => ({ count: 0, planned: 0 })))
  for (const r of records) {
    const i = idx.get(r.date.slice(0, 7))
    if (i !== undefined) cells(r.no)[i].count++
  }
  for (const p of plans) {
    const i = idx.get(p.date.slice(0, 7))
    if (i !== undefined) cells(p.no)[i].planned++
  }
  return out
}

/** 달별 합계(12칸) */
export function monthTotals(cells: Record<number, MonthCell[]>): number[] {
  const t = SCHOOL_MONTHS.map(() => 0)
  for (const row of Object.values(cells)) row.forEach((c, i) => (t[i] += c.count))
  return t
}

/** 이 학기(오늘이 속한 학기)에 기록이 하나라도 있나 */
export function hasRecordInSemester(records: CounselRecord[], no: number, today: string): boolean {
  const y = schoolYearOf(today)
  const s = semesterOf(today)
  return records.some((r) => r.no === no && schoolYearOf(r.date) === y && semesterOf(r.date) === s)
}

const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').slice(0, max) : '')
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => ((list as readonly string[]).includes(v as string) ? (v as T) : fallback)

export interface RecordInput {
  id?: string
  no: number
  name: string
  date: string
  who?: string
  how?: string
  topics?: string[]
  text?: string
  follow?: string
}

/** 기록 입력 다듬기. 학생 번호 · 날짜가 올바르지 않거나 적은 것이 하나도 없으면 null */
export function cleanRecord(input: RecordInput, now: string, prev?: CounselRecord): CounselRecord | null {
  if (!input || !Number.isInteger(input.no) || input.no <= 0 || !isDay(input.date)) return null
  const text = clip(input.text, 5000).trim()
  const follow = clip(input.follow, 3000).trim()
  const topics = Array.from(new Set((Array.isArray(input.topics) ? input.topics : []).filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean))).slice(0, 7)
  if (!text && !follow && !topics.length) return null
  return {
    id: input.id || prev?.id || `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    no: input.no,
    name: clip(input.name, 30).trim(),
    date: input.date,
    who: oneOf(COUNSEL_WHO, input.who, '학생'),
    how: oneOf(COUNSEL_HOW, input.how, '대면'),
    topics,
    text,
    follow,
    created: prev?.created ?? now,
    updated: now
  }
}

export interface PlanInput {
  id?: string
  no: number
  name: string
  date: string
  time?: string
  who?: string
  memo?: string
}

export function cleanPlan(input: PlanInput, prev?: CounselPlan): CounselPlan | null {
  if (!input || !Number.isInteger(input.no) || input.no <= 0 || !isDay(input.date)) return null
  return {
    id: input.id || prev?.id || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    no: input.no,
    name: clip(input.name, 30).trim(),
    date: input.date,
    time: isTime(input.time) ? input.time : '',
    who: oneOf(COUNSEL_WHO, input.who, '학생'),
    memo: clip(input.memo, 300).trim(),
    ...(prev?.eventId ? { eventId: prev.eventId } : {})
  }
}

/** 달력 일정 제목. 일정은 .ics 로 내보내 공유할 수 있어 이름은 넣지 않고 번호만 쓴다 */
export const planTitle = (no: number): string => `상담 — ${no}번`

export function readStore(raw: string): CounselStore {
  try {
    const v = JSON.parse(raw || 'null') as Partial<CounselStore> | null
    const records = (Array.isArray(v?.records) ? v!.records : [])
      .map((r) => cleanRecord(r as RecordInput, (r as CounselRecord)?.updated || '', { ...(r as CounselRecord), updated: '' }))
      .filter((r): r is CounselRecord => !!r)
    const plans = (Array.isArray(v?.plans) ? v!.plans : [])
      .map((p) => {
        const c = cleanPlan(p as PlanInput, p as CounselPlan)
        const eid = (p as CounselPlan)?.eventId
        return c && Number.isInteger(eid) ? { ...c, eventId: eid } : c
      })
      .filter((p): p is CounselPlan => !!p)
    return { records, plans }
  } catch {
    return { records: [], plans: [] }
  }
}

export function readMeta(raw: string): CounselMeta {
  try {
    const v = JSON.parse(raw || 'null') as Partial<CounselMeta> | null
    const students: Record<string, StudentMeta> = {}
    if (v && v.students && typeof v.students === 'object') {
      for (const [k, s] of Object.entries(v.students)) {
        if (!/^\d{1,3}$/.test(k) || !s) continue
        const contact = clip((s as StudentMeta).contact, 100).trim()
        const memo = clip((s as StudentMeta).memo, 300).trim()
        if (contact || memo) students[k] = { contact, memo }
      }
    }
    return { teacher: clip(v?.teacher, 20).trim(), students }
  } catch {
    return { teacher: '', students: {} }
  }
}

/** 최신 순(날짜 → 저장 시각) */
export function newestFirst<T extends { date: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.date === b.date ? ((b as { updated?: string }).updated ?? '').localeCompare((a as { updated?: string }).updated ?? '') : b.date.localeCompare(a.date)))
}

export const firstLine = (s: string): string => (s.split('\n').find((l) => l.trim()) ?? '').trim()

export const koDate = (date: string): string => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`

/**
 * 학부모에게 보낼 글 초안 — 문자 · 학교 알림 앱에 붙여 넣는 용. 선생님이 고쳐 쓴다.
 * TODO(서버 필요): 호스팅 링크로 보내는 방식은 이번 판에 넣지 않았다.
 */
export function parentMessage(r: Pick<CounselRecord, 'name' | 'date' | 'text' | 'follow' | 'who'>, teacherName = ''): string {
  const t = teacherName.trim() || '○○○'
  const lines = [`안녕하세요, ${r.name || '○○'} 학생 담임 ${t}입니다.`, `${koDate(r.date)} 상담 내용을 알려 드립니다.`, '']
  if (r.text.trim()) lines.push(r.text.trim(), '')
  if (r.follow.trim()) lines.push(`앞으로는 ${r.follow.trim()}`, '')
  lines.push('궁금하신 점은 언제든 연락 주세요.', '감사합니다.')
  return lines.join('\n')
}

export interface RecordFilter {
  q?: string
  topic?: string
  no?: number
}

/** 이름 · 번호 · 주제로 거르기 */
export function filterRecords(list: CounselRecord[], f: RecordFilter): CounselRecord[] {
  const q = (f.q ?? '').trim()
  return list.filter((r) => (!f.no || r.no === f.no) && (!f.topic || r.topics.includes(f.topic)) && (!q || r.name.includes(q) || String(r.no) === q.replace(/번$/, '')))
}

/** 엑셀로 저장할 표 */
export function recordsTable(list: CounselRecord[], year: number): MdTable {
  const rows = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.no - b.no).map((r) => [r.date, String(r.no), r.name, r.who, r.how, r.topics.join(', '), r.text, r.follow])
  return { title: `${year}학년도 상담 기록`, header: ['날짜', '번호', '이름', '대상', '방법', '주제', '내용', '후속 조치'], rows }
}
