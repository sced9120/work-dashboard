/**
 * 문서 스캔 · 정리(폴더 일괄) 결과를 세특 작성실의 활동으로 보내는 계획 (3.7.5~).
 * 학생 맞추기는 관찰 기록 가져오기와 같은 규칙(matchNotes — 이름이 명단에 하나뿐이면 이름, 아니면 학번 · 반과 번호)을 쓴다.
 * 화면(FolderBatch)과 시험이 함께 쓰는 순수 함수만 둔다.
 */
import type { BatchRow } from './batch'
import { isKeyColumn, joinFields, matchNoteFields, matchNotes, mergeNote, newActivity } from './seteuk'
import type { SeteukActivity, SeteukImportHit, SeteukRow, SeteukRows, SeteukSheet, SeteukStudent } from './seteuk'

export interface BatchSendOptions {
  /** 정리한 내용 → 관찰 기록 */
  note: boolean
  /** 세특 초안 → AI 초안 */
  ai: boolean
  /** true 면 이미 적힌 칸도 덮어쓴다. false 면 빈 칸에만 */
  overwrite: boolean
}

export interface BatchSendPlan {
  /** seteuk:rows 로 보낼 고친 칸 — 학생 id → 칸 */
  patch: Record<string, Partial<SeteukRow>>
  /** 맞춘 학생(보낼 글이 있는 줄만) */
  matched: number
  /** 못 찾은 줄 — '학번 이름' */
  missed: string[]
  /** 빈 칸에만 넣기라서 건너뛴 학생 수(맞췄지만 넣을 칸이 모두 차 있음) */
  kept: number
}

const norm = (s: string): string => s.replace(/\s+/g, '')

/** 정리한 항목 → 관찰 기록 글. 항목이 하나뿐이면 값만, 여럿이면 '항목: 값' 줄 */
export function noteOfItems(items: string[], values: Record<string, string> | undefined): string {
  const parts = items.map((k) => ({ k, v: String(values?.[k] ?? '').trim() })).filter((p) => p.v)
  if (!parts.length) return ''
  if (parts.length === 1 && items.length === 1) return parts[0].v
  return parts.map((p) => `${p.k}: ${p.v.replace(/\s*\n\s*/g, ' ')}`).join('\n')
}

/** 결과 한 줄을 명단의 학생 하나와 맞춘다. 못 맞추면 null */
export function matchBatchRow(row: Pick<BatchRow, 'sid' | 'name'>, students: SeteukStudent[]): SeteukStudent | null {
  const hit = matchNotes([{ header: ['학번', '이름', '내용'], rows: [[row.sid ?? '', row.name ?? '', 'x']] }], students).hits[0]
  return hit ? (students.find((s) => s.id === hit.id) ?? null) : null
}

/**
 * 보낼 계획을 세운다. 결과가 없는(실패한) 줄은 건너뛴다.
 * 활동에 입력 항목이 둘 이상이면 이름이 같은 항목은 그 칸으로, 맞는 이름이 하나도 없으면 첫 칸으로 넣는다(관찰 기록은 칸을 '항목: 값' 으로 이은 것).
 */
