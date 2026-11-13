/**
 * 세특 작성실 — 엑셀로 주고받기.
 * 세특 시트(Prompt-Master)를 엑셀로 내려받은 파일, 또는 이 화면에서 내보낸 파일을 읽어 작성실 자료와 합치고,
 * 작성실 자료를 같은 모양(활동마다 '○○ ▸입력' 시트, 3행이 머리글)으로 내보낸다.
 * 여기서는 글자 표(Grid)만 다룬다 — 엑셀 파일을 읽고 쓰는 것은 메인에서. electron 도 DOM 도 쓰지 않는다.
 *
 * 명단은 모드(교과 · 동아리 · 담임)마다 따로다. 활동 시트에 있는 학생은 그 활동의 모드 명단으로 들어간다.
 * 명단 시트에는 수업반 · 학번 칸도 있다(3.7.0~). 같은 학생이 두 수업반에 있으면(id 뒤 '@수업반') 활동 시트의 몇 번째 줄인지로 가른다.
 */
import { SETEUK_AMOUNTS, SETEUK_MODES, SETEUK_RECORDS, byteLen, cleanCls, cleanGroup, cleanNo, groupOf, emptyRosters, emptyRow, limitOf, modeOfRec, newActivity } from './seteuk'
import type { SeteukActivity, SeteukAmount, SeteukMode, SeteukRosters, SeteukRow, SeteukRows, SeteukStudent } from './seteuk'
import { areasOf, mergedOf, partsOf, sumFinal } from './seteukSum'
import type { SeteukSum, SeteukSums } from './seteukSum'

/** 시트 한 장 — 이름과 글자 표 */
export interface Grid {
  name: string
  rows: string[][]
}

/** 시트 이름 (세특 시트와 같다) */
export const XLSX_ROSTER = '👤 학생명단'
export const XLSX_ACTS = '🗂 활동목록'
export const XLSX_IN = ' ▸입력'
export const XLSX_SUM = '📦 취합 ▸'
/** 모드별 명단 시트 — '👤 학생명단 ▸교과' */
export const rosterSheet = (mode: SeteukMode): string => `${XLSX_ROSTER} ▸${SETEUK_MODES.find((m) => m.key === mode)?.name ?? '교과'}`

/** 활동 입력 시트에서 관찰 기록이 아닌 칸 */
const RESERVED = new Set(['반', '학년-반', '학년', '번호', '이름', '수업반', '학번', '성취수준', '생성', '모델', 'AI결과', '최종본', '바이트', '검증', '합본', '합본바이트', '압축', 'AI압축결과', '예시번호'])

export interface BookAct {
  name: string
  rec: string
  subject: string
  desc: string
  bytes: number
  amount: SeteukAmount
  rows: SeteukRows
}
export interface SeteukBook {
  rosters: SeteukRosters
  acts: BookAct[]
  sums: Record<string, SeteukSums>
}

export interface SeteukData {
  rosters: SeteukRosters
  acts: SeteukActivity[]
  rows: Record<string, SeteukRows>
  sums: Record<string, SeteukSums>
}

export interface XlsxReport {
  /** 파일에 든 학생 · 활동 수 */
  students: number
  acts: number
  newStudents: number
  newActs: string[]
  mergedActs: string[]
  /** 채워지는 칸 수 (관찰 기록 · AI 초안 · 최종본 · 취합) */
  cells: number
  /** 이미 글이 있어 그대로 두는 칸 수 (덮어쓰기를 고르지 않았을 때) */
  kept: number
  /** 반 · 번호는 같은데 이름이 달라 넣지 않는 학생 */
  mismatched: string[]
}

/** 가져오기 미리 보기 · 결과 — 화면에 돌려주는 모양 (경로는 넘기지 않는다) */
export interface XlsxPreview {
  ok: boolean
  error?: string
  id?: string
  file?: string
  report?: XlsxReport
}

const norm = (s: unknown): string => String(s ?? '').replace(/\s+/g, '')
const cell = (r: string[] | undefined, i: number): string => (i < 0 || !r ? '' : String(r[i] ?? '').trim())

/** 앞쪽 여덟 줄에서 머리글 줄을 찾는다 — needs 의 글자가 모두 든 첫 줄 */
function findHead(rows: string[][], needs: string[]): { at: number; head: string[] } | null {
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const head = (rows[i] ?? []).map(norm)
    if (needs.every((n) => head.includes(n))) return { at: i, head }
  }
  return null
}

