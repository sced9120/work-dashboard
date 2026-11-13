/**
 * 세특 작성실 — 나이스 입력 양식 채우기.
 * 나이스에서 내려받은 엑셀 양식(학생 줄이 채워져 있고 특기사항 칸만 빈 파일)에 최종본을 학생별로 넣는다.
 *   · 파일은 다시 만들지 않는다. 시트 XML 에서 특기사항 칸만 바꿔 끼우고 나머지(학생개인번호 · 과목코드 · 서식)는 손대지 않는다.
 *   · 반 · 번호 · 성명이 모두 맞는 학생에게만 넣는다. 하나라도 어긋나면 넣지 않고 까닭을 보여 준다.
 * 규칙은 세특 시트(Prompt-Master)의 13_NeisForm 과 같다. electron 도 DOM 도 쓰지 않는다(zip 풀기 · 묶기는 메인에서).
 *
 * 확인한 양식
 *   과목 세특: 학년도 | 학기 | 학년 | 학생개인번호 | 과목 | 과목코드 | 반/번호 | 성명 | 학적변동 구분 | 세부능력 및 특기사항 | …
 *   동아리:   영역 구분 | 학년도 | 학년 | 학과 | 반 | 번호 | 동아리활동 부서명 | 학생개인번호 | 성명 | 특기사항
 */
import { byteLen } from './seteuk'

/** 특기사항이 들어갈 열의 머리글 — 앞의 것이 먼저 (공백 · 줄바꿈은 지우고 견준다) */
const CONTENT_HEADS = ['세부능력및특기사항', '행동특성및종합의견', '특기사항', '종합의견']

/** 영역 구분 · 머리글 → 기록 영역 */
const AREA_KEYS: { re: RegExp; key: string }[] = [
  { re: /동아리/, key: '동아리' },
  { re: /자율/, key: '자율' },
  { re: /진로/, key: '진로' },
  { re: /행동특성|종합의견/, key: '행발' },
  { re: /개인별/, key: '개세특' },
  { re: /세부능력/, key: '과세특' }
]

export interface NeisFormRow {
  /** 엑셀 행 번호(1부터) */
  r: number
  year: number | null
  cls: number | null
  no: number | null
  name: string
  status: string
  content: string
}
export interface NeisForm {
  sheetName: string
  sheetPath: string
  /** 기록 영역 key (모르면 빈칸) */
  kind: string
  subject: string
  year: string
  term: string
  contentCol: number
  contentHead: string
  head: string[]
  rows: NeisFormRow[]
}
export interface NeisSource {
  cls: string
  no: string
  name: string
  text: string
  /** 검사에서 '고침'이 남아 있다 */
  flagged?: boolean
}
export interface NeisPlanRow {
  r: number
  label: string
  ok: boolean
  why: string
  text: string
  bytes: number
}
export interface NeisOptions {
  limit?: number
  /** 양식에 이미 든 글도 바꾼다 */
  overwrite?: boolean
  /** 검사에서 '고침'이 남은 글도 넣는다 */
  includeFlagged?: boolean
}

/** 양식을 고른 뒤 화면에 돌려주는 미리 보기 */
export interface NeisPreviewReply {
  ok: boolean
  error?: string
  /** 고른 양식의 번호 — 저장할 때 다시 넘긴다 (경로는 화면에 넘기지 않는다) */
  id?: string
  file?: string
  form?: { kind: string; subject: string; year: string; term: string; contentHead: string; students: number }
  plan?: { label: string; ok: boolean; why: string; bytes: number }[]
  fill?: number
  /** 올리기가 막힐 때 — 양식 순서대로 최종본 한 열 */
  column?: string[]
}

const noSpace = (s: unknown): string => String(s ?? '').replace(/\s+/g, '')
const num = (s: unknown): number | null => {
  const n = parseInt(String(s ?? '').replace(/[^\d]/g, ''), 10)
  return Number.isNaN(n) ? null : n
}

function xmlUnescape(s: string): string {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

/** <t> 조각을 모두 이어 붙인 글 */
function xmlTexts(xml: string): string {
  let out = ''
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) out += m[1] ? xmlUnescape(m[1]) : ''
  return out
}

/** 'AB12' → 열 번호(0부터) */
export function colIndexOf(ref: string): number {
  const letters = String(ref || '').replace(/[^A-Z]/gi, '').toUpperCase()
  let n = 0
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64)
  return n - 1
}

/** 열 번호(0부터) → 'A', 'J', 'AB' */
export function colLetterOf(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  const re = /<si>([\s\S]*?)<\/si>|<si\/>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(String(xml || '')))) out.push(m[1] ? xmlTexts(m[1]) : '')
  return out
}

