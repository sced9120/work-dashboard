/**
 * 메신저 정리 · 폰에서 보내기 (shared/messenger.ts · shared/relay.ts).
 *
 * 가리기는 이 PC 에서만 한다: 명단의 학생 → '학생7', 그 밖에 이름으로 보이는 것 → '사람A', 전화번호 등 → 지움.
 * 치환표는 메모리에만 있고, 가린 글에 실명이 남으면 보내지 않는다.
 */

import { BrowserWindow } from 'electron'
import { randomBytes } from 'node:crypto'
import type { AliasPair, ModelChoice } from '../../shared/types'
import { ATT_ROSTER_KEY, readRoster } from '../../shared/attendance'
import type { Student } from '../../shared/attendance'
import type { InboxItem, MsgResult } from '../../shared/messenger'
import { MSG_INBOX_KEY, messengerPrompt, parseMsgResult } from '../../shared/messenger'
import { RELAY_NEEDS, RELAY_VERSION, isNameKey, newNameKey, newRelayKey, normalizeRelayUrl, parseForm, parsePull, phoneUrl, relayScript, sheetIdOf, splitParts, versionOf } from '../../shared/relay'
import type { FormPull } from '../../shared/relay'
import { ymd } from '../../shared/neis'
import { askJson } from './ai'
import { buildAliases, findNameCandidates, leakCheck, maskText, unmaskText } from './anonymize'
import * as db from './db'
import { httpFetch } from './http'
import { loadLocalSettings, saveLocalSettings } from './secrets'
import { phoneBoard, routeRelay, sealNames } from './phone'

/* ---------- 가리기 ---------- */

/** 성을 빼고 이름만 부를 때('민준이가 아파서') — 조사 · 가족 말이 바로 붙은 것만 */
const GIVEN_TAIL = '(?=이가|이는|이도|이를|이랑|이네|이|가|는|도|를|랑|네|엄마|어머니|아버지|아빠|보호자|학생)'

function rosterStudents(): Student[] {
  return readRoster(db.getSetting(ATT_ROSTER_KEY, '')).students
}

export function maskMessages(text: string): { masked: string; pairs: AliasPair[]; leaks: string[] } {
  const students = rosterStudents()
  let prepared = text
  for (const s of students) {
    if (s.name.length !== 3) continue
    const given = s.name.slice(1)
    // 다른 학생 이름의 끝과 같으면(김민준 · 이민준) 누구인지 모르니 건드리지 않는다
    if (students.filter((x) => x.name.length === 3 && x.name.slice(1) === given).length > 1) continue
    prepared = prepared.replace(new RegExp(`(?<![가-힣])${given}${GIVEN_TAIL}`, 'g'), s.name)
  }
  const pairs: AliasPair[] = students.map((s) => ({ real: s.name, alias: `학생${s.no}` }))
  const others = findNameCandidates(prepared).filter((n) => !students.some((s) => s.name === n))
  pairs.push(...buildAliases(others.map((name) => ({ name, role: '사람' }))))
  // 반 번호 지우기 규칙이 뒤 띄어쓰기까지 먹어 '○반학생5' 처럼 붙는 것을 떼어 놓는다
  const masked = maskText(prepared, pairs).replace(/○반(?=[^\s])/g, '○반 ')
  return { masked, pairs, leaks: leakCheck(masked, pairs) }
}

export interface ExtractReply {
  ok: boolean
  error?: string
  result?: MsgResult
  /** AI 에 보낸 글 (가린 것) */
  masked?: string
}

export async function extractMessages(text: string, model?: ModelChoice): Promise<ExtractReply> {
  const body = text.trim().slice(0, 20000)
  if (!body) return { ok: false, error: '정리할 글이 없습니다.' }
  const { masked, pairs, leaks } = maskMessages(body)
  if (leaks.length) return { ok: false, error: `이름을 다 가리지 못해 보내지 않았습니다(${leaks.length}개). 글을 조금 고쳐 다시 해 주세요.`, masked }
  const students = rosterStudents()
  let raw: string
  try {
    raw = await askJson(loadLocalSettings(), model, messengerPrompt(masked, ymd(new Date()), students))
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'AI 에 묻지 못했습니다.', masked }
  }
  const r = parseMsgResult(raw)
  const back = (s: string): string => unmaskText(s, pairs)
  const result: MsgResult = {
    todos: r.todos.map((t) => ({ ...t, title: back(t.title), from: back(t.from), note: back(t.note) })),
    attendance: r.attendance.map((a) => {
      const st = students.find((s) => s.no === a.no)
      return { ...a, no: st ? st.no : 0, who: st ? st.name : back(a.who), note: back(a.note) }
    })
  }
  return { ok: true, result, masked }
}

