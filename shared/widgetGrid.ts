/**
 * 새 화면 '오늘' 판의 위젯 칸 — 갤럭시 홈 화면처럼 칸에 맞춰 놓는다.
 *
 * 판은 가로 GRID_COLS 칸, 세로는 필요한 만큼. 위젯은 칸 단위 자리(x, y, w, h)를 가진다.
 * 옮기거나 크기를 바꾸면 그 자리에 두고, 겹친 위젯을 아래로 밀어낸다(밀린 위젯이 또 겹치면 그것도 민다).
 * 빈칸은 저절로 메우지 않는다 — 놓은 자리를 그대로 둔다. [빈칸 메우기] 를 누를 때만 위로 모은다.
 * 끄는 동안에는 매번 처음 자리에서 다시 계산해서, 비켜 갔던 위젯이 손을 떼면 제자리로 돌아온다.
 */

export const GRID_COLS = 8

export interface Cell {
  x: number
  y: number
  w: number
  h: number
}

export interface Placed extends Cell {
  id: string
}

/** 위젯마다 줄이고 늘릴 수 있는 칸 수 */
export interface SizeLimit {
  minW: number
  minH: number
  maxW: number
  maxH: number
}

export function overlaps(a: Cell, b: Cell): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

const clampN = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

/** 판 안에, 크기 한도 안에 들게 맞춘다 */
export function clampCell(c: Cell, lim: SizeLimit, cols = GRID_COLS): Cell {
  const w = clampN(Math.round(c.w), lim.minW, Math.min(lim.maxW, cols))
  const h = clampN(Math.round(c.h), lim.minH, lim.maxH)
  return { w, h, x: clampN(Math.round(c.x), 0, cols - w), y: Math.max(0, Math.round(c.y)) }
}

/**
 * id 위젯을 target 에 놓고, 겹치는 위젯을 아래로 민다. 놓은 위젯은 움직이지 않는다.
 * 위로 놓인 것부터 차례로 밀어서, 밀린 위젯끼리도 겹치지 않게 한다.
 */
export function place(items: Placed[], id: string, target: Cell): Placed[] {
  const out = items.map((it) => (it.id === id ? { ...it, ...target } : { ...it }))
  const fixed = out.find((it) => it.id === id)
  if (!fixed) return out
  const queue: Placed[] = [fixed]
  let guard = 0
  while (queue.length && guard++ < 10000) {
    const cur = queue.shift()!
    for (const o of out) {
      if (o === cur || o === fixed || !overlaps(cur, o)) continue
      o.y = cur.y + cur.h
      queue.push(o)
    }
  }
  return out
}

/** 겹치는 위젯이 있으면 위에서부터 차례로 아래로 밀어 풀어 준다 (저장된 판이 깨졌을 때) */
export function untangle(items: Placed[]): Placed[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const out: Placed[] = []
  for (const it of sorted) {
    const c = { ...it }
    while (out.some((o) => overlaps(o, c))) c.y++
    out.push(c)
  }
  return items.map((it) => out.find((o) => o.id === it.id)!)
}

/** 빈칸 메우기 — 위에 있는 위젯부터 막히는 데까지 위로 올린다. 가로 자리는 그대로 */
export function compact(items: Placed[]): Placed[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const out: Placed[] = []
  for (const it of sorted) {
    const c = { ...it }
    while (c.y > 0 && !out.some((o) => overlaps(o, { ...c, y: c.y - 1 }))) c.y--
    out.push(c)
  }
  return items.map((it) => out.find((o) => o.id === it.id)!)
}

/** w×h 가 들어갈 첫 빈자리 — 위에서부터, 왼쪽부터 */
export function firstFree(items: Cell[], w: number, h: number, cols = GRID_COLS): { x: number; y: number } {
  const ww = Math.min(w, cols)
  for (let y = 0; y < 400; y++) {
    for (let x = 0; x + ww <= cols; x++) {
      if (!items.some((o) => overlaps(o, { x, y, w: ww, h }))) return { x, y }
    }
  }
  return { x: 0, y: bottomOf(items) }
}

/** 맨 아래 위젯의 아래 끝 (줄 수) */
export function bottomOf(items: Cell[]): number {
  return items.reduce((m, it) => Math.max(m, it.y + it.h), 0)
}

/** 좁은 창에서 한 줄로 쌓을 차례 — 위에서 아래로, 같은 줄이면 왼쪽부터 */
export function stackOrder<T extends Cell>(items: T[]): T[] {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x)
}

/**
 * 끄는 중인 화면 좌표(px)를 칸 자리로 바꾼다.
 * left/top 은 판 왼쪽 위에서 잰 위젯의 왼쪽 위, cellW 는 칸 너비, rowH 는 줄 높이, gap 은 칸 사이.
 */
export function toCell(left: number, top: number, cellW: number, rowH: number, gap: number): { x: number; y: number } {
  return { x: Math.round(left / (cellW + gap)), y: Math.round(top / (rowH + gap)) }
}

/** 크기를 바꾸는 손잡이 */
export type Edge = 'n' | 's' | 'e' | 'w' | 'se'

/** 손잡이를 dx, dy 칸만큼 끌었을 때의 자리 (한도 안으로) */
export function resizeCell(c: Cell, edge: Edge, dx: number, dy: number, lim: SizeLimit, cols = GRID_COLS): Cell {
  let { x, y, w, h } = c
  if (edge === 'e' || edge === 'se') w = clampN(c.w + dx, lim.minW, Math.min(lim.maxW, cols - c.x))
  if (edge === 's' || edge === 'se') h = clampN(c.h + dy, lim.minH, lim.maxH)
  if (edge === 'w') {
    const nw = clampN(c.w - dx, lim.minW, Math.min(lim.maxW, c.x + c.w))
    x = c.x + c.w - nw
    w = nw
  }
  if (edge === 'n') {
    const nh = clampN(c.h - dy, lim.minH, Math.min(lim.maxH, c.y + c.h))
    y = c.y + c.h - nh
    h = nh
  }
  return { x, y, w, h }
}
