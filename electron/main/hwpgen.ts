import { deflateRawSync, inflateRawSync } from 'zlib'
import { strFromU8, strToU8, unzipSync } from 'fflate'
import type { DocItem, FrameBlock, FrameBox, FrameLayout, FrameTable, HwpKind } from '../../shared/hwpform'
import { BLANK_PNG, kindOf, rezip } from './hwpdoc'
import { oleFind, readOle, writeOle, type OleNode } from './ole'

/**
 * 양식을 "틀"로 새 한글 문서 만들기.
 *
 * 양식의 글을 칸마다 갈아 끼우지 않는다. 양식의 문단 하나하나를 "본"으로 삼아
 * 새 글을 넣은 문단을 복제해서 문서를 처음부터 다시 짠다. 그래서
 *  - 문단 수가 양식과 달라도 된다(항목을 늘리고 줄이고, 필요 없는 문단은 빼고)
 *  - 글꼴·글자 크기·문단 모양(들여쓰기·줄 간격·정렬)은 본뜬 문단의 것을 그대로 쓴다
 *  - 쪽 설정·머리말·꼬리말은 첫 문단에 딸려 그대로 옮기고, 문단 사이 빈 줄·그림은 양식 자리대로 둔다
 *  - 표는 칸 모양(합친 칸·테두리·너비)을 두고 글만 새로 채운다. 행은 늘리고 줄일 수 있다
 *  - 글상자(B), 표 안의 표도 같은 방식으로 새 글을 넣는다
 *
 * 이름 붙이기: 최상위 문단 P0 P1 …, 표 T0 T1 …(표 안의 표 포함, 나오는 순서), 글상자 B0 B1 ….
 * .hwp 는 본문 레코드를, .hwpx 는 section0.xml 을 새로 쓴다. 손대지 않은 문단은 원래 바이트 그대로 둔다.
 * 새로 짠 문단의 줄 배치 정보는 비워(hwp 는 한 줄만 남겨) 한글이 열 때 다시 계산하게 한다.
 */

/* ---------- 공통: 글 견주기 ---------- */

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()
/** 줄머리 공백(탭·줄바꿈 제외). 학교 문서는 공백으로 들여 쓰는 일이 많다. */
const leadOf = (s: string): string => /^[^\S\t\n\r]*/.exec(s)?.[0] ?? ''
const withLead = (lead: string, line: string): string =>
  lead.length >= 2 && line.trim() && !/^\s/.test(line) ? lead + line : line

const MARKS: [RegExp, string][] = [
  [/^[□■]/, '□'],
  [/^[○●◦ㅇ]/, '○'],
  [/^◎/, '◎'],
  [/^[◇◆]/, '◆'],
  [/^◈/, '◈'],
  [/^[▶▷►▸]/, '▶'],
  [/^※/, '※'],
  [/^\*/, '*'],
  [/^[-–—]/, '-'],
  [/^[·•∙‣]/, '·'],
  [/^[①-⑳]/, '①'],
  [/^\(\d+\)/, '(1)'],
  [/^\d+\)/, '1)'],
  [/^\d+\.(?!\d)/, '1.'],
  [/^\([가-하]\)/, '(가)'],
  [/^[가-하]\)/, '가)'],
  [/^[가-하]\.\s/, '가.'],
  [/^[ⅰ-ⅹⅠ-Ⅹ]/, 'Ⅰ']
]

/** 줄머리 기호 종류. □ ○ - 1. 가. (1) ① … */
export function markOf(s: string): string {
  const t = s.replace(/^\s+/, '')
  for (const [re, m] of MARKS) if (re.test(t)) return m
  return ''
}

function labelOf(s: string): string {
  const m = /^\s*([^:：\n]{1,14}?)\s*[:：]/.exec(s)
  return m ? m[1].replace(/\s+/g, '') : ''
}

/** 새 줄과 가장 닮은 양식 문단을 고른다: 줄머리 기호 > "항목:" 이름 > 앞글자 */
export function pickSample(line: string, cands: string[]): number {
  let best = 0
  let bestScore = -1
  const a = markOf(line)
  const la = labelOf(line)
  const sl = squash(line)
  cands.forEach((c, i) => {
    let s = 0
    const b = markOf(c)
    if (a === b) s += a ? 10 : 2
    const lb = labelOf(c)
    if (la && la === lb) s += 8
    const sc = squash(c)
    let k = 0
    while (k < sl.length && k < sc.length && k < 6 && sl[k] === sc[k]) k++
    s += k
    if (s > bestScore) {
      best = i
      bestScore = s
    }
  })
  return best
}

function lcsPairs(a: string, b: string): [number, number][] {
  const n = a.length
  const m = b.length
  if (!n || !m || n * m > 4_000_000) return []
  const W = m + 1
  const dp = new Uint16Array((n + 1) * W)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * W + j] = a[i] === b[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1])
    }
  }
  const out: [number, number][] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([i, j])
      i++
      j++
    } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++
    else j++
  }
  return out
}

function dominant<T>(shapes: T[], text: string, from = 0, to = shapes.length): T {
  const count = new Map<T, number>()
  for (let i = from; i < to; i++) {
    const w = /\s/.test(text[i] ?? '') ? 0.1 : 1
    count.set(shapes[i], (count.get(shapes[i]) ?? 0) + w)
  }
  let best = shapes[from]
  let n = -1
  for (const [k, v] of count) {
    if (v > n) {
      best = k
      n = v
    }
  }
  return best
}

/**
 * 본뜬 문단의 글자 모양을 새 글에 옮긴다.
 *
 * 두 글에서 같은 부분(두 글자 이상 이어진 곳)은 그 글자의 모양을 그대로 쓰고,
 * 바뀐 부분은 원래 그 자리에 있던 글자들의 모양을 쓴다. 그래서 "성명: 홍길동" 의
 * 굵은 "성명:" 과 밑줄 친 이름 자리가 "성명: 김철수" 에서도 그대로 살아난다.
 * 전혀 다른 글이면 본뜬 문단에서 가장 많이 쓴 모양 하나로 쓴다.
 */
export function mapShapes<T>(sample: string, shapes: T[], text: string, fallback: T): T[] {
  if (!text.length) return []
  if (!sample.length || !shapes.length) return new Array<T>(text.length).fill(fallback)
  if (shapes.every((s) => s === shapes[0])) return new Array<T>(text.length).fill(shapes[0])
  const dom = dominant(shapes, sample)
  const out = new Array<T | undefined>(text.length).fill(undefined)
  const segs: { s: number; t: number; n: number }[] = []
  for (const [i, j] of lcsPairs(sample, text)) {
    const last = segs[segs.length - 1]
    if (last && last.s + last.n === i && last.t + last.n === j) last.n++
    else segs.push({ s: i, t: j, n: 1 })
  }
  const anchors = segs.filter((g) => g.n >= 2 || (g.s === 0 && g.t === 0 && !/\s/.test(sample[0])))
  const fill = (t0: number, t1: number, s0: number, s1: number): void => {
    if (t1 <= t0) return
    let v: T
    if (s1 > s0) v = dominant(shapes, sample, s0, s1)
    else if (t0 > 0 && out[t0 - 1] !== undefined) v = out[t0 - 1] as T
    else v = s0 < shapes.length ? shapes[s0] : dom
    for (let k = t0; k < t1; k++) out[k] = v
  }
  let ps = 0
  let pt = 0
  for (const a of anchors) {
    fill(pt, a.t, ps, a.s)
    for (let k = 0; k < a.n; k++) out[a.t + k] = shapes[a.s + k]
    ps = a.s + a.n
    pt = a.t + a.n
  }
  fill(pt, text.length, ps, sample.length)
  return out.map((v) => (v === undefined ? dom : v))
}

/** 새 줄마다 본뜰 문단을 고른다. 같은 본은 처음 한 번만 딸린 그림을 가져간다. */
function planLines<P>(samples: P[], textOf: (p: P) => string, text: string): { sample: P; line: string; first: boolean }[] {
  const texty = samples.filter((p) => textOf(p).trim())
  const cands = texty.length ? texty : samples.slice(0, 1)
  const candText = cands.map(textOf)
  const used = new Set<P>()
  return text.split('\n').map((line) => {
    const k = pickSample(line, candText)
    const sample = cands[k]
    const first = !used.has(sample)
    used.add(sample)
    return { sample, line: withLead(leadOf(candText[k]), line), first }
  })
}

/** 칸 안에서 안쪽 표 자리를 가리키는 줄: [T5] */
const TABLE_MARK = /^\s*\[T\d+\]\s*$/

/**
 * 안에 표가 든 칸을 새 글로 채운다. 표가 든 문단은 그대로 두고(안쪽 표는 따로 채운다)
 * 나머지 글 문단만 새 줄로 바꾼다. 새 글에 [T5] 줄이 있으면 그 자리에, 없으면 원래 순서 자리에 표를 둔다.
 */
function mixParas<P, R>(
  paras: P[],
  isAnchor: (p: P) => boolean,
  text: string,
  list: (samples: P[], text: string, fresh: boolean) => R[],
  keep: (p: P) => R
): R[] {
  const anchors = paras.filter(isAnchor)
  const samples = paras.filter((p) => !isAnchor(p))
  const lines = text.split('\n')
  const out: R[] = []
  let pending: string[] = []
  const flush = (): void => {
    if (pending.length && !(out.length && pending.every((l) => !l.trim()))) {
      out.push(...list(samples.length ? samples : anchors, pending.join('\n'), !samples.length))
    }
    pending = []
  }
  let ai = 0
  if (lines.some((l) => TABLE_MARK.test(l))) {
    for (const l of lines) {
      if (TABLE_MARK.test(l) && ai < anchors.length) {
        flush()
        out.push(keep(anchors[ai++]))
      } else if (!TABLE_MARK.test(l)) pending.push(l)
    }
  } else {
    let li = 0
    for (const a of anchors) {
      const before = paras.slice(0, paras.indexOf(a)).filter((p) => !isAnchor(p)).length
      const upto = Math.min(before, lines.length)
      if (upto > li) {
        pending.push(...lines.slice(li, upto))
        li = upto
      }
      flush()
      out.push(keep(a))
      ai++
    }
    pending.push(...lines.slice(li))
  }
  flush()
  while (ai < anchors.length) out.push(keep(anchors[ai++]))
  return out
}

