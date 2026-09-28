import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import PptxGenJS from 'pptxgenjs'
import type { Deck, DesignSource, Slide, SlideTheme } from '../../shared/slides'
import { BUILTIN_DESIGNS } from '../../shared/slides'

/**
 * 발표자료(.pptx)를 만든다. 두 갈래가 있다.
 *
 * 1. 기본 디자인·DESIGN.md — 색과 글꼴만 정해져 있으므로 pptxgenjs 로 직접 그린다.
 * 2. 참고 PPT — 그 파일의 슬라이드 마스터·레이아웃·테마를 **그대로 두고** 슬라이드만
 *    갈아 끼운다. 학교 PPT 는 배경 무늬·장식이 마스터에 들어 있는 경우가 많아서,
 *    색만 뽑아 쓰면 전혀 다른 모양이 된다. 제목·본문은 레이아웃의 자리표시자에 넣어
 *    글꼴·크기·글머리표가 원래 파일과 똑같이 나온다.
 */

const FALLBACK_FONT = '맑은 고딕'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML 에 넣을 수 없는 제어 문자
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

/* ════════════════ 1. 기본 디자인 ════════════════ */

const W = 13.333
const H = 7.5
const M = 0.6

/** 글이 많을수록 글자를 줄인다. PowerPoint 는 열 때 자동 맞춤을 다시 계산하지 않는다. */
function bulletSize(lines: string[]): number {
  const chars = lines.reduce((n, l) => n + l.length, 0)
  if (lines.length > 6 || chars > 360) return 16
  if (lines.length > 5 || chars > 260) return 18
  if (lines.length > 4 || chars > 180) return 20
  return 22
}

/**
 * 카드 높이(인치). 글이 짧은데 카드만 길면 빈 곳이 커 보여서, 글 양에 맞춰 줄인다.
 * 한글 한 글자는 대략 글자 크기만큼 폭을 차지한다고 보고 줄 수를 어림한다.
 */
function cardHeight(cards: { title: string; body: string }[], widthIn: number, titlePt: number, bodyPt: number, maxIn: number): number {
  const lines = (s: string, pt: number): number => Math.max(1, Math.ceil(s.length / Math.max(4, Math.floor((widthIn * 72) / pt))))
  const need = Math.max(
    ...cards.map((c) => 0.45 + (lines(c.title, titlePt) * titlePt * 1.25) / 72 + 0.3 + (lines(c.body, bodyPt) * bodyPt * 1.4) / 72 + 0.35)
  )
  return Math.min(maxIn, Math.max(1.9, need))
}

