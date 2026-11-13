/**
 * 세특 작성실 — 엑셀로 주고받기.
 * 내보낸 파일에는 학생 이름과 글이 그대로 들어 있다(이 PC 에 저장할 뿐 어디로도 보내지 않는다).
 * 가져올 때는 먼저 무엇이 바뀌는지 보여 주고, 눌러야 합친다. 지우는 것은 없다.
 */
import { dialog, type BrowserWindow } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { seteukLoad, seteukSaveActs, seteukSaveRoster, seteukSaveRows } from './seteuk'
import { seteukSaveSum, seteukSums } from './seteukSum'
import { SETEUK_MODES } from '../../shared/seteuk'
import { buildBook, mergeBook, readBook, XLSX_ACTS, XLSX_ROSTER } from '../../shared/seteukXlsx'
import type { Grid, SeteukData, XlsxPreview } from '../../shared/seteukXlsx'

function current(): SeteukData {
  const all = seteukLoad()
  return { rosters: all.rosters, acts: all.acts, rows: all.rows, sums: seteukSums() }
}

/* ---------- 내보내기 ---------- */

const WIDE = new Set(['관찰 메모', 'AI 결과', '최종본', '합본', 'AI 압축결과', '활동 개요'])

export async function gridsToXlsx(grids: Grid[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = '업무데스크 오르빗'
  const line = { style: 'thin' as const, color: { argb: 'FFE5E7EB' } }
  const border = { top: line, left: line, bottom: line, right: line }
  for (const g of grids) {
    const ws = wb.addWorksheet(g.name)
    // 명단 · 활동목록은 2행, 나머지는 3행이 머리글 (세특 시트와 같은 자리)
    const headAt = g.name.startsWith(XLSX_ROSTER) || g.name === XLSX_ACTS ? 2 : 3
    g.rows.forEach((values, i) => {
      const row = ws.addRow(values)
      const n = i + 1
      if (n === 1) row.font = { bold: true, name: '맑은 고딕', size: 12 }
      else if (n === headAt) {
        row.height = 26
        row.eachCell((c) => {
          c.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: '맑은 고딕', size: 10 }
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
          c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
          c.border = border
        })
      } else if (n > headAt) {
        row.eachCell({ includeEmpty: true }, (c) => {
          c.font = { name: '맑은 고딕', size: 10 }
          c.alignment = { vertical: 'top', wrapText: true }
          c.border = border
        })
      }
    })
    const head = g.rows[headAt - 1] ?? []
    ws.columns.forEach((c, j) => (c.width = WIDE.has(head[j] ?? '') ? 48 : j < 3 && headAt === 3 ? 8 : j >= 3 && headAt === 3 && !/바이트/.test(head[j] ?? '') ? 40 : 14))
    ws.views = [{ state: 'frozen', ySplit: headAt, xSplit: headAt === 3 ? 3 : 0 }]
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

export async function seteukXlsxExport(win: BrowserWindow | null): Promise<{ ok: boolean; message: string }> {
  if (!win) return { ok: false, message: '창을 찾을 수 없습니다.' }
  const data = current()
  if (SETEUK_MODES.every((m) => !data.rosters[m.key].length) && !data.acts.length) return { ok: false, message: '내보낼 명단 · 활동이 없습니다.' }
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  const res = await dialog.showSaveDialog(win, {
    title: '세특 작성실 — 엑셀로 내보내기',
    defaultPath: `세특작성실_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.xlsx`,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  })
  if (res.canceled || !res.filePath) return { ok: false, message: '취소했습니다.' }
  try {
    fs.writeFileSync(res.filePath, await gridsToXlsx(buildBook(data)))
    return { ok: true, message: `저장했습니다: ${res.filePath}` }
  } catch (e) {
    return { ok: false, message: `저장하지 못했습니다. 엑셀에서 같은 파일을 열어 두었다면 닫고 다시 해 주세요. (${e instanceof Error ? e.message : e})` }
  }
}

/* ---------- 가져오기 ---------- */

/** 고른 파일 — 경로는 화면에 넘기지 않고 번호로만 */
const picked = new Map<string, { path: string; name: string }>()

function textOf(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const o = v as { richText?: { text: string }[]; text?: unknown; result?: unknown; error?: unknown }
  if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join('')
  if (o.result !== undefined) return textOf(o.result as ExcelJS.CellValue)
  if (typeof o.text === 'string') return o.text
  if (o.text !== undefined) return textOf(o.text as ExcelJS.CellValue)
  return ''
}

export async function xlsxToGrids(file: string): Promise<Grid[]> {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(fs.readFileSync(file) as unknown as ArrayBuffer)
  } catch {
    throw new Error('엑셀(.xlsx) 파일을 읽지 못했습니다. 세특 시트는 [파일 → 다운로드 → Microsoft Excel] 로 내려받은 파일을 골라 주세요.')
  }
  return wb.worksheets.map((ws) => {
    const rows: string[][] = []
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const out: string[] = []
      row.eachCell({ includeEmpty: true }, (c, col) => {
        out[col - 1] = textOf(c.value).replace(/\r\n?/g, '\n')
      })
      rows[n - 1] = Array.from(out, (x) => x ?? '')
    })
    return { name: ws.name, rows: Array.from(rows, (r) => r ?? []) }
  })
}

