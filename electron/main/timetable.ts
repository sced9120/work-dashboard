/**
 * 학교 시간표 엑셀을 읽어 DB 설정에 담아 둔다. 읽는 규칙은 shared/timetable.ts.
 * 선생님 이름이 들어 있어 인수인계 파일에는 넣지 않는다(db.exportTo 가 지운다).
 */

import ExcelJS from 'exceljs'
import fs from 'node:fs'
import path from 'node:path'
import type { ParseOptions, SchoolTimetable, SheetText } from '../../shared/timetable'
import { TT_SCHOOL_KEY, parseTimetable } from '../../shared/timetable'
import * as db from './db'

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
): Promise<{ ok: boolean; tt?: SchoolTimetable; error?: string }> {
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
  const p = (n: number): string => String(n).padStart(2, '0')
  const d = new Date()
  const now = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  const { tt, error } = parseTimetable(sheets, files.map((f) => path.basename(f)).join(', '), now, opts)
  if (!tt) return { ok: false, error }
  tt.stamp = d.toISOString()
  tt.sources = files
  db.setSetting(TT_SCHOOL_KEY, JSON.stringify(tt))
  return { ok: true, tt }
}

/** 같은 파일을 다른 시트 기준으로 다시 읽는다 (시트마다 수업이 다른 판일 때) */
export async function rereadWithSheet(name: string): Promise<{ ok: boolean; tt?: SchoolTimetable; error?: string }> {
  const cur = loadTimetable()
  if (!cur?.sources?.length) return { ok: false, error: '처음 불러온 파일을 알 수 없습니다. 시간표 파일을 다시 불러와 주세요.' }
  return importTimetable(cur.sources, { sheet: name })
}

export function loadTimetable(): SchoolTimetable | null {
  try {
    const v = JSON.parse(db.getSetting(TT_SCHOOL_KEY, '') || 'null') as SchoolTimetable | null
    return v && Array.isArray(v.classes) ? v : null
  } catch {
    return null
  }
}