const idOf = (cls: string, no: string): string => `${cls || '0'}-${no}`

/** '반' 또는 '학년-반' 칸과 번호 칸 → 반 · 번호 */
function whoOf(r: string[], head: string[]): { cls: string; no: string; name: string } | null {
  const iCls = head.indexOf('반') >= 0 ? head.indexOf('반') : head.indexOf('학년-반')
  const no = cleanNo(cell(r, head.indexOf('번호')))
  const name = cell(r, head.indexOf('이름'))
  if (!no || !name) return null
  return { cls: iCls >= 0 && cell(r, iCls) ? cleanCls(cell(r, iCls)) : '', no, name }
}

/** AI 결과 칸의 실패 표시(⚠ …) · 수식은 글이 아니다 */
const aiText = (s: string): string => (/^[⚠=]/.test(s) ? '' : s)

/** 엑셀 파일의 시트들 → 명단 · 활동 · 글 */
export function readBook(grids: Grid[]): SeteukBook {
  const rosters = emptyRosters()
  /**
   * 활동 · 취합 시트의 한 줄 → 학생 id. 명단 시트에서 같은 반 · 번호가 둘 이상이면(두 수업반) 그 시트에서 몇 번째로 나왔는지(k)로 고른다.
   * 명단에 없으면 '반-번호' 로 더한다.
   */
  const add = (mode: SeteukMode, w: { cls: string; no: string; name: string }, k = 0): string => {
    const same = rosters[mode].filter((s) => s.cls === w.cls && s.no === w.no)
    if (same.length) return (same[k] ?? same[same.length - 1]).id
    const id = idOf(w.cls, w.no)
    rosters[mode].push({ id, cls: w.cls, no: w.no, name: w.name })
    return id
  }
  /** 시트마다 같은 반 · 번호가 몇 번째로 나왔는지 */
  const counter = (): ((w: { cls: string; no: string }) => number) => {
    const seen = new Map<string, number>()
    return (w) => {
      const key = idOf(w.cls, w.no)
      const k = seen.get(key) ?? 0
      seen.set(key, k + 1)
      return k
    }
  }

  // 명단 시트를 먼저 — '▸교과 · ▸동아리 · ▸담임' 이 붙은 것은 그 모드로.
  // 붙지 않은 것(세특 시트의 명단 한 장)은 활동이 하나도 없는 파일일 때만 교과 명단으로 읽는다:
  // 활동이 있으면 학생은 활동 시트에서 제 모드로 들어간다.
  const hasActs = grids.some((g) => g.name.trim().endsWith(XLSX_IN.trim()) && findHead(g.rows, ['번호', '이름', '최종본']))
  for (const g of grids) {
    if (!g.name.includes('학생명단')) continue
    const tagged = SETEUK_MODES.find((m) => g.name.includes(`▸${m.name}`))
    if (!tagged && hasActs) continue
    const rh = findHead(g.rows, ['번호', '이름'])
    if (!rh) continue
    const mode = tagged?.key ?? 'subject'
    for (const r of g.rows.slice(rh.at + 1)) {
      const w = whoOf(r, rh.head)
      if (!w) continue
      const group = cleanGroup(cell(r, rh.head.indexOf('수업반')))
      const hakbun = cell(r, rh.head.indexOf('학번')).replace(/\D/g, '').slice(0, 6)
      let id = idOf(w.cls, w.no)
      const list = rosters[mode]
      if (list.some((s) => s.id === id)) {
        // 같은 학생이 다른 수업반에도 — 작성실과 같은 규칙(mergeGroup)으로 '@수업반'
        if (list.some((s) => s.id === id && (s.group ?? '') === group)) continue
        id = `${id}@${group || '반'}`
        for (let n = 2; list.some((s) => s.id === id); n++) id = `${id.replace(/#\d+$/, '')}#${n}`
      }
      const st: SeteukStudent = { id, cls: w.cls, no: w.no, name: w.name }
      if (group) st.group = group
      if (hakbun) st.hakbun = hakbun
      list.push(st)
    }
  }

  // 활동목록 — 활동 이름으로 기록 영역 · 분량 · 개요를 찾는다
  const meta = new Map<string, Partial<BookAct>>()
  /** 입력 시트 이름 → 활동 이름 (시트 이름은 31자에서 잘리므로 활동목록에 적힌 이름이 먼저다) */
  const nameOfSheet = new Map<string, string>()
  const list = grids.find((g) => g.name.includes('활동목록'))
  const lh = list && findHead(list.rows, ['활동명'])
  if (list && lh) {
    const at = (n: string): number => lh.head.indexOf(n)
    for (const r of list.rows.slice(lh.at + 1)) {
      const name = cell(r, at('활동명'))
      if (!name) continue
      const rec = cell(r, at('기록종류'))
      const amount = cell(r, at('분량맞추기')) as SeteukAmount
      const subject = cell(r, at('과목')) || cell(r, at('교과영역'))
      meta.set(name, {
        rec: SETEUK_RECORDS.some((x) => x.key === rec) ? rec : '과세특',
        subject: subject === '공통' ? '' : subject,
        desc: cell(r, at('활동개요')),
        bytes: Math.max(0, Math.floor(Number(cell(r, at('바이트한도'))) || 0)),
        amount: SETEUK_AMOUNTS.includes(amount) ? amount : '보통'
      })
      const sheet = cell(r, at('입력시트'))
      if (sheet) nameOfSheet.set(sheet.trim(), name)
    }
  }

  const acts: BookAct[] = []
  for (const g of grids) {
    const gname = g.name.trim()
    if (!gname.endsWith(XLSX_IN.trim())) continue
    const h = findHead(g.rows, ['번호', '이름', '최종본'])
    if (!h) continue
    const name = nameOfSheet.get(gname) ?? gname.slice(0, gname.length - XLSX_IN.trim().length).trim()
    if (acts.some((a) => a.name === name)) continue
    const m = meta.get(name) ?? {}
    const rec = m.rec ?? '과세특'
    const mode = modeOfRec(rec)
    const inputs = h.head.map((x, i) => i).filter((i) => h.head[i] && !RESERVED.has(h.head[i]))
    const iAi = h.head.indexOf('AI결과')
    const iFin = h.head.indexOf('최종본')
    const rows: SeteukRows = {}
    const nth = counter()
    for (const r of g.rows.slice(h.at + 1)) {
      const w = whoOf(r, h.head)
      if (!w) continue
      const id = add(mode, w, nth(w))
      const parts = inputs.map((i) => ({ h: String(g.rows[h.at][i] ?? '').trim(), v: cell(r, i) })).filter((p) => p.v)
      const note = parts.length <= 1 && inputs.length <= 1 ? (parts[0]?.v ?? '') : parts.map((p) => `${p.h}: ${p.v}`).join('\n')
      const row: SeteukRow = { note, ai: aiText(cell(r, iAi)), final: cell(r, iFin) }
      if (row.note || row.ai || row.final) rows[id] = row
    }
    acts.push({ name, rec, subject: m.subject ?? '', desc: m.desc ?? '', bytes: m.bytes ?? 0, amount: m.amount ?? '보통', rows })
  }

  const sums: Record<string, SeteukSums> = {}
  for (const g of grids) {
    const gname = g.name.trim()
    if (!gname.startsWith(XLSX_SUM.trim())) continue
    const rec = gname.slice(XLSX_SUM.trim().length).trim()
    const h = findHead(g.rows, ['번호', '이름', '최종본'])
    if (!h || !SETEUK_RECORDS.some((x) => x.key === rec)) continue
    const iAi = h.head.indexOf('AI압축결과')
    const iFin = h.head.indexOf('최종본')
    const out: SeteukSums = {}
    const nth = counter()
    for (const r of g.rows.slice(h.at + 1)) {
      const w = whoOf(r, h.head)
      if (!w) continue
      const id = add(modeOfRec(rec), w, nth(w))
      const s: SeteukSum = {}
      const ai = aiText(cell(r, iAi))
      const fin = cell(r, iFin)
      if (ai) s.ai = ai
      // 합본 그대로인 최종본은 손댄 글이 아니다 — 넣어 두면 활동별 글을 고쳐도 따라 바뀌지 않게 된다
      if (fin && fin !== cell(r, h.head.indexOf('합본'))) s.final = fin
      if ('ai' in s || 'final' in s) out[id] = s
    }
    sums[rec] = out
  }
  return { rosters, acts, sums }
}

