import { useSyncExternalStore } from 'react'
import type { PeFile, PeNumbers, PeObj, PeOpen, PePlan, PePlanPage, PeSaved, PeWatermark, PlanSource, Rot } from '../../shared/pdfedit'
import { FRAME_KINDS, PE_MAX_PAGES, addRot, checkPlan, frameOf, pageGeom, rasterSize, viewSize } from '../../shared/pdfedit'
import { addDoc, assetFailureCount, drawPdfPage, dropDoc, openPdf } from './pdfRender'
import { type Asset, canvasBytes, drawFrameContent, drawObjects, fontsReady, warmWatermarkFont, watermarkImage } from './pdfDraw'

/**
 * PDF 편집의 상태 — 화면 밖에 둔다. 다른 화면에 다녀와도 열어 둔 PDF · 쪽 차례 · 그린 것이 그대로 있다.
 * 파일 경로는 모른다(메인이 준 번호만). 프로그램을 끄면 사라진다(임시 사본을 남기지 않는다).
 */

export interface EdPage {
  /** 목록 안에서만 쓰는 번호 */
  key: string
  file?: string
  index?: number
  blank?: { w: number; h: number }
  /** 사용자가 더 돌린 것 */
  rot: Rot
  objs: PeObj[]
}

export interface PeState {
  files: PeFile[]
  pages: EdPage[]
  /** 크게 보는 쪽 */
  current: string | null
  /** 고른 쪽들 (쪽 작업 대상) */
  picked: string[]
  past: EdPage[][]
  future: EdPage[][]
  numbersOn: boolean
  numbers: PeNumbers
  wmOn: boolean
  watermark: PeWatermark
  busy: boolean
  progress: { done: number; total: number } | null
  result: (PeSaved & { key: string }) | null
}

const HISTORY = 60

let state: PeState = {
  files: [],
  pages: [],
  current: null,
  picked: [],
  past: [],
  future: [],
  numbersOn: false,
  numbers: { style: 'plain', pos: 'center', size: 11, start: 1 },
  wmOn: false,
  watermark: { text: '', scale: 0.7, opacity: 0.18, color: '#888888' },
  busy: false,
  progress: null,
  result: null
}
const listeners = new Set<() => void>()
const set = (patch: Partial<PeState>): void => {
  state = { ...state, ...patch }
  listeners.forEach((f) => f())
}
export const getPe = (): PeState => state

export function usePdfEdit(): PeState {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => state
  )
}

/** 넣은 그림 (서명 · 도장) — 이번 실행 동안만 */
export const assets = new Map<string, Asset>()

