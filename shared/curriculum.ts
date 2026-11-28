/**
 * 2022 개정 교육과정 성취기준 (3.8.0~).
 *
 * 자료: greatsong/k-curriculum-2022 (CC BY 4.0) — 원문은 교육부 고시 제2022-33호.
 * 초 · 중 · 고 4,451개. 자료는 electron/main/data/curriculum2022.json 에 있고
 * scripts/build-curriculum.mjs 로 다시 만든다. 여기에는 화면과 메인이 함께 쓰는 모양 · 찾기 규칙만 둔다.
 */

export type SchoolLevel = '초' | '중' | '고'
export const SCHOOL_LEVELS: SchoolLevel[] = ['초', '중', '고']
export const LEVEL_NAME: Record<SchoolLevel, string> = { 초: '초등학교', 중: '중학교', 고: '고등학교' }

export interface Standard {
  /** 고유 식별자 — 보통 code 와 같고, 두 과목이 같은 코드를 쓰는 11건만 "코드|과목" */
  key: string
  /** 고시의 성취기준 코드(대괄호 포함) */
  code: string
  level: SchoolLevel
  /** 학년군: 초1-2 · 초3-4 · 초5-6 · 중1-3 · 고공통 · 고선택 */
  gradeGroup: string
  /** 교과군 (국어 · 수학 …) */
  group: string
  /** 과목 */
  subject: string
  /** 공통 · 일반선택 · 진로선택 · 융합선택 · 선택 */
  category: string
  /** 영역 (성취기준 소제목) */
  area: string
  /** 성취기준 문장 (고시 원문) */
  content: string
  /** 성취기준 해설 — 원문에 있는 것만 */
  note: string
}

export type StandardRow = [string, string, SchoolLevel, string, string, string, string, string, string, string]

export function rowToStandard(r: StandardRow): Standard {
  return { key: r[0], code: r[1], level: r[2], gradeGroup: r[3], group: r[4], subject: r[5], category: r[6], area: r[7], content: r[8], note: r[9] }
}

/** 화면 아래에 붙이는 출처 */
export const CURRICULUM_CREDIT =
  '성취기준 자료: greatsong/k-curriculum-2022 (CC BY 4.0) · 원문: 교육부 고시 제2022-33호 「초·중등학교 교육과정」'

export interface CurriculumSubject {
  level: SchoolLevel
  group: string
  subject: string
  count: number
}

export interface CurriculumQuery {
  level?: SchoolLevel | ''
  /** 교과군 */
  group?: string
  /** 과목 — 정확히 같은 이름 */
  subject?: string
  /** 낱말(띄어 쓰면 모두 들어간 것) · 코드 일부 */
  q?: string
  /** 기본 200, 최대 1000 */
  limit?: number
}

export interface CurriculumResult {
  total: number
  items: Standard[]
}

export interface CurriculumCheck {
  /** 글에서 찾은 성취기준 코드 (겹친 것은 한 번) */
  found: string[]
  /** 자료에 없는 코드 — 지어냈거나 옛 교육과정(2015 개정)일 수 있다 */
  unknown: string[]
}

/** 비교용 — 띄어쓰기 · 가운뎃점 모양을 맞춘다 */
export function normText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[⋅·•∙]/g, '·')
    .replace(/\s+/g, '')
}

/** 코드 비교용 — [10공수1-01-01] · 10공수1-01-01 · [10 공수1 -01-01] 을 같게 본다 */
export function normCode(s: string): string {
  return s.replace(/[[\]\s]/g, '').toLowerCase()
}

export function matchStandard(s: Standard, q: CurriculumQuery): boolean {
  if (q.level && s.level !== q.level) return false
  if (q.group && s.group !== q.group) return false
  if (q.subject && s.subject !== q.subject) return false
  const words = (q.q ?? '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = normText(`${s.code} ${s.subject} ${s.area} ${s.content}`)
  return words.every((w) => hay.includes(normText(w)))
}

export function searchStandards(list: Standard[], q: CurriculumQuery): CurriculumResult {
  const limit = Math.max(1, Math.min(1000, Math.floor(Number(q.limit) || 200)))
  const items: Standard[] = []
  let total = 0
  for (const s of list) {
    if (!matchStandard(s, q)) continue
    total++
    if (items.length < limit) items.push(s)
  }
  return { total, items }
}

export function subjectsOf(list: Standard[]): CurriculumSubject[] {
  const m = new Map<string, CurriculumSubject>()
  for (const s of list) {
    const k = `${s.level}|${s.group}|${s.subject}`
    const hit = m.get(k)
    if (hit) hit.count++
    else m.set(k, { level: s.level, group: s.group, subject: s.subject, count: 1 })
  }
  return [...m.values()]
}

/**
 * 글 안의 성취기준 코드 — 대괄호로 싼 것만 본다(예: [10공수1-01-01], [9사(지리)01-03], [12미적Ⅰ-02-03], [4과01-01]).
 * 대괄호 없는 낱말은 일반 글과 헷갈려 보지 않는다.
 */
const CODE_RE = /\[\s*(?:[0-9]{1,2}\s*[가-힣A-Za-zⅠ-Ⅻ()·⋅0-9]{1,12}|[가-힣]{1,6}\s)\s*-?\s*[0-9]{2}\s*-\s*[0-9]{2}(?:\s*-\s*[0-9]{2})?\s*\]/g

export function findCodes(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(CODE_RE)) {
    const raw = m[0].replace(/\s+/g, '')
    const k = normCode(raw)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(raw)
  }
  return out
}

export function checkCodes(text: string, known: Set<string>): CurriculumCheck {
  const found = findCodes(text)
  return { found, unknown: found.filter((c) => !known.has(normCode(c))) }
}

/** 고른 성취기준을 칸에 넣을 글 — 한 줄에 하나 "[코드] 문장" */
export function standardLines(list: Standard[]): string {
  return list.map((s) => `${s.code} ${s.content}`).join('\n')
}
