/**
 * PDF 편집 — 쪽 정리 · 합치기 · 내용 더하기 · 완전 가리기. 모두 이 PC 안에서 한다.
 *
 *  - 원본은 바꾸지 않는다. 열 때 내용의 지문(sha256)을 적어 두고, 저장할 때 다시 읽어 같은지 본다. 임시 사본은 만들지 않는다.
 *  - 저장은 늘 새 파일: 첫 원본 옆의 '이름_편집.pdf' (있으면 (2) …).
 *  - 화면은 번호로만 파일을 가리킨다(경로를 넘기지 않는다). 화면이 보낸 계획 · 그림은 모두 여기서 다시 검사한다.
 *
 * 저장 두 가지
 *  1) 보통: 남길 쪽만 새 문서로 옮긴다. 옮기기 전에 원본 쪽을 손질한다 —
 *     주석은 보이는 모양을 쪽 내용에 눌러 붙이고(입력칸 값 포함) 지운다. 바깥 주소 링크만 새로 만들어 남긴다
 *     (쪽으로 가는 링크 · 책갈피 · 입력칸 묶음이 지운 쪽을 끌고 들어오지 않게).
 *     쪽의 자원(글꼴 · 그림 …)은 그 쪽 내용이 쓰는 것만 남긴다(여러 쪽이 함께 쓰는 자원 묶음에서 지운 쪽의 그림이 따라오지 않게).
 *     다 만든 뒤 어디서도 가리키지 않는 객체를 지우고, 쪽 나무 밖의 쪽 객체가 하나라도 있으면 저장하지 않는다.
 *  2) 완전 가리기가 하나라도 있으면: 원본 PDF 는 아예 읽지 않는다. 화면이 pdf.js 로 그린 쪽 그림(200dpi, 가린 칸을 검게 칠한 것)만으로
 *     새 문서를 만든다. 그래서 가린 글 · 그림 · 숨은 객체 · 책갈피 · 첨부 · 정보가 들어갈 길이 없다. 한 쪽이라도 그림이 없으면 저장하지 않는다.
 */

import { dialog, shell, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFPageLeaf,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  PDFHexString,
  StandardFonts,
  decodePDFRawStream,
  type PDFContext,
  type PDFFont,
  type PDFImage,
  type PDFObject,
  type PDFPage
} from 'pdf-lib'
import type { Box, Mat, PeBegin, PeFile, PeNeed, PeObj, PeOpen, PeOpened, PePlan, PeSaved, PlanSource, Rot } from '../../shared/pdfedit'
import {
  FLIP_UNIT,
  FRAME_KINDS,
  PE_MAX_FILE_BYTES,
  PE_MAX_FILES,
  PE_MAX_IMAGE_BYTES,
  PE_MAX_JOB_BYTES,
  PE_MAX_PAGES,
  PE_MAX_RASTER_BYTES,
  PE_MAX_TOTAL_BYTES,
  PE_TEXT_MAX_SIDE,
  apply,
  checkPlan,
  effectiveBox,
  frameUnit,
  imageInfo,
  mul,
  normRect,
  normRotate,
  numberAnchor,
  numberText,
  outputStem,
  pageGeom,
  pageToPdfMat,
  rasterSize,
  viewSize,
  viewToPdfMat,
  watermarkMat
} from '../../shared/pdfedit'
import { uniqueName } from '../../shared/convert'
import { logError } from './errlog'

interface Opened {
  path: string
  name: string
  size: number
  hash: string
  pages: PeFile['pages']
  boxes: Box[]
}

/** 이번 실행에서 연 PDF (화면은 번호로만 가리킨다) */
const opened = new Map<string, Opened>()

interface Job {
  id: string
  plan: PePlan
  raster: boolean
  need: Map<string, PeNeed>
  got: Map<string, Uint8Array>
  bytes: number
  /** 만드는 동안 쪽마다 함께 쓰는 것 */
  wmImage?: PDFImage
  font?: PDFFont
}
let job: Job | null = null
let saving = false
/** 저장한 파일 ([폴더 열기]) */
const saved = new Map<string, string>()

const sha = (b: Uint8Array): string => crypto.createHash('sha256').update(b).digest('hex')
const encrypted = (e: unknown): boolean => /encrypt/i.test(String(e))

/* ---------- 열기 ---------- */

function numsOf(ctx: PDFContext, v: PDFObject | undefined): number[] | null {
  const arr = v instanceof PDFRef ? ctx.lookup(v) : v
  if (!(arr instanceof PDFArray)) return null
  const out: number[] = []
  for (let i = 0; i < arr.size(); i++) {
    const n = arr.lookup(i)
    if (!(n instanceof PDFNumber)) return null
    out.push(n.asNumber())
  }
  return out
}

