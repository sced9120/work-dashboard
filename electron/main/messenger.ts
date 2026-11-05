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
import { newRelayKey, normalizeRelayUrl, parsePull, phoneUrl, relayScript } from '../../shared/relay'
import { ymd } from '../../shared/neis'
import { askJson } from './ai'
import { buildAliases, findNameCandidates, leakCheck, maskText, unmaskText } from './anonymize'
import * as db from './db'
import { httpFetch } from './http'
import { loadLocalSettings, saveLocalSettings } from './secrets'

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
  /** 폰에서 열 주소 (이어졌을 때만) */
  phone: string
  script: string
}

export function relayInfo(): RelayInfo {
  const s = loadLocalSettings()
  const key = s.relay_key ?? ''
  const url = normalizeRelayUrl(s.relay_url ?? '')
  return { hasKey: !!key, connected: !!(key && url), url, phone: key && url ? phoneUrl(url, key) : '', script: key ? relayScript(key) : '' }
}

/** 새 열쇠 — 예전 주소는 더는 쓰지 못하므로 비운다 */
export function relayNewKey(): RelayInfo {
  const s = loadLocalSettings()
  saveLocalSettings({ ...s, relay_key: newRelayKey((n) => new Uint8Array(randomBytes(n))), relay_url: '' })
  return relayInfo()
}

export function relayDisconnect(): RelayInfo {
  const s = loadLocalSettings()
  saveLocalSettings({ ...s, relay_key: '', relay_url: '' })
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
  const s = loadLocalSettings()
  if (!s.relay_key) return { ok: false, error: '먼저 [코드 만들기] 를 눌러 주세요.' }
  try {
    const v = (await call(url, { k: s.relay_key, op: 'ping' })) as { ok?: boolean }
    if (v?.ok !== true) return { ok: false, error: '웹 앱이 알 수 없는 답을 보냈습니다.' }
  } catch (e) {
    return { ok: false, error: (e as Error).message === 'This operation was aborted' ? '웹 앱이 답하지 않습니다(시간 넘김).' : (e as Error).message }
  }
  saveLocalSettings({ ...s, relay_url: url })
  return { ok: true, info: relayInfo() }
}

let pulling = false

/** 폰에서 온 글을 가져와 받은 글함에 넣고, 우편함에서는 지운다 */
export async function relayPull(): Promise<{ ok: boolean; added: number; error?: string }> {
  const s = loadLocalSettings()
  const url = normalizeRelayUrl(s.relay_url ?? '')
  if (!url || !s.relay_key) return { ok: true, added: 0 }
  if (pulling) return { ok: true, added: 0 }
  pulling = true
  try {
    const items = parsePull(await call(url, { k: s.relay_key, op: 'pull' }))
    if (!items) return { ok: false, added: 0, error: '웹 앱이 알 수 없는 답을 보냈습니다.' }
    if (!items.length) return { ok: true, added: 0 }
    const have = inboxList()
    const fresh = items.filter((x) => !have.some((h) => h.id === x.id))
    inboxSave([...have, ...fresh])
    // 받은 글함에 넣은 뒤에만 우편함에서 지운다
    await call(url, { k: s.relay_key, op: 'ack', ids: items.map((x) => x.id).join(',') }).catch(() => undefined)
    if (fresh.length) notify()
    return { ok: true, added: fresh.length }
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
