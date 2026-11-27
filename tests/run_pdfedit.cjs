// PDF 편집 (electron/main/pdfedit.ts) — 빌드된 앱의 IPC 로. 만든 PDF 만 쓴다(실제 파일은 열지 않는다).
//  1. 열기 · 막기(암호 · 깨진 파일 · 경로)   2. 보통 저장 — 지운 쪽이 남지 않는지(링크 · 책갈피 · 입력칸 · 함께 쓰는 자원 · 첨부 · 정보)
//  3. 자리 — /Rotate 90 + 사용자 90 · CropBox 원점이 0 이 아닌 쪽에서 그린 것이 보던 자리에 서서 나오는지 (pdf.js 로 그려 픽셀을 본다)
//  4. 완전 가리기 — 쪽 그림만으로 저장 · 가린 글/그림/숨은 것이 바이트와 글 뽑기 어디에도 없는지
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')
const crypto = require('crypto')
const { pathToFileURL } = require('url')
const { PDFDocument, PDFName, PDFString, PDFArray, PDFDict } = require(path.join(__dirname, '../node_modules/pdf-lib'))
const { createCanvas } = require(path.join(__dirname, '../node_modules/@napi-rs/canvas'))
const { loadShared } = require('./tsload.cjs')
const S = loadShared('pdfedit')
const { handlers, USER_DATA, calls } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)
const PDFJS_DIR = path.join(__dirname, '../node_modules/pdfjs-dist')
let pdfjs

const SECRETS = ['SECRET-PAGE-TEXT', 'SECRETIMG', 'SECRET-TITLE', 'SECRET-ATTACH', 'SECRET-THUMB', 'SECRET-XMP', 'SECRET-OUTLINE', 'SECRET-WIDGET-P2', 'SECRET-JS', 'SECRET-FIELD']

/** 파일 바이트 + 모든 스트림을 푼 것 — 숨은 글 찾기용 */
function allText(buf) {
  const parts = [buf.toString('latin1')]
  const s = buf.toString('latin1')
  const re = /stream\r?\n/g
  let m
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length
    const end = s.indexOf('endstream', start)
    if (end < 0) break
    const raw = buf.subarray(start, end)
    for (const f of [zlib.inflateSync, zlib.inflateRawSync]) {
      try { parts.push(f(raw).toString('latin1')); break } catch { /* 압축 아님 */ }
    }
  }
  return parts.join('\n')
}
function leaks(buf, words) {
  const t = allText(buf)
  const hex = t.replace(/[^0-9a-fA-F]/g, '').toLowerCase()
  const u16 = t.replace(/\x00/g, '')
  return words.filter((w) => t.includes(w) || u16.includes(w) || hex.includes(Buffer.from(w).toString('hex')))
}

async function loadPdfjs() {
  pdfjs = await import(pathToFileURL(path.join(PDFJS_DIR, 'legacy/build/pdf.mjs')).href)
}
const openJs = (bytes) => pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, cMapUrl: path.join(PDFJS_DIR, 'cmaps') + path.sep, cMapPacked: true, standardFontDataUrl: path.join(PDFJS_DIR, 'standard_fonts') + path.sep, verbosity: 0 }).promise
async function textOf(bytes) {
  const d = await openJs(bytes)
  let t = ''
  for (let i = 1; i <= d.numPages; i++) t += (await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ') + '\n'
  await d.destroy()
  return t
}
/** 쪽을 화면처럼 그린다 (rotation 은 파일의 /Rotate + 더 돌린 것) */
async function render(bytes, pageNo, k, extraRot = 0) {
  const d = await openJs(bytes)
  const p = await d.getPage(pageNo)
  const vp = p.getViewport({ scale: k, rotation: (p.rotate + extraRot) % 360 })
  const cv = createCanvas(Math.round(vp.width), Math.round(vp.height))
  const ctx = cv.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cv.width, cv.height)
  await p.render({ canvasContext: ctx, viewport: vp }).promise
  await d.destroy()
  return { cv, ctx, vp, rotate: p.rotate, view: p.view }
}
const px = (r, x, y) => { const d = r.ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data; return [d[0], d[1], d[2]] }
const near = (a, b, tol = 60) => a.every((v, i) => Math.abs(v - b[i]) <= tol)