/** 쪽마다 보이는 네모와 /Rotate — pdf.js 와 같은 규칙 (shared/pdfedit.ts effectiveBox) */
export function pageBoxes(doc: PDFDocument): { boxes: Box[]; pages: PeFile['pages'] } {
  const ctx = doc.context
  const boxes: Box[] = []
  const pages: PeFile['pages'] = []
  for (const p of doc.getPages()) {
    const node = p.node
    const box = effectiveBox(numsOf(ctx, node.getInheritableAttribute(PDFName.of('MediaBox'))), numsOf(ctx, node.getInheritableAttribute(PDFName.of('CropBox'))))
    const r = node.getInheritableAttribute(PDFName.of('Rotate'))
    const rv = r instanceof PDFRef ? ctx.lookup(r) : r
    boxes.push(box)
    pages.push({ w: box[2] - box[0], h: box[3] - box[1], rotate: normRotate(rv instanceof PDFNumber ? rv.asNumber() : 0) })
  }
  return { boxes, pages }
}

async function openOne(full: string): Promise<{ file?: PeOpened; error?: string }> {
  const name = path.basename(full)
  if (!/\.pdf$/i.test(name)) return { error: 'PDF 파일이 아닙니다.' }
  let stat: fs.Stats
  try {
    stat = fs.statSync(full)
  } catch {
    return { error: '파일을 찾지 못했습니다.' }
  }
  if (!stat.isFile()) return { error: 'PDF 파일이 아닙니다.' }
  if (stat.size > PE_MAX_FILE_BYTES) return { error: `파일이 너무 큽니다(${Math.round(PE_MAX_FILE_BYTES / 1024 / 1024)}MB 까지).` }
  const used = [...opened.values()].reduce((s, o) => s + o.size, 0)
  if (used + stat.size > PE_MAX_TOTAL_BYTES) return { error: '한 번에 열 수 있는 크기를 넘었습니다. 다 쓴 파일을 목록에서 빼고 다시 열어 주세요.' }
  let bytes: Buffer
  try {
    bytes = fs.readFileSync(full)
  } catch {
    return { error: '파일을 읽지 못했습니다. 다른 프로그램이 잠갔는지 확인해 주세요.' }
  }
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (e) {
    return { error: encrypted(e) ? '암호 · 보안이 걸린 PDF 는 열 수 없습니다. 암호를 푼 PDF 로 열어 주세요.' : '읽을 수 없는 PDF 입니다. 손상되었을 수 있습니다.' }
  }
  const count = doc.getPageCount()
  if (!count) return { error: '쪽이 없는 PDF 입니다.' }
  const pagesOpen = [...opened.values()].reduce((s, o) => s + o.pages.length, 0)
  if (pagesOpen + count > PE_MAX_PAGES) return { error: `한 번에 ${PE_MAX_PAGES}쪽까지 열 수 있습니다.` }
  const { boxes, pages } = pageBoxes(doc)
  const id = crypto.randomUUID()
  opened.set(id, { path: full, name, size: stat.size, hash: sha(bytes), pages, boxes })
  return { file: { id, name, size: stat.size, pages, bytes: new Uint8Array(bytes) } }
}

export async function openPaths(input: unknown): Promise<PeOpen> {
  const paths = (Array.isArray(input) ? input : []).filter((p): p is string => typeof p === 'string' && !!p).slice(0, PE_MAX_FILES)
  const files: PeOpened[] = []
  const failed: PeOpen['failed'] = []
  for (const p of paths) {
    if (opened.size >= PE_MAX_FILES) {
      failed.push({ name: path.basename(p), error: `한 번에 ${PE_MAX_FILES}개 파일까지 열 수 있습니다.` })
      continue
    }
    const r = await openOne(path.resolve(p))
    if (r.file) files.push(r.file)
    else failed.push({ name: path.basename(p), error: r.error ?? '열지 못했습니다.' })
  }
  return { ok: files.length > 0, files, failed, ...(files.length ? {} : { error: failed[0]?.error ?? 'PDF 를 열지 못했습니다.' }) }
}

