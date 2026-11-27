/**
 * 문서 → PDF 변환 — 한글 · 워드 · 엑셀 · 파워포인트 · 사진 · PDF 를 PDF 로 모으고, 합치고, 나눈다.
 *
 *  - 모두 이 PC 안에서 한다. 파일도, 파일 이름도 밖으로 보내지 않는다.
 *  - 원본은 바꾸지 않는다. 임시 폴더에 번호 이름으로 복사해 바꾸고, 끝나면(멈춰도) 임시 폴더를 지운다.
 *  - 저장하는 곳: 폴더를 골랐으면 그 옆의 '폴더이름_PDF', 파일을 골랐으면 첫 파일 옆의 'PDF 변환'. 이미 있으면 (2) — 덮어쓰지 않는다.
 *  - 합치기 · 나누기 · 사진 → PDF 는 pdf-lib, 나머지는 convertOffice.ts.
 */

import { dialog, shell, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { PDFDocument, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from 'pdf-lib'
import type { ConvFile, ConvKind, ConvList, ConvOptions, ConvProgress, ConvRequest, ConvResult, SplitFile } from '../../shared/convert'
import { CONV_EXTS, CONV_MAX_DEPTH, CONV_MAX_FILES, byName, convKindOf, exifOrientation, imagePlacement, parseRanges, planOutputs, stemOf, uniqueName } from '../../shared/convert'
import { convertWithOffice, type OfficeItem, type OfficeKind } from './convertOffice'
import { logError } from './errlog'

interface Picked {
  path: string
  file: ConvFile
  /** 폴더를 골라 들어온 파일이면 그 폴더 */
  root: string
}

/** 이번 실행에서 고른 파일 (화면은 번호로만 가리킨다) */
const picked = new Map<string, Picked>()
/** 나누려고 고른 PDF */
const splits = new Map<string, string>()
/** 일마다 저장한 폴더 ([폴더 열기]) */
const outputs = new Map<string, string>()
let running: { job: string; abort: AbortController; work: string } | null = null

const TEMP_PREFIX = 'wd-convert-'
const ignored = (name: string): boolean => name.startsWith('.') || name.startsWith('~$') || /^(thumbs\.db|desktop\.ini)$/i.test(name)

/* ---------- 파일 고르기 ---------- */

/** 폴더 · 파일 길을 받아 바꿀 수 있는 파일 목록으로 */
export function addPaths(input: unknown): ConvList {
  const paths = (Array.isArray(input) ? input : []).filter((p): p is string => typeof p === 'string' && !!p)
  const files: ConvFile[] = []
  const skipped: string[] = []
  let over = false
  const add = (full: string, name: string, root: string, sub: string): void => {
    const kind = convKindOf(name)
    if (!kind) return void skipped.push(name)
    if (files.length >= CONV_MAX_FILES) return void (over = true)
    let size = 0
    try {
      size = fs.statSync(full).size
    } catch {
      return
    }
    // 같은 파일을 다시 담으면 같은 번호 — 화면이 번호로 겹침을 거른다
    const before = [...picked.values()].find((p) => p.path === full)
    const file: ConvFile = { id: before?.file.id ?? crypto.randomUUID(), name, sub, size, kind }
    picked.set(file.id, { path: full, file, root })
    files.push(file)
  }
  const walk = (root: string, dir: string, dirs: string[]): void => {
    let list: fs.Dirent[]
    try {
      list = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of list.sort((a, b) => byName(a.name, b.name))) {
      if (ignored(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (dirs.length < CONV_MAX_DEPTH) walk(root, full, [...dirs, e.name])
      } else if (e.isFile()) add(full, e.name, root, dirs.join('/'))
    }
  }
  for (const p of paths) {
    const full = path.resolve(p)
    let stat: fs.Stats
    try {
      stat = fs.statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) walk(full, full, [])
    else if (!ignored(path.basename(full))) add(full, path.basename(full), '', '')
  }
  if (!files.length) return { ok: false, files, skipped, error: '바꿀 수 있는 파일(한글 · 워드 · 엑셀 · 파워포인트 · JPG · PNG · PDF)이 없습니다.' }
  return { ok: true, files, skipped, ...(over ? { error: `한 번에 ${CONV_MAX_FILES}개까지만 담았습니다.` } : {}) }
}

export async function pickFiles(win: BrowserWindow | null): Promise<ConvList | null> {
  if (!win) return null
  const res = await dialog.showOpenDialog(win, {
    title: 'PDF 로 바꿀 파일 고르기',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '문서 · 사진', extensions: CONV_EXTS }]
  })
  if (res.canceled || !res.filePaths.length) return null
  return addPaths([...res.filePaths].sort((a, b) => byName(path.basename(a), path.basename(b))))
}

export async function pickFolder(win: BrowserWindow | null): Promise<ConvList | null> {
  if (!win) return null
  const res = await dialog.showOpenDialog(win, { title: 'PDF 로 바꿀 폴더 고르기', properties: ['openDirectory'] })
  if (res.canceled || !res.filePaths[0]) return null
  return addPaths([res.filePaths[0]])
}

/* ---------- 변환 ---------- */

/** 없는 폴더를 새로 만든다 — 있으면 (2), (3) … */
function newDir(parent: string, name: string): string {
  for (let n = 1; ; n++) {
    const dir = path.join(parent, n === 1 ? name : `${name} (${n})`)
    try {
      fs.mkdirSync(dir)
      return dir
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || n >= 200) throw e
    }
  }
}

