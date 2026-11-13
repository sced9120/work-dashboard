/**
 * 세특 작성실 — 취합: 활동별 글을 기록 영역(과세특 · 동아리 · 자율 …)마다 하나로 모으고,
 * 한도를 넘는 학생만 줄이고(압축), 학생 사이에 같은 문장 · 분량 차이 · 빈 칸이 없는지 본다.
 * 규칙은 세특 시트(Prompt-Master)의 80_Compile · 13_Equity · 38_Desk 와 같다. electron 도 DOM 도 쓰지 않는다.
 */
import { SETEUK_COMMON } from './seteukRules'
import { SETEUK_RECORDS, buildRole, byteLen, recordOf } from './seteuk'
import type { SeteukActivity, SeteukRecord, SeteukRows } from './seteuk'
import type { ModelChoice } from './types'

/** 취합 한 칸 — final 이 없으면(undefined) 아직 손대지 않은 것: 합본이 한도 안이면 합본이 그대로 최종본이다 */
export interface SeteukSum {
  /** AI 가 줄인 글(압축본) */
  ai?: string
  final?: string
}
export type SeteukSums = Record<string, SeteukSum>

/** 저장할 때 — final 이 null 이면 손댄 것을 지우고 합본을 따르게 되돌린다 */
export type SeteukSumPatch = Record<string, { ai?: string; final?: string | null }>

export const seteukSumKey = (rec: string): string => `seteuk_sum_${rec}`

export interface SeteukArea {
  rec: SeteukRecord
  limit: number
  acts: SeteukActivity[]
}

export interface SeteukCompressRequest {
  job: string
  rec: string
  ids: string[]
  model?: ModelChoice
}
export interface SeteukSumProgress {
  job: string
  done: number
  total: number
  id?: string
  sum?: SeteukSum
  error?: string
}
export interface SeteukCompressReply {
  ok: boolean
  error?: string
  written: number
  failed: number
  /** 합본이 비어 건너뛴 학생 수 */
  empty: number
  canceled?: boolean
}

/** 활동이 하나라도 있는 기록 영역 (기록 영역의 정해진 차례대로) */
export function areasOf(acts: SeteukActivity[]): SeteukArea[] {
  return SETEUK_RECORDS.map((rec) => ({ rec, limit: rec.chars * 3, acts: acts.filter((a) => a.rec === rec.key) })).filter((a) => a.acts.length)
}

/** 그 학생의 활동별 글 — 최종본이 있으면 최종본, 없으면 AI 초안 */
export function partsOf(area: SeteukArea, rows: Record<string, SeteukRows>, sid: string): string[] {
  return area.acts.map((a) => {
    const r = rows[a.id]?.[sid]
    return (r?.final.trim() || r?.ai.trim() || '').replace(/\s*\r?\n+\s*/g, ' ')
  })
}

export const mergedOf = (parts: string[]): string => parts.filter(Boolean).join(' ')

/** 화면 · 나이스 파일에 쓰는 최종본 — 손댄 글이 있으면 그것, 없으면 한도 안의 합본 */
export function sumFinal(sum: SeteukSum | undefined, merged: string, limit: number): string {
  if (typeof sum?.final === 'string') return sum.final
  return merged && byteLen(merged) <= limit ? merged : ''
}

export type SumState = 'none' | 'same' | 'over' | 'ai' | 'edit'

/** 한 줄의 상태 — 빈 칸 / 합본 그대로 / 한도 넘음(줄여야 함) / 압축본 / 다듬음 */
export function sumState(sum: SeteukSum | undefined, merged: string, limit: number): SumState {
  const fin = sumFinal(sum, merged, limit).trim()
  if (!fin) return merged && byteLen(merged) > limit ? 'over' : 'none'
  if (byteLen(fin) > limit) return 'over'
  if (fin === merged.trim()) return 'same'
  if (sum?.ai && fin === sum.ai.trim()) return 'ai'
  return 'edit'
}

/**
 * 압축본을 최종본으로 삼을지 — 최종본이 비었거나, 합본 그대로이거나, 한도를 넘을 때만.
 * 선생님이 다듬은 글(한도 안)은 덮지 않는다.
 */
export function adoptCompressed(sum: SeteukSum | undefined, merged: string, ai: string, limit: number): boolean {
  if (!ai.trim()) return false
  const fin = (typeof sum?.final === 'string' ? sum.final : '').trim()
  return !fin || fin === merged.trim() || byteLen(fin) > limit
}

/** 한도 안으로 자른다 — 되도록 마지막 마침표에서 */
export function trimToBytes(s0: string, limit: number): string {
  const s = String(s0 || '')
  if (byteLen(s) <= limit) return s
  let cut = ''
  for (const ch of s) {
    if (byteLen(cut + ch) > limit) break
    cut += ch
  }
  const last = cut.lastIndexOf('.')
  return last > cut.length * 0.5 ? cut.slice(0, last + 1) : cut
}