/* ---------- 만든 PDF ---------- */

async function makeSecretPdf(file) {
  const doc = await PDFDocument.create()
  const ctx = doc.context
  const font = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }))
  const pix = Buffer.alloc(16 * 16 * 3)
  for (let i = 0; i < pix.length; i++) pix[i] = 'SECRETIMG'.charCodeAt(i % 9)
  const img = ctx.register(ctx.stream(pix, { Type: 'XObject', Subtype: 'Image', Width: 16, Height: 16, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }))
  // 세 쪽이 자원 묶음 하나를 함께 쓴다 — 비밀 그림은 셋째 쪽만 쓴다
  const shared = ctx.register(ctx.obj({ Font: { F1: font }, XObject: { Sec: img } }))
  const content = (s) => ctx.register(ctx.flateStream(s))
  const p0 = doc.addPage([400, 500])
  const p1 = doc.addPage([500, 800])
  const p2 = doc.addPage([400, 500])
  for (const p of [p0, p1, p2]) p.node.set(PDFName.of('Resources'), shared)
  p0.node.set(PDFName.of('Contents'), content('BT /F1 18 Tf 40 420 Td (KEEP-PAGE-ONE) Tj ET BT /F1 18 Tf 40 300 Td (PRIVATE-NAME-HERE) Tj ET'))
  p1.node.set(PDFName.of('Rotate'), ctx.obj(90))
  p1.node.set(PDFName.of('CropBox'), ctx.obj([50, 60, 450, 700]))
  p1.node.set(PDFName.of('Contents'), content('BT /F1 14 Tf 100 300 Td (KEEP-PAGE-TWO) Tj ET'))
  p2.node.set(PDFName.of('Contents'), content('BT /F1 18 Tf 40 400 Td (SECRET-PAGE-TEXT) Tj ET q 100 0 0 100 50 50 cm /Sec Do Q'))
  // 첫 쪽의 주석: 셋째 쪽으로 가는 링크 둘 · 바깥 주소 링크 · 두 쪽에 걸친 입력칸 · 메모와 팝업
  const ap = (s) => ctx.register(ctx.stream(s, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 160, 20], Resources: { Font: { F1: font } } }))
  const field = ctx.register(ctx.obj({ FT: 'Tx', T: PDFString.of('f'), V: PDFString.of('SECRET-FIELD-VALUE') }))
  const w0 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [40, 200, 200, 220], Parent: field, P: p0.ref, AP: { N: ap('BT /F1 10 Tf 2 6 Td (FIELD-VALUE-KEEP) Tj ET') } }))
  const w2 = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [40, 200, 200, 220], Parent: field, P: p2.ref, AP: { N: ap('BT /F1 10 Tf 2 6 Td (SECRET-WIDGET-P2) Tj ET') } }))
  field && ctx.lookup(field).set(PDFName.of('Kids'), ctx.obj([w0, w2]))
  const popup = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [0, 0, 10, 10], P: p2.ref }))
  const note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [300, 450, 320, 470], Contents: PDFString.of('memo'), Popup: popup, P: p2.ref, IRT: w2 }))
  ctx.lookup(popup).set(PDFName.of('Parent'), note)
  const links = [
    ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [40, 100, 140, 120], Dest: [p2.ref, PDFName.of('Fit')] }),
    ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [40, 130, 140, 150], A: { S: 'GoTo', D: [p2.ref, PDFName.of('Fit')] } }),
    ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [40, 160, 140, 180], A: { S: 'URI', URI: PDFString.of('https://example.com/') } })
  ].map((a) => ctx.register(a))
  p0.node.set(PDFName.of('Annots'), ctx.obj([...links, w0, note]))
  p2.node.set(PDFName.of('Annots'), ctx.obj([w2, popup]))
  p0.node.set(PDFName.of('Thumb'), ctx.register(ctx.stream('SECRET-THUMB')))
  p0.node.set(PDFName.of('AA'), ctx.obj({ O: { S: 'JavaScript', JS: PDFString.of('SECRET-JS') } }))
  // 문서 쪽: 책갈피 · 이름 표 · 입력칸 묶음 · 정보 · XMP · 첨부
  const outlines = ctx.register(ctx.obj({ Type: 'Outlines' }))
  const item = ctx.register(ctx.obj({ Title: PDFString.of('SECRET-OUTLINE'), Parent: outlines, Dest: [p2.ref, PDFName.of('Fit')] }))
  ctx.lookup(outlines).set(PDFName.of('First'), item)
  ctx.lookup(outlines).set(PDFName.of('Last'), item)
  doc.catalog.set(PDFName.of('Outlines'), outlines)
  doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [field] }))
  doc.catalog.set(PDFName.of('Dests'), ctx.obj({ secret: [p2.ref, PDFName.of('Fit')] }))
  doc.catalog.set(PDFName.of('Metadata'), ctx.register(ctx.stream('<x:xmpmeta>SECRET-XMP</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' })))
  doc.setTitle('SECRET-TITLE')
  await doc.attach(Buffer.from('SECRET-ATTACH'), 'a.txt', { mimeType: 'text/plain' })
  fs.writeFileSync(file, await doc.save())
}

