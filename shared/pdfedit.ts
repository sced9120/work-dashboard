/**
 * PDF 편집 — 쪽 정리(차례 · 돌리기 · 지우기 · 복제 · 빈 쪽 · 합치기 · 뽑기)와 내용 더하기(글 · 형광펜 · 네모 · 선 · 펜 · 그림 · 덮고 새로 쓰기 · 완전 가리기).
 * 화면(src/pages/PdfEdit.tsx)과 메인(electron/main/pdfedit.ts)이 함께 쓰는 약속 · 좌표 계산 · 저장 계획 검사.
 * 모두 이 PC 안에서 한다. 원본 PDF 는 바꾸지 않고 늘 새 파일로 저장한다.
 *
 * 좌표 — 세 가지를 쓴다.
 *  - 쪽 좌표: 쪽의 보이는 네모(CropBox ∩ MediaBox, pdf.js 의 page.view 와 같다)를 돌리지 않은 채로,
 *    왼쪽 위가 (0,0) 이고 아래로 갈수록 y 가 커진다. 단위는 pt. 그린 것은 0~1 로 나눈 값(정규화)으로 둔다 —
 *    쪽을 나중에 돌려도 그린 것이 쪽 내용에 붙어 같이 돈다.
 *  - 보기 좌표: 쪽을 R 도(시계 방향, /Rotate + 사용자가 돌린 것) 돌려 화면에 보이는 그대로. 왼쪽 위 (0,0), 아래로 +y, pt.
 *  - PDF 좌표: 파일 속 사용자 공간(왼쪽 아래가 원점, 위로 +y).
 * 행렬은 PDF 와 같은 [a b c d e f] (x' = a·x + c·y + e, y' = b·x + d·y + f).
 */

export type Rot = 0 | 90 | 180 | 270
export type Mat = [number, number, number, number, number, number]
/** [x0, y0, x1, y1] — PDF 좌표, x0<x1 · y0<y1 */
export type Box = [number, number, number, number]

/* ---------- 한도 ---------- */

export const PE_MAX_FILES = 30
export const PE_MAX_PAGES = 500
export const PE_MAX_FILE_BYTES = 150 * 1024 * 1024
export const PE_MAX_TOTAL_BYTES = 400 * 1024 * 1024
export const PE_MAX_OBJS = 300
export const PE_MAX_TEXT = 2000
export const PE_MAX_PTS = 6000
export const PE_MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const PE_MAX_RASTER_BYTES = 15 * 1024 * 1024
/** 저장 한 번에 받는 그림 바이트 합 */
export const PE_MAX_JOB_BYTES = 900 * 1024 * 1024
/** 완전 가리기 — 쪽을 그림으로 바꿀 때의 해상도(점/인치)와 가장 큰 변 */
export const PE_RASTER_DPI = 200
export const PE_RASTER_MAX_SIDE = 6000
export const PE_RASTER_MAX_AREA = 36_000_000
/** 글 · 덮개를 그림으로 만들 때의 해상도 */
export const PE_TEXT_DPI = 300
export const PE_TEXT_MAX_SIDE = 4096

/* ---------- 파일 ---------- */

export interface PePageInfo {
  /** 보이는 네모의 너비 · 높이 (pt, 돌리기 전) */
  w: number
  h: number
  /** 파일에 적힌 /Rotate (0 · 90 · 180 · 270 으로 고친 값) */
  rotate: Rot
}

export interface PeFile {
  /** 이번 실행에서만 쓰는 번호 (경로는 화면에 넘기지 않는다) */
  id: string
  name: string
  size: number
  pages: PePageInfo[]
}

export interface PeOpened extends PeFile {
  /** 화면에서 그리는 데 쓰는 파일 내용 */
  bytes: Uint8Array
}

export interface PeOpen {
  ok: boolean
  files: PeOpened[]
  /** 열지 못한 파일과 까닭 */
  failed: { name: string; error: string }[]
  error?: string
}

/* ---------- 그린 것 ---------- */

export type PeKind = 'text' | 'cover' | 'image' | 'rect' | 'highlight' | 'line' | 'pen' | 'redact'