export function planBatchSend(rows: BatchRow[], students: SeteukStudent[], act: Pick<SeteukActivity, 'columns'>, cur: SeteukRows, itemOrder: string[], opt: BatchSendOptions): BatchSendPlan {
  const patch: Record<string, Partial<SeteukRow>> = {}
  const missed: string[] = []
  let matched = 0
  let kept = 0
  const cols = act.columns
  for (const r of rows) {
    const res = r.result
    if (!res) continue
    const noteText = opt.note ? noteOfItems(itemOrder, res.items) : ''
    const aiText = opt.ai ? String(res.seteuk ?? '').trim() : ''
    if (!noteText && !aiText) continue
    const st = matchBatchRow(r, students)
    if (!st) {
      missed.push([r.sid, r.name].filter(Boolean).join(' ') || '(이름 · 번호 없음)')
      continue
    }
    matched++
    const old: SeteukRow = cur[st.id] ?? { note: '', ai: '', final: '' }
    const p: Partial<SeteukRow> = {}
    const free = (v: string | undefined): boolean => opt.overwrite || !String(v ?? '').trim()
    if (noteText) {
      if (cols.length >= 2) {
        const fields: Record<string, string> = {}
        const byCol = cols.filter((c) => itemOrder.some((k) => norm(k) === norm(c)))
        if (byCol.length) {
          for (const c of byCol) {
            const k = itemOrder.find((x) => norm(x) === norm(c)) as string
            const v = String(res.items[k] ?? '').trim()
            if (v && free(old.fields?.[c])) fields[c] = v
          }
        } else if (free(old.fields?.[cols[0]])) fields[cols[0]] = noteText.replace(/\s*\n\s*/g, ' ')
        if (Object.keys(fields).length) {
          p.fields = fields
          p.note = joinFields(cols, { ...(old.fields ?? {}), ...fields })
        }
      } else if (free(old.note)) p.note = noteText
    }
    if (aiText && free(old.ai)) p.ai = aiText
    if (Object.keys(p).length) patch[st.id] = p
    else kept++
  }
  return { patch, matched, missed, kept }
}

/** 스캔한 표를 보낼 때 이미 적힌 관찰 기록을 어떻게 할지 */
export type SheetSendMode = 'empty' | 'append' | 'overwrite'

export interface SheetSendPlan {
  patch: Record<string, Partial<SeteukRow>>
  /** 맞춘 학생 수(보낼 글이 있는 줄만) */
  matched: number
  /** 못 맞춘 줄 — '3반 5번 이름' */
  missed: string[]
  /** 빈 칸에만 넣기라서 건너뛴 학생 수 */
  kept: number
}

/**
 * 스캔한 표(문서 스캔 · 정리 → 파일을 표로 옮기기) → 활동의 관찰 기록 (3.7.7~).
 * 학생 맞추기와 내용 칸 잇기는 관찰 기록 가져오기와 같은 규칙(matchNotes)을 쓴다.
 * 활동에 입력 항목이 여럿이면 첫 칸으로 넣는다. empty: 빈 칸에만 · append: 적힌 글 뒤에 이어 붙임 · overwrite: 덮어씀.
 */
export function planSheetSend(sheets: SeteukSheet[], students: SeteukStudent[], act: Pick<SeteukActivity, 'columns'>, cur: SeteukRows, mode: SheetSendMode): SheetSendPlan {
  const m = matchNotes(sheets, students)
  const patch: Record<string, Partial<SeteukRow>> = {}
  let matched = 0
  let kept = 0
  const cols = act.columns
  for (const h of m.hits) {
    const text = h.text.trim()
    if (!text) continue
    matched++
    const old: SeteukRow = cur[h.id] ?? { note: '', ai: '', final: '' }
    const prev = cols.length >= 2 ? String(old.fields?.[cols[0]] ?? '') : old.note
    if (mode === 'empty' && prev.trim()) {
      kept++
      continue
    }
    const next = mode === 'append' && prev.trim() ? prev.replace(/\s+$/, '') + '\n' + text : text
    if (cols.length >= 2) {
      const flat = next.replace(/\s*\n\s*/g, ' ')
      const fields = { ...(old.fields ?? {}), [cols[0]]: flat }
      patch[h.id] = { fields: { [cols[0]]: flat }, note: joinFields(cols, fields) }
    } else patch[h.id] = { note: next }
  }
  return { patch, matched, missed: m.misses.map((x) => x.label), kept }
}

export interface NewActFromSheetPlan {
  /** 새로 만들 활동 — 입력 항목(columns)이 표의 내용 칸이다 */
  act: SeteukActivity
  patch: Record<string, Partial<SeteukRow>>
  matched: number
  missed: string[]
}

