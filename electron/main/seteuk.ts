/**
 * 세특 작성실 — 명단 · 활동 · 학생별 글을 이 PC 에만 두고, 관찰 기록으로 초안을 받아 온다.
 * AI 에는 규칙과 이름을 가린 관찰 기록만 보낸다. 이름이 하나라도 남으면 그 학생은 보내지 않는다.
 * 자리는 settings 표의 seteuk_ 로 시작하는 줄 — 인수인계 파일에는 넣지 않는다(db.exportTo).
 * 명단은 모드(교과 · 동아리 · 담임)마다 따로 둔다.
 */
import { dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import * as db from './db'
import { askSeteuk } from './ai'
import { leakCheck, maskText, unmaskText } from './anonymize'
import { loadLocalSettings } from './secrets'
import type { AliasPair, LocalSettings, ModelChoice } from '../../shared/types'
import {
  SETEUK_ACTS_KEY,
  SETEUK_CONFIG_KEY,
  SETEUK_MODES,
  SETEUK_RECORDS,
  SETEUK_GROUND_SYSTEM,
  SETEUK_OPTIONS_KEY,
  SETEUK_STYLE_KEY,
  SETEUK_STYLE_SAMPLE_MAX,
  SETEUK_STYLE_SYSTEM,
  betterCheck,
  buildGroundUser,
  buildRepairUser,
  buildSeteukPrompt,
  cleanSeteuk,
  defaultActivities,
  emptyRosters,
  emptyRow,
  joinFields,
  limitOf,
  needsRepair,
  parseGround,
  readConfig,
  readOptions,
  setSeteukConfig,
  modeOfRec,
  readActs,
  readRows,
  readStudents,
  recordOf,
  readStyle,
  seteukRosterKey,
  seteukRowsKey,
  seteukUser,
  styleUser,
  styleTail,
  validateSeteuk
} from '../../shared/seteuk'
import type {
  SeteukActivity,
  SeteukConfig,
  SeteukGround,
  SeteukMode,
  SeteukOptions,
  SeteukProgress,
  SeteukRosters,
  SeteukRow,
  SeteukRows,
  SeteukStudent,
  SeteukStyle,
  SeteukWriteReply,
  SeteukWriteRequest
} from '../../shared/seteuk'
import { DEMO_ACTS, DEMO_ROSTERS, DEMO_ROWS, SETEUK_DEMO_KEY } from '../../shared/seteukDemo'
import { readSums, seteukSumKey } from '../../shared/seteukSum'
import { REVIEW_MAX_CHARS, REVIEW_MIN_CHARS, buildReviewSystem, buildReviewUser, cleanReport } from '../../shared/seteukReview'
import type { SeteukReviewReply, SeteukReviewRequest } from '../../shared/seteukReview'
import { POINTS_MIN_CHARS, POINTS_SYSTEM, buildGemText, buildSkillMd, cleanPoints, pointsUser, skillName } from '../../shared/seteukExport'

export interface SeteukAll {
  rosters: SeteukRosters
  acts: SeteukActivity[]
  rows: Record<string, SeteukRows>
  style: SeteukStyle
  options: SeteukOptions
  config: SeteukConfig
  /** 체험 자료가 들어 있다 / 넣을 수 있다(명단이 모두 비어 있을 때만) */
  demo: { filled: boolean; canFill: boolean }
}

const modeOk = (m: unknown): m is SeteukMode => SETEUK_MODES.some((x) => x.key === m)

export const seteukRosterOf = (mode: SeteukMode): SeteukStudent[] => readStudents(db.getSetting(seteukRosterKey(mode), ''))

export function seteukRosters(): SeteukRosters {
  const out = emptyRosters()
  for (const m of SETEUK_MODES) out[m.key] = seteukRosterOf(m.key)
  return out
}

/**
 * 활동 목록. 한 번도 저장한 적이 없으면(처음 연 것) 기본 활동을 만들어 둔다 —
 * 명단만 넣으면 바로 쓸 수 있게. 선생님이 모두 지운 뒤에는 다시 만들지 않는다.
 */
export function seteukActs(): SeteukActivity[] {
  const raw = db.getSetting(SETEUK_ACTS_KEY, '')
  if (raw) return readActs(raw)
  const made = defaultActivities()
  db.setSetting(SETEUK_ACTS_KEY, JSON.stringify(made))
  return made
}

const rowsOf = (actId: string): SeteukRows => readRows(db.getSetting(seteukRowsKey(actId), ''))

function demoState(rosters: SeteukRosters): SeteukAll['demo'] {
  const filled = db.getSetting(SETEUK_DEMO_KEY, '') === '1'
  return { filled, canFill: !filled && SETEUK_MODES.every((m) => rosters[m.key].length === 0) }
}

/** 규칙 설정을 DB 에서 읽어 이 프로세스의 검사 · 프롬프트에 건다 — 초안 · 압축 · 나이스 파일 전에 부른다 */
export function seteukApplyConfig(): SeteukConfig {
  const c = readConfig(db.getSetting(SETEUK_CONFIG_KEY, ''))
  setSeteukConfig(c)
  return c
}

export function seteukSaveConfig(c: SeteukConfig): SeteukConfig {
  const clean = readConfig(JSON.stringify(c ?? {}))
  db.setSetting(SETEUK_CONFIG_KEY, JSON.stringify(clean))
  setSeteukConfig(clean)
  return clean
}

export function seteukLoad(): SeteukAll {
  const config = seteukApplyConfig()
  const list = seteukActs()
  const rows: Record<string, SeteukRows> = {}
  for (const a of list) rows[a.id] = rowsOf(a.id)
  const rosters = seteukRosters()
  return { rosters, acts: list, rows, style: seteukStyle(), options: seteukOptions(), config, demo: demoState(rosters) }
}

export function seteukSaveRoster(mode: SeteukMode, list: SeteukStudent[]): SeteukStudent[] {
  if (!modeOk(mode)) return []
  const clean = readStudents(JSON.stringify(list ?? []))
  db.setSetting(seteukRosterKey(mode), JSON.stringify(clean))
  return clean
}

/** 활동 목록을 통째로 바꾼다. 목록에서 빠진 활동의 글도 함께 지운다 */
export function seteukSaveActs(list: SeteukActivity[]): SeteukActivity[] {
  const before = seteukActs()
  const clean = readActs(JSON.stringify(list ?? []))
  db.setSetting(SETEUK_ACTS_KEY, JSON.stringify(clean))
  for (const a of before) if (!clean.some((x) => x.id === a.id)) db.setSetting(seteukRowsKey(a.id), '')
  return clean
}

/** 고친 칸만 받아 합친다 — 초안을 받는 동안 화면에서 고친 관찰 기록 · 최종본이 서로 덮이지 않게 */
export function seteukSaveRows(actId: string, patch: Record<string, Partial<SeteukRow>>): void {
  const id = String(actId)
  if (!seteukActs().some((a) => a.id === id)) return
  const cur = rowsOf(id)
  for (const [sid, p] of Object.entries(patch ?? {})) {
    const row = cur[sid] ?? emptyRow()
    if (typeof p?.note === 'string') row.note = p.note
    if (typeof p?.ai === 'string') row.ai = p.ai
    if (typeof p?.final === 'string') row.final = p.final
    if (p?.fields && typeof p.fields === 'object') row.fields = { ...(row.fields ?? {}), ...p.fields }
    if (typeof p?.grade === 'string') {
      if (p.grade) row.grade = p.grade
      else delete row.grade
    }
    if (Array.isArray(p?.ground)) row.ground = p.ground
    else if (p && 'ground' in p && p.ground === undefined) delete row.ground
    if (typeof p?.repaired === 'boolean') {
      if (p.repaired) row.repaired = true
      else delete row.repaired
    }
    cur[sid] = row
  }
  db.setSetting(seteukRowsKey(id), JSON.stringify(cur))
}

/* ---------- 폰에서 온 수업 관찰 ---------- */

export interface PhoneObs {
  act: string
  /** 세특 학생 id — 폰 v2 판(수업반)에서 고른 학생. 있으면 이것으로 먼저 찾는다 */
  sid?: string
  cls: string
  no: number
  /** YYYY-MM-DD */
  day: string
  text: string
}

/**
 * 폰에서 적은 관찰을 그 활동 · 그 학생의 관찰 기록 뒤에 '[11/13] 내용' 으로 붙인다.
 * 입력 항목이 둘 이상인 활동이면 첫 항목 칸에 붙이고 관찰 기록을 다시 잇는다.
 * 활동이나 학생을 찾지 못한 것은 missed 로 돌려준다(받은 글함으로 보낸다).
 */
export function seteukAddObs(list: PhoneObs[]): { added: number; acts: string[]; missed: PhoneObs[] } {
  const acts = seteukActs()
  const touched = new Map<string, SeteukRows>()
  const missed: PhoneObs[] = []
  let added = 0
  for (const o of list) {
    const act = acts.find((a) => a.id === o.act)
    const roster = act ? seteukRosterOf(modeOfRec(act.rec)) : []
    const st = (o.sid ? roster.find((s) => s.id === o.sid) : undefined) ?? (o.no ? roster.find((s) => s.cls === o.cls && Number(s.no) === o.no) : undefined)
    if (!act || !st) {
      missed.push(o)
      continue
    }
    const rows = touched.get(act.id) ?? rowsOf(act.id)
    const row = rows[st.id] ?? emptyRow()
    const line = `[${Number(o.day.slice(5, 7))}/${Number(o.day.slice(8, 10))}] ${o.text.replace(/\s*\n\s*/g, ' ').trim()}`
    if (act.columns.length >= 2) {
      const col = act.columns[0]
      const fields = { ...(row.fields ?? {}) }
      fields[col] = fields[col]?.trim() ? `${fields[col].trimEnd()} ${line}` : line
      row.fields = fields
      row.note = joinFields(act.columns, fields)
    } else {
      row.note = row.note.trim() ? `${row.note.trimEnd()}\n${line}` : line
    }
    rows[st.id] = row
    touched.set(act.id, rows)
    added++
  }
  for (const [id, rows] of touched) db.setSetting(seteukRowsKey(id), JSON.stringify(rows))
  return { added, acts: [...touched.keys()], missed }
}

/* ---------- 이름 가리기 ---------- */

/** 성을 빼고 부를 때('○○이가 발표함') — 조사가 바로 붙은 것만 이름으로 본다 */
const GIVEN_TAIL = '(?=이가|이는|이도|이를|이랑|이와|이의|이|가|는|도|를|랑|와|의)'

/**
 * 가릴 이름 — 세 명단의 학생을 모두 모은다. 동아리 기록에 우리 반 학생 이름이 나와도 가려지게.
 * 같은 이름은 한 번만.
 */
export function seteukMaskNames(): SeteukStudent[] {
  const out: SeteukStudent[] = []
  for (const m of SETEUK_MODES) for (const s of seteukRosterOf(m.key)) if (!out.some((x) => x.name === s.name)) out.push(s)
  return out
}

export function maskSeteuk(text: string, roster: SeteukStudent[]): { masked: string; pairs: AliasPair[]; leaks: string[] } {
  let prepared = text
  for (const s of roster) {
    if (s.name.length !== 3) continue
    const given = s.name.slice(1)
    // 이름 끝이 같은 학생이 둘이면 누구인지 모르니 건드리지 않는다
    if (roster.filter((x) => x.name.length === 3 && x.name.slice(1) === given).length > 1) continue
    prepared = prepared.replace(new RegExp(`(?<![가-힣])${given}${GIVEN_TAIL}`, 'g'), s.name)
  }
  const pairs: AliasPair[] = roster.map((s, i) => ({ real: s.name, alias: `학생${i + 1}` }))
  const masked = maskText(prepared, pairs)
  return { masked, pairs, leaks: leakCheck(masked, pairs) }
}

/* ---------- 예시 · 내 문체 ---------- */

export const seteukStyle = (): SeteukStyle => readStyle(db.getSetting(SETEUK_STYLE_KEY, ''))

export function seteukSaveStyle(style: SeteukStyle): SeteukStyle {
  const clean = readStyle(JSON.stringify(style ?? {}))
  db.setSetting(SETEUK_STYLE_KEY, JSON.stringify(clean))
  return clean
}

/**
 * 그 활동의 규칙(시스템 프롬프트)과 문체. 예시 · 문체 글에 든 학생 이름도 가린다 —
 * 규칙 글 자체는 건드리지 않는다(이름과 같은 낱말이 규칙에 있을 수 있어서).
 */
function rulesFor(act: SeteukActivity, names: SeteukStudent[]): { system: string; style: SeteukStyle; leaks: string[] } {
  seteukApplyConfig()
  const leaks: string[] = []
  const hide = (t: string): string => {
    const m = maskSeteuk(t, names)
    leaks.push(...m.leaks)
    return m.masked
  }
  const raw = seteukStyle()
  const style: SeteukStyle = raw.on ? { on: true, samples: raw.samples.map(hide), card: hide(raw.card) } : raw
  const masked: SeteukActivity = { ...act, examples: act.examples.map((e) => ({ note: hide(e.note), result: hide(e.result) })) }
  return { system: buildSeteukPrompt(masked, { style }), style, leaks }
}

const RULE_LEAK = '예시나 내 문체 글에 든 이름을 다 가리지 못해 보내지 않았습니다. 그 글의 이름을 지우고 다시 해 주세요.'

/**
 * 예전에 쓴 세특에서 문체 카드를 뽑는다(쓰는 방식만 — 내용은 옮기지 않는다). 이름은 가려 보낸다.
 * dry 면 보내지 않고 AI 앱에 붙여 넣을 요청 글만 돌려준다.
 */
export async function seteukStyleCard(model: ModelChoice | undefined | null, dry: boolean): Promise<{ ok: boolean; card?: string; text?: string; error?: string }> {
  const samples = seteukStyle().samples.slice(0, SETEUK_STYLE_SAMPLE_MAX)
  if (samples.length < 2) return { ok: false, error: '예전에 쓴 세특을 두 편 이상 넣어 주세요.' }
  const m = maskSeteuk(styleUser(samples), seteukMaskNames())
  if (m.leaks.length) return { ok: false, error: '예전 세특에 든 이름을 다 가리지 못했습니다. 이름을 지우고 다시 해 주세요.' }
  if (dry) return { ok: true, text: `${SETEUK_STYLE_SYSTEM}\n\n${m.masked}` }
  try {
    const card = (await askSeteuk(loadLocalSettings(), model, SETEUK_STYLE_SYSTEM, m.masked)).trim()
    if (!card) throw new Error('빈 답이 왔습니다.')
    return { ok: true, card }
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'AI 에 묻지 못했습니다.' }
  }
}

