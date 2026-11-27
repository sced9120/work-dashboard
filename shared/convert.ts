/**
 * 문서 → PDF 변환 — 한글 · 워드 · 엑셀 · 파워포인트 · 사진 · PDF 를 PDF 로 모으고, 합치고, 나눈다.
 * 화면(src/pages/Convert.tsx)과 메인(electron/main/convert.ts)이 함께 쓰는 약속.
 * 모두 이 PC 안에서 한다(인터넷 · AI 를 쓰지 않는다). 원본 파일은 바꾸지 않는다.
 */

import { parseStudent } from './batch'

export type ConvKind = 'hwp' | 'word' | 'excel' | 'ppt' | 'image' | 'pdf'

const EXT_KIND: Record<string, ConvKind> = {
  hwp: 'hwp',
  hwpx: 'hwp',
  doc: 'word',
  docx: 'word',
  xls: 'excel',
  xlsx: 'excel',
  xlsm: 'excel',
  ppt: 'ppt',
  pptx: 'ppt',
  ppsx: 'ppt',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  pdf: 'pdf'
}

/** 파일 고르기 창에 보일 확장자 */
export const CONV_EXTS = Object.keys(EXT_KIND)

export const CONV_KIND_LABEL: Record<ConvKind, string> = {
  hwp: '한글',
  word: '워드',
  excel: '엑셀',
  ppt: '파워포인트',
  image: '사진',
  pdf: 'PDF'
}

/** 한 번에 다루는 파일 수 · 하위 폴더 깊이 */
export const CONV_MAX_FILES = 500
export const CONV_MAX_DEPTH = 3

export const extOf = (name: string): string => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '')
export const stemOf = (name: string): string => name.replace(/\.[^.]+$/, '')
export const convKindOf = (name: string): ConvKind | null => EXT_KIND[extOf(name)] ?? null

export const byName = (a: string, b: string): number => a.localeCompare(b, 'ko', { numeric: true })

export interface ConvFile {
  /** 이번 실행에서만 쓰는 번호 (경로는 화면에 넘기지 않는다) */
  id: string
  name: string
  /** 고른 폴더 안의 하위 폴더 (없으면 빈 글) */
  sub: string
  size: number
  kind: ConvKind
}

export interface ConvList {
  ok: boolean
  files: ConvFile[]
  /** 바꿀 수 없는 형식이라 뺀 파일 이름 */
  skipped: string[]
  error?: string
}

/** none: 파일마다 하나 · student: 학번이 같은 파일끼리 · all: 모두 하나로 */
export type ConvMerge = 'none' | 'student' | 'all'

export interface ConvOptions {
  merge: ConvMerge
  /** 엑셀 — 시트의 가로를 한 쪽에 맞춘다 */
  excelFit: boolean
}

export interface ConvRequest {
  job: string
  /** 바꿀 파일 (목록 차례) */
  ids: string[]
  options: ConvOptions
}

export interface ConvProgress {
  job: string
  id: string
  status: 'working' | 'done' | 'error'
  error?: string
}

export interface ConvResult {
  ok: boolean
  error?: string
  canceled?: boolean
  /** 저장한 폴더 이름 */
  folder: string
  /** 만든 PDF 수 */
  made: number
  /** 바꾸지 못한 파일 수 */
  failed: number
  /** 알려 둘 것 */
  notes: string[]
}

export interface SplitFile {
  ok: boolean
  canceled?: boolean
  error?: string
  id: string
  name: string
  pages: number
}

/* ---------- 만들 파일 정하기 ---------- */

export interface PlanInput {
  id: string
  name: string
  kind: ConvKind
}

export interface PlanOutput {
  /** 저장할 파일 이름 (.pdf 포함) */
  name: string
  /** 담을 파일 (이 차례로) */
  ids: string[]
  /** 학생별로 합칠 때 학번을 찾지 못해 따로 둔 파일 */
  alone?: boolean
}