export async function buildWithTheme(deck: Deck, t: SlideTheme): Promise<Uint8Array> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.title = deck.title
  pptx.theme = { headFontFace: t.titleFont, bodyFontFace: t.bodyFont }

  const onDark = (hex: string): boolean => {
    const n = parseInt(hex, 16)
    const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
    return lum < 128
  }

  pptx.defineSlideMaster({
    title: 'BODY',
    background: { color: t.bg },
    objects: [
      { rect: { x: 0, y: 0, w: W, h: 0.12, fill: { color: t.accent } } },
      {
        text: {
          text: deck.title,
          options: { x: M, y: H - 0.5, w: 8, h: 0.3, fontFace: t.bodyFont, fontSize: 10, color: t.muted }
        }
      }
    ],
    slideNumber: { x: W - 1.1, y: H - 0.5, w: 0.6, h: 0.3, fontFace: t.bodyFont, fontSize: 10, color: t.muted, align: 'right' }
  })

  const cover = (s: Slide, closing: boolean): void => {
    const sl = pptx.addSlide()
    const bg = t.darkCover ? t.deep : t.bg
    const fg = onDark(bg) ? 'FFFFFF' : t.deep
    const soft = onDark(bg) ? 'D9DEE7' : t.muted
    sl.background = { color: bg }
    sl.addShape('rect', { x: 0, y: H - 0.35, w: W, h: 0.35, fill: { color: t.accent } })
    const y = closing ? 2.6 : 2.2
    sl.addText(s.title || (closing ? '감사합니다' : deck.title), {
      x: M + 0.2, y, w: W - 2 * M - 0.4, h: 1.4,
      fontFace: t.titleFont, fontSize: closing ? 36 : 40, bold: true, color: fg, valign: 'bottom', fit: 'shrink'
    })
    sl.addShape('rect', { x: M + 0.25, y: y + 1.55, w: 1.1, h: 0.07, fill: { color: t.accent } })
    if (s.sub) {
      sl.addText(s.sub, {
        x: M + 0.2, y: y + 1.75, w: W - 2 * M - 0.4, h: 1.2,
        fontFace: t.bodyFont, fontSize: 18, color: soft, valign: 'top'
      })
    }
    if (s.notes) sl.addNotes(s.notes)
  }

  for (const s of deck.slides) {
    if (s.kind === '표지' || s.kind === '마무리') {
      cover(s, s.kind === '마무리')
      continue
    }
    if (s.kind === '구역') {
      const sl = pptx.addSlide()
      sl.background = { color: t.surface }
      sl.addShape('rect', { x: 0, y: 0, w: 0.35, h: H, fill: { color: t.accent } })
      sl.addText(s.title, {
        x: 1.1, y: 2.4, w: W - 2.2, h: 1.3,
        fontFace: t.titleFont, fontSize: 34, bold: true, color: onDark(t.surface) ? 'FFFFFF' : t.deep, valign: 'bottom', fit: 'shrink'
      })
      if (s.sub) {
        sl.addText(s.sub, { x: 1.1, y: 3.8, w: W - 2.2, h: 1.2, fontFace: t.bodyFont, fontSize: 18, color: t.muted, valign: 'top' })
      }
      if (s.notes) sl.addNotes(s.notes)
      continue
    }

    const sl = pptx.addSlide({ masterName: 'BODY' })
    sl.addText(s.title, {
      x: M, y: 0.4, w: W - 2 * M, h: 0.95,
      fontFace: t.titleFont, fontSize: 28, bold: true, color: onDark(t.bg) ? 'FFFFFF' : t.deep, valign: 'middle', fit: 'shrink'
    })
    const top = 1.55
    const areaH = H - top - 0.75

    if (s.kind === '카드' && s.cards?.length) {
      const n = s.cards.length
      const grid = n === 4 && s.cards.some((c) => c.body.length > 50)
      const cols = grid ? 2 : n
      const rows = grid ? 2 : 1
      const gap = 0.3
      const cw = (W - 2 * M - gap * (cols - 1)) / cols
      const titlePt = cols >= 4 ? 17 : 20
      const bodyPt = cols >= 4 ? 14 : 16
      const ch = cardHeight(s.cards, cw - 0.5, titlePt, bodyPt, (areaH - gap * (rows - 1)) / rows)
      // 카드 묶음을 본문 영역 가운데보다 조금 위에 둔다
      const startY = top + Math.max(0, (areaH - (ch * rows + gap * (rows - 1))) * 0.4)
      s.cards.forEach((c, i) => {
        const x = M + (i % cols) * (cw + gap)
        const y = startY + Math.floor(i / cols) * (ch + gap)
        sl.addShape('roundRect', { x, y, w: cw, h: ch, fill: { color: t.surface }, line: { color: t.surface }, rectRadius: 0.1 })
        sl.addShape('rect', { x, y: y + 0.25, w: 0.08, h: 0.55, fill: { color: t.accent } })
        sl.addText(c.title, {
          x: x + 0.3, y: y + 0.18, w: cw - 0.5, h: 0.7,
          fontFace: t.titleFont, fontSize: titlePt, bold: true, color: t.accent, valign: 'middle', fit: 'shrink'
        })
        sl.addText(c.body, {
          x: x + 0.3, y: y + 0.95, w: cw - 0.5, h: ch - 1.15,
          fontFace: t.bodyFont, fontSize: bodyPt, color: t.ink, valign: 'top', fit: 'shrink'
        })
      })
    } else if (s.kind === '표' && s.table?.length) {
      const rows = s.table
      const size = rows.length > 6 || rows[0].length > 4 ? 14 : 16
      sl.addTable(
        rows.map((r, i) =>
          r.map((cell) => ({
            text: cell,
            options:
              i === 0
                ? { bold: true, color: 'FFFFFF', fill: { color: t.deep } }
                : { color: t.ink, fill: { color: i % 2 === 0 ? t.surface : t.bg } }
          }))
        ),
        {
          x: M, y: top + 0.1, w: W - 2 * M,
          fontFace: t.bodyFont, fontSize: size, valign: 'middle', align: 'center',
          border: { type: 'solid', pt: 0.75, color: 'C8CDD6' },
          rowH: Math.min(0.62, areaH / rows.length), autoPage: false
        }
      )
    } else {
      const lines = s.bullets?.length ? s.bullets : s.sub ? [s.sub] : []
      if (lines.length) {
        sl.addText(
          lines.map((b) => ({ text: b, options: { bullet: { indent: 18 }, breakLine: true } })),
          {
            x: M + 0.2, y: top, w: W - 2 * M - 0.4, h: areaH,
            fontFace: t.bodyFont, fontSize: bulletSize(lines), color: t.ink, valign: 'top',
            paraSpaceAfter: 10, lineSpacingMultiple: 1.1
          }
        )
      }
    }
    if (s.notes) sl.addNotes(s.notes)
  }

  const out = (await pptx.write({ outputType: 'uint8array' })) as Uint8Array
  return out
}