/**
 * 파일의 자료를 지금 자료와 합친다. 지우는 것은 없다.
 *   · 명단: 모드마다, 없던 학생(반 · 번호)은 뒤에 더한다. 반 · 번호가 같은데 이름이 다르면 그 학생의 글은 넣지 않는다.
 *     같은 학생이면 지금 명단에 없는 수업반 · 학번만 파일에서 채운다.
 *   · 활동: 이름이 같으면 합치고, 없으면 새로 만든다(newId 로 번호를 받는다).
 *   · 칸: 지금 비어 있으면 넣는다. 이미 글이 있으면 overwrite 일 때만 바꾼다. 파일의 빈 칸은 아무것도 지우지 않는다.
 */
export function mergeBook(cur: SeteukData, book: SeteukBook, opt: { overwrite?: boolean }, newId: () => string): { data: SeteukData; report: XlsxReport } {
  const report: XlsxReport = {
    students: SETEUK_MODES.reduce((n, m) => n + book.rosters[m.key].length, 0),
    acts: book.acts.length,
    newStudents: 0,
    newActs: [],
    mergedActs: [],
    cells: 0,
    kept: 0,
    mismatched: []
  }
  const rosters = emptyRosters()
  const blocked: Record<SeteukMode, Set<string>> = { subject: new Set(), club: new Set(), homeroom: new Set() }
  /** 파일의 학생 id → 지금 작성실의 id (같은 반 · 번호 · 수업반인데 id 가 다를 때 — 두 수업반에 있는 학생) */
  const remap: Record<SeteukMode, Map<string, string>> = { subject: new Map(), club: new Map(), homeroom: new Map() }
  for (const m of SETEUK_MODES) {
    const students: SeteukStudent[] = cur.rosters[m.key].map((x) => ({ ...x }))
    for (const s of book.rosters[m.key]) {
      const mine = (s.group ? students.find((x) => x.cls === s.cls && x.no === s.no && groupOf(x) === s.group) : undefined) ?? students.find((x) => x.id === s.id)
      if (mine && mine.id !== s.id) remap[m.key].set(s.id, mine.id)
      if (!mine) {
        students.push(s)
        report.newStudents++
      } else if (norm(mine.name) === norm(s.name)) {
        if (!mine.hakbun && s.hakbun) mine.hakbun = s.hakbun
        if (!mine.group && s.group) mine.group = s.group
      } else {
        blocked[m.key].add(s.id)
        report.mismatched.push(`${m.name} ${s.cls ? `${s.cls}반 ` : ''}${s.no}번 — 지금 명단: ${mine.name} / 파일: ${s.name}`)
      }
    }
    rosters[m.key] = students
  }
  const take = (old: string, incoming: string): string => {
    const v = incoming.trim()
    if (!v || v === old.trim()) return old
    if (old.trim() && !opt.overwrite) {
      report.kept++
      return old
    }
    report.cells++
    return incoming
  }

  const acts = [...cur.acts]
  const rows: Record<string, SeteukRows> = { ...cur.rows }
  for (const b of book.acts) {
    let act = acts.find((a) => a.name.trim() === b.name)
    if (act) report.mergedActs.push(b.name)
    else {
      act = newActivity(newId(), { name: b.name, rec: b.rec, subject: b.subject, desc: b.desc, bytes: b.bytes, amount: b.amount })
      acts.push(act)
      report.newActs.push(b.name)
    }
    const skip = blocked[modeOfRec(act.rec)]
    const map = remap[modeOfRec(act.rec)]
    const mine: SeteukRows = { ...(rows[act.id] ?? {}) }
    for (const [fid, r] of Object.entries(b.rows)) {
      if (skip.has(fid)) continue
      const sid = map.get(fid) ?? fid
      const old = mine[sid] ?? emptyRow()
      mine[sid] = { note: take(old.note, r.note), ai: take(old.ai, r.ai), final: take(old.final, r.final) }
    }
    rows[act.id] = mine
  }

  const sums: Record<string, SeteukSums> = { ...cur.sums }
  for (const [rec, incoming] of Object.entries(book.sums)) {
    const skip = blocked[modeOfRec(rec)]
    const map = remap[modeOfRec(rec)]
    const mine: SeteukSums = { ...(sums[rec] ?? {}) }
    for (const [fid, s] of Object.entries(incoming)) {
      if (skip.has(fid)) continue
      const sid = map.get(fid) ?? fid
      const old = mine[sid] ?? {}
      const next: SeteukSum = { ...old }
      if (s.ai) next.ai = take(old.ai ?? '', s.ai)
      if (s.final) {
        const fin = take(old.final ?? '', s.final)
        if (fin) next.final = fin
      }
      if ('ai' in next || 'final' in next) mine[sid] = next
    }
    sums[rec] = mine
  }
  return { data: { rosters, acts, rows, sums }, report }
}