/* ---------- 공통: 틀 모형 ---------- */

interface Style {
  align: string
  size: number
  bold: boolean
}

interface CellInfo {
  text: string
  rowSpan: number
  nested: boolean
}

/** 표(T)나 글상자(B) 하나 */
interface Entry {
  id: string
  kind: 'table' | 'box'
  /** 이것이 든 최상위 문단 */
  home: number
  /** 표 안의 표·글상자면 바깥 것의 번호 */
  parent: string | null
  rows?: CellInfo[][]
  lines?: string[]
}

interface BlockInfo {
  id: string
  text: string
  lead: string
  kind: FrameBlock['kind']
  style: Style
  pageBreak: boolean
  /** 이 문단에 바로 든 표·글상자 */
  tables: string[]
  boxes: string[]
}

interface Overrides {
  tables: Map<string, string[][]>
  boxes: Map<string, string[]>
}

const noOverrides = (): Overrides => ({ tables: new Map(), boxes: new Map() })
const mergeOv = (a: Overrides, b?: Overrides): Overrides =>
  b ? { tables: new Map([...a.tables, ...b.tables]), boxes: new Map([...a.boxes, ...b.boxes]) } : a

type Emit =
  | { op: 'text'; block: number; text: string; pageBreak: boolean }
  | { op: 'copy'; block: number; pageBreak: boolean; ov?: Overrides }

interface Frame {
  kind: HwpKind
  blocks: BlockInfo[]
  entries: Entry[]
  notes: string[]
  build(emits: Emit[], global: Overrides, preview: string): Uint8Array
}

interface RowPlan {
  from: number
  /** 칸마다 새 글. null 이면 칸을 그대로 둔다 */
  texts: (string | null)[]
}

const blankRow = (r: CellInfo[]): boolean => r.every((c) => !c.text.trim() && !c.nested)

/**
 * 표의 행을 맞춘다. 새 행 i 는 양식의 i 행 모양을 쓰고, 양식보다 많으면
 * 합친 칸이 없는 마지막 행을 복제한다. 양식 끝의 빈 행(손으로 적는 명단 칸)은
 * 새 표가 짧아도 원래 개수만큼 빈 채로 남긴다. wanted 가 null 이면 그대로 둔다.
 */
function planRows(tpl: CellInfo[][], wanted: string[][] | null): RowPlan[] {
  const R = tpl.length
  if (!wanted) return tpl.map((r, i) => ({ from: i, texts: r.map(() => null) }))
  if (!R) return []
  let tail = 0
  while (tail < R && blankRow(tpl[R - 1 - tail])) tail++
  const covered = new Set<number>()
  tpl.forEach((r, i) => r.forEach((c) => { for (let k = 1; k < c.rowSpan; k++) covered.add(i + k) }))
  let rep = -1
  for (let i = R - 1; i >= 0; i--) {
    if (!covered.has(i) && tpl[i].length && tpl[i].every((c) => c.rowSpan === 1 && !c.nested)) {
      rep = i
      break
    }
  }
  const body = wanted.map((r) => r.slice())
  if (body.length > R && rep < 0) {
    // 행을 늘릴 수 없는 표: 넘치는 행은 마지막 행 칸에 줄을 바꿔 이어 붙인다
    const last = body[R - 1]
    for (const extra of body.slice(R)) {
      extra.forEach((v, k) => {
        const at = Math.min(k, Math.max(0, last.length - 1))
        last[at] = [last[at], v].filter((s) => s && s.trim()).join('\n')
      })
    }
    body.length = R
  }
  const total = tail > 0 ? Math.max(body.length, R) : Math.max(1, body.length)
  const plan: RowPlan[] = []
  for (let i = 0; i < total; i++) {
    const from = i < R ? i : rep
    const cells = tpl[from]
    const got = i < body.length ? body[i] : cells.map(() => '')
    const texts = cells.map((c, k) => {
      if (k === cells.length - 1 && got.length > cells.length) return got.slice(k).filter((s) => s.trim()).join(' ')
      const v = got[k] ?? ''
      // 원래 행 그대로인 칸은 손대지 않는다(모양·그림까지 그대로)
      return from === i && squash(v) === squash(c.text) ? null : v
    })
    plan.push({ from, texts })
  }
  return plan
}

/**
 * AI 가 쓴 문단·표·글상자 목록을 실제로 내보낼 순서로 바꾼다.
 * 양식에서 한 문단 뒤에 붙어 있던 빈 줄·그림은 그 문단을 쓸 때 함께 따라 나온다.
 * AI 가 쓰지 않은 문단·표·글상자는 새 문서에 넣지 않는다.
 */
function planEmits(blocks: BlockInfo[], entries: Entry[], items: DocItem[]): { emits: Emit[]; global: Overrides } {
  const byId = new Map(blocks.map((b, i) => [b.id, i]))
  const entry = new Map(entries.map((e) => [e.id, e]))
  const texty = blocks.map((_, i) => i).filter((i) => blocks[i].kind === 'text')
  const fallback = texty.length ? texty : blocks.map((_, i) => i).filter((i) => blocks[i].kind === 'empty')
  const global = noOverrides()

  type Step = { block: number; text?: string; ov?: Overrides }
  const steps: Step[] = []
  const place = (home: number, set: (ov: Overrides) => boolean): void => {
    const last = steps[steps.length - 1]
    if (last && last.block === home && last.ov && set(last.ov)) return
    const ov = noOverrides()
    set(ov)
    steps.push({ block: home, ov })
  }
  for (let k = 0; k < items.length; k++) {
    const it = items[k]
    if (it.kind === 't') {
      const e = entry.get(it.sample)
      if (!e || e.kind !== 'table') continue
      if (e.parent === null && blocks[e.home].kind === 'table') {
        place(e.home, (ov) => (ov.tables.has(e.id) ? false : (ov.tables.set(e.id, it.rows), true)))
      } else global.tables.set(e.id, it.rows)
      continue
    }
    const e = entry.get(it.sample)
    if (e?.kind === 'box') {
      const lines = [it.text]
      while (k + 1 < items.length && items[k + 1].kind === 'p' && items[k + 1].sample === it.sample) {
        lines.push((items[++k] as { text: string }).text)
      }
      if (e.parent === null && blocks[e.home].kind === 'box') {
        place(e.home, (ov) => (ov.boxes.has(e.id) ? false : (ov.boxes.set(e.id, lines), true)))
      } else global.boxes.set(e.id, lines)
      continue
    }
    let b = byId.get(it.sample)
    if (b === undefined || (blocks[b].kind !== 'text' && blocks[b].kind !== 'empty')) {
      if (!fallback.length) continue
      b = fallback[pickSample(it.text, fallback.map((i) => blocks[i].text))]
    }
    steps.push({ block: b, text: it.text })
  }

  const deco = (i: number): boolean => blocks[i].kind === 'empty' || blocks[i].kind === 'object'
  const emits: Emit[] = []
  /**
   * from 번째부터 이어진 빈 줄·그림을 따라 넣는다. 바로 다음에 양식의 다음 문단이 그대로 이어지면
   * 빈 줄을 모두 두고, 중간을 건너뛰면 빈 줄은 두 줄까지만 넣는다(길게 이어진 빈 줄은 대개
   * 다음 쪽으로 넘기려고 채워 둔 것이다).
   */
  const decorate = (from: number, next: number | undefined): void => {
    let end = from
    while (end < blocks.length && deco(end)) end++
    const keepAll = next === end || (next === undefined && end === blocks.length)
    let empties = 0
    for (let j = from; j < end; j++) {
      if (!keepAll && blocks[j].kind === 'empty' && ++empties > 2) continue
      emits.push({ op: 'copy', block: j, pageBreak: false })
    }
  }
  decorate(0, steps[0]?.block)
  const first = steps[0]?.block
  let lastFirst = 0
  for (let k = 0; k < steps.length; k++) {
    const s = steps[k]
    let pageBreak = false
    if (k > 0 && s.block === first) {
      // 첫 문단(대개 제목)이 한참 뒤에 다시 나오면 같은 문서를 한 장 더 쓰는 것이다 → 새 쪽
      if (k - lastFirst >= 3) pageBreak = true
      lastFirst = k
    }
    if (k > 0 && blocks[s.block].pageBreak) pageBreak = true
    emits.push(s.text !== undefined ? { op: 'text', block: s.block, text: s.text, pageBreak } : { op: 'copy', block: s.block, pageBreak, ov: s.ov })
    if (steps[k + 1]?.block !== s.block) decorate(s.block + 1, steps[k + 1]?.block)
  }
  return { emits, global }
}

/* ---------- .hwp (HWP 5) ---------- */

const TAG = {
  DOC_PROPS: 16,
  CHAR_SHAPE: 21,
  PARA_SHAPE: 25,
  PARA_HEADER: 66,
  PARA_TEXT: 67,
  PARA_CHAR_SHAPE: 68,
  PARA_LINE_SEG: 69,
  CTRL_HEADER: 71,
  LIST_HEADER: 72,
  TABLE: 77
}

interface Rec {
  tag: number
  level: number
  data: Buffer
}

function readRecs(buf: Buffer): Rec[] {
  const out: Rec[] = []
  let off = 0
  while (off < buf.length) {
    if (off + 4 > buf.length) throw new Error('한글 파일 본문을 읽지 못했습니다.')
    const h = buf.readUInt32LE(off)
    off += 4
    let size = h >>> 20
    if (size === 0xfff) {
      size = buf.readUInt32LE(off)
      off += 4
    }
    if (off + size > buf.length) throw new Error('한글 파일 본문을 읽지 못했습니다.')
    out.push({ tag: h & 0x3ff, level: (h >>> 10) & 0x3ff, data: buf.subarray(off, off + size) })
    off += size
  }
  return out
}

