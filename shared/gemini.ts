/**
 * Gemini 모델 이름으로 가르는 것 — 대화(electron/main/ai.ts)와 OCR(electron/main/ocr.ts)이 함께 쓴다.
 */

/**
 * temperature · top_p · top_k 를 받지 않는 모델 — Gemini 3.6 Flash 이후 모두와 3.5 Flash-Lite.
 * Google 이 밝힌 바뀐 점이라 이 값들은 빼고 보낸다(보내면 오류가 날 수 있다).
 */
export function isModernGemini(model: string): boolean {
  const m = model.toLowerCase()
  // 자동 모델 이름은 실제 모델이 아니다 — 어떤 모델이 걸려도 temperature 는 빼 둔다
  if (m === 'gemini-auto') return true
  if (m.startsWith('gemini-3.5-flash-lite')) return true
  const v = /^gemini-(\d+)\.(\d+)/.exec(m)
  return !!v && (Number(v[1]) > 3 || (Number(v[1]) === 3 && Number(v[2]) >= 6))
}

/** 쓸 수 있는 Gemini 모델 이름인가 */
export const isGeminiModel = (m: string): boolean => /^gemini-[a-z0-9][a-z0-9.-]{0,60}$/.test(m) && m !== 'gemini-auto'

/** Gemini 연결 방식 — 값이 이상하면 기본(API 키) */
export type GeminiModeName = 'key' | 'vertex' | 'express'
export function geminiModeOf(l: { gemini_mode?: string } | null | undefined): GeminiModeName {
  const m = l?.gemini_mode
  return m === 'vertex' || m === 'express' ? m : 'key'
}

/** 화면에서 쓸 수 있는 Gemini 가 있는가 — 연결 방식마다 보는 칸이 다르다 (화면에는 비밀 값 대신 *_set 표시만 온다) */
export function geminiReady(l: {
  gemini_mode?: string
  gemini_key?: string
  vertex_project?: string
  vertex_sa_set?: boolean
  vertex_express_key_set?: boolean
}): boolean {
  const mode = geminiModeOf(l)
  if (mode === 'vertex') return !!l.vertex_sa_set && !!(l.vertex_project ?? '').trim()
  if (mode === 'express') return !!l.vertex_express_key_set
  return !!(l.gemini_key ?? '').trim()
}

/** Vertex 위치 — 비면 global. 영문 소문자 · 숫자 · 하이픈만(주소에 들어가므로) */
export function vertexLocationOf(v: string | undefined): string {
  const s = (v ?? '').trim().toLowerCase()
  return /^[a-z][a-z0-9-]{1,40}$/.test(s) ? s : 'global'
}

/** Gemini 호출 주소 — 연결 방식마다 다르다. 스트리밍은 ?alt=sse 를 붙인다 */
export function geminiUrl(
  mode: GeminiModeName,
  where: { project?: string; location?: string },
  model: string,
  method: 'generateContent' | 'streamGenerateContent'
): string {
  const m = encodeURIComponent(model)
  const q = method === 'streamGenerateContent' ? '?alt=sse' : ''
  if (mode === 'vertex') {
    const p = encodeURIComponent((where.project ?? '').trim())
    const loc = vertexLocationOf(where.location)
    const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`
    return `https://${host}/v1/projects/${p}/locations/${loc}/publishers/google/models/${m}:${method}${q}`
  }
  // Express 주소 · 머리글은 Google 문서를 보고 적었을 뿐 실제 키로 확인하지 못했다(미확인)
  if (mode === 'express') return `https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:${method}${q}`
  return `https://generativelanguage.googleapis.com/v1beta/models/${m}:${method}${q}`
}