/**
 * 스캔한 표로 새 활동을 만든다 (3.7.11~). 표의 내용 칸이 둘 이상이면 그 머리글이 활동의 '입력 항목'이 되어
 * 학생마다 칸별로 나뉘어 들어가고(관찰 기록에는 '항목: 글'로 이어짐), 하나뿐이면 관찰 기록 한 칸에 들어간다.
 * 기존 활동에 넣을 때 한 칸에 몰리는 것을 피하려는 길이다.
 */
export function planNewActFromSheets(
  sheets: SeteukSheet[],
  students: SeteukStudent[],
  spec: { id: string; name: string; rec: string; subject?: string }
): NewActFromSheetPlan {
  const m = matchNoteFields(sheets, students)
  const columns = m.columns.length >= 2 ? m.columns : []
  const act = newActivity(spec.id, { name: spec.name.trim() || '스캔한 내용', rec: spec.rec, subject: spec.subject?.trim() ?? '', columns, desc: '스캔한 표에서 만든 활동' })
  const patch: Record<string, Partial<SeteukRow>> = {}
  for (const h of m.hits) {
    if (columns.length) patch[h.id] = { fields: h.fields, note: joinFields(columns, h.fields) }
    else patch[h.id] = { note: Object.values(h.fields).join('\n') }
  }
  return { act, patch, matched: m.hits.length, missed: m.misses.map((x) => x.label) }
}

/* ---------- 구글 설문지 → 활동 ---------- */

/** 활동의 입력 항목은 열두 개까지 (readColumns) */
export const FORM_MAX_COLUMNS = 12

/** 활동마다 응답 시트 주소 · 어디까지 가져왔는지 · 가져오기로 한 문항 (seteuk_ 로 시작해 인수인계 파일에는 넣지 않는다) */
export const seteukFormKey = (actId: string): string => `seteuk_form_${actId}`
export interface SeteukFormMeta {
  sheet: string
  last: number
  title: string
  /** 설문지로 만든 활동에서 고른 문항 — 비면 모든 문항 */
  cols?: string[]
}

/** 설문지 문항 → 입력 항목 이름. 쉼표 · 세로줄은 입력 항목을 나누는 글자라 바꾸고, 겹치면 (2) 를 붙인다 */
export function cleanFormSheet(sheet: SeteukSheet): SeteukSheet {
  const used = new Set<string>()
  const header = sheet.header.map((h, i) => {
    if (isKeyColumn(h)) return h
    const base = h.replace(/\s*[,，|\r\n]+\s*/g, ' · ').replace(/\s+/g, ' ').trim().slice(0, 60).trim() || `문항 ${i + 1}`
    let name = base
    for (let n = 2; used.has(norm(name)); n++) name = `${base} (${n})`
    used.add(norm(name))
    return name
  })
  return { header, rows: sheet.rows }
}

/** 학생을 맞추는 칸을 뺀 문항들 */
export function formQuestions(sheet: SeteukSheet): { index: number; name: string }[] {
  return sheet.header.map((name, index) => ({ index, name })).filter((q) => !isKeyColumn(q.name))
}

/** 학생을 맞추는 칸 + 고른 문항만 남긴 표 */
function cutSheet(sheet: SeteukSheet, keepQuestion: (index: number) => boolean): SeteukSheet {
  const keep = sheet.header.map((_h, i) => i).filter((i) => isKeyColumn(sheet.header[i]) || keepQuestion(i))
  return { header: keep.map((i) => sheet.header[i]), rows: sheet.rows.map((r) => keep.map((i) => r[i] ?? '')) }
}

/** 기억해 둔 문항만 남긴다. 설문지가 바뀌어 하나도 맞지 않으면 그대로 둔다 */
export function pickQuestions(sheet: SeteukSheet, names: string[] | undefined): SeteukSheet {
  if (!names?.length) return sheet
  const want = new Set(names.map(norm))
  if (!formQuestions(sheet).some((q) => want.has(norm(q.name)))) return sheet
  return cutSheet(sheet, (i) => want.has(norm(sheet.header[i])))
}

