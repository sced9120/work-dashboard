/**
 * 출결 기록 — 담임 반 명단과 날마다의 결석 · 지각 · 조퇴 · 결과.
 *
 * 학생 이름이 들어 있어 DB 설정에 두되 인수인계 파일에는 넣지 않는다(db.ts PERSONAL_SETTINGS).
 * 나이스에 넣는 것은 여전히 선생님이 직접 한다 — 여기서는 '나이스에 넣었는지' · '서류를 받았는지' 만 챙긴다.
 */

export const ATT_ROSTER_KEY = 'att_roster'
export const ATT_RECORDS_KEY = 'att_records'

export const ATT_TYPES = ['결석', '지각', '조퇴', '결과'] as const
export const ATT_REASONS = ['질병', '미인정', '기타', '출석인정'] as const
export type AttType = (typeof ATT_TYPES)[number]
export type AttReason = (typeof ATT_REASONS)[number]
/** 증빙 서류: 필요(아직 안 냄) · 냄 · 없음(필요 없음) */
export type AttProof = '필요' | '냄' | '없음'

export interface Student {
  no: number
  name: string
}

export interface Roster {
  /** 예: 2-4 */
  cls: string
  students: Student[]
}

export interface AttRecord {
  id: string
  /** YYYY-MM-DD */
  date: string
  /** 학생 번호 */
  no: number
  type: AttType
  reason: AttReason
  note: string
  proof: AttProof
  /** 나이스에 넣었는지 */
  neis: boolean
}

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * 붙여 넣은 명단 읽기. 한 줄에 한 명 —
 * '1 홍길동' · '1. 홍길동' · '1번 홍길동' · '20401 홍길동'(학번 → 끝 두 자리) · 엑셀에서 복사한 '1<TAB>홍길동'.
 * 번호가 없으면 차례대로 1, 2, 3 …
 */
export function parseRoster(text: string): Student[] {
  const out: Student[] = []
  let auto = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^(\d{1,5})\s*(?:번|\.|\)|,|\t|\s)\s*([가-힣A-Za-z][가-힣A-Za-z ·]{0,19})/)
    let no: number
    let name: string
    if (m) {
      const n = m[1]
      no = n.length >= 4 ? Number(n.slice(-2)) : Number(n)
      name = m[2].trim()
    } else {
      const nm = line.match(/^([가-힣A-Za-z][가-힣A-Za-z ·]{0,19})$/)
      if (!nm) continue
      no = auto + 1
      name = nm[1].trim()
    }
    if (!no || !name) continue
    auto = no
    if (out.some((s) => s.no === no)) continue
    out.push({ no, name })
  }
  return out.sort((a, b) => a.no - b.no)
}

export function readRoster(raw: string): Roster {
  try {
    const v = JSON.parse(raw || 'null') as Partial<Roster> | null
    const students = Array.isArray(v?.students)
      ? v!.students.filter((s): s is Student => !!s && Number.isInteger(s.no) && s.no > 0 && typeof s.name === 'string' && !!s.name.trim())
      : []
    return { cls: typeof v?.cls === 'string' ? v.cls : '', students: students.sort((a, b) => a.no - b.no) }
  } catch {
    return { cls: '', students: [] }
  }
}

export function readRecords(raw: string): AttRecord[] {
  try {
    const v = JSON.parse(raw || '[]') as unknown
    if (!Array.isArray(v)) return []
    return v
      .filter((r): r is AttRecord => !!r && isDay(r.date) && Number.isInteger(r.no) && (ATT_TYPES as readonly string[]).includes(r.type))
      .map((r) => ({
        id: typeof r.id === 'string' && r.id ? r.id : `${r.date}-${r.no}-${r.type}`,
        date: r.date,
        no: r.no,
        type: r.type,
        reason: (ATT_REASONS as readonly string[]).includes(r.reason) ? r.reason : '기타',
        note: typeof r.note === 'string' ? r.note.slice(0, 200) : '',
        proof: (r.proof === '냄' || r.proof === '없음' ? r.proof : '필요') as AttProof,
        neis: r.neis === true
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.no - b.no)
  } catch {
    return []
  }
}

/** 같은 날 · 같은 학생 · 같은 종류가 이미 있으면 새것으로 바꾼다 */
export function upsertRecords(list: AttRecord[], add: AttRecord[]): AttRecord[] {
  const key = (r: AttRecord): string => `${r.date}|${r.no}|${r.type}`
  const map = new Map(list.map((r) => [key(r), r]))
  for (const r of add) map.set(key(r), { ...(map.get(key(r)) ?? {}), ...r, id: map.get(key(r))?.id ?? r.id })
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date) || a.no - b.no)
}

