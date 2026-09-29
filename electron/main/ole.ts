/**
 * OLE 복합 문서(.hwp 의 겉 상자) 읽기·쓰기.
 *
 * 문단을 새로 짜면 본문 스트림의 크기가 바뀌고, 그러면 섹터 할당표를 새로 짜야 한다.
 * 제자리에서 고치지 않고, 원래 디렉터리 항목(이름·CLSID·시간)을 그대로 옮겨 담아
 * 파일을 처음부터 다시 쓴다. cfb 패키지의 write 는 쓸데없는 스트림(\u0001Sh33tJ5)을
 * 끼워 넣어서 쓰지 않는다.
 */

const FREE = 0xffffffff
const END = 0xfffffffe
const FATSECT = 0xfffffffd
const NONE = 0xffffffff
const SECTOR = 512
const MINI = 64
const CUTOFF = 4096

export interface OleNode {
  name: string
  /** 1 저장소, 2 스트림, 5 루트 */
  type: number
  /** 원래 128바이트 항목. CLSID·상태·시간을 그대로 옮기려고 둔다. */
  raw?: Buffer
  data?: Buffer
  kids?: OleNode[]
}

export function readOle(buf: Buffer): OleNode {
  if (buf.length < SECTOR || buf.readUInt32LE(0) !== 0xe011cfd0 || buf.readUInt32LE(4) !== 0xe11ab1a1) {
    throw new Error('한글(.hwp) 파일이 아닙니다.')
  }
  const size = 1 << buf.readUInt16LE(30)
  const miniSize = 1 << buf.readUInt16LE(32)
  const fatCount = buf.readUInt32LE(44)
  const dirStart = buf.readUInt32LE(48)
  const cutoff = buf.readUInt32LE(56)
  const miniFatStart = buf.readUInt32LE(60)
  let difat = buf.readUInt32LE(68)
  const maxSector = Math.floor((buf.length - size) / size)
  const at = (id: number): number => (id + 1) * size
  const bad = (): never => {
    throw new Error('한글 파일 구조가 손상되어 읽지 못했습니다.')
  }

  const fatSectors: number[] = []
  for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) {
    const id = buf.readUInt32LE(76 + i * 4)
    if (id !== FREE) fatSectors.push(id)
  }
  for (let guard = 0; difat !== END && difat !== FREE && fatSectors.length < fatCount; guard++) {
    if (guard > 100000 || difat > maxSector) bad()
    const per = size / 4 - 1
    for (let i = 0; i < per && fatSectors.length < fatCount; i++) {
      const id = buf.readUInt32LE(at(difat) + i * 4)
      if (id !== FREE) fatSectors.push(id)
    }
    difat = buf.readUInt32LE(at(difat) + per * 4)
  }
  const fat: number[] = []
  for (const s of fatSectors) {
    if (s > maxSector) bad()
    for (let i = 0; i < size / 4; i++) fat.push(buf.readUInt32LE(at(s) + i * 4))
  }
  const chain = (start: number, table: number[]): number[] => {
    const out: number[] = []
    for (let id = start; id !== END && id !== FREE; id = table[id]) {
      if (id >= table.length || out.length > table.length) bad()
      out.push(id)
    }
    return out
  }
  const readChain = (start: number, len: number): Buffer => {
    const parts = chain(start, fat).map((s) => {
      if (s > maxSector) bad()
      return buf.subarray(at(s), at(s) + size)
    })
    const all = Buffer.concat(parts)
    return len >= 0 ? all.subarray(0, len) : all
  }

  const dir = readChain(dirStart, -1)
  const entries: Buffer[] = []
  for (let i = 0; i + 128 <= dir.length; i += 128) entries.push(dir.subarray(i, i + 128))
  if (!entries.length || entries[0][66] !== 5) bad()

  const root = entries[0]
  const miniStream = readChain(root.readUInt32LE(116), root.readUInt32LE(120))
  const miniFat: number[] = []
  if (miniFatStart !== END && miniFatStart !== FREE) {
    const mf = readChain(miniFatStart, -1)
    for (let i = 0; i + 4 <= mf.length; i += 4) miniFat.push(mf.readUInt32LE(i))
  }
  const streamOf = (e: Buffer): Buffer => {
    const len = e.readUInt32LE(120)
    const start = e.readUInt32LE(116)
    if (!len) return Buffer.alloc(0)
    if (len < cutoff) {
      const parts = chain(start, miniFat).map((m) => miniStream.subarray(m * miniSize, (m + 1) * miniSize))
      return Buffer.from(Buffer.concat(parts).subarray(0, len))
    }
    return Buffer.from(readChain(start, len))
  }
  const nameOf = (e: Buffer): string => e.toString('utf16le', 0, Math.max(0, Math.min(64, e.readUInt16LE(64)) - 2))

  const seen = new Set<number>()
  const build = (id: number): OleNode => {
    const e = entries[id]
    const node: OleNode = { name: nameOf(e), type: e[66], raw: Buffer.from(e) }
    if (node.type === 2) node.data = streamOf(e)
    else node.kids = collect(e.readUInt32LE(76))
    return node
  }
  // 한 저장소 아래 항목들은 이진 트리(왼쪽·오른쪽 형제)로 이어져 있다.
  const collect = (id: number): OleNode[] => {
    if (id === NONE || id >= entries.length) return []
    if (seen.has(id)) bad()
    seen.add(id)
    const e = entries[id]
    return [...collect(e.readUInt32LE(68)), build(id), ...collect(e.readUInt32LE(72))]
  }
  seen.add(0)
  return build(0)
}

