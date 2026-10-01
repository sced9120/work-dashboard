/**
 * 학교 시간표 엑셀을 읽어 DB 설정에 담아 둔다. 읽는 규칙은 shared/timetable.ts.
 * 선생님 이름이 들어 있어 인수인계 파일에는 넣지 않는다(db.exportTo 가 지운다).
 */

import ExcelJS from 'exceljs'
import fs from 'node:fs'
import path from 'node:path'
import type { ParseOptions, SchoolTimetable, SheetText, TtRow } from '../../shared/timetable'
import { DAY_NAMES, STD_COLUMNS, TT_SCHOOL_KEY, parseTimetable } from '../../shared/timetable'
import { chunkRows, convertPrompt, maskSheet, parseLines, parseStructure, structurePrompt, toStandardSheet } from '../../shared/ttai'
import * as db from './db'

/** 모양을 못 알아본 파일 — [AI로 읽기] 를 누르면 이것을 읽는다 (이 실행 동안만) */
let failedFiles: string[] = []

const today = (d = new Date()): string => {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((x) => x.text).join('')
    if ('text' in v) return String(v.text ?? '')
    if ('result' in v) return v.result == null ? '' : String(v.result)
    return ''
  }
  return String(v)
}

/* ---------- 칸 색 ---------- */

/** 엑셀 기본 색 번호표 (indexed 0~63) */
const INDEXED = (
  '000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF ' +
  '800000 008000 000080 808000 800080 008080 C0C0C0 808080 9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF ' +
  '000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF 00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 ' +
  '3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 003366 339966 003300 333300 993300 993366 333399 333333'
).split(' ')

/** 오피스 기본 테마 (파일에 테마가 없을 때). 순서는 엑셀 theme 번호: lt1 dk1 lt2 dk2 accent1~6 hlink folHlink */
const OFFICE_THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72']

/** 파일의 테마 색 — theme 번호 순서(lt1 dk1 lt2 dk2 …)로 */
function themeColors(wb: ExcelJS.Workbook): string[] {
  const xml = (wb as unknown as { _themes?: Record<string, string> })._themes?.theme1 ?? ''
  const scheme = xml.match(/<a:clrScheme[\s\S]*?<\/a:clrScheme>/)?.[0]
  if (!scheme) return OFFICE_THEME
  const pick = (tag: string, i: number): string => {
    const m = scheme.match(new RegExp(`<a:${tag}>[\\s\\S]*?(?:srgbClr val="([0-9A-Fa-f]{6})"|lastClr="([0-9A-Fa-f]{6})")[\\s\\S]*?</a:${tag}>`))
    return (m?.[1] ?? m?.[2] ?? OFFICE_THEME[i]).toUpperCase()
  }
  return ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'].map(pick)
}

/** 엑셀의 tint(-1~1)를 밝기에 얹는다 */
function withTint(hex: string, tint: number): string {
  if (!tint) return hex
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  let l = (max + min) / 2
  if (max !== min) {
    const dd = max - min
    s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min)
    h = max === r ? (g - b) / dd + (g < b ? 6 : 0) : max === g ? (b - r) / dd + 2 : (r - g) / dd + 4
    h /= 6
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint
  const hue = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  let rgb: number[]
  if (s === 0) rgb = [l, l, l]
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    rgb = [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)]
  }
  return rgb.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** 칸 바탕색 #RRGGBB. 칠하지 않았거나 흰색이면 빈 문자열 */
function fillOf(cell: ExcelJS.Cell, theme: string[]): string {
  const f = cell.fill
  if (!f || f.type !== 'pattern' || f.pattern === 'none') return ''
  const c = (f.fgColor ?? {}) as { argb?: string; theme?: number; tint?: number; indexed?: number }
  let hex = ''
  if (c.argb && /^[0-9A-Fa-f]{8}$/.test(c.argb)) hex = c.argb.slice(2).toUpperCase()
  else if (typeof c.theme === 'number') hex = theme[c.theme] ?? ''
  else if (typeof c.indexed === 'number') hex = INDEXED[c.indexed] ?? ''
  if (!hex) return ''
  hex = withTint(hex, Number(c.tint) || 0)
  return hex === 'FFFFFF' ? '' : `#${hex}`
}

async function sheetsOf(file: string, prefix: string): Promise<SheetText[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(fs.readFileSync(file) as unknown as ArrayBuffer)
  const theme = themeColors(wb)
  return wb.worksheets
    .filter((ws) => ws.state !== 'hidden' && ws.state !== 'veryHidden')
    .map((ws) => {
      const rows: string[][] = []
      const fills: string[][] = []
      const cols = Math.min(ws.columnCount, 200)
      for (let r = 1; r <= Math.min(ws.rowCount, 3000); r++) {
        const row = ws.getRow(r)
        const cells: string[] = []
        const colors: string[] = []
        // 합친 칸은 첫 칸의 값을 돌려준다 — 주간 시간표의 요일 머리(월월월…)가 이렇게 읽힌다
        for (let c = 1; c <= cols; c++) {
          const cell = row.getCell(c)
          cells.push(cellText(cell.value))
          colors.push(fillOf(cell, theme))
        }
        rows.push(cells)
        fills.push(colors)
      }
      return { name: `${prefix}${ws.name}`, rows, fills }
    })
}