/**
 * 설문지 응답으로 새 활동을 만든다. 고른 문항이 둘 이상이면 활동의 입력 항목이 되고, 하나면 관찰 기록 한 칸이다.
 * 학생이 쓴 글이라 칸마다 머리표(tag, '[설문 11/27]')를 붙여 교사 관찰과 가른다.
 */
export function planNewActFromForm(
  sheet: SeteukSheet,
  students: SeteukStudent[],
  picked: number[],
  spec: { id: string; name: string; rec: string; subject?: string; desc?: string },
  tag: string
): NewActFromSheetPlan {
  const chosen = new Set(picked.slice(0, FORM_MAX_COLUMNS))
  if (!chosen.size) return { act: newActivity(spec.id, { name: spec.name, rec: spec.rec }), patch: {}, matched: 0, missed: [] }
  const plan = planNewActFromSheets([cutSheet(sheet, (i) => chosen.has(i))], students, { ...spec, name: spec.name.trim() || '설문지 응답' })
  const patch: Record<string, Partial<SeteukRow>> = {}
  for (const [id, row] of Object.entries(plan.patch)) {
    if (row.fields) {
      const fields = Object.fromEntries(Object.entries(row.fields).map(([k, v]) => [k, `${tag} ${v}`]))
      patch[id] = { fields, note: joinFields(plan.act.columns, fields) }
    } else patch[id] = { note: `${tag} ${row.note ?? ''}` }
  }
  return { ...plan, act: { ...plan.act, desc: spec.desc?.trim() ?? '' }, patch }
}

const flat = (s: string): string => s.replace(/\s*\n\s*/g, ' ').trim()

/**
 * 가져온 글을 학생 한 줄에 더한다 (지우지 않고 뒤에 붙임, 같은 글이 있으면 그대로).
 * 입력 항목이 나뉜 활동은 이름이 같은 칸에, 맞는 칸이 없으면 첫 칸에 넣고 관찰 기록을 다시 잇는다.
 */
export function mergeImportRow(columns: string[], old: Pick<SeteukRow, 'note' | 'fields'>, hit: SeteukImportHit): Partial<SeteukRow> {
  if (columns.length < 2) return { note: mergeNote(old.note, hit.text) }
  const fields: Record<string, string> = { ...(old.fields ?? {}) }
  // 칸을 나누기 전에 적은 관찰 기록은 첫 칸으로 옮겨 지킨다
  if (!columns.some((c) => fields[c]?.trim()) && old.note.trim()) fields[columns[0]] = flat(old.note)
  const add = (col: string, v: string): void => {
    const next = flat(v)
    const prev = (fields[col] ?? '').trim()
    if (next && !prev.includes(next)) fields[col] = prev ? `${prev} ${next}` : next
  }
  const parts = Object.entries(hit.fields ?? {})
  if (!parts.length) add(columns[0], hit.text)
  for (const [k, v] of parts) {
    const col = columns.find((c) => norm(c) === norm(k))
    if (col) add(col, v)
    else add(columns[0], `${k}: ${v}`)
  }
  return { fields, note: joinFields(columns, fields) }
}

/**
 * 폴더째 정리 결과로 새 활동을 만든다. 정리한 항목이 둘 이상이면 활동의 입력 항목이 되고, 세특 초안은 AI 초안 칸으로 간다.
 */
export function planNewActFromBatch(
  rows: BatchRow[],
  students: SeteukStudent[],
  items: string[],
  spec: { id: string; name: string; rec: string; subject?: string },
  opt: { note: boolean; ai: boolean }
): NewActFromSheetPlan & { missedRows: string[] } {
  const columns = items.length >= 2 ? items : []
  const act = newActivity(spec.id, { name: spec.name.trim() || '스캔한 내용', rec: spec.rec, subject: spec.subject?.trim() ?? '', columns, desc: '문서 스캔 · 정리 결과에서 만든 활동' })
  const plan = planBatchSend(rows, students, act, {}, items, { note: opt.note, ai: opt.ai, overwrite: false })
  return { act, patch: plan.patch, matched: plan.matched, missed: plan.missed, missedRows: plan.missed }
}
