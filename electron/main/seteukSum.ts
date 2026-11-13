/**
 * 세특 작성실 — 취합 · 압축 · 나이스 입력 파일.
 * 압축은 합본 글만 보낸다(이름은 가린다). 나이스 양식은 이 PC 에서만 열고, 특기사항 칸만 바꿔 새 파일로 저장한다.
 */
import { dialog, type BrowserWindow } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import * as db from './db'
import { askSeteuk } from './ai'
import { unmaskText } from './anonymize'
import { loadLocalSettings } from './secrets'
import { maskSeteuk, seteukActs, seteukApplyConfig, seteukMaskNames, seteukRosterOf } from './seteuk'
import { SETEUK_RECORDS, cleanSeteuk, modeOfRec, readRows, seteukRowsKey, validateSeteuk } from '../../shared/seteuk'
import type { SeteukRows } from '../../shared/seteuk'
import { adoptCompressed, areasOf, compressPrompt, compressUser, mergedOf, partsOf, readSums, seteukSumKey, sumFinal, trimToBytes } from '../../shared/seteukSum'
import type { SeteukArea, SeteukCompressReply, SeteukCompressRequest, SeteukSumPatch, SeteukSumProgress, SeteukSums } from '../../shared/seteukSum'
import { fillNeisSheetXml, matchNeisRows, neisColumn, readNeisForm } from '../../shared/seteukNeis'
import type { NeisOptions, NeisPlanRow, NeisPreviewReply, NeisSource } from '../../shared/seteukNeis'

const recOk = (rec: unknown): rec is string => typeof rec === 'string' && SETEUK_RECORDS.some((r) => r.key === rec)
const sumsOf = (rec: string): SeteukSums => readSums(db.getSetting(seteukSumKey(rec), ''))

/** 기록 영역마다 저장된 취합 칸 */
export function seteukSums(): Record<string, SeteukSums> {
  const out: Record<string, SeteukSums> = {}
  for (const r of SETEUK_RECORDS) out[r.key] = sumsOf(r.key)
  return out
}

/** 고친 칸만 받아 합친다. final 이 null 이면 손댄 것을 지워 합본을 따르게 한다 */
export function seteukSaveSum(rec: string, patch: SeteukSumPatch): void {
  if (!recOk(rec)) return
  const cur = sumsOf(rec)
  for (const [sid, p] of Object.entries(patch ?? {})) {
    const s = { ...(cur[sid] ?? {}) }
    if (typeof p?.ai === 'string') s.ai = p.ai
    if (typeof p?.final === 'string') s.final = p.final
    else if (p?.final === null) delete s.final
    if ('ai' in s || 'final' in s) cur[sid] = s
    else delete cur[sid]
  }
  db.setSetting(seteukSumKey(rec), JSON.stringify(cur))
}

/** 지금 저장된 활동 · 글로 그 영역을 다시 모은다 */
function areaNow(rec: string): { area: SeteukArea; rows: Record<string, SeteukRows> } | null {
  const area = areasOf(seteukActs()).find((a) => a.rec.key === rec)
  if (!area) return null
  const rows: Record<string, SeteukRows> = {}
  for (const a of area.acts) rows[a.id] = readRows(db.getSetting(seteukRowsKey(a.id), ''))
  return { area, rows }
}

/* ---------- 압축 ---------- */

const jobs = new Map<string, { stop: boolean }>()

export function seteukCompressCancel(job: string): void {
  const j = jobs.get(String(job))
  if (j) j.stop = true
}

