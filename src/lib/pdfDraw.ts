import type { Mat, PeNumbers, PeObj, PeWatermark, Rot } from '../../shared/pdfedit'
import { FRAME_KINDS, frameOf, mul, numberAnchor, numberText, pageToViewMat, scale, viewSize, watermarkMat } from '../../shared/pdfedit'

/**
 * PDF 편집 — 그린 것을 캔버스에 그린다. 화면에 보이는 것 · 완전 가리기 쪽 그림 · 저장할 글 그림이 모두 이 함수로 그려진다
 * (보이는 대로 저장되게). 선 · 네모 · 형광펜은 저장할 때 메인이 PDF 선으로 똑같이 다시 그린다.
 */

export const TEXT_FONT = "'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif"
export const LINE_H = 1.25
/** 덮개 안쪽 여백 pt */
export const COVER_PAD = 3

export interface Asset {
  bytes: Uint8Array
  type: 'png' | 'jpeg'
  w: number
  h: number
  img: HTMLImageElement
}

const font = (size: number): string => `${size}px ${TEXT_FONT}`

export async function fontsReady(objs: PeObj[]): Promise<void> {
  const texts = objs.filter((o) => (o.kind === 'text' || o.kind === 'cover') && o.text)
  if (!texts.length || !document.fonts?.load) return
  await Promise.all(texts.map((o) => document.fonts.load(font(o.size ?? 12), o.text).catch(() => undefined)))
}

let measureCtx: CanvasRenderingContext2D | null = null
/** 글의 크기 pt (그린 틀 = 글에 꼭 맞게) */
export function measureText(text: string, size: number): { w: number; h: number } {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  const c = measureCtx!
  c.font = font(size)
  const lines = text.split('\n')
  const w = Math.max(size * 0.6, ...lines.map((l) => c.measureText(l).width)) + size * 0.15
  return { w, h: lines.length * size * LINE_H }
}

function drawLines(ctx: CanvasRenderingContext2D, text: string, size: number, color: string, x: number, y: number): void {
  ctx.font = font(size)
  ctx.fillStyle = color
  ctx.textBaseline = 'top'
  text.split('\n').forEach((line, i) => ctx.fillText(line, x, y + i * size * LINE_H + size * (LINE_H - 1) * 0.5))
}

/** 바로 선 틀 안(0,0 ~ cw,ch pt)에 글 · 덮개 · 그림을 그린다 */
export function drawFrameContent(ctx: CanvasRenderingContext2D, o: PeObj, cw: number, ch: number, assets: Map<string, Asset>): void {
  if (o.kind === 'image') {
    const a = o.asset ? assets.get(o.asset) : undefined
    if (a?.img.complete) ctx.drawImage(a.img, 0, 0, cw, ch)
    return
  }
  if (o.kind === 'cover') {
    ctx.fillStyle = o.fill ?? '#ffffff'
    ctx.fillRect(0, 0, cw, ch)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, cw, ch)
    ctx.clip()
    if (o.text) drawLines(ctx, o.text, o.size ?? 12, o.color ?? '#000000', COVER_PAD, COVER_PAD)
    ctx.restore()
    return
  }
  if (o.kind === 'text' && o.text) drawLines(ctx, o.text, o.size ?? 12, o.color ?? '#000000', 0, 0)
}

const setM = (ctx: CanvasRenderingContext2D, M: Mat): void => ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5])

/**
 * 한 쪽의 그린 것 모두. base 는 캔버스의 처음 행렬(보통 단위), k 는 보기 1pt 당 픽셀.
 * 완전 가리기는 늘 맨 위에 그린다.
 */
export function drawObjects(ctx: CanvasRenderingContext2D, objs: PeObj[], w: number, h: number, r: Rot, k: number, assets: Map<string, Asset>, skip?: string): void {
  const P = mul(scale(k), pageToViewMat(w, h, r))
  const list = [...objs.filter((o) => o.kind !== 'redact'), ...objs.filter((o) => o.kind === 'redact')]
  for (const o of list) {
    if (o.id === skip) continue
    ctx.save()
    if (FRAME_KINDS.includes(o.kind)) {
      const f = frameOf(o, o.turn ?? 0, w, h)
      setM(ctx, mul(P, f.m))
      drawFrameContent(ctx, o, f.cw, f.ch, assets)
    } else {
      setM(ctx, P)
      const x = o.x * w
      const y = o.y * h
      if (o.kind === 'rect') {
        ctx.strokeStyle = o.color ?? '#000'
        ctx.lineWidth = o.width ?? 2
        ctx.lineJoin = 'miter'
        ctx.strokeRect(x, y, o.w * w, o.h * h)
      } else if (o.kind === 'highlight') {
        ctx.globalAlpha = 0.35
        ctx.globalCompositeOperation = 'multiply'
        ctx.fillStyle = o.color ?? '#ffe14d'
        ctx.fillRect(x, y, o.w * w, o.h * h)
      } else if (o.kind === 'redact') {
        ctx.fillStyle = '#000000'
        ctx.fillRect(x, y, o.w * w, o.h * h)
      } else if ((o.kind === 'line' || o.kind === 'pen') && o.pts && o.pts.length > 1) {
        ctx.strokeStyle = o.color ?? '#000'
        ctx.lineWidth = o.width ?? 2
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(o.pts[0][0] * w, o.pts[0][1] * h)
        for (const [px, py] of o.pts.slice(1)) ctx.lineTo(px * w, py * h)
        ctx.stroke()
      }
    }
    ctx.restore()
  }
}

