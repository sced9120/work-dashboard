/**
 * [최신 목록 불러오기] — 서비스가 알려 주는 모델 목록을 읽어 쓸 만한 이름만 추려 낸다. 순수 함수(화면 · 시험에서도 쓴다).
 * 실제 요청은 electron/main/ai.ts 의 listModels 가 보낸다.
 */
import type { Provider } from './types'

/** EXAONE 은 목록 주소가 공식 문서에 없다(미확인) — 안 되면 이 말로 안내한다 */
export const EXAONE_NO_LIST = '이 서비스는 목록을 불러올 수 없습니다'
export const VERTEX_NO_LIST = 'Vertex AI 연결에서는 목록을 불러오지 않습니다. 모델 이름을 직접 넣어 주세요.'

/** 서비스별 목록 요청 — 머리글은 앱이 대화에 쓰는 것과 같다(Claude 는 x-api-key + anthropic-version). 모두 미확인(실제 키로 시험하지 못함) */
export function listRequestFor(p: Provider, key: string, exaoneBase = 'https://api.exaone.ai/v1'): { url: string; headers: Record<string, string> } {
  const k = key.trim()
  if (p === 'openai') return { url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${k}` } }
  if (p === 'claude') return { url: 'https://api.anthropic.com/v1/models?limit=1000', headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' } }
  if (p === 'exaone') return { url: `${exaoneBase.replace(/\/+$/, '')}/models`, headers: { Authorization: `Bearer ${k}` } }
  return { url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', headers: { 'x-goog-api-key': k } }
}

const OPENAI_KEEP = /^(gpt-|o\d|chatgpt-)/
const OPENAI_DROP = /(embed|tts|whisper|dall-e|image|audio|realtime|transcribe|moderation|search)/
const GEMINI_DROP = /(embed|aqa|imagen|veo|tts)/

/** 날짜 꼬리(-2025-08-07 · -20250807)를 뗀 이름 */
const baseId = (id: string): string => id.replace(/-(\d{4}-\d{2}-\d{2}|\d{8})$/, '')

/** 새것처럼 보이는 순서 — 이름 속 숫자(버전)가 큰 것이 먼저, 같으면 날짜 꼬리 없는 것 · 이름순 */
export function compareModelIds(a: string, b: string): number {
  const nums = (s: string): number[] => (baseId(s).match(/\d+/g) ?? []).map(Number)
  const x = nums(a)
  const y = nums(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] ?? -1) - (x[i] ?? -1)
    if (d !== 0) return d
  }
  const da = baseId(a) !== a
  const db = baseId(b) !== b
  if (da !== db) return da ? 1 : -1
  return a < b ? -1 : a > b ? 1 : 0
}

const tidy = (ids: string[]): string[] => [...new Set(ids.map((s) => s.trim()).filter(Boolean))].sort(compareModelIds)

const asArray = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** 서비스가 보낸 목록(JSON) → 대화에 쓸 수 있는 모델 이름들(새것 먼저 · 중복 없음). 모양이 이상하면 빈 목록 */
export function parseModelList(provider: Provider, json: unknown): string[] {
  const root = json && typeof json === 'object' ? (json as Record<string, unknown>) : {}
  if (provider === 'gemini') {
    const out: string[] = []
    for (const m of asArray(root.models)) {
      const id = str(m.name).replace(/^models\//, '')
      const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : []
      if (id && methods.includes('generateContent') && !GEMINI_DROP.test(id.toLowerCase())) out.push(id)
    }
    return tidy(out)
  }
  const rows = asArray(root.data)
  if (provider === 'claude') {
    const out: string[] = []
    for (const m of rows) {
      const life = `${str(m.lifecycle)} ${str(m.state)} ${str(m.status)}`.toLowerCase()
      if (/deprecated|retired/.test(life)) continue
      out.push(str(m.id))
    }
    return tidy(out)
  }
  if (provider === 'openai') {
    return tidy(rows.map((m) => str(m.id)).filter((id) => OPENAI_KEEP.test(id) && !OPENAI_DROP.test(id.toLowerCase())))
  }
  // EXAONE — OpenAI 와 같은 모양이라 보고 이름은 거르지 않는다(임베딩만 뺀다)
  return tidy(rows.map((m) => str(m.id)).filter((id) => id && !/embed/i.test(id)))
}

/** 불러온 목록과 지금 아는 목록(기본 + 직접 추가)을 맞춰 본다 — added: 새로 쓸 수 있는 것 · missing: 아는 것 중 서비스 목록에 없는 것 */
export function diffModels(fetched: readonly string[], known: readonly string[]): { added: string[]; missing: string[] } {
  const f = new Set(fetched)
  const k = new Set(known)
  return { added: tidy(fetched.filter((m) => !k.has(m))), missing: known.filter((m) => !f.has(m)) }
}