export async function seteukCompress(req: SeteukCompressRequest, onProgress: (p: SeteukSumProgress) => void): Promise<SeteukCompressReply> {
  const none = { written: 0, failed: 0, empty: 0 }
  const now = recOk(req?.rec) ? areaNow(req.rec) : null
  if (!now) return { ok: false, error: '이 기록 영역에 활동이 없습니다.', ...none }
  const { area, rows } = now
  const roster = seteukRosterOf(modeOfRec(area.rec.key))
  const names = seteukMaskNames()
  const want = (req.ids ?? []).map(String).filter((id) => roster.some((s) => s.id === id))
  const todo = want.map((id) => ({ id, merged: mergedOf(partsOf(area, rows, id)) })).filter((x) => x.merged)
  const empty = want.length - todo.length
  if (!todo.length) return { ok: false, error: '줄일 글이 있는 학생이 없습니다.', ...none, empty }

  const job = String(req.job)
  const state = { stop: false }
  jobs.set(job, state)
  const system = compressPrompt(area.rec)
  const settings = loadLocalSettings()
  let written = 0
  let failed = 0
  let done = 0
  try {
    for (const { id, merged } of todo) {
      if (state.stop) break
      const { masked, pairs, leaks } = maskSeteuk(merged, names)
      let error = ''
      let ok = false
      if (leaks.length) error = '이름을 다 가리지 못해 보내지 않았습니다. 활동별 글의 이름을 지우고 다시 해 주세요.'
      else {
        try {
          const text = trimToBytes(cleanSeteuk(unmaskText(await askSeteuk(settings, req.model, system, compressUser(masked)), pairs)), area.limit)
          if (!text) throw new Error('빈 답이 왔습니다.')
          const before = sumsOf(area.rec.key)[id]
          seteukSaveSum(area.rec.key, { [id]: adoptCompressed(before, merged, text, area.limit) ? { ai: text, final: text } : { ai: text } })
          ok = true
        } catch (e) {
          error = (e as Error).message || 'AI 에 묻지 못했습니다.'
        }
      }
      done++
      if (ok) written++
      else failed++
      onProgress({ job, done, total: todo.length, id, sum: ok ? sumsOf(area.rec.key)[id] : undefined, error: error || undefined })
    }
  } finally {
    jobs.delete(job)
  }
  return { ok: true, written, failed, empty, canceled: state.stop || undefined }
}

/* ---------- 나이스 입력 파일 ---------- */

/** 고른 양식 — 경로는 화면에 넘기지 않고 번호로만 */
const forms = new Map<string, { path: string; name: string }>()

function unzip(file: string): Record<string, Uint8Array> {
  try {
    return unzipSync(new Uint8Array(fs.readFileSync(file)))
  } catch {
    throw new Error('엑셀(.xlsx) 파일이 아닙니다. 나이스에서 내려받은 파일을 그대로 골라 주세요.')
  }
}

function xmlOf(parts: Record<string, Uint8Array>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(parts)) if (/\.(xml|rels)$/.test(k)) out[k.replace(/^\/+/, '')] = strFromU8(v)
  return out
}

/** 그 영역의 학생별 최종본 — 반 · 번호 · 이름과 함께 */
function sources(rec: string): { src: NeisSource[]; limit: number } | null {
  const now = areaNow(rec)
  if (!now) return null
  seteukApplyConfig()
  const sums = sumsOf(rec)
  const src = seteukRosterOf(modeOfRec(rec)).map((s) => {
    const text = sumFinal(sums[s.id], mergedOf(partsOf(now.area, now.rows, s.id)), now.area.limit).trim()
    return { cls: s.cls, no: s.no, name: s.name, text, flagged: !!text && !validateSeteuk(text, now.area.limit).ok }
  })
  return { src, limit: now.area.limit }
}

function planOf(file: string, rec: string, opt: NeisOptions): { parts: Record<string, Uint8Array>; form: ReturnType<typeof readNeisForm>; plan: NeisPlanRow[] } {
  const parts = unzip(file)
  const form = readNeisForm(xmlOf(parts))
  const got = sources(rec)
  if (!got) throw new Error('이 기록 영역에 활동이 없습니다.')
  return { parts, form, plan: matchNeisRows(form.rows, got.src, { limit: got.limit, overwrite: !!opt?.overwrite, includeFlagged: !!opt?.includeFlagged }) }
}