export const PE_KIND_LABEL: Record<PeKind, string> = {
  text: '글자',
  cover: '덮고 새로 쓰기',
  image: '그림',
  rect: '네모',
  highlight: '형광펜',
  line: '선',
  pen: '펜',
  redact: '완전 가리기'
}

/** 글 · 덮개 · 그림 — 쪽을 돌려도 내용이 쪽과 함께 도는 것 */
export const FRAME_KINDS: PeKind[] = ['text', 'cover', 'image']

export interface PeObj {
  id: string
  kind: PeKind
  /** 쪽 좌표(0~1)의 네모 — 선 · 펜은 점들을 감싸는 네모 */
  x: number
  y: number
  w: number
  h: number
  /** 만들 때 보던 돌림(R). 내용(글 · 그림)은 이 돌림에서 바로 서 보인다 */
  turn?: Rot
  text?: string
  /** 글자 크기 pt */
  size?: number
  /** '#rrggbb' — 글 · 선 색 */
  color?: string
  /** 덮개 바탕색 */
  fill?: string
  /** 선 굵기 pt */
  width?: number
  /** 선 · 펜 — 쪽 좌표(0~1)의 점들 */
  pts?: [number, number][]
  /** 그림 — 화면이 가진 그림 번호 */
  asset?: string
}

export type PeNumberStyle = 'plain' | 'dash' | 'total'
export interface PeNumbers {
  style: PeNumberStyle
  pos: 'center' | 'right'
  /** 글자 크기 pt */
  size: number
  /** 첫 번호 */
  start: number
}

export interface PeWatermark {
  text: string
  /** 쪽 짧은 변에 대한 크기 */
  scale: number
  /** 진하기 0.05~0.6 */
  opacity: number
  color: string
}

/* ---------- 저장 계획 ---------- */

export interface PePlanPage {
  /** 원본 쪽 — 없으면 빈 쪽 */
  file?: string
  index?: number
  /** 빈 쪽 크기 pt */
  blank?: { w: number; h: number }
  /** 사용자가 더 돌린 것 */
  rot: Rot
  objs: PeObj[]
}

export interface PePlan {
  /** all: 전체 저장 · part: 고른 쪽만 */
  mode: 'all' | 'part'
  pages: PePlanPage[]
  numbers: PeNumbers | null
  watermark: PeWatermark | null
}

export interface PeBegin {
  ok: boolean
  error?: string
  job?: string
  /** 완전 가리기가 있어 모든 쪽을 그림으로 보내야 한다 */
  raster?: boolean
  /** 보내야 할 그림들 */
  need?: PeNeed[]
}

/**
 * 화면이 만들어 보낼 그림
 *  - frame: 글 · 덮개(png) 또는 넣은 그림(png · jpeg) — 그림만 저장할 때
 *  - raster: 쪽 전체 그림(jpeg) — 완전 가리기가 있을 때
 *  - watermark: 워터마크 글 그림(png)
 */
export interface PeNeed {
  key: string
  kind: 'frame' | 'raster' | 'watermark'
  page?: number
  obj?: number
}

export interface PeSaved {
  ok: boolean
  error?: string
  /** 저장한 파일 · 폴더 이름 */
  name?: string
  folder?: string
  pages?: number
  raster?: boolean
  notes?: string[]
}

/* ---------- 쪽 상자 · 돌림 ---------- */

export function normRotate(v: unknown): Rot {
  let r = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0
  if (r % 90 !== 0) return 0
  r = ((r % 360) + 360) % 360
  return r as Rot
}

export const addRot = (a: Rot, b: number): Rot => normRotate(a + b)

/** 숫자 넷이면 고쳐 쓴 네모, 아니면 null (pdf.js lookupNormalRect 와 같다) */
export function normRect(v: unknown): Box | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const [a, b, c, d] = v as number[]
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]
}

const LETTER: Box = [0, 0, 612, 792]

/** 보이는 네모 — pdf.js 의 page.view 와 똑같이 정한다 (빈 네모는 없는 것으로) */
export function effectiveBox(media: unknown, crop: unknown): Box {
  const ok = (b: Box | null): Box | null => (b && b[2] - b[0] > 0 && b[3] - b[1] > 0 ? b : null)
  const m = ok(normRect(media)) ?? LETTER
  const c = ok(normRect(crop))
  if (!c || c.every((n, i) => n === m[i])) return m
  const x = [Math.max(c[0], m[0]), Math.max(c[1], m[1]), Math.min(c[2], m[2]), Math.min(c[3], m[3])] as Box
  return x[2] - x[0] > 0 && x[3] - x[1] > 0 ? x : m
}