/** 시트 XML → 행 배열(1행이 [0]). 빈 칸은 '' */
function parseSheetXml(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  let width = 0
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g
  let rm: RegExpExecArray | null
  while ((rm = rowRe.exec(String(xml || '')))) {
    const rAttr = (rm[1].match(/\br="(\d+)"/) || [])[1]
    const ri = rAttr ? Number(rAttr) - 1 : rows.length
    const row: string[] = []
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cm: RegExpExecArray | null
    let ci = 0
    while ((cm = cellRe.exec(rm[2] || ''))) {
      const attr = cm[1]
      const body = cm[2] || ''
      const ref = (attr.match(/\br="([A-Z]+)\d*"/i) || [])[1]
      if (ref) ci = colIndexOf(ref)
      const t = (attr.match(/\bt="(\w+)"/) || [])[1] || 'n'
      const vm = body.match(/<v>([\s\S]*?)<\/v>/)
      const raw = vm ? xmlUnescape(vm[1]) : ''
      const val = t === 's' ? (shared[Number(raw)] ?? '') : t === 'inlineStr' ? xmlTexts(body) : raw
      while (row.length < ci) row.push('')
      row[ci] = val
      ci++
    }
    while (rows.length < ri) rows.push([])
    rows[ri] = row
    if (row.length > width) width = row.length
  }
  return rows.map((r) => {
    while (r.length < width) r.push('')
    return r
  })
}