/** 고른 시간표 파일(여러 개 가능)을 읽어 저장한다. opts.sheet: 시트끼리 수업이 다를 때 읽을 시트 */
export async function importTimetable(
  files: string[],
  opts: ParseOptions = {}
): Promise<{ ok: boolean; tt?: SchoolTimetable; error?: string; canAi?: boolean }> {
  const sheets: SheetText[] = []
  for (const f of files) {
    if (!/\.xlsx$/i.test(f)) return { ok: false, error: `${path.basename(f)}: 엑셀(.xlsx) 파일만 읽습니다. 옛 엑셀(.xls)은 엑셀에서 .xlsx 로 저장해 주세요.` }
    if (!fs.existsSync(f)) return { ok: false, error: `${path.basename(f)} 파일을 찾지 못했습니다. 옮기거나 지웠으면 시간표 파일을 다시 불러와 주세요.` }
    try {
      // 파일을 여러 개 골랐으면 시트 이름 앞에 파일 이름을 붙여 가린다
      sheets.push(...(await sheetsOf(f, files.length > 1 ? `${path.basename(f, path.extname(f))} · ` : '')))
    } catch (e) {
      return { ok: false, error: `${path.basename(f)}: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  const d = new Date()
  const { tt, error } = parseTimetable(sheets, files.map((f) => path.basename(f)).join(', '), today(d), opts)
  if (!tt) {
    failedFiles = files
    return { ok: false, error, canAi: true }
  }
  failedFiles = []
  tt.stamp = d.toISOString()
  tt.sources = files
  db.setSetting(TT_SCHOOL_KEY, JSON.stringify(tt))
  return { ok: true, tt }
}

/**
 * AI 로 시간표 읽기 — 이 PC 에서 한글 낱말을 W1, W2 … 로 가린 표만 보내 표준 자료로 받는다(shared/ttai.ts).
 * which: 'failed' 는 방금 모양을 못 알아본 파일, 'current' 는 지금 불러와 둔 파일(다른 모양으로 잘못 읽었을 때).
 */
export async function aiReadTimetable(
  which: 'failed' | 'current',
  ask: (prompt: string, json: boolean) => Promise<string>,
  progress: (msg: string) => void
): Promise<{ ok: boolean; tt?: SchoolTimetable; error?: string }> {
  const cur = loadTimetable()
  const files = which === 'failed' ? failedFiles : cur?.sources ?? []
  if (!files.length) return { ok: false, error: '읽을 파일을 알 수 없습니다. 시간표 파일을 다시 불러와 주세요.' }
  const sheets: SheetText[] = []
  try {
    for (const f of files) sheets.push(...(await sheetsOf(f, files.length > 1 ? `${path.basename(f, path.extname(f))} · ` : '')))
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  // 지금 읽어 둔 시트가 있으면 그것, 아니면 칸이 가장 많이 찬 시트 하나
  const filled = (s: SheetText): number => s.rows.reduce((n, r) => n + r.filter((v) => v.trim()).length, 0)
  const want = which === 'current' ? cur?.versions?.used[0] : undefined
  const sheet = sheets.find((s) => s.name === want) ?? [...sheets].sort((a, b) => filled(b) - filled(a))[0]
  if (!sheet || !filled(sheet)) return { ok: false, error: '빈 시트입니다.' }

  const masked = maskSheet(sheet)
  try {
    progress('표의 짜임을 묻는 중…')
    const st = parseStructure(await ask(structurePrompt(masked), true), masked.rows.length)
    if (!st) return { ok: false, error: 'AI 가 표의 짜임을 알아내지 못했습니다. 표준 양식으로 적어 불러와 주세요.' }
    const chunks = chunkRows(masked, st)
    if (!chunks.length) return { ok: false, error: 'AI 가 수업이 적힌 줄을 찾지 못했습니다.' }
    if (chunks.length > 40) return { ok: false, error: '표가 너무 커서 AI 로 읽지 않았습니다. 시트를 나눠 불러와 주세요.' }
    const lines = []
    for (let i = 0; i < chunks.length; i++) {
      progress(`수업을 읽는 중… ${i + 1}/${chunks.length}`)
      lines.push(...parseLines(await ask(convertPrompt(masked, st, chunks[i]), false)))
    }
    const std = toStandardSheet(lines, sheet, masked, new Set(chunks.flat()))
    if (!std.used) return { ok: false, error: 'AI 답에서 수업을 하나도 읽지 못했습니다. 다른 모델로 해 보거나 표준 양식으로 적어 주세요.' }
    const d = new Date()
    const { tt, error } = parseTimetable([std.sheet], files.map((f) => path.basename(f)).join(', '), today(d))
    if (!tt) return { ok: false, error }
    // 자료줄 안에서 글이 있는 칸 가운데 몇 칸을 읽었는지
    let dataCells = 0
    for (const r of chunks.flat()) dataCells += (sheet.rows[r - 1] ?? []).filter((v) => v.trim()).length
    tt.layouts = ['AI로 읽음']
    tt.warnings.unshift(
      `AI 로 읽었습니다(${st.shape || sheet.name}). 자료줄의 글이 있는 칸 ${dataCells}개 가운데 ${std.cells.size}개에서 수업 ${std.used}줄을 읽었습니다` +
        `${std.dropped ? `(빈 칸을 가리킨 ${std.dropped}줄은 버림)` : ''}. 이름 칸은 수업이 아니라 세지 않습니다. 틀린 곳이 있을 수 있으니 선생님 몇 분을 골라 확인해 주세요.`
    )
    tt.stamp = d.toISOString()
    tt.sources = files
    db.setSetting(TT_SCHOOL_KEY, JSON.stringify(tt))
    failedFiles = []
    return { ok: true, tt }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 같은 파일을 다른 시트 기준으로 다시 읽는다 (시트마다 수업이 다른 판일 때) */
export async function rereadWithSheet(name: string): Promise<{ ok: boolean; tt?: SchoolTimetable; error?: string }> {
  const cur = loadTimetable()
  if (!cur?.sources?.length) return { ok: false, error: '처음 불러온 파일을 알 수 없습니다. 시간표 파일을 다시 불러와 주세요.' }
  return importTimetable(cur.sources, { sheet: name })
}

/** 빈 표준 양식의 보기 줄 (지우고 학교 시간표를 적는다) */
export const STD_EXAMPLE: TtRow[] = [
  { teacher: '홍길동', day: 0, period: 1, cls: '1-1', subject: '국어', block: '', kind: '수업' },
  { teacher: '홍길동', day: 0, period: 2, cls: '2-3', subject: '문학', block: '', kind: '수업' },
  { teacher: '홍길동', day: 1, period: 3, cls: '3-2', subject: '고전', block: 'A', kind: '블록' },
  { teacher: '홍길동', day: 2, period: 4, cls: '3-2', subject: '[공강]', block: '', kind: '공강' },
  { teacher: '', day: 2, period: 5, cls: '전체', subject: '동아리', block: '', kind: '동아리' },
  { teacher: '', day: 2, period: 6, cls: '전체', subject: '창체', block: '', kind: '창체' }
]

/**
 * 표준 자료를 엑셀로 — 첫 시트 "시간표 자료"(교사 · 요일 · 교시 · 반 · 과목 · 블록 · 구분), 둘째 시트 "적는 법".
 * 고친 뒤 [시간표 파일 다시 불러오기] 로 고르면 표준 목록으로 그대로 읽는다(shared/timetable readList).
 */
export async function standardWorkbook(rows: TtRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('시간표 자료')
  ws.addRow([...STD_COLUMNS])
  for (const r of rows) ws.addRow([r.teacher, DAY_NAMES[r.day] ?? '', r.period, r.cls, r.subject, r.block, r.kind])
  ws.getRow(1).font = { bold: true }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.columns.forEach((c, i) => (c.width = [12, 6, 6, 8, 14, 10, 8][i] ?? 10))
  const help = wb.addWorksheet('적는 법')
  for (const line of [
    ['열', '적는 것'],
    ['교사', '선생님 이름. 창체 · 동아리 줄은 비워도 됩니다'],
    ['요일', '월 화 수 목 금 (토)'],
    ['교시', '1, 2, 3 … (숫자)'],
    ['반', '2-4 처럼 학년-반. 이동수업은 그 교실 반. 창체 · 동아리 줄은 "2학년" 또는 "전체"'],
    ['과목', '과목 이름'],
    ['블록', '여러 반이 함께 움직이는 선택 수업이면 블록 이름(A, B …). 같은 블록은 같은 이름'],
    ['구분', '수업 · 블록 · 공강 · 창체 · 동아리 가운데 하나'],
    [],
    ['한 줄에 수업 하나입니다. 같은 시간에 여러 반을 가르치면 반마다 한 줄씩 적습니다.'],
    ['이 모양으로 적은 엑셀은 학교가 달라도 그대로 읽습니다.']
  ])
    help.addRow(line)
  help.getRow(1).font = { bold: true }
  help.getColumn(1).width = 10
  help.getColumn(2).width = 80
  return Buffer.from(await wb.xlsx.writeBuffer())
}

export function loadTimetable(): SchoolTimetable | null {
  try {
    const v = JSON.parse(db.getSetting(TT_SCHOOL_KEY, '') || 'null') as SchoolTimetable | null
    return v && Array.isArray(v.classes) ? v : null
  } catch {
    return null
  }
}