let seq = 0
export const newKey = (p = 'k'): string => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`

/* ---------- 파일 · 쪽 정보 ---------- */

export const fileOf = (id?: string): PeFile | undefined => (id ? state.files.find((f) => f.id === id) : undefined)

export const sourcesMap = (): Map<string, PlanSource> => new Map(state.files.map((f) => [f.id, { pages: f.pages }]))

/** 쪽의 크기(돌리기 전 pt) · 모든 돌림 */
export function geomOf(p: EdPage): { w: number; h: number; total: Rot; fileRot: Rot } {
  if (p.blank) return { w: p.blank.w, h: p.blank.h, total: p.rot, fileRot: 0 }
  const info = fileOf(p.file)?.pages[p.index!]
  if (!info) return { w: 595.28, h: 841.89, total: p.rot, fileRot: 0 }
  return { w: info.w, h: info.h, total: addRot(info.rotate, p.rot), fileRot: info.rotate }
}

export function pageLabel(p: EdPage): string {
  if (p.blank) return '빈 쪽'
  const f = fileOf(p.file)
  return f ? `${f.name} ${p.index! + 1}쪽` : ''
}

/* ---------- 바꾸기 · 되돌리기 ---------- */

/** 쪽 목록을 바꾼다 (되돌리기에 남긴다) */
function edit(pages: EdPage[], extra: Partial<PeState> = {}): void {
  set({ past: [...state.past, state.pages].slice(-HISTORY), future: [], pages, result: null, ...extra })
}

/** 끌기처럼 여러 번 바꾸는 동안은 되돌리기에 한 번만 남긴다 */
let pending: EdPage[] | null = null
export function beginChange(): void {
  pending ??= state.pages
}
export function endChange(): void {
  if (pending && pending !== state.pages) set({ past: [...state.past, pending].slice(-HISTORY), future: [] })
  pending = null
}

export function undo(): void {
  const prev = state.past[state.past.length - 1]
  if (!prev || state.busy) return
  set({ pages: prev, past: state.past.slice(0, -1), future: [state.pages, ...state.future].slice(0, HISTORY), ...keepFocus(prev) })
}
export function redo(): void {
  const next = state.future[0]
  if (!next || state.busy) return
  set({ pages: next, future: state.future.slice(1), past: [...state.past, state.pages].slice(-HISTORY), ...keepFocus(next) })
}
function keepFocus(pages: EdPage[]): Partial<PeState> {
  const keys = new Set(pages.map((p) => p.key))
  return { current: state.current && keys.has(state.current) ? state.current : (pages[0]?.key ?? null), picked: state.picked.filter((k) => keys.has(k)) }
}

/* ---------- 열기 ---------- */

/** 연 PDF 를 목록 뒤에(또는 고른 쪽 뒤에) 붙인다. 돌려주는 값: 알릴 글 */
export function addOpened(o: PeOpen, after?: string | null): string[] {
  const msgs = o.failed.map((f) => `${f.name}: ${f.error}`)
  if (!o.files.length) return msgs.length ? msgs : [o.error ?? 'PDF 를 열지 못했습니다.']
  const room = PE_MAX_PAGES - state.pages.length
  const fresh: EdPage[] = []
  const files: PeFile[] = []
  for (const f of o.files) {
    addDoc(f.id, f.bytes)
    files.push({ id: f.id, name: f.name, size: f.size, pages: f.pages })
    f.pages.forEach((_, i) => fresh.push({ key: newKey('p'), file: f.id, index: i, rot: 0, objs: [] }))
  }
  if (fresh.length > room) msgs.push(`한 번에 ${PE_MAX_PAGES}쪽까지 다룰 수 있어 뒤의 ${fresh.length - Math.max(0, room)}쪽은 넣지 않았습니다.`)
  const add = fresh.slice(0, Math.max(0, room))
  const at = after ? state.pages.findIndex((p) => p.key === after) + 1 : state.pages.length
  const pages = [...state.pages.slice(0, at || state.pages.length), ...add, ...state.pages.slice(at || state.pages.length)]
  set({ files: [...state.files, ...files] })
  edit(pages, { current: state.current ?? add[0]?.key ?? null })
  return msgs
}

export function clearAll(): void {
  if (state.busy) return
  void window.api.pdfedit.forget(state.files.map((f) => f.id))
  state.files.forEach((f) => dropDoc(f.id))
  assets.clear()
  set({ files: [], pages: [], current: null, picked: [], past: [], future: [], result: null, progress: null })
}

/* ---------- 쪽 고르기 ---------- */

export function setCurrent(key: string): void {
  set({ current: key })
}
export function setPicked(keys: string[]): void {
  set({ picked: keys })
}
export function togglePick(key: string): void {
  set({ picked: state.picked.includes(key) ? state.picked.filter((k) => k !== key) : [...state.picked, key] })
}

/** 쪽 작업 대상 — 고른 쪽이 있으면 그것, 없으면 크게 보는 쪽 */
export function targets(): string[] {
  if (state.picked.length) return state.pages.filter((p) => state.picked.includes(p.key)).map((p) => p.key)
  return state.current ? [state.current] : []
}

/* ---------- 쪽 작업 ---------- */

export function movePages(keys: string[], dir: -1 | 1): void {
  const set1 = new Set(keys)
  const pages = [...state.pages]
  const idx = pages.map((p, i) => (set1.has(p.key) ? i : -1)).filter((i) => i >= 0)
  if (!idx.length) return
  if (dir < 0 ? idx[0] === 0 : idx[idx.length - 1] === pages.length - 1) return
  const order = dir < 0 ? idx : [...idx].reverse()
  for (const i of order) [pages[i], pages[i + dir]] = [pages[i + dir], pages[i]]
  edit(pages)
}

/** 끌어 놓기 — keys 를 before 앞으로 (before 가 없으면 맨 뒤로) */
export function dropPages(keys: string[], before: string | null): void {
  const moving = state.pages.filter((p) => keys.includes(p.key))
  if (!moving.length || (before && keys.includes(before))) return
  const rest = state.pages.filter((p) => !keys.includes(p.key))
  const at = before ? rest.findIndex((p) => p.key === before) : rest.length
  const pages = [...rest.slice(0, at), ...moving, ...rest.slice(at)]
  if (pages.every((p, i) => p === state.pages[i])) return
  edit(pages)
}

export function rotatePages(keys: string[], by: 90 | -90): void {
  edit(state.pages.map((p) => (keys.includes(p.key) ? { ...p, rot: addRot(p.rot, by) } : p)))
}

export function duplicatePages(keys: string[]): void {
  if (state.pages.length + keys.length > PE_MAX_PAGES) return
  const pages: EdPage[] = []
  let last = ''
  for (const p of state.pages) {
    pages.push(p)
    if (keys.includes(p.key)) {
      const copy = { ...p, key: newKey('p'), objs: p.objs.map((o) => ({ ...o, id: newKey('o') })) }
      pages.push(copy)
      last = copy.key
    }
  }
  edit(pages, { current: last || state.current })
}

export function insertBlank(after: string | null): void {
  if (state.pages.length >= PE_MAX_PAGES) return
  const ref = state.pages.find((p) => p.key === after)
  const g = ref ? geomOf(ref) : null
  // 보이는 대로의 크기 — 옆 쪽이 가로로 보이면 빈 쪽도 가로로
  const [vw, vh] = g ? viewSize(g.w, g.h, g.total) : [595.28, 841.89]
  // 아주 크거나 작은 쪽 옆이어도 저장할 수 있는 크기로 (checkPlan 의 36~5000pt)
  const [w, h] = [vw, vh].map((v) => Math.min(5000, Math.max(36, v)))
  const blank: EdPage = { key: newKey('p'), blank: { w, h }, rot: 0, objs: [] }
  const at = ref ? state.pages.indexOf(ref) + 1 : state.pages.length
  edit([...state.pages.slice(0, at), blank, ...state.pages.slice(at)], { current: blank.key })
}

export function deletePages(keys: string[]): void {
  const pages = state.pages.filter((p) => !keys.includes(p.key))
  const i = state.pages.findIndex((p) => p.key === state.current)
  const cur = pages.find((p) => p.key === state.current)?.key ?? pages[Math.min(Math.max(0, i), pages.length - 1)]?.key ?? null
  edit(pages, { current: cur, picked: state.picked.filter((k) => !keys.includes(k)) })
}

/* ---------- 그린 것 ---------- */

function mapPage(key: string, fn: (p: EdPage) => EdPage, history: boolean): void {
  const pages = state.pages.map((p) => (p.key === key ? fn(p) : p))
  if (history) edit(pages)
  else set({ pages, result: null })
}

export function addObj(pageKey: string, o: PeObj): void {
  mapPage(pageKey, (p) => ({ ...p, objs: [...p.objs, o] }), true)
}
/** history=false 는 끌기 · 글쓰기 도중 (beginChange / endChange 로 묶는다) */
export function updateObj(pageKey: string, id: string, patch: Partial<PeObj> | ((o: PeObj) => PeObj), history = true): void {
  mapPage(pageKey, (p) => ({ ...p, objs: p.objs.map((o) => (o.id === id ? (typeof patch === 'function' ? patch(o) : { ...o, ...patch }) : o)) }), history)
}
export function removeObj(pageKey: string, id: string): void {
  mapPage(pageKey, (p) => ({ ...p, objs: p.objs.filter((o) => o.id !== id) }), true)
}

/* ---------- 문서 전체 ---------- */

export function setNumbers(on: boolean, patch: Partial<PeNumbers> = {}): void {
  set({ numbersOn: on, numbers: { ...state.numbers, ...patch }, result: null })
}
export function setWatermark(on: boolean, patch: Partial<PeWatermark> = {}): void {
  set({ wmOn: on, watermark: { ...state.watermark, ...patch }, result: null })
}

export const hasRedaction = (pages: EdPage[] = state.pages): boolean => pages.some((p) => p.objs.some((o) => o.kind === 'redact'))

/* ---------- 저장 ---------- */

export function buildPlan(mode: 'all' | 'part'): { plan: PePlan; pages: EdPage[] } {
  const pages = mode === 'part' ? state.pages.filter((p) => state.picked.includes(p.key)) : state.pages
  const plan: PePlan = {
    mode,
    pages: pages.map((p): PePlanPage => ({ ...(p.blank ? { blank: p.blank } : { file: p.file, index: p.index }), rot: p.rot, objs: p.objs })),
    numbers: state.numbersOn ? state.numbers : null,
    watermark: state.wmOn && state.watermark.text.trim() ? state.watermark : null
  }
  return { plan, pages }
}

class SaveError extends Error {}

/** 완전 가리기 — 쪽 하나를 200dpi 그림으로 (가린 칸을 검게 칠해 픽셀에 박는다) */
async function rasterPage(p: PePlanPage, docs: Map<string, Promise<import('pdfjs-dist').PDFDocumentProxy>>): Promise<Uint8Array> {
  const g = pageGeom(p, sourcesMap())
  const [vw, vh] = viewSize(g.w, g.h, g.total)
  const [pw, ph] = rasterSize(vw, vh)
  const c = document.createElement('canvas')
  try {
    if (p.file) {
      let d = docs.get(p.file)
      if (!d) {
        const b = await window.api.pdfedit.bytes(p.file)
        if (!b.ok || !b.bytes) throw new SaveError(b.error ?? '원본 PDF 를 다시 읽지 못했습니다.')
        d = openPdf(b.bytes, true)
        docs.set(p.file, d)
      }
      const before = assetFailureCount()
      try {
        await drawPdfPage(await d, p.index!, g.total, c, pw, ph)
      } catch {
        throw new SaveError(`${fileOf(p.file)?.name ?? 'PDF'} ${p.index! + 1}쪽을 그림으로 바꾸지 못해 저장하지 않았습니다. (가린 내용이 남지 않도록 멈췄습니다)`)
      }
      if (assetFailureCount() !== before) throw new SaveError('글꼴 자료를 읽지 못해 글자가 빠질 수 있어 저장하지 않았습니다.')
    } else {
      c.width = pw
      c.height = ph
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, pw, ph)
    }
    await fontsReady(p.objs)
    const ctx = c.getContext('2d')!
    drawObjects(ctx, p.objs, g.w, g.h, g.total, pw / vw, assets)
    return await canvasBytes(c, 'image/jpeg', 0.92)
  } finally {
    c.width = c.height = 0
  }
}

/** 글 · 덮개를 그림(png)으로 — 바로 선 틀 크기, 300dpi */
async function framePng(o: PeObj, w: number, h: number): Promise<Uint8Array> {
  const f = frameOf(o, o.turn ?? 0, w, h)
  const s = Math.min(300 / 72, 4096 / Math.max(f.cw, f.ch, 1))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(f.cw * s))
  c.height = Math.max(1, Math.ceil(f.ch * s))
  const ctx = c.getContext('2d')!
  ctx.scale(c.width / f.cw, c.height / f.ch)
  await fontsReady([o])
  drawFrameContent(ctx, o, f.cw, f.ch, assets)
  try {
    return await canvasBytes(c, 'image/png')
  } finally {
    c.width = c.height = 0
  }
}

export async function save(mode: 'all' | 'part'): Promise<PeSaved | null> {
  if (state.busy) return null
  const built = buildPlan(mode)
  if (!built.plan.pages.length) return { ok: false, error: mode === 'part' ? '저장할 쪽을 먼저 골라 주세요.' : '저장할 쪽이 없습니다.' }
  // 메인과 같은 검사를 먼저 해서 같은 계획(같은 차례 번호)을 쓴다
  const c = checkPlan(built.plan, sourcesMap())
  if (!c.ok) return { ok: false, error: c.error }
  const plan = c.plan
  set({ busy: true, result: null, progress: { done: 0, total: 1 } })
  let job = ''
  const docs = new Map<string, Promise<import('pdfjs-dist').PDFDocumentProxy>>()
  let result: PeSaved
  try {
    const b = await window.api.pdfedit.begin(plan)
    if (!b.ok || !b.job || !b.need) throw new SaveError(b.error ?? '저장하지 못했습니다.')
    job = b.job
    if (plan.watermark) await warmWatermarkFont(plan.watermark)
    set({ progress: { done: 0, total: b.need.length } })
    let done = 0
    for (const n of b.need) {
      let bytes: Uint8Array
      if (n.kind === 'raster') bytes = await rasterPage(plan.pages[n.page!], docs)
      else if (n.kind === 'watermark') bytes = await watermarkImage(plan.watermark!).png
      else {
        const pg = plan.pages[n.page!]
        const o = pg.objs[n.obj!]
        if (!FRAME_KINDS.includes(o.kind)) throw new SaveError('저장하지 못했습니다.')
        if (o.kind === 'image') {
          const a = o.asset ? assets.get(o.asset) : undefined
          if (!a) throw new SaveError('넣은 그림을 찾지 못했습니다. 그림을 다시 넣어 주세요.')
          bytes = a.bytes
        } else {
          const g = pageGeom(pg, sourcesMap())
          bytes = await framePng(o, g.w, g.h)
        }
      }
      const r = await window.api.pdfedit.put(job, n.key, bytes)
      if (!r.ok) throw new SaveError(r.error ?? '저장하지 못했습니다.')
      set({ progress: { done: ++done, total: b.need.length } })
    }
    result = await window.api.pdfedit.finish(job)
  } catch (e) {
    if (job) void window.api.pdfedit.abort(job)
    result = { ok: false, error: e instanceof SaveError ? e.message : '저장하지 못했습니다. 잠시 뒤 다시 해 주세요.' }
  } finally {
    for (const d of docs.values()) void d.then((x) => x.destroy()).catch(() => undefined)
  }
  set({ busy: false, progress: null, result: { ...result, key: job } })
  return result
}