/* ---------- 자동 고쳐쓰기 · 근거 확인 ---------- */

export const seteukOptions = (): SeteukOptions => readOptions(db.getSetting(SETEUK_OPTIONS_KEY, ''))

export function seteukSaveOptions(o: SeteukOptions): SeteukOptions {
  const clean = readOptions(JSON.stringify(o ?? {}))
  db.setSetting(SETEUK_OPTIONS_KEY, JSON.stringify(clean))
  return clean
}

/** 근거 확인 — 이름을 가린 관찰 기록과 초안을 보내고, 자료에 없는 구절을 돌려받는다 */
async function groundOf(settings: LocalSettings, model: ModelChoice | undefined | null, note: string, draft: string, names: SeteukStudent[]): Promise<SeteukGround[]> {
  const m = maskSeteuk(buildGroundUser(note, draft), names)
  if (m.leaks.length) throw new Error('이름을 다 가리지 못해 근거 확인을 보내지 않았습니다.')
  const list = parseGround(await askSeteuk(settings, model, SETEUK_GROUND_SYSTEM, m.masked, true))
  return list.map((g) => ({ quote: unmaskText(g.quote, m.pairs), why: unmaskText(g.why, m.pairs) }))
}

/** 한 학생의 근거 확인 — 최종본이 있으면 최종본, 없으면 초안을 본다 */
export async function seteukGround(actId: string, sid: string, model: ModelChoice | undefined | null): Promise<{ ok: boolean; row?: SeteukRow; error?: string }> {
  const act = seteukActs().find((a) => a.id === actId)
  if (!act) return { ok: false, error: '활동을 찾지 못했습니다.' }
  const r = rowsOf(act.id)[String(sid)]
  const draft = (r?.final.trim() || r?.ai.trim() || '').trim()
  if (!r?.note.trim() || !draft) return { ok: false, error: '관찰 기록과 초안(또는 최종본)이 있어야 확인합니다.' }
  try {
    const ground = await groundOf(loadLocalSettings(), model, r.note, draft, seteukMaskNames())
    seteukSaveRows(act.id, { [sid]: { ground } })
    return { ok: true, row: rowsOf(act.id)[String(sid)] }
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'AI 에 묻지 못했습니다.' }
  }
}