/** 사분면 그림: 왼쪽 위 빨강 · 오른쪽 위 초록 · 왼쪽 아래 파랑 · 오른쪽 아래 노랑 */
function quadPng() {
  const cv = createCanvas(80, 60)
  const c = cv.getContext('2d')
  c.fillStyle = '#ff0000'; c.fillRect(0, 0, 40, 30)
  c.fillStyle = '#00ff00'; c.fillRect(40, 0, 40, 30)
  c.fillStyle = '#0000ff'; c.fillRect(0, 30, 40, 30)
  c.fillStyle = '#ffff00'; c.fillRect(40, 30, 40, 30)
  return new Uint8Array(cv.toBuffer('image/png'))
}

const RED = [255, 0, 0], GREEN = [0, 255, 0], BLUE = [0, 0, 255], YELLOW = [255, 255, 0]

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('pdfedit:begin'); i++) await new Promise((r) => setTimeout(r, 50))
  await loadPdfjs()
  const dir = path.join(USER_DATA, '편집')
  fs.mkdirSync(dir, { recursive: true })
  const src = path.join(dir, '안내문.pdf')
  await makeSecretPdf(src)
  const srcHash = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex')

  console.log('1. 열기')
  const o = await call('pdfedit:add', [src])
  ok(o.ok && o.files.length === 1 && o.files[0].pages.length === 3, `세 쪽 (${o.files[0] && o.files[0].pages.length})`)
  const f = o.files[0]
  ok(!JSON.stringify({ ...f, bytes: undefined }).includes(USER_DATA), '경로는 화면에 넘기지 않음')
  ok(f.bytes instanceof Uint8Array && f.bytes.length === fs.statSync(src).size, '그리기용 내용을 받음')
  const d = await openJs(f.bytes)
  let same = true
  for (let i = 0; i < 3; i++) {
    const p = await d.getPage(i + 1)
    const [x0, y0, x1, y1] = p.view
    same = same && Math.abs(x1 - x0 - f.pages[i].w) < 1e-6 && Math.abs(y1 - y0 - f.pages[i].h) < 1e-6 && p.rotate === f.pages[i].rotate
  }
  await d.destroy()
  ok(same && f.pages[1].rotate === 90 && f.pages[1].w === 400 && f.pages[1].h === 640, '쪽 크기 · 돌림이 pdf.js 와 같음 (CropBox · /Rotate)')
  const bad = path.join(dir, '깨진.pdf')
  fs.writeFileSync(bad, 'not a pdf at all')
  const enc = path.join(dir, '암호.pdf')
  {
    const e = await PDFDocument.create()
    e.addPage([100, 100])
    e.context.trailerInfo.Encrypt = e.context.register(e.context.obj({ Filter: 'Standard', V: 1, R: 2, O: PDFString.of('x'.repeat(32)), U: PDFString.of('y'.repeat(32)), P: -4 }))
    fs.writeFileSync(enc, await e.save({ useObjectStreams: false }))
  }
  const r2 = await call('pdfedit:add', [bad, enc, path.join(dir, '없는.pdf'), path.join(dir, '메모.txt')])
  const why = Object.fromEntries(r2.failed.map((x) => [x.name, x.error]))
  ok(!r2.ok && /읽을 수 없는/.test(why['깨진.pdf']) && /암호/.test(why['암호.pdf']) && why['없는.pdf'] && /PDF 파일이 아닙/.test(why['메모.txt']), `깨진 · 암호 · 없는 · PDF 아닌 파일 알림`)
  ok((await call('pdfedit:pick')) === null, '고르기 취소')
  const b = await call('pdfedit:bytes', f.id)
  ok(b.ok && b.bytes.length === f.bytes.length, '원본 다시 받기')
  ok(!(await call('pdfedit:bytes', src)).ok, '경로로는 받지 못함')
  ok((await call('pdfedit:asset', 'cmap', 'UniKS-UCS2-H')) instanceof Uint8Array && (await call('pdfedit:asset', 'cmap', 'Adobe-Korea1-UCS2')) instanceof Uint8Array, '한글 cMap 자료')
  ok((await call('pdfedit:asset', 'font', 'FoxitSerif.pfb')) instanceof Uint8Array, '기본 글꼴 자료')
  ok((await call('pdfedit:asset', 'cmap', '../../package')) === null && (await call('pdfedit:asset', 'font', '..\\x')) === null && (await call('pdfedit:asset', 'x', 'UniKS-UCS2-H')) === null, '자료 이름 밖으로 나가지 못함')

  console.log('\n2. 계획 검사')
  let bg = await call('pdfedit:begin', { mode: 'all', pages: [{ file: 'nope', index: 0, rot: 0, objs: [] }] })
  ok(!bg.ok, '모르는 파일 번호 거절')
  bg = await call('pdfedit:begin', { mode: 'all', pages: [{ file: f.id, index: 3, rot: 0, objs: [] }] })
  ok(!bg.ok, '없는 쪽 거절')
  bg = await call('pdfedit:begin', { mode: 'all', pages: Array.from({ length: S.PE_MAX_PAGES + 1 }, () => ({ file: f.id, index: 0, rot: 0, objs: [] })) })
  ok(!bg.ok && /500/.test(bg.error), '쪽 수 한도')
  bg = await call('pdfedit:begin', { mode: 'all', pages: [{ blank: { w: 1, h: 1 }, rot: 0, objs: [] }] })
  ok(!bg.ok, '빈 쪽 크기 검사')

  console.log('\n3. 보통 저장 — 셋째 쪽을 지우고, 둘째 쪽에 그린다 (/Rotate 90 + 더 90, CropBox 원점 50,60)')
  // 화면에서: 둘째 쪽을 180도(파일 90 + 사용자 90)로 보며 그렸다
  const R = 180
  const W = f.pages[1].w, H = f.pages[1].h
  const [VW, VH] = S.viewSize(W, H, R)
  const v1 = { x: 40, y: 60, w: 120, h: 90 }
  const v2 = { x: 220, y: 300, w: 90, h: 120 }
  const quad = quadPng()
  const objs = [
    { id: 'a', kind: 'image', ...S.viewToObj(v1, W, H, R), turn: R, asset: 'q' },
    // 사용자 90 도일 때(전체 180 이 아니라 90) 만든 그림 — 지금 보기에서는 시계 방향 90 도 누워 보여야 한다
    { id: 'b', kind: 'image', ...S.viewToObj(v2, W, H, R), turn: 90, asset: 'q' },
    { id: 'c', kind: 'line', x: 0, y: 0, w: 0, h: 0, color: '#000000', width: 6, pts: [S.viewToObj({ x: 200, y: 520, w: 0, h: 0 }, W, H, R), S.viewToObj({ x: 330, y: 520, w: 0, h: 0 }, W, H, R)].map((r) => [r.x, r.y]) },
    { id: 'd', kind: 'highlight', ...S.viewToObj({ x: 40, y: 400, w: 100, h: 40 }, W, H, R), color: '#ffe14d' },
    { id: 'e', kind: 'rect', ...S.viewToObj({ x: 200, y: 560, w: 100, h: 40 }, W, H, R), color: '#0000ff', width: 4 }
  ]
  const plan = { mode: 'all', pages: [{ file: f.id, index: 0, rot: 0, objs: [] }, { file: f.id, index: 1, rot: 90, objs }, { blank: { w: 300, h: 200 }, rot: 0, objs: [] }], numbers: { style: 'total', pos: 'center', size: 12, start: 1 }, watermark: null }
  bg = await call('pdfedit:begin', plan)
  ok(bg.ok && !bg.raster && bg.need.map((n) => n.key).join() === 'f1_0,f1_1', `받을 그림: ${bg.ok && bg.need.map((n) => n.key).join()}`)
  ok(!(await call('pdfedit:put', bg.job, 'f9_9', quad)).ok, '모르는 그림 이름 거절')
  ok(!(await call('pdfedit:finish', bg.job)).ok, '그림을 다 받기 전에는 저장하지 않음')
  for (const n of bg.need) ok((await call('pdfedit:put', bg.job, n.key, quad)).ok, `그림 ${n.key}`)
  let s = await call('pdfedit:finish', bg.job)
  const out1 = path.join(dir, '안내문_편집.pdf')
  ok(s.ok && s.name === '안내문_편집.pdf' && s.pages === 3 && fs.existsSync(out1), `새 파일 ${s.name} ${s.error || ''}`)
  ok(crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex') === srcHash, '원본은 그대로')
  const outBytes = fs.readFileSync(out1)
  const leak1 = leaks(outBytes, SECRETS)
  ok(leak1.length === 0, `지운 쪽 · 숨은 것이 남지 않음 ${leak1.join(' ')}`)
  const t1 = await textOf(outBytes)
  ok(/KEEP-PAGE-ONE/.test(t1) && /KEEP-PAGE-TWO/.test(t1) && /FIELD-VALUE-KEEP/.test(t1) && !/SECRET/.test(t1), `남긴 글 · 입력칸 값은 있고 지운 쪽 글은 없음 ${t1.replace(/\s+/g, ' ').slice(0, 120)}`)
  const od = await PDFDocument.load(outBytes)
  const cat = od.catalog
  ok(!cat.has(PDFName.of('Outlines')) && !cat.has(PDFName.of('AcroForm')) && !cat.has(PDFName.of('Names')) && !cat.has(PDFName.of('Dests')) && !cat.has(PDFName.of('Metadata')), '책갈피 · 입력칸 묶음 · 이름 표 · 첨부 · XMP 없음')
  const an = od.getPages()[0].node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  const kept = an ? an.asArray().map((r) => od.context.lookup(r)) : []
  ok(kept.length === 2 && kept.some((a) => a.lookupMaybe(PDFName.of('A'), PDFDict)?.lookup(PDFName.of('URI'))?.decodeText() === 'https://example.com/') && kept.every((a) => !a.has(PDFName.of('P')) && !a.has(PDFName.of('Popup')) && !a.has(PDFName.of('Dest'))), '바깥 링크 · 모양 없는 메모만 남음 (쪽을 가리키는 열쇠 없이)')
  ok(od.getPageCount() === 3 && od.getPages()[1].getRotation().angle === 180 && od.getPages()[2].getSize().width === 300, '쪽 수 · 돌림 · 빈 쪽')
  const imgs = [...od.context.enumerateIndirectObjects()].filter(([, v]) => v.dict && v.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')).length
  ok(imgs === 2, `그림은 넣은 것 둘뿐 (함께 쓰던 자원의 비밀 그림 없음) — ${imgs}`)

  console.log('\n4. 자리 · 돌림 — 저장한 파일을 pdf.js 로 그려 본다')
  const k = 2
  const r = await render(outBytes, 2, k)
  ok(r.rotate === 180 && Math.round(r.cv.width) === VW * k && Math.round(r.cv.height) === VH * k, `보기 크기 ${r.cv.width}×${r.cv.height}`)
  const at = (v, fx, fy) => px(r, (v.x + v.w * fx) * k, (v.y + v.h * fy) * k)
  ok(near(at(v1, 0.25, 0.25), RED) && near(at(v1, 0.75, 0.25), GREEN) && near(at(v1, 0.25, 0.75), BLUE) && near(at(v1, 0.75, 0.75), YELLOW), `그린 자리에 바로 서서 나옴 ${at(v1, 0.25, 0.25)}`)
  ok(near(at(v1, -0.05, 0.5), [255, 255, 255]) && near(at(v1, 1.05, 0.5), [255, 255, 255]), '틀 밖은 비어 있음 (자리가 밀리지 않음)')
  // 90 도에서 만든 그림을 180 도로 보면 시계 방향 90 도 누움: 왼쪽 위(빨강)가 오른쪽 위로
  ok(near(at(v2, 0.75, 0.25), RED) && near(at(v2, 0.75, 0.75), GREEN) && near(at(v2, 0.25, 0.25), BLUE) && near(at(v2, 0.25, 0.75), YELLOW), '앞서 돌려 만든 그림은 쪽과 함께 돌아 있음')
  ok(near(px(r, 265 * k, 520 * k), [0, 0, 0], 80) && near(px(r, 265 * k, 530 * k), [255, 255, 255]), '선이 그린 자리에')
  const hl = px(r, 90 * k, 420 * k)
  ok(near(hl, [255, 245, 193], 12), `형광펜 (곱하기 · 35%) ${hl}`)
  ok(near(px(r, 200 * k, 580 * k), [0, 0, 255], 90) && near(px(r, 250 * k, 580 * k), [255, 255, 255]), '네모 테두리')
  const [ax, ay] = S.numberAnchor(VW, VH, plan.numbers)
  let dark = 0
  for (let x = ax - 20; x < ax + 20; x++) for (let y = ay - 10; y < ay; y++) if (px(r, x * k, y * k)[0] < 128) dark++
  ok(dark > 10, `쪽 번호가 보이는 쪽 아래 가운데에 (${dark})`)
  const t3 = (await textOf(outBytes)).split('\n')
  ok(/1 \/ 3/.test(t3[0]) && /2 \/ 3/.test(t3[1]) && /3 \/ 3/.test(t3[2]), '쪽 번호 1 / 3 …')

  console.log('\n4-2. 네 가지 돌림 모두 (파일 90 + 사용자 0 · 90 · 180 · 270 = 90 · 180 · 270 · 0)')
  {
    const vrect = { x: 30, y: 50, w: 80, h: 60 }
    const pagesR = [0, 90, 180, 270].map((rot) => {
      const T = (90 + rot) % 360
      return { file: f.id, index: 1, rot, objs: [{ id: 'q', kind: 'image', ...S.viewToObj(vrect, W, H, T), turn: T, asset: 'q' }] }
    })
    const b4 = await call('pdfedit:begin', { mode: 'part', pages: pagesR, numbers: null, watermark: null })
    for (const n of b4.need) await call('pdfedit:put', b4.job, n.key, quad)
    const s4 = await call('pdfedit:finish', b4.job)
    const bytes4 = fs.readFileSync(path.join(dir, s4.name))
    for (let i = 0; i < 4; i++) {
      const rr = await render(bytes4, i + 1, 2)
      const q = (fx, fy) => px(rr, (vrect.x + vrect.w * fx) * 2, (vrect.y + vrect.h * fy) * 2)
      ok(near(q(0.25, 0.25), RED) && near(q(0.75, 0.25), GREEN) && near(q(0.25, 0.75), BLUE) && near(q(0.75, 0.75), YELLOW), `전체 ${rr.rotate}도: 보던 자리에 바로 서서`)
    }
    fs.unlinkSync(path.join(dir, s4.name))
  }

  console.log('\n5. 다시 저장하면 (2) — 덮어쓰지 않음 · 고른 쪽만')
  bg = await call('pdfedit:begin', { mode: 'all', pages: [{ file: f.id, index: 0, rot: 0, objs: [] }] })
  s = await call('pdfedit:finish', bg.job)
  ok(s.ok && s.name === '안내문_편집 (2).pdf', s.name)
  bg = await call('pdfedit:begin', { mode: 'part', pages: [{ file: f.id, index: 2, rot: 0, objs: [] }, { file: f.id, index: 2, rot: 270, objs: [] }] })
  s = await call('pdfedit:finish', bg.job)
  const part = fs.readFileSync(path.join(dir, '안내문_고른 쪽.pdf'))
  const pd = await PDFDocument.load(part)
  ok(s.ok && pd.getPageCount() === 2 && pd.getPages()[1].getRotation().angle === 270 && /SECRET-PAGE-TEXT/.test(await textOf(part)), '같은 쪽을 두 번 · 돌림 따로')
  calls.revealed.length = 0
  ok((await call('pdfedit:reveal', bg.job)) === true && calls.revealed[0] === path.join(dir, '안내문_고른 쪽.pdf'), '저장한 파일 보여 주기')
  ok((await call('pdfedit:reveal', src)) === false, '모르는 값으로는 아무것도 열지 않음')

  console.log('\n6. 완전 가리기 — 쪽 그림만으로')
  const red = { x: 30, y: 178, w: 240, h: 30 } // 첫 쪽 PRIVATE-NAME-HERE (보기 좌표 = 쪽 좌표, 돌림 0)
  const rplan = { mode: 'all', pages: [{ file: f.id, index: 0, rot: 0, objs: [{ id: 'r', kind: 'redact', ...S.viewToObj(red, 400, 500, 0) }] }, { file: f.id, index: 1, rot: 90, objs: [] }, { file: f.id, index: 2, rot: 0, objs: [] }], numbers: null, watermark: { text: '사본', scale: 0.6, opacity: 0.2, color: '#888888' } }
  bg = await call('pdfedit:begin', rplan)
  ok(bg.ok && bg.raster && bg.need.map((n) => n.key).join() === 'r0,r1,r2,wm', `모든 쪽 그림 + 워터마크 (${bg.need && bg.need.map((n) => n.key).join()})`)
  // 화면이 하는 일을 흉내: pdf.js 로 200dpi 그리기 → 가린 칸 검게 → JPEG
  const jpgs = []
  for (let i = 0; i < 3; i++) {
    const g = S.pageGeom(rplan.pages[i], new Map([[f.id, { pages: f.pages }]]))
    const [vw, vh] = S.viewSize(g.w, g.h, g.total)
    const [pw, ph] = S.rasterSize(vw, vh)
    const rr = await render(fs.readFileSync(src), i + 1, pw / vw, rplan.pages[i].rot)
    if (i === 0) { rr.ctx.fillStyle = '#000'; rr.ctx.fillRect(red.x * pw / vw, red.y * ph / vh, red.w * pw / vw, red.h * ph / vh) }
    jpgs.push(new Uint8Array(rr.cv.toBuffer('image/jpeg', 90)))
  }
  ok(!(await call('pdfedit:put', bg.job, 'r0', quad)).ok, 'PNG 는 쪽 그림으로 받지 않음')
  ok(!(await call('pdfedit:put', bg.job, 'r0', jpgs[1])).ok, '크기가 다른 쪽 그림 거절')
  for (let i = 0; i < 3; i++) await call('pdfedit:put', bg.job, `r${i}`, jpgs[i])
  ok(!(await call('pdfedit:finish', bg.job)).ok, '워터마크 그림이 없으면 저장하지 않음')
  const wmc = createCanvas(200, 60)
  wmc.getContext('2d').fillRect(0, 0, 200, 60)
  await call('pdfedit:put', bg.job, 'wm', new Uint8Array(wmc.toBuffer('image/png')))
  s = await call('pdfedit:finish', bg.job)
  const out3 = path.join(dir, s.name || 'x')
  ok(s.ok && s.raster && s.name === '안내문_편집 (3).pdf' && s.notes.some((n) => /그림으로/.test(n)), `그림 저장 ${s.name} ${s.error || ''}`)
  const rb = fs.readFileSync(out3)
  const leak3 = leaks(rb, [...SECRETS, 'PRIVATE-NAME-HERE', 'KEEP-PAGE-ONE', 'FIELD-VALUE-KEEP', 'Helvetica', 'example.com'])
  ok(leak3.length === 0, `원본의 글 · 글꼴 · 링크가 바이트 어디에도 없음 ${leak3.join(' ')}`)
  const t4 = await textOf(rb)
  ok(!/[A-Z]{4}/.test(t4), `글 뽑기로 나오는 것 없음 '${t4.trim().slice(0, 40)}'`)
  const rd = await PDFDocument.load(rb)
  const kinds = [...rd.context.enumerateIndirectObjects()].map(([, v]) => (v.dict ? String(v.dict.get(PDFName.of('Subtype'))) : String(v.get && v.get(PDFName.of('Type')))))
  ok(rd.getPageCount() === 3 && kinds.filter((x) => x === '/Image').length === 4 && !rd.getPages().some((p) => p.node.has(PDFName.of('Annots'))), `쪽 3 · 그림 4(쪽 셋 + 워터마크 한 벌) · 주석 없음 (${kinds.filter((x) => x === '/Image').length})`)
  ok(rd.getPages()[1].getSize().width === 400 && rd.getPages()[1].getSize().height === 640 && rd.getPages()[1].getRotation().angle === 0, `돌린 쪽은 보이는 대로 (파일 90 + 더 90 = 180) ${JSON.stringify(rd.getPages()[1].getSize())}`)
  const rr = await render(rb, 1, 1)
  ok(near(px(rr, red.x + red.w / 2, red.y + red.h / 2), [0, 0, 0], 70) && near(px(rr, 100, 190), [0, 0, 0], 70), '가린 칸은 검게')
  let keepDark = 0
  for (let x = 40; x < 200; x++) for (let y = 66; y < 81; y++) if (px(rr, x, y)[0] < 128) keepDark++
  ok(keepDark > 40 && near(px(rr, 330, 450), [255, 255, 255], 70), `나머지 쪽 내용은 그대로 보임 (${keepDark})`)

  console.log('\n7. 원본이 바뀌면 저장하지 않음')
  fs.appendFileSync(src, '\n% changed\n')
  bg = await call('pdfedit:begin', { mode: 'all', pages: [{ file: f.id, index: 0, rot: 0, objs: [] }] })
  s = await call('pdfedit:finish', bg.job)
  ok(!s.ok && /바뀌었/.test(s.error), s.error)
  ok(!(await call('pdfedit:bytes', f.id)).ok, '바뀐 원본은 다시 받지 못함')
  await call('pdfedit:forget', [f.id])
  bg = await call('pdfedit:begin', { mode: 'all', pages: [{ file: f.id, index: 0, rot: 0, objs: [] }] })
  ok(!bg.ok, '뺀 파일은 잊음')
  const leftovers = fs.readdirSync(dir).filter((n) => !/^(안내문|깨진|암호)/.test(n))
  ok(leftovers.length === 0, `다른 파일을 만들지 않음 ${leftovers.join()}`)

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
