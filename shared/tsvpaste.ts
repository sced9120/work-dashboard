/**
 * 엑셀 · 구글 시트에서 복사한 글을 표 칸마다 나눠 넣기 (3.7.5~).
 * 화면(세특 작성실의 활동 표)과 시험(tests/t_tsvpaste.cjs)이 함께 쓰는 순수 함수만 둔다.
 */

/**
 * 탭 · 줄바꿈으로 된 글을 칸 표로 읽는다.
 * 엑셀은 줄바꿈이 든 칸을 "…" 로 싸고 그 안의 따옴표는 "" 로 쓴다. CRLF 도 줄바꿈 하나로 본다.
 * 칸은 다듬지 않는다(앞뒤 공백 그대로). 엑셀이 끝에 붙이는 빈 줄 하나는 뗀다.
 */
export function parseTsv(text: string): string[][] {
  const s = String(text ?? '').replace(/\r\n?/g, '\n')
  if (!s) return []
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let started = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && !started) {
      quoted = true
      started = true
    } else if (ch === '\t') {
      row.push(cell)
      cell = ''
      started = false
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      started = false
    } else {
      cell += ch
      started = true
    }
  }
  row.push(cell)
  rows.push(row)
  // 끝의 빈 줄 하나(엑셀이 붙이는 줄바꿈)
  const last = rows[rows.length - 1]
  if (rows.length > 1 && last.length === 1 && last[0] === '') rows.pop()
  return rows
}

export interface PasteCell {
  rowId: string
  colKey: string
  value: string
}

/**
 * 칸 표를 (startRow, startCol) 에서부터 엑셀처럼 펼친다 — 줄은 아래 학생으로, 칸은 오른쪽 열로.
 * 마지막 학생 · 마지막 열을 넘는 것은 버린다.
 */
export function planPaste(grid: string[][], startRow: number, startCol: number, rowIds: string[], colKeys: string[]): PasteCell[] {
  const out: PasteCell[] = []
  if (startRow < 0 || startCol < 0) return out
  for (let r = 0; r < grid.length; r++) {
    const rowId = rowIds[startRow + r]
    if (rowId === undefined) break
    for (let c = 0; c < grid[r].length; c++) {
      const colKey = colKeys[startCol + c]
      if (colKey === undefined) break
      out.push({ rowId, colKey, value: grid[r][c] })
    }
  }
  return out
}

/** 넣지 못하고 버려지는 줄 수 · 칸 수 (표가 학생 수 · 열 수보다 클 때) */
export function pasteClipped(grid: string[][], startRow: number, startCol: number, rowCount: number, colCount: number): { rows: number; cells: number } {
  let rows = 0
  let cells = 0
  for (let r = 0; r < grid.length; r++) {
    if (startRow + r >= rowCount) {
      rows++
      continue
    }
    cells += Math.max(0, grid[r].length - Math.max(0, colCount - startCol))
  }
  return { rows, cells }
}