/* ---------- 학생부 살펴보기 ---------- */

/**
 * 한 학생의 학생부를 읽고 의견을 받는다. 세 명단의 학생 이름을 가려 보내고, 다 가리지 못하면 보내지 않는다.
 * 명단에 없는 이름(다른 학교 · 다른 해 학생)은 가리지 못하므로 화면에서 미리 알린다.
 */
export async function seteukReview(req: SeteukReviewRequest): Promise<SeteukReviewReply> {
  const text = String(req?.text ?? '').trim()
  const grade = req?.grade === '1' || req?.grade === '2' || req?.grade === '3' ? req.grade : null
  if (!grade) return { ok: false, error: '학년을 골라 주세요.' }
  if (text.length < REVIEW_MIN_CHARS) return { ok: false, error: '학생부 글이 너무 짧습니다. 세특 · 창체 글을 몇 영역 붙여 넣어 주세요.' }
  if (text.length > REVIEW_MAX_CHARS) return { ok: false, error: `학생부 글이 너무 깁니다(${REVIEW_MAX_CHARS.toLocaleString()}자까지). 한 학년이나 몇 영역씩 나눠 주세요.` }
  const m = maskSeteuk(text, seteukMaskNames())
  if (m.leaks.length) return { ok: false, error: '학생 이름을 다 가리지 못해 보내지 않았습니다. 이름을 지우고 다시 해 주세요.' }
  const system = buildReviewSystem(grade)
  const user = buildReviewUser(m.masked, grade, String(req.career ?? ''))
  if (req.dry) return { ok: true, text: `${system}\n\n${user}` }
  try {
    const raw = await askSeteuk(loadLocalSettings(), req.model, system, user)
    const report = cleanReport(unmaskText(raw, m.pairs))
    if (!report) throw new Error('빈 답이 왔습니다.')
    return { ok: true, report }
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'AI 에 묻지 못했습니다.' }
  }
}

