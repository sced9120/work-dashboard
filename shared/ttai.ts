/**
 * AI 로 시간표 읽기 — 학교마다 다른 시간표 모양을 표준 자료(교사 · 요일 · 교시 · 반 · 과목 · 블록 · 구분)로 바꾼다.
 *
 * 개인정보: AI 에는 이 PC 에서 글자를 가린 표만 보낸다. 요일 · 교시 · 학년 · 창체 같은 시간표 낱말과 숫자 · 영문 묶음 글자는
 * 그대로 두고, 그 밖의 한글 낱말(선생님 이름 · 과목 · 학교 이름)은 모두 W1, W2 … 로 바꾼다(같은 낱말은 같은 기호).
 * 받은 답의 기호는 이 PC 에서 되돌린다. 칸 색깔은 보내지 않고, AI 가 알려 준 칸 자리(줄 · 열)로 이 PC 에서 붙인다.
 *
 * 순서: ① 표의 짜임(머리줄 · 첫 자료줄 · 한 사람(반)이 몇 줄인지)을 묻고 ② 자료줄을 몇 묶음으로 나눠 수업마다 한 줄로 받는다.
 */

import type { SheetText } from './timetable'
import { STD_COLUMNS } from './timetable'

/** 가리지 않는 시간표 낱말 */
const KEEP = new Set(
  (
    '교사 교사명 선생님 성명 이름 담당 담임 학년 반 학급 학반 교실 교시 요일 시간 시간표 수업 과목 블록 선택 이동 합반 원반 ' +
    '공강 자습 창체 창의적 체험활동 동아리 자율 자율활동 자치 봉사 진로활동 점심 조회 종례 시수 계 합계 총 오전 오후 시 분 학기 ' +
    '없음 비고 번호 구분 종류 주 주간'
  ).split(' ')
)
const DAYS_ONLY = /^[월화수목금토일]+$|^[월화수목금토일]요일$/

export interface MaskedSheet {
  /** 가린 글 (원래 칸 모양 그대로) */
  rows: string[][]
  /** words[i] 가 W{i+1} 의 원래 낱말 */
  words: string[]
}

/** 시트의 한글 낱말을 가린다. 너무 큰 표는 잘라 읽는다 */
export function maskSheet(sheet: SheetText, maxRows = 400, maxCols = 60): MaskedSheet {
  const index = new Map<string, number>()
  const words: string[] = []
  const tok = (w: string): string => {
    if (KEEP.has(w) || DAYS_ONLY.test(w)) return w
    let i = index.get(w)
    if (i === undefined) {
      i = words.length
      words.push(w)
      index.set(w, i)
    }
    return `W${i + 1}`
  }
  const rows = sheet.rows.slice(0, maxRows).map((row) =>
    row.slice(0, maxCols).map((v) =>
      (v ?? '')
        .replace(/\r/g, '')
        .trim()
        .replace(/\n+/g, ' / ')
        .replace(/[가-힣]+/g, tok)
    )
  )
  return { rows, words }
}

/** 받은 답의 기호를 원래 낱말로 */
export const unmask = (text: string, words: string[]): string => text.replace(/W(\d+)/g, (m, n) => words[Number(n) - 1] ?? m)

/** 줄 번호(1부터) · 열 번호(1부터)를 붙여 표를 글로 — 칸은 탭으로 나눈다. 빈 줄은 건너뛴다 */
export function sheetText(m: MaskedSheet, rowNos: number[]): string {
  const cols = Math.max(0, ...rowNos.map((r) => lastFilled(m.rows[r - 1] ?? [])))
  const head = ['줄\\열', ...Array.from({ length: cols }, (_, i) => String(i + 1))].join('\t')
  const body = rowNos
    .filter((r) => (m.rows[r - 1] ?? []).some((v) => v))
    .map((r) => [String(r), ...(m.rows[r - 1] ?? []).slice(0, cols)].join('\t'))
  return [head, ...body].join('\n')
}