function writeRecs(recs: Rec[]): Buffer {
  const parts: Buffer[] = []
  for (const r of recs) {
    const big = r.data.length >= 0xfff
    const h = Buffer.alloc(big ? 8 : 4)
    h.writeUInt32LE(((r.tag & 0x3ff) | ((r.level & 0x3ff) << 10) | ((big ? 0xfff : r.data.length) << 20)) >>> 0, 0)
    if (big) h.writeUInt32LE(r.data.length, 4)
    parts.push(h, r.data)
  }
  return Buffer.concat(parts)
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 한글이 저장한 압축 스트림처럼 끝에 CRC 와 원래 길이를 붙인다. */
function compress(raw: Buffer): Buffer {
  const tail = Buffer.alloc(8)
  tail.writeUInt32LE(crc32(raw), 0)
  tail.writeUInt32LE(raw.length >>> 0, 4)
  return Buffer.concat([deflateRawSync(raw), tail])
}

/** 8칸을 차지하는 컨트롤 가운데 레코드가 딸린 것(표·그림·구역 정의 …) */
const EXT = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23])
/** 8칸을 차지하지만 레코드가 없는 것(탭·필드 끝 …) */
const INLINE = new Set([4, 5, 6, 7, 8, 9, 19, 20])
/** 쪽 설정·단·머리말·꼬리말·쪽 번호 — 문서 첫 문단에만 둔다 */
const SECTION_CTRL = new Set(['secd', 'cold', 'head', 'foot', 'pgnp', 'pghd', 'pgct', 'nwno'])
/** 문단에 딸린 그림·도형·글상자·수식 — 본뜬 문단을 복제할 때 같이 가져간다 */
const OBJECT_CTRL = new Set(['gso ', 'eqed'])

interface HTok {
  code: number
  size: 1 | 8
  raw?: Buffer
  ctrl?: string
  tree?: Rec[]
  shape: number
}

interface HPara {
  level: number
  header: Buffer
  toks: HTok[]
  /** 원래 딸린 레코드 묶음(순서 그대로). 손대지 않은 문단은 이것을 그대로 쓴다. */
  kids: Rec[][]
  segs: Buffer | null
  /** 새로 계산한 줄 배치(없으면 원래 것) */
  segsOut?: Buffer
  /** 글과 컨트롤 레코드의 짝이 맞는다 */
  sound: boolean
  /** 글을 바꿨다 → 머리·글자 모양·줄 배치를 새로 쓴다 */
  dirty: boolean
}

/* 줄 배치(조판 캐시) 어림.
 * .hwp 는 문단마다 줄의 시작 글자·세로 위치를 저장해 둔다. 한글은 열면서 다시 조판하지만,
 * 저장된 값을 그대로 믿는 뷰어도 있어서 글자 폭을 어림해 줄을 나누고 위치를 차례로 매긴다. */
const SEG = 36

interface Metrics {
  /** 글자 모양 번호 → [한글 폭, 영문·숫자 폭] (HWPUNIT) */
  width: (shape: number, code: number) => number
  /** 본문 높이. 넘으면 새 쪽. 0 이면 쪽을 나누지 않는다(칸·글상자) */
  pageHeight: number
}

/** 글자 폭을 더해 줄이 넘치는 자리(어절 단위)를 찾는다. 돌려주는 것은 줄마다 시작 칸 위치. */
function lineStarts(p: HPara, width: number, m: Metrics): number[] {
  const starts = [0]
  if (width <= 0) return starts
  let pos = 0
  let x = 0
  let lastSpace = -1
  let xAtSpace = 0
  for (const t of p.toks) {
    if (t.size === 1 && t.code >= 32) {
      const w = m.width(t.shape, t.code)
      if (x + w > width && x > 0) {
        if (lastSpace > starts[starts.length - 1]) {
          starts.push(lastSpace)
          x -= xAtSpace
        } else {
          starts.push(pos)
          x = 0
        }
        lastSpace = -1
      }
      x += w
      if (t.code === 32) {
        lastSpace = pos + 1
        xAtSpace = x
      }
    }
    pos += t.size
  }
  return starts
}

/** 한 목록(본문·칸·글상자)의 문단들 줄 위치를 차례로 다시 매긴다. 새로 짠 문단이 없으면 그대로. */
function layoutList(paras: HPara[], m: Metrics): void {
  if (!paras.some((p) => p.dirty)) return
  let cursor = 0
  for (const p of paras) {
    if (m.pageHeight && p.header[11] & 0x04) cursor = 0
    const segs = p.segs && p.segs.length >= SEG ? p.segs : null
    if (!segs) continue
    const lh = segs.readInt32LE(8)
    const ls = segs.readInt32LE(20)
    if (p.dirty) {
      const starts = lineStarts(p, segs.readInt32LE(28), m)
      const out = Buffer.alloc(SEG * starts.length)
      starts.forEach((at, k) => {
        if (m.pageHeight && cursor > 0 && cursor + lh > m.pageHeight) cursor = 0
        segs.copy(out, k * SEG, 0, SEG)
        out.writeUInt32LE(at, k * SEG)
        out.writeInt32LE(cursor, k * SEG + 4)
        cursor += lh + ls
      })
      p.segsOut = out
    } else {
      if (m.pageHeight && cursor > 0 && cursor + lh > m.pageHeight) cursor = 0
      const n = Math.floor(segs.length / SEG)
      const out = Buffer.from(segs.subarray(0, n * SEG))
      const delta = cursor - segs.readInt32LE(4)
      for (let k = 0; k < n; k++) out.writeInt32LE(segs.readInt32LE(k * SEG + 4) + delta, k * SEG + 4)
      cursor = out.readInt32LE((n - 1) * SEG + 4) + segs.readInt32LE((n - 1) * SEG + 8) + segs.readInt32LE((n - 1) * SEG + 20)
      p.segsOut = out
    }
  }
}

const ctrlName = (d: Buffer): string => (d.length >= 4 ? String.fromCharCode(d[3], d[2], d[1], d[0]) : '')

function parsePara(recs: Rec[], i: number): { p: HPara; next: number } {
  const head = recs[i]
  const L = head.level
  const texts: Buffer[] = []
  let shapeData: Buffer | null = null
  let segs: Buffer | null = null
  const ctrls: Rec[][] = []
  const kids: Rec[][] = []
  let odd = false
  let j = i + 1
  while (j < recs.length && recs[j].level > L) {
    const r = recs[j]
    let k = j + 1
    while (k < recs.length && recs[k].level > r.level) k++
    const sub = recs.slice(j, k)
    kids.push(sub)
    if (r.level !== L + 1) odd = true
    else if (r.tag === TAG.PARA_TEXT) texts.push(r.data)
    else if (r.tag === TAG.PARA_CHAR_SHAPE) shapeData = r.data
    else if (r.tag === TAG.PARA_LINE_SEG) segs = r.data
    else if (r.tag === TAG.CTRL_HEADER) ctrls.push(sub)
    j = k
  }

  const toks: HTok[] = []
  let sound = texts.length <= 1 && !odd
  let ci = 0
  const text = Buffer.concat(texts)
  for (let u = 0; u < text.length >> 1; ) {
    const c = text.readUInt16LE(u * 2)
    if (EXT.has(c) || INLINE.has(c)) {
      const t: HTok = { code: c, size: 8, raw: Buffer.from(text.subarray(u * 2, u * 2 + 16)), shape: 0 }
      if (EXT.has(c)) {
        const tree = ctrls[ci++]
        if (tree) {
          t.tree = tree
          t.ctrl = ctrlName(tree[0].data)
        } else sound = false
      }
      toks.push(t)
      u += 8
    } else {
      toks.push({ code: c, size: 1, shape: 0 })
      u++
    }
  }
  if (!toks.length) toks.push({ code: 13, size: 1, shape: 0 })
  if (ci !== ctrls.length) sound = false
  const units = toks.reduce((s, t) => s + t.size, 0)
  if ((head.data.readUInt32LE(0) & 0x7fffffff) !== units) sound = false

  const runs: [number, number][] = []
  if (shapeData) for (let k = 0; k + 8 <= shapeData.length; k += 8) runs.push([shapeData.readUInt32LE(k), shapeData.readUInt32LE(k + 4)])
  let pos = 0
  let r = 0
  for (const t of toks) {
    while (r + 1 < runs.length && runs[r + 1][0] <= pos) r++
    t.shape = runs[r]?.[1] ?? 0
    pos += t.size
  }
  return { p: { level: L, header: Buffer.from(head.data), toks, kids, segs, sound, dirty: false }, next: j }
}

function shiftLevel(recs: Rec[], d: number): Rec[] {
  return d ? recs.map((r) => ({ ...r, level: r.level + d })) : recs
}

/** 컨트롤에 딸린 레코드를 내보낼 때 쓰는 것(표·글상자는 새로 짠다) */
type TreeOf = (t: HTok) => Rec[]