/* ---------- AI 앱용 지침 내보내기 ---------- */

/** 그 활동의 규칙(예시 · 문체 포함, 이름은 가린 것) — Gem · GPT · 프로젝트 지침으로 붙여 넣을 글 */
export function seteukGemText(actId: string): { ok: boolean; text?: string; error?: string } {
  const act = seteukActs().find((a) => a.id === actId)
  if (!act) return { ok: false, error: '활동을 찾지 못했습니다.' }
  const rules = rulesFor(act, seteukMaskNames())
  if (rules.leaks.length) return { ok: false, error: RULE_LEAK }
  return { ok: true, text: buildGemText(rules.system) }
}

/** Claude 스킬 파일(zip 안에 SKILL.md)로 저장 */
export async function seteukSkillSave(win: BrowserWindow | null, actId: string): Promise<{ ok: boolean; message: string }> {
  const act = seteukActs().find((a) => a.id === actId)
  if (!win || !act) return { ok: false, message: '활동을 찾지 못했습니다.' }
  const rules = rulesFor(act, seteukMaskNames())
  if (rules.leaks.length) return { ok: false, message: RULE_LEAK }
  const n = seteukActs().filter((a) => a.rec === act.rec).findIndex((a) => a.id === act.id) + 1
  const name = skillName(act.rec, n)
  const md = buildSkillMd({ name, activity: act.name, record: recordOf(act.rec).name, system: rules.system })
  const res = await dialog.showSaveDialog(win, { title: 'Claude 스킬로 저장', defaultPath: `${name}.zip`, filters: [{ name: 'zip', extensions: ['zip'] }] })
  if (res.canceled || !res.filePath) return { ok: false, message: '취소했습니다.' }
  try {
    fs.writeFileSync(res.filePath, Buffer.from(zipSync({ [`${name}/SKILL.md`]: strToU8(md) })))
    return { ok: true, message: `저장했습니다. claude.ai 설정 › 기능 › 스킬에서 올리세요: ${res.filePath}` }
  } catch (e) {
    return { ok: false, message: `저장하지 못했습니다. (${e instanceof Error ? e.message : e})` }
  }
}