/** 압축용 규칙(시스템 프롬프트) — 기록 영역의 규칙을 그대로 따른다 */
export function compressPrompt(rec: SeteukRecord): string {
  const com = SETEUK_COMMON
  const bytes = rec.chars * 3
  const P: string[] = []
  // 과목은 넣지 않는다 — 여러 활동을 모은 글이라 '여러 교과를 …' 로 읽힌다
  P.push('# 역할\n' + buildRole(rec, ''))
  P.push(
    `# 과제\n여러 활동에서 작성된 특기사항 문장들이 주어진다. 이를 중복 없이 하나의 ${rec.name}으로 통합한다.\n` +
      '- 내용을 새로 지어내지 않는다. 주어진 문장에 있는 사실만 쓴다.\n' +
      '- 같은 역량이 반복되면 한 번으로 합치고, 서로 다른 장면은 살린다.\n' +
      '- 시간 순서 또는 역량의 흐름에 따라 자연스럽게 잇는다.\n' +
      '- 장면마다 계기 → 직접 한 과정 → 이어간 탐구 → 결론의 흐름을 살리고, 문장은 한 일이나 결론으로 끝맺는다.'
  )
  if (com.WRITING_RULES) P.push('# 서술 규칙\n' + com.WRITING_RULES)
  if (com.NEIS_RULES) P.push('# 학생부 기재 금지사항\n' + com.NEIS_RULES)
  P.push(`# 분량\n- 반드시 ${rec.chars}자(${bytes}바이트) 이내로 작성한다.\n- ${Math.round(bytes * 0.9)}바이트 이상을 채운다.\n${com.BYTE_RULE || ''}`)
  P.push('# 출력\n통합된 특기사항 본문만 한 문단으로 출력한다. 설명이나 머리말을 붙이지 않는다.')
  return P.join('\n\n')
}

export const compressUser = (maskedMerged: string): string => '[통합할 문장들]\n' + maskedMerged.trim()

export { recordOf }

/* ---------- 학생 간 점검 ---------- */

const GRAM = 10
const SIMILAR = 0.4

function grams(text: string): Set<string> {
  const t = String(text ?? '').replace(/[\s.,·\-–—'"“”‘’()[\]!?]/g, '')
  const out = new Set<string>()
  for (let i = 0; i + GRAM <= t.length; i++) out.add(t.substr(i, GRAM))
  return out
}

/** 두 글이 얼마나 겹치는지 0~1 (짧은 쪽을 열 글자씩 끊은 조각 가운데 다른 쪽에도 있는 비율) */
export function similarity(a: string, b: string): number {
  const A = grams(a)
  const B = grams(b)
  if (!A.size || !B.size) return 0
  const [small, big] = A.size <= B.size ? [A, B] : [B, A]
  let same = 0
  for (const g of small) if (big.has(g)) same++
  return same / small.size
}

export interface EquityReport {
  n: number
  filled: number
  /** 최종본 바이트의 중앙값 */
  median: number
  similar: { a: string; b: string; ratio: number }[]
  gaps: { label: string; bytes: number; kind: '짧음' | '긺' }[]
  empty: string[]
}

/**
 * 같은 문장(조각의 40% 이상이 겹침) · 분량 차이(중앙값의 절반 미만이거나 1.6배 초과, 4명 이상일 때) · 빈 최종본.
 * 어디로도 보내지 않고 여기서만 견준다.
 */
export function checkEquity(items0: { label: string; text: string }[]): EquityReport {
  const items = items0.map((x) => ({ label: x.label, text: String(x.text || '').trim() }))
  const filled = items.filter((x) => x.text)
  const out: EquityReport = { n: items.length, filled: filled.length, median: 0, similar: [], gaps: [], empty: items.filter((x) => !x.text).map((x) => x.label) }
  const sets = filled.map((x) => grams(x.text))
  for (let i = 0; i < filled.length; i++) {
    for (let j = i + 1; j < filled.length; j++) {
      const A = sets[i]
      const B = sets[j]
      if (!A.size || !B.size) continue
      const [small, big] = A.size <= B.size ? [A, B] : [B, A]
      let same = 0
      for (const g of small) if (big.has(g)) same++
      const r = same / small.size
      if (r >= SIMILAR) out.similar.push({ a: filled[i].label, b: filled[j].label, ratio: Math.round(r * 100) / 100 })
    }
  }
  out.similar.sort((x, y) => y.ratio - x.ratio)
  const bytes = filled.map((x) => byteLen(x.text))
  const v = [...bytes].sort((x, y) => x - y)
  const m = Math.floor(v.length / 2)
  out.median = v.length ? (v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) : 0
  if (filled.length >= 4 && out.median) {
    filled.forEach((x, i) => {
      if (bytes[i] < out.median * 0.5) out.gaps.push({ label: x.label, bytes: bytes[i], kind: '짧음' })
      else if (bytes[i] > out.median * 1.6) out.gaps.push({ label: x.label, bytes: bytes[i], kind: '긺' })
    })
  }
  return out
}

/** 저장된 글(JSON) → 취합 칸들 */
export function readSums(raw: string): SeteukSums {
  let obj: unknown
  try {
    obj = JSON.parse(raw || '{}')
  } catch {
    return {}
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
  const out: SeteukSums = {}
  for (const [id, v] of Object.entries(obj as Record<string, Record<string, unknown>>)) {
    if (!v || typeof v !== 'object') continue
    const s: SeteukSum = {}
    if (typeof v.ai === 'string') s.ai = v.ai
    if (typeof v.final === 'string') s.final = v.final
    if ('ai' in s || 'final' in s) out[id] = s
  }
  return out
}