/** workbook 의 첫 시트가 어느 XML 파일인지 */
function sheetPathOf(parts: Record<string, string>): { name: string; path: string } {
  const wb = parts['xl/workbook.xml'] || ''
  const sm = wb.match(/<sheet\b([^>]*)\/?>/)
  if (!sm) throw new Error('엑셀 파일 모양이 아닙니다(시트가 없음).')
  const name = xmlUnescape((sm[1].match(/\bname="([^"]*)"/) || [])[1] || '')
  const rid = (sm[1].match(/\br:id="([^"]+)"/) || [])[1]
  let path = 'xl/worksheets/sheet1.xml'
  const relRe = /<Relationship\b([^>]*)\/?>/g
  let rm: RegExpExecArray | null
  while ((rm = relRe.exec(parts['xl/_rels/workbook.xml.rels'] || ''))) {
    if ((rm[1].match(/\bId="([^"]+)"/) || [])[1] !== rid) continue
    const t = (rm[1].match(/\bTarget="([^"]+)"/) || [])[1] || ''
    path = t.charAt(0) === '/' ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '')
  }
  return { name, path }
}

/** 나이스 양식 읽기 — parts 는 xlsx 안의 XML 파일들 {경로: 글} */
export function readNeisForm(parts0: Record<string, string>): NeisForm {
  const p: Record<string, string> = {}
  for (const k of Object.keys(parts0 || {})) p[k.replace(/^\/+/, '')] = parts0[k]
  const sp = sheetPathOf(p)
  const grid = parseSheetXml(p[sp.path] || '', parseSharedStrings(p['xl/sharedStrings.xml'] || ''))
  if (!grid.length) throw new Error('양식에 줄이 없습니다.')
  const head = (grid[0] || []).map((h) => String(h ?? ''))
  const H = head.map(noSpace)
  const at = (name: string): number => H.indexOf(name)
  let contentCol = -1
  for (let i = 0; i < CONTENT_HEADS.length && contentCol < 0; i++) contentCol = at(CONTENT_HEADS[i])
  const cYear = at('학년')
  const cCls = at('반')
  const cNo = at('번호')
  const cClsNo = at('반/번호')
  let cName = at('성명')
  if (cName < 0) cName = at('이름')
  if (contentCol < 0) throw new Error(`특기사항 칸을 찾지 못했습니다. 나이스에서 내려받은 양식 그대로인지 확인해 주세요. (머리글: ${head.join(' | ')})`)
  if (cName < 0 || (cClsNo < 0 && (cCls < 0 || cNo < 0))) throw new Error(`반 · 번호 · 성명 칸을 찾지 못했습니다. (머리글: ${head.join(' | ')})`)

  const cArea = at('영역구분')
  const cSub = at('과목')
  const cStatus = at('학적변동구분')
  const cY = at('학년도')
  const cTerm = at('학기')
  const rows: NeisFormRow[] = []
  for (let r = 1; r < grid.length; r++) {
    const g = grid[r] || []
    const v = (c: number): string => (c < 0 ? '' : String(g[c] ?? '').trim())
    const cls = cCls >= 0 ? v(cCls) : v(cClsNo).split('/')[0]
    const no = cNo >= 0 ? v(cNo) : v(cClsNo).split('/')[1] || ''
    if (!v(cName) && !cls && !no) continue
    rows.push({ r: r + 1, year: num(v(cYear)), cls: num(cls), no: num(no), name: v(cName), status: v(cStatus), content: v(contentCol) })
  }
  const first = grid[1] || []
  const area = cArea >= 0 ? String(first[cArea] || '') : ''
  const probe = `${area} ${H[contentCol]} ${cSub >= 0 ? '세부능력' : ''}`
  const kind = AREA_KEYS.find((k) => k.re.test(probe))?.key ?? ''
  return {
    sheetName: sp.name,
    sheetPath: sp.path,
    kind,
    subject: cSub >= 0 ? String(first[cSub] || '').trim() : '',
    year: cY >= 0 ? String(first[cY] || '').trim() : '',
    term: cTerm >= 0 ? String(first[cTerm] || '').trim() : '',
    contentCol,
    contentHead: head[contentCol].replace(/\s+/g, ' '),
    head,
    rows
  }
}

/** 양식의 학생 줄 ↔ 최종본 맞추기 — 누가 들어가고 누가 왜 빠지는지 */
export function matchNeisRows(formRows: NeisFormRow[], src: NeisSource[], opt: NeisOptions = {}): NeisPlanRow[] {
  const list = src.map((s) => ({ cls: num(s.cls), no: num(s.no), name: noSpace(s.name), text: String(s.text || '').replace(/\r\n?/g, '\n').trim(), flagged: !!s.flagged }))
  return formRows.map((f) => {
    const label = `${f.year ? `${f.year}학년 ` : ''}${f.cls === null ? '?' : f.cls}반 ${f.no === null ? '?' : f.no}번 ${f.name}`
    const out: NeisPlanRow = { r: f.r, label, ok: false, why: '', text: '', bytes: 0 }
    if (f.status && f.status !== '재학') return { ...out, why: `학적변동: ${f.status}` }
    if (f.content && !opt.overwrite) return { ...out, why: '나이스 양식에 이미 내용이 있음' }
    const same = list.filter((s) => s.cls === f.cls && s.no === f.no)
    if (!same.length) return { ...out, why: '명단에 없는 학생' }
    const hit = same.filter((s) => !s.name || s.name === noSpace(f.name))
    if (!hit.length) return { ...out, why: '반 · 번호는 같은데 이름이 다름' }
    if (hit.length > 1) return { ...out, why: '같은 반 · 번호 · 이름이 명단에 둘 이상' }
    const s = hit[0]
    out.text = s.text
    out.bytes = s.text ? byteLen(s.text) : 0
    if (!s.text) return { ...out, why: '최종본이 비어 있음' }
    if (opt.limit && out.bytes > opt.limit) return { ...out, why: `바이트 초과 ${out.bytes} / ${opt.limit}` }
    if (s.flagged && !opt.includeFlagged) return { ...out, why: '검사에서 고칠 곳이 남아 있음' }
    return { ...out, ok: true }
  })
}

/** 올리기가 막힐 때의 대안 — 양식 2행부터 학생 순서대로 최종본 한 열(빠진 학생은 빈 줄) */
export function neisColumn(plan: NeisPlanRow[]): string[] {
  const by = new Map<number, string>()
  let last = 1
  for (const x of plan) {
    by.set(x.r, x.ok ? x.text.replace(/[\t\r\n]+/g, ' ').trim() : '')
    last = Math.max(last, x.r)
  }
  const out: string[] = []
  for (let r = 2; r <= last; r++) out.push(by.get(r) ?? '')
  return out
}

function xmlText(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

/** 시트 XML 의 한 열에 글 넣기 — 그 칸만 inlineStr 로 바꾸고 서식(s)은 그대로 둔다. fills = {행 번호: 글} */
export function fillNeisSheetXml(xml: string, col: number, fills: Record<number, string>): string {
  const L = colLetterOf(col)
  return String(xml).replace(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, (whole: string, attr: string, body0: string | undefined) => {
    const rn = Number((attr.match(/\br="(\d+)"/) || [])[1])
    if (!Object.prototype.hasOwnProperty.call(fills, rn)) return whole
    const ref = L + rn
    const cell = (a: string): string => {
      const rest = String(a || '').replace(/\s*\bt="[^"]*"/, '').replace(/\s*\br="[^"]*"/, '')
      return `<c r="${ref}"${rest} t="inlineStr"><is><t xml:space="preserve">${xmlText(fills[rn])}</t></is></c>`
    }
    let body = body0 || ''
    const re = new RegExp(`<c\\b(?=[^>]*\\br="${ref}")([^>]*?)(?:/>|>[\\s\\S]*?</c>)`)
    if (re.test(body)) body = body.replace(re, (_m: string, a: string) => cell(a))
    else {
      // 칸이 없으면 열 순서에 맞는 자리에 끼운다
      let at = -1
      const cre = /<c\b[^>]*\br="([A-Z]+)\d+"/g
      let cm: RegExpExecArray | null
      while ((cm = cre.exec(body))) {
        if (colIndexOf(cm[1]) > col) {
          at = cm.index
          break
        }
      }
      body = at < 0 ? body + cell('') : body.slice(0, at) + cell('') + body.slice(at)
    }
    return `<row${attr}>${body}</row>`
  })
}