/* ---------- 보고서 요점 ---------- */

/**
 * 긴 학생 글(보고서 · 소감문)에서 세특에 쓸 요점만 뽑는다. 학생마다 한 번, 이름은 가려 보낸다.
 * 짧은 글은 그대로 돌려준다(보내지 않는다).
 */
export async function seteukPoints(items: { id: string; text: string }[], model: ModelChoice | undefined | null): Promise<{ ok: boolean; out: { id: string; text: string; error?: string }[] }> {
  const names = seteukMaskNames()
  const settings = loadLocalSettings()
  const out: { id: string; text: string; error?: string }[] = []
  for (const it of (items ?? []).slice(0, 300)) {
    const text = String(it?.text ?? '').trim()
    if (text.length < POINTS_MIN_CHARS) {
      out.push({ id: String(it.id), text })
      continue
    }
    const m = maskSeteuk(text, names)
    if (m.leaks.length) {
      out.push({ id: String(it.id), text, error: '이름을 다 가리지 못해 요점을 뽑지 않고 원문을 넣었습니다.' })
      continue
    }
    try {
      const pts = cleanPoints(unmaskText(await askSeteuk(settings, model, POINTS_SYSTEM, pointsUser(m.masked)), m.pairs))
      out.push({ id: String(it.id), text: pts ? `[보고서 요점]\n${pts}` : text, error: pts ? undefined : '요점을 받지 못해 원문을 넣었습니다.' })
    } catch (e) {
      out.push({ id: String(it.id), text, error: (e as Error).message || 'AI 에 묻지 못했습니다.' })
    }
  }
  return { ok: true, out }
}