/** 'BodyText/Section0' 처럼 / 로 이은 경로로 찾는다. */
export function oleFind(root: OleNode, path: string): OleNode | undefined {
  let cur: OleNode | undefined = root
  for (const part of path.split('/').filter(Boolean)) {
    cur = cur?.kids?.find((k) => k.name.toUpperCase() === part.toUpperCase())
    if (!cur) return undefined
  }
  return cur
}

/** 저장소 안 항목 순서: 이름이 짧은 것이 먼저, 길이가 같으면 대문자로 견준다. */
function compareNames(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length
  const A = a.toUpperCase()
  const B = b.toUpperCase()
  for (let i = 0; i < A.length; i++) {
    const d = A.charCodeAt(i) - B.charCodeAt(i)
    if (d) return d
  }
  return 0
}

export function writeOle(root: OleNode): Buffer {
  // 1) 항목 번호 매기기 (루트 0)
  const nodes: OleNode[] = []
  const walk = (n: OleNode): void => {
    nodes.push(n)
    for (const k of n.kids ?? []) walk(k)
  }
  walk(root)
  const idOf = new Map(nodes.map((n, i) => [n, i]))
  const left = new Array<number>(nodes.length).fill(NONE)
  const right = new Array<number>(nodes.length).fill(NONE)
  const child = new Array<number>(nodes.length).fill(NONE)
  // 형제들은 이름 순으로 줄 세워 균형 잡힌 이진 트리로 잇는다(모두 검은색).
  const tree = (list: OleNode[]): number => {
    if (!list.length) return NONE
    const mid = Math.floor(list.length / 2)
    const id = idOf.get(list[mid])!
    left[id] = tree(list.slice(0, mid))
    right[id] = tree(list.slice(mid + 1))
    return id
  }
  for (const n of nodes) {
    if (n.type !== 2) child[idOf.get(n)!] = tree([...(n.kids ?? [])].sort((a, b) => compareNames(a.name, b.name)))
  }

  // 2) 스트림 자리 나누기: 4096바이트보다 작으면 미니 스트림
  const streams = nodes.filter((n) => n.type === 2)
  const small = streams.filter((n) => (n.data?.length ?? 0) > 0 && n.data!.length < CUTOFF)
  const large = streams.filter((n) => (n.data?.length ?? 0) >= CUTOFF)
  const miniCount = small.reduce((s, n) => s + Math.ceil(n.data!.length / MINI), 0)
  const miniBytes = miniCount * MINI
  const sectorsOf = (bytes: number): number => Math.ceil(bytes / SECTOR)
  const miniContainer = sectorsOf(miniBytes)
  const miniFatSectors = sectorsOf(miniCount * 4)
  const dirSectors = sectorsOf(nodes.length * 128)
  const dataSectors =
    miniContainer + large.reduce((s, n) => s + sectorsOf(n.data!.length), 0) + miniFatSectors + dirSectors
  let fatSectors = 1
  while (fatSectors * (SECTOR / 4) < dataSectors + fatSectors) fatSectors++
  if (fatSectors > 109) throw new Error('파일이 너무 커서 저장하지 못했습니다.')
  const total = dataSectors + fatSectors

  const out = Buffer.alloc(SECTOR + total * SECTOR)
  const fat = new Array<number>(fatSectors * (SECTOR / 4)).fill(FREE)
  let next = 0
  const place = (data: Buffer | null, count: number): number => {
    if (!count) return END
    const start = next
    for (let i = 0; i < count; i++) fat[start + i] = i === count - 1 ? END : start + i + 1
    if (data) data.copy(out, SECTOR + start * SECTOR)
    next += count
    return start
  }

  // 미니 스트림 담을 자리
  const miniData = Buffer.alloc(miniContainer * SECTOR)
  const miniFat = new Array<number>(miniFatSectors * (SECTOR / 4)).fill(FREE)
  const startOf = new Map<OleNode, number>()
  let m = 0
  for (const n of small) {
    const count = Math.ceil(n.data!.length / MINI)
    startOf.set(n, m)
    for (let i = 0; i < count; i++) miniFat[m + i] = i === count - 1 ? END : m + i + 1
    n.data!.copy(miniData, m * MINI)
    m += count
  }
  const miniStart = place(miniData, miniContainer)
  for (const n of large) startOf.set(n, place(n.data!, sectorsOf(n.data!.length)))
  const miniFatBuf = Buffer.alloc(miniFatSectors * SECTOR)
  miniFat.forEach((v, i) => miniFatBuf.writeUInt32LE(v >>> 0, i * 4))
  const miniFatStart = place(miniFatBuf, miniFatSectors)

  const dir = Buffer.alloc(dirSectors * SECTOR)
  for (let i = 0; i < dirSectors * (SECTOR / 128); i++) {
    const e = dir.subarray(i * 128, i * 128 + 128)
    const n = nodes[i]
    if (!n) {
      e.writeUInt32LE(NONE, 68)
      e.writeUInt32LE(NONE, 72)
      e.writeUInt32LE(NONE, 76)
      continue
    }
    if (n.raw) n.raw.copy(e)
    e.fill(0, 0, 64)
    const name = Buffer.from(n.name.slice(0, 31), 'utf16le')
    name.copy(e, 0)
    e.writeUInt16LE(name.length + 2, 64)
    e[66] = n.type
    e[67] = 1
    e.writeUInt32LE(left[i] >>> 0, 68)
    e.writeUInt32LE(right[i] >>> 0, 72)
    e.writeUInt32LE(child[i] >>> 0, 76)
    let start = END
    let len = 0
    if (n.type === 5) {
      start = miniCount ? miniStart : END
      len = miniBytes
    } else if (n.type === 2) {
      len = n.data?.length ?? 0
      start = len ? startOf.get(n)! : END
    } else {
      start = 0
    }
    e.writeUInt32LE(start >>> 0, 116)
    e.writeUInt32LE(len >>> 0, 120)
    e.writeUInt32LE(0, 124)
  }
  const dirStart = place(dir, dirSectors)

  const fatStart = next
  for (let i = 0; i < fatSectors; i++) fat[fatStart + i] = FATSECT
  next += fatSectors
  for (let i = 0; i < fatSectors; i++) {
    for (let j = 0; j < SECTOR / 4; j++) {
      out.writeUInt32LE(fat[i * (SECTOR / 4) + j] >>> 0, SECTOR + (fatStart + i) * SECTOR + j * 4)
    }
  }

  // 3) 머리
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(out, 0)
  out.writeUInt16LE(0x3e, 24)
  out.writeUInt16LE(3, 26)
  out.writeUInt16LE(0xfffe, 28)
  out.writeUInt16LE(9, 30)
  out.writeUInt16LE(6, 32)
  out.writeUInt32LE(fatSectors, 44)
  out.writeUInt32LE(dirStart, 48)
  out.writeUInt32LE(CUTOFF, 56)
  out.writeUInt32LE(miniFatSectors ? miniFatStart : END, 60)
  out.writeUInt32LE(miniFatSectors, 64)
  out.writeUInt32LE(END, 68)
  out.writeUInt32LE(0, 72)
  for (let i = 0; i < 109; i++) out.writeUInt32LE(i < fatSectors ? fatStart + i : FREE, 76 + i * 4)
  return out
}