/** 시트 이름에 못 쓰는 글자를 빼고 31자 안으로, 겹치면 번호를 붙인다 */
function sheetTitle(raw: string, tail: string, used: Set<string>): string {
  const clean = raw.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim() || '활동'
  const fit = (s: string): string => s.slice(0, 31 - tail.length) + tail
  let name = fit(clean)
  for (let k = 2; used.has(name); k++) name = fit(`${clean.slice(0, 31 - tail.length - String(k).length - 1)} ${k}`)
  used.add(name)
  return name
}

/**
 * 작성실 자료 → 엑셀 시트들. 세특 시트와 같은 모양이라(3행이 머리글, 4행부터 학생) 다시 읽을 수 있고,
 * 관찰 메모 · AI 결과 · 최종본 열을 세특 시트의 같은 칸에 붙여 넣을 수도 있다.
 */
export function buildBook(data: SeteukData): Grid[] {
  const out: Grid[] = []
  const used = new Set<string>([XLSX_ACTS])
  for (const m of SETEUK_MODES) {
    if (!data.rosters[m.key].length) continue
    const name = rosterSheet(m.key)
    used.add(name)
    out.push({
      name,
      rows: [[`${m.name} 명단(${m.who}) — 세특 작성실에서 내보냄`], ['반', '번호', '이름', '수업반', '학번'], ...data.rosters[m.key].map((s) => [s.cls, s.no, s.name, s.group ?? '', s.hakbun ?? ''])]
    })
  }
  const actSheets = data.acts.map((a) => sheetTitle(a.name, XLSX_IN, used))
  out.push({
    name: XLSX_ACTS,
    rows: [
      ['활동 목록 — 세특 작성실에서 내보냄'],
      ['활동명', '기록종류', '과목', '바이트 한도', '분량 맞추기', '활동 개요', '입력 시트'],
      ...data.acts.map((a, i) => [a.name, a.rec, a.subject, String(limitOf(a)), a.amount, a.desc, actSheets[i]])
    ]
  })
  data.acts.forEach((a, i) => {
    const rows = data.rows[a.id] ?? {}
    out.push({
      name: actSheets[i],
      rows: [
        [`${a.name} — ${a.rec} · 한도 ${limitOf(a)}바이트`],
        [],
        ['반', '번호', '이름', '관찰 메모', 'AI 결과', '최종본', '바이트'],
        ...data.rosters[modeOfRec(a.rec)].map((s) => {
          const r = rows[s.id] ?? emptyRow()
          return [s.cls, s.no, s.name, r.note, r.ai, r.final, r.final.trim() ? String(byteLen(r.final)) : '']
        })
      ]
    })
  })
  for (const area of areasOf(data.acts)) {
    const sums = data.sums[area.rec.key] ?? {}
    out.push({
      name: XLSX_SUM + area.rec.key,
      rows: [
        [`${area.rec.name} — 한도 ${area.limit}바이트`],
        [],
        ['반', '번호', '이름', ...area.acts.map((a) => a.name), '합본', '합본 바이트', 'AI 압축결과', '최종본', '바이트'],
        ...data.rosters[modeOfRec(area.rec.key)].map((s) => {
          const parts = partsOf(area, data.rows, s.id)
          const merged = mergedOf(parts)
          const fin = sumFinal(sums[s.id], merged, area.limit)
          return [s.cls, s.no, s.name, ...parts, merged, merged ? String(byteLen(merged)) : '', sums[s.id]?.ai ?? '', fin, fin.trim() ? String(byteLen(fin)) : '']
        })
      ]
    })
  }
  return out
}