function outputDirFor(first: Picked): string {
  // 드라이브 맨 위 폴더를 골랐으면 옆이 없으니 파일 옆에
  if (first.root && path.dirname(first.root) !== first.root) return newDir(path.dirname(first.root), `${path.basename(first.root)}_PDF`)
  return newDir(path.dirname(first.path), 'PDF 변환')
}

function removeDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  } catch (e) {
    logError('변환 임시 폴더 지우기', e)
  }
}

/** 지난번에 못 지운 임시 폴더(학생 파일 사본이 남지 않게) — 하루 지난 것만 */
function sweepTemp(): void {
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith(TEMP_PREFIX)) continue
      const dir = path.join(os.tmpdir(), name)
      if (Date.now() - fs.statSync(dir).mtimeMs > 24 * 3600 * 1000) removeDir(dir)
    }
  } catch {
    // 다음에
  }
}

async function imageToPdf(input: string, output: string): Promise<void> {
  const bytes = fs.readFileSync(input)
  const doc = await PDFDocument.create()
  const png = bytes[0] === 0x89 && bytes[1] === 0x50
  if (!png && !(bytes[0] === 0xff && bytes[1] === 0xd8)) throw new Error('JPG · PNG 사진이 아닙니다.')
  const img = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
  const place = imagePlacement(png ? 1 : exifOrientation(bytes), img.width, img.height)
  const page = doc.addPage(place.page)
  const key = page.node.newXObject('Image', img.ref)
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...place.matrix), drawObject(key), popGraphicsState())
  fs.writeFileSync(output, await doc.save())
}

/** 여러 PDF 를 하나로. 암호 · 보안이 걸린 PDF 는 빈 쪽이 되므로 넣지 않고 알려 준다 */
async function mergePdfs(parts: { id: string; path: string }[], output: string, fail: (id: string, message: string) => void): Promise<number> {
  // 하나뿐이면 합칠 것이 없으니 그대로 복사한다 (보안이 걸린 PDF 도 온전히 남는다)
  if (parts.length === 1) {
    fs.copyFileSync(parts[0].path, output, fs.constants.COPYFILE_EXCL)
    return 1
  }
  const doc = await PDFDocument.create()
  let used = 0
  for (const part of parts) {
    try {
      const src = await PDFDocument.load(fs.readFileSync(part.path), { updateMetadata: false })
      for (const page of await doc.copyPages(src, src.getPageIndices())) doc.addPage(page)
      used++
    } catch (e) {
      fail(part.id, /encrypt/i.test(String(e)) ? '암호 · 보안이 걸린 PDF 는 합칠 수 없습니다.' : '읽을 수 없는 PDF 라 합치지 못했습니다.')
    }
  }
  if (used) fs.writeFileSync(output, await doc.save(), { flag: 'wx' })
  return used
}