/** 돌린 뒤 보이는 크기 */
export const viewSize = (w: number, h: number, r: Rot): [number, number] => (r === 90 || r === 270 ? [h, w] : [w, h])

/* ---------- 행렬 ---------- */

export const IDENT: Mat = [1, 0, 0, 1, 0, 0]

/** A∘B — B 를 먼저 하고 A 를 한다 */
export function mul(A: Mat, B: Mat): Mat {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5]
  ]
}

export const apply = (M: Mat, x: number, y: number): [number, number] => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]

export function invert(M: Mat): Mat {
  const det = M[0] * M[3] - M[1] * M[2]
  if (!det) return [...IDENT]
  const a = M[3] / det
  const b = -M[1] / det
  const c = -M[2] / det
  const d = M[0] / det
  return [a, b, c, d, -(a * M[4] + c * M[5]), -(b * M[4] + d * M[5])]
}

export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y]
export const scale = (sx: number, sy = sx): Mat => [sx, 0, 0, sy, 0, 0]

/** 쪽 좌표(pt) → 보기 좌표(pt), 시계 방향 R 도 */
export function pageToViewMat(w: number, h: number, r: Rot): Mat {
  switch (r) {
    case 90:
      return [0, 1, -1, 0, h, 0]
    case 180:
      return [-1, 0, 0, -1, w, h]
    case 270:
      return [0, -1, 1, 0, 0, w]
    default:
      return [1, 0, 0, 1, 0, 0]
  }
}

/** 쪽 좌표(pt) → PDF 좌표 */
export const pageToPdfMat = (box: Box): Mat => [1, 0, 0, -1, box[0], box[3]]

