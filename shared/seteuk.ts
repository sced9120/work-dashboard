/**
 * 세특 작성실 — 명단 · 활동 · 관찰 기록을 받아 프롬프트를 조립하고, 나온 글을 검사한다.
 * 조립 순서와 검사 규칙은 세특 시트(Prompt-Master)의 10_Engine 과 같다. 규칙 글은 ./seteukRules 에 있다.
 * 화면 · 메인 · 시험이 함께 쓰므로 여기에는 electron 도 DOM 도 쓰지 않는다.
 */
import { SETEUK_AI_TELL, SETEUK_BANNED, SETEUK_COMMON, SETEUK_FORMAT, SETEUK_RECORDS, SETEUK_SUBJECTS } from './seteukRules'
import type { SeteukRecord, SeteukRule, SeteukSubject } from './seteukRules'
import type { ModelChoice } from './types'

export { SETEUK_RECORDS, SETEUK_SUBJECTS }
export type { SeteukRecord, SeteukRule, SeteukSubject }

/* ---------- 모양 ---------- */

export interface SeteukStudent {
  /** '반-번호' — 명단을 다시 붙여 넣어도 같은 학생이면 같은 값 (다른 수업반에 같은 학생이 또 있으면 '반-번호@수업반') */
  id: string
  /** 담임 반 · 번호 — 나이스 파일과 맞출 때 쓴다 */
  cls: string
  no: string
  name: string
  /** 수업반 — 명단을 넣을 때 정한 반 이름(예: 3반 · 미적분A반). 없으면 담임 반('3반')으로 본다 */
  group?: string
  /** 학번 — 명단에 있었으면 (예: 20315) */
  hakbun?: string
}

export const SETEUK_AMOUNTS = ['메모만큼', '보통', '넉넉히'] as const

export const FILL_MIN = 50
export const FILL_MAX = 100
export const FILL_STEP = 5
/** 분량 비율 — 50~100 을 5 단위로. 저장된 값이 없으면 예전 '분량 맞추기'에서 옮긴다(넉넉히 · 메모만큼 90, 보통 70) */
export function readFill(v: unknown, amount?: string): number {
  const n = Number(v)
  if (Number.isFinite(n) && n > 0) return Math.min(FILL_MAX, Math.max(FILL_MIN, Math.round(n / FILL_STEP) * FILL_STEP))
  return amount === '넉넉히' || amount === '메모만큼' ? 90 : 70
}
export type SeteukAmount = (typeof SETEUK_AMOUNTS)[number]

export interface SeteukActivity {
  id: string
  name: string
  /** 기록 영역 — SETEUK_RECORDS 의 key (과세특 · 개세특 · 자율 · 동아리 · 진로 · 행발) */
  rec: string
  /** 과목 이름(과세특일 때만 역할 문장에 들어간다) */
  subject: string
  /** 활동 개요 — 무엇을 한 수업 · 활동인지 */
  desc: string
  /** 이 활동에 줄 분량(나이스 바이트). 0 이면 기록 영역 한도 */
  bytes: number
  /** '메모만큼' 이면 메모가 짧을 때 짧게 써도 된다(그 밖의 값은 예전 설정 — fill 로 옮겨 읽는다) */
  amount: SeteukAmount
  /** 분량 — 한도의 몇 %를 채울지 (50~100, 5 단위) */
  fill: number
  /** 세특 구성 — 선생님이 정한 짜임(한 줄에 한 칸). 비면 넣지 않는다 */
  structure: string
  /** 선생님 요청사항 — 이 활동에서 더 바라는 것(한 줄에 하나). 비면 넣지 않는다 */
  request: string
  /** 입력 항목 — 둘 이상이면 관찰 기록을 항목별 칸으로 나눠 적는다(비면 관찰 기록 한 칸) */
  columns: string[]
  /** 교과영역 — 고르면 그 교과의 핵심역량 문구가 서술 관점에 들어간다(비면 넣지 않는다) */
  area: string
  /** 이 활동의 예시 — 관찰 기록과 그것으로 쓴 글. 초안이 이 표현 방식과 흐름을 따른다 (앞에서 SETEUK_EXAMPLE_MAX 개까지) */
  examples: SeteukExample[]
}

export interface SeteukExample {
  note: string
  result: string
}
/** 프롬프트에 넣는 예시 수 — 예시가 프롬프트에서 가장 큰 칸이라 다섯 개까지만 */
export const SETEUK_EXAMPLE_MAX = 5

/**
 * 내 문체 — 선생님이 예전에 쓴 세특 몇 편과, 거기서 뽑은 문체 카드.
 * 켜 두면 모든 활동의 초안이 이 쓰는 방식(문장 길이 · 여는 방식 · 끝맺음)을 따른다. 내용은 따르지 않는다.
 */
export interface SeteukStyle {
  on: boolean
  samples: string[]
  card: string
}
export const SETEUK_STYLE_KEY = 'seteuk_style'
export const SETEUK_STYLE_SAMPLE_MAX = 5
export const emptyStyle = (): SeteukStyle => ({ on: false, samples: [], card: '' })

export interface SeteukRow {
  note: string
  ai: string
  final: string
  /** 입력 항목별 칸 — 활동에 항목이 둘 이상일 때. note 는 이것을 '항목: 값' 줄로 이은 것 */
  fields?: Record<string, string>
  /** 성취수준 1~5 (과세특) — 글에는 쓰지 않고 서술의 깊이만 맞춘다 */
  grade?: string
  /** 근거 확인 결과 — 없으면 아직 확인하지 않은 것, 빈 목록이면 자료에 없는 내용을 못 찾은 것 */
  ground?: SeteukGround[]
  /** 자동 고쳐쓰기로 한 번 고친 초안 */
  repaired?: boolean
}
export type SeteukRows = Record<string, SeteukRow>

export interface SeteukState {
  students: SeteukStudent[]
  acts: SeteukActivity[]
}

export interface SeteukIssue {
  level: 'block' | 'check'
  label: string
  hit: string
  fix?: string
  why?: string
}
export interface SeteukCheck {
  ok: boolean
  bytes: number
  issues: SeteukIssue[]
}

export interface SeteukWriteRequest {
  job: string
  actId: string
  ids: string[]
  model?: ModelChoice
}
export interface SeteukProgress {
  job: string
  done: number
  total: number
  /** 방금 끝난 학생 */
  id?: string
  row?: SeteukRow
  error?: string
}
export interface SeteukWriteReply {
  ok: boolean
  error?: string
  written: number
  failed: number
  /** 관찰 기록이 비어 건너뛴 학생 수 */
  empty: number
  canceled?: boolean
}

/* ---------- 저장 자리 (settings 표, 인수인계 파일에서는 뺀다) ---------- */

export const SETEUK_PREFIX = 'seteuk_'
export const SETEUK_ROSTER_KEY = 'seteuk_roster'
export const SETEUK_ACTS_KEY = 'seteuk_acts'
export const seteukRowsKey = (actId: string): string => `seteuk_rows_${actId}`

/* ---------- 바이트 ---------- */

/** 나이스 바이트 — 한글 3, 영문 · 숫자 · 공백 · 문장부호 1, 줄바꿈 2 */
export function byteLen(s: string | null | undefined): number {
  if (s === null || s === undefined) return 0
  const t = String(s)
  let n = 0
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    if (c === 10 || c === 13) n += 2
    else if (c > 127) n += 3
    else n += 1
  }
  return n
}

/* ---------- 기록 영역 · 활동 ---------- */

export function recordOf(key: string): SeteukRecord {
  return SETEUK_RECORDS.find((r) => r.key === key) ?? SETEUK_RECORDS[0]
}

/** 활동의 분량 한도(바이트) — 비었거나 영역 한도를 넘으면 영역 한도 */
export function limitOf(act: Pick<SeteukActivity, 'rec' | 'bytes'>): number {
  const cap = recordOf(act.rec).chars * 3
  const b = Math.floor(Number(act.bytes) || 0)
  return b > 0 && b < cap ? b : cap
}