/* ════════════════ 2. 참고 PPT 로 만들기 ════════════════ */

type Files = Record<string, Uint8Array>

const REL_SLIDE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'
const REL_LAYOUT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout'
const REL_NOTES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide'
const REL_NOTES_MASTER = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster'
const REL_THEME = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme'
const REL_THUMB = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail'
const CT_SLIDE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
const CT_NOTES = 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml'
const CT_NOTES_MASTER = 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml'
const CT_THEME = 'application/vnd.openxmlformats-officedocument.theme+xml'
const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'

interface Rel {
  id: string
  type: string
  target: string
  external: boolean
}

const text = (files: Files, p: string): string => (files[p] ? strFromU8(files[p]) : '')

function relsPath(part: string): string {
  const at = part.lastIndexOf('/')
  return `${part.slice(0, at + 1)}_rels/${part.slice(at + 1)}.rels`
}

function attr(tag: string, name: string): string {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? ''
}

function readRels(files: Files, part: string): Rel[] {
  const xml = text(files, part.endsWith('.rels') ? part : relsPath(part))
  return [...xml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => ({
    id: attr(m[0], 'Id'),
    type: attr(m[0], 'Type'),
    target: attr(m[0], 'Target'),
    external: attr(m[0], 'TargetMode') === 'External'
  }))
}