/** 보기 좌표(pt) → PDF 좌표 — pdf.js viewport(scale 1) 의 거꾸로와 같다 */
export function viewToPdfMat(box: Box, r: Rot): Mat {
  return mul(pageToPdfMat(box), invert(pageToViewMat(box[2] - box[0], box[3] - box[1], r)))
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 네모를 행렬로 옮긴 뒤 감싸는 네모 */
export function mapRect(M: Mat, r: Rect): Rect {
  const pts = [apply(M, r.x, r.y), apply(M, r.x + r.w, r.y), apply(M, r.x, r.y + r.h), apply(M, r.x + r.w, r.y + r.h)]
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** 정규화한 쪽 네모(0~1) → 쪽 pt */
export const toPt = (o: Rect, w: number, h: number): Rect => ({ x: o.x * w, y: o.y * h, w: o.w * w, h: o.h * h })
export const fromPt = (r: Rect, w: number, h: number): Rect => ({ x: r.x / w, y: r.y / h, w: r.w / w, h: r.h / h })

/** 쪽 네모(0~1) → 보기 네모(pt) */
export const objToView = (o: Rect, w: number, h: number, r: Rot): Rect => mapRect(pageToViewMat(w, h, r), toPt(o, w, h))
/** 보기 네모(pt) → 쪽 네모(0~1) */
export const viewToObj = (v: Rect, w: number, h: number, r: Rot): Rect => fromPt(mapRect(invert(pageToViewMat(w, h, r)), v), w, h)

/**
 * 글 · 덮개 · 그림의 바로 선 틀. 돌림 turn 의 보기에서 바로 서 보이는 네모(cw × ch pt)를 쪽에 놓는 행렬
 * (틀 안 좌표 pt, 왼쪽 위 원점 · 아래로 +y → 쪽 pt).
 */
export function frameOf(o: Rect, turn: Rot, w: number, h: number): { m: Mat; cw: number; ch: number } {
  const V = pageToViewMat(w, h, turn)
  const r = mapRect(V, toPt(o, w, h))
  return { m: mul(invert(V), translate(r.x, r.y)), cw: r.w, ch: r.h }
}

/** 틀 안 단위 네모(0~1, 아래로 +y) → 쪽 pt */
export function frameUnit(o: Rect, turn: Rot, w: number, h: number): Mat {
  const f = frameOf(o, turn, w, h)
  return mul(f.m, scale(f.cw, f.ch))
}

/** 그림(1×1, PDF 는 위로 +y)을 단위 네모(아래로 +y)로 — PDF 에 그림을 놓을 때 마지막에 붙인다 */
export const FLIP_UNIT: Mat = [1, 0, 0, -1, 0, 1]

/** 쪽 번호 글 */
export function numberText(n: number, total: number, style: PeNumberStyle): string {
  if (style === 'dash') return `- ${n} -`
  if (style === 'total') return `${n} / ${total}`
  return String(n)
}

/** 쪽 번호 글의 기준점(보기 pt, 글줄 바닥) — 가운데 맞춤이면 글 가운데, 오른쪽이면 글 끝 */
export function numberAnchor(vw: number, vh: number, n: PeNumbers): [number, number] {
  const margin = Math.max(18, Math.min(36, vh * 0.04))
  return [n.pos === 'right' ? vw - margin * 1.2 : vw / 2, vh - margin]
}

/** 워터마크 그림(단위 네모, 아래로 +y)을 보기 pt 로 — 가운데에 왼쪽 아래에서 오른쪽 위로 비스듬히 */
export function watermarkMat(vw: number, vh: number, imgW: number, imgH: number, s: number): Mat {
  const L = Math.max(10, Math.min(vw, vh) * s * 1.25)
  const H = (L * imgH) / Math.max(1, imgW)
  const c = Math.SQRT1_2
  const rot: Mat = [c, -c, c, c, 0, 0]
  return mul(translate(vw / 2, vh / 2), mul(rot, mul(translate(-L / 2, -H / 2), scale(L, H))))
}

/* ---------- 그린 것 다루기 ---------- */

const clamp = (n: number, a: number, b: number): number => Math.min(b, Math.max(a, n))

/** 선 · 펜의 점들을 감싸는 네모를 다시 잰다 */
export function fitPts(o: PeObj): PeObj {
  if (!o.pts?.length) return o
  const xs = o.pts.map((p) => p[0])
  const ys = o.pts.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { ...o, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** 옮기기 (쪽 좌표 0~1 만큼) */
export function moveObj(o: PeObj, dx: number, dy: number): PeObj {
  return { ...o, x: o.x + dx, y: o.y + dy, ...(o.pts ? { pts: o.pts.map(([px, py]) => [px + dx, py + dy] as [number, number]) } : {}) }
}

/** 새 네모에 맞춰 늘이기 · 줄이기 (선 · 펜은 점을 함께, 글은 글자 크기를 함께) */
export function resizeObj(o: PeObj, to: Rect): PeObj {
  const sx = o.w > 0 ? to.w / o.w : 1
  const sy = o.h > 0 ? to.h / o.h : 1
  const next: PeObj = { ...o, ...to }
  if (o.pts) next.pts = o.pts.map(([px, py]) => [to.x + (px - o.x) * sx, to.y + (py - o.y) * sy] as [number, number])
  return next
}

const HEX = /^#[0-9a-f]{6}$/i
const num = (v: unknown, a: number, b: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, a, b) : d)

/** 화면에서 온 그린 것을 검사해 쓸 수 있는 것만 남긴다 */
export function cleanObj(v: unknown): PeObj | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const kind = o.kind as PeKind
  if (!Object.prototype.hasOwnProperty.call(PE_KIND_LABEL, kind)) return null
  const pts =
    kind === 'line' || kind === 'pen'
      ? (Array.isArray(o.pts) ? o.pts : [])
          .slice(0, PE_MAX_PTS)
          .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)))
          .map(([a, b]) => [clamp(a, -1, 2), clamp(b, -1, 2)] as [number, number])
      : undefined
  if (pts && pts.length < 2) return null
  const base: PeObj = {
    id: typeof o.id === 'string' ? o.id.slice(0, 64) : '',
    kind,
    x: num(o.x, -1, 2, 0),
    y: num(o.y, -1, 2, 0),
    w: num(o.w, 0, 3, 0),
    h: num(o.h, 0, 3, 0)
  }
  const color = typeof o.color === 'string' && HEX.test(o.color) ? o.color.toLowerCase() : '#000000'
  switch (kind) {
    case 'text':
    case 'cover': {
      const text = typeof o.text === 'string' ? o.text.slice(0, PE_MAX_TEXT) : ''
      if (kind === 'text' && !text.trim()) return null
      const fill = typeof o.fill === 'string' && HEX.test(o.fill) ? o.fill.toLowerCase() : '#ffffff'
      return { ...base, turn: normRotate(o.turn), text, size: num(o.size, 4, 200, 12), color, ...(kind === 'cover' ? { fill } : {}) }
    }
    case 'image':
      return typeof o.asset === 'string' && o.asset ? { ...base, turn: normRotate(o.turn), asset: o.asset.slice(0, 64) } : null
    case 'rect':
      return { ...base, color, width: num(o.width, 0.25, 40, 2) }
    case 'highlight':
      return { ...base, color: typeof o.color === 'string' && HEX.test(o.color) ? o.color.toLowerCase() : '#ffe14d' }
    case 'redact':
      return base
    case 'line':
    case 'pen':
      return fitPts({ ...base, color, width: num(o.width, 0.25, 40, 2), pts })
  }
  return null
}

