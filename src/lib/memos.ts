import type { Memo, Workflow } from '../../shared/types'
import { BLANK_WORKFLOW } from '../../shared/types'

/**
 * 다른 화면(업무 워크플로우 · 통합 검색)에서 자유 메모장의 한 장을 열거나 새로 만들게 한다.
 * 메모장 화면이 열리면서 이 부탁을 한 번 가져간다.
 */
export type MemoRequest = { open: number } | { create: Memo['kind'] }

let pending: MemoRequest | null = null

export function requestMemo(r: MemoRequest): void {
  pending = r
  window.dispatchEvent(new Event('wd:memo'))
}

export function takeMemoRequest(): MemoRequest | null {
  const r = pending
  pending = null
  return r
}

/** 저장된 글을 워크플로우로. 깨졌으면 빈 판 */
export function flowOf(content: string): Workflow {
  try {
    const v = JSON.parse(content) as Workflow
    return v && Array.isArray(v.nodes) && Array.isArray(v.edges) ? v : BLANK_WORKFLOW
  } catch {
    return BLANK_WORKFLOW
  }
}

/** 목록에 보일 이름 — 제목이 없으면 첫 줄 */
export function memoName(m: Pick<Memo, 'kind' | 'title' | 'content'>): string {
  if (m.title.trim()) return m.title.trim()
  if (m.kind === 'flow') return '제목 없는 워크플로우'
  return m.content.trim().split('\n')[0].slice(0, 40) || '빈 메모'
}

/** 찾기 · 미리보기용 글 */
export function memoText(m: Pick<Memo, 'kind' | 'content'>): string {
  if (m.kind === 'memo') return m.content
  const wf = flowOf(m.content)
  return [...wf.nodes.map((n) => n.text), ...wf.edges.map((e) => e.label)].filter(Boolean).join(' ')
}