export function newActivity(id: string, patch: Partial<SeteukActivity> = {}): SeteukActivity {
  return { id, name: '새 활동', rec: '과세특', subject: '', desc: '', bytes: 0, amount: '보통', fill: 70, structure: '', request: '', columns: [], area: '', examples: [], ...patch }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))

/** 저장된 글(JSON) → 활동 목록. 모양이 틀린 줄은 버린다 */
export function readActs(raw: string): SeteukActivity[] {
  let list: unknown
  try {
    list = JSON.parse(raw || '[]')
  } catch {
    return []
  }
  if (!Array.isArray(list)) return []
  const out: SeteukActivity[] = []
  for (const x of list as Record<string, unknown>[]) {
    const id = str(x?.id).trim()
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || out.some((a) => a.id === id)) continue
    const amount = str(x.amount) as SeteukAmount
    out.push({
      id,
      name: str(x.name).trim() || '이름 없는 활동',
      rec: SETEUK_RECORDS.some((r) => r.key === x.rec) ? str(x.rec) : '과세특',
      subject: str(x.subject).trim(),
      desc: str(x.desc),
      bytes: Math.max(0, Math.floor(Number(x.bytes) || 0)),
      amount: SETEUK_AMOUNTS.includes(amount) ? amount : '보통',
      fill: readFill(x.fill, amount),
      structure: str(x.structure).slice(0, 2000),
      request: str(x.request).slice(0, 2000),
      columns: readColumns(x.columns),
      area: SETEUK_SUBJECTS.some((sub) => sub.key === x.area) ? str(x.area) : '',
      examples: (Array.isArray(x.examples) ? (x.examples as Record<string, unknown>[]) : [])
        .map((e) => ({ note: str(e?.note).trim(), result: str(e?.result).trim() }))
        .filter((e) => e.result)
        .slice(0, 20)
    })
  }
  return out
}

export function readStyle(raw: string): SeteukStyle {
  let v: unknown
  try {
    v = JSON.parse(raw || '{}')
  } catch {
    return emptyStyle()
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return emptyStyle()
  const o = v as Record<string, unknown>
  return {
    on: o.on === true,
    samples: (Array.isArray(o.samples) ? o.samples : []).map((x) => str(x).trim()).filter(Boolean).slice(0, 20),
    card: str(o.card).trim()
  }
}

export function readStudents(raw: string): SeteukStudent[] {
  let list: unknown
  try {
    list = JSON.parse(raw || '[]')
  } catch {
    return []
  }
  if (!Array.isArray(list)) return []
  const out: SeteukStudent[] = []
  for (const x of list as Record<string, unknown>[]) {
    const id = str(x?.id).trim()
    const name = str(x?.name).trim()
    if (!id || !name || out.some((s) => s.id === id)) continue
    const st: SeteukStudent = { id, cls: str(x.cls).trim(), no: str(x.no).trim(), name }
    const group = str(x.group).trim().slice(0, 30)
    const hakbun = str(x.hakbun).replace(/\D/g, '').slice(0, 6)
    if (group) st.group = group
    if (hakbun) st.hakbun = hakbun
    out.push(st)
  }
  return out
}

export function readRows(raw: string): SeteukRows {
  let obj: unknown
  try {
    obj = JSON.parse(raw || '{}')
  } catch {
    return {}
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
  const out: SeteukRows = {}
  for (const [id, v] of Object.entries(obj as Record<string, Record<string, unknown>>)) {
    if (!v || typeof v !== 'object') continue
    const row: SeteukRow = { note: str(v.note), ai: str(v.ai), final: str(v.final) }
    if (Array.isArray(v.ground)) row.ground = parseGround(JSON.stringify(v.ground))
    if (v.repaired === true) row.repaired = true
    if (v.fields && typeof v.fields === 'object' && !Array.isArray(v.fields)) {
      const f: Record<string, string> = {}
      for (const [k, val] of Object.entries(v.fields as Record<string, unknown>)) if (k.trim()) f[k] = str(val)
      row.fields = f
    }
    if (GRADES.includes(str(v.grade))) row.grade = str(v.grade)
    out[id] = row
  }
  return out
}

export const emptyRow = (): SeteukRow => ({ note: '', ai: '', final: '' })

/* ---------- 입력 항목 · 성취수준 · 교과 역량 ---------- */

export const GRADES = ['1', '2', '3', '4', '5']

/** 학생 자료에 '성취수준: n' 이 있을 때만 쓰는 규칙 */
const GRADE_LINE =
  "- 학생 자료에 '성취수준'(1~5, 1이 가장 높음)이 있으면 1~2는 여러 역량이 높은 수준에서 함께 드러난 것으로, 4~5는 드러난 역량과 노력한 점을 중심으로 쓴다.\n- 성취수준, 등급, 석차는 결과에 쓰지 않는다."

/** 입력 항목 — 쉼표 · 줄바꿈으로 나눈 이름, 겹치면 하나만, 열두 개까지 */
export function readColumns(v: unknown): string[] {
  const list = Array.isArray(v) ? v.map(str) : str(v).split(/[,，\n|]/)
  const out: string[] = []
  for (const c of list.map((x) => x.trim()).filter(Boolean)) if (!out.includes(c)) out.push(c)
  return out.slice(0, 12)
}

/** 항목별 칸 → 관찰 기록 한 덩어리 ('항목: 값' 줄). 빈 칸은 뺀다 */
export function joinFields(columns: string[], fields: Record<string, string> | undefined): string {
  return columns
    .map((c) => ({ c, v: String(fields?.[c] ?? '').trim().replace(/\s*\n\s*/g, ' ') }))
    .filter((x) => x.v)
    .map((x) => `${x.c}: ${x.v}`)
    .join('\n')
}

/** 입력 항목 견본 (시트의 입력 항목 묶음에서) */
export const COLUMN_SETS: { name: string; cols: string[] }[] = [
  { name: '탐구 · 보고서', cols: ['탐구 주제', '선정 이유', '탐구 과정', '알게 된 점'] },
  { name: '수업 참여', cols: ['수업 장면', '발표 · 질문', '모둠 활동', '고친 점'] },
  { name: '실험', cols: ['실험 주제', '설계와 변인', '결과와 오차', '이어간 탐구'] },
  { name: '독서 · 토론', cols: ['읽은 책 · 자료', '주장과 근거', '토론에서 달라진 생각'] }
]

export const subjectOf = (key: string): SeteukSubject | null => SETEUK_SUBJECTS.find((s) => s.key === key) ?? null

/* ---------- 명단 붙여넣기 ---------- */

const HEAD_CLS = /^(반|학급)$/
const HEAD_NO = /^(번호|번|순번)$/
const HEAD_NAME = /^(이름|성명|학생명|학생 ?이름)$/
const HEAD_HAKBUN = /^학번$/

/** '1학년 3반' · '3반' · '03' → '3' */
export function cleanCls(v: string): string {
  const m = v.match(/(\d+)\s*반/) ?? v.match(/(\d+)\s*$/)
  return m ? String(Number(m[1])) : v.trim()
}
export function cleanNo(v: string): string {
  const m = v.match(/\d+/)
  return m ? String(Number(m[0])) : v.trim()
}
/** 학번(10305 · 1305) → 반 3, 번호 5 */
function splitHakbun(v: string): { cls: string; no: string } | null {
  const d = v.replace(/\D/g, '')
  if (d.length === 5) return { cls: String(Number(d.slice(1, 3))), no: String(Number(d.slice(3))) }
  if (d.length === 4) return { cls: String(Number(d.slice(1, 2))), no: String(Number(d.slice(2))) }
  return null
}

/**
 * 엑셀 · 한글 표에서 복사한 명단을 읽는다.
 * 머리줄(반 · 번호 · 이름 · 학번)이 있으면 그 자리를 따르고, 없으면 칸 수로 짐작한다:
 *   3칸 이상 = 반 · 번호 · 이름 / 2칸 = 번호(또는 학번) · 이름 / 1칸 = 이름(번호는 차례대로).
 */
export function parseRoster(text: string): { students: SeteukStudent[]; skipped: number } {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/ /g, ' '))
    .filter((l) => l.trim())
  const split = (l: string): string[] => {
    const cells = l.includes('\t') ? l.split('\t') : l.includes(',') ? l.split(',') : l.trim().split(/\s+/)
    return cells.map((c) => c.trim())
  }
  const table = lines.map(split)
  let iCls = -1
  let iNo = -1
  let iName = -1
  let iHak = -1
  let start = 0
  if (table.length) {
    const h = table[0]
    const nameAt = h.findIndex((c) => HEAD_NAME.test(c))
    if (nameAt >= 0) {
      iName = nameAt
      iCls = h.findIndex((c) => HEAD_CLS.test(c))
      iNo = h.findIndex((c) => HEAD_NO.test(c))
      iHak = h.findIndex((c) => HEAD_HAKBUN.test(c))
      start = 1
    }
  }
  const out: SeteukStudent[] = []
  let skipped = 0
  let auto = 0
  for (const cells0 of table.slice(start)) {
    let cls = ''
    let no = ''
    let name = ''
    let hakbun = ''
    if (iName >= 0) {
      name = cells0[iName] ?? ''
      if (iCls >= 0) cls = cleanCls(cells0[iCls] ?? '')
      if (iNo >= 0) no = cleanNo(cells0[iNo] ?? '')
      if (iHak >= 0) {
        const hk = splitHakbun(cells0[iHak] ?? '')
        if (hk) {
          cls = cls || hk.cls
          no = no || hk.no
          hakbun = (cells0[iHak] ?? '').replace(/\D/g, '')
        }
      }
    } else {
      const cells = cells0.filter((c) => c !== '')
      if (cells.length >= 3) {
        cls = cleanCls(cells[0])
        no = cleanNo(cells[1])
        name = cells[2]
      } else if (cells.length === 2) {
        const hk = /^\d{4,5}$/.test(cells[0]) ? splitHakbun(cells[0]) : null
        if (hk) {
          cls = hk.cls
          no = hk.no
          hakbun = cells[0]
        } else no = cleanNo(cells[0])
        name = cells[1]
      } else if (cells.length === 1) name = cells[0]
    }
    name = name.trim()
    if (!name || /^\d+$/.test(name)) {
      skipped++
      continue
    }
    auto++
    if (!no) no = String(auto)
    let id = `${cls || '0'}-${no}`
    if (out.some((s) => s.id === id)) {
      let k = 2
      while (out.some((s) => s.id === `${id}_${k}`)) k++
      id = `${id}_${k}`
    }
    const st: SeteukStudent = { id, cls, no, name }
    if (hakbun) st.hakbun = hakbun
    out.push(st)
  }
  return { students: out, skipped }
}