/** 크기가 없는(점 하나 같은) 것은 저장하지 않는다 — 선 · 펜은 한쪽 길이만 있어도 된다 */
export const visibleObj = (o: PeObj): boolean => (o.kind === 'line' || o.kind === 'pen' ? o.w + o.h > 1e-4 : o.w > 1e-4 && o.h > 1e-4)

/* ---------- 저장 계획 검사 ---------- */

export interface PlanSource {
  pages: PePageInfo[]
}

export type PlanCheck = { ok: true; plan: PePlan; raster: boolean; need: PeNeed[] } | { ok: false; error: string }

/**
 * 화면이 보낸 저장 계획을 검사한다 — 번호 · 쪽 차례 · 크기 · 수 · 색. 쓸 수 없는 그린 것은 뺀다.
 * 완전 가리기가 하나라도 있으면 raster(모든 쪽을 그림으로).
 */
export function checkPlan(input: unknown, sources: Map<string, PlanSource>): PlanCheck {
  const p = (input ?? {}) as Partial<PePlan>
  const list = Array.isArray(p.pages) ? p.pages : []
  if (!list.length) return { ok: false, error: '저장할 쪽이 없습니다.' }
  if (list.length > PE_MAX_PAGES) return { ok: false, error: `한 번에 ${PE_MAX_PAGES}쪽까지 저장할 수 있습니다.` }
  const pages: PePlanPage[] = []
  for (const raw of list) {
    const q = (raw ?? {}) as Partial<PePlanPage>
    const rot = normRotate(q.rot)
    const objsIn = Array.isArray(q.objs) ? q.objs : []
    if (objsIn.length > PE_MAX_OBJS) return { ok: false, error: `한 쪽에 ${PE_MAX_OBJS}개까지 그릴 수 있습니다.` }
    const objs = objsIn.map(cleanObj).filter((o): o is PeObj => !!o && visibleObj(o))
    if (typeof q.file === 'string') {
      const src = sources.get(q.file)
      const i = q.index
      if (!src || typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= src.pages.length) return { ok: false, error: '열었던 PDF 를 찾지 못했습니다. 파일을 다시 열어 주세요.' }
      pages.push({ file: q.file, index: i, rot, objs })
    } else {
      const b = q.blank
      const w = b && typeof b.w === 'number' && Number.isFinite(b.w) ? b.w : NaN
      const h = b && typeof b.h === 'number' && Number.isFinite(b.h) ? b.h : NaN
      if (!(w >= 36 && w <= 5000 && h >= 36 && h <= 5000)) return { ok: false, error: '빈 쪽의 크기가 맞지 않습니다.' }
      pages.push({ blank: { w, h }, rot, objs })
    }
  }
  const n = p.numbers
  const numbers: PeNumbers | null =
    n && typeof n === 'object'
      ? {
          style: n.style === 'dash' || n.style === 'total' ? n.style : 'plain',
          pos: n.pos === 'right' ? 'right' : 'center',
          size: num(n.size, 6, 36, 11),
          start: Math.trunc(num(n.start, 1, 9999, 1))
        }
      : null
  const wm = p.watermark
  const watermark: PeWatermark | null =
    wm && typeof wm === 'object' && typeof wm.text === 'string' && wm.text.trim()
      ? {
          text: wm.text.trim().slice(0, 60),
          scale: num(wm.scale, 0.2, 1.2, 0.7),
          opacity: num(wm.opacity, 0.05, 0.6, 0.18),
          color: typeof wm.color === 'string' && HEX.test(wm.color) ? wm.color.toLowerCase() : '#888888'
        }
      : null
  const plan: PePlan = { mode: p.mode === 'part' ? 'part' : 'all', pages, numbers, watermark }
  const raster = pages.some((pg) => pg.objs.some((o) => o.kind === 'redact'))
  return { ok: true, plan, raster, need: needsOf(plan, raster) }
}