function paraRecs(p: HPara, level: number, last: boolean, treeOf: TreeOf): Rec[] {
  const d = level - p.level
  if (!p.dirty) {
    const head = Buffer.from(p.header)
    head.writeUInt32LE(((head.readUInt32LE(0) & 0x7fffffff) | (last ? 0x80000000 : 0)) >>> 0, 0)
    const out: Rec[] = [{ tag: TAG.PARA_HEADER, level, data: head }]
    const ext = p.toks.filter((t) => t.tree)
    let ci = 0
    for (const kid of p.kids) {
      if (p.sound && kid[0].tag === TAG.CTRL_HEADER && kid[0].level === p.level + 1) {
        const t = ext[ci++]
        out.push(...shiftLevel(t ? treeOf(t) : kid, d))
      } else if (p.segsOut && kid[0].tag === TAG.PARA_LINE_SEG && kid[0].level === p.level + 1) {
        out.push({ ...kid[0], level: kid[0].level + d, data: p.segsOut })
      } else out.push(...shiftLevel(kid, d))
    }
    return out
  }

  const units = p.toks.reduce((s, t) => s + t.size, 0)
  const head = Buffer.from(p.header)
  head.writeUInt32LE((units | (last ? 0x80000000 : 0)) >>> 0, 0)
  // 문단에 든 조판 부호 종류(글자 13 문단 끝은 넣지 않는다)
  let mask = 0
  for (const t of p.toks) if (t.code < 32 && t.code !== 13) mask |= 1 << t.code
  head.writeUInt32LE(mask >>> 0, 4)
  const runs: number[] = []
  let pos = 0
  let prev = -1
  for (const t of p.toks) {
    if (t.shape !== prev) {
      runs.push(pos, t.shape)
      prev = t.shape
    }
    pos += t.size
  }
  const segs = p.segsOut ?? null
  if (head.length >= 18) {
    head.writeUInt16LE(runs.length / 2, 12)
    head.writeUInt16LE(0, 14)
    head.writeUInt16LE(segs ? segs.length / SEG : 0, 16)
  }
  const out: Rec[] = [{ tag: TAG.PARA_HEADER, level, data: head }]
  if (units > 1 || p.toks[0]?.code !== 13) {
    const tx = Buffer.alloc(units * 2)
    let o = 0
    for (const t of p.toks) {
      if (t.raw) {
        t.raw.copy(tx, o)
        o += 16
      } else {
        tx.writeUInt16LE(t.code, o)
        o += 2
      }
    }
    out.push({ tag: TAG.PARA_TEXT, level: level + 1, data: tx })
  }
  const cs = Buffer.alloc(runs.length * 4)
  runs.forEach((v, k) => cs.writeUInt32LE(v >>> 0, k * 4))
  out.push({ tag: TAG.PARA_CHAR_SHAPE, level: level + 1, data: cs })
  if (segs) out.push({ tag: TAG.PARA_LINE_SEG, level: level + 1, data: segs })
  for (const t of p.toks) {
    if (!t.tree) continue
    const tree = treeOf(t)
    out.push(...shiftLevel(tree, level + 1 - tree[0].level))
  }
  return out
}

function hText(p: HPara): { text: string; shapes: number[] } {
  let text = ''
  const shapes: number[] = []
  for (const t of p.toks) {
    let ch = ''
    if (t.size === 8) ch = t.code === 9 ? '\t' : ''
    else if (t.code === 10) ch = '\n'
    else if (t.code === 30 || t.code === 31) ch = ' '
    else if (t.code >= 32) ch = String.fromCharCode(t.code)
    if (ch) {
      text += ch
      shapes.push(t.shape)
    }
  }
  return { text, shapes }
}

const copyPara = (p: HPara): HPara => ({ ...p, header: Buffer.from(p.header), toks: p.toks.map((t) => ({ ...t })) })
const hObjects = (p: HPara): HTok[] => p.toks.filter((t) => t.ctrl && OBJECT_CTRL.has(t.ctrl))

/** 본뜬 문단 s 의 모양으로 새 글 text 를 담은 문단을 만든다. keep 은 앞에 둘 컨트롤. */
function hClone(s: HPara, text: string, keep: HTok[]): HPara {
  const { text: st, shapes } = hText(s)
  const end = s.toks[s.toks.length - 1]?.shape ?? 0
  const base = shapes.length ? dominant(shapes, st) : end
  const clean = text.replace(/[\u0000-\u001f]/g, ' ')
  const mapped = mapShapes(st, shapes, clean, base)
  const toks: HTok[] = keep.map((k) => ({ ...k }))
  for (let i = 0; i < clean.length; i++) toks.push({ code: clean.charCodeAt(i), size: 1, shape: mapped[i] })
  toks.push({ code: 13, size: 1, shape: mapped.length ? mapped[mapped.length - 1] : end })
  return { ...s, header: Buffer.from(s.header), toks, kids: [], dirty: true }
}

/** 칸·글상자 안의 문단들을 새 글로. fresh 면 본뜬 문단을 통째로 옮기지 않는다(안쪽 표가 딸려 가지 않게). */
function hListParas(samples: HPara[], text: string, fresh = false): HPara[] {
  return planLines(samples, (p) => hText(p).text, text).map(({ sample, line, first }) =>
    !fresh && first && squash(line) === squash(hText(sample).text)
      ? copyPara(sample)
      : hClone(sample, line, first ? hObjects(sample) : [])
  )
}

const hasTable = (p: HPara): boolean => p.toks.some((t) => t.ctrl === 'tbl ')

function hCellParas(c: { paras: HPara[]; nested: boolean }, text: string): HPara[] {
  return c.nested ? mixParas(c.paras, hasTable, text, hListParas, copyPara) : hListParas(c.paras, text)
}

interface HCell {
  lh: Buffer
  paras: HPara[]
  row: number
  rowSpan: number
  nested: boolean
  text: string
}

interface HTable {
  head: Rec
  pre: Rec[]
  table: Rec
  cells: HCell[]
  rows: HCell[][]
}

function parseTable(tree: Rec[]): HTable | null {
  const C = tree[0].level
  const ti = tree.findIndex((r, i) => i > 0 && r.tag === TAG.TABLE && r.level === C + 1)
  if (ti < 0 || tree[ti].data.length < 18) return null
  const cells: HCell[] = []
  let i = ti + 1
  while (i < tree.length) {
    const r = tree[i]
    if (r.tag !== TAG.LIST_HEADER || r.level !== C + 1 || r.data.length < 16) return null
    i++
    const paras: HPara[] = []
    while (i < tree.length && tree[i].level === C + 1 && tree[i].tag === TAG.PARA_HEADER) {
      const { p, next } = parsePara(tree, i)
      paras.push(p)
      i = next
    }
    if (!paras.length || !paras.every((p) => p.sound)) return null
    cells.push({
      lh: Buffer.from(r.data),
      paras,
      row: r.data.readUInt16LE(10),
      rowSpan: Math.max(1, r.data.readUInt16LE(14)),
      nested: paras.some((p) => p.toks.some((t) => t.ctrl === 'tbl ')),
      text: paras.map((p) => hText(p).text).join('\n')
    })
  }
  const R = tree[ti].data.readUInt16LE(4)
  let sum = 0
  for (let k = 0; k < R; k++) sum += tree[ti].data.readUInt16LE(18 + k * 2)
  if (!R || sum !== cells.length || cells.some((c) => c.row >= R)) return null
  const rows: HCell[][] = Array.from({ length: R }, () => [])
  for (const c of cells) rows[c.row].push(c)
  rows.forEach((row) => row.sort((a, b) => a.lh.readUInt16LE(8) - b.lh.readUInt16LE(8)))
  return { head: tree[0], pre: tree.slice(1, ti), table: tree[ti], cells, rows }
}

const cellInfo = (rows: { text: string; rowSpan: number; nested: boolean }[][]): CellInfo[][] =>
  rows.map((r) => r.map((c) => ({ text: c.text, rowSpan: c.rowSpan, nested: c.nested })))

function hRebuildTable(t: HTable, wanted: string[][] | null, treeOf: TreeOf, m: Metrics): Rec[] {
  const C = t.head.level
  const plan = planRows(cellInfo(t.rows), wanted)
  const R = t.rows.length
  const cellRecs: Rec[] = []
  const sizes: number[] = []
  plan.forEach((rp, i) => {
    const cells = t.rows[rp.from]
    sizes.push(cells.length)
    cells.forEach((c, k) => {
      const lh = Buffer.from(c.lh)
      lh.writeUInt16LE(i, 10)
      lh.writeUInt16LE(Math.max(1, Math.min(c.rowSpan, plan.length - i)), 14)
      const want = rp.texts[k]
      const paras = want === null ? c.paras.map(copyPara) : hCellParas(c, want)
      lh.writeUInt16LE(paras.length, 0)
      cellRecs.push({ tag: TAG.LIST_HEADER, level: C + 1, data: lh })
      layoutList(paras, m)
      paras.forEach((p, n) => cellRecs.push(...paraRecs(p, C + 1, n === paras.length - 1, treeOf)))
    })
  })
  const old = t.table.data
  const head = Buffer.from(old.subarray(0, 18))
  head.writeUInt16LE(plan.length, 4)
  const sz = Buffer.alloc(sizes.length * 2)
  sizes.forEach((v, k) => sz.writeUInt16LE(v, k * 2))
  const table: Rec = { ...t.table, data: Buffer.concat([head, sz, old.subarray(18 + R * 2)]) }
  return [t.head, ...t.pre, table, ...cellRecs]
}

interface HBox {
  tree: Rec[]
  lh: number
  end: number
  level: number
  paras: HPara[]
  text: string
}

/** 글상자: 그리기 개체 아래 LIST_HEADER 와 그 뒤 문단들 */
function parseBox(tree: Rec[]): HBox | null {
  const lh = tree.findIndex((r, i) => i > 0 && r.tag === TAG.LIST_HEADER)
  if (lh < 0 || tree[lh].data.length < 2) return null
  const L = tree[lh].level
  const paras: HPara[] = []
  let i = lh + 1
  while (i < tree.length && tree[i].level === L && tree[i].tag === TAG.PARA_HEADER) {
    const { p, next } = parsePara(tree, i)
    paras.push(p)
    i = next
  }
  if (!paras.length || !paras.every((p) => p.sound)) return null
  return { tree, lh, end: i, level: L, paras, text: paras.map((p) => hText(p).text).join('\n') }
}

function hRebuildBox(b: HBox, lines: string[] | null, treeOf: TreeOf, m: Metrics): Rec[] {
  const paras = lines === null ? b.paras.map(copyPara) : hListParas(b.paras, lines.join('\n'))
  layoutList(paras, m)
  const lh = { ...b.tree[b.lh], data: Buffer.from(b.tree[b.lh].data) }
  lh.data.writeUInt16LE(paras.length, 0)
  return [
    ...b.tree.slice(0, b.lh),
    lh,
    ...paras.flatMap((p, n) => paraRecs(p, b.level, n === paras.length - 1, treeOf)),
    ...b.tree.slice(b.end)
  ]
}