/** 화면에 보이는 이름표 — 학번이 있으면 '20315', 없으면 '3반 5번' (반이 없으면 '5번') */
export function studentLabel(s: Pick<SeteukStudent, 'cls' | 'no'> & { hakbun?: string }): string {
  if (s.hakbun) return s.hakbun
  return (s.cls ? `${s.cls}반 ` : '') + `${s.no}번`
}

/* ---------- 수업반 ---------- */

/** 학생의 수업반 — 정한 반 이름, 없으면 담임 반('3반'), 그것도 없으면 '' */
export function groupOf(s: Pick<SeteukStudent, 'cls' | 'group'>): string {
  return s.group?.trim() || (s.cls ? `${s.cls}반` : '')
}

/** 명단의 수업반 — 나온 차례가 아니라 이름 차례(1반 · 2반 · 10반 · 미적분A반) */
export function groupsOf(list: Pick<SeteukStudent, 'cls' | 'group'>[]): { name: string; count: number }[] {
  const m = new Map<string, number>()
  for (const s of list) {
    const g = groupOf(s)
    if (g) m.set(g, (m.get(g) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko', { numeric: true })).map(([name, count]) => ({ name, count }))
}

/** 수업반 이름 다듬기 — '3' 처럼 숫자만 쓰면 '3반' */
export function cleanGroup(v: string): string {
  const g = String(v || '').replace(/\s+/g, ' ').trim().slice(0, 30)
  return /^\d+$/.test(g) ? `${Number(g)}반` : g
}

/**
 * 한 수업반의 명단만 바꾼다 — 다른 반 학생은 그대로 둔다.
 * 같은 반 · 번호(담임 반 기준)의 학생이 그 수업반에 있었으면 그 id 를 이어 써서 적어 둔 글이 이어진다.
 * 다른 수업반에 같은 학생이 이미 있으면(미적분A반과 기하B반을 함께 듣는 학생) id 뒤에 '@수업반' 을 붙여 따로 둔다.
 */
export function mergeGroup(cur: SeteukStudent[], group: string, incoming: SeteukStudent[]): SeteukStudent[] {
  const g = cleanGroup(group)
  const keep = cur.filter((s) => groupOf(s) !== g)
  const old = cur.filter((s) => groupOf(s) === g)
  const used = new Set(keep.map((s) => s.id))
  const out: SeteukStudent[] = []
  for (const s of incoming) {
    const prev = old.find((o) => o.cls === s.cls && o.no === s.no && !used.has(o.id))
    let id = prev?.id ?? `${s.cls || '0'}-${s.no}`
    if (used.has(id)) {
      id = `${id.replace(/@.*$/, '')}@${g}`
      let k = 2
      while (used.has(id)) id = `${id.replace(/#\d+$/, '')}#${k++}`
    }
    used.add(id)
    out.push({ ...s, id, group: g })
  }
  return [...keep, ...out]
}

/* ---------- 프롬프트 ---------- */

/**
 * 서술 흐름 — 대학이 공개한 합격생 학생부 발췌(서울대 아로리 '나도 입학사정관')에서 되풀이되는 짜임.
 *   장면은 수업 속 계기 한 구절 → 학생이 직접 한 과정(측정 · 조사 · 계산 · 비교) → 다른 단원 · 과목으로 이어간 탐구 → 결론이나 제안.
 *   끝맺음은 학생이 한 일 · 낸 결론이고, 깨달음 · 성장 · 평가어로 맺지 않는다. 개념과 방법은 이름으로 쓴다.
 * 메모에 없는 단계는 건너뛴다(지어내지 않는다).
 * 2027 서울대 학생부종합전형 안내(서류평가)도 같은 쪽이다 — 세특에서 '자기주도적 학습에 의한 변화와 성장', '성취를 점검하고 더 필요한 공부를 고민한 경험'을,
 * 창체 · 행발에서 '경험의 유무나 활동의 양'이 아니라 '맡은 역할과 활동 내용'을 본다. 그래서 달라진 점은 행동으로, 역할은 직책 이름보다 한 일로 쓴다.
 */
const FRAME_STUDY = [
  '- 한 장면은 계기(수업 속 질문) → 직접 한 과정(조사 · 측정 · 계산 · 고친 점) → 이어간 탐구 → 결론 순서로 잇고, 메모에 없는 단계는 건너뛴다.',
  '- 개념과 방법은 이름으로 쓰고, 계기는 메모에 있는 사실로 한 구절만 쓴다. 처음과 달라진 점이 메모에 있으면 행동으로 쓴다.'
]
const FRAME_ROLE = [
  '- 한 장면은 맡은 역할 → 그 자리에서 직접 한 일(뜻밖의 상황에 대처한 방식 포함) → 결과 순서로 잇고, 메모에 없는 단계는 건너뛴다. 직책 이름이나 횟수보다 한 일을 쓴다.'
]
const FRAME_BEHAVIOR = [
  '- 행동 특성은 여러 장면에서 되풀이해 본 행동으로 쓰고, 한 번 있었던 일로 단정하지 않는다. 부족했던 점은 그 뒤 달라진 행동과 함께 쓴다.'
]
const FRAME_END = '- 문장은 학생이 한 일이나 낸 결론으로 끝맺는다.'

/** 기록 영역에 맞는 서술 흐름 줄 */
export function sentenceFrame(recKey: string): string {
  const k = String(recKey || '')
  const lines = k === '행발' ? FRAME_BEHAVIOR : k === '자율' || k === '진로' ? FRAME_ROLE : FRAME_STUDY
  return [...lines, FRAME_END].join('\n')
}

function amountLines(amount: SeteukAmount, bytes: number, fill: number): string[] {
  const target = Math.round((bytes * fill) / 100)
  const noMake = '메모에 없는 활동, 과정, 결과, 수치는 만들지 않는다.'
  if (amount === '메모만큼') {
    return [
      `- 분량은 한도의 ${fill}%(${target}바이트)를 넘지 않게, 자료의 양을 따른다. 메모가 한두 줄이면 한두 문장으로 끝낸다.`,
      '- 분량을 채우려고 자료에 없는 과정, 결과, 칭찬, 성장 가능성 문장을 덧붙이지 않는다.'
    ]
  }
  return [
    `- 한도의 ${fill}%(${target}바이트) 안팎으로 쓴다. 메모가 짧아 채우기 어려우면 그보다 짧아도 된다.`,
    `- 늘리는 몫은 메모 속 행동을 구체적으로 풀고 교과 역량과 잇는 데 쓴다. ${noMake}`,
    '- 막연한 칭찬이나 성장 가능성 문장으로 분량을 채우지 않는다.'
  ]
}

/** 검사의 '분량 부족' 기준 — 채우려는 분량의 80% 아래면 알린다(메모만큼이면 절반 아래) */
export function minRatioOf(act: Pick<SeteukActivity, 'fill' | 'amount'>): number {
  return (act.fill / 100) * (act.amount === '메모만큼' ? 0.5 : 0.8)
}

/** 세특 구성 · 요청사항 — 빈 줄은 빼고 '- ' 로 고르게 */
const lines = (s: string): string[] =>
  String(s || '')
    .split('\n')
    .map((l) => l.trim().replace(/^[-·•]\s*/, ''))
    .filter(Boolean)

/** 세특 구성 견본 — [프롬프트 만들기]에서 누르면 칸에 채워진다(고쳐 쓰면 된다) */
export const STRUCTURE_TEMPLATES: { name: string; for: string; text: string }[] = [
  { name: '탐구 과정형', for: '교과 · 동아리', text: '수업에서 다룬 개념과 탐구 주제를 정한 계기\n스스로 자료를 찾고 조사 · 측정 · 계산한 과정\n막힌 곳과 그것을 고친 방법, 교사와 함께 검토한 점\n다른 단원이나 과목으로 이어간 탐구와 결론' },
  { name: '발표 · 토론형', for: '교과', text: '맡은 주제와 근거로 삼은 자료\n발표 · 토론에서 펼친 주장과 근거\n질문 · 반론에 답하며 고친 생각\n이후 이어간 활동' },
  { name: '실험 · 실습형', for: '과학 · 기술', text: '실험의 목적과 세운 가설\n직접 설계한 방법과 변인\n결과와 오차 · 한계 분석\n고친 점과 이어간 탐구' },
  { name: '성장 변화형', for: '교과 · 행발', text: '처음의 어려움이 드러난 장면\n시도한 방법과 꾸준히 한 일\n달라진 행동과 그 결과' },
  { name: '역할 · 협력형', for: '자율 · 진로 · 동아리', text: '맡은 역할\n그 자리에서 직접 한 일과 뜻밖의 상황에 대처한 방식\n결과와 공동체에 남긴 것' }
]

/** 역할 문장 — '{교과} 교과를 {연차}년간 지도해 온 …' 의 빈칸을 채운다 */
export function buildRole(rec: SeteukRecord, subject: string, years = 15): string {
  const sub = subject.replace(/\(.*?\)/g, '').trim()
  let filled = (rec.role || '고등학교 교사').replace(/\{교과\}/g, sub).replace(/\{연차\}/g, String(years))
  filled = filled.replace(/\s{2,}/g, ' ').replace(/^ /, '')
  filled = filled.replace(/^\s*교과를/, '여러 교과를')
  return `당신은 ${filled}입니다.`
}

export interface SeteukPromptOptions {
  years?: number
  /** 내 문체 — 켜져 있을 때만 들어간다 */
  style?: SeteukStyle | null
  /** 규칙 설정 — 주지 않으면 지금 설정 */
  config?: SeteukConfig
}

/** 이 활동의 예시 글 (앞에서 다섯 개) */
export function examplesText(act: Pick<SeteukActivity, 'examples'>): string {
  return (act.examples ?? [])
    .filter((e) => e.result.trim())
    .slice(0, SETEUK_EXAMPLE_MAX)
    .map((e, i) => `## 예시${i + 1} 입력\n관찰 메모: ${e.note.trim().replace(/\s*\n\s*/g, ' ')}\n## 예시${i + 1} 결과\n${e.result.trim()}`)
    .join('\n\n')
}

/** 규칙 묶음(시스템 프롬프트). 학생 자료는 seteukUser 로 따로 붙인다 */
export function buildSeteukPrompt(act: SeteukActivity, opt: SeteukPromptOptions = {}): string {
  const years = opt.years ?? 15
  const style = opt.style?.on ? opt.style : null
  const rec = recordOf(act.rec)
  const com = SETEUK_COMMON
  const recBytes = rec.chars * 3
  const bytes = limitOf(act)
  const chars = Math.floor(bytes / 3)
  const P: string[] = []

  P.push('# 역할\n' + buildRole(rec, act.subject, years))

  const ctx = ['# 과제', `- 목표: ${rec.goal || '학교생활기록부 특기사항 작성'}`, `- 기록 항목: ${rec.name}`]
  if (act.name.trim()) ctx.push(`- 대상 활동: ${act.name.trim()}`)
  if (act.desc.trim()) ctx.push(`- 활동 개요: ${act.desc.trim().replace(/\n/g, ' ')}`)
  P.push(ctx.join('\n'))

  const cfg = opt.config ?? CONFIG
  const extra = cfg.extra
    .split('\n')
    .map((l) => l.trim().replace(/^[-·•]\s*/, ''))
    .filter(Boolean)
    .map((l) => `- ${l}`)
  if (com.WRITING_RULES) P.push(['# 서술 규칙', com.WRITING_RULES, ...(cfg.sections.frame ? [sentenceFrame(rec.key)] : []), ...extra].join('\n'))
  if (cfg.sections.avoid && com.AVOID_RULES?.trim()) P.push('# 피할 표현\n' + com.AVOID_RULES.trim())
  const mine = cfg.mine.flatMap((m) => wordsOf(m.words))
  if (com.NEIS_RULES) P.push('# 학생부 기재 금지사항\n' + com.NEIS_RULES + (mine.length ? `\n- 선생님이 정한 금지어: ${mine.join(', ')}` : ''))
  const sub = act.area ? subjectOf(act.area) : null
  const views = [cfg.sections.view ? rec.view : '', sub?.comp ?? ''].filter((x) => x && x.trim())
  if (views.length) P.push('# 서술 관점과 역량\n' + views.join('\n\n'))
  const structure = lines(act.structure ?? '')
  if (structure.length) {
    P.push(
      '# 세특 구성 — 선생님이 정한 짜임\n아래 차례로 쓴다. 메모에 없는 칸은 건너뛴다. 위의 서술 규칙과 기재 금지사항이 먼저다.\n' +
        structure.map((l, i) => `${i + 1}. ${l}`).join('\n')
    )
  }
  const request = lines(act.request ?? '')
  if (request.length) P.push('# 선생님 요청사항\n' + request.map((l) => `- ${l}`).join('\n') + '\n- 위의 기재 금지사항과 어긋나면 금지사항을 따른다.')

  const len = ['# 분량']
  if (bytes < recBytes) {
    len.push(
      `- 이 활동은 ${rec.name} 한 칸(${recBytes}바이트) 가운데 한 부분이다. 같은 학생의 다른 활동 기록과 합쳐 들어가므로 이 활동의 몫만 쓴다.`
    )
  }
  len.push(`- ${bytes}바이트(한글 약 ${chars}자) 이내로 작성한다. 넘으면 안 된다.`)
  len.push(...amountLines(act.amount, bytes, act.fill ?? 70))
  if (com.BYTE_RULE) len.push(com.BYTE_RULE)
  P.push(len.join('\n'))

  const cols = act.columns ?? []
  P.push(
    (cols.length >= 2
      ? `# 입력 자료 형식\n아래 학생 자료는 교사가 다음 항목으로 나눠 적은 관찰 기록이다: ${cols.join(' | ')}. 빈 항목은 없는 것이다. 항목에 있는 사실만 근거로 문장을 다듬어 쓴다.`
      : '# 입력 자료 형식\n아래 학생 자료는 교사가 수업·활동 중에 관찰하고 자유롭게 적은 메모다. 메모에 있는 사실만 근거로 문장을 다듬어 쓴다.') +
      (act.amount === '메모만큼' ? ' 메모가 짧으면 짧게 쓴다.' : '')
  )
  // 시트의 GRADE_RULE 을 줄인 것 — '성장 가능성'은 분량 규칙(막연한 성장 가능성 문장 금지)과 어긋나 뺐다
  if (rec.useGrade && com.GRADE_RULE) P.push('# 성취수준 반영\n' + GRADE_LINE)
  // 문체 예시 → 활동 예시 순 (시트와 같은 차례)
  const samples = (style?.samples ?? []).slice(0, SETEUK_STYLE_SAMPLE_MAX)
  if (samples.length) {
    P.push(
      '# 문체 예시 — 선생님이 예전에 쓴 세특\n내용·소재는 따르지 말고 문장 길이, 여는 방식, 끝맺음, 이음말 같은 쓰는 방식만 따른다.\n\n' +
        samples.map((t, i) => `## 문체 예시${i + 1}\n${t}`).join('\n\n')
    )
  }
  const ex = examplesText(act)
  if (ex) {
    P.push(
      '# 예시\n표현 방식과 서술 흐름을 참고한다. 문장을 그대로 베끼지 않는다. ' +
        ((act.fill ?? 70) >= 90 && act.amount !== '메모만큼'
          ? ''
          : '예시 결과의 길이와 내용은 그 예시 입력의 양에 맞춘 것이다. ' +
            (act.amount === '메모만큼' ? '학생 자료가 예시 입력보다 적으면 결과도 그만큼 짧게 쓴다.' : '학생 자료가 예시 입력보다 적으면 예시보다 짧아도 된다.')) +
        '\n\n' +
        ex
    )
  }
  if (style?.card) P.push('# 내 문체 (예시와 함께 가장 우선해서 따른다)\n' + style.card)
  P.push('# 출력\n' + (com.INSTRUCTION || '특기사항 본문만 한 문단으로 출력한다.'))
  return P.join('\n\n')
}

/**
 * 학생 한 명의 자료 — 이름을 가린 관찰 기록만 넣는다.
 * 문체 카드는 학생 자료 바로 뒤에 한 번 더 붙인다(쓰기 직전에 본 것을 가장 잘 따른다).
 */
export function seteukUser(maskedNote: string, style?: SeteukStyle | null, grade?: string): string {
  const card = style?.on ? style.card.trim() : ''
  const g = grade && GRADES.includes(grade) ? `\n성취수준: ${grade}` : ''
  return '[학생 자료]\n' + maskedNote.trim() + g + (card ? '\n\n# 쓰기 직전 확인 — 내 문체 (예시·규칙과 함께 그대로 따른다)\n' + card : '')
}

/** 문체 카드를 뽑는 규칙 — 예전 세특에서 '쓰는 방식'만 */
export const SETEUK_STYLE_SYSTEM =
  '# 역할\n당신은 학교생활기록부 문장의 문체를 분석하는 교사다.\n\n' +
  '# 할 일\n아래 [예전에 쓴 세특]들에서 "쓰는 방식"만 뽑아 문체 카드를 만든다. 학생·활동 내용은 옮기지 않는다.\n' +
  '다음을 각각 한 줄로: 한 편의 문장 수와 문장 길이, 첫 문장을 여는 방식, 내용을 펼치는 순서, 끝맺음 어미, 자주 쓰는 이음말, ' +
  '평가어를 쓰는 정도, 피하는 표현. 8줄 이내로, 줄마다 "- "로 시작한다. 다른 사람이 이 카드만 보고 같은 문체로 쓸 수 있게 구체적으로.\n\n' +
  '# 출력\n문체 카드만 출력한다.'

export function styleUser(samples: string[]): string {
  return '# 예전에 쓴 세특\n' + samples.map((t, i) => `## ${i + 1}\n${String(t).trim()}`).join('\n\n')
}

/** 모델이 붙인 머리말 · 따옴표 · 마크다운 · 줄바꿈을 걷어 낸다 */
export function cleanSeteuk(raw: string): string {
  let t = String(raw || '').trim()
  t = t.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim()
  const quotes = /^["“'‘]+|["”'’]+$/g
  t = t.replace(quotes, '').replace(/^(특기사항|세특|본문|결과)\s*[:：]\s*/, '').replace(quotes, '')
  t = t.replace(/\*\*/g, '').replace(/^#+\s*/gm, '')
  return t.replace(/\s*\r?\n+\s*/g, ' ').trim()
}

/* ---------- 검사 ---------- */

const ALL_RULES: SeteukRule[] = [...SETEUK_BANNED, ...SETEUK_FORMAT, ...SETEUK_AI_TELL]

/* ---------- 내 규칙 설정 — 금지어 · 검사 · 쓰는 규칙을 선생님이 고르기 ---------- */

/** 선생님이 더한 금지어 한 줄 — 낱말은 쉼표로 여러 개 */
export interface SeteukMyWord {
  words: string
  level: 'block' | 'check'
  why: string
}

/**
 * 세특 작성실의 규칙 설정. 정규식을 몰라도 되게 켜고 끄기 · 낱말 적기만으로 고친다.
 *   off      — 끈 기본 검사(규칙의 re 로 가린다)
 *   mine     — 내 금지어(쉼표로 낱말 여러 개). 검사에 걸리고, 쓰는 규칙에도 "쓰지 않는다"로 들어간다
 *   extra    — 쓰는 규칙에 더할 줄(한 줄에 하나)
 *   sections — 쓰는 규칙에서 빼 둘 수 있는 칸(피할 표현 · 서술 흐름 · 서술 관점)
 * 서술 규칙 · 기재 금지사항 · 분량 · 출력 칸은 2026 기재요령의 틀이라 끌 수 없다.
 */
export interface SeteukConfig {
  off: string[]
  mine: SeteukMyWord[]
  extra: string
  sections: { avoid: boolean; frame: boolean; view: boolean }
}
export const SETEUK_CONFIG_KEY = 'seteuk_config'
export const defaultConfig = (): SeteukConfig => ({ off: [], mine: [], extra: '', sections: { avoid: true, frame: true, view: true } })

export function readConfig(raw: string): SeteukConfig {
  let v: unknown
  try {
    v = JSON.parse(raw || '{}')
  } catch {
    return defaultConfig()
  }
  const o = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, unknown>
  const sec = (o.sections && typeof o.sections === 'object' ? o.sections : {}) as Record<string, unknown>
  const bool = (x: unknown): boolean => x !== false
  return {
    off: (Array.isArray(o.off) ? o.off : []).map(str).filter((re) => ALL_RULES.some((r) => r.re === re)),
    mine: (Array.isArray(o.mine) ? (o.mine as Record<string, unknown>[]) : [])
      .map((m) => ({ words: str(m?.words).trim(), level: (m?.level === 'block' ? 'block' : 'check') as 'block' | 'check', why: str(m?.why).trim() }))
      .filter((m) => m.words)
      .slice(0, 50),
    extra: str(o.extra).slice(0, 2000),
    sections: { avoid: bool(sec.avoid), frame: bool(sec.frame), view: bool(sec.view) }
  }
}

let CONFIG: SeteukConfig = defaultConfig()

/** 이 화면(또는 메인)이 쓸 규칙 설정 — 읽은 뒤 · 고친 뒤 한 번 부른다 */
export function setSeteukConfig(c: SeteukConfig): void {
  CONFIG = readConfig(JSON.stringify(c ?? {}))
}
export const getSeteukConfig = (): SeteukConfig => CONFIG

/** 쉼표 · 줄바꿈으로 나눈 낱말 */
export const wordsOf = (w: string): string[] =>
  w
    .split(/[,，、\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 40)

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 내 금지어를 검사 규칙으로 */
export function myRules(c: SeteukConfig = CONFIG): SeteukRule[] {
  return c.mine
    .map((m) => ({ ws: wordsOf(m.words), m }))
    .filter((x) => x.ws.length)
    .map(({ ws, m }) => ({ level: m.level, label: '내 금지어', re: ws.map(escapeRe).join('|'), why: m.why || '선생님이 정한 금지어' }))
}

/** 지금 쓰는 검사 — 끈 기본 검사는 빼고 내 금지어를 더한다 */
export function activeRules(c: SeteukConfig = CONFIG): SeteukRule[] {
  const off = new Set(c.off)
  return [...ALL_RULES.filter((r) => !off.has(r.re)), ...myRules(c)]
}

/** 설정 화면에서 묶어 보여 줄 기본 검사 */
export const RULE_GROUPS: { key: string; name: string; desc: string; rules: SeteukRule[] }[] = [
  { key: 'neis', name: '기재 금지', desc: '2026 기재요령에서 학생부에 쓰지 못하게 한 것', rules: SETEUK_BANNED },
  { key: 'format', name: '형식', desc: '어미 · 학생 주어 · 특수문자 · 줄바꿈', rules: SETEUK_FORMAT },
  { key: 'ai', name: 'AI 말투', desc: 'AI 글에 흔한 번역투 · 상투어 — 확인으로만 알린다', rules: SETEUK_AI_TELL }
]

/** 분량 · 기재 금지 · 형식 · AI 말투 · 맞춤법 — block 이 하나라도 있으면 ok 가 아니다 */
export function validateSeteuk(text0: string, limitBytes: number, only?: SeteukRule[], minRatio = 0.7): SeteukCheck {
  // 규칙을 주지 않으면 지금 설정의 검사(끈 것은 빼고 내 금지어를 더한 것)와 맞춤법까지
  const rules = only ?? activeRules()
  const text = String(text0 || '')
  const issues: SeteukIssue[] = []
  const b = byteLen(text)
  if (!text.trim()) return { ok: false, bytes: 0, issues: [{ level: 'block', label: '결과 없음', hit: '' }] }

  if (limitBytes && b > limitBytes) issues.push({ level: 'block', label: '분량 초과', hit: `${b} / ${limitBytes}바이트` })
  else if (limitBytes && b < limitBytes * minRatio) issues.push({ level: 'check', label: '분량 부족', hit: `${b} / ${limitBytes}바이트` })

  for (const r of rules) {
    if (!r?.re) continue
    let m: RegExpMatchArray | null
    try {
      m = text.match(new RegExp(r.re, 'g'))
    } catch {
      continue
    }
    if (!m?.length) continue
    const uniq = [...new Set(m)]
    const issue: SeteukIssue = { level: r.level === 'block' ? 'block' : 'check', label: r.label, hit: uniq.slice(0, 5).join(', ') }
    if (r.fix) issue.fix = r.fix
    if (r.why) issue.why = r.why
    issues.push(issue)
  }
  if (!only) issues.push(...spellIssues(text))
  return { ok: !issues.some((x) => x.level === 'block'), bytes: b, issues }
}

/** 표 한 칸에 보일 짧은 상태 */
export function checkBadge(c: SeteukCheck): { kind: 'ok' | 'check' | 'block' | 'none'; text: string } {
  if (!c.bytes) return { kind: 'none', text: '' }
  const blocks = c.issues.filter((x) => x.level === 'block').length
  if (blocks) return { kind: 'block', text: `고칠 곳 ${blocks}` }
  if (c.issues.length) return { kind: 'check', text: `살펴볼 곳 ${c.issues.length}` }
  return { kind: 'ok', text: '통과' }
}

/* ---------- 모드 (교과 · 동아리 · 담임) ---------- */

/**
 * 가르치는 반 학생, 동아리 부원, 우리 반 학생은 서로 다른 명단이다.
 * 그래서 모드마다 명단을 따로 두고, 기록 영역으로 활동이 어느 모드인지 정한다.
 */
export type SeteukMode = 'subject' | 'club' | 'homeroom'

export const SETEUK_MODES: { key: SeteukMode; name: string; who: string; desc: string; recs: string[] }[] = [
  { key: 'subject', name: '교과', who: '수업 반 학생', desc: '과목 세특 · 개인 세특', recs: ['과세특', '개세특'] },
  { key: 'club', name: '동아리', who: '동아리 부원', desc: '동아리활동 특기사항', recs: ['동아리'] },
  { key: 'homeroom', name: '담임', who: '우리 반 학생', desc: '자율 · 진로 · 행동특성', recs: ['자율', '진로', '행발'] }
]

export function modeOfRec(rec: string): SeteukMode {
  return SETEUK_MODES.find((m) => m.recs.includes(rec))?.key ?? 'subject'
}
export const modeInfo = (mode: SeteukMode): (typeof SETEUK_MODES)[number] => SETEUK_MODES.find((m) => m.key === mode) ?? SETEUK_MODES[0]

export type SeteukRosters = Record<SeteukMode, SeteukStudent[]>
export const emptyRosters = (): SeteukRosters => ({ subject: [], club: [], homeroom: [] })

/** 모드별 명단 자리 — 교과는 처음부터 쓰던 자리 그대로 */
export const seteukRosterKey = (mode: SeteukMode): string => (mode === 'subject' ? SETEUK_ROSTER_KEY : `${SETEUK_ROSTER_KEY}_${mode}`)

/**
 * 처음 열었을 때 만들어 두는 활동 — 명단만 넣으면 바로 쓸 수 있게.
 * 이름 · 분량은 [활동 설정]에서 고치고, 필요 없으면 지운다.
 */
export function defaultActivities(): SeteukActivity[] {
  return [
    newActivity('d_subject', { name: '수업 활동', rec: '과세특' }),
    newActivity('d_club', { name: '동아리 활동', rec: '동아리' }),
    newActivity('d_auto', { name: '자율활동', rec: '자율' }),
    newActivity('d_career', { name: '진로활동', rec: '진로' }),
    newActivity('d_behavior', { name: '행동특성 및 종합의견', rec: '행발' })
  ]
}

/* ---------- 맞춤법 (정확도가 높은 것만, 모두 '확인') ---------- */

const JONG_RIEUL = 8
const JONG_NIEUN = 4
const JONG_SS = 20
const JONG_BS = 18
/** '안' · '않' 뒤에 오는 되 · 돼 · 하 · 해 (받침이 붙은 된 · 됨 · 한 · 했 … 까지) */
const NEG_NEXT = /^[돼-됳하-햏]/
function jongOf(ch: string): number {
  const c = ch ? ch.charCodeAt(0) : 0
  if (c < 0xac00 || c > 0xd7a3) return -1
  return (c - 0xac00) % 28
}

/**
 * 표로 잡기 어려운 띄어쓰기 · 어미.
 *   할수 있다 → 할 수 있다 · 할것 → 할 것 · 할때 → 할 때 · 할줄 알다 → 할 줄 알다 · 있슴 → 있음 · 않하다 → 안 하다 · 안된다 → 안 된다
 *   같은 낱말 연속 · 빈칸 두 번 · 문장부호 앞 빈칸 · 마침표 뒤 붙여 쓰기
 */
export function spellIssues(text: string): SeteukIssue[] {
  const s = String(text || '')
  const out: SeteukIssue[] = []
  const seen = new Set<string>()
  const push = (hit: string, fix: string, why: string): void => {
    const k = `${hit}→${fix}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ level: 'check', label: '맞춤법', hit, fix, why })
  }
  for (let i = 1; i < s.length; i++) {
    const prev = s.charAt(i - 1)
    const ch = s.charAt(i)
    const next = s.charAt(i + 1)
    const j = jongOf(prev)
    if (ch === '수' && j === JONG_RIEUL) {
      if (/^(있|없)/.test(s.slice(i + 1).replace(/^ +/, ''))) push(prev + '수', prev + ' 수', "의존명사 '수'는 띄어 씀")
    } else if (ch === '것' && (j === JONG_RIEUL || j === JONG_NIEUN) && !['날', '별', '온', '산'].includes(prev)) {
      push(prev + '것', prev + ' 것', "의존명사 '것'은 띄어 씀")
    } else if (ch === '때' && j === JONG_RIEUL) {
      push(prev + '때', prev + ' 때', "'~ㄹ 때'는 띄어 씀")
    } else if (ch === '줄' && j === JONG_RIEUL && /^ ?(알|몰)/.test(s.slice(i + 1))) {
      push(prev + '줄', prev + ' 줄', "의존명사 '줄'은 띄어 씀")
    } else if (ch === '슴' && (j === JONG_SS || j === JONG_BS)) {
      push(prev + '슴', prev + '음', "명사형은 '~음' (있음, 했음)")
    } else if (ch === '않' && NEG_NEXT.test(next)) {
      push('않' + next, '안 ' + next, "부정은 '안 ~' (않은 '~지 않다'에만)")
    }
  }
  let m: RegExpExecArray | null
  const re1 = new RegExp(`(^|[\\s,.])안(${NEG_NEXT.source.slice(1)})`, 'g')
  while ((m = re1.exec(s))) push('안' + m[2], '안 ' + m[2], "부정의 '안'은 띄어 씀")
  const re2 = /(^|\s)([가-힣A-Za-z]{2,})\s+\2(?=[\s.,]|$)/g
  while ((m = re2.exec(s))) push(`${m[2]} ${m[2]}`, m[2], '같은 낱말이 잇따라 나옴')
  if (/ {2,}/.test(s)) push('빈칸 두 번', '빈칸 한 번', '빈칸이 겹침')
  const a = s.match(/\S\s+[.,]/)
  if (a) push(a[0], a[0].replace(/\s+/, ''), '문장부호 앞에는 빈칸을 두지 않음')
  const b = s.match(/[가-힣][.,][가-힣A-Za-z]/)
  if (b) push(b[0], `${b[0].charAt(0)}${b[0].charAt(1)} ${b[0].charAt(2)}`, '마침표 · 쉼표 뒤는 한 칸 띄움')
  return out
}

/* ---------- 자동 고쳐쓰기 · 근거 확인 (시트의 16_Rules 와 같다) ---------- */

/** 초안을 받은 뒤 할 일 — 학생마다 AI 를 더 부르는 것이라 끌 수 있다 */
export interface SeteukOptions {
  /** 검사에서 '고침'이 나온 학생만 걸린 점을 짚어 한 번 더 고쳐 쓰게 한다 */
  autoRepair: boolean
  /** 초안에 관찰 기록에 없는 내용이 있는지 한 번 더 묻는다 */
  ground: boolean
}
export const SETEUK_OPTIONS_KEY = 'seteuk_options'
export const defaultOptions = (): SeteukOptions => ({ autoRepair: true, ground: false })

export function readOptions(raw: string): SeteukOptions {
  let v: unknown
  try {
    v = JSON.parse(raw || '{}')
  } catch {
    return defaultOptions()
  }
  const o = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, unknown>
  const d = defaultOptions()
  return { autoRepair: typeof o.autoRepair === 'boolean' ? o.autoRepair : d.autoRepair, ground: typeof o.ground === 'boolean' ? o.ground : d.ground }
}

/** 고쳐 쓸 만한지 — 분량 초과 · 기재 금지 · 어미 같은 '고침'이 하나라도 있으면 */
export function needsRepair(c: SeteukCheck): boolean {
  return c.issues.some((x) => x.level === 'block' && x.label !== '결과 없음')
}

/** 두 검사 결과 중 나은 쪽 — '고침'이 적은 쪽, 같으면 '확인'이 적은 쪽(같으면 처음 것) */
export function betterCheck(a: SeteukCheck, b: SeteukCheck): 'a' | 'b' {
  const n = (c: SeteukCheck, lv: string): number => c.issues.filter((x) => x.level === lv).length
  const ab = n(a, 'block')
  const bb = n(b, 'block')
  if (ab !== bb) return bb < ab ? 'b' : 'a'
  return n(b, 'check') < n(a, 'check') ? 'b' : 'a'
}

function repairLines(issues: SeteukIssue[], limitBytes: number): string[] {
  return issues.map((x) => {
    if (x.label === '분량 초과') return `- 분량 초과(${x.hit}): ${limitBytes}바이트 이내가 되도록 덜 중요한 문장을 줄인다.`
    if (x.fix) return `- ${x.label}: "${x.hit}" → "${x.fix}"`
    return `- ${x.label}: "${x.hit}" ${x.why ? `— ${x.why} ` : ''}→ 이 내용을 빼거나 기재요령에 맞게 바꾼다.`
  })
}

/** 문체 카드를 요청 끝에 한 번 더 — 켜져 있고 카드가 있을 때만 */
export function styleTail(style?: SeteukStyle | null): string {
  const card = style?.on ? style.card.trim() : ''
  return card ? '\n\n# 쓰기 직전 확인 — 내 문체 (예시·규칙과 함께 그대로 따른다)\n' + card : ''
}

/** 고쳐 쓰기 요청 — 규칙(시스템 프롬프트)은 처음 쓸 때와 같은 것을 다시 보낸다 */
export function buildRepairUser(note: string, draft: string, issues: SeteukIssue[], limitBytes: number): string {
  return [
    '# 학생 자료',
    note.trim(),
    '',
    '# 고쳐 쓸 초안',
    draft.trim(),
    '',
    '# 자동 검사에서 걸린 점 — 이것만 바로잡는다',
    ...repairLines(issues.filter((x) => x.level === 'block'), limitBytes),
    '',
    '# 출력',
    '위 점만 바로잡은 특기사항 본문만 한 문단으로 출력한다. 학생 자료에 없는 내용을 새로 넣지 않는다. 설명을 붙이지 않는다.'
  ].join('\n')
}

/** 관찰 기록에 없는 구절 하나 */
export interface SeteukGround {
  quote: string
  why: string
}

/** "초안이 관찰 기록에 있는 내용인가" — 2026 기재요령의 허위 · 과장 확인을 돕는 검토 요청 */
export const SETEUK_GROUND_SYSTEM =
  '# 역할\n당신은 학교생활기록부 문장을 검토하는 교사다.\n\n' +
  '# 할 일\n[학생 자료]와 [특기사항 초안]을 비교해, 초안에서 학생 자료로 뒷받침되지 않는 내용을 찾는다.\n' +
  '- 자료에 없는 활동, 결과, 수치, 횟수, 도서·인물, 과장된 평가(예: 탁월함, 뛰어남)를 찾는다.\n' +
  '- 자료의 표현을 자연스럽게 바꾼 것, 자료에서 바로 읽히는 의미 부여는 문제 삼지 않는다.\n' +
  '- 근거가 없는 구절만 초안 원문 그대로 짧게 뽑는다.\n\n' +
  '# 출력\nJSON 하나만 출력한다. {"unsupported":[{"quote":"초안의 구절","why":"자료에 없는 이유"}]}\n없으면 {"unsupported":[]}'

export function buildGroundUser(note: string, draft: string): string {
  return `# 학생 자료\n${note.trim()}\n\n# 특기사항 초안\n${draft.trim()}`
}

export function parseGround(text: string): SeteukGround[] {
  const t = String(text || '')
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
  let j: unknown = null
  try {
    j = JSON.parse(t)
  } catch {
    const a = t.indexOf('{')
    const b = t.lastIndexOf('}')
    if (a >= 0 && b > a) {
      try {
        j = JSON.parse(t.slice(a, b + 1))
      } catch {
        j = null
      }
    }
  }
  const o = j as { unsupported?: unknown } | unknown[] | null
  const list = Array.isArray(o) ? o : o && Array.isArray((o as { unsupported?: unknown }).unsupported) ? ((o as { unsupported: unknown[] }).unsupported) : []
  return list
    .map((x) => {
      const r = (x ?? {}) as Record<string, unknown>
      return { quote: str(r.quote ?? r.text).trim(), why: str(r.why).trim() }
    })
    .filter((x) => x.quote)
    .slice(0, 8)
}

/** 지금 글에 아직 남아 있는 근거 없는 구절만 — 선생님이 고친 구절은 더 보이지 않게 */
export function groundLeft(list: SeteukGround[] | undefined, text: string): SeteukGround[] {
  const flat = (s: string): string => s.replace(/\s+/g, '')
  const t = flat(text)
  return (list ?? []).filter((g) => t.includes(flat(g.quote)))
}

/* ---------- 관찰 기록 가져오기 (스캔 · 사진 · 엑셀 붙여넣기) ---------- */

/** 스캔 문서 읽기(OCR)에 덧붙이는 요청 — 학생마다 한 행으로 받아야 명단과 맞출 수 있다 */
export const SETEUK_OCR_NOTE =
  '학생 한 명을 한 행으로 쓰세요. 열은 반 | 번호 | 이름 | 내용 순서로 하고, 문서에 반이나 번호가 없으면 그 칸은 비워 두세요. ' +
  '학번이 있으면 번호 칸에 학번을 그대로 쓰세요. 그 학생이 쓴 글이나 그 학생에 대해 적힌 글은 모두 내용 칸에 원문 그대로 옮기세요.'

/** 머리글과 줄로 된 표 — 스캔에서 읽은 표(MdTable)도, 붙여 넣은 표도 이 모양으로 맞춘다 */
export interface SeteukSheet {
  header: string[]
  rows: string[][]
}

export interface SeteukImportHit {
  id: string
  text: string
}
export interface SeteukImportMiss {
  /** 표에 적혀 있던 반 · 번호 · 이름 */
  label: string
  text: string
}
export interface SeteukImport {
  hits: SeteukImportHit[]
  misses: SeteukImportMiss[]
}

const COL_NAME = /^(이름|성명|학생명|학생이름|학생)$/
const COL_NO = /^(번호|번|순번|출석번호)$/
const COL_CLS = /^(반|학급)$/
const COL_HAK = /^학번$/
const COL_SKIP = /^(페이지|쪽|쪽수|연번|no\.?|비고)$/i

/** 따옴표로 싼 칸(엑셀에서 줄바꿈이 든 칸)을 지키며 탭 표를 나눈다 */
function splitTsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = String(text || '').replace(/\r\n?/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === '\t') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell)
  rows.push(row)
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c))
}

/**
 * 엑셀에서 복사한 표를 읽는다. 머리줄(이름 · 번호 · 반 · 학번)이 있으면 그대로,
 * 없으면 칸 수로 짐작한다: 2칸 = 번호(또는 이름) · 내용 / 3칸 = 번호 · 이름 · 내용 / 4칸 이상 = 반 · 번호 · 이름 · 내용…
 */
export function sheetFromPaste(text: string): SeteukSheet | null {
  const rows = splitTsv(text)
  if (!rows.length) return null
  const width = Math.max(...rows.map((r) => r.length))
  if (width < 2) return null
  const norm = (c: string): string => c.replace(/\s+/g, '')
  const first = rows[0].map(norm)
  if (first.some((c) => COL_NAME.test(c) || COL_NO.test(c) || COL_HAK.test(c))) return { header: rows[0], rows: rows.slice(1) }
  let header: string[]
  if (width === 2) header = [rows.every((r) => /^\d+$/.test(r[0] ?? '')) ? '번호' : '이름', '내용']
  else if (width === 3) header = ['번호', '이름', '내용']
  else header = ['반', '번호', '이름', ...Array.from({ length: width - 3 }, (_, i) => (width === 4 ? '내용' : `내용${i + 1}`))]
  return { header, rows }
}

/** 칸 글 — <br> 은 줄바꿈으로, 굵게 표시는 뗀다 */
function cellText(s: string | undefined): string {
  return String(s ?? '')
    .replace(/\s*<br\s*\/?>\s*/gi, '\n')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .trim()
}

/**
 * 표의 줄을 명단의 학생과 맞춘다. 이름이 명단에 하나뿐이면 이름으로, 아니면 학번 · 반과 번호 · (반이 하나일 때) 번호로.
 * 내용 칸이 여럿이면 '머리글: 글' 로 잇고, 같은 학생의 줄이 여럿이면 줄을 바꿔 잇는다.
 * 맞추지 못한 줄은 misses 로 돌려준다 — 화면에서 보여 주고 넣지 않는다.
 */
export function matchNotes(sheets: SeteukSheet[], students: SeteukStudent[]): SeteukImport {
  const norm = (c: string): string => c.replace(/\s+/g, '')
  const byName = (name: string): SeteukStudent | null => {
    const n = norm(name)
    const found = n ? students.filter((s) => norm(s.name) === n) : []
    return found.length === 1 ? found[0] : null
  }
  const byNo = (cls: string, no: string): SeteukStudent | null => {
    if (!no) return null
    const found = students.filter((s) => s.no === no && (!cls || s.cls === cls))
    return found.length === 1 ? found[0] : null
  }
  const hits = new Map<string, string[]>()
  const misses: SeteukImportMiss[] = []
  for (const sheet of sheets) {
    const head = sheet.header.map((h) => norm(cellText(h)))
    const iName = head.findIndex((h) => COL_NAME.test(h))
    const iNo = head.findIndex((h) => COL_NO.test(h))
    const iCls = head.findIndex((h) => COL_CLS.test(h))
    const iHak = head.findIndex((h) => COL_HAK.test(h))
    const body = head.map((h, i) => i).filter((i) => ![iName, iNo, iCls, iHak].includes(i) && !COL_SKIP.test(head[i]))
    if (!body.length || (iName < 0 && iNo < 0 && iHak < 0)) continue
    for (const r of sheet.rows) {
      const parts = body.map((i) => ({ h: cellText(sheet.header[i]), v: cellText(r[i]) })).filter((p) => p.v)
      if (!parts.length) continue
      const text = parts.length === 1 ? parts[0].v : parts.map((p) => `${p.h}: ${p.v}`).join('\n')
      const name = iName >= 0 ? cellText(r[iName]) : ''
      let cls = iCls >= 0 ? cleanCls(cellText(r[iCls])) : ''
      let no = ''
      const rawNo = cellText(iNo >= 0 ? r[iNo] : '') || cellText(iHak >= 0 ? r[iHak] : '')
      const hk = /^\d{4,5}$/.test(rawNo.replace(/\D/g, '')) ? splitHakbun(rawNo) : null
      if (hk) {
        cls = cls || hk.cls
        no = hk.no
      } else if (rawNo) no = cleanNo(rawNo)
      const st = byName(name) ?? byNo(cls, no)
      if (st) hits.set(st.id, [...(hits.get(st.id) ?? []), text])
      else misses.push({ label: [cls && `${cls}반`, no && `${no}번`, name].filter(Boolean).join(' ') || '(이름 · 번호 없음)', text })
    }
  }
  return { hits: [...hits.entries()].map(([id, t]) => ({ id, text: t.join('\n') })), misses }
}

/** 가져온 글을 관찰 기록에 넣는다 — 비어 있으면 그대로, 이미 있으면 줄을 바꿔 뒤에 붙인다(같은 글이 이미 있으면 그대로) */
export function mergeNote(old: string, add: string): string {
  const a = add.trim()
  const o = old.trim()
  if (!a || o.includes(a)) return old
  return o ? `${o}\n${a}` : a
}