export async function pickPdfs(win: BrowserWindow | null): Promise<PeOpen | null> {
  if (!win) return null
  const res = await dialog.showOpenDialog(win, { title: '편집할 PDF 고르기', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  if (res.canceled || !res.filePaths.length) return null
  return openPaths(res.filePaths)
}

/** 목록에서 뺀 파일은 잊는다 */
export function forget(ids: unknown): void {
  for (const id of Array.isArray(ids) ? ids : []) opened.delete(String(id))
}

/** 원본을 다시 읽는다 — 연 뒤로 바뀌었으면 null */
function readSame(id: string): Buffer | null {
  const o = opened.get(id)
  if (!o) return null
  try {
    const b = fs.readFileSync(o.path)
    return sha(b) === o.hash ? b : null
  } catch {
    return null
  }
}

/** 완전 가리기 그림을 그리려고 화면이 다시 받는 내용 */
export function fileBytes(id: unknown): { ok: boolean; bytes?: Uint8Array; error?: string } {
  const b = readSame(String(id))
  if (!b) return { ok: false, error: '원본 PDF 가 연 뒤로 바뀌었거나 옮겨졌습니다. 목록을 비우고 다시 열어 주세요.' }
  return { ok: true, bytes: new Uint8Array(b) }
}

/* ---------- 넣을 그림 고르기 ---------- */

export async function pickImage(win: BrowserWindow | null): Promise<{ ok: boolean; error?: string; bytes?: Uint8Array; name?: string } | null> {
  if (!win) return null
  const res = await dialog.showOpenDialog(win, { title: '넣을 그림 고르기 (서명 · 도장 등)', properties: ['openFile'], filters: [{ name: '그림', extensions: ['png', 'jpg', 'jpeg'] }] })
  if (res.canceled || !res.filePaths[0]) return null
  try {
    const st = fs.statSync(res.filePaths[0])
    if (st.size > PE_MAX_IMAGE_BYTES) return { ok: false, error: '그림 파일이 너무 큽니다(20MB 까지).' }
    const b = fs.readFileSync(res.filePaths[0])
    if (!imageInfo(b)) return { ok: false, error: 'PNG · JPG 그림이 아닙니다.' }
    return { ok: true, bytes: new Uint8Array(b), name: path.basename(res.filePaths[0]) }
  } catch {
    return { ok: false, error: '그림을 읽지 못했습니다.' }
  }
}

/* ---------- pdf.js 가 쓰는 글꼴 자료 (한글 CID 글꼴의 cMap · 기본 글꼴) ---------- */

let pdfjsDir = ''
const assetCache = new Map<string, Uint8Array>()
const assetLists: Record<'cmap' | 'font', Set<string> | null> = { cmap: null, font: null }

export function pdfjsAsset(kind: unknown, name: unknown): Uint8Array | null {
  if ((kind !== 'cmap' && kind !== 'font') || typeof name !== 'string' || !/^[A-Za-z0-9_.+-]{1,80}$/.test(name)) return null
  try {
    if (!pdfjsDir) pdfjsDir = path.dirname(require.resolve('pdfjs-dist/package.json'))
    const dir = path.join(pdfjsDir, kind === 'cmap' ? 'cmaps' : 'standard_fonts')
    const file = kind === 'cmap' ? `${name}.bcmap` : name
    const list = (assetLists[kind] ??= new Set(fs.readdirSync(dir)))
    if (!list.has(file)) return null
    const key = `${kind}/${file}`
    let b = assetCache.get(key)
    if (!b) {
      const buf = fs.readFileSync(path.join(dir, file))
      b = new Uint8Array(buf)
      if (assetCache.size < 200) assetCache.set(key, b)
    }
    return b
  } catch (e) {
    logError('PDF 편집 글꼴 자료', e)
    return null
  }
}

/* ---------- 저장: 계획 받기 · 그림 받기 · 만들기 ---------- */

const sources = (): Map<string, PlanSource> => new Map([...opened].map(([id, o]) => [id, { pages: o.pages }]))

export function beginSave(input: unknown): PeBegin {
  if (saving) return { ok: false, error: '저장이 아직 끝나지 않았습니다.' }
  const c = checkPlan(input, sources())
  if (!c.ok) return { ok: false, error: c.error }
  job = { id: crypto.randomUUID(), plan: c.plan, raster: c.raster, need: new Map(c.need.map((n) => [n.key, n])), got: new Map(), bytes: 0 }
  return { ok: true, job: job.id, raster: c.raster, need: c.need }
}

export function putPart(jobId: unknown, key: unknown, data: unknown): { ok: boolean; error?: string } {
  if (!job || job.id !== jobId || saving) return { ok: false, error: '저장을 다시 시작해 주세요.' }
  const need = typeof key === 'string' ? job.need.get(key) : undefined
  if (!need || !(data instanceof Uint8Array)) return { ok: false, error: '받을 수 없는 그림입니다.' }
  const limit = need.kind === 'raster' ? PE_MAX_RASTER_BYTES : PE_MAX_IMAGE_BYTES
  if (data.byteLength > limit || job.bytes + data.byteLength > PE_MAX_JOB_BYTES) return { ok: false, error: '그림이 너무 커서 저장할 수 없습니다.' }
  const info = imageInfo(data)
  if (!info) return { ok: false, error: '그림을 읽지 못했습니다.' }
  if (need.kind === 'raster') {
    const g = pageGeom(job.plan.pages[need.page!], sources())
    const [vw, vh] = viewSize(g.w, g.h, g.total)
    const [ew, eh] = rasterSize(vw, vh)
    if (info.type !== 'jpeg' || Math.abs(info.w - ew) > 2 || Math.abs(info.h - eh) > 2) return { ok: false, error: '쪽 그림의 크기가 맞지 않습니다.' }
  } else {
    const obj = need.kind === 'frame' ? job.plan.pages[need.page!].objs[need.obj!] : null
    if (obj?.kind !== 'image' && info.type !== 'png') return { ok: false, error: '그림 형식이 맞지 않습니다.' }
    const max = obj?.kind === 'image' ? 10000 : PE_TEXT_MAX_SIDE
    if (info.w > max || info.h > max) return { ok: false, error: '그림이 너무 큽니다.' }
  }
  const old = job.got.get(need.key)
  job.bytes += data.byteLength - (old?.byteLength ?? 0)
  job.got.set(need.key, new Uint8Array(data))
  return { ok: true }
}

export function abortSave(jobId?: unknown): void {
  if (job && (jobId === undefined || job.id === jobId) && !saving) job = null
}

export async function finishSave(jobId: unknown): Promise<PeSaved> {
  const j = job
  if (!j || j.id !== jobId || saving) return { ok: false, error: '저장을 다시 시작해 주세요.' }
  for (const k of j.need.keys()) if (!j.got.has(k)) return { ok: false, error: j.raster ? '쪽 그림을 모두 받지 못해 저장하지 않았습니다.' : '그림을 모두 받지 못해 저장하지 않았습니다.' }
  saving = true
  try {
    const notes: string[] = []
    const doc = j.raster ? await buildRaster(j) : await buildVector(j, notes)
    collectGarbage(doc)
    assertNoStrayPages(doc)
    const bytes = await doc.save({ useObjectStreams: true })
    // 저장할 곳: 계획의 첫 원본 옆 (빈 쪽뿐이면 처음 연 파일 옆)
    const firstId = j.plan.pages.find((p) => p.file)?.file ?? [...opened.keys()][0]
    const first = firstId ? opened.get(firstId) : undefined
    if (!first) return { ok: false, error: '저장할 곳을 정하지 못했습니다. PDF 를 다시 열어 주세요.' }
    const dir = path.dirname(first.path)
    const stem = outputStem(first.name, j.plan.mode)
    const taken = new Set<string>()
    let out = ''
    for (let n = 0; n < 200; n++) {
      const name = uniqueName(taken, stem)
      const full = path.join(dir, name)
      try {
        fs.writeFileSync(full, bytes, { flag: 'wx' })
        out = full
        break
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
    }
    if (!out) return { ok: false, error: '같은 이름의 파일이 너무 많습니다.' }
    saved.set(j.id, out)
    if (j.raster) notes.unshift('완전 가리기가 있어 모든 쪽을 그림으로 저장했습니다. 새 파일에서는 글자를 고르거나 찾을 수 없습니다.')
    return { ok: true, name: path.basename(out), folder: path.basename(dir), pages: j.plan.pages.length, raster: j.raster, notes }
  } catch (e) {
    logError('PDF 편집 저장', e)
    if (e instanceof EditError) return { ok: false, error: e.message }
    return { ok: false, error: '저장하지 못했습니다. 원본이 있는 폴더에 쓸 수 있는지 확인해 주세요.' }
  } finally {
    saving = false
    if (job === j) job = null
  }
}

export function revealSaved(key: unknown): boolean {
  const f = saved.get(String(key))
  if (!f || !fs.existsSync(f)) return false
  shell.showItemInFolder(f)
  return true
}

class EditError extends Error {}

/* ---------- 완전 가리기: 쪽 그림만으로 새 문서 ---------- */

async function buildRaster(j: Job): Promise<PDFDocument> {
  const doc = await newDoc()
  const src = sources()
  for (let i = 0; i < j.plan.pages.length; i++) {
    const g = pageGeom(j.plan.pages[i], src)
    const [vw, vh] = viewSize(g.w, g.h, g.total)
    const jpg = j.got.get(`r${i}`)
    if (!jpg) throw new EditError('쪽 그림을 모두 받지 못해 저장하지 않았습니다.')
    const page = doc.addPage([vw, vh])
    const img = await doc.embedJpg(jpg)
    const ops = `q ${fmt([vw, 0, 0, vh, 0, 0])} cm /${addRes(doc.context, page.node, 'XObject', 'Pg', img.ref)} Do Q\n`
    const box: Box = [0, 0, vw, vh]
    appendContent(doc.context, page.node, ops + (await decorations(doc, page, j, i, box, 0)), false)
  }
  return doc
}

async function newDoc(): Promise<PDFDocument> {
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.setProducer('업무데스크 오르빗')
  doc.setCreator('업무데스크 오르빗 PDF 편집')
  return doc
}

/* ---------- 보통 저장: 남길 쪽만 옮기고 그린 것을 더한다 ---------- */

async function buildVector(j: Job, notes: string[]): Promise<PDFDocument> {
  const doc = await newDoc()
  const src = sources()
  const pages: (PDFPage | null)[] = j.plan.pages.map(() => null)
  // 원본마다 한 번 읽어, 그 파일에서 쓰는 쪽을 계획 차례로 한꺼번에 옮긴다(같은 쪽을 두 번 써도 자원은 한 벌)
  const byFile = new Map<string, number[]>()
  j.plan.pages.forEach((p, i) => p.file && byFile.set(p.file, [...(byFile.get(p.file) ?? []), i]))
  let lost = 0
  for (const [fileId, slots] of byFile) {
    const bytes = readSame(fileId)
    if (!bytes) throw new EditError(`'${opened.get(fileId)?.name ?? 'PDF'}' 이(가) 연 뒤로 바뀌었거나 옮겨졌습니다. 목록을 비우고 다시 열어 주세요.`)
    let sdoc: PDFDocument
    try {
      sdoc = await PDFDocument.load(bytes, { updateMetadata: false })
    } catch {
      throw new EditError('원본 PDF 를 다시 읽지 못했습니다.')
    }
    const sp = sdoc.getPages()
    const indexes = slots.map((s) => j.plan.pages[s].index!)
    for (const ix of new Set(indexes)) lost += cleanPage(sdoc.context, sp[ix].node)
    const copied = await doc.copyPages(sdoc, indexes)
    slots.forEach((s, k) => (pages[s] = copied[k]))
  }
  for (let i = 0; i < j.plan.pages.length; i++) {
    const pg = j.plan.pages[i]
    const g = pageGeom(pg, src)
    let page = pages[i]
    let box: Box
    if (page) {
      doc.addPage(page)
      box = opened.get(pg.file!)!.boxes[pg.index!]
      if (pg.rot) page.node.set(PDFName.of('Rotate'), PDFNumber.of(g.total))
    } else {
      page = doc.addPage([g.w, g.h])
      box = [0, 0, g.w, g.h]
      if (g.total) page.node.set(PDFName.of('Rotate'), PDFNumber.of(g.total))
    }
    const ops = (await drawObjects(doc, page, j, i, box)) + (await decorations(doc, page, j, i, box, g.total))
    if (ops) appendContent(doc.context, page.node, ops, true)
  }
  if (lost) notes.push(`입력칸 ${lost}개는 값의 모양이 파일에 없어 저장되지 않았을 수 있습니다. 새 파일을 열어 확인해 주세요.`)
  return doc
}

const num = (n: number): string => (Math.abs(n) < 1e-9 ? '0' : String(Math.round(n * 10000) / 10000))
const fmt = (m: Mat | number[]): string => m.map(num).join(' ')
const rgb = (hex: string): string => {
  const v = parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => num(c / 255)).join(' ')
}

/** 쪽 자원 묶음에 하나 더 넣고 이름을 돌려준다 (쪽마다 따로 가진 묶음에 — cleanPage / 새 쪽) */
function addRes(ctx: PDFContext, node: PDFPageLeaf, kind: 'XObject' | 'ExtGState' | 'Font', tag: string, ref: PDFRef): string {
  let res = ctx.lookupMaybe(node.get(PDFName.of('Resources')), PDFDict)
  if (!res) {
    res = ctx.obj({})
    node.set(PDFName.of('Resources'), res)
  }
  let sub = res.lookupMaybe(PDFName.of(kind), PDFDict)
  if (!sub) {
    sub = ctx.obj({})
    res.set(PDFName.of(kind), sub)
  }
  const key = sub.uniqueKey(tag)
  sub.set(key, ref)
  return key.asString().slice(1)
}

/** 쪽 내용 뒤에 붙인다. wrap 이면 원래 내용을 q … Q 로 감싸 그 안의 좌표 바꿈이 새 내용에 번지지 않게 한다 */
function appendContent(ctx: PDFContext, node: PDFPageLeaf, ops: string, wrap: boolean): void {
  if (!ops) return
  const refs: PDFRef[] = []
  const c = node.get(PDFName.of('Contents'))
  const cv = c instanceof PDFRef ? ctx.lookup(c) : c
  if (cv instanceof PDFArray) {
    for (let i = 0; i < cv.size(); i++) {
      const r = cv.get(i)
      if (r instanceof PDFRef) refs.push(r)
      else if (r instanceof PDFStream) refs.push(ctx.register(r))
    }
  } else if (c instanceof PDFRef && cv instanceof PDFStream) refs.push(c)
  else if (cv instanceof PDFStream) refs.push(ctx.register(cv))
  const mine = ctx.register(ctx.flateStream(ops))
  const list = wrap && refs.length ? [ctx.register(ctx.stream('q\n')), ...refs, ctx.register(ctx.stream('\nQ\n')), mine] : [...refs, mine]
  // 늘 새 배열 — 같은 쪽을 복제했을 때 내용 배열을 함께 쓰지 않게
  node.set(PDFName.of('Contents'), ctx.obj(list))
}

async function drawObjects(doc: PDFDocument, page: PDFPage, j: Job, i: number, box: Box): Promise<string> {
  const pg = j.plan.pages[i]
  const ctx = doc.context
  const w = box[2] - box[0]
  const h = box[3] - box[1]
  const P = pageToPdfMat(box)
  const pt = (x: number, y: number): string => fmt(apply(P, x * w, y * h))
  let ops = ''
  let hl = ''
  for (let k = 0; k < pg.objs.length; k++) {
    const o = pg.objs[k]
    if (FRAME_KINDS.includes(o.kind)) {
      const bytes = j.got.get(`f${i}_${k}`)
      if (!bytes) throw new EditError('그림을 모두 받지 못해 저장하지 않았습니다.')
      let img
      try {
        img = imageInfo(bytes)?.type === 'jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes)
      } catch {
        throw new EditError('넣은 그림을 읽지 못했습니다. 다른 그림으로 바꿔 주세요.')
      }
      const name = addRes(ctx, page.node, 'XObject', 'Pe', img.ref)
      const M = mul(P, mul(frameUnit(o, o.turn ?? 0, w, h), FLIP_UNIT))
      ops += `q ${fmt(M)} cm /${name} Do Q\n`
    } else if (o.kind === 'rect') {
      const [x0, y0] = apply(P, o.x * w, (o.y + o.h) * h)
      ops += `q ${rgb(o.color!)} RG ${num(o.width!)} w 0 j ${num(x0)} ${num(y0)} ${num(o.w * w)} ${num(o.h * h)} re S Q\n`
    } else if (o.kind === 'highlight') {
      hl ||= addRes(ctx, page.node, 'ExtGState', 'PeHl', ctx.register(ctx.obj({ Type: 'ExtGState', ca: 0.35, CA: 0.35, BM: 'Multiply' })))
      const [x0, y0] = apply(P, o.x * w, (o.y + o.h) * h)
      ops += `q /${hl} gs ${rgb(o.color!)} rg ${num(x0)} ${num(y0)} ${num(o.w * w)} ${num(o.h * h)} re f Q\n`
    } else if (o.kind === 'line' || o.kind === 'pen') {
      const pts = o.pts!
      ops += `q ${rgb(o.color!)} RG ${num(o.width!)} w 1 J 1 j ${pt(...pts[0])} m ${pts.slice(1).map((p) => `${pt(...p)} l`).join(' ')} S Q\n`
    } else if (o.kind === 'redact') {
      // 보통 저장에는 오지 않는다 (checkPlan 이 그림 저장으로 돌린다)
      throw new EditError('완전 가리기는 그림 저장으로만 할 수 있습니다.')
    }
  }
  return ops
}

/** 워터마크 · 쪽 번호 — 보이는 쪽(돌린 뒤) 기준으로 놓는다 */
async function decorations(doc: PDFDocument, page: PDFPage, j: Job, i: number, box: Box, total: Rot): Promise<string> {
  const ctx = doc.context
  const w = box[2] - box[0]
  const h = box[3] - box[1]
  const [vw, vh] = viewSize(w, h, total)
  const V = viewToPdfMat(box, total)
  let ops = ''
  const wm = j.plan.watermark
  if (wm) {
    const bytes = j.got.get('wm')!
    const info = imageInfo(bytes)!
    // 한 번만 넣고 모든 쪽이 함께 쓴다
    const img = (j.wmImage ??= await doc.embedPng(bytes))
    const name = addRes(ctx, page.node, 'XObject', 'PeWm', img.ref)
    const gs = addRes(ctx, page.node, 'ExtGState', 'PeWa', ctx.register(ctx.obj({ Type: 'ExtGState', ca: wm.opacity, CA: wm.opacity })))
    const M = mul(V, mul(watermarkMat(vw, vh, info.w, info.h, wm.scale), FLIP_UNIT))
    ops += `q /${gs} gs ${fmt(M)} cm /${name} Do Q\n`
  }
  const n = j.plan.numbers
  if (n) {
    const font = (j.font ??= await doc.embedFont(StandardFonts.Helvetica))
    const text = numberText(n.start + i, n.start + j.plan.pages.length - 1, n.style)
    const tw = font.widthOfTextAtSize(text, n.size)
    const [ax, ay] = numberAnchor(vw, vh, n)
    const x = n.pos === 'right' ? ax - tw : ax - tw / 2
    const M = mul(V, [1, 0, 0, -1, x, ay])
    const f = addRes(ctx, page.node, 'Font', 'PeF', font.ref)
    ops += `q ${fmt(M)} cm 0.2 g BT /${f} ${num(n.size)} Tf 0 0 Td ${font.encodeText(text).toString()} Tj ET Q\n`
  }
  return ops
}

/* ---------- 원본 쪽 손질 ---------- */

const PAGE_KEYS = new Set(['Type', 'Parent', 'MediaBox', 'CropBox', 'BleedBox', 'TrimBox', 'ArtBox', 'Rotate', 'Resources', 'Contents', 'Annots', 'Group', 'UserUnit'])
const RES_FILTERED = ['XObject', 'Font', 'ExtGState', 'Pattern', 'Shading', 'ColorSpace', 'Properties']

function streamBytes(s: PDFObject | undefined): Uint8Array | null {
  try {
    if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode()
    if (s instanceof PDFStream) return s.getContents()
  } catch {
    // 풀 수 없는 압축
  }
  return null
}

/** 내용에 나오는 /이름 들 — 못 읽는 내용이 있으면 null (그때는 자원을 줄이지 않는다) */
function namesIn(ctx: PDFContext, streams: PDFObject[]): Set<string> | null {
  const names = new Set<string>()
  for (const s of streams) {
    const b = streamBytes(s instanceof PDFRef ? ctx.lookup(s) : s)
    if (!b) return null
    const text = Buffer.from(b).toString('latin1')
    for (const m of text.matchAll(/\/([^\s/[\]()<>{}%]+)/g)) names.add(m[1].replace(/#([0-9a-fA-F]{2})/g, (_x, hx: string) => String.fromCharCode(parseInt(hx, 16))))
  }
  return names
}

/** 쪽 내용이 쓰는 자원 이름 — 자기 자원이 없는 폼 그림은 쪽 자원을 쓰므로 그 안의 이름도 센다 */
function usedNames(ctx: PDFContext, node: PDFDict, res: PDFDict): Set<string> | null {
  const names = namesIn(ctx, contentStreams(ctx, node))
  const xo = res.lookupMaybe(PDFName.of('XObject'), PDFDict)
  if (!names || !xo) return names
  const seen = new Set<string>()
  for (let grow = true; grow; ) {
    grow = false
    for (const [k, v] of xo.entries()) {
      const key = k.asString().slice(1)
      if (!names.has(key) || seen.has(key)) continue
      seen.add(key)
      const s = v instanceof PDFRef ? ctx.lookup(v) : v
      if (s instanceof PDFStream && !s.dict.has(PDFName.of('Resources')) && s.dict.get(PDFName.of('Subtype'))?.toString() === '/Form') {
        const more = namesIn(ctx, [s])
        if (!more) return null
        for (const n of more) {
          if (!names.has(n)) {
            names.add(n)
            grow = true
          }
        }
      }
    }
  }
  return names
}

/** 모양이 없는 주석(pdf.js 는 스스로 모양을 그려 보여 준다)을 다른 쪽 · 묶음을 가리키는 열쇠 없이 새로 만든다 */
const ANNOT_KEYS = ['Type', 'Subtype', 'Rect', 'Contents', 'F', 'C', 'IC', 'CA', 'BS', 'Border', 'BE', 'RD', 'QuadPoints', 'InkList', 'L', 'LE', 'Vertices', 'DA', 'DS', 'Q', 'RC', 'Name', 'CL', 'IT', 'M', 'NM', 'T', 'Subj']

function contentStreams(ctx: PDFContext, node: PDFDict): PDFObject[] {
  const c = node.get(PDFName.of('Contents'))
  const cv = c instanceof PDFRef ? ctx.lookup(c) : c
  if (cv instanceof PDFArray) return cv.asArray()
  // 가리킴이면 가리킴 그대로 (새 배열에 다시 담을 수 있게)
  return c ? [c] : []
}

/**
 * 옮기기 전에 원본 쪽을 손질한다(메모리 속 사본만 — 원본 파일은 그대로).
 * 돌려주는 값: 값이 있는데 모양이 없어 눌러 붙이지 못한 입력칸 수.
 */
function cleanPage(ctx: PDFContext, node: PDFPageLeaf): number {
  // 1) 쪽 자원 — 이 쪽 내용이 쓰는 이름만 (자원 없는 폼 그림은 쪽 자원을 쓰므로 그 안의 이름도 센다)
  const res = ctx.lookupMaybe(node.getInheritableAttribute(PDFName.of('Resources')), PDFDict)
  const own = ctx.obj({})
  if (res) {
    const names = usedNames(ctx, node, res)
    for (const [k, v] of res.entries()) {
      const key = k.asString().slice(1)
      const sub = RES_FILTERED.includes(key) ? (v instanceof PDFRef ? ctx.lookup(v) : v) : null
      if (sub instanceof PDFDict && names) {
        const d = ctx.obj({})
        for (const [sk, sv] of sub.entries()) if (names.has(sk.asString().slice(1))) d.set(sk, sv)
        own.set(k, d)
      } else own.set(k, v)
    }
  }
  node.set(PDFName.of('Resources'), own)

  // 2) 주석 — 보이는 모양을 내용에 눌러 붙이고 지운다. 바깥 주소 링크만 새로 만든다
  const keep: PDFRef[] = []
  let flat = ''
  let lost = 0
  const annots = ctx.lookupMaybe(node.get(PDFName.of('Annots')), PDFArray)
  for (let i = 0; annots && i < annots.size(); i++) {
    const a = annots.lookup(i)
    if (!(a instanceof PDFDict)) continue
    const sub = a.get(PDFName.of('Subtype'))?.toString()
    const flags = a.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() ?? 0
    const rect = normRect(numsOf(ctx, a.get(PDFName.of('Rect'))))
    if (!rect || flags & 2 || flags & 32) continue
    if (sub === '/Link') {
      const act = a.lookupMaybe(PDFName.of('A'), PDFDict)
      const uri = act?.get(PDFName.of('S'))?.toString() === '/URI' ? act.lookup(PDFName.of('URI')) : undefined
      const href = uri instanceof PDFString || uri instanceof PDFHexString ? uri.decodeText() : ''
      if (/^(https?:|mailto:)/i.test(href)) {
        keep.push(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of(href) } })))
      }
      continue
    }
    if (sub === '/Popup') continue
    let n = a.lookupMaybe(PDFName.of('AP'), PDFDict)?.get(PDFName.of('N'))
    let nv = n instanceof PDFRef ? ctx.lookup(n) : n
    if (nv instanceof PDFDict) {
      const as = a.get(PDFName.of('AS'))
      n = as instanceof PDFName ? nv.get(as) : undefined
      nv = n instanceof PDFRef ? ctx.lookup(n) : n
    }
    if (!(nv instanceof PDFStream)) {
      if (sub === '/Widget') {
        if (hasValue(ctx, a)) lost++
      } else {
        const d = ctx.obj({})
        for (const k of ANNOT_KEYS) {
          const v = a.get(PDFName.of(k))
          if (v !== undefined) d.set(PDFName.of(k), v)
        }
        keep.push(ctx.register(d))
      }
      continue
    }
    const bbox = normRect(numsOf(ctx, nv.dict.get(PDFName.of('BBox'))))
    const mat = numsOf(ctx, nv.dict.get(PDFName.of('Matrix')))
    if (!bbox) continue
    const M: Mat = mat && mat.length === 6 ? (mat as Mat) : [1, 0, 0, 1, 0, 0]
    const c = [apply(M, bbox[0], bbox[1]), apply(M, bbox[2], bbox[1]), apply(M, bbox[0], bbox[3]), apply(M, bbox[2], bbox[3])]
    const tx0 = Math.min(...c.map((p) => p[0]))
    const ty0 = Math.min(...c.map((p) => p[1]))
    const tw = Math.max(...c.map((p) => p[0])) - tx0
    const th = Math.max(...c.map((p) => p[1])) - ty0
    if (tw <= 0 || th <= 0) continue
    const sx = (rect[2] - rect[0]) / tw
    const sy = (rect[3] - rect[1]) / th
    if (!nv.dict.has(PDFName.of('Subtype'))) nv.dict.set(PDFName.of('Subtype'), PDFName.of('Form'))
    const ref = n instanceof PDFRef ? n : ctx.register(nv)
    const name = addRes(ctx, node, 'XObject', 'PeAn', ref)
    flat += `q ${fmt([sx, 0, 0, sy, rect[0] - sx * tx0, rect[1] - sy * ty0])} cm /${name} Do Q\n`
  }
  if (flat) appendContent(ctx, node, flat, true)
  else {
    // 내용 배열도 쪽마다 새로 (원본에서 여러 쪽이 함께 쓰던 배열을 끌고 가지 않게)
    const list = contentStreams(ctx, node)
      .map((r) => (r instanceof PDFRef ? r : r instanceof PDFStream ? ctx.register(r) : null))
      .filter((r): r is PDFRef => !!r)
    node.set(PDFName.of('Contents'), ctx.obj(list))
  }
  if (keep.length) node.set(PDFName.of('Annots'), ctx.obj(keep))
  else node.delete(PDFName.of('Annots'))

  // 3) 쪽 열쇠 — 그림 · 상자 · 내용만 남긴다 (/B 기사 실 · /Thumb · /AA · /PieceInfo · /Metadata · /StructParents …)
  for (const k of node.keys()) if (!PAGE_KEYS.has(k.asString().slice(1))) node.delete(k)
  return lost
}

