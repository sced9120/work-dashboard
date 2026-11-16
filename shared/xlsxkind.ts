/**
 * 엑셀로 옮길 표의 열 성격 판별 · 칸 서식 — 순수 함수라 시험에서 그대로 부른다.
 * 칸 값은 언제나 글자(문자열)로 둔다. 판별은 정렬 · 너비에만 쓴다(학번 0123 · 010-… · =SUM 을 지키려고).
 */

export type ColumnKind = 'text' | 'number' | 'date' | 'sequence'

/** 머리글 한글 낱말 — 두 글자 이상은 들어 있으면 맞는 것으로 본다 */
const KO_NUMBER = ['금액', '점수', '합계', '총점', '평균', '수량', '단가', '가격', '비용', '예산', '인원', '건수', '횟수', '비율', '백분율', '시수', '성적', '%']
const KO_DATE = ['날짜', '일자', '기간', '일시', '요일', '연도', '시기', '기한', '마감', '제출일']
const KO_SEQ = ['번호', '학번', '순번', '순위', '연번', '학년', '코드']
/** 한 글자 머리글은 그 글자만 있을 때(괄호 단위 뺀 뒤)만 — '반복' · '원인' 같은 말에 걸리지 않게 */
const KO_ONE: Record<string, ColumnKind> = { 반: 'sequence', 호: 'sequence', 원: 'number', 월: 'date' }

/** 머리글 영어 낱말 — 낱말 단위로만 맞춘다('note' 가 'no' 로 오판되지 않게) */
const EN_NUMBER = new Set(['quantity', 'qty', 'amount', 'price', 'cost', 'revenue', 'expense', 'total', 'subtotal', 'percentage', 'ratio', 'rate', 'value', 'score', 'points', 'point'])
const EN_DATE = new Set(['date', 'time', 'year', 'month', 'moment'])
const EN_SEQ = new Set(['no', 'id', 'index', 'rank', 'order', 'sequence', 'seq', 'code'])

const strip = (s: string): string => s.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim()

/** 머리글만으로 판별 — 모르면 null */
function byHeader(header: string): ColumnKind | null {
  const h = strip(header)
  if (!h) return null
  const bare = h.replace(/[(（\[][^)）\]]*[)）\]]/g, '').replace(/\s+/g, '')
  const hits = (list: string[]): boolean => list.some((k) => (k === '%' ? h.includes('%') : bare.includes(k) || h.replace(/\s+/g, '').includes(k)))
  const one = KO_ONE[bare]
  const words = h.toLowerCase().split(/[^a-z]+/).filter(Boolean)
  const has = (set: Set<string>): boolean => words.some((w) => set.has(w))
  // 숫자 → 날짜 → 번호 차례
  if (hits(KO_NUMBER) || has(EN_NUMBER) || one === 'number') return 'number'
  if (hits(KO_DATE) || has(EN_DATE) || one === 'date') return 'date'
  if (hits(KO_SEQ) || has(EN_SEQ) || one === 'sequence') return 'sequence'
  return null
}

const DATE_RES = [
  /^\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2}\.?(\s*\([^)]{1,3}\))?(\s+\d{1,2}:\d{2}(:\d{2})?)?$/, // 2026-3-5 · 2026. 3. 5. · 2026/03/05 09:00
  /^\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{4}$/, // 5-3-2026
  /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/, // 20260305
  /^\d{1,2}\s*월\s*\d{1,2}\s*일(\s*\([^)]{1,3}\))?$/, // 3월 5일(목)
  /^\d{2}\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}\.?$/, // 26.3.5
  /^\d{4}\s*년\s*\d{1,2}\s*월(\s*\d{1,2}\s*일)?(\s*\([^)]{1,3}\))?$/ // 2026년 3월 5일
]

export const isDateValue = (v: string): boolean => DATE_RES.some((re) => re.test(v.trim()))

/** 세 자리마다 쉼표 · % · 단위 글자를 뗀 숫자 — 앞이 0 인 정수(학번 0123)와 전화번호 모양은 숫자가 아니다 */
export function isNumberValue(v: string): boolean {
  const t = v.trim().replace(/\s+/g, '').replace(/[%원점명개건회분]$/, '').replace(/^[₩$]/, '')
  if (!t) return false
  const plain = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? t.replace(/,/g, '') : t
  return /^[-+]?(0|[1-9]\d*)(\.\d+)?$/.test(plain)
}

const isSmallInt = (v: string): boolean => /^\d{1,4}$/.test(v.trim())

/** 앞 열 개(빈칸 빼고)의 값으로 판별 */
function byValues(values: string[]): ColumnKind {
  const v = values.map((x) => strip(x)).filter(Boolean).slice(0, 10)
  if (!v.length) return 'text'
  const share = (f: (s: string) => boolean): number => v.filter(f).length / v.length
  if (share(isDateValue) >= 0.7) return 'date'
  // 1·2·3… 처럼 차례로 커 가는 정수는 번호, 그냥 정수는 숫자
  if (v.length > 3 && share(isSmallInt) >= 0.8) {
    const n = v.filter(isSmallInt).map(Number)
    const up = n.slice(1).filter((x, i) => x > n[i]).length
    if (n.length > 1 && up / (n.length - 1) >= 0.8) return 'sequence'
  }
  if (share(isNumberValue) >= 0.7) return 'number'
  return 'text'
}

/** 머리글 낱말이 먼저, 모르면 값 표본(앞 10개 · 70% 이상)으로 */
export function columnKind(header: string, values: string[]): ColumnKind {
  return byHeader(header) ?? byValues(values)
}

/** 열 유형별 너비 상·하한(엑셀 글자 수) — 글 열은 그대로 */
export function clampWidth(kind: ColumnKind, w: number): number {
  const c = (lo: number, hi: number): number => Math.max(lo, Math.min(hi, w))
  if (kind === 'sequence') return c(8, 15)
  if (kind === 'number') return c(12, 25)
  if (kind === 'date') return c(15, 20)
  return w
}

export interface CellMark {
  /** 겉 기호를 뗀 글 */
  text: string
  bold: boolean
  italic: boolean
  code: boolean
}

/** 칸 전체가 **굵게** · *기울임* · `코드` 일 때만 서식으로 — 일부만이면 그대로 두어 기호 정리는 다른 곳이 한다 */
export function cellMark(raw: string): CellMark {
  const t = raw.trim()
  let m = /^\*\*\*([^*]+)\*\*\*$/.exec(t)
  if (m) return { text: m[1], bold: true, italic: true, code: false }
  m = /^(\*\*|__)([^*_]+?)\1$/.exec(t)
  if (m) return { text: m[2], bold: true, italic: false, code: false }
  m = /^\*([^*]+)\*$/.exec(t)
  if (m) return { text: m[1], bold: false, italic: true, code: false }
  m = /^`([^`]+)`$/.exec(t)
  if (m) return { text: m[1], bold: false, italic: false, code: true }
  return { text: raw, bold: false, italic: false, code: false }
}
