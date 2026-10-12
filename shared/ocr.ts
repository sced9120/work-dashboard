/**
 * 스캔 문서 → 엑셀 (OCR) — 화면과 메인이 함께 쓰는 약속.
 * 만든이가 Open WebUI 에서 쓰던 'Gemini 3.8 Flash OCR (Korean High-Res)' 설정을 그대로 따른다:
 * 그림 해상도 high · 생각 low · 검색 · 도구 없음 · PDF 는 글자를 뽑지 않고 원본 그대로 보낸다.
 */

export const OCR_DEFAULT_MODEL = 'gemini-3.8-flash'

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
}

export { isGeminiModel, isModernGemini } from './gemini'

/** 사용자 말 — 에이전트는 '출력해주세요' 를 받으면 문서 전체를 표로 옮긴다 */
export function ocrUserText(note: string): string {
  const n = note.trim()
  return n ? `출력해주세요\n\n추가 요청사항: ${n}` : '출력해주세요'
}

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