/* ---------- 문서 전체: 쪽 번호 · 워터마크 (미리 보기 — 저장은 메인이 같은 자리에) ---------- */

const wmCache = new Map<string, { canvas: HTMLCanvasElement; png: Promise<Uint8Array> }>()

/** 워터마크 글 그림 — 투명 바탕에 고른 색 글자 */
export function watermarkImage(wm: PeWatermark): { canvas: HTMLCanvasElement; png: Promise<Uint8Array> } {
  const key = `${wm.text}|${wm.color}`
  const hit = wmCache.get(key)
  if (hit) return hit
  const size = 160
  const m = measureText(wm.text, size)
  const c = document.createElement('canvas')
  c.width = Math.min(4000, Math.ceil(m.w + size * 0.3))
  c.height = Math.ceil(size * 1.35)
  const ctx = c.getContext('2d')!
  ctx.font = `700 ${size}px ${TEXT_FONT}`
  ctx.fillStyle = wm.color
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(wm.text, c.width / 2, c.height / 2, c.width - 4)
  const v = { canvas: c, png: canvasBytes(c, 'image/png') }
  wmCache.clear()
  wmCache.set(key, v)
  return v
}

export async function warmWatermarkFont(wm: PeWatermark | null): Promise<void> {
  if (wm?.text && document.fonts?.load) await document.fonts.load(`700 160px ${TEXT_FONT}`, wm.text).catch(() => undefined)
}

export function drawDecorations(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  r: Rot,
  k: number,
  pageNo: number,
  total: number,
  numbers: PeNumbers | null,
  wm: PeWatermark | null
): void {
  const [vw, vh] = viewSize(w, h, r)
  if (wm) {
    const im = watermarkImage(wm).canvas
    ctx.save()
    ctx.globalAlpha = wm.opacity
    setM(ctx, mul(scale(k), watermarkMat(vw, vh, im.width, im.height, wm.scale)))
    ctx.drawImage(im, 0, 0, 1, 1)
    ctx.restore()
  }
  if (numbers) {
    const text = numberText(numbers.start + pageNo, numbers.start + total - 1, numbers.style)
    const [ax, ay] = numberAnchor(vw, vh, numbers)
    ctx.save()
    setM(ctx, scale(k))
    ctx.font = `${numbers.size}px Helvetica, Arial, sans-serif`
    ctx.fillStyle = '#333333'
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = numbers.pos === 'right' ? 'right' : 'center'
    ctx.fillText(text, ax, ay)
    ctx.restore()
  }
}

export function canvasBytes(c: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    c.toBlob(
      (b) => {
        if (!b) return reject(new Error('그림을 만들지 못했습니다.'))
        void b.arrayBuffer().then((ab) => resolve(new Uint8Array(ab)), reject)
      },
      type,
      quality
    )
  })
}

/** 넣을 그림 — 화면에서 다시 그려 저장한다(휴대폰 사진의 돌림 표시 반영 · 위치 정보 같은 숨은 정보 제거 · 너무 크면 줄임) */
export async function normalizeImage(bytes: Uint8Array): Promise<Asset> {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50
  // blob: 주소는 보안 규칙에 막히므로 바로 읽는다
  const bmp = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: isPng ? 'image/png' : 'image/jpeg' }), { imageOrientation: 'from-image' })
  const MAX = 2400
  const s = Math.min(1, MAX / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bmp.width * s))
  c.height = Math.max(1, Math.round(bmp.height * s))
  const ctx = c.getContext('2d')!
  if (!isPng) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
  }
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  const type = isPng ? 'png' : 'jpeg'
  const out = await canvasBytes(c, isPng ? 'image/png' : 'image/jpeg', 0.92)
  return { bytes: out, type, w: c.width, h: c.height, img: await loadImg(c.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.92)) }
}

export function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('그림을 읽지 못했습니다.'))
    img.src = url
  })
}