const ALIGN5 = ['J', 'L', 'R', 'C', 'D', 'D', 'J', 'J']

class HwpFrame implements Frame {
  kind: HwpKind = 'hwp'
  blocks: BlockInfo[] = []
  entries: Entry[] = []
  notes: string[] = []
  private root: OleNode
  private compressed: boolean
  /** 글자 모양마다 [기준 크기, 한글 장평·자간·상대 크기, 영문 장평·자간·상대 크기] */
  private shapeMetrics: number[][] = []
  /** 본문 높이(HWPUNIT). 줄 위치를 어림할 때 쪽을 나누는 데 쓴다 */
  private pageHeight = 0
  private widthOf = (shape: number, code: number): number => {
    const half = code < 0x1100
    const sm = this.shapeMetrics[shape]
    if (!sm) return half ? 500 : 1000
    const [size, hr, hs, hrel, lr, ls, lrel] = sm
    const [ratio, spacing, rel] = half ? [lr, ls, lrel] : [hr, hs, hrel]
    const em = (size * (rel || 100)) / 100
    return em * ((ratio || 100) / 100) * (half ? 0.5 : 1) + (em * spacing) / 100
  }
  private docInfo: Rec[]
  private paras: HPara[] = []
  private reg = new Map<Rec[], { id: string; table?: HTable; box?: HBox }>()
  private nT = 0
  private nB = 0

  constructor(buf: Buffer) {
    this.root = readOle(buf)
    const fh = oleFind(this.root, 'FileHeader')?.data
    if (!fh || fh.length < 40 || !fh.toString('latin1', 0, 17).startsWith('HWP Document File')) {
      throw new Error('한글(.hwp) 파일이 아닙니다.')
    }
    const attr = fh.readUInt32LE(36)
    if (attr & 0x02) throw new Error('암호가 걸린 한글 파일은 양식으로 쓸 수 없습니다.')
    if (attr & 0x04) throw new Error('배포용으로 잠긴 한글 파일은 양식으로 쓸 수 없습니다. 한글에서 배포용 설정을 풀고 다시 저장해 주세요.')
    this.compressed = !!(attr & 0x01)
    const inflate = (b: Buffer): Buffer => (this.compressed ? inflateRawSync(b) : b)
    const di = oleFind(this.root, 'DocInfo')?.data
    const sec = oleFind(this.root, 'BodyText/Section0')?.data
    if (!di || !sec) throw new Error('한글 파일 본문을 찾지 못했습니다.')
    this.docInfo = readRecs(inflate(di))
    const sections = oleFind(this.root, 'BodyText')?.kids?.length ?? 1
    if (sections > 1) this.notes.push(`구역이 ${sections}개인 양식이라 첫 구역의 모양만 썼습니다.`)

    const charShapes: { size: number; bold: boolean }[] = []
    const paraAlign: string[] = []
    for (const r of this.docInfo) {
      if (r.tag === TAG.CHAR_SHAPE && r.data.length >= 50) {
        const d = r.data
        charShapes.push({ size: d.readInt32LE(42) / 100, bold: !!(d.readUInt32LE(46) & 0x02) })
        this.shapeMetrics.push([d.readInt32LE(42), d[14], d.readInt8(21), d[28], d[15], d.readInt8(22), d[29]])
      } else if (r.tag === TAG.PARA_SHAPE && r.data.length >= 4) {
        paraAlign.push(ALIGN5[(r.data.readUInt32LE(0) >>> 2) & 7])
      }
    }

    const recs = readRecs(inflate(sec))
    for (let i = 0; i < recs.length; ) {
      if (recs[i].tag !== TAG.PARA_HEADER || recs[i].level !== 0) throw new Error('한글 파일 본문 구조가 예상과 달라 틀로 쓰지 못했습니다.')
      const { p, next } = parsePara(recs, i)
      this.paras.push(p)
      i = next
    }
    if (!this.paras.length) throw new Error('한글 파일에 문단이 없습니다.')

    // 용지 설정(PAGE_DEF): 폭·높이·여백 4개·머리말·꼬리말. 가로 용지면 폭이 높이가 된다.
    const pageDef = this.paras[0].toks.find((t) => t.ctrl === 'secd')?.tree?.find((r) => r.tag === 73)
    if (pageDef && pageDef.data.length >= 40) {
      const v = [0, 4, 8, 12, 16, 20, 24, 28].map((o) => pageDef.data.readUInt32LE(o))
      const height = pageDef.data.readUInt32LE(36) & 1 ? v[0] : v[1]
      this.pageHeight = Math.max(0, height - v[4] - v[5] - v[6] - v[7])
    }

    this.paras.forEach((p, i) => {
      const { text, shapes } = hText(p)
      const direct = this.register(p, i, null)
      const hasObject = p.toks.some((t) => t.ctrl && !SECTION_CTRL.has(t.ctrl))
      const cs = charShapes[shapes.length ? dominant(shapes, text) : (p.toks[0]?.shape ?? 0)]
      this.blocks.push({
        id: `P${i}`,
        text: squash(text),
        lead: leadOf(text),
        kind: direct.tables.length ? 'table' : text.trim() ? 'text' : direct.boxes.length ? 'box' : hasObject ? 'object' : 'empty',
        style: { align: paraAlign[p.header.readUInt16LE(8)] ?? 'J', size: cs?.size ?? 10, bold: !!cs?.bold },
        pageBreak: !!(p.header[11] & 0x04),
        ...direct
      })
    })
  }

  /** 문단에 든 표·글상자에 번호를 붙이고, 그 안의 문단도 따라 들어간다 */
  private register(p: HPara, home: number, parent: string | null): { tables: string[]; boxes: string[] } {
    const direct = { tables: [] as string[], boxes: [] as string[] }
    if (!p.sound) return direct
    for (const t of p.toks) {
      if (!t.tree) continue
      if (t.ctrl === 'tbl ') {
        const id = `T${this.nT++}`
        const table = parseTable(t.tree)
        if (!table) continue
        this.reg.set(t.tree, { id, table })
        direct.tables.push(id)
        const entry: Entry = { id, kind: 'table', home, parent }
        this.entries.push(entry)
        for (const c of table.cells) for (const cp of c.paras) this.register(cp, home, id)
        // 안쪽 표가 든 칸은 그 자리를 [T5] 로 보여 준다(표가 든 문단은 그대로 둔다)
        for (const c of table.cells) {
          if (!c.nested) continue
          c.text = c.paras
            .map((cp) => (hasTable(cp) ? cp.toks.filter((x) => x.ctrl === 'tbl ').map((x) => `[${this.reg.get(x.tree!)?.id}]`).join('\n') : hText(cp).text))
            .join('\n')
        }
        entry.rows = cellInfo(table.rows)
      } else if (t.ctrl === 'gso ') {
        const box = parseBox(t.tree)
        if (!box || !box.text.trim()) continue
        const id = `B${this.nB++}`
        this.reg.set(t.tree, { id, box })
        direct.boxes.push(id)
        this.entries.push({ id, kind: 'box', home, parent, lines: box.paras.map((bp) => hText(bp).text) })
        for (const bp of box.paras) this.register(bp, home, id)
      }
    }
    return direct
  }

  private treeOf(ov: Overrides): TreeOf {
    const self = (t: HTok): Rec[] => {
      const r = this.reg.get(t.tree!)
      const inner: Metrics = { width: this.widthOf, pageHeight: 0 }
      if (r?.table) return hRebuildTable(r.table, ov.tables.get(r.id) ?? null, self, inner)
      if (r?.box) return hRebuildBox(r.box, ov.boxes.get(r.id) ?? null, self, inner)
      return t.tree!
    }
    return self
  }

  build(emits: Emit[], global: Overrides, preview: string): Uint8Array {
    const p0 = this.paras[0]
    const isSec = (t: HTok): boolean => !!t.ctrl && SECTION_CTRL.has(t.ctrl)
    /** 구역 정의·단 정의 — 구역 첫 문단에 꼭 하나만 있어야 한다 */
    const isStart = (t: HTok): boolean => t.ctrl === 'secd' || t.ctrl === 'cold'
    const secToks = p0.toks.filter(isSec)
    const recs: Rec[] = []
    const out: { p: HPara; treeOf: TreeOf }[] = []
    emits.forEach((e, n) => {
      const src = this.paras[e.block]
      const info = this.blocks[e.block]
      let p: HPara
      if (e.op === 'text' && squash(e.text) !== info.text) {
        p = hClone(src, withLead(info.lead, e.text), hObjects(src))
      } else p = copyPara(src)
      // 쪽 설정·머리말은 양식 첫 문단의 것을 새 문서 첫 문단에 둔다.
      // 중간 문단의 쪽 번호 감추기·새 번호 같은 부호는 그 문단에 그대로 둔다.
      if (n === 0) {
        if (!(e.block === 0 && !p.dirty && p.toks.some(isSec))) {
          p.toks = [...secToks.map((t) => ({ ...t })), ...p.toks.filter((t) => !isSec(t))]
          p.dirty = true
        }
        p.header[11] = p0.header[11]
      } else {
        const drop = e.block === 0 ? isSec : isStart
        if (p.toks.some(drop)) {
          p.toks = p.toks.filter((t) => !drop(t))
          p.dirty = true
        }
        p.header[11] = (p.header[11] & 0xf0) | (e.pageBreak ? 0x04 : 0)
      }
      out.push({ p, treeOf: this.treeOf(mergeOv(global, e.op === 'copy' ? e.ov : undefined)) })
    })
    if (!out.length) throw new Error('만들 내용이 없습니다.')
    layoutList(
      out.map((o) => o.p),
      { width: this.widthOf, pageHeight: this.pageHeight }
    )
    out.forEach(({ p, treeOf }, n) => recs.push(...paraRecs(p, 0, n === out.length - 1, treeOf)))

    const body = writeRecs(recs)
    const bodyText = oleFind(this.root, 'BodyText')!
    const sec0 = oleFind(this.root, 'BodyText/Section0')!
    sec0.data = this.compressed ? compress(body) : body
    bodyText.kids = [sec0]

    // 문서 정보: 구역 수 1, 저장해 둔 커서 자리는 맨 앞으로
    const props = this.docInfo.find((r) => r.tag === TAG.DOC_PROPS)
    if (props && props.data.length >= 26) {
      const d = Buffer.from(props.data)
      d.writeUInt16LE(1, 0)
      d.fill(0, 14, 26)
      props.data = d
      const raw = writeRecs(this.docInfo)
      oleFind(this.root, 'DocInfo')!.data = this.compressed ? compress(raw) : raw
    }
    const prvText = oleFind(this.root, 'PrvText')
    if (prvText) prvText.data = Buffer.from(preview.slice(0, 1000), 'utf16le')
    const prvImage = oleFind(this.root, 'PrvImage')
    if (prvImage) prvImage.data = Buffer.from(BLANK_PNG)
    return new Uint8Array(writeOle(this.root))
  }
}

