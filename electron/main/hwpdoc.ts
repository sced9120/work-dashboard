import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { blocksToMarkdown, markdownToHwpx, parse, patchHwp, patchHwpx } from 'kordoc'
import type { IRBlock, IRCell } from 'kordoc'
import type { FormEdit, FormLayout, FormSpot, HwpKind } from '../../shared/hwpform'
import { SLOT_RE, slotNamesIn } from '../../shared/hwpform'

/**
 * 학교 한글 양식의 {{칸}}·빈칸을 서식 그대로 채운다(인터넷 안 쓰는 [빈칸만 직접 채우기]).
 * AI 로 새 문서를 쓰는 쪽은 양식을 틀로 문서를 새로 짜는 hwpgen.ts 가 한다.
 *
 * 한글 파일을 읽고 고치는 일은 kordoc 에 맡긴다. kordoc 은 문서를 문단·표 칸
 * 단위로 읽어 마크다운으로 보여 주고, 그 마크다운을 고쳐 넘기면 **바뀐 글자만**
 * 원본 파일 안에서 갈아 끼운다. 테두리·글꼴·로고·표 모양은 1바이트도 건드리지 않는다.
 *
 * 여기서는 그 위에 세 가지를 더한다.
 *  1. 문서 안의 글자 자리에 P3, T0.1.2 같은 이름을 붙여 화면과 파일이 같은 자리를 가리키게 한다.
 *  2. 한 칸에 여러 줄을 넣으면 kordoc 은 hwpx 에서 줄을 공백으로 이어 버린다.
 *     표시 문자로 이어 넣은 뒤, 그 자리에서 문단을 나눠 준다(한글에서 Enter 친 것과 같다).
 *  3. 한글 파일에는 탐색기 미리보기용 글(PrvText)과 그림(PrvImage)이 따로 들어 있는데,
 *     kordoc 은 이것을 손대지 않는다. 지난번 학생 이름이 적힌 문서를 양식으로 쓰면
 *     새 문서의 미리보기에 **지난 학생의 이름이 그대로 남는다.** 새 글로 바꾸고 그림은 비운다.
 */

/** 여러 줄을 한 자리에 넣을 때 줄 사이에 끼워 두는 표시. 한글 문서에 실제로 나올 일이 없는 글자다. */
const BR = '\uE0A0'

/** 흰 점 하나짜리 PNG. 미리보기 그림을 비울 때 쓴다. */
export const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  'base64'
)

const PREVIEW_CHARS = 1000

export function kindOf(buf: Uint8Array): HwpKind | null {
  if (buf.length < 8) return null
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return 'hwp'
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return null
  // zip 이면 PPT·워드일 수도 있다. hwpx 는 맨 앞 mimetype 에 'application/hwp+zip' 을 적어 둔다.
  const head = Buffer.from(buf.subarray(0, 4096)).toString('latin1')
  return head.includes('application/hwp+zip') || head.includes('Contents/section') ? 'hwpx' : null
}

function arrayBufferOf(buf: Uint8Array): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

async function blocksOf(buf: Uint8Array): Promise<IRBlock[]> {
  const res = await parse(arrayBufferOf(buf))
  if (!res.success) throw new Error(res.error || '한글 파일을 읽지 못했습니다.')
  return res.blocks
}

/** kordoc 은 글 속의 `$` 를 수식과 구별하려고 `\$` 로 담는다. 사람에게는 `$` 로 보여 준다. */
const shown = (s: string): string => s.replace(/\\\$/g, '$')
const stored = (s: string): string => s.replace(/\$/g, '\\$')

/* ---------- 자리 이름 붙이기 ---------- */

interface Anchor {
  row: number
  col: number
  cell: IRCell
}

/** 병합된 칸이 덮은 자리를 빼고, 실제로 글을 적을 수 있는 칸만 고른다. */
function anchorsOf(cells: IRCell[][]): Anchor[] {
  const covered = new Set<string>()
  const out: Anchor[] = []
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < cells[r].length; c++) {
      const cell = cells[r][c]
      if (!cell || covered.has(`${r},${c}`)) continue
      out.push({ row: r, col: c, cell })
      for (let dr = 0; dr < Math.max(1, cell.rowSpan); dr++) {
        for (let dc = 0; dc < Math.max(1, cell.colSpan); dc++) {
          if (dr || dc) covered.add(`${r + dr},${c + dc}`)
        }
      }
    }
  }
  return out
}