const lastFilled = (row: string[]): number => {
  for (let i = row.length - 1; i >= 0; i--) if (row[i]) return i + 1
  return 0
}

const RULE = `표의 사람 이름 · 과목 같은 한글 낱말은 W1, W2 … 로 가려 두었습니다(같은 낱말은 같은 기호). 기호는 바꾸지 말고 그대로 쓰세요.
칸 안의 " / " 는 칸 속 줄바꿈입니다. 요일 · 교시 · 학년 · 반 · 창체 · 동아리 · 공강 같은 낱말과 숫자, A_ 같은 영문 묶음 글자는 가리지 않았습니다.`

/** ① 표의 짜임을 묻는 글 */
export function structurePrompt(m: MaskedSheet): string {
  const n = Math.min(m.rows.length, 40)
  return `당신은 대한민국 학교 시간표를 잘 아는 교사입니다. 아래는 어느 학교 시간표 엑셀 시트의 앞부분입니다.
${RULE}

이 표를 "수업 하나에 한 줄" 로 바꾸려 합니다. 먼저 표의 짜임만 알려 주세요.
- 머리줄: 나머지 줄을 읽는 데 필요한 줄(요일 · 교시가 적힌 줄 등)의 줄 번호들
- 첫자료줄: 수업이 적힌 첫 줄 번호 (선생님이나 반 이름이 시작되는 줄)
- 묶음줄수: 선생님(또는 반) 한 명의 시간표가 몇 줄인지. 한 줄에 한 사람이면 1, 이름 칸 아래로 교시가 내려가면 그 줄 수(이름 줄 포함)
- 모양: 이 표가 어떤 모양인지 한두 문장 (예: 줄마다 선생님, 위 두 줄에 요일 · 교시, 칸에 반 번호와 과목)

JSON 형식: {"머리줄":[2,3],"첫자료줄":4,"묶음줄수":1,"모양":""}

--- 표 ---
${sheetText(m, Array.from({ length: n }, (_, i) => i + 1))}`
}

export interface Structure {
  head: number[]
  first: number
  unit: number
  shape: string
}

/** ① 의 답을 읽는다. 못 읽으면 null */
export function parseStructure(raw: string, rowCount: number): Structure | null {
  const a = raw.indexOf('{')
  const b = raw.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    const j = JSON.parse(raw.slice(a, b + 1)) as { 머리줄?: unknown; 첫자료줄?: unknown; 묶음줄수?: unknown; 모양?: unknown }
    const head = (Array.isArray(j.머리줄) ? j.머리줄 : []).map(Number).filter((x) => x >= 1 && x <= rowCount)
    const first = Number(j.첫자료줄)
    const unit = Math.max(1, Math.min(30, Number(j.묶음줄수) || 1))
    if (!(first >= 1 && first <= rowCount)) return null
    return { head, first, unit, shape: typeof j.모양 === 'string' ? j.모양.slice(0, 200) : '' }
  } catch {
    return null
  }
}