/* ---------- 폰에서 온 글 (DB 설정 msg_inbox — 인수인계 파일에는 넣지 않음) ---------- */

export function inboxList(): InboxItem[] {
  try {
    const v = JSON.parse(db.getSetting(MSG_INBOX_KEY, '[]')) as InboxItem[]
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string' && typeof x.text === 'string') : []
  } catch {
    return []
  }
}

function inboxSave(list: InboxItem[]): void {
  db.setSetting(MSG_INBOX_KEY, JSON.stringify(list.slice(-200)))
}

export function inboxRemove(ids: string[]): void {
  inboxSave(inboxList().filter((x) => !ids.includes(x.id)))
  notify()
}

function notify(): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('inbox:changed', inboxList().length)
}

/* ---------- 폰에서 보내기 (Apps Script 우편함) ---------- */

export interface RelayInfo {
  /** 열쇠를 만들었는지 */
  hasKey: boolean
  /** 웹 앱 주소까지 이어졌는지 */
  connected: boolean
  url: string
  /** 폰에서 열 주소 (이어졌을 때만) — ?k= 까지. 탭은 &tab=, 이름표 열쇠는 맨 뒤 #n= 로 붙인다 */
  phone: string
  /** 이름표 열쇠 — 폰 주소의 # 뒤에만 쓴다 */
  nkey: string
  /** 이름표 열쇠를 새로 만들어 폰 주소가 바뀌었다 — QR 을 다시 찍어야 학번 · 이름이 보인다 */
  rescan: boolean
  script: string
  /** 우편함 스크립트의 판 (모르면 0). latest 보다 낮으면 수업 관찰 · 출결을 못 쓴다 */
  ver: number
  latest: number
}

/** 마지막으로 본 우편함 스크립트 판 */
const RELAY_VER_KEY = 'relay_ver'
const seenVer = (): number => Number(db.getSetting(RELAY_VER_KEY, '0')) || 0
function setVer(v: number): void {
  if (v && v !== seenVer()) db.setSetting(RELAY_VER_KEY, String(v))
}
/** 이번에 켠 뒤 마지막으로 올린 판 — 같으면 다시 올리지 않는다 */
let lastBoard = ''

/** 이름표 열쇠를 새로 만들어 폰 주소가 바뀌었다는 표시 (QR 을 다시 찍으면 지운다) */
const RELAY_RESCAN_KEY = 'relay_rescan'
const rand = (n: number): Uint8Array => new Uint8Array(randomBytes(n))

/** 이름표 열쇠 — 우편함 열쇠가 있는데 없으면(3.7.0 전 설정) 만든다. 이미 이어 둔 폰은 주소가 바뀌므로 다시 찍으라고 알린다 */
function ensureNameKey(): string {
  const s = loadLocalSettings()
  if (!s.relay_key) return ''
  if (s.relay_nkey && isNameKey(s.relay_nkey)) return s.relay_nkey
  const nkey = newNameKey(rand)
  saveLocalSettings({ ...s, relay_nkey: nkey })
  if (normalizeRelayUrl(s.relay_url ?? '')) db.setSetting(RELAY_RESCAN_KEY, '1')
  lastBoard = ''
  return nkey
}

export function relayInfo(): RelayInfo {
  const nkey = ensureNameKey()
  const s = loadLocalSettings()
  const key = s.relay_key ?? ''
  const url = normalizeRelayUrl(s.relay_url ?? '')
  const connected = !!(key && url)
  return {
    hasKey: !!key,
    connected,
    url,
    phone: connected ? phoneUrl(url, key) : '',
    nkey: connected ? nkey : '',
    rescan: connected && db.getSetting(RELAY_RESCAN_KEY, '') === '1',
    script: key ? relayScript(key) : '',
    ver: connected ? seenVer() : 0,
    latest: RELAY_VERSION
  }
}

/** QR 을 다시 찍었다(또는 주소를 복사했다) — 안내를 닫는다 */
export function relaySeenQr(): RelayInfo {
  db.setSetting(RELAY_RESCAN_KEY, '')
  return relayInfo()
}

/** 새 열쇠 — 예전 주소는 더는 쓰지 못하므로 비운다. 이름표 열쇠도 새로 */
export function relayNewKey(): RelayInfo {
  const s = loadLocalSettings()
  saveLocalSettings({ ...s, relay_key: newRelayKey(rand), relay_nkey: newNameKey(rand), relay_url: '' })
  db.setSetting(RELAY_VER_KEY, '0')
  db.setSetting(RELAY_RESCAN_KEY, '')
  lastBoard = ''
  return relayInfo()
}

export function relayDisconnect(): RelayInfo {
  const s = loadLocalSettings()
  saveLocalSettings({ ...s, relay_key: '', relay_nkey: '', relay_url: '' })
  db.setSetting(RELAY_VER_KEY, '0')
  db.setSetting(RELAY_RESCAN_KEY, '')
  lastBoard = ''
  return relayInfo()
}