/* ---------- .hwpx ---------- */

interface XEl {
  name: string
  start: number
  openEnd: number
  end: number
  self: boolean
}

const TAG_RE = /<(\/?)([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g

/** xml[from, to) 안의 맨 윗단 요소들 */
function kidsOf(xml: string, from: number, to: number): XEl[] {
  const re = new RegExp(TAG_RE.source, 'g')
  re.lastIndex = from
  const out: XEl[] = []
  let depth = 0
  let cur: XEl | null = null
  for (let m = re.exec(xml); m && m.index < to; m = re.exec(xml)) {
    if (m[1] === '/') {
      depth--
      if (depth === 0 && cur) {
        cur.end = m.index + m[0].length
        out.push(cur)
        cur = null
      }
      if (depth < 0) break
    } else if (m[4] === '/') {
      if (depth === 0) out.push({ name: m[2], start: m.index, openEnd: m.index + m[0].length, end: m.index + m[0].length, self: true })
    } else {
      if (depth === 0) cur = { name: m[2], start: m.index, openEnd: m.index + m[0].length, end: -1, self: false }
      depth++
    }
  }
  return out
}

const local = (name: string): string => name.slice(name.indexOf(':') + 1)
const innerEnd = (el: XEl): number => (el.self ? el.end : el.end - `</${el.name}>`.length)
const attrOf = (tag: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
function setAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`(\\s${name}=)"[^"]*"`)
  if (re.test(tag)) return tag.replace(re, `$1"${value}"`)
  return tag.replace(/\s*(\/?)>$/, ` ${name}="${value}"$1>`)
}
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const unesc = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(+d))
    .replace(/&amp;/g, '&')

/** 머리말·꼬리말·쪽 번호 — 양식 첫 문단에 있으면 새 문서 첫 문단으로 옮긴다 */
const X_PAGE = new Set(['header', 'footer', 'pageNum', 'pageHiding', 'pageNumCtrl', 'newNum'])

type XChar = { ch: string; shape: string }
type XObj = { el: string; kind: 'section' | 'page' | 'object' | 'table' | 'drop'; shape: string; start: number; end: number }
type XItem = XChar | XObj
const isObj = (it: XItem): it is XObj => !('ch' in it)

interface XPara {
  ns: string
  raw: string
  open: string
  items: XItem[]
  shape0: string
}

function parseXPara(xml: string, el: XEl): XPara {
  const raw = xml.slice(el.start, el.end)
  const ns = el.name.includes(':') ? el.name.slice(0, el.name.indexOf(':')) : 'hp'
  const open = xml.slice(el.start, el.openEnd)
  const items: XItem[] = []
  let shape0 = ''
  for (const run of kidsOf(xml, el.openEnd, innerEnd(el))) {
    if (local(run.name) !== 'run') continue
    const shape = attrOf(xml.slice(run.start, run.openEnd), 'charPrIDRef') ?? '0'
    if (!shape0) shape0 = shape
    if (run.self) continue
    for (const c of kidsOf(xml, run.openEnd, innerEnd(run))) {
      const name = local(c.name)
      const at = { start: c.start - el.start, end: c.end - el.start }
      if (name === 't') {
        if (c.self) continue
        const inner = xml.slice(c.openEnd, innerEnd(c))
        for (const m of inner.matchAll(/<([\w:.-]+)[^>]*?\/>|<([\w:.-]+)[^>]*>[\s\S]*?<\/\2>|([^<]+)/g)) {
          if (m[3] !== undefined) {
            for (const ch of unesc(m[3])) items.push({ ch, shape })
          } else {
            const n = local(m[1] ?? m[2])
            const ch = n === 'tab' ? '\t' : n === 'lineBreak' ? '\n' : n === 'nbSpace' || n === 'fwSpace' ? ' ' : n === 'hyphen' ? '-' : ''
            if (ch) items.push({ ch, shape })
          }
        }
      } else if (name === 'secPr') {
        items.push({ el: xml.slice(c.start, c.end), kind: 'section', shape, ...at })
      } else if (name === 'ctrl') {
        const first = kidsOf(xml, c.openEnd, innerEnd(c))[0]
        items.push({ el: xml.slice(c.start, c.end), kind: !first ? 'drop' : local(first.name) === 'colPr' ? 'section' : X_PAGE.has(local(first.name)) ? 'page' : 'drop', shape, ...at })
      } else if (name === 'tbl') {
        items.push({ el: xml.slice(c.start, c.end), kind: 'table', shape, ...at })
      } else {
        items.push({ el: xml.slice(c.start, c.end), kind: 'object', shape, ...at })
      }
    }
  }
  return { ns, raw, open, items, shape0: shape0 || '0' }
}

const SEG_RE = /<([\w]+:)?linesegarray\b[^>]*?(?:\/>|>[\s\S]*?<\/\1linesegarray>)/g

function xText(p: XPara): { text: string; shapes: string[] } {
  let text = ''
  const shapes: string[] = []
  for (const it of p.items) {
    if (!isObj(it)) {
      text += it.ch
      shapes.push(it.shape)
    }
  }
  return { text, shapes }
}

/** 표·글상자를 새로 짠 xml 로 바꿔 주는 것 */
type ObjXml = (it: XObj) => string

const xOpen = (open: string, pageBreak: boolean): string =>
  setAttr(setAttr(open, 'pageBreak', pageBreak ? '1' : '0'), 'columnBreak', '0')

/** 항목들로 문단을 새로 쓴다 */
function xWrite(p: XPara, items: XItem[], pageBreak: boolean, objXml: ObjXml): string {
  const ns = p.ns
  let body = ''
  let run: string | null = null
  let buf = ''
  let text = ''
  const flushText = (): void => {
    if (!text) return
    buf += `<${ns}:t>${esc(text).replace(/\t/g, `<${ns}:tab/>`).replace(/\n/g, `<${ns}:lineBreak/>`)}</${ns}:t>`
    text = ''
  }
  const flushRun = (): void => {
    flushText()
    if (run !== null) body += `<${ns}:run charPrIDRef="${run}">${buf}</${ns}:run>`
    buf = ''
    run = null
  }
  for (const it of items) {
    if (it.shape !== run) {
      flushRun()
      run = it.shape
    }
    if (!isObj(it)) text += it.ch
    else {
      flushText()
      buf += objXml(it)
    }
  }
  flushRun()
  if (!body) body = `<${ns}:run charPrIDRef="${p.shape0}"/>`
  return `${xOpen(p.open, pageBreak)}${body}</${ns}:p>`
}

/** 원래 문단 글을 그대로 두고, 표·글상자와 edits 자리만 갈아 끼운다 */
function xKeep(p: XPara, pageBreak: boolean, objXml: ObjXml, edits: { start: number; end: number; text: string }[] = []): string {
  const all = [...edits]
  for (const it of p.items) {
    if (isObj(it) && (it.kind === 'table' || it.kind === 'object')) {
      const x = objXml(it)
      if (x !== it.el) all.push({ start: it.start, end: it.end, text: x })
    }
  }
  let s = p.raw
  for (const e of all.sort((a, b) => b.start - a.start)) s = s.slice(0, e.start) + e.text + s.slice(e.end)
  return xOpen(p.open, pageBreak) + s.slice(p.open.length).replace(SEG_RE, '')
}

function xClone(s: XPara, text: string, keep: XItem[]): XItem[] {
  const { text: st, shapes } = xText(s)
  const base = shapes.length ? dominant(shapes, st) : s.shape0
  const clean = text.replace(/[\u0000-\u001f]/g, ' ')
  const mapped = mapShapes(st, shapes, clean, base)
  const items: XItem[] = [...keep]
  for (let i = 0; i < clean.length; i++) items.push({ ch: clean[i], shape: mapped[i] })
  return items
}

const xObjects = (p: XPara): XItem[] => p.items.filter((it) => isObj(it) && it.kind === 'object')

function xListParas(samples: XPara[], text: string, objXml: ObjXml, fresh = false): string[] {
  return planLines(samples, (p) => xText(p).text, text).map(({ sample, line, first }) =>
    !fresh && first && squash(line) === squash(xText(sample).text)
      ? xKeep(sample, false, objXml)
      : xWrite(sample, xClone(sample, line, first ? xObjects(sample) : []), false, objXml)
  )
}

const xHasTable = (p: XPara): boolean => p.items.some((it) => isObj(it) && it.kind === 'table')

function xCellParas(c: { paras: XPara[]; nested: boolean }, text: string, objXml: ObjXml): string[] {
  if (!c.nested) return xListParas(c.paras, text, objXml)
  return mixParas(
    c.paras,
    xHasTable,
    text,
    (samples, t, fresh) => xListParas(samples, t, objXml, fresh),
    (p) => xKeep(p, false, objXml)
  )
}

