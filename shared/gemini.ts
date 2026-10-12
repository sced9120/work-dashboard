/**
 * Gemini 모델 이름으로 가르는 것 — 대화(electron/main/ai.ts)와 OCR(electron/main/ocr.ts)이 함께 쓴다.
 */

/**
 * temperature · top_p · top_k 를 받지 않는 모델 — Gemini 3.6 Flash 이후 모두와 3.5 Flash-Lite.
 * Google 이 밝힌 바뀐 점이라 이 값들은 빼고 보낸다(보내면 오류가 날 수 있다).
 */
export function isModernGemini(model: string): boolean {
  const m = model.toLowerCase()
  if (m.startsWith('gemini-3.5-flash-lite')) return true
  const v = /^gemini-(\d+)\.(\d+)/.exec(m)
  return !!v && (Number(v[1]) > 3 || (Number(v[1]) === 3 && Number(v[2]) >= 6))
}

/** 쓸 수 있는 Gemini 모델 이름인가 */
export const isGeminiModel = (m: string): boolean => /^gemini-[a-z0-9][a-z0-9.-]{0,60}$/.test(m)