/** ② 자료줄을 묶음으로 — 한 번에 보낼 칸 수를 넘지 않게, 한 사람(반)의 줄은 나누지 않는다 */
export function chunkRows(m: MaskedSheet, s: Structure, maxCells = 110): number[][] {
  const data: number[] = []
  for (let r = s.first; r <= m.rows.length; r++) if (!s.head.includes(r)) data.push(r)
  const units: number[][] = []
  for (let i = 0; i < data.length; i += s.unit) units.push(data.slice(i, i + s.unit))
  const cells = (rs: number[]): number => rs.reduce((n, r) => n + (m.rows[r - 1] ?? []).filter(Boolean).length, 0)
  const chunks: number[][] = []
  let cur: number[] = []
  for (const u of units) {
    if (!cells(u)) continue
    if (cur.length && cells(cur) + cells(u) > maxCells) {
      chunks.push(cur)
      cur = []
    }
    cur.push(...u)
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

/** ② 수업마다 한 줄로 바꿔 달라는 글 */
export function convertPrompt(m: MaskedSheet, s: Structure, rows: number[]): string {
  return `당신은 대한민국 학교 시간표를 잘 아는 교사입니다. 아래는 어느 학교 시간표 엑셀 시트의 머리줄과 자료줄 일부입니다.
${RULE}
표의 짜임: ${s.shape || '(설명 없음)'}

자료줄에 적힌 수업을 하나도 빠짐없이, 수업마다 한 줄씩 아래 모양으로만 적으세요. 설명 · 머리말 · 코드블록 없이 줄만 적습니다.
줄|열|교사|요일|교시|반|과목|블록|구분
- 줄 · 열: 그 수업이 적힌 칸의 줄 번호와 열 번호 (표 맨 위 · 맨 앞의 번호)
- 교사: 선생님 (기호 그대로, 괄호 속 숫자는 빼고). 칸에 없으면 그 줄이나 묶음의 이름 칸에서
- 요일: 월 화 수 목 금 토 가운데 하나 / 교시: 숫자만
- 반: 2-4 처럼 학년-반 (203 → 2-3). 칸에 반이 여럿이면 반마다 한 줄. 반을 알 수 없으면 비움
- 과목: 기호 그대로 (A_W3 처럼 묶음 글자가 붙어 있으면 _ 뒤의 과목만)
- 블록: A_ 처럼 묶음 글자가 붙어 있으면 그 글자(A), 없으면 비움
- 구분: 수업 · 블록 · 공강 · 창체 · 동아리 가운데 하나 (묶음 글자가 있으면 블록, [공강] · 자습은 공강)
- 빈 칸, 이름 칸, 요일 · 교시 칸은 적지 않습니다

--- 머리줄 ---
${sheetText(m, s.head)}

--- 자료줄 ---
${sheetText(m, rows)}`
}

export interface AiLine {
  row: number
  col: number
  fields: string[]
}

/** ② 의 답에서 "줄|열|교사|요일|교시|반|과목|블록|구분" 줄만 뽑는다 */
export function parseLines(raw: string): AiLine[] {
  const out: AiLine[] = []
  for (const line of raw.split(/\r?\n/)) {
    const f = line.replace(/^\s*[-*]\s*/, '').split('|').map((x) => x.trim())
    if (f.length < 9 || !/^\d+$/.test(f[0]) || !/^\d+$/.test(f[1])) continue
    out.push({ row: Number(f[0]), col: Number(f[1]), fields: f.slice(2, 9) })
  }
  return out
}

/**
 * 받은 줄들을 표준 목록 시트로 — 기호를 되돌리고, 칸 자리로 칸 색을 붙인다.
 * 보낸 자료줄 밖이나 빈 칸을 가리킨 줄, 그 칸에 없는 과목 · 교사 기호를 적은 줄(AI 가 지어낸 줄)은 버리고 센다.
 */
export function toStandardSheet(
  lines: AiLine[],
  original: SheetText,
  masked: MaskedSheet,
  dataRows: Set<number>
): { sheet: SheetText; used: number; dropped: number; cells: Set<string> } {
  const rows: string[][] = [[...STD_COLUMNS, '색']]
  let dropped = 0
  const cells = new Set<string>()
  for (const l of lines) {
    const cell = masked.rows[l.row - 1]?.[l.col - 1] ?? ''
    const [teacher, , , , subject] = l.fields
    const tokens = [subject, teacher].flatMap((x) => x.match(/W\d+/g) ?? [])
    const inCell = !tokens.length || tokens.some((t) => new RegExp(`${t}(?!\\d)`).test(cell))
    if (!dataRows.has(l.row) || !cell || !inCell) {
      dropped++
      continue
    }
    cells.add(`${l.row}-${l.col}`)
    rows.push([...l.fields.map((x) => unmask(x, masked.words)), original.fills?.[l.row - 1]?.[l.col - 1] ?? ''])
  }
  return { sheet: { name: `${original.name} (AI)`, rows }, used: rows.length - 1, dropped, cells }
}