/** rels 의 Target 을 zip 안의 경로로 바꾼다 */
function resolve(fromPart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = fromPart.split('/').slice(0, -1)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

function writeRels(rels: Rel[]): string {
  const body = rels
    .map(
      (r) =>
        `<Relationship Id="${esc(r.id)}" Type="${esc(r.type)}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`
}

interface Layout {
  path: string
  type: string
  name: string
  /** 레이아웃에 있는 자리표시자 원문(<p:ph .../>) */
  phs: string[]
}

function readLayout(files: Files, path: string): Layout {
  const xml = text(files, path)
  const head = /<p:sldLayout\b[^>]*>/.exec(xml)?.[0] ?? ''
  return {
    path,
    type: attr(head, 'type'),
    name: attr(/<p:cSld\b[^>]*>/.exec(xml)?.[0] ?? '', 'name'),
    phs: [...xml.matchAll(/<p:ph\b[^>]*\/>/g)].map((m) => m[0])
  }
}

const phType = (ph: string): string => attr(ph, 'type') || 'obj'
const isTitle = (ph: string): boolean => ['title', 'ctrTitle'].includes(phType(ph))
const isBody = (ph: string): boolean => ['obj', 'body', 'subTitle'].includes(phType(ph)) && attr(ph, 'orient') !== 'vert'

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 레이아웃(없으면 마스터)의 본문 자리표시자 위치. 카드·표를 그 안에 놓는다. */
function bodyBox(files: Files, layoutPath: string, masterPath: string, size: { w: number; h: number }): Box {
  const find = (xml: string): Box | null => {
    for (const m of xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
      const ph = /<p:ph\b[^>]*\/>/.exec(m[0])?.[0]
      if (!ph || !isBody(ph) || phType(ph) === 'subTitle') continue
      const off = /<a:off x="(\d+)" y="(\d+)"\/>/.exec(m[0])
      const ext = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(m[0])
      if (off && ext) return { x: +off[1], y: +off[2], w: +ext[1], h: +ext[2] }
    }
    return null
  }
  return (
    find(text(files, layoutPath)) ??
    find(text(files, masterPath)) ?? {
      x: Math.round(size.w * 0.07),
      y: Math.round(size.h * 0.24),
      w: Math.round(size.w * 0.86),
      h: Math.round(size.h * 0.66)
    }
  )
}

function run(t: string, props = '', fill = ''): string {
  const rPr = fill
    ? `<a:rPr lang="ko-KR" altLang="en-US" dirty="0"${props}><a:solidFill>${fill}</a:solidFill></a:rPr>`
    : `<a:rPr lang="ko-KR" altLang="en-US" dirty="0"${props}/>`
  return `<a:r>${rPr}<a:t>${esc(t)}</a:t></a:r>`
}

function paras(lines: string[]): string {
  if (!lines.length) return '<a:p><a:endParaRPr lang="ko-KR" altLang="en-US" dirty="0"/></a:p>'
  return lines.map((l) => `<a:p>${run(l)}</a:p>`).join('')
}

function fitFor(lines: string[]): string {
  const chars = lines.reduce((n, l) => n + l.length, 0)
  if (lines.length > 6 || chars > 360) return '<a:normAutofit fontScale="70000" lnSpcReduction="20000"/>'
  if (lines.length > 5 || chars > 240) return '<a:normAutofit fontScale="85000" lnSpcReduction="10000"/>'
  return '<a:normAutofit/>'
}

let shapeId = 1

function phShape(ph: string, name: string, lines: string[], fit = ''): string {
  shapeId++
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="${esc(name)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr>${fit}</a:bodyPr><a:lstStyle/>${paras(lines)}</p:txBody></p:sp>`
  )
}

const tint = '<a:schemeClr val="accent1"><a:lumMod val="20000"/><a:lumOff val="80000"/></a:schemeClr>'
const shade = '<a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr>'

function cardShapes(cards: { title: string; body: string }[], box: Box): string {
  const n = cards.length
  const EMU = 914400
  const gap = Math.round(0.25 * EMU)
  const grid = n === 4 && (box.w - gap * 3) / 4 < 2.2 * EMU
  const cols = grid ? 2 : n
  const rows = grid ? 2 : 1
  const cw = Math.round((box.w - gap * (cols - 1)) / cols)
  const titleSz = cols >= 4 ? 1600 : 2000
  const bodySz = cols >= 4 ? 1300 : 1600
  const maxCh = (box.h - gap * (rows - 1)) / rows
  const ch = Math.round(cardHeight(cards, (cw - 324000) / EMU, titleSz / 100, bodySz / 100, maxCh / EMU) * EMU)
  const startY = box.y + Math.max(0, Math.round((box.h - (ch * rows + gap * (rows - 1))) * 0.4))
  return cards
    .map((c, i) => {
      shapeId++
      const x = box.x + (i % cols) * (cw + gap)
      const y = startY + Math.floor(i / cols) * (ch + gap)
      return (
        `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="카드 ${i + 1}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
        `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cw}" cy="${ch}"/></a:xfrm>` +
        `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 6000"/></a:avLst></a:prstGeom>` +
        `<a:solidFill>${tint}</a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>` +
        `<p:txBody><a:bodyPr wrap="square" lIns="162000" tIns="162000" rIns="162000" bIns="162000" anchor="t"><a:normAutofit/></a:bodyPr><a:lstStyle/>` +
        `<a:p><a:pPr algn="l"><a:buNone/></a:pPr>${run(c.title, ` sz="${titleSz}" b="1"`, shade)}</a:p>` +
        `<a:p><a:pPr algn="l"><a:spcBef><a:spcPts val="900"/></a:spcBef><a:buNone/></a:pPr>${run(c.body, ` sz="${bodySz}"`, '<a:schemeClr val="tx1"/>')}</a:p>` +
        `</p:txBody></p:sp>`
      )
    })
    .join('')
}

function tableFrame(rows: string[][], box: Box): string {
  shapeId++
  const cols = Math.max(1, ...rows.map((r) => r.length))
  const colW = Math.floor(box.w / cols)
  const rowH = Math.min(Math.floor(box.h / Math.max(1, rows.length)), 560000)
  const sz = rows.length > 6 || cols > 4 ? 1400 : 1600
  const cell = (t: string): string =>
    `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/>${run(t, ` sz="${sz}"`)}</a:p></a:txBody><a:tcPr anchor="ctr"/></a:tc>`
  return (
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${shapeId}" name="표 1"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${colW * cols}" cy="${rowH * rows.length}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>` +
    // PowerPoint 에 들어 있는 '보통 스타일 2 - 강조 1'. 참고 파일의 강조색을 따른다.
    `<a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId></a:tblPr>` +
    `<a:tblGrid>${Array.from({ length: cols }, () => `<a:gridCol w="${colW}"/>`).join('')}</a:tblGrid>` +
    rows
      .map((r) => `<a:tr h="${rowH}">${Array.from({ length: cols }, (_, i) => cell(r[i] ?? '')).join('')}</a:tr>`)
      .join('') +
    `</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  )
}

function slideXml(shapes: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld ${NS}><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  )
}

function notesXml(notes: string): string {
  const lines = notes.split('\n').map((l) => l.trim())
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:notes ${NS}><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="슬라이드 이미지 개체 틀 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="슬라이드 노트 개체 틀 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${paras(lines)}</p:txBody></p:sp>` +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
  )
}