async function call(url: string, params: Record<string, string>): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await httpFetch(`${url}?${new URLSearchParams(params).toString()}`, { signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      // 주소가 맞지 않거나 배포가 '모든 사용자' 가 아니면 HTML(로그인 화면 등)이 온다
      throw new Error(/주소가 맞지 않습니다/.test(text) ? '열쇠가 맞지 않습니다. 코드를 다시 붙여 넣고 새로 배포해 주세요.' : '웹 앱이 답하지 않습니다. 배포할 때 [액세스 권한: 모든 사용자] 로 했는지 확인해 주세요.')
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function relayConnect(rawUrl: string): Promise<{ ok: boolean; error?: string; info?: RelayInfo }> {
  const url = normalizeRelayUrl(rawUrl)
  if (!url) return { ok: false, error: '웹 앱 주소 모양이 아닙니다. https://script.google.com/macros/s/…/exec 를 붙여 넣어 주세요.' }
  // 이름표 열쇠는 잇기 전에 만들어 둔다 — 이은 뒤 만들면 '주소가 바뀜' 안내가 뜬다
  ensureNameKey()
  const s = loadLocalSettings()
  if (!s.relay_key) return { ok: false, error: '먼저 [코드 만들기] 를 눌러 주세요.' }
  try {
    const v = (await call(url, { k: s.relay_key, op: 'ping' })) as { ok?: boolean }
    if (v?.ok !== true) return { ok: false, error: '웹 앱이 알 수 없는 답을 보냈습니다.' }
    db.setSetting(RELAY_VER_KEY, String(versionOf(v)))
    lastBoard = ''
  } catch (e) {
    return { ok: false, error: (e as Error).message === 'This operation was aborted' ? '웹 앱이 답하지 않습니다(시간 넘김).' : (e as Error).message }
  }
  saveLocalSettings({ ...s, relay_url: url })
  return { ok: true, info: relayInfo() }
}

let pulling = false

export interface PullResult {
  ok: boolean
  /** 받은 글함에 넣은 글 */
  added: number
  /** 세특 관찰 기록에 붙인 것 · 출결 기록에 넣거나 지운 것 */
  obs?: number
  att?: number
  error?: string
}

/** 이미 넣은 우편 id (마지막 500개) */
const RELAY_SEEN_KEY = 'relay_seen'
function readSeen(): string[] {
  try {
    const v = JSON.parse(db.getSetting(RELAY_SEEN_KEY, '[]')) as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** 글 하나를 조각으로 나눠 op=put 으로 올린다 (속성 하나 9KB 한도) */
async function putParts(url: string, key: string, name: 'board' | 'names', text: string): Promise<boolean> {
  const parts = splitParts(text)
  for (let i = 0; i < parts.length; i++) {
    const r = (await call(url, { k: key, op: 'put', name, i: String(i), n: String(parts.length), b: parts[i] })) as { ok?: boolean }
    if (r?.ok !== true) return false
  }
  return true
}

/**
 * 폰 판 · 이름표를 올린다 — 스크립트가 2판 이상이고, 지난번과 달라졌을 때만.
 * 판에는 이름이 없고, 이름표는 이 PC 에서 잠근 글만 간다(열쇠는 폰 주소의 # 뒤).
 */
async function pushBoard(url: string, key: string): Promise<void> {
  if (seenVer() < 2) return
  const nkey = ensureNameKey()
  if (!nkey) return
  const { board, names } = phoneBoard()
  const b = JSON.stringify(board)
  const n = JSON.stringify(names)
  const sig = JSON.stringify([b, n, nkey])
  if (sig === lastBoard) return
  if (!(await putParts(url, key, 'board', b))) return
  if (!(await putParts(url, key, 'names', sealNames(n, nkey)))) return
  lastBoard = sig
}

/**
 * 폰에서 온 것을 가져와 제자리에 넣고, 우편함에서는 지운다.
 * 글 → 받은 글함, 수업 관찰 → 세특 관찰 기록, 출결 → 출결 기록. 넣은 뒤에만 지운다.
 */
/**
 * 구글 설문지 응답 시트에서 after 보다 뒤의 응답만 받는다 (스크립트 v3, 3.7.1~).
 * 시트 주소만 보내고 PC 의 명단 · 글은 보내지 않는다. 300행이 넘으면 이어서 다섯 번까지 더 받는다.
 */
export async function relayForm(sheetUrl: string, after: number): Promise<{ ok: boolean; error?: string; needVer?: number; data?: FormPull }> {
  const s = loadLocalSettings()
  const url = normalizeRelayUrl(s.relay_url ?? '')
  if (!url || !s.relay_key) return { ok: false, error: '먼저 폰 연결(우편함)을 이어 주세요.', needVer: RELAY_NEEDS.form }
  const id = sheetIdOf(sheetUrl)
  if (!id) return { ok: false, error: '응답 시트 주소 모양이 아닙니다. 설문지 [응답] 탭의 스프레드시트 아이콘으로 연 시트의 주소를 붙여 넣어 주세요.' }
  let since = Math.max(0, Math.floor(Number(after) || 0))
  let title = ''
  let head: string[] = []
  const rows: string[][] = []
  const times: number[] = []
  let last = since
  let more = false
  try {
    for (let round = 0; round < 6; round++) {
      const res = (await call(url, { k: s.relay_key, op: 'form', sheet: id, after: String(since) })) as { ok?: boolean; error?: string; v?: number }
      const v = versionOf(res)
      if (v) setVer(v)
      if (v && v < RELAY_NEEDS.form) return { ok: false, needVer: RELAY_NEEDS.form, error: `폰 연결 코드가 예전 판(v${v})입니다. 설문지를 읽으려면 새 코드(v${RELAY_NEEDS.form})로 바꿔 주세요.` }
      if (res?.ok !== true) return { ok: false, error: res?.error || '응답 시트를 읽지 못했습니다.' }
      const part = parseForm(res)
      if (!part) return { ok: false, error: '응답 시트의 답 모양이 맞지 않습니다.' }
      if (!head.length) {
        title = part.title
        head = part.head
      }
      rows.push(...part.rows)
      times.push(...part.times)
      last = Math.max(last, part.last)
      more = part.more
      if (!part.more || part.last <= since) break
      since = part.last
    }
  } catch (e) {
    const m = (e as Error).message
    // v2 스크립트는 op=form 을 모르면 폰 화면(HTML)을 돌려준다 → call 이 '웹 앱이 답하지 않습니다' 로 던진다
    if (seenVer() < RELAY_NEEDS.form) return { ok: false, needVer: RELAY_NEEDS.form, error: '폰 연결 코드를 새 판(v3)으로 바꿔야 설문지를 읽을 수 있습니다.' }
    return { ok: false, error: m === 'This operation was aborted' ? '응답 시트가 답하지 않습니다(시간 넘김).' : m }
  }
  return { ok: true, data: { title, head, rows, times, last, more } }
}

export async function relayPull(): Promise<PullResult> {
  const s = loadLocalSettings()
  const url = normalizeRelayUrl(s.relay_url ?? '')
  if (!url || !s.relay_key) return { ok: true, added: 0 }
  if (pulling) return { ok: true, added: 0 }
  pulling = true
  try {
    await pushBoard(url, s.relay_key).catch(() => undefined)
    const res = await call(url, { k: s.relay_key, op: 'pull' })
    const items = parsePull(res)
    if (!items) return { ok: false, added: 0, error: '웹 앱이 알 수 없는 답을 보냈습니다.' }
    const ver = versionOf(res)
    if (ver !== seenVer()) {
      setVer(ver)
      // 스크립트를 새 판으로 바꾼 것을 처음 알았으면 판을 바로 올린다
      await pushBoard(url, s.relay_key).catch(() => undefined)
    }
    if (!items.length) return { ok: true, added: 0, obs: 0, att: 0 }
    // 지우기(ack)가 실패해 같은 것이 다시 와도 두 번 넣지 않는다
    const seen = readSeen()
    const routed = routeRelay(items.filter((x) => !seen.includes(x.id)))
    db.setSetting(RELAY_SEEN_KEY, JSON.stringify([...seen, ...items.map((x) => x.id)].slice(-500)))
    const have = inboxList()
    const fresh = routed.inbox.filter((x) => !have.some((h) => h.id === x.id)).map((x) => ({ id: x.id, t: x.t, text: x.text }))
    if (fresh.length) inboxSave([...have, ...fresh])
    await call(url, { k: s.relay_key, op: 'ack', ids: items.map((x) => x.id).join(',') }).catch(() => undefined)
    if (fresh.length) notify()
    if (routed.obs || routed.att) {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('phone:routed', { obs: routed.obs, att: routed.att, acts: routed.acts })
    }
    return { ok: true, added: fresh.length, obs: routed.obs, att: routed.att }
  } catch (e) {
    return { ok: false, added: 0, error: (e as Error).message }
  } finally {
    pulling = false
  }
}

let timer: NodeJS.Timeout | null = null

/** 이어 두었으면 3분마다 가져온다 (창이 떠 있는 동안) */
export function startRelayWatch(): void {
  if (timer) return
  setTimeout(() => void relayPull(), 20000)
  timer = setInterval(() => void relayPull(), 3 * 60 * 1000)
}

export function stopRelayWatch(): void {
  if (timer) clearInterval(timer)
  timer = null
}
