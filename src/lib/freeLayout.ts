/**
 * 홈 자유 배치 — 위젯을 창처럼 아무 데나 놓고 모서리를 끌어 크기를 바꾼다.
 * 저장은 가로를 판 너비에 대한 비율(x · w: 0~1), 세로를 픽셀(y · h)로 해서 창 너비가 바뀌어도 모양이 따라간다.
 * 겹치기를 허용하지 않으면, 옮긴 위젯은 그 자리에 두고 겹친 다른 위젯을 아래로 밀어낸다.
 */

export interface Box {
  /** 왼쪽 (판 너비에 대한 비율) */
  x: number
  /** 위 (px) */
  y: number
  /** 너비 (비율) */
  w: number
  /** 높이 (px) */
  h: number
}

export interface PxBox {
  left: number
  top: number
  width: number
  height: number
}

export const GAP = 14
export const SNAP = 10
export const MIN_W = 220
export const MIN_H = 40

const snap = (v: number): number => Math.round(v / SNAP) * SNAP

export function toPx(b: Box, W: number): PxBox {
  return { left: b.x * W, top: b.y, width: b.w * W, height: b.h }
}

/** 판 안에 들어오게 · 최소 크기 */
export function clampPx(p: PxBox, W: number): PxBox {
  const width = Math.min(W, Math.max(Math.min(MIN_W, W), p.width))
  const height = Math.max(MIN_H, p.height)
  const left = Math.min(Math.max(0, p.left), Math.max(0, W - width))
  const top = Math.max(0, p.top)
  return { left, top, width, height }
}

/** 10px 칸에 맞춰 붙이고 비율로 바꾼다. 오른쪽 끝에 거의 닿았으면 끝까지 붙인다 */
export function fromPx(p: PxBox, W: number): Box {
  const c = clampPx(p, W)
  let left = snap(c.left)
  let width = snap(c.width)
  if (W - (left + width) < SNAP * 1.5) width = W - left
  if (left < SNAP * 1.5) {
    width += left
    left = 0
  }
  return { x: W ? left / W : 0, y: snap(c.top), w: W ? Math.min(1, width / W) : 1, h: snap(c.height) }
}

export function intersects(a: PxBox, b: PxBox): boolean {
  const e = 0.5
  return a.left < b.left + b.width - e && b.left < a.left + a.width - e && a.top < b.top + b.height - e && b.top < a.top + a.height - e
}

/**
 * 겹치지 않게 — fixedId 는 그 자리에 두고, 나머지를 위에서부터 차례로 놓으며 겹치면 아래로 민다.
 */
export function settle<T extends { id: string; box: PxBox }>(items: T[], fixedId: string): T[] {
  const fixed = items.find((i) => i.id === fixedId)
  const others = items.filter((i) => i.id !== fixedId).sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)
  const placed: PxBox[] = fixed ? [fixed.box] : []
  const out = new Map<string, PxBox>()
  if (fixed) out.set(fixed.id, fixed.box)
  for (const o of others) {
    const b = { ...o.box }
    for (let guard = 0; guard < 200; guard++) {
      const hit = placed.filter((p) => intersects(p, b))
      if (!hit.length) break
      b.top = Math.max(...hit.map((p) => p.top + p.height + GAP))
    }
    placed.push(b)
    out.set(o.id, b)
  }
  return items.map((i) => ({ ...i, box: out.get(i.id) ?? i.box }))
}

/** 두 칸 벽돌 쌓기 — 넓은 위젯은 한 줄 전체, 반쪽은 낮은 쪽 칸에 차례로 */
export function masonry(items: { id: string; wide: boolean; h: number }[], W: number): Record<string, Box> {
  const half = (W - GAP) / 2
  const col = [0, 0]
  const out: Record<string, Box> = {}
  for (const it of items) {
    if (it.wide) {
      const y = Math.max(...col)
      out[it.id] = { x: 0, y, w: 1, h: it.h }
      col[0] = col[1] = y + it.h + GAP
    } else {
      const c = col[0] <= col[1] ? 0 : 1
      out[it.id] = { x: W ? (c * (half + GAP)) / W : 0, y: col[c], w: W ? half / W : 0.5, h: it.h }
      col[c] += it.h + GAP
    }
  }
  return out
}

/** 판의 높이 — 가장 아래 위젯 밑까지 */
export function boardHeight(boxes: PxBox[]): number {
  return boxes.reduce((m, b) => Math.max(m, b.top + b.height), 0) + 40
}
