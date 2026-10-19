/**
 * AI 답에서 마크다운 표를 뽑는다 — OCR 결과를 엑셀로 옮길 때 쓴다.
 * Open WebUI 'Export to Excel'(v0.4.0) 의 규칙을 그대로 따른다:
 * 칸 안의 \| 는 글자 | 로, `코드` 안의 | 는 칸 나눔으로 보지 않고, ``` 울타리 안은 건너뛴다.
 * 다만 수식($…$ · \(…\) · \[…\]) 안의 \\ 는 행렬의 줄 나눔이라 그대로 둔다.
 */

import { mathText } from './mathtext'

export interface MdTable {
  /** 표 바로 위의 제목(# …). 없으면 빈칸 — 시트 이름에 쓴다 */
  title: string
  header: string[]
  rows: string[][]
}

/** 표 한 줄을 칸으로 나눈다 */
export function splitRow(line: string): string[] {
  const text = line.trim()
  const cells: string[] = []
  let cur = ''
  // 수식 안인지: $…$ · \(…\) · \[…\] 이거나 $ 없이 쓴 \begin{…}…\end{…}
  let math = false
  let env = 0
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    const nx = text[i + 1]
    if (ch === '\\' && (nx === '(' || nx === '[' || nx === ')' || nx === ']' || nx === '$')) {
      if (nx !== '$') math = nx === '(' || nx === '['
      cur += ch + nx
      i += 2
      continue
    }
    if (text.startsWith('\\begin{', i)) env++
    else if (text.startsWith('\\end{', i)) env = Math.max(0, env - 1)
    if (ch === '\\' && (math || env) && nx === '\\') {
      cur += '\\\\'
      i += 2
      continue
    }
    if (ch === '\\' && i + 1 < text.length && (nx === '|' || nx === '\\')) {
      cur += nx
      i += 2
      continue
    }
    if (ch === '$') {
      const run = nx === '$' ? '$$' : '$'
      math = !math
      cur += run
      i += run.length
      continue
    }
    if (ch === '`') {
      let end = i
      while (end < text.length && text[end] === '`') end++
      const marker = text.slice(i, end)
      const closing = text.indexOf(marker, end)
      if (closing >= 0) {
        cur += text.slice(i, closing + marker.length)
        i = closing + marker.length
        continue
      }
    }
    if (ch === '|') {
      cells.push(cur.trim())
      cur = ''
      // 짝이 안 맞는 $ 가 옆 칸까지 번지지 않게
      math = false
      env = 0
    } else {
      cur += ch
    }
    i++
  }
  cells.push(cur.trim())
  let out = cells
  if (text.startsWith('|')) out = out.slice(1)
  if (text.endsWith('|') && !cur) out = out.slice(0, -1)
  return out
}

const SEP_CELL = /^:?-{3,}:?$/

/** 표를 감쌀 때 쓰는 울타리(```markdown · ``` …) — 이것 말고(```python 같은) 울타리 안은 코드라 건너뛴다 */
const TABLE_FENCE = /^\s{0,3}(`{3,}|~{3,})\s*(markdown|md|gfm|text|table)?\s*$/i

/**
 * 답 안의 표를 모두 찾는다. 울타리 밖에 표가 없고 표를 ```markdown 으로 감싸 보냈으면(지침과 달리 가끔 그런다)
 * 그 울타리를 벗기고 다시 찾는다.
 */
export function extractTables(md: string): MdTable[] {
  const found = findTables(md)
  if (found.length || !/^\s{0,3}(`{3,}|~{3,})/m.test(md)) return found
  return findTables(unfence(md))
}

/** 표를 감싼 울타리 줄만 뺀다 */
function unfence(md: string): string {
  return md
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => !TABLE_FENCE.test(l))
    .join('\n')
}

function findTables(md: string): MdTable[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const tables: MdTable[] = []
  let fence: { ch: string; len: number } | null = null
  let lastTitle = ''
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const mark = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (mark) {
      const [, run, tail] = mark
      if (!fence) fence = { ch: run[0], len: run.length }
      else if (run[0] === fence.ch && run.length >= fence.len && !tail.trim()) fence = null
      i++
      continue
    }
    const head = /^#{1,6}\s+(.+)$/.exec(line.trim())
    if (!fence && head) lastTitle = head[1].trim()
    if (fence || /^( {4}|\t)/.test(line) || i + 1 >= lines.length || !line.includes('|')) {
      i++
      continue
    }
    const header = splitRow(line)
    const sep = splitRow(lines[i + 1])
    if (header.length !== sep.length || !sep.length || !sep.every((c) => SEP_CELL.test(c))) {
      i++
      continue
    }
    const rows: string[][] = []
    i += 2
    while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !/^\s*(`{3,}|~{3,})/.test(lines[i])) {
      rows.push(splitRow(lines[i]))
      i++
    }
    tables.push({ title: lastTitle, header, rows })
  }
  return tables
}

