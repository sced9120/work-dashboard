import CFB from 'cfb'
import { inflateSync, unzipSync, strFromU8 } from 'fflate'

/**
 * 한글 파일에서 본문 텍스트를 뽑아낸다.
 *
 * .hwp (한글 5.0 형식)은 OLE 복합 문서다. BodyText/SectionN 스트림 안에
 * 레코드가 줄줄이 들어 있고, 보통 raw deflate로 압축되어 있다.
 * 예전 파이썬 버전은 이 압축을 풀지 않고 바로 UTF-16으로 디코딩해서
 * 대부분의 파일에서 글자가 깨졌다. 여기서는 압축을 풀고 레코드를 해석한다.
 *
 * .hwpx는 그냥 zip + xml이라 훨씬 간단하다.
 */

const HWPTAG_PARA_TEXT = 67

/** 8바이트를 차지하는 확장/인라인 컨트롤 문자 */
const WIDE_CONTROLS = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23
])
/** 1글자만 차지하는 컨트롤 문자 */
const CHAR_CONTROLS = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31])

function parseParaText(data: Uint8Array): string {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const count = Math.floor(data.byteLength / 2)
  let out = ''
  let i = 0

  while (i < count) {
    const code = view.getUint16(i * 2, true)

    if (WIDE_CONTROLS.has(code)) {
      // 표, 그림 같은 개체 자리. 본문 흐름에서는 공백으로 둔다.
      out += ' '
      i += 8
      continue
    }
    if (CHAR_CONTROLS.has(code)) {
      if (code === 10 || code === 13) out += '\n'
      i += 1
      continue
    }
    out += String.fromCharCode(code)
    i += 1
  }
  return out
}

function readRecords(stream: Uint8Array): string {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength)
  let pos = 0
  let text = ''

  while (pos + 4 <= stream.byteLength) {
    const header = view.getUint32(pos, true)
    pos += 4

    const tagId = header & 0x3ff
    let size = (header >> 20) & 0xfff

    if (size === 0xfff) {
      if (pos + 4 > stream.byteLength) break
      size = view.getUint32(pos, true)
      pos += 4
    }
    if (pos + size > stream.byteLength) break

    if (tagId === HWPTAG_PARA_TEXT) {
      text += parseParaText(stream.subarray(pos, pos + size))
      text += '\n'
    }
    pos += size
  }
  return text
}

function toU8(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value)) return Uint8Array.from(value as number[])
  return new Uint8Array(0)
}

/** 압축 여부는 FileHeader의 속성 플래그(오프셋 36) 0번 비트에 들어 있다. */
function isCompressed(cfb: CFB.CFB$Container): boolean {
  const header = CFB.find(cfb, 'FileHeader')
  if (!header?.content) return true
  const buf = toU8(header.content)
  if (buf.byteLength < 40) return true
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  return (view.getUint32(36, true) & 1) === 1
}

function isEncrypted(cfb: CFB.CFB$Container): boolean {
  const header = CFB.find(cfb, 'FileHeader')
  if (!header?.content) return false
  const buf = toU8(header.content)
  if (buf.byteLength < 40) return false
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  return (view.getUint32(36, true) & 2) === 2
}

function fromHwp5(buf: Buffer): string {
  const cfb = CFB.read(buf, { type: 'buffer' })

  if (isEncrypted(cfb)) {
    throw new Error('암호가 걸린 한글 파일입니다. 한글에서 암호를 푼 뒤 다시 시도해 주세요.')
  }

  const compressed = isCompressed(cfb)
  const sections = cfb.FullPaths.map((p, idx) => ({ p, idx }))
    .filter(({ p }) => /BodyText\/Section\d+$/i.test(p))
    .sort((a, b) => a.p.localeCompare(b.p, undefined, { numeric: true }))

  let text = ''
  for (const { idx } of sections) {
    const entry = cfb.FileIndex[idx]
    if (!entry?.content) continue
    const raw = toU8(entry.content)
    try {
      text += readRecords(compressed ? inflateSync(raw) : raw)
    } catch {
      // 섹션 하나가 깨져도 나머지는 살린다.
    }
  }

  if (text.trim().length > 0) return text

  // 본문을 못 읽었으면 미리보기 텍스트라도 돌려준다.
  const prv = CFB.find(cfb, 'PrvText')
  if (prv?.content) {
    const raw = toU8(prv.content)
    return new TextDecoder('utf-16le').decode(raw)
  }
  return ''
}

function fromHwpx(buf: Buffer): string {
  const files = unzipSync(new Uint8Array(buf))
  const names = Object.keys(files)
    .filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  let text = ''
  for (const name of names) {
    const xml = strFromU8(files[name])
    // <hp:t> 안의 글자가 본문이다. 문단(<hp:p>)이 끝날 때마다 줄을 바꾼다.
    const withBreaks = xml.replace(/<\/hp:p>/g, '\n')
    for (const m of withBreaks.matchAll(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>/g)) {
      text += decodeXmlEntities(m[1])
    }
    text += '\n'
  }
  return text
}

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}

export function extractHwp(buf: Buffer, ext: string): string {
  if (ext === 'hwpx') return fromHwpx(buf)

  // 확장자가 hwp라도 실제로는 hwpx(zip)인 경우가 있다. 앞 2바이트로 구분한다.
  if (buf.length > 2 && buf[0] === 0x50 && buf[1] === 0x4b) return fromHwpx(buf)
  return fromHwp5(buf)
}