/** 질병 · 기타 · 출석인정은 서류가 있어야 하고, 미인정은 서류가 없다 */
export function defaultProof(reason: AttReason): AttProof {
  return reason === '미인정' ? '없음' : '필요'
}

/** 칸에 찍을 짧은 표시 — 결석 ● · 지각 ◐ · 조퇴 ◑ · 결과 ○ (나이스 표 기호와 비슷하게) */
export const MARK: Record<AttType, string> = { 결석: '●', 지각: '◐', 조퇴: '◑', 결과: '○' }

export interface StudentSum {
  no: number
  /** '결석' → { 질병: 2, 미인정: 1 } */
  counts: Record<AttType, Partial<Record<AttReason, number>>>
  total: number
}

/** 기간 안의 학생별 합계 */
export function summarize(records: AttRecord[], from = '', to = '9999-12-31'): Map<number, StudentSum> {
  const out = new Map<number, StudentSum>()
  for (const r of records) {
    if (r.date < from || r.date > to) continue
    const s = out.get(r.no) ?? { no: r.no, counts: { 결석: {}, 지각: {}, 조퇴: {}, 결과: {} }, total: 0 }
    s.counts[r.type][r.reason] = (s.counts[r.type][r.reason] ?? 0) + 1
    s.total++
    out.set(r.no, s)
  }
  return out
}

/** 엑셀 · 한글에 붙여 넣을 탭 나눔 표 */
export function recordsTsv(records: AttRecord[], roster: Roster): string {
  const name = (no: number): string => roster.students.find((s) => s.no === no)?.name ?? ''
  const rows = [['날짜', '번호', '이름', '구분', '사유', '내용', '서류', '나이스']]
  for (const r of [...records].sort((a, b) => a.date.localeCompare(b.date) || a.no - b.no)) {
    rows.push([r.date, String(r.no), name(r.no), r.type, r.reason, r.note, r.proof, r.neis ? '넣음' : ''])
  }
  return rows.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n')
}

/* ---------- 출결 서류 기한 (3.7.1~) ---------- */

/** 결석 · 지각 · 조퇴 · 결과 뒤 며칠 안에 서류를 받을지 — 학교마다 달라 출결 기록 화면에서 정한다(평일 기준) */
export const ATT_PROOF_DAYS_KEY = 'att_proof_days'
export const PROOF_DAYS_DEFAULT = 5

export function readProofDays(v: string | null | undefined): number {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= 1 && n <= 30 ? n : PROOF_DAYS_DEFAULT
}

/** 날짜에서 평일(월~금) n일 뒤 — 'YYYY-MM-DD'. 공휴일은 따로 빼지 않는다 */
export function addSchoolDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`)
  if (Number.isNaN(d.getTime())) return day
  let left = n
  while (left > 0) {
    d.setDate(d.getDate() + 1)
    const w = d.getDay()
    if (w !== 0 && w !== 6) left--
  }
  const p = (x: number): string => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export interface ProofTodo {
  rec: AttRecord
  /** 서류를 받을 기한 */
  due: string
}

/** 서류를 아직 받지 않은 기록과 그 기한 — 기한이 빠른 것부터 */
export function proofTodos(records: AttRecord[], days: number): ProofTodo[] {
  return records
    .filter((r) => r.proof === '필요')
    .map((r) => ({ rec: r, due: addSchoolDays(r.date, days) }))
    .sort((a, b) => a.due.localeCompare(b.due) || a.rec.no - b.rec.no)
}

/** 알림 · 목록에 쓰는 한 줄 — 학생은 번호로만(알림이 교실 화면에 떠도 이름이 보이지 않게) */
export const proofTitle = (r: AttRecord): string => `출결 서류 받기 — ${r.no}번 ${r.type}(${r.reason})`