function setContentTypes(files: Files, add: Record<string, string>): void {
  let ct = text(files, '[Content_Types].xml')
  // 없어진 부분의 Override 는 지운다
  ct = ct.replace(/<Override\b[^>]*\/>/g, (tag) => {
    const part = attr(tag, 'PartName').replace(/^\//, '')
    return files[part] ? tag : ''
  })
  const extra = Object.entries(add)
    .map(([part, type]) => `<Override PartName="/${part}" ContentType="${type}"/>`)
    .join('')
  ct = ct.replace('</Types>', `${extra}</Types>`)
  files['[Content_Types].xml'] = strToU8(ct)
}

/** _rels/.rels 에서 시작해 닿지 않는 부분(지운 슬라이드의 그림·메모 등)을 모두 지운다 */
function dropUnreachable(files: Files): void {
  const keep = new Set<string>(['[Content_Types].xml', '_rels/.rels'])
  const queue: string[] = []
  for (const r of readRels(files, '_rels/.rels')) {
    if (r.external) continue
    const p = resolve('', r.target)
    if (!keep.has(p)) {
      keep.add(p)
      queue.push(p)
    }
  }
  while (queue.length) {
    const part = queue.shift() as string
    const rp = relsPath(part)
    if (!files[rp]) continue
    keep.add(rp)
    for (const r of readRels(files, rp)) {
      if (r.external) continue
      const p = resolve(part, r.target)
      if (!keep.has(p)) {
        keep.add(p)
        queue.push(p)
      }
    }
  }
  for (const name of Object.keys(files)) if (!keep.has(name) && !name.endsWith('/')) delete files[name]
}

/** 참고 파일에 발표 메모 틀이 없으면 pptxgenjs 가 만드는 기본 틀을 옮겨 심는다 */
async function ensureNotesMaster(files: Files, presRels: Rel[]): Promise<void> {
  if (presRels.some((r) => r.type === REL_NOTES_MASTER)) return
  const blank = new PptxGenJS()
  blank.addSlide().addNotes(' ')
  const donor = unzipSync((await blank.write({ outputType: 'uint8array' })) as Uint8Array)
  const nmPath = 'ppt/notesMasters/notesMaster1.xml'
  const donorTheme = readRels(donor, nmPath).find((r) => r.type === REL_THEME)
  if (!donor[nmPath] || !donorTheme) return

  const themes = Object.keys(files).filter((p) => /^ppt\/theme\/theme\d+\.xml$/.test(p))
  const n = Math.max(0, ...themes.map((p) => Number(/(\d+)\.xml$/.exec(p)?.[1] ?? 0))) + 1
  const themePath = `ppt/theme/theme${n}.xml`
  files[themePath] = donor[resolve(nmPath, donorTheme.target)]
  files[nmPath] = donor[nmPath]
  files[relsPath(nmPath)] = strToU8(
    writeRels([{ id: 'rId1', type: REL_THEME, target: `../theme/theme${n}.xml`, external: false }])
  )
  const id = nextRelId(presRels)
  presRels.push({ id, type: REL_NOTES_MASTER, target: 'notesMasters/notesMaster1.xml', external: false })

  let pres = text(files, 'ppt/presentation.xml')
  pres = pres.replace(/<p:notesMasterIdLst>[\s\S]*?<\/p:notesMasterIdLst>/, '')
  pres = pres.replace('</p:sldMasterIdLst>', `</p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="${id}"/></p:notesMasterIdLst>`)
  files['ppt/presentation.xml'] = strToU8(pres)
  setContentTypes(files, { [nmPath]: CT_NOTES_MASTER, [themePath]: CT_THEME })
}

function nextRelId(rels: Rel[]): string {
  let n = rels.length + 1
  while (rels.some((r) => r.id === `rId${n}`)) n++
  return `rId${n}`
}

export async function buildFromTemplate(deck: Deck, template: Uint8Array): Promise<{ data: Uint8Array; notes: string[] }> {
  const files: Files = unzipSync(template)
  const presPath = 'ppt/presentation.xml'
  let pres = text(files, presPath)
  if (!pres) throw new Error('PowerPoint 파일(.pptx)이 아닙니다.')
  const said: string[] = []

  const size = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(pres)
  const slideSize = { w: size ? +size[1] : 12192000, h: size ? +size[2] : 6858000 }

  // 첫 번째 마스터와 그 레이아웃
  const presRels = readRels(files, presPath)
  const masterRel = presRels.find((r) => r.type.endsWith('/slideMaster'))
  if (!masterRel) throw new Error('이 파일에서 슬라이드 마스터를 찾지 못했습니다.')
  const masterPath = resolve(presPath, masterRel.target)
  const layouts = readRels(files, masterPath)
    .filter((r) => r.type === REL_LAYOUT)
    .map((r) => readLayout(files, resolve(masterPath, r.target)))
  if (!layouts.length) throw new Error('이 파일에서 슬라이드 레이아웃을 찾지 못했습니다.')

  const byType = (...types: string[]): Layout | undefined => {
    for (const t of types) {
      const hit = layouts.find((l) => l.type === t)
      if (hit) return hit
    }
    return undefined
  }
  const withTitleBody = layouts.find((l) => l.phs.some(isTitle) && l.phs.some((p) => isBody(p) && phType(p) !== 'subTitle'))
  const withTitle = layouts.find((l) => l.phs.some(isTitle))
  const content = byType('obj', 'tx') ?? withTitleBody ?? withTitle ?? layouts[0]
  const cover = byType('title') ?? layouts.find((l) => l.phs.some((p) => phType(p) === 'ctrTitle')) ?? content
  const section = byType('secHead') ?? cover
  const titleOnly = byType('titleOnly') ?? content
  said.push(`참고 파일의 레이아웃 ${layouts.length}개 가운데 표지 「${cover.name}」, 본문 「${content.name}」 을 씁니다.`)

  // 원래 슬라이드를 모두 뺀다
  const slideRels = presRels.filter((r) => r.type === REL_SLIDE)
  const kept = presRels.filter((r) => r.type !== REL_SLIDE)
  for (const r of slideRels) {
    const p = resolve(presPath, r.target)
    delete files[p]
    delete files[relsPath(p)]
  }
  pres = pres
    .replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>|<p:sldIdLst\/>/, '')
    .replace(/<p:custShowLst>[\s\S]*?<\/p:custShowLst>/, '')
    // 구역(섹션) 목록은 지운 슬라이드를 가리킨다
    .replace(/<p:ext uri="\{521415D9-36F7-43E2-AB2F-B90AF26B5E84\}">[\s\S]*?<\/p:ext>/, '')
    .replace(/<p:extLst>\s*<\/p:extLst>/, '')
  files[presPath] = strToU8(pres)

  // 탐색기 미리보기 그림은 옛 첫 슬라이드다
  const rootRels = readRels(files, '_rels/.rels').filter((r) => r.type !== REL_THUMB)
  files['_rels/.rels'] = strToU8(writeRels(rootRels))

  const wantsNotes = deck.slides.some((s) => s.notes?.trim())
  if (wantsNotes) await ensureNotesMaster(files, kept)
  const notesMasterRel = kept.find((r) => r.type === REL_NOTES_MASTER)
  const notesMasterPath = notesMasterRel ? resolve(presPath, notesMasterRel.target) : ''

  const ct: Record<string, string> = {}
  const ids: string[] = []
  shapeId = 1
  deck.slides.forEach((s, i) => {
    const n = i + 1
    const path = `ppt/slides/slide${n}.xml`
    let layout = content
    let shapes = ''
    const titlePh = (l: Layout): string | undefined => l.phs.find(isTitle)
    const bodyPh = (l: Layout): string | undefined => l.phs.find((p) => isBody(p))

    if (s.kind === '표지' || s.kind === '마무리') {
      layout = cover
      const tp = titlePh(layout)
      const sp = bodyPh(layout)
      if (tp) shapes += phShape(tp, '제목', [s.title || (s.kind === '마무리' ? '감사합니다' : deck.title)])
      if (sp && s.sub) shapes += phShape(sp, '부제목', s.sub.split('\n'))
    } else if (s.kind === '구역') {
      layout = section
      const tp = titlePh(layout)
      const sp = bodyPh(layout)
      if (tp) shapes += phShape(tp, '제목', [s.title])
      if (sp && s.sub) shapes += phShape(sp, '내용', s.sub.split('\n'))
    } else if ((s.kind === '카드' && s.cards?.length) || (s.kind === '표' && s.table?.length)) {
      layout = titleOnly
      const tp = titlePh(layout)
      if (tp) shapes += phShape(tp, '제목', [s.title])
      const box = bodyBox(files, content.path, masterPath, slideSize)
      shapes += s.kind === '카드' ? cardShapes(s.cards ?? [], box) : tableFrame(s.table ?? [], box)
    } else {
      layout = content
      const lines = s.bullets?.length ? s.bullets : s.sub ? s.sub.split('\n') : []
      const tp = titlePh(layout)
      const bp = layout.phs.find((p) => isBody(p) && phType(p) !== 'subTitle')
      if (tp) shapes += phShape(tp, '제목', [s.title])
      if (bp) shapes += phShape(bp, '내용', lines, fitFor(lines))
    }

    files[path] = strToU8(slideXml(shapes))
    const rels: Rel[] = [{ id: 'rId1', type: REL_LAYOUT, target: `../slideLayouts/${layout.path.split('/').pop()}`, external: false }]
    if (s.notes?.trim() && notesMasterPath) {
      const np = `ppt/notesSlides/notesSlide${n}.xml`
      files[np] = strToU8(notesXml(s.notes))
      files[relsPath(np)] = strToU8(
        writeRels([
          { id: 'rId1', type: REL_NOTES_MASTER, target: `../notesMasters/${notesMasterPath.split('/').pop()}`, external: false },
          { id: 'rId2', type: REL_SLIDE, target: `../slides/slide${n}.xml`, external: false }
        ])
      )
      rels.push({ id: 'rId2', type: REL_NOTES, target: `../notesSlides/notesSlide${n}.xml`, external: false })
      ct[np] = CT_NOTES
    }
    files[relsPath(path)] = strToU8(writeRels(rels))
    ct[path] = CT_SLIDE
    const id = nextRelId(kept)
    kept.push({ id, type: REL_SLIDE, target: `slides/slide${n}.xml`, external: false })
    ids.push(`<p:sldId id="${256 + i}" r:id="${id}"/>`)
  })
  if (wantsNotes && !notesMasterPath) said.push('참고 파일에 발표 메모 틀이 없어 메모를 넣지 못했습니다.')

  files[relsPath(presPath)] = strToU8(writeRels(kept))
  pres = text(files, presPath)
  const list = `<p:sldIdLst>${ids.join('')}</p:sldIdLst>`
  // sldIdLst 는 마스터 목록들 바로 뒤, sldSz 앞에 와야 한다
  const anchor = /<\/p:handoutMasterIdLst>|<\/p:notesMasterIdLst>|<\/p:sldMasterIdLst>/g
  let last = -1
  let lastLen = 0
  for (const m of pres.matchAll(anchor)) {
    last = m.index ?? -1
    lastLen = m[0].length
  }
  if (last < 0) throw new Error('이 파일의 구조를 알아보지 못했습니다.')
  pres = pres.slice(0, last + lastLen) + list + pres.slice(last + lastLen)
  files[presPath] = strToU8(pres)

  // 문서 속성: 옛 슬라이드 제목 목록을 지우고, 새 제목을 적는다
  if (files['docProps/app.xml']) {
    files['docProps/app.xml'] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office PowerPoint</Application><Slides>${deck.slides.length}</Slides></Properties>`
    )
  }
  if (files['docProps/core.xml']) {
    const core = text(files, 'docProps/core.xml').replace(/<dc:title>[\s\S]*?<\/dc:title>|<dc:title\/>/, `<dc:title>${esc(deck.title)}</dc:title>`)
    files['docProps/core.xml'] = strToU8(core)
  }

  dropUnreachable(files)
  setContentTypes(files, ct)
  return { data: zipSync(files, { level: 6 }), notes: said }
}

/* ════════════════ 디자인 읽기 ════════════════ */

function hex(v: string | undefined, fallback: string): string {
  return v && /^[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : fallback
}

/** 참고 PPT 의 테마 색·글꼴을 읽는다. 화면 미리보기에만 쓰고, 실제로는 파일을 통째로 쓴다. */
export function readPptxDesign(data: Uint8Array, label: string): DesignSource {
  let files: Files
  try {
    files = unzipSync(data)
  } catch {
    throw new Error('PowerPoint 파일(.pptx)이 아닙니다.')
  }
  const presPath = 'ppt/presentation.xml'
  if (!files[presPath]) throw new Error('PowerPoint 파일(.pptx)이 아닙니다. 옛 .ppt 는 PowerPoint 에서 .pptx 로 저장해 주세요.')
  const presRels = readRels(files, presPath)
  const masterRel = presRels.find((r) => r.type.endsWith('/slideMaster'))
  const masterPath = masterRel ? resolve(presPath, masterRel.target) : ''
  const themeRel = masterPath ? readRels(files, masterPath).find((r) => r.type === REL_THEME) : undefined
  const theme = themeRel ? text(files, resolve(masterPath, themeRel.target)) : ''
  const color = (tag: string): string | undefined =>
    new RegExp(`<a:${tag}>\\s*<a:(?:srgbClr val="([0-9A-Fa-f]{6})"|sysClr [^>]*lastClr="([0-9A-Fa-f]{6})")`).exec(theme)?.slice(1).find(Boolean)
  const font = (which: 'major' | 'minor'): string => {
    const block = new RegExp(`<a:${which}Font>([\\s\\S]*?)</a:${which}Font>`).exec(theme)?.[1] ?? ''
    const ea = /<a:ea typeface="([^"]*)"/.exec(block)?.[1]
    const hang = /<a:font script="Hang" typeface="([^"]*)"/.exec(block)?.[1]
    return hang || ea || FALLBACK_FONT
  }
  const layouts = masterPath ? readRels(files, masterPath).filter((r) => r.type === REL_LAYOUT).length : 0
  const slides = presRels.filter((r) => r.type === REL_SLIDE).length
  const size = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(text(files, presPath))
  const ratio = size ? (+size[1] / +size[2] > 1.5 ? '16:9' : '4:3') : '16:9'
  if (!layouts) throw new Error('이 파일에서 슬라이드 레이아웃을 찾지 못했습니다.')

  const dk1 = hex(color('dk1'), '000000')
  const dk2 = hex(color('dk2'), '1F2937')
  return {
    kind: 'pptx',
    label,
    theme: {
      bg: hex(color('lt1'), 'FFFFFF'),
      surface: hex(color('lt2'), 'EEF2F7'),
      ink: dk1,
      muted: dk2,
      accent: hex(color('accent1'), '2563EB'),
      deep: dk2,
      titleFont: font('major'),
      bodyFont: font('minor'),
      darkCover: false
    },
    notes: [
      `레이아웃 ${layouts}개 · 화면 비율 ${ratio} · 원래 슬라이드 ${slides}장은 빼고 새로 만듭니다.`,
      '배경 그림·장식·글꼴은 참고 파일의 슬라이드 마스터를 그대로 따릅니다.'
    ]
  }
}

/**
 * getdesign.md 등에서 받은 DESIGN.md 의 색·글꼴을 읽는다.
 * 파일 머리의 YAML(colors: / typography:)만 본다. 글 속의 지시문은 읽지 않는다.
 */
export function readDesignMd(md: string, label: string): DesignSource {
  const front = /^---\s*\n([\s\S]*?)\n---/.exec(md.replace(/^﻿/, ''))?.[1] ?? ''
  const colors: Record<string, string> = {}
  const block = /(?:^|\n)colors:\s*\n((?:[ \t]+[^\n]*\n?)+)/.exec(front)?.[1] ?? ''
  for (const m of block.matchAll(/^[ \t]+([\w.-]+):\s*["']?#?([0-9a-fA-F]{6})\b/gm)) colors[m[1].toLowerCase()] = m[2]
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) if (colors[k]) return colors[k]
    return undefined
  }
  if (!Object.keys(colors).length) {
    throw new Error('이 DESIGN.md 에서 색 정보(colors:)를 찾지 못했습니다.')
  }
  const brand = /fontFamily:\s*["']?([^"'\n]+)/.exec(front)?.[1]?.trim()
  const bg = hex(pick('canvas', 'background', 'bg', 'surface'), 'FFFFFF')
  const ink = hex(pick('ink', 'text', 'on-surface', 'foreground', 'on-canvas'), '1F2937')
  return {
    kind: 'designmd',
    label,
    theme: {
      bg,
      surface: hex(pick('canvas-soft', 'surface-soft', 'surface-2', 'surface-alt', 'secondary-surface', 'surface'), 'EEF2F7'),
      ink,
      muted: hex(pick('ink-muted', 'ink-secondary', 'muted', 'text-muted', 'text-secondary'), '6B7280'),
      accent: hex(pick('primary', 'accent', 'brand', 'link'), '2563EB'),
      deep: hex(pick('primary-active', 'primary-dark', 'secondary', 'ink'), ink),
      titleFont: FALLBACK_FONT,
      bodyFont: FALLBACK_FONT,
      darkCover: true
    },
    notes: [
      `색 ${Object.keys(colors).length}가지를 읽었습니다.`,
      brand
        ? `원래 글꼴(${brand})은 한글이 없거나 이 PC에 없을 수 있어 맑은 고딕으로 바꿉니다.`
        : '글꼴은 맑은 고딕을 씁니다.'
    ]
  }
}

export function builtinTheme(id: string): SlideTheme {
  return (BUILTIN_DESIGNS.find((d) => d.id === id) ?? BUILTIN_DESIGNS[0]).theme
}