function preview(id: string, rec: string, opt: NeisOptions): NeisPreviewReply {
  const f = forms.get(id)
  if (!f) return { ok: false, error: '양식 파일을 다시 골라 주세요.' }
  try {
    const { form, plan } = planOf(f.path, rec, opt)
    return {
      ok: true,
      id,
      file: f.name,
      form: { kind: form.kind, subject: form.subject, year: form.year, term: form.term, contentHead: form.contentHead, students: form.rows.length },
      plan: plan.map((x) => ({ label: x.label, ok: x.ok, why: x.why, bytes: x.bytes })),
      fill: plan.filter((x) => x.ok).length,
      column: neisColumn(plan)
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message || '양식을 읽지 못했습니다.' }
  }
}

/** 나이스에서 내려받은 양식을 고르고, 누가 들어가고 누가 빠지는지 미리 본다 */
export async function seteukNeisPick(win: BrowserWindow | null, rec: string, opt: NeisOptions): Promise<NeisPreviewReply | null> {
  if (!win || !recOk(rec)) return null
  const res = await dialog.showOpenDialog(win, {
    title: '나이스에서 내려받은 엑셀 양식 고르기',
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  })
  if (res.canceled || !res.filePaths[0]) return null
  const id = crypto.randomUUID()
  forms.clear()
  forms.set(id, { path: res.filePaths[0], name: path.basename(res.filePaths[0]) })
  return preview(id, rec, opt)
}

/** 선택을 바꿨을 때(이미 든 글도 바꾸기 · 고칠 곳 남은 글도 넣기) 다시 본다 */
export function seteukNeisPreview(id: string, rec: string, opt: NeisOptions): NeisPreviewReply {
  return recOk(rec) ? preview(String(id), rec, opt) : { ok: false, error: '기록 영역을 찾지 못했습니다.' }
}

/** 채운 파일을 새 이름으로 저장한다 — 원래 파일은 그대로 둔다 */
export async function seteukNeisSave(win: BrowserWindow | null, id: string, rec: string, opt: NeisOptions): Promise<{ ok: boolean; message: string }> {
  const f = forms.get(String(id))
  if (!win || !f || !recOk(rec)) return { ok: false, message: '양식 파일을 다시 골라 주세요.' }
  let out: Uint8Array
  let fill = 0
  let skip = 0
  try {
    const { parts, form, plan } = planOf(f.path, rec, opt)
    const fills: Record<number, string> = {}
    for (const x of plan) if (x.ok) fills[x.r] = x.text
    fill = Object.keys(fills).length
    skip = plan.length - fill
    if (!fill) return { ok: false, message: '넣을 학생이 없습니다. 빠진 까닭을 확인해 주세요.' }
    const key = Object.keys(parts).find((k) => k.replace(/^\/+/, '') === form.sheetPath)
    if (!key) return { ok: false, message: '양식의 시트를 찾지 못했습니다.' }
    parts[key] = strToU8(fillNeisSheetXml(strFromU8(parts[key]), form.contentCol, fills))
    out = zipSync(parts)
  } catch (e) {
    return { ok: false, message: (e as Error).message || '파일을 만들지 못했습니다.' }
  }
  const res = await dialog.showSaveDialog(win, {
    title: '채운 나이스 파일 저장',
    defaultPath: path.join(path.dirname(f.path), `채움_${f.name}`),
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  })
  if (res.canceled || !res.filePath) return { ok: false, message: '취소했습니다.' }
  if (path.resolve(res.filePath) === path.resolve(f.path)) return { ok: false, message: '원래 양식 파일과 다른 이름으로 저장해 주세요.' }
  try {
    fs.writeFileSync(res.filePath, Buffer.from(out))
    return { ok: true, message: `${fill}명을 채워 저장했습니다${skip ? `(빠진 학생 ${skip}명)` : ''}: ${res.filePath}` }
  } catch (e) {
    return { ok: false, message: `저장하지 못했습니다. 엑셀에서 같은 파일을 열어 두었다면 닫고 다시 해 주세요. (${e instanceof Error ? e.message : e})` }
  }
}