/** 칸 안에 표가 또 들어 있으면 글자 자리를 믿을 수 없어 고치지 않는다. */
function nested(cell: IRCell): boolean {
  return !!cell.blocks?.some((b) => b.type === 'table')
}

function oneLine(s: string): string {
  return shown(s).replace(/\s+/g, ' ').trim()
}

function spotsOf(blocks: IRBlock[]): FormSpot[] {
  const spots: FormSpot[] = []
  let t = -1
  blocks.forEach((b, i) => {
    if (b.type === 'paragraph' || b.type === 'heading') {
      if ((b.text ?? '').trim()) spots.push({ id: `P${i}`, text: shown(b.text ?? '') })
      return
    }
    if (b.type !== 'table' || !b.table) return
    t++
    const anchors = anchorsOf(b.table.cells)
    const at = new Map(anchors.map((a) => [`${a.row},${a.col}`, a]))
    for (const a of anchors) {
      if (nested(a.cell)) continue
      let label = ''
      // 왼쪽으로 가며 글이 있는 칸을 찾고, 없으면 위로 찾는다.
      for (let c = a.col - 1; c >= 0 && !label; c--) {
        const left = at.get(`${a.row},${c}`)
        if (left && left.cell.text.trim()) label = oneLine(left.cell.text)
      }
      for (let r = a.row - 1; r >= 0 && !label; r--) {
        const up = at.get(`${r},${a.col}`)
        if (up && up.cell.text.trim()) label = oneLine(up.cell.text)
      }
      spots.push({
        id: `T${t}.${a.row}.${a.col}`,
        text: shown(a.cell.text),
        ...(label ? { label: label.slice(0, 40) } : {})
      })
    }
  })
  return spots
}