/* ---------- 키 없이 — 요청 글 복사 ---------- */

/**
 * AI 앱(Gemini · ChatGPT · Claude)에 붙여 넣을 요청 글 — 규칙 + 이름을 가린 관찰 기록.
 * 받은 답은 선생님이 [AI 초안] 칸에 붙여 넣는다.
 */
export function seteukRequest(actId: string, sid: string): { ok: boolean; text?: string; error?: string } {
  const act = seteukActs().find((a) => a.id === actId)
  if (!act) return { ok: false, error: '활동을 찾지 못했습니다.' }
  const note = rowsOf(act.id)[String(sid)]?.note ?? ''
  if (!note.trim()) return { ok: false, error: '관찰 기록을 먼저 적어 주세요.' }
  const names = seteukMaskNames()
  const { masked, leaks } = maskSeteuk(note, names)
  if (leaks.length) return { ok: false, error: '이름을 다 가리지 못했습니다. 관찰 기록의 이름을 지우고 다시 해 주세요.' }
  const rules = rulesFor(act, names)
  if (rules.leaks.length) return { ok: false, error: RULE_LEAK }
  const grade = recordOf(act.rec).useGrade ? rowsOf(act.id)[String(sid)]?.grade : undefined
  return { ok: true, text: `${rules.system}\n\n${seteukUser(masked, rules.style, grade)}` }
}

/* ---------- 초안 받기 ---------- */

const jobs = new Map<string, { stop: boolean }>()

export function seteukCancel(job: string): void {
  const j = jobs.get(String(job))
  if (j) j.stop = true
}