/** 표가 아닌 글(앞뒤 안내 문장)만 — 화면 위쪽 한 줄 안내에 쓴다 */
export function proseOf(md: string): string {
  return md
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => (!l.includes('|') || !l.trim().startsWith('|')) && !TABLE_FENCE.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const sameHeader = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x.replace(/\s+/g, '') === b[i].replace(/\s+/g, ''))

/**
 * 이어서 받은 표를 앞 표에 붙인다. 머리글이 같으면 행만 잇고, 경계에서 같은 행이 다시 나오면 한 번만 둔다.
 * 머리글이 다르면 새 표로 둔다.
 */
export function mergeTables(base: MdTable[], more: MdTable[]): MdTable[] {
  const out = base.map((t) => ({ ...t, rows: [...t.rows] }))
  for (const t of more) {
    const last = out[out.length - 1]
    if (last && sameHeader(last.header, t.header)) {
      const key = (r: string[]): string => r.join('\u0001')
      const tail = new Set(last.rows.slice(-5).map(key))
      last.rows.push(...t.rows.filter((r) => !tail.has(key(r))))
    } else {
      out.push({ ...t, rows: [...t.rows] })
    }
  }
  return out
}

/**
 * 끊긴 답의 마지막 행이 덜 나왔으면 뺀다 — 칸 수가 모자라거나 줄이 | 로 끝나지 않으면 덜 나온 것으로 본다.
 * 이어 받을 때 그 행부터 다시 받는다.
 */
export function dropPartialTail(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n')
  const tables = extractTables(md)
  const t = tables[tables.length - 1]
  if (!t || !t.rows.length) return md
  const last = lines[lines.length - 1]
  const cells = splitRow(last)
  if (last.trim().endsWith('|') && cells.length >= t.header.length) return md
  return lines.slice(0, -1).join('\n')
}

/**
 * 여러 번에 나눠 받은 답을 표로 — 끊긴 답의 덜 나온 마지막 행은 빼고(이어 받은 답에 다시 나온다),
 * 머리글이 같은 표는 이어 붙인다.
 */
export function answersToTables(answers: { text: string; truncated: boolean }[]): MdTable[] {
  return answers.reduce<MdTable[]>((acc, a) => {
    const found = extractTables(a.truncated ? dropPartialTail(a.text) : a.text)
    return acc.length ? mergeTables(acc, found) : found
  }, [])
}

/**
 * 쪽 묶음별로 따로 받은 표들을 하나로 — 첫 묶음의 표가 기준이고, 뒤 묶음의 표는 칸 수가 같으면
 * (머리글 글자가 조금 달라도) 이어 붙인다. 이름 칸 등이 `continued` 인 행(앞 묶음에서 이어지는 쪽)은
 * 앞 행에 붙인다: 쪽 번호 칸은 ', ' 로, 나머지 칸은 한 칸 띄워 잇는다.
 */
export function mergeChunkTables(chunks: MdTable[][], continued: string): MdTable[] {
  const out: MdTable[] = []
  for (const tables of chunks) {
    for (const t of tables) {
      const base = out.find((b) => b.header.length === t.header.length)
      if (!base) {
        out.push({ ...t, rows: t.rows.map((r) => [...r]) })
        continue
      }
      const pageCol = base.header.findIndex((h) => /페이지|쪽/.test(h))
      for (const r of t.rows) {
        const prev = base.rows[base.rows.length - 1]
        if (!prev || !r.some((c) => c.trim() === continued)) {
          base.rows.push([...r])
          continue
        }
        r.forEach((c, j) => {
          const v = c.trim()
          if (!v || v === continued) return
          if (!prev[j]?.trim()) prev[j] = v
          else if (prev[j].trim() !== v) prev[j] = `${prev[j].trim()}${j === pageCol ? ', ' : ' '}${v}`
        })
      }
    }
  }
  return out
}

/** 표를 다시 마크다운으로 (칸 안의 | 는 \| 로) */
export function tableToMd(t: MdTable): string {
  const row = (r: string[]): string => `| ${r.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`
  return [t.title ? `# ${t.title}\n` : '', row(t.header), row(t.header.map(() => '---')), ...t.rows.map(row)].filter(Boolean).join('\n')
}

/** 엑셀 · 표 계산기에 붙여 넣을 수 있게 탭으로 */
export function toTsv(t: MdTable): string {
  const clean = (s: string): string => plainCell(s).replace(/[\t\r\n]+/g, ' ')
  return [t.header, ...t.rows].map((r) => r.map(clean).join('\t')).join('\n')
}

/** **굵게** · *기울임* · `코드` 표시를 떼고 수식은 읽기 쉬운 글자로 바꾼 칸 글. 지침이 막아도 가끔 오는 <br> 은 지침대로 ' / ' */
export function plainCell(s: string): string {
  return mathText(s)
    .replace(/\s*<br\s*\/?>\s*/gi, ' / ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/`(.+?)`/g, '$1')
}
