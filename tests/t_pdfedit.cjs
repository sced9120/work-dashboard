// PDF 편집 — 좌표 · 돌림 · 쪽 상자 · 저장 계획 검사 (빌드 없이). 좌표는 pdf.js 의 viewport 와 맞춰 본다.
const path = require('path')
const { pathToFileURL } = require('url')
const { PDFDocument, PDFName } = require(path.join(__dirname, '../node_modules/pdf-lib'))
const { loadShared } = require('./tsload.cjs')
const S = loadShared('pdfedit')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const close = (a, b, e = 1e-6) => Math.abs(a - b) <= e
const closeR = (a, b) => ['x', 'y', 'w', 'h'].every((k) => close(a[k], b[k], 1e-9))

;(async () => {
  console.log('1. 돌림 · 쪽 상자')
  ok([0, 90, 180, 270, 360, 450, -90, -270, 45, 'x', NaN].map(S.normRotate).join() === '0,90,180,270,0,90,270,90,0,0,0', '/Rotate 고치기 (pdf.js 와 같게)')
  ok(S.effectiveBox([0, 0, 600, 800], [40, 50, 560, 750]).join() === '40,50,560,750', 'CropBox')
  ok(S.effectiveBox([600, 800, 0, 0], null).join() === '0,0,600,800', '거꾸로 적은 MediaBox')
  ok(S.effectiveBox([0, 0, 600, 800], [500, 700, 900, 1000]).join() === '500,700,600,800', 'MediaBox 밖으로 나간 CropBox 는 겹친 곳만')
  ok(S.effectiveBox([0, 0, 600, 800], [700, 900, 800, 1000]).join() === '0,0,600,800', '겹치지 않는 CropBox 는 무시')
  ok(S.effectiveBox([0, 0, 0, 0], null).join() === '0,0,612,792' && S.effectiveBox('x', [1, 2]).join() === '0,0,612,792', '빈 상자는 Letter')

  console.log('\n2. 보기 ↔ PDF — pdf.js viewport 와 같은지 (네 돌림 · 원점이 0 이 아닌 CropBox)')
  const pdfjs = await import(pathToFileURL(path.join(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href)
  const doc = await PDFDocument.create()
  const pg = doc.addPage([600, 800])
  pg.node.set(PDFName.of('CropBox'), doc.context.obj([40, 50, 560, 750]))
  pg.node.set(PDFName.of('Rotate'), doc.context.obj(270))
  const d = await pdfjs.getDocument({ data: await doc.save(), verbosity: 0 }).promise
  const p = await d.getPage(1)
  const box = p.view
  let same = true
  for (const R of [0, 90, 180, 270]) {
    const vp = p.getViewport({ scale: 1, rotation: R })
    const M = S.viewToPdfMat(box, R)
    const [vw, vh] = S.viewSize(box[2] - box[0], box[3] - box[1], R)
    same = same && close(vp.width, vw) && close(vp.height, vh)
    for (const [u, v] of [[0, 0], [vw, 0], [0, vh], [123.4, 56.7], [vw, vh]]) {
      const a = vp.convertToPdfPoint(u, v)
      const b = S.apply(M, u, v)
      if (!close(a[0], b[0], 1e-6) || !close(a[1], b[1], 1e-6)) {
        same = false
        console.log('    다름', R, u, v, a, b)
      }
    }
  }
  ok(same && p.rotate === 270, '보기 크기 · 네 모서리 · 가운데 점이 모두 같음')
  await d.destroy()

  console.log('\n3. 쪽 좌표 ↔ 보기 좌표')
  const W = 520, H = 700
  const o = { x: 0.1, y: 0.2, w: 0.3, h: 0.15 }
  ok([0, 90, 180, 270].every((R) => closeR(S.viewToObj(S.objToView(o, W, H, R), W, H, R), o)), '갔다 오면 그대로')
  const v90 = S.objToView(o, W, H, 90)
  ok(close(v90.w, o.h * H) && close(v90.h, o.w * W) && close(v90.x, H - (o.y + o.h) * H) && close(v90.y, o.x * W), '90도: 위 왼쪽 모서리가 오른쪽 위로')
  // 틀: 90 도에서 만든 그림은 90 도 보기에서 바로 선다
  const fr = S.frameOf(o, 90, W, H)
  const corner = S.apply(S.pageToViewMat(W, H, 90), ...S.apply(fr.m, 0, 0))
  ok(close(fr.cw, v90.w) && close(fr.ch, v90.h) && close(corner[0], v90.x) && close(corner[1], v90.y), '틀의 왼쪽 위 = 그 돌림의 보기에서 왼쪽 위')
  const u = S.frameUnit(o, 0, W, H)
  ok(close(S.apply(u, 1, 1)[0], (o.x + o.w) * W) && close(S.apply(u, 1, 1)[1], (o.y + o.h) * H), '단위 네모 → 쪽 pt')
  ok(S.mul(S.invert([2, 1, -1, 3, 5, 7]), [2, 1, -1, 3, 5, 7]).every((n, i) => close(n, S.IDENT[i], 1e-12)), '거꾸로 행렬')

  console.log('\n4. 옮기기 · 크기 바꾸기')
  const line = S.cleanObj({ id: 'l', kind: 'line', pts: [[0.1, 0.1], [0.5, 0.3]], color: '#FF0000', width: 3 })
  ok(line && close(line.w, 0.4) && close(line.h, 0.2) && line.color === '#ff0000', '선의 감싸는 네모')
  const mv = S.moveObj(line, 0.1, 0.1)
  ok(close(mv.pts[1][0], 0.6) && close(mv.x, 0.2), '선 옮기기')
  const rs = S.resizeObj(line, { x: 0.1, y: 0.1, w: 0.8, h: 0.4 })
  ok(close(rs.pts[1][0], 0.9) && close(rs.pts[1][1], 0.5), '선 늘이기')

  console.log('\n5. 그린 것 검사')
  ok(S.cleanObj({ kind: 'script', x: 0 }) === null && S.cleanObj(null) === null && S.cleanObj({ kind: 'text', text: '  ', x: 0, y: 0, w: 1, h: 1 }) === null, '모르는 것 · 빈 글 빼기')
  const t = S.cleanObj({ id: 'x'.repeat(200), kind: 'text', text: 'a'.repeat(5000), size: 1e9, color: 'red', x: -9, y: 9, w: 99, h: 0.1, turn: 45 })
  ok(t.id.length === 64 && t.text.length === S.PE_MAX_TEXT && t.size === 200 && t.color === '#000000' && t.x === -1 && t.y === 2 && t.w === 3 && t.turn === 0, '길이 · 크기 · 색 · 자리 한도')
  ok(S.cleanObj({ kind: 'image', x: 0, y: 0, w: 1, h: 1 }) === null, '그림 번호 없는 그림 빼기')
  ok(S.cleanObj({ kind: 'pen', pts: [[0, 0]] }) === null && S.cleanObj({ kind: 'pen', pts: Array.from({ length: 9000 }, (_, i) => [i / 9000, 0]) }).pts.length === S.PE_MAX_PTS, '펜 점 수 한도')
  ok(!S.visibleObj(S.cleanObj({ kind: 'redact', x: 0.5, y: 0.5, w: 0, h: 0.2 })) && S.visibleObj(S.cleanObj({ kind: 'line', pts: [[0, 0], [0.5, 0]] })), '크기 없는 것은 저장하지 않음 (가로선은 됨)')

  console.log('\n6. 저장 계획')
  const src = new Map([['A', { pages: [{ w: 595, h: 842, rotate: 0 }, { w: 520, h: 700, rotate: 90 }] }]])
  let c = S.checkPlan({ mode: 'all', pages: [{ file: 'A', index: 0, rot: 0, objs: [{ kind: 'text', text: '가', x: 0, y: 0, w: 0.1, h: 0.1 }, { kind: 'rect', x: 0, y: 0, w: 0.1, h: 0.1 }] }, { file: 'A', index: 1, rot: 90, objs: [] }] }, src)
  ok(c.ok && !c.raster && c.need.map((n) => n.key).join() === 'f0_0', `보통: 글만 그림으로 (${c.ok && c.need.map((n) => n.key).join()})`)
  ok(S.checkPlan(c.plan, src).ok && JSON.stringify(S.checkPlan(c.plan, src).plan) === JSON.stringify(c.plan), '검사한 계획을 다시 검사해도 같음 (화면 · 메인의 번호가 맞는다)')
  c = S.checkPlan({ mode: 'part', pages: [{ file: 'A', index: 0, rot: 0, objs: [{ kind: 'redact', x: 0, y: 0, w: 0.1, h: 0.1 }] }, { blank: { w: 300, h: 300 }, rot: 0, objs: [] }], watermark: { text: ' 사본 ', scale: 9, opacity: 9, color: '#123456' } }, src)
  ok(c.ok && c.raster && c.need.map((n) => n.key).join() === 'r0,r1,wm' && c.plan.watermark.text === '사본' && c.plan.watermark.scale === 1.2 && c.plan.watermark.opacity === 0.6, '가리기가 있으면 모든 쪽을 그림으로 · 워터마크 한도')
  ok(!S.checkPlan({ pages: [] }, src).ok && !S.checkPlan({ pages: [{ file: 'B', index: 0 }] }, src).ok && !S.checkPlan({ pages: [{ file: 'A', index: 2 }] }, src).ok && !S.checkPlan({ pages: [{ file: 'A', index: 0.5 }] }, src).ok, '빈 계획 · 모르는 파일 · 없는 쪽 · 소수 쪽')
  ok(!S.checkPlan({ pages: [{ blank: { w: 10, h: 10 } }] }, src).ok && !S.checkPlan({ pages: [{ file: 'A', index: 0, objs: Array(S.PE_MAX_OBJS + 1).fill({ kind: 'redact' }) }] }, src).ok, '빈 쪽 크기 · 그린 것 수 한도')
  const g = S.pageGeom({ file: 'A', index: 1, rot: 270 }, src)
  ok(g.total === 0 && g.w === 520, '파일 90 + 사용자 270 = 0')
  const [rw, rh] = S.rasterSize(595, 842)
  ok(rw === Math.round((595 * 200) / 72) && rh === Math.round((842 * 200) / 72), `200dpi 쪽 그림 ${rw}×${rh}`)
  const [bw, bh] = S.rasterSize(5000, 5000)
  ok(bw <= S.PE_RASTER_MAX_SIDE && bw * bh <= S.PE_RASTER_MAX_AREA, '큰 쪽은 줄임')

  console.log('\n7. 이름 · 쪽 번호 · 그림 파일')
  ok(S.outputStem('안내문.PDF', 'all') === '안내문_편집' && S.outputStem('.pdf', 'part') === '문서_고른 쪽', '저장 이름')
  ok(S.numberText(3, 10, 'plain') === '3' && S.numberText(3, 10, 'dash') === '- 3 -' && S.numberText(3, 10, 'total') === '3 / 10', '쪽 번호 모양')
  ok(S.pageList([0, 1, 2, 5, 7, 8]) === '1-3, 6, 8-9', '쪽 묶음 글')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DAwPAfAAcCAf9PcHyiAAAAAElFTkSuQmCC', 'base64')
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 30, 0, 40, 3, 1, 0x22, 0])
  ok(JSON.stringify(S.imageInfo(png)) === '{"type":"png","w":2,"h":1}' && JSON.stringify(S.imageInfo(jpg)) === '{"type":"jpeg","w":40,"h":30}' && S.imageInfo(Buffer.from('GIF89a')) === null, 'PNG · JPEG 크기 읽기')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})()
