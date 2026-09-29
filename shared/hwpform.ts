/**
 * 학교 한글 양식(.hwp/.hwpx)으로 문서를 만드는 데 쓰는 자료 모양.
 * 양식을 틀로 새 문서를 짜는 일은 electron/main/hwpgen.ts, {{칸}} 채우기는 hwpdoc.ts 가 한다.
 */

export type HwpKind = 'hwp' | 'hwpx'

/**
 * 채울 양식. 넣어 둔 양식은 id 로, 업무 도우미 대화에 올린 한글 파일은 경로로 가리킨다.
 * 대화에 올린 파일은 보관하지 않는다 — 인수인계 파일에 섞여 넘어가지 않게.
 */
export type FormRef = { id: number } | { path: string; name: string }

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
  /** 이 양식으로 만드는 문서 종류(문서 만들기의 문서 id). 비어 있으면 묶지 않은 양식 */
  doc_kind: string
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

/* ---------- 양식을 "틀"로 새 문서 만들기 ---------- */

/**
 * 양식의 최상위 문단 하나. 새 문서를 만들 때 이 문단의 글꼴·문단 모양을 본뜬다.
 * id 는 `P3` 처럼 적는다. 표가 든 문단은 kind 가 'table', 글상자만 든 문단은 'box' 다.
 * 빈 줄('empty')과 그림('object')은 앞 문단을 따라 저절로 들어간다.
 */
export interface FrameBlock {
  id: string
  /** 양식에 적힌 글(앞뒤 공백 없이, 줄바꿈은 공백으로) */
  text: string
  /** '가운데 · 16pt · 굵게' 처럼 화면에 보여 줄 모양 */
  style: string
  kind: 'text' | 'empty' | 'object' | 'table' | 'box'
  /** 이 문단에 바로 든 표(`T0`)·글상자(`B0`) */
  tables: string[]
  boxes: string[]
}

export interface FrameTable {
  id: string
  /** 표 안의 표면 바깥 표·글상자 번호 */
  parent: string | null
  /** 행마다 칸 글. 합쳐진 칸은 한 칸으로, 칸 안 줄바꿈은 \n */
  rows: string[][]
  /** 안에 표가 든 칸 — 칸의 글은 그대로 두고 안쪽 표를 따로 채운다 */
  fixed: boolean[][]
  /** 표 끝에 붙은 빈 행 수 (손으로 적는 명단 등) */
  blankTail: number
}

/** 글상자 */
export interface FrameBox {
  id: string
  parent: string | null
  /** 글상자 안 글, 문단마다 \n */
  text: string
}

export interface FrameLayout {
  ok: boolean
  kind: HwpKind
  blocks: FrameBlock[]
  tables: FrameTable[]
  boxes: FrameBox[]
  /** 알려 줄 것 (구역이 여러 개라 첫 구역만 쓴다 등) */
  notes: string[]
  error?: string
}

/** 새 문서의 문단 하나(양식 문단 sample 을 본뜬다) 또는 표 하나(양식 표 sample 을 본뜬다) */
export type DocItem =
  | { kind: 'p'; sample: string; text: string }
  | { kind: 't'; sample: string; rows: string[][] }

export interface ComposeResult {
  ok: boolean
  items: DocItem[]
  /** AI 가 남긴 말 */
  note: string
  sentToAi: string
  error?: string
}

/** 표 한 줄을 칸으로 나눈다. `\|` 는 글자 | 로 둔다. */
function cellsOf(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return body
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').replace(/<br\s*\/?>/gi, '\n').trim())
}

/**
 * AI 가 쓴 새 문서를 읽는다.
 *
 *   [P0] 2026학년도 제10회 학생선도위원회 회의록
 *   [T0]
 *   | 일시 | 2026. 10. 7.(수) 16:30 |
 *   메모: …
 *
 * 번호 없는 줄은 바로 앞 문단과 같은 모양으로 본다. 빈 줄은 버린다(문단 사이 간격은 양식을 따른다).
 */
export function parseComposed(answer: string): { items: DocItem[]; note: string } {
  const items: DocItem[] = []
  const notes: string[] = []
  let table: { kind: 't'; sample: string; rows: string[][] } | null = null
  let lastSample = ''
  const lines = answer.replace(/\r\n?/g, '\n').replace(/^```[^\n]*\n?|\n?```\s*$/g, '').split('\n')
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (/^\s*```/.test(line)) continue
    const note = /^\s*메모\s*[:：]\s*(.*)$/.exec(line)
    if (note) {
      if (note[1].trim()) notes.push(note[1].trim())
      table = null
      continue
    }
    if (table && /^\s*\|/.test(line)) {
      if (/^\s*\|?\s*:?-{2,}/.test(line) && /^[\s|:-]+$/.test(line)) continue
      table.rows.push(cellsOf(line))
      continue
    }
    table = null
    const t = /^\s*\[(T\d+)\]\s*(.*)$/.exec(line)
    if (t) {
      table = { kind: 't', sample: t[1], rows: [] }
      items.push(table)
      if (t[2].trim().startsWith('|')) table.rows.push(cellsOf(t[2]))
      continue
    }
    const p = /^\s*\[([PB]\d+)\]\s?(.*)$/.exec(line)
    if (p) {
      lastSample = p[1]
      if (p[2].trim()) items.push({ kind: 'p', sample: p[1], text: p[2].trim() })
      continue
    }
    if (!line.trim()) continue
    items.push({ kind: 'p', sample: lastSample, text: line.trim() })
  }
  return { items: items.filter((it) => it.kind === 'p' || it.rows.length), note: notes.join(' ') }
}

/** 새 문서를 글로만 늘어놓는다(미리보기·저장 이름용). */
export function composedText(items: DocItem[]): string {
  return items
    .map((it) => (it.kind === 'p' ? it.text : it.rows.map((r) => r.join(' | ')).join('\n')))
    .join('\n')
}
