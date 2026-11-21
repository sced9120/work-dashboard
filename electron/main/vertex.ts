import crypto from 'node:crypto'
import fs from 'node:fs'
import { dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import type { LocalSettings } from '../../shared/types'
import { geminiModeOf, geminiUrl, vertexLocationOf } from '../../shared/gemini'
import type { GeminiModeName } from '../../shared/gemini'
import { httpFetch } from './http'
import { loadLocalSettings, saveLocalSettings } from './secrets'

/**
 * Gemini 를 Google Cloud(Vertex AI)로 쓰는 연결.
 * - 서비스 계정 JSON → JWT(RS256) → OAuth 접근 토큰 → Authorization: Bearer
 * - Express 키 → x-goog-api-key
 * 서비스 계정의 비밀 키는 이 파일(메인 프로세스) 안에서만 쓰고, 화면으로 보내지 않는다.
 */

const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
/** 만료 5분 전이면 새로 받는다 */
const REFRESH_MARGIN = 5 * 60 * 1000
/** 서비스 계정 JSON 은 보통 2~3KB — 이보다 크면 다른 파일이다 */
const MAX_SA_BYTES = 64 * 1024

export interface SaKey {
  client_email: string
  private_key: string
  private_key_id?: string
  project_id: string
  token_uri?: string
}

/* ---------- 서비스 계정 JSON 읽기 · 검사 ---------- */

export function parseServiceAccount(text: string): { ok: true; sa: SaKey } | { ok: false; error: string } {
  let j: Record<string, unknown>
  try {
    const v = JSON.parse(text.replace(/^﻿/, '')) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not object')
    j = v as Record<string, unknown>
  } catch {
    return { ok: false, error: '서비스 계정 JSON 파일이 아닙니다(JSON 으로 읽을 수 없습니다).' }
  }
  const str = (k: string): string => (typeof j[k] === 'string' ? (j[k] as string).trim() : '')
  if (j.type !== 'service_account') return { ok: false, error: '서비스 계정 JSON 이 아닙니다(type 이 service_account 가 아님).' }
  if (!str('client_email')) return { ok: false, error: '서비스 계정 이메일(client_email)이 없습니다.' }
  const key = typeof j.private_key === 'string' ? j.private_key : ''
  if (!key.includes('BEGIN PRIVATE KEY')) return { ok: false, error: '개인 키(private_key)가 없습니다.' }
  try {
    crypto.createPrivateKey(key)
  } catch {
    return { ok: false, error: '개인 키(private_key)를 읽을 수 없습니다. 파일이 망가졌거나 잘렸습니다.' }
  }
  if (!str('project_id')) return { ok: false, error: '프로젝트 ID(project_id)가 없습니다.' }
  // 토큰 주소는 구글 것만 받는다 (엉뚱한 곳으로 서명한 자격 증명을 보내지 않도록)
  let tokenUri = DEFAULT_TOKEN_URI
  const tu = str('token_uri')
  if (tu) {
    try {
      const u = new URL(tu)
      if (u.protocol === 'https:' && (u.hostname === 'oauth2.googleapis.com' || u.hostname === 'accounts.google.com' || u.hostname.endsWith('.googleapis.com'))) tokenUri = tu
    } catch {
      /* 기본 주소를 쓴다 */
    }
  }
  return {
    ok: true,
    sa: {
      client_email: str('client_email'),
      private_key: key,
      ...(str('private_key_id') ? { private_key_id: str('private_key_id') } : {}),
      project_id: str('project_id'),
      token_uri: tokenUri
    }
  }
}

/** 파일 고르기 — 파일은 읽기만 하고 경로를 기억하거나 복사하지 않는다 */
export async function pickServiceAccount(win: BrowserWindow | null): Promise<{ ok: boolean; canceled?: boolean; error?: string; project?: string; email?: string }> {
  const opts = { title: '서비스 계정 JSON 고르기', properties: ['openFile' as const], filters: [{ name: '서비스 계정 JSON', extensions: ['json'] }] }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (res.canceled || !res.filePaths?.[0]) return { ok: false, canceled: true }
  let text: string
  try {
    const p = res.filePaths[0]
    if (fs.statSync(p).size > MAX_SA_BYTES) return { ok: false, error: '서비스 계정 JSON 이 아닙니다(파일이 너무 큽니다).' }
    text = fs.readFileSync(p, 'utf-8')
  } catch {
    return { ok: false, error: '파일을 읽지 못했습니다. 다른 파일을 골라 주세요.' }
  }
  const r = parseServiceAccount(text)
  if (!r.ok) return { ok: false, error: r.error }
  const cur = loadLocalSettings()
  const stored = JSON.stringify({
    client_email: r.sa.client_email,
    private_key: r.sa.private_key,
    private_key_id: r.sa.private_key_id ?? '',
    project_id: r.sa.project_id,
    token_uri: r.sa.token_uri
  })
  const project = (cur.vertex_project ?? '').trim() || r.sa.project_id
  saveLocalSettings({ ...cur, vertex_sa: stored, vertex_email: r.sa.client_email, vertex_project: project })
  dropVertexToken()
  return { ok: true, project, email: r.sa.client_email }
}

export function clearServiceAccount(): { ok: boolean } {
  const cur = loadLocalSettings()
  saveLocalSettings({ ...cur, vertex_sa: '', vertex_email: '' })
  dropVertexToken()
  return { ok: true }
}

/* ---------- 접근 토큰 ---------- */

interface Cached {
  id: string
  token: string
  exp: number
}
let cache: Cached | null = null
let inflight: { id: string; p: Promise<string> } | null = null

/** 서비스 계정이 바뀌거나 빠지면 받아 둔 토큰을 버린다 */
export function dropVertexToken(): void {
  cache = null
  inflight = null
}

const b64url = (b: Buffer | string): string => Buffer.from(b).toString('base64url')

function saOf(settings: LocalSettings): SaKey {
  try {
    const sa = JSON.parse(settings.vertex_sa || '') as SaKey
    if (sa?.client_email && sa.private_key) return sa
  } catch {
    /* 아래 오류로 */
  }
  throw new Error('Vertex AI 서비스 계정이 없습니다. 설정 → AI 연결에서 서비스 계정 JSON 을 골라 주세요.')
}

/** 서비스 계정으로 서명한 JWT (RS256) */
export function buildJwt(sa: SaKey, now = Math.floor(Date.now() / 1000)): string {
  const header = { alg: 'RS256', typ: 'JWT', ...(sa.private_key_id ? { kid: sa.private_key_id } : {}) }
  const claims = { iss: sa.client_email, scope: SCOPE, aud: sa.token_uri || DEFAULT_TOKEN_URI, iat: now, exp: now + 3600 }
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`
  const sig = crypto.createSign('RSA-SHA256').update(input).sign(sa.private_key)
  return `${input}.${b64url(sig)}`
}

async function fetchToken(sa: SaKey): Promise<{ token: string; exp: number }> {
  let jwt: string
  try {
    jwt = buildJwt(sa)
  } catch {
    throw new Error('Vertex AI 서비스 계정의 개인 키를 읽지 못했습니다. 설정에서 서비스 계정 JSON 을 다시 골라 주세요.')
  }
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString()
  const res = await httpFetch(sa.token_uri || DEFAULT_TOKEN_URI, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  const txt = await res.text().catch(() => '')
  if (!res.ok) {
    if (res.status === 400 || res.status === 401 || /invalid_grant/.test(txt)) throw new Error(vertexErrorText('vertex', 401, txt) ?? 'Vertex AI 인증에 실패했습니다.')
    throw new Error(`Vertex AI 인증 서버 오류 (${res.status}) ${txt.slice(0, 200)}`)
  }
  let d: { access_token?: string; expires_in?: number } = {}
  try {
    d = JSON.parse(txt)
  } catch {
    /* 아래에서 처리 */
  }
  if (!d.access_token) throw new Error('Vertex AI 인증 서버가 접근 토큰을 주지 않았습니다.')
  return { token: d.access_token, exp: Date.now() + (Number(d.expires_in) > 0 ? Number(d.expires_in) : 3600) * 1000 }
}

/** 접근 토큰 — 받아 둔 것이 있으면 그대로(만료 5분 전까지). 동시에 불러도 요청은 한 번만 */
export async function vertexToken(settings: LocalSettings, force = false): Promise<string> {
  const sa = saOf(settings)
  const id = `${sa.client_email}|${sa.private_key_id ?? ''}|${sa.token_uri ?? ''}`
  if (!force && cache && cache.id === id && Date.now() < cache.exp - REFRESH_MARGIN) return cache.token
  if (inflight && inflight.id === id) return inflight.p
  const p = fetchToken(sa)
    .then((t) => {
      cache = { id, token: t.token, exp: t.exp }
      return t.token
    })
    .finally(() => {
      if (inflight?.p === p) inflight = null
    })
  inflight = { id, p }
  return p
}

/* ---------- 주소 · 머리글 ---------- */

/** Gemini 를 쓸 수 있는 자격이 있으면 비어 있지 않은 문자열(API 키 · 'vertex' · Express 키), 없으면 '' */
export function geminiCredential(s: LocalSettings): string {
  const mode = geminiModeOf(s)
  if (mode === 'vertex') return (s.vertex_sa ?? '').trim() && (s.vertex_project ?? '').trim() ? 'vertex' : ''
  if (mode === 'express') return (s.vertex_express_key ?? '').trim()
  return (s.gemini_key ?? '').trim()
}

/** 자격이 없을 때 보여 줄 말 */
export function geminiMissingText(s: LocalSettings): string {
  const mode = geminiModeOf(s)
  if (mode === 'vertex') return 'Gemini(Vertex AI) 연결이 끝나지 않았습니다. 설정 → AI 연결에서 서비스 계정 JSON 과 프로젝트 ID 를 확인해 주세요.'
  if (mode === 'express') return 'Gemini(Vertex AI Express) 키가 설정되지 않았습니다. 설정 → AI 연결에서 Express 키를 넣어 주세요.'
  return 'Gemini API 키가 설정되지 않았습니다.'
}

export async function geminiTarget(
  settings: LocalSettings,
  model: string,
  method: 'generateContent' | 'streamGenerateContent',
  forceRefresh = false
): Promise<{ url: string; headers: Record<string, string> }> {
  const mode = geminiModeOf(settings)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (mode === 'vertex') {
    const project = (settings.vertex_project ?? '').trim()
    if (!project) throw new Error('Vertex AI 프로젝트 ID 가 비어 있습니다. 설정 → AI 연결에서 프로젝트 ID 를 넣어 주세요.')
    headers.Authorization = `Bearer ${await vertexToken(settings, forceRefresh)}`
    return { url: geminiUrl(mode, { project, location: vertexLocationOf(settings.vertex_location) }, model, method), headers }
  }
  if (mode === 'express') {
    // 미확인: Express 모드 주소와 x-goog-api-key 머리글은 문서를 보고 적었을 뿐 실제 키로 확인하지 못했다
    headers['x-goog-api-key'] = (settings.vertex_express_key ?? '').trim()
    return { url: geminiUrl(mode, {}, model, method), headers }
  }
  headers['x-goog-api-key'] = (settings.gemini_key ?? '').trim()
  return { url: geminiUrl(mode, {}, model, method), headers }
}

/** 잠깐 쉬었다 다시 해 볼 만한 상태 — 호출 한도(429) · 일시적 과부하(503). 3.7.11~ */
const RETRY_STATUS = new Set([429, 503])
const RETRY_TIMES = 2

/** 서버가 알려 준 대기(retry-after) 를 따르고, 없으면 2초 → 5초. 0.3초 안쪽으로 흩어 같은 때 몰리지 않게 한다 */
export function retryWaitMs(res: Pick<Response, 'headers'>, attempt: number): number {
  const ms = Number(res.headers.get('retry-after-ms'))
  const s = Number(res.headers.get('retry-after'))
  const base = ms > 0 ? ms : s > 0 ? s * 1000 : attempt === 0 ? 2000 : 5000
  return Math.min(base, 8000) + Math.floor(Math.random() * 300)
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('요청을 멈췄습니다.'))
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      reject(new Error('요청을 멈췄습니다.'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Gemini 로 POST — 연결 방식에 맞는 주소 · 머리글로. Vertex 가 401 이면 토큰을 새로 받아 한 번만 다시, 429 · 503 이면 쉬었다 두 번까지 다시 */
export async function geminiFetch(
  settings: LocalSettings,
  model: string,
  method: 'generateContent' | 'streamGenerateContent',
  body: string,
  signal?: AbortSignal
): Promise<Response> {
  const go = async (force: boolean): Promise<Response> => {
    const t = await geminiTarget(settings, model, method, force)
    return httpFetch(t.url, { method: 'POST', headers: t.headers, body, ...(signal ? { signal } : {}) })
  }
  let res = await go(false)
  if (res.status === 401 && geminiModeOf(settings) === 'vertex') {
    await res.text().catch(() => '')
    res = await go(true)
  }
  for (let k = 0; k < RETRY_TIMES && RETRY_STATUS.has(res.status); k++) {
    const wait = retryWaitMs(res, k)
    await res.text().catch(() => '')
    await sleepAbortable(wait, signal)
    res = await go(false)
  }
  return res
}

/* ---------- 오류 말 ---------- */

/** 구글 오류 본문(JSON)의 message 를 한 줄 160자 안으로. 읽을 수 없으면 '' */
export function googleReason(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: { message?: unknown } } | { error?: { message?: unknown } }[]
    const m = (Array.isArray(j) ? j[0] : j)?.error?.message
    return typeof m === 'string' ? m.replace(/\s+/g, ' ').trim().slice(0, 160) : ''
  } catch {
    return ''
  }
}

/** Vertex · Express 의 HTTP 오류를 한국어로. 이 연결 방식이 아니거나 따로 풀어 줄 말이 없으면 null */
export function vertexErrorText(mode: GeminiModeName, status: number, text: string): string | null {
  if (mode === 'key') return null
  const label = mode === 'express' ? 'Vertex AI Express' : 'Vertex AI'
  const t = text ?? ''
  if (status === 403 && /SERVICE_DISABLED|has not been used in project|API has not been enabled/i.test(t)) {
    return `${label} 오류: Cloud 프로젝트에서 Vertex AI API(aiplatform.googleapis.com)를 사용 설정해 주세요.`
  }
  if (mode === 'express' && (status === 401 || status === 403)) {
    return 'Vertex AI Express 키가 올바르지 않거나 이 키로는 쓸 수 없습니다. 설정에서 키를 다시 확인해 주세요.'
  }
  if (status === 401 || /invalid_grant/.test(t)) {
    return `${label} 오류: 서비스 계정 키가 만료 · 삭제되었거나 PC 시계가 맞지 않습니다. 설정에서 서비스 계정 JSON 을 다시 고르고, PC 시간을 확인해 주세요.`
  }
  if (status === 403) return `${label} 오류: 이 서비스 계정에 Vertex AI 사용자 역할(roles/aiplatform.user)이 있는지 확인해 주세요.`
  if (status === 404) return `${label} 오류: 이 모델이 고른 위치(global/리전)에서 지원되는지 확인해 주세요. (${t.slice(0, 200)})`
  if (status === 429 || /RESOURCE_EXHAUSTED/.test(t)) {
    // 구글이 알려 준 까닭을 짧게 붙인다 — '프로젝트 할당량'인지 '서버가 붐벼서(동적 공유)'인지 가리는 단서 (3.7.11~)
    const why = googleReason(t)
    return `${label} 오류: 할당량 초과 — 잠시 후 다시 시도해 주세요.${why ? ` (구글 응답: ${why})` : ''}`
  }
  return null
}
