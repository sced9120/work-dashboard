/**
 * 문서 스캔 · 정리(폴더 일괄) 결과를 세특 작성실의 활동으로 보내는 계획 (3.7.5~).
 * 학생 맞추기는 관찰 기록 가져오기와 같은 규칙(matchNotes — 이름이 명단에 하나뿐이면 이름, 아니면 학번 · 반과 번호)을 쓴다.
 * 화면(FolderBatch)과 시험이 함께 쓰는 순수 함수만 둔다.
 */
import type { BatchRow } from './batch'
import { joinFields, matchNotes } from './seteuk'
import type { SeteukActivity, SeteukRow, SeteukRows, SeteukSheet, SeteukStudent } from './seteuk'

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