export async function seteukWrite(req: SeteukWriteRequest, onProgress: (p: SeteukProgress) => void): Promise<SeteukWriteReply> {
  const none = { written: 0, failed: 0, empty: 0 }
  const act = seteukActs().find((a) => a.id === req?.actId)
  if (!act) return { ok: false, error: '활동을 찾지 못했습니다.', ...none }
  const roster = seteukRosterOf(modeOfRec(act.rec))
  const names = seteukMaskNames()
  const stored = rowsOf(act.id)
  const want = (req.ids ?? []).map(String).filter((id) => roster.some((s) => s.id === id))
  const ids = want.filter((id) => stored[id]?.note.trim())
  const empty = want.length - ids.length
  if (!ids.length) return { ok: false, error: '관찰 기록이 적힌 학생이 없습니다.', ...none, empty }

  const rules = rulesFor(act, names)
  if (rules.leaks.length) return { ok: false, error: RULE_LEAK, ...none, empty }
  const job = String(req.job)
  const state = { stop: false }
  jobs.set(job, state)
  const system = rules.system
  const settings = loadLocalSettings()
  const opts = seteukOptions()
  const limit = limitOf(act)
  let written = 0
  let failed = 0
  let done = 0
  try {
    for (const id of ids) {
      if (state.stop) break
      const note = rowsOf(act.id)[id]?.note ?? ''
      const grade = recordOf(act.rec).useGrade ? rowsOf(act.id)[id]?.grade : undefined
      const { masked, pairs, leaks } = maskSeteuk(note, names)
      let error = ''
      let row: SeteukRow | undefined
      if (leaks.length) error = '이름을 다 가리지 못해 보내지 않았습니다. 관찰 기록의 이름을 지우고 다시 해 주세요.'
      else {
        try {
          let text = cleanSeteuk(unmaskText(await askSeteuk(settings, req.model, system, seteukUser(masked, rules.style, grade)), pairs))
          if (!text) throw new Error('빈 답이 왔습니다.')
          let repaired = false
          // 자동 고쳐쓰기 — '고침'이 나온 학생만 걸린 점을 짚어 한 번 더. 나아진 경우에만 바꾼다
          const v1 = validateSeteuk(text, limit)
          if (opts.autoRepair && needsRepair(v1) && !state.stop) {
            const ask = maskSeteuk(buildRepairUser(note, text, v1.issues, limit), names)
            if (!ask.leaks.length) {
              try {
                const t2 = cleanSeteuk(unmaskText(await askSeteuk(settings, req.model, system, ask.masked + styleTail(rules.style)), ask.pairs))
                if (t2 && betterCheck(v1, validateSeteuk(t2, limit)) === 'b') {
                  text = t2
                  repaired = true
                }
              } catch {
                // 고쳐 쓰기가 안 되면 처음 초안을 그대로 둔다
              }
            }
          }
          let ground: SeteukGround[] | undefined
          if (opts.ground && !state.stop) {
            try {
              ground = await groundOf(settings, req.model, note, text, names)
            } catch {
              ground = undefined
            }
          }
          seteukSaveRows(act.id, { [id]: { ai: text, repaired, ground } })
          row = rowsOf(act.id)[id]
        } catch (e) {
          error = (e as Error).message || 'AI 에 묻지 못했습니다.'
        }
      }
      done++
      if (row) written++
      else failed++
      onProgress({ job, done, total: ids.length, id, row, error: error || undefined })
    }
  } finally {
    jobs.delete(job)
  }
  return { ok: true, written, failed, empty, canceled: state.stop || undefined }
}

/* ---------- 체험 자료 ---------- */

/**
 * 가상 학생과 채워진 활동을 넣어 어떻게 쓰는지 먼저 보게 한다.
 * 실제 학생과 섞이지 않게 세 명단이 모두 비어 있을 때만 넣는다.
 */
export function seteukDemoFill(): { ok: boolean; error?: string } {
  if (!demoState(seteukRosters()).canFill) {
    return { ok: false, error: '명단에 학생이 있어 체험 자료를 넣지 않았습니다. 실제 자료와 섞이지 않게, 명단이 빈 상태에서만 넣습니다.' }
  }
  const acts = seteukActs().filter((a) => !DEMO_ACTS.some((d) => d.id === a.id))
  seteukSaveActs([...DEMO_ACTS, ...acts])
  for (const m of SETEUK_MODES) seteukSaveRoster(m.key, DEMO_ROSTERS[m.key])
  for (const [actId, rows] of Object.entries(DEMO_ROWS)) seteukSaveRows(actId, rows)
  db.setSetting(SETEUK_DEMO_KEY, '1')
  return { ok: true }
}

/** 체험이 만든 것만 지운다 — 체험 활동과 체험 학생. 선생님이 더한 활동 · 학생은 그대로 */
export function seteukDemoClear(): void {
  seteukSaveActs(seteukActs().filter((a) => !DEMO_ACTS.some((d) => d.id === a.id)))
  for (const m of SETEUK_MODES) {
    const demo = DEMO_ROSTERS[m.key]
    seteukSaveRoster(m.key, seteukRosterOf(m.key).filter((s) => !demo.some((d) => d.id === s.id && d.name === s.name)))
  }
  // 취합에 남은 체험 학생의 글도 지운다 (그 영역의 모드 명단에 있던 체험 학생 것만)
  for (const rec of SETEUK_RECORDS) {
    const key = seteukSumKey(rec.key)
    const sums = readSums(db.getSetting(key, ''))
    let changed = false
    for (const d of DEMO_ROSTERS[modeOfRec(rec.key)]) {
      if (d.id in sums) {
        delete sums[d.id]
        changed = true
      }
    }
    if (changed) db.setSetting(key, JSON.stringify(sums))
  }
  db.setSetting(SETEUK_DEMO_KEY, '')
}
