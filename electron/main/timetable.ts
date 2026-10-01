/**
 * 학교 시간표 엑셀을 읽어 DB 설정에 담아 둔다. 읽는 규칙은 shared/timetable.ts.
 * 선생님 이름이 들어 있어 인수인계 파일에는 넣지 않는다(db.exportTo 가 지운다).
 */

import ExcelJS from 'exceljs'
import fs from 'node:fs'
import path from 'node:path'
import type { SchoolTimetable, SheetText } from '../../shared/timetable'
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

async function sheetsOf(file: string): Promise<SheetText[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(fs.readFileSync(file) as unknown as ArrayBuffer)
  return wb.worksheets
    .filter((ws) => ws.state !== 'hidden' && ws.state !== 'veryHidden')
    .map((ws) => {
      const rows: string[][] = []
      const cols = Math.min(ws.columnCount, 200)
      for (let r = 1; r <= Math.min(ws.rowCount, 3000); r++) {
        const row = ws.getRow(r)
        const cells: string[] = []
        // 합친 칸은 첫 칸의 값을 돌려준다 — 주간 시간표의 요일 머리(월월월…)가 이렇게 읽힌다
        for (let c = 1; c <= cols; c++) cells.push(cellText(row.getCell(c).value))
        rows.push(cells)
      }
      return { name: ws.name, rows }
    })
}

/** 고른 시간표 파일(여러 개 가능)을 읽어 저장한다 */
export async function importTimetable(files: string[]): Promise<{ ok: boolean; tt?: SchoolTimetable; error?: string }> {
  const sheets: SheetText[] = []
  for (const f of files) {
    if (!/\.xlsx$/i.test(f)) return { ok: false, error: `${path.basename(f)}: 엑셀(.xlsx) 파일만 읽습니다. 옛 엑셀(.xls)은 엑셀에서 .xlsx 로 저장해 주세요.` }
    try {
      sheets.push(...(await sheetsOf(f)))
    } catch (e) {
      return { ok: false, error: `${path.basename(f)}: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  const p = (n: number): string => String(n).padStart(2, '0')
  const d = new Date()
  const now = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  const { tt, error } = parseTimetable(sheets, files.map((f) => path.basename(f)).join(', '), now)
  if (!tt) return { ok: false, error }
  db.setSetting(TT_SCHOOL_KEY, JSON.stringify(tt))
  return { ok: true, tt }
}

export function loadTimetable(): SchoolTimetable | null {
  try {
    const v = JSON.parse(db.getSetting(TT_SCHOOL_KEY, '') || 'null') as SchoolTimetable | null
    return v && Array.isArray(v.classes) ? v : null
  } catch {
    return null
  }
}