export async function runConvert(req: ConvRequest, progress: (p: ConvProgress) => void): Promise<ConvResult> {
  const none: ConvResult = { ok: false, folder: '', made: 0, failed: 0, notes: [] }
  const job = String(req?.job ?? '')
  const options: ConvOptions = {
    merge: req?.options?.merge === 'student' || req?.options?.merge === 'all' ? req.options.merge : 'none',
    excelFit: req?.options?.excelFit !== false
  }
  const list = (Array.isArray(req?.ids) ? req.ids : []).map((id) => picked.get(String(id))).filter((x): x is Picked => !!x)
  if (!list.length) return { ...none, error: '바꿀 파일을 다시 골라 주세요.' }
  if (running) return { ...none, error: '다른 변환이 아직 끝나지 않았습니다.' }

  const abort = new AbortController()
  running = { job, abort, work: '' }
  const signal = abort.signal
  let work = ''
  let outDir = ''
  let made = 0
  const failed = new Set<string>()
  const notes: string[] = []
  /** 번호 → 만든 PDF (임시) */
  const ready = new Map<string, string>()
  try {
    sweepTemp()
    work = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX))
    running.work = work
    const plan = planOutputs(
      list.map((x) => x.file),
      options.merge,
      list[0].root ? `${path.basename(list[0].root)} 전체` : '합친 문서'
    )

    const fail = (id: string, error: string): void => {
      failed.add(id)
      progress({ job, id, status: 'error', error })
    }
    const folder = (): string => {
      if (!outDir) {
        outDir = outputDirFor(list[0])
        outputs.set(job, outDir)
      }
      return outDir
    }
    /** 합치지 않을 때는 하나 끝날 때마다 바로 저장한다 (멈춰도 만든 것은 남는다) */
    const done = (id: string, pdf: string): void => {
      ready.set(id, pdf)
      if (options.merge === 'none') {
        const out = plan.find((p) => p.ids[0] === id)!
        try {
          fs.copyFileSync(pdf, path.join(folder(), out.name), fs.constants.COPYFILE_EXCL)
          made++
        } catch (e) {
          logError('변환 저장', e)
          return fail(id, '저장하지 못했습니다. 폴더에 쓸 수 있는지, 파일 이름이 너무 길지 않은지 확인해 주세요.')
        }
      }
      progress({ job, id, status: 'done' })
    }

    // 사본 만들기 — 원본은 열지 않는다
    const copies = new Map<string, string>()
    list.forEach((x, i) => {
      const copy = path.join(work, `f${String(i + 1).padStart(3, '0')}${path.extname(x.path).toLowerCase()}`)
      try {
        fs.copyFileSync(x.path, copy)
        copies.set(x.file.id, copy)
      } catch {
        fail(x.file.id, '파일을 읽지 못했습니다. 옮겼거나 다른 프로그램이 잠갔는지 확인해 주세요.')
      }
    })
    const pdfPath = (copy: string): string => `${copy}.out.pdf`
    const of = (kind: ConvKind): Picked[] => list.filter((x) => x.file.kind === kind && copies.has(x.file.id))

    for (const x of of('pdf')) {
      if (signal.aborted) break
      done(x.file.id, copies.get(x.file.id)!)
    }
    for (const x of of('image')) {
      if (signal.aborted) break
      const copy = copies.get(x.file.id)!
      progress({ job, id: x.file.id, status: 'working' })
      try {
        await imageToPdf(copy, pdfPath(copy))
        done(x.file.id, pdfPath(copy))
      } catch (e) {
        logError('사진 → PDF', e)
        fail(x.file.id, '사진을 읽지 못했습니다. 손상되었거나 JPG · PNG 가 아닐 수 있습니다.')
      }
    }
    // 한글을 마지막에 — 접근 허용 창이 뜰 수 있어서
    for (const kind of ['word', 'excel', 'ppt', 'hwp'] as OfficeKind[]) {
      const files = of(kind)
      if (!files.length || signal.aborted) continue
      const items: OfficeItem[] = files.map((x) => ({ id: x.file.id, input: copies.get(x.file.id)!, output: pdfPath(copies.get(x.file.id)!) }))
      await convertWithOffice(kind, items, work, options.excelFit, signal, {
        start: (id) => progress({ job, id, status: 'working' }),
        ok: (id) => done(id, pdfPath(copies.get(id)!)),
        fail
      })
    }

    if (!signal.aborted && options.merge !== 'none') {
      const names = new Set<string>()
      for (const out of plan) {
        const parts = out.ids.filter((id) => ready.has(id)).map((id) => ({ id, path: ready.get(id)! }))
        if (!parts.length) continue
        const stem = stemOf(out.name)
        // 빠진 파일이 있으면 이름에 남긴다 — 다 들어간 것으로 알지 않게
        const missing = out.ids.length - parts.length
        let name = uniqueName(names, missing ? `${stem} (일부 빠짐)` : stem)
        try {
          const dir = folder()
          let late = 0
          const used = await mergePdfs(parts, path.join(dir, name), (id, message) => {
            late++
            fail(id, message)
          })
          if (!used) continue
          made++
          if (late && !missing) {
            const renamed = uniqueName(names, `${stem} (일부 빠짐)`)
            fs.renameSync(path.join(dir, name), path.join(dir, renamed))
            name = renamed
          }
          if (missing || late) notes.push(`${name} — ${missing + late}개가 빠졌습니다.`)
        } catch (e) {
          logError('PDF 합치기', e)
          parts.forEach((p) => fail(p.id, '합친 파일을 저장하지 못했습니다.'))
        }
      }
      if (options.merge === 'student') {
        const alone = plan.filter((p) => p.alone).length
        if (alone) notes.push(`파일 이름에서 학번을 찾지 못한 ${alone}개는 따로 저장했습니다.`)
      }
    }

    return {
      ok: made > 0 && !signal.aborted,
      canceled: signal.aborted,
      folder: outDir ? path.basename(outDir) : '',
      made,
      failed: failed.size,
      notes,
      ...(made === 0 && !signal.aborted ? { error: '만든 PDF 가 없습니다. 파일마다 적힌 까닭을 확인해 주세요.' } : {})
    }
  } catch (e) {
    logError('PDF 변환', e)
    return { ...none, folder: outDir ? path.basename(outDir) : '', made, failed: failed.size, notes, error: '변환하지 못했습니다. 원본이 있는 폴더에 저장할 수 있는지 확인해 주세요.' }
  } finally {
    if (work) removeDir(work)
    running = null
  }
}