interface XCell {
  open: string
  subOpen: string
  subClose: string
  rest: XEl[]
  xml: string
  paras: XPara[]
  rowSpan: number
  nested: boolean
  text: string
}

interface XTable {
  open: string
  headXml: string
  tailXml: string
  close: string
  trOpen: string[]
  rows: XCell[][]
}

function parseXTable(xml: string): XTable | null {
  const el = kidsOf(xml, 0, xml.length)[0]
  if (!el || el.self) return null
  const trs = kidsOf(xml, el.openEnd, innerEnd(el)).filter((k) => local(k.name) === 'tr')
  if (!trs.length) return null
  const rows: XCell[][] = []
  const trOpen: string[] = []
  for (const tr of trs) {
    trOpen.push(xml.slice(tr.start, tr.openEnd))
    const row: XCell[] = []
    for (const tc of kidsOf(xml, tr.openEnd, innerEnd(tr))) {
      if (local(tc.name) !== 'tc') return null
      const parts = kidsOf(xml, tc.openEnd, innerEnd(tc))
      const sub = parts.find((k) => local(k.name) === 'subList')
      if (!sub || sub.self) return null
      const paras = kidsOf(xml, sub.openEnd, innerEnd(sub))
        .filter((k) => local(k.name) === 'p')
        .map((k) => parseXPara(xml, k))
      if (!paras.length) return null
      const span = parts.find((k) => local(k.name) === 'cellSpan')
      row.push({
        open: xml.slice(tc.start, tc.openEnd),
        subOpen: xml.slice(sub.start, sub.openEnd),
        subClose: `</${sub.name}>`,
        rest: parts,
        xml,
        paras,
        rowSpan: Math.max(1, +(attrOf(span ? xml.slice(span.start, span.end) : '', 'rowSpan') ?? 1) || 1),
        nested: paras.some((p) => p.items.some((it) => isObj(it) && it.kind === 'table')),
        text: paras.map((p) => xText(p).text).join('\n')
      })
    }
    rows.push(row)
  }
  return {
    open: xml.slice(el.start, el.openEnd),
    headXml: xml.slice(el.openEnd, trs[0].start),
    tailXml: xml.slice(trs[trs.length - 1].end, innerEnd(el)),
    close: `</${el.name}>`,
    trOpen,
    rows
  }
}

const closeOf = (open: string): string => `</${open.slice(1, open.search(/[\s>/]/))}>`

function xRebuildTable(t: XTable, wanted: string[][] | null, objXml: ObjXml): string {
  const plan = planRows(cellInfo(t.rows), wanted)
  const trs = plan.map((rp, i) => {
    const cells = t.rows[rp.from].map((c, k) => {
      const want = rp.texts[k]
      const paras = want === null ? c.paras.map((p) => xKeep(p, false, objXml)) : xCellParas(c, want, objXml)
      const parts = c.rest
        .map((part) => {
          const name = local(part.name)
          const x = c.xml.slice(part.start, part.end)
          if (name === 'subList') return c.subOpen + paras.join('') + c.subClose
          if (name === 'cellAddr') return setAttr(x, 'rowAddr', String(i))
          if (name === 'cellSpan') return setAttr(x, 'rowSpan', String(Math.max(1, Math.min(c.rowSpan, plan.length - i))))
          return x
        })
        .join('')
      return c.open + parts + closeOf(c.open)
    })
    const trOpen = t.trOpen[rp.from]
    return trOpen + cells.join('') + closeOf(trOpen)
  })
  // 칸 묶음 배경(cellzone)이 없어진 행을 가리키지 않게
  const head = t.headXml.replace(/<([\w]+:)?cellzone\b[^>]*\/>/g, (z) => {
    if (+(attrOf(z, 'startRowAddr') ?? 0) >= plan.length) return ''
    return +(attrOf(z, 'endRowAddr') ?? 0) >= plan.length ? setAttr(z, 'endRowAddr', String(plan.length - 1)) : z
  })
  return setAttr(t.open, 'rowCnt', String(plan.length)) + head + trs.join('') + t.tailXml + t.close
}

interface XBox {
  xml: string
  subOpenEnd: number
  subInnerEnd: number
  paras: XPara[]
  text: string
}

function parseXBox(xml: string): XBox | null {
  const at = xml.search(/<[\w]+:drawText[\s>]/)
  if (at < 0) return null
  const dt = kidsOf(xml, at, xml.length)[0]
  if (!dt || dt.self) return null
  const sub = kidsOf(xml, dt.openEnd, innerEnd(dt)).find((k) => local(k.name) === 'subList')
  if (!sub || sub.self) return null
  const paras = kidsOf(xml, sub.openEnd, innerEnd(sub))
    .filter((k) => local(k.name) === 'p')
    .map((k) => parseXPara(xml, k))
  if (!paras.length) return null
  return { xml, subOpenEnd: sub.openEnd, subInnerEnd: innerEnd(sub), paras, text: paras.map((p) => xText(p).text).join('\n') }
}

function xRebuildBox(b: XBox, lines: string[] | null, objXml: ObjXml): string {
  const paras = lines === null ? b.paras.map((p) => xKeep(p, false, objXml)) : xListParas(b.paras, lines.join('\n'), objXml)
  return b.xml.slice(0, b.subOpenEnd) + paras.join('') + b.xml.slice(b.subInnerEnd)
}

const XALIGN: Record<string, string> = { JUSTIFY: 'J', LEFT: 'L', RIGHT: 'R', CENTER: 'C', DISTRIBUTE: 'D', DISTRIBUTE_SPACE: 'D' }

class HwpxFrame implements Frame {
  kind: HwpKind = 'hwpx'
  blocks: BlockInfo[] = []
  entries: Entry[] = []
  notes: string[] = []
  private files: Record<string, Uint8Array>
  private prefix: string
  private suffix: string
  private paras: XPara[] = []
  private reg = new Map<XObj, { id: string; table?: XTable; box?: XBox }>()
  private nT = 0
  private nB = 0