/** 같은 이름이 있으면 (2), (3) … (윈도우는 대소문자를 가리지 않는다) */
export function uniqueName(taken: Set<string>, stem: string, ext = '.pdf'): string {
  let name = `${stem}${ext}`
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${stem} (${n})${ext}`
  taken.add(name.toLowerCase())
  return name
}

/**
 * 파일 이름의 학번 · 이름 — 합치기에 쓴다. 남의 글이 섞이면 안 되므로 학번만 있는 이름은 5자리일 때만 학생으로 본다.
 * '2026학년도 …' 같은 해는 학번이 아니다.
 */
export function studentOf(name: string): { sid: string; name: string } | null {
  const s = parseStudent(name)
  if (!s || /^20\d\d$/.test(s.sid)) return null
  if (!s.name && s.sid.length !== 5) return null
  return s
}

export function planOutputs(files: PlanInput[], merge: ConvMerge, allName = '합친 문서'): PlanOutput[] {
  const taken = new Set<string>()
  if (merge === 'all') return files.length ? [{ name: uniqueName(taken, allName), ids: files.map((f) => f.id) }] : []

  // 이름이 같은데 형식만 다른 파일(보고서.hwp · 보고서.jpg)은 어느 것에서 왔는지 이름에 남긴다
  const stems = new Map<string, number>()
  for (const f of files) {
    const k = stemOf(f.name).toLowerCase()
    stems.set(k, (stems.get(k) ?? 0) + 1)
  }
  const single = (f: PlanInput): PlanOutput => {
    const stem = stemOf(f.name)
    const clash = (stems.get(stem.toLowerCase()) ?? 0) > 1 && f.kind !== 'pdf'
    return { name: uniqueName(taken, clash ? `${stem} (${extOf(f.name)})` : stem), ids: [f.id] }
  }
  if (merge === 'none') return files.map(single)

  const students = files.map((f) => studentOf(f.name))
  // 학번만 있는 파일은, 그 학번의 이름이 하나뿐일 때 그 학생에게 붙인다
  const names = new Map<string, Set<string>>()
  for (const s of students) if (s?.name) names.set(s.sid, (names.get(s.sid) ?? new Set()).add(s.name))
  const groups = new Map<string, { sid: string; name: string; files: PlanInput[] }>()
  const alone: PlanInput[] = []
  files.forEach((f, i) => {
    const s = students[i]
    if (!s) return void alone.push(f)
    const known = names.get(s.sid)
    const name = s.name || (known?.size === 1 ? [...known][0] : '')
    const key = `${s.sid}|${name}`
    const g = groups.get(key) ?? { sid: s.sid, name, files: [] }
    g.files.push(f)
    groups.set(key, g)
  })
  const out = [...groups.values()]
    .sort((a, b) => byName(`${a.sid}${a.name}`, `${b.sid}${b.name}`))
    .map((g) => ({
      name: uniqueName(taken, g.name ? `${g.sid}(${g.name})` : g.sid),
      // 문서 먼저, 사진 뒤 — 각각 파일 이름 차례
      ids: [...g.files].sort((a, b) => Number(a.kind === 'image') - Number(b.kind === 'image') || byName(a.name, b.name)).map((f) => f.id)
    }))
  return [...out, ...alone.map((f) => ({ ...single(f), alone: true }))]
}

/* ---------- 쪽 나누기 ---------- */

/**
 * '1-3, 5, 8-' → [[1,2,3], [5], [8,…]] — 쉼표마다 파일 하나. 비워 두면 한 쪽씩.
 */
export function parseRanges(text: string, total: number): { ok: true; groups: number[][] } | { ok: false; error: string } {
  const seq = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i)
  if (!text.trim()) return total > 0 ? { ok: true, groups: seq(1, total).map((n) => [n]) } : { ok: false, error: '나눌 쪽이 없습니다.' }
  const groups: number[][] = []
  for (const raw of text.split(',')) {
    const part = raw.replace(/\s|쪽/g, '').replace(/[~–—]/g, '-')
    if (!part) continue
    const m = part.match(/^(\d+)(-(\d*))?$/)
    if (!m) return { ok: false, error: `'${raw.trim()}' 은(는) 읽을 수 없습니다. 예) 1-3, 5, 8-` }
    const from = Number(m[1])
    const to = m[2] === undefined ? from : m[3] ? Number(m[3]) : total
    if (from < 1 || to > total || from > to) return { ok: false, error: `'${raw.trim()}' 은(는) 1~${total}쪽을 벗어납니다.` }
    groups.push(seq(from, to))
  }
  return groups.length ? { ok: true, groups } : { ok: false, error: '나눌 쪽을 적어 주세요. 예) 1-3, 5, 8-' }
}

/* ---------- 사진 ---------- */

/** 휴대폰 사진(JPEG)에 적힌 돌림 표시(EXIF Orientation) 1~8. 없거나 읽지 못하면 1 */
export function exifOrientation(b: Uint8Array): number {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return 1
  let p = 2
  while (p + 4 <= b.length && b[p] === 0xff) {
    const marker = b[p + 1]
    const len = (b[p + 2] << 8) | b[p + 3]
    if (marker === 0xda || len < 2) break
    if (marker === 0xe1 && p + 18 <= b.length && String.fromCharCode(...b.subarray(p + 4, p + 8)) === 'Exif') {
      const t = p + 10
      const le = b[t] === 0x49
      const u16 = (o: number): number => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1])
      const u32 = (o: number): number => (le ? u16(o) + u16(o + 2) * 65536 : u16(o) * 65536 + u16(o + 2))
      const ifd = t + u32(t + 4)
      if (ifd + 2 > b.length) return 1
      const n = u16(ifd)
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12
        if (e + 12 > b.length) break
        if (u16(e) === 0x0112) {
          const v = u16(e + 8)
          return v >= 1 && v <= 8 ? v : 1
        }
      }
      return 1
    }
    p += 2 + len
  }
  return 1
}

/**
 * 사진 한 장을 A4 한 쪽 가운데에. 가로 사진은 가로 쪽. matrix 는 PDF 의 그림 놓기 행렬 [a b c d e f]
 * (그림의 1×1 네모를 쪽 위의 자리로 옮긴다 — 돌림 표시까지 반영).
 */
export function imagePlacement(orientation: number, width: number, height: number): { page: [number, number]; matrix: [number, number, number, number, number, number] } {
  const turned = orientation >= 5
  const vw = turned ? height : width
  const vh = turned ? width : height
  const page: [number, number] = vw > vh ? [841.89, 595.28] : [595.28, 841.89]
  const scale = Math.min((page[0] - 36) / vw, (page[1] - 36) / vh)
  const w = vw * scale
  const h = vh * scale
  const x = (page[0] - w) / 2
  const y = (page[1] - h) / 2
  const m: Record<number, [number, number, number, number, number, number]> = {
    1: [w, 0, 0, h, x, y],
    2: [-w, 0, 0, h, x + w, y],
    3: [-w, 0, 0, -h, x + w, y + h],
    4: [w, 0, 0, -h, x, y + h],
    5: [0, -h, -w, 0, x + w, y + h],
    6: [0, -h, w, 0, x, y + h],
    7: [0, h, w, 0, x, y],
    8: [0, h, -w, 0, x + w, y]
  }
  return { page, matrix: m[orientation] ?? m[1] }
}