async function preview(id: string, overwrite: boolean): Promise<XlsxPreview> {
  const f = picked.get(id)
  if (!f) return { ok: false, error: '파일을 다시 골라 주세요.' }
  try {
    const book = readBook(await xlsxToGrids(f.path))
    if (!book.acts.length && SETEUK_MODES.every((m) => !book.rosters[m.key].length)) {
      return { ok: false, error: "세특 자료를 찾지 못했습니다. '○○ ▸입력' 시트(반 · 번호 · 이름 · 최종본 칸)나 학생명단 시트가 있어야 합니다." }
    }
    const { report } = mergeBook(current(), book, { overwrite }, () => 'x')
    return { ok: true, id, file: f.name, report }
  } catch (e) {
    return { ok: false, error: (e as Error).message || '파일을 읽지 못했습니다.' }
  }
}

/** 파일을 고르고, 합치면 무엇이 바뀌는지 미리 본다 */
export async function seteukXlsxPick(win: BrowserWindow | null): Promise<XlsxPreview | null> {
  if (!win) return null
  const res = await dialog.showOpenDialog(win, {
    title: '세특 시트를 내려받은 엑셀 · 작성실에서 내보낸 엑셀 고르기',
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  })
  if (res.canceled || !res.filePaths[0]) return null
  const id = crypto.randomUUID()
  picked.clear()
  picked.set(id, { path: res.filePaths[0], name: path.basename(res.filePaths[0]) })
  return preview(id, false)
}

export function seteukXlsxPreview(id: string, overwrite: boolean): Promise<XlsxPreview> {
  return preview(String(id), !!overwrite)
}

/** 미리 본 대로 합친다 */
export async function seteukXlsxApply(id: string, overwrite: boolean): Promise<XlsxPreview> {
  const f = picked.get(String(id))
  if (!f) return { ok: false, error: '파일을 다시 골라 주세요.' }
  try {
    const book = readBook(await xlsxToGrids(f.path))
    const cur = current()
    const { data, report } = mergeBook(cur, book, { overwrite: !!overwrite }, () => 'a' + crypto.randomUUID().replace(/-/g, '').slice(0, 10))
    for (const m of SETEUK_MODES) seteukSaveRoster(m.key, data.rosters[m.key])
    seteukSaveActs(data.acts)
    for (const a of data.acts) if (data.rows[a.id] !== cur.rows[a.id]) seteukSaveRows(a.id, data.rows[a.id] ?? {})
    for (const [rec, sums] of Object.entries(data.sums)) if (sums !== cur.sums[rec]) seteukSaveSum(rec, sums)
    picked.delete(String(id))
    return { ok: true, file: f.name, report }
  } catch (e) {
    return { ok: false, error: (e as Error).message || '가져오지 못했습니다.' }
  }
}
