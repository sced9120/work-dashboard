/**
 * 학교 한글 양식(.hwp/.hwpx)을 채우는 데 쓰는 자료 모양.
 * 실제 읽고 고치는 일은 electron/main/hwpdoc.ts 가 한다.
 */

export type HwpKind = 'hwp' | 'hwpx'

/**
 * 양식 안에서 글을 바꿔 넣을 수 있는 자리 하나.
 *
 * id 는 `P3`(3번째 덩어리의 문단) 또는 `T0.1.2`(첫 번째 표의 2행 3열) 처럼 적는다.
 * AI 에게 양식을 보여 줄 때도, 답을 받아 고칠 때도 이 이름을 쓴다.
 */
export interface FormSpot {
  id: string
  /** 지금 그 자리에 들어 있는 글 */
  text: string
  /** 표 칸이면 왼쪽(없으면 위) 칸의 글. 빈칸이 무엇을 적는 곳인지 알려 준다. */
  label?: string
}

export interface FormLayout {
  ok: boolean
  kind: HwpKind
  spots: FormSpot[]
  /** {{학생명}} 처럼 적어 둔 자리 이름 */
  slots: string[]
  /** 라벨 옆의 빈 표 칸. 인터넷 없이 직접 채울 때 입력칸으로 쓴다. */
  blanks: FormSpot[]
  /** 글만 모은 것. 미리보기와 이름 찾기에 쓴다. */
  plain: string
  error?: string
}

/** 등록해 둔 학교 양식 파일 */
export interface HwpForm {
  id: number
  name: string
  filename: string
  kind: HwpKind
  size: number
  added_at: string
}

export interface FormEdit {
  id: string
  text: string
}

export interface FormFillResult {
  ok: boolean
  /** 실제로 바뀐 자리 수 */
  applied: number
  /** 바꾸려 했지만 못 바꾼 자리 — 한글에서 직접 고쳐야 한다 */
  missed: { id: string; label: string; text: string }[]
  /** 저장한 곳. 저장을 취소하면 비어 있다. */
  path?: string
  message: string
}

/** AI 가 양식의 어느 자리에 무엇을 넣을지 정한 결과 */
export interface FormPlan {
  ok: boolean
  edits: FormEdit[]
  /** 양식에 자리가 없어 넣지 못한 내용 */
  leftover: string
  /** 실제로 AI 에 보낸 글. 무엇이 나갔는지 확인용 */
  sentToAi: string
  error?: string
}

/** {{이름}} 을 찾는다. 안쪽 공백은 무시한다. */
export const SLOT_RE = /\{\{\s*([^{}]+?)\s*\}\}/g

export function slotNamesIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(SLOT_RE)) {
    const name = m[1].trim()
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}