  constructor(data: Uint8Array) {
    this.files = unzipSync(data)
    const secNames = Object.keys(this.files).filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
    const name = secNames.find((n) => /section0\.xml$/i.test(n))
    if (!name) throw new Error('한글 파일 본문(section0.xml)을 찾지 못했습니다.')
    if (secNames.length > 1) this.notes.push(`구역이 ${secNames.length}개인 양식이라 첫 구역의 모양만 썼습니다.`)
    const xml = strFromU8(this.files[name])
    const sec = kidsOf(xml, 0, xml.length).find((k) => local(k.name) === 'sec')
    if (!sec || sec.self) throw new Error('한글 파일 본문 구조가 예상과 달라 틀로 쓰지 못했습니다.')
    this.prefix = xml.slice(0, sec.openEnd)
    this.suffix = xml.slice(innerEnd(sec))
    const top = kidsOf(xml, sec.openEnd, innerEnd(sec))
    if (top.some((k) => local(k.name) !== 'p')) throw new Error('한글 파일 본문 구조가 예상과 달라 틀로 쓰지 못했습니다.')
    this.paras = top.map((k) => parseXPara(xml, k))
    if (!this.paras.length) throw new Error('한글 파일에 문단이 없습니다.')

    const head = strFromU8(this.files['Contents/header.xml'] ?? new Uint8Array())
    const chars = new Map<string, { size: number; bold: boolean }>()
    for (const m of head.matchAll(/<(?:\w+:)?charPr\b[^>]*\bid="(\d+)"[^>]*?\bheight="(\d+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?charPr>/g)) {
      chars.set(m[1], { size: +m[2] / 100, bold: /<(?:\w+:)?bold\s*\/>/.test(m[3]) })
    }
    const aligns = new Map<string, string>()
    for (const m of head.matchAll(/<(?:\w+:)?paraPr\b[^>]*\bid="(\d+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?paraPr>/g)) {
      aligns.set(m[1], XALIGN[/<(?:\w+:)?align\b[^>]*\bhorizontal="(\w+)"/.exec(m[2])?.[1] ?? 'JUSTIFY'] ?? 'J')
    }

    this.paras.forEach((p, i) => {
      const { text, shapes } = xText(p)
      const direct = this.register(p, i, null)
      const hasObject = p.items.some((it) => isObj(it) && it.kind !== 'section')
      const cs = chars.get(shapes.length ? dominant(shapes, text) : p.shape0)
      this.blocks.push({
        id: `P${i}`,
        text: squash(text),
        lead: leadOf(text),
        kind: direct.tables.length ? 'table' : text.trim() ? 'text' : direct.boxes.length ? 'box' : hasObject ? 'object' : 'empty',
        style: { align: aligns.get(attrOf(p.open, 'paraPrIDRef') ?? '') ?? 'J', size: cs?.size ?? 10, bold: !!cs?.bold },
        pageBreak: attrOf(p.open, 'pageBreak') === '1',
        ...direct
      })
    })
  }

  private register(p: XPara, home: number, parent: string | null): { tables: string[]; boxes: string[] } {
    const direct = { tables: [] as string[], boxes: [] as string[] }
    for (const it of p.items) {
      if (!isObj(it)) continue
      if (it.kind === 'table') {
        const id = `T${this.nT++}`
        const table = parseXTable(it.el)
        if (!table) continue
        this.reg.set(it, { id, table })
        direct.tables.push(id)
        const entry: Entry = { id, kind: 'table', home, parent }
        this.entries.push(entry)
        for (const r of table.rows) for (const c of r) for (const cp of c.paras) this.register(cp, home, id)
        // 안쪽 표가 든 칸은 그 자리를 [T5] 로 보여 준다(표가 든 문단은 그대로 둔다)
        for (const r of table.rows) {
          for (const c of r) {
            if (!c.nested) continue
            c.text = c.paras
              .map((cp) =>
                xHasTable(cp)
                  ? cp.items.filter((x): x is XObj => isObj(x) && x.kind === 'table').map((x) => `[${this.reg.get(x)?.id}]`).join('\n')
                  : xText(cp).text
              )
              .join('\n')
          }
        }
        entry.rows = cellInfo(table.rows)
      } else if (it.kind === 'object') {
        const box = parseXBox(it.el)
        if (!box || !box.text.trim()) continue
        const id = `B${this.nB++}`
        this.reg.set(it, { id, box })
        direct.boxes.push(id)
        this.entries.push({ id, kind: 'box', home, parent, lines: box.paras.map((bp) => xText(bp).text) })
        for (const bp of box.paras) this.register(bp, home, id)
      }
    }
    return direct
  }

  private objXml(ov: Overrides): ObjXml {
    const self = (it: XObj): string => {
      const r = this.reg.get(it)
      if (r?.table) return xRebuildTable(r.table, ov.tables.get(r.id) ?? null, self)
      if (r?.box) return xRebuildBox(r.box, ov.boxes.get(r.id) ?? null, self)
      return it.el
    }
    return self
  }

  build(emits: Emit[], global: Overrides, preview: string): Uint8Array {
    const p0 = this.paras[0]
    const secItems = p0.items.filter((it) => isObj(it) && (it.kind === 'section' || it.kind === 'page')) as XObj[]
    const secRun = secItems.length ? `<${p0.ns}:run charPrIDRef="${secItems[0].shape}">${secItems.map((it) => it.el).join('')}</${p0.ns}:run>` : ''
    const out: string[] = []
    emits.forEach((e, n) => {
      const src = this.paras[e.block]
      const info = this.blocks[e.block]
      const first = n === 0
      const pageBreak = !first && e.pageBreak
      const objXml = this.objXml(mergeOv(global, e.op === 'copy' ? e.ov : undefined))
      if (e.op === 'text' && squash(e.text) !== info.text) {
        const keep = xObjects(src)
        out.push(xWrite(src, xClone(src, withLead(info.lead, e.text), first ? [...secItems, ...keep] : keep), pageBreak, objXml))
        return
      }
      const edits: { start: number; end: number; text: string }[] = []
      // 구역 정의(secPr·colPr)는 첫 문단에만. 중간 문단의 쪽 번호 감추기 같은 것은 그대로 둔다.
      const drop = (it: XItem): boolean => isObj(it) && (it.kind === 'section' || (e.block === 0 && it.kind === 'page'))
      if (first && !(e.block === 0 && src.items.some((it) => isObj(it) && it.kind === 'section'))) {
        for (const it of src.items) if (isObj(it) && (it.kind === 'section' || it.kind === 'page')) edits.push({ start: it.start, end: it.end, text: '' })
        edits.push({ start: src.open.length, end: src.open.length, text: secRun })
      } else if (!first) {
        for (const it of src.items) if (drop(it)) edits.push({ start: (it as XObj).start, end: (it as XObj).end, text: '' })
      }
      out.push(xKeep(src, pageBreak, objXml, edits))
    })
    if (!out.length) throw new Error('만들 내용이 없습니다.')

    const files = { ...this.files }
    const secNames = Object.keys(files).filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
    for (const n of secNames) if (!/section0\.xml$/i.test(n)) delete files[n]
    files[secNames.find((n) => /section0\.xml$/i.test(n))!] = strToU8(this.prefix + out.join('') + this.suffix)
    if (secNames.length > 1) {
      const hpf = Object.keys(files).find((n) => /content\.hpf$/i.test(n))
      if (hpf) {
        let x = strFromU8(files[hpf])
        const ids: string[] = []
        x = x.replace(/<([\w]+:)?item\b[^>]*href="Contents\/section(\d+)\.xml"[^>]*\/>/g, (m, _ns, no: string) => {
          if (no === '0') return m
          const id = attrOf(m, 'id')
          if (id) ids.push(id)
          return ''
        })
        for (const id of ids) x = x.replace(new RegExp(`<([\\w]+:)?itemref\\b[^>]*idref="${id}"[^>]*/>`, 'g'), '')
        files[hpf] = strToU8(x)
      }
      const head = files['Contents/header.xml']
      if (head) files['Contents/header.xml'] = strToU8(strFromU8(head).replace(/(\ssecCnt=)"\d+"/, '$1"1"'))
    }
    for (const n of Object.keys(files)) {
      if (/^Preview\/PrvText\.txt$/i.test(n)) files[n] = strToU8(preview.slice(0, 1000))
      else if (/^Preview\/PrvImage\.(png|bmp|gif|jpe?g)$/i.test(n)) files[n] = new Uint8Array(BLANK_PNG)
      else if (/^settings\.xml$/i.test(n)) {
        files[n] = strToU8(
          strFromU8(files[n]).replace(/<([\w]+:)?CaretPosition\b[^>]*\/>/, (m) =>
            setAttr(setAttr(setAttr(m, 'listIDRef', '0'), 'paraIDRef', '0'), 'pos', '0')
          )
        )
      }
    }
    return rezip(files)
  }
}

/* ---------- 바깥에 내놓는 것 ---------- */

function openFrame(buf: Uint8Array): Frame {
  const kind = kindOf(buf)
  if (kind === 'hwp') return new HwpFrame(Buffer.from(buf))
  if (kind === 'hwpx') return new HwpxFrame(buf)
  throw new Error('한글 파일(.hwp · .hwpx)이 아닙니다.')
}

const ALIGN_NAME: Record<string, string> = { C: '가운데', R: '오른쪽', D: '배분' }

function baseSize(blocks: BlockInfo[]): number {
  const w = new Map<number, number>()
  for (const b of blocks) if (b.kind === 'text') w.set(b.style.size, (w.get(b.style.size) ?? 0) + b.text.length)
  let best = 10
  let n = -1
  for (const [k, v] of w) if (v > n) [best, n] = [k, v]
  return best
}

function styleLabel(s: Style): string {
  return [ALIGN_NAME[s.align], `${Math.round(s.size * 10) / 10}pt`, s.bold ? '굵게' : ''].filter(Boolean).join(' · ')
}

function blankTailOf(rows: CellInfo[][]): number {
  let n = 0
  while (n < rows.length && blankRow(rows[rows.length - 1 - n])) n++
  return n
}

/** 양식의 모양(문단·표·글상자)을 읽는다. 화면과 AI 에 보여 줄 것. */
export function readFrame(buf: Uint8Array): FrameLayout {
  let frame: Frame
  try {
    frame = openFrame(buf)
  } catch (e) {
    return { ok: false, kind: kindOf(buf) ?? 'hwpx', blocks: [], tables: [], boxes: [], notes: [], error: e instanceof Error ? e.message : String(e) }
  }
  const tables: FrameTable[] = []
  const boxes: FrameBox[] = []
  for (const e of frame.entries) {
    if (e.kind === 'table') {
      const rows = e.rows!
      tables.push({
        id: e.id,
        parent: e.parent,
        rows: rows.map((r) => r.map((c) => c.text)),
        fixed: rows.map((r) => r.map((c) => c.nested)),
        blankTail: blankTailOf(rows)
      })
    } else boxes.push({ id: e.id, parent: e.parent, text: e.lines!.join('\n') })
  }
  return {
    ok: true,
    kind: frame.kind,
    blocks: frame.blocks.map((b) => ({ id: b.id, text: b.text, style: styleLabel(b.style), kind: b.kind, tables: b.tables, boxes: b.boxes })),
    tables,
    boxes,
    notes: frame.notes
  }
}

/** AI 에게 보여 줄 양식의 모습. [P3] 문단, [T0] 표, [B0] 글상자. 빈 줄·그림은 뺀다. */
export function frameOutline(buf: Uint8Array, mask: (s: string) => string = (s) => s, limit = 24000): string {
  const frame = openFrame(buf)
  const base = baseSize(frame.blocks)
  const lines: string[] = []
  const flat = (s: string, max: number): string => {
    const t = mask(s).replace(/\|/g, '\\|').replace(/\n/g, '<br>')
    return t.length > max ? `${t.slice(0, max)}…` : t
  }
  frame.blocks.forEach((b, i) => {
    if (b.kind === 'text') {
      const s = b.style
      const hint = s.align === 'C' || s.align === 'R' || s.bold || Math.abs(s.size - base) >= 1 ? `(${styleLabel(s)}) ` : ''
      lines.push(`[${b.id}] ${hint}${mask(b.text)}`)
    }
    for (const e of frame.entries) {
      if (e.home !== i) continue
      const inside = e.parent ? ` · ${e.parent} 안` : ''
      if (e.kind === 'box') {
        lines.push(`[${e.id}] (글상자${inside}) ${flat(e.lines!.join('\n'), 600)}`)
        continue
      }
      const rows = e.rows!
      const tail = blankTailOf(rows)
      const shown = tail === rows.length ? rows.slice(0, 1) : rows.slice(0, rows.length - tail)
      lines.push(`[${e.id}] 표 ${rows.length}행${inside}`)
      for (const r of shown) lines.push(`| ${r.map((c) => flat(c.text, 400)).join(' | ')} |`)
      if (rows.length > shown.length) lines.push(`(끝에 빈 행 ${rows.length - shown.length}개 — 쓰지 않은 행은 빈 채로 남습니다)`)
    }
  })
  let out = lines.join('\n')
  if (out.length > limit) out = `${out.slice(0, limit)}\n…(양식이 길어 뒷부분은 줄였습니다)`
  return out
}

/** 양식을 틀로, AI(또는 사람)가 쓴 문단·표·글상자로 새 한글 파일을 만든다. */
export function buildFromFrame(buf: Uint8Array, items: DocItem[]): { data: Uint8Array; notes: string[] } {
  const frame = openFrame(buf)
  const { emits, global } = planEmits(frame.blocks, frame.entries, items)
  if (!emits.some((e) => e.op === 'text' || e.ov) && !global.tables.size && !global.boxes.size) {
    throw new Error('양식에 맞춰 넣을 내용을 찾지 못했습니다.')
  }
  const preview = items.map((it) => (it.kind === 'p' ? it.text : it.rows.map((r) => r.join(' ')).join('\n'))).join('\n')
  return { data: frame.build(emits, global, preview), notes: frame.notes }
}