export async function readLayout(buf: Uint8Array): Promise<FormLayout> {
  const kind = kindOf(buf)
  if (!kind) {
    return { ok: false, kind: 'hwp', spots: [], slots: [], blanks: [], plain: '', error: '한글 파일(.hwp/.hwpx)이 아닙니다.' }
  }
  try {
    const spots = spotsOf(await blocksOf(buf))
    const plain = spots.map((s) => s.text).filter((s) => s.trim()).join('\n')
    const blanks = spots.filter((s) => s.id.startsWith('T') && !s.text.trim() && s.label)
    return { ok: true, kind, spots, slots: slotNamesIn(plain), blanks, plain }
  } catch (e) {
    return {
      ok: false,
      kind,
      spots: [],
      slots: [],
      blanks: [],
      plain: '',
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

/* ---------- 채우기 ---------- */

/** 자리 이름으로 블록을 찾아 글을 바꾼다. 찾지 못한 자리 이름을 돌려준다. */
function applyToBlocks(blocks: IRBlock[], edits: FormEdit[], kind: HwpKind): string[] {
  const tables: IRBlock[] = blocks.filter((b) => b.type === 'table')
  const unknown: string[] = []

  // hwpx 는 줄을 표시 문자로 이어 두었다가 나중에 그 자리에서 문단을 나눈다.
  // hwp 는 문단을 새로 만들 수 없다. kordoc 이 표 칸의 여러 줄은 강제 줄바꿈으로 넣어 주지만,
  // 본문 문단은 줄을 공백으로 잇는다.
  const joinFor = (inCell: boolean) => (text: string): string => {
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    if (kind === 'hwpx') return lines.join(BR)
    return inCell ? lines.join('\n') : lines.map((l) => l.trim()).filter(Boolean).join(' ')
  }

  for (const e of edits) {
    // 빈 글을 넣으면 kordoc 은 "문단 삭제" 로 보고 건너뛴다. 빈칸으로 두려면 공백 하나를 넣는다.
    const text = stored(e.text.trim() ? e.text : ' ')
    const p = /^P(\d+)$/.exec(e.id)
    if (p) {
      const b = blocks[Number(p[1])]
      if (!b || (b.type !== 'paragraph' && b.type !== 'heading')) {
        unknown.push(e.id)
        continue
      }
      b.text = joinFor(false)(text)
      // 굵게·기울임 조각이 남아 있으면 마크다운이 옛 글을 다시 적는다.
      delete b.spans
      continue
    }
    const t = /^T(\d+)\.(\d+)\.(\d+)$/.exec(e.id)
    const cell = t ? tables[Number(t[1])]?.table?.cells[Number(t[2])]?.[Number(t[3])] : undefined
    if (!cell || nested(cell)) {
      unknown.push(e.id)
      continue
    }
    cell.text = joinFor(true)(text)
    delete cell.blocks
  }
  return unknown
}

const norm = (s: string): string =>
  s.split(BR).join(' ').replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim()

/**
 * 양식 파일에 고칠 글을 넣어 새 파일을 만든다. 원본 버퍼는 바꾸지 않는다.
 * 못 바꾼 자리는 missed 로 알려 준다 — 한글에서 직접 고치면 된다.
 */
export async function applyEdits(
  buf: Uint8Array,
  edits: FormEdit[]
): Promise<{ data: Uint8Array; applied: number; missed: FormEdit[] }> {
  const kind = kindOf(buf)
  if (!kind) throw new Error('한글 파일(.hwp/.hwpx)이 아닙니다.')

  const blocks = await blocksOf(buf)
  const before = new Map(spotsOf(blocks).map((s) => [s.id, s.text]))
  // 지금과 같은 글이면 고칠 필요가 없다. 같은 글을 다시 넣으면 kordoc 이 괜히 문단을 새로 쓴다.
  const wanted = edits.filter((e) => before.has(e.id) && norm(before.get(e.id) ?? '') !== norm(e.text))
  const strays = edits.filter((e) => !before.has(e.id))
  if (!wanted.length) return { data: buf, applied: 0, missed: strays }

  const edited = structuredClone(blocks)
  applyToBlocks(edited, wanted, kind)
  const md = blocksToMarkdown(edited)

  const res = kind === 'hwp' ? await patchHwp(buf, md) : await patchHwpx(buf, md)
  if (!res.success || !res.data) throw new Error(res.error || '양식에 글을 넣지 못했습니다.')

  let data: Uint8Array = res.data
  if (kind === 'hwpx') data = finishHwpx(data)

  // 다시 읽어서 실제로 바뀌었는지 자리마다 확인한다. kordoc 이 조용히 건너뛴 곳을 잡아낸다.
  // 표 칸은 이름이 그대로라 이름으로 맞춰 본다. 문단은 여러 줄을 넣으면 문단이 늘어나
  // 뒤쪽 이름이 밀리므로, 넣으려던 줄이 문서 글 속에 모두 있는지로 본다.
  const afterSpots = spotsOf(await blocksOf(data))
  const after = new Map(afterSpots.map((s) => [s.id, s.text]))
  const body = afterSpots
    .filter((s) => s.id.startsWith('P'))
    .map((s) => norm(s.text))
    .join('\n')
  const missed: FormEdit[] = [...strays]
  let applied = 0
  for (const e of wanted) {
    const done = e.id.startsWith('P')
      ? e.text.split('\n').every((line) => !norm(line) || body.includes(norm(line)))
      : norm(after.get(e.id) ?? '') === norm(e.text.trim() ? e.text : ' ')
    if (done) applied++
    else missed.push(e)
  }

  const plain = [...after.values()].filter((s) => s.trim()).join('\n')
  data = kind === 'hwpx' ? previewHwpx(data, plain) : previewHwp(data, plain)
  return { data, applied, missed }
}

/** {{이름}} 자리를 값으로 바꾼다. 인터넷을 쓰지 않는다. */
export async function fillSlots(
  buf: Uint8Array,
  values: Record<string, string>,
  blanks: Record<string, string> = {}
): Promise<{ data: Uint8Array; applied: number; missed: FormEdit[] }> {
  const layout = await readLayout(buf)
  if (!layout.ok) throw new Error(layout.error || '양식을 읽지 못했습니다.')
  const edits: FormEdit[] = []
  for (const s of layout.spots) {
    if (blanks[s.id]?.trim()) {
      edits.push({ id: s.id, text: blanks[s.id] })
      continue
    }
    if (!s.text.includes('{{')) continue
    const next = s.text.replace(SLOT_RE, (whole, name: string) => {
      const v = values[name.trim()]
      return v === undefined || v === '' ? whole : v
    })
    if (next !== s.text) edits.push({ id: s.id, text: next })
  }
  return applyEdits(buf, edits)
}

/* ---------- hwpx 마무리 ---------- */

/** zip 을 다시 묶는다. mimetype 은 반드시 맨 앞에, 압축하지 않고 넣어야 한글이 연다. */
export function rezip(files: Record<string, Uint8Array>): Uint8Array {
  const ordered: Zippable = {}
  if (files.mimetype) ordered.mimetype = [files.mimetype, { level: 0 }]
  for (const [name, data] of Object.entries(files)) {
    if (name !== 'mimetype') ordered[name] = data
  }
  return zipSync(ordered, { level: 6 })
}

/**
 * 줄 표시 자리에서 문단을 나눈다.
 *
 * 한글에서 Enter 로 줄을 나눈 것과 똑같이 만든다. 강제 줄바꿈(Shift+Enter)으로
 * 넣으면 양쪽 정렬 문단에서 줄 끝까지 글자 사이가 벌어진다. 실제 회의록의
 * '회의 내용' 칸도 줄마다 문단을 나눠 쓴다.
 *
 * 문단·글자 모양은 나누기 전 문단의 것을 그대로 물려받는다. 구조가 예상과 다르면
 * (표 안의 표 등) 그 자리만 강제 줄바꿈으로 넣는다.
 */
function splitAtMarks(xml: string, ns: string): string {
  const P = `<${ns}:p`
  const RUN = `<${ns}:run`
  const lineBreak = `<${ns}:lineBreak/>`
  const segRe = new RegExp(`<${ns}:linesegarray>[\\s\\S]*?</${ns}:linesegarray>`, 'g')
  let out = xml
  for (let guard = 0; guard < 5000; guard++) {
    const at = out.indexOf(BR)
    if (at < 0) break

    const pStart = Math.max(out.lastIndexOf(`${P} `, at), out.lastIndexOf(`${P}>`, at))
    const runStart = Math.max(out.lastIndexOf(`${RUN} `, at), out.lastIndexOf(`${RUN}>`, at))
    const pEnd = out.indexOf(`</${ns}:p>`, at)
    const safe =
      pStart >= 0 &&
      runStart > pStart &&
      pEnd > at &&
      !out.slice(pStart, at).includes(`</${ns}:p>`) &&
      !out.slice(runStart, at).includes(`</${ns}:run>`) &&
      !out.slice(at, pEnd).includes(`${P} `)
    if (!safe) {
      out = out.slice(0, at) + lineBreak + out.slice(at + 1)
      continue
    }

    const pTag = out
      .slice(pStart, out.indexOf('>', pStart) + 1)
      .replace(/\spageBreak="1"/, ' pageBreak="0"')
      .replace(/\scolumnBreak="1"/, ' columnBreak="0"')
    const runTag = out.slice(runStart, out.indexOf('>', runStart) + 1)
    // 옛 줄 배치 정보는 나누기 전 글에 맞춰져 있다. 지우면 한글이 새로 계산한다.
    const head = out.slice(pStart, at).replace(segRe, '')
    const tail = out.slice(at + 1, pEnd).replace(segRe, '')
    out =
      out.slice(0, pStart) +
      `${head}</${ns}:t></${ns}:run></${ns}:p>${pTag}${runTag}<${ns}:t>${tail}` +
      out.slice(pEnd)
  }
  return out
}

/** 줄 표시를 실제 문단 나눔으로 바꾼다. */
function finishHwpx(data: Uint8Array): Uint8Array {
  const files = unzipSync(data)
  let touched = false
  for (const name of Object.keys(files)) {
    if (!/^Contents\/section\d+\.xml$/i.test(name)) continue
    const xml = strFromU8(files[name])
    if (!xml.includes(BR)) continue
    const ns = /<([A-Za-z0-9]+):p[\s>]/.exec(xml)?.[1] ?? 'hp'
    files[name] = strToU8(splitAtMarks(xml, ns))
    touched = true
  }
  return touched ? rezip(files) : data
}

function previewHwpx(data: Uint8Array, plain: string): Uint8Array {
  const files = unzipSync(data)
  let touched = false
  for (const name of Object.keys(files)) {
    if (/^Preview\/PrvText\.txt$/i.test(name)) {
      files[name] = strToU8(plain.slice(0, PREVIEW_CHARS))
      touched = true
    } else if (/^Preview\/PrvImage\.(png|bmp|gif|jpe?g)$/i.test(name)) {
      files[name] = new Uint8Array(BLANK_PNG)
      touched = true
    }
  }
  return touched ? rezip(files) : data
}

/* ---------- hwp(OLE) 마무리 ---------- */

const FREE = 0xffffffff
const END = 0xfffffffe

/**
 * OLE 복합 문서 안의 스트림 하나를 **같은 크기로** 덮어쓴다.
 *
 * 크기를 바꾸려면 섹터 할당표를 새로 짜야 해서 위험하다. 미리보기 글과 그림은
 * 크기가 같아도 되므로(글은 공백으로, 그림은 0 으로 채운다) 제자리에 덮어쓰기만 한다.
 * 찾지 못하거나 구조가 이상하면 아무것도 하지 않고 false 를 돌려준다.
 */
function overwriteOleStream(buf: Buffer, name: string, make: (size: number) => Buffer): boolean {
  if (buf.length < 512 || buf.readUInt32LE(0) !== 0xe011cfd0) return false
  const sectorSize = 1 << buf.readUInt16LE(30)
  const miniSize = 1 << buf.readUInt16LE(32)
  const fatCount = buf.readUInt32LE(44)
  const dirStart = buf.readUInt32LE(48)
  const cutoff = buf.readUInt32LE(56)
  const miniFatStart = buf.readUInt32LE(60)
  let difatNext = buf.readUInt32LE(68)
  const offsetOf = (id: number): number => (id + 1) * sectorSize
  const maxSector = Math.floor((buf.length - sectorSize) / sectorSize)

  // 할당표(FAT) 섹터 번호 모으기
  const fatSectors: number[] = []
  for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) {
    const id = buf.readUInt32LE(76 + i * 4)
    if (id !== FREE) fatSectors.push(id)
  }
  for (let guard = 0; difatNext !== END && difatNext !== FREE && fatSectors.length < fatCount; guard++) {
    if (guard > 10000 || difatNext > maxSector) return false
    const base = offsetOf(difatNext)
    const per = sectorSize / 4 - 1
    for (let i = 0; i < per && fatSectors.length < fatCount; i++) {
      const id = buf.readUInt32LE(base + i * 4)
      if (id !== FREE) fatSectors.push(id)
    }
    difatNext = buf.readUInt32LE(base + per * 4)
  }
  const fat: number[] = []
  for (const s of fatSectors) {
    if (s > maxSector) return false
    const base = offsetOf(s)
    for (let i = 0; i < sectorSize / 4; i++) fat.push(buf.readUInt32LE(base + i * 4))
  }
  const chain = (start: number, table: number[]): number[] => {
    const out: number[] = []
    for (let id = start; id !== END && id !== FREE; id = table[id]) {
      if (id >= table.length || out.length > table.length) return []
      out.push(id)
    }
    return out
  }

  // 디렉터리에서 이름으로 찾기
  const dir = chain(dirStart, fat)
  let rootStart = END
  let target: { start: number; size: number } | null = null
  for (const s of dir) {
    for (let e = 0; e < sectorSize / 128; e++) {
      const at = offsetOf(s) + e * 128
      const type = buf[at + 66]
      if (!type) continue
      const nameLen = Math.max(0, buf.readUInt16LE(at + 64) - 2)
      const entry = buf.toString('utf16le', at, at + Math.min(nameLen, 64))
      const start = buf.readUInt32LE(at + 116)
      const size = buf.readUInt32LE(at + 120)
      if (type === 5) rootStart = start
      else if (type === 2 && entry === name) target = { start, size }
    }
  }
  if (!target || !target.size) return false

  const next = make(target.size)
  if (next.length !== target.size) return false

  if (target.size < cutoff) {
    // 작은 스트림은 루트의 "미니 스트림" 안에 64바이트 조각으로 들어 있다.
    const miniFat: number[] = []
    for (const s of chain(miniFatStart, fat)) {
      for (let i = 0; i < sectorSize / 4; i++) miniFat.push(buf.readUInt32LE(offsetOf(s) + i * 4))
    }
    const rootSectors = chain(rootStart, fat)
    const pieces = chain(target.start, miniFat)
    if (pieces.length * miniSize < target.size) return false
    let written = 0
    for (const m of pieces) {
      const pos = m * miniSize
      const sector = rootSectors[Math.floor(pos / sectorSize)]
      if (sector === undefined) return false
      const at = offsetOf(sector) + (pos % sectorSize)
      const n = Math.min(miniSize, target.size - written)
      next.copy(buf, at, written, written + n)
      written += n
      if (written >= target.size) break
    }
    return true
  }

  const sectors = chain(target.start, fat)
  if (sectors.length * sectorSize < target.size) return false
  let written = 0
  for (const s of sectors) {
    const n = Math.min(sectorSize, target.size - written)
    next.copy(buf, offsetOf(s), written, written + n)
    written += n
    if (written >= target.size) break
  }
  return true
}

function previewHwp(data: Uint8Array, plain: string): Uint8Array {
  const buf = Buffer.from(data)
  overwriteOleStream(buf, 'PrvText', (size) => {
    const out = Buffer.alloc(size)
    // 남는 자리는 공백으로 채운다. UTF-16 이라 두 바이트씩.
    for (let i = 0; i + 1 < size; i += 2) out.writeUInt16LE(0x20, i)
    const text = Buffer.from(plain.slice(0, PREVIEW_CHARS), 'utf16le')
    text.copy(out, 0, 0, Math.min(text.length, size - (size % 2)))
    return out
  })
  overwriteOleStream(buf, 'PrvImage', (size) => {
    const out = Buffer.alloc(size)
    if (size >= BLANK_PNG.length) BLANK_PNG.copy(out)
    return out
  })
  return new Uint8Array(buf)
}

/* ---------- 새 한글 문서 ---------- */

/** 마크다운으로 읽히지 않도록 글자를 막는다. 학교 문서의 "1." "가." "-" 가 목록으로 바뀌면 안 된다. */
function literal(line: string): string {
  const s = line.replace(/[\\`*_[\]<>|~$]/g, (c) => `\\${c}`)
  // 줄머리의 # (제목), - + (목록), 1. 1) (번호 목록), --- === (구분선·제목 밑줄)
  if (/^[-=\s]{3,}$/.test(s)) return `\\${s}`
  return s
    .replace(/^#/, '\\#')
    .replace(/^([-+])(\s)/, '\\$1$2')
    .replace(/^(\d+)([.)])/, '$1\\$2')
}

/**
 * 양식 없이 글만으로 한글 문서(.hwpx)를 만든다. 한글의 기본 모양(함초롬바탕 10pt)이다.
 * 첫 줄이 짧으면 제목으로 크게 쓴다.
 */
export async function textToHwpx(text: string): Promise<Uint8Array> {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''))
  while (lines.length && !lines[0].trim()) lines.shift()
  const parts: string[] = []
  const first = lines[0]?.trim() ?? ''
  if (first && first.length <= 60 && !/^([\d]+[.)]|[-•·※□■○●◆◇▶>*])/.test(first)) {
    parts.push(`# ${literal(first)}`)
    lines.shift()
  }
  for (const l of lines) parts.push(l.trim() ? literal(l.trim()) : '')
  const md = parts.join('\n\n').replace(/\n{3,}/g, '\n\n')
  return new Uint8Array(await markdownToHwpx(md))
}