/** 화면이 만들어 보낼 그림 목록 */
export function needsOf(plan: PePlan, raster: boolean): PeNeed[] {
  const need: PeNeed[] = []
  plan.pages.forEach((pg, i) => {
    if (raster) need.push({ key: `r${i}`, kind: 'raster', page: i })
    else pg.objs.forEach((o, j) => FRAME_KINDS.includes(o.kind) && need.push({ key: `f${i}_${j}`, kind: 'frame', page: i, obj: j }))
  })
  if (plan.watermark) need.push({ key: 'wm', kind: 'watermark' })
  return need
}

/** 쪽의 보이는 크기(돌리기 전)와 모든 돌림 */
export function pageGeom(pg: PePlanPage, sources: Map<string, PlanSource>): { w: number; h: number; total: Rot; fileRot: Rot } {
  if (pg.blank) return { w: pg.blank.w, h: pg.blank.h, total: pg.rot, fileRot: 0 }
  const info = sources.get(pg.file!)!.pages[pg.index!]
  return { w: info.w, h: info.h, total: addRot(info.rotate, pg.rot), fileRot: info.rotate }
}

/** 쪽 전체 그림의 크기(px) — 200dpi, 너무 크면 줄인다 */
export function rasterSize(vw: number, vh: number): [number, number] {
  let k = PE_RASTER_DPI / 72
  k = Math.min(k, PE_RASTER_MAX_SIDE / Math.max(vw, vh), Math.sqrt(PE_RASTER_MAX_AREA / Math.max(1, vw * vh)))
  return [Math.max(1, Math.round(vw * k)), Math.max(1, Math.round(vh * k))]
}

/* ---------- 그림 파일 ---------- */

/** PNG · JPEG 의 가로 · 세로 (아니면 null) */
export function imageInfo(b: Uint8Array): { type: 'png' | 'jpeg'; w: number; h: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const u32 = (o: number): number => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]
    const w = u32(16)
    const h = u32(20)
    return w > 0 && h > 0 ? { type: 'png', w, h } : null
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let p = 2
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) return null
      const m = b[p + 1]
      if (m === 0xff) {
        p++
        continue
      }
      const len = (b[p + 2] << 8) | b[p + 3]
      if (len < 2) return null
      // SOF0~SOF15 (DHT · JPG · DAC 는 빼고)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        const h = (b[p + 5] << 8) | b[p + 6]
        const w = (b[p + 7] << 8) | b[p + 8]
        return w > 0 && h > 0 ? { type: 'jpeg', w, h } : null
      }
      if (m === 0xda) return null
      p += 2 + len
    }
  }
  return null
}

/* ---------- 이름 ---------- */

export const stemOfPdf = (name: string): string => name.replace(/\.pdf$/i, '')

/** 저장할 파일 이름(확장자 빼고) */
export function outputStem(first: string, mode: 'all' | 'part'): string {
  const stem = stemOfPdf(first).trim() || '문서'
  return `${stem}_${mode === 'part' ? '고른 쪽' : '편집'}`
}

/** 'a, b, c' 꼴의 쪽 묶음 글 (화면 안내용) — [0,1,2,5] → '1-3, 6' */
export function pageList(indexes: number[]): string {
  const s = [...new Set(indexes)].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < s.length; i++) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    out.push(j > i ? `${s[i] + 1}-${s[j] + 1}` : `${s[i] + 1}`)
    i = j
  }
  return out.join(', ')
}