function hasValue(ctx: PDFContext, a: PDFDict): boolean {
  for (let d: PDFDict | undefined = a, depth = 0; d && depth < 10; depth++) {
    const v = d.get(PDFName.of('V'))
    if (v) {
      const s = v instanceof PDFRef ? ctx.lookup(v) : v
      return !!s && s.toString() !== '()' && s.toString() !== '/Off'
    }
    d = ctx.lookupMaybe(d.get(PDFName.of('Parent')), PDFDict)
  }
  return false
}

/* ---------- 마무리 검사 ---------- */

/** 문서 뿌리에서 닿지 않는 객체를 지운다 (pdf-lib 는 안 쓰는 객체도 모두 적는다) */
export function collectGarbage(doc: PDFDocument): number {
  const ctx = doc.context
  const seen = new Set<string>()
  const stack: PDFObject[] = []
  const t = ctx.trailerInfo
  for (const r of [t.Root, t.Info]) if (r) stack.push(r)
  while (stack.length) {
    const o = stack.pop()!
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) continue
      seen.add(o.tag)
      const v = ctx.lookup(o)
      if (v) stack.push(v)
    } else if (o instanceof PDFStream) stack.push(o.dict)
    else if (o instanceof PDFDict) for (const [, v] of o.entries()) stack.push(v)
    else if (o instanceof PDFArray) for (const v of o.asArray()) stack.push(v)
  }
  let removed = 0
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref.tag)) {
      ctx.delete(ref)
      removed++
    }
  }
  return removed
}

/** 쪽 나무 밖의 쪽 객체가 있으면(지운 쪽이 끌려 들어왔으면) 멈춘다 */
export function assertNoStrayPages(doc: PDFDocument): void {
  const mine = new Set(doc.getPages().map((p) => p.ref.tag))
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    const isPage = obj instanceof PDFPageLeaf || (obj instanceof PDFDict && !(obj instanceof PDFStream) && obj.get(PDFName.of('Type'))?.toString() === '/Page')
    if (isPage && !mine.has(ref.tag)) throw new EditError('이 PDF 는 쪽 정리 저장을 할 수 없습니다(지운 쪽이 다른 곳에 묶여 있습니다).')
  }
}

/** 앱을 끌 때 */
export function clearPdfEdit(): void {
  job = null
}

export type { PeObj }