/** 그만하기 — 일 번호가 없으면(프로그램을 끌 때) 하던 것을 멈춘다 */
export function cancelConvert(job?: string): void {
  if (!running || (job !== undefined && running.job !== job)) return
  running.abort.abort()
  // 끌 때는 뒷정리를 기다려 주지 않으므로 사본을 바로 지운다
  if (job === undefined && running.work) removeDir(running.work)
}

export async function revealOutput(key: string): Promise<boolean> {
  const dir = outputs.get(key)
  if (!dir || !fs.existsSync(dir)) return false
  return (await shell.openPath(dir)) === ''
}

/* ---------- PDF 나누기 ---------- */

const splitFail = (error: string): SplitFile => ({ ok: false, error, id: '', name: '', pages: 0 })

export async function addSplit(p: unknown): Promise<SplitFile> {
  if (typeof p !== 'string' || !/\.pdf$/i.test(p)) return splitFail('PDF 파일 하나를 골라 주세요.')
  try {
    const doc = await PDFDocument.load(fs.readFileSync(p), { updateMetadata: false })
    const id = crypto.randomUUID()
    splits.set(id, path.resolve(p))
    return { ok: true, id, name: path.basename(p), pages: doc.getPageCount() }
  } catch (e) {
    return splitFail(/encrypt/i.test(String(e)) ? '암호 · 보안이 걸린 PDF 는 나눌 수 없습니다.' : '읽을 수 없는 PDF 입니다.')
  }
}

export async function pickSplit(win: BrowserWindow | null): Promise<SplitFile | null> {
  if (!win) return null
  const res = await dialog.showOpenDialog(win, { title: '나눌 PDF 고르기', properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  if (res.canceled || !res.filePaths[0]) return null
  return addSplit(res.filePaths[0])
}

export async function runSplit(id: string, ranges: string): Promise<ConvResult> {
  const none: ConvResult = { ok: false, folder: '', made: 0, failed: 0, notes: [] }
  const file = splits.get(id)
  if (!file) return { ...none, error: '나눌 PDF 를 다시 골라 주세요.' }
  try {
    const src = await PDFDocument.load(fs.readFileSync(file), { updateMetadata: false })
    const parsed = parseRanges(ranges, src.getPageCount())
    if (!parsed.ok) return { ...none, error: parsed.error }
    if (parsed.groups.length > CONV_MAX_FILES) return { ...none, error: `한 번에 ${CONV_MAX_FILES}개까지만 나눌 수 있습니다. 쪽 범위를 적어 주세요.` }
    const stem = stemOf(path.basename(file))
    const dir = newDir(path.dirname(file), `${stem}_나눔`)
    outputs.set(id, dir)
    const names = new Set<string>()
    for (const group of parsed.groups) {
      const doc = await PDFDocument.create()
      for (const page of await doc.copyPages(src, group.map((n) => n - 1))) doc.addPage(page)
      const label = group.length === 1 ? `${group[0]}쪽` : `${group[0]}-${group[group.length - 1]}쪽`
      fs.writeFileSync(path.join(dir, uniqueName(names, `${stem}_${label}`)), await doc.save(), { flag: 'wx' })
    }
    return { ok: true, folder: path.basename(dir), made: parsed.groups.length, failed: 0, notes: [] }
  } catch (e) {
    logError('PDF 나누기', e)
    return { ...none, error: '나누지 못했습니다. 원본이 있는 폴더에 저장할 수 있는지 확인해 주세요.' }
  }
}
