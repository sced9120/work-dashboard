/**
 * 스캔 문서 → 엑셀 (OCR) — 화면과 메인이 함께 쓰는 약속.
 * 만든이가 Open WebUI 에서 쓰던 'Gemini 3.8 Flash OCR (Korean High-Res)' 설정을 그대로 따른다:
 * 그림 해상도 high · 생각 low · 검색 · 도구 없음 · PDF 는 글자를 뽑지 않고 원본 그대로 보낸다.
 */

import { isGeminiModel } from './gemini'

export const OCR_DEFAULT_MODEL = 'gemini-3.8-flash'
/**
 * OpenAI 키만 있을 때 쓰는 OCR 모델 — GPT-6 의 싼 등급(Gemini Flash 처럼). 사진 · PDF 를 함께 받는다.
 * 만든이가 catalog.json 의 "ocr": { "openaiModel": … } 로 바꿀 수 있다.
 */
export const OCR_OPENAI_MODEL = 'gpt-6-luna'

export type OcrProvider = 'gemini' | 'openai'

/** OpenAI 모델 이름 (gpt-… · o3 · chatgpt-…) */
export const isOpenaiModel = (m: string): boolean => /^(gpt-|chatgpt-|o\d)[a-z0-9.-]{0,60}$/.test(m)

/** 모델 이름으로 어느 서비스로 읽을지 */
export function ocrProviderOf(model: string): OcrProvider | null {
  if (isGeminiModel(model)) return 'gemini'
  if (isOpenaiModel(model)) return 'openai'
  return null
}

/** OpenAI 가 받는 사진 (HEIC 는 받지 않는다) */
export const OCR_OPENAI_IMAGES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** 고를 수 있는 파일 → Gemini 가 받는 형식 */
export const OCR_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif'
}

/** PDF 는 한 개 50MB, 그림은 한 개 20MB 까지 (Gemini 가 받는 크기) */
export const OCR_MAX_PDF = 50 * 1024 * 1024
export const OCR_MAX_IMAGE = 20 * 1024 * 1024

/** 한 번에 열어 두고 따로 읽는 탭 수 */
export const OCR_MAX_TABS = 5

export interface OcrFile {
  /** 이번 실행에서만 쓰는 번호 (파일 경로는 화면에 넘기지 않는다) */
  id: string
  name: string
  size: number
  mime: string
}

export interface OcrRequest {
  /** 어느 탭에서 읽는지 — 탭마다 따로 읽고 따로 이어 받는다 */
  tab: string
  ids: string[]
  /** 추가 요청 (예: 학번 순으로) */
  note: string
  model: string
}

export interface OcrAnswer {
  ok: boolean
  /** 이번에 받은 답 (마크다운) */
  text: string
  /** Gemini 가 멈춘 까닭 (STOP · MAX_TOKENS · SAFETY · RECITATION …) */
  finish: string
  /** 답이 길어 중간에 끊겼다 — [이어서 받기] 로 나머지를 받는다 */
  truncated: boolean
  usage?: { input: number; output: number }
  error?: string
}

export interface OcrProgress {
  phase: 'upload' | 'wait' | 'read'
  /** 받은 글자 수 */
  chars: number
  /** 받은 표 줄 수 (머리글 빼고) */
  rows: number
  /** 쪽을 나눠 읽을 때 — 다 읽은 묶음 수 · 전체 묶음 수 */
  part?: number
  parts?: number
}

export { isGeminiModel, isModernGemini } from './gemini'

/** 사용자 말 — 에이전트는 '출력해주세요' 를 받으면 문서 전체를 표로 옮긴다 */
export function ocrUserText(note: string): string {
  const n = note.trim()
  return n ? `출력해주세요\n\n추가 요청사항: ${n}` : '출력해주세요'
}

/**
 * OpenAI 로 긴 PDF 를 쪽 묶음으로 나눠 읽을 때의 사용자 말 — 이 묶음이 전체의 몇 쪽인지,
 * 열 머리글(두 번째 묶음부터), 앞 묶음에서 이어지는 쪽을 어떻게 쓰는지 알려 준다.
 */
export function ocrChunkText(note: string, from: number, to: number, total: number, header: string): string {
  return [
    ocrUserText(note),
    '',
    `이 요청에는 전체 ${total}쪽 문서 가운데 ${from}~${to}쪽(${to - from + 1}쪽)만 붙어 있습니다. 나머지 쪽은 따로 읽어 합칩니다.`,
    `붙어 있는 ${to - from + 1}쪽을 모두 읽고, 그 안의 모든 사람 · 모든 쪽을 빠짐없이 표로 옮기세요. 출력할 공간은 충분하니 줄이지 마세요.`,
    `'페이지' 열에는 전체 문서 기준 쪽 번호(${from}~${to})를 쓰세요.`,
    header
      ? `열 머리글은 앞 쪽들과 똑같이 다음을 그대로 쓰세요:\n${header}`
      : '',
    from > 1
      ? `첫 쪽(${from}쪽)에 이름 · 학번 칸이 없고 앞 쪽에서 이어지는 글만 있으면, 그 쪽은 한 행으로 쓰되 이름 칸에는 '${OCR_CONTINUED}' 이라고만 쓰고 본문 칸에 그 쪽의 글을 모두 옮기세요.`
      : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** 앞 묶음에서 이어지는 쪽을 가리키는 이름 칸 표시 — 합칠 때 앞 행에 붙인다 */
export const OCR_CONTINUED = '(앞에서 이어짐)'

/** 끊긴 답을 이어 받을 때 — 마지막으로 다 받은 행을 알려 주고 그다음부터 */
export function ocrContinueText(lastRow: string): string {
  return [
    '앞 답변의 표가 출력 길이 제한 때문에 중간에서 끊겼습니다.',
    lastRow ? `마지막으로 완전히 받은 행은 다음과 같습니다:\n${lastRow}` : '',
    '그 행 바로 다음 행부터 같은 열 머리글의 Markdown Table 로 이어서 출력하세요.',
    '이미 출력한 행은 다시 쓰지 말고, 앞 안내 문장 없이 머리글 행과 구분선, 그리고 나머지 행만 출력하세요.',
    '원문 보존 · 요약 금지 등 처음 지침은 그대로 지킵니다.'
  ]
    .filter(Boolean)
    .join('\n')
}

/** 모델이 스스로 "몇 페이지까지 처리했다" 고 적고 멈췄는지 */
export const saysStoppedEarly = (prose: string): boolean => /\d+\s*(페이지|쪽)\s*까지/.test(prose) && /처리|출력/.test(prose)

export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`
  return `${Math.max(1, Math.round(n / 1024))}KB`
}
