/**
 * 업무 도우미 대화 보관 — 이 PC 의 자료 폴더 chats/ 에 대화마다 파일 하나(<번호>.json).
 * DB 에 넣지 않는다: 인수인계 파일(DB 를 그대로 내보냄)에 대화가 섞이지 않게, 그리고 대화가 길어도
 * DB 전체를 다시 쓰지 않게. 지침 모음은 chats/presets.json.
 */

import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ChatAttachment, ChatMeta, ChatMode, ChatPreset, ChatRecord } from '../../shared/chat'
import { isChatId } from '../../shared/chat'

/** 대화 하나의 파일 크기 상한 — 올린 파일의 글이 쌓여도 이만큼까지 */
const MAX_RECORD = 20 * 1024 * 1024

function dir(): string {
  const d = path.join(app.getPath('userData'), 'chats')
  fs.mkdirSync(d, { recursive: true })
  return d
}

const fileOf = (id: string): string => path.join(dir(), `${id}.json`)

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, file)
}

const str = (v: unknown, max = 100000): string => (typeof v === 'string' ? v.slice(0, max) : '')
const mode = (v: unknown): ChatMode => (v === 'free' ? 'free' : 'work')

function cleanAttachment(a: unknown): ChatAttachment | null {
  if (!a || typeof a !== 'object') return null
  const x = a as Record<string, unknown>
  const kind = x.kind === 'image' || x.kind === 'pdf' ? x.kind : 'text'
  return {
    kind,
    name: str(x.name, 300) || '파일',
    ...(typeof x.text === 'string' ? { text: x.text.slice(0, 200000) } : {}),
    ...(typeof x.path === 'string' ? { path: x.path.slice(0, 2000) } : {}),
    ...(typeof x.mime === 'string' ? { mime: x.mime.slice(0, 100) } : {}),
    ...(typeof x.size === 'number' ? { size: x.size } : {})
  }
}

/** 화면이 보낸 대화를 모양만 맞춰 둔다 (업무 도우미의 일감 · 카드 같은 덧붙임은 그대로) */
function cleanRecord(r: unknown): ChatRecord<Record<string, unknown>> | null {
  if (!r || typeof r !== 'object') return null
  const x = r as Record<string, unknown>
  if (!isChatId(x.id)) return null
  const now = new Date().toISOString()
  const messages = (Array.isArray(x.messages) ? x.messages : [])
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => {
      const out: Record<string, unknown> = { ...m, content: str(m.content, 400000) }
      if (Array.isArray(m.attachments)) out.attachments = m.attachments.map(cleanAttachment).filter(Boolean)
      return out
    })
  return {
    id: x.id,
    title: str(x.title, 200).trim() || '새 대화',
    mode: mode(x.mode),
    instruction: str(x.instruction, 20000),
    created: str(x.created, 40) || now,
    updated: str(x.updated, 40) || now,
    count: messages.length,
    messages
  }
}

const metaOf = (r: ChatRecord<unknown>): ChatMeta => ({
  id: r.id,
  title: r.title,
  mode: r.mode,
  instruction: r.instruction,
  created: r.created,
  updated: r.updated,
  count: r.messages.length
})

/** 목록은 처음 한 번 파일들을 읽고, 그 뒤로는 저장 · 지우기 때 고친다 */
let metas: Map<string, ChatMeta> | null = null

function loadMetas(): Map<string, ChatMeta> {
  if (metas) return metas
  metas = new Map()
  for (const f of fs.readdirSync(dir())) {
    const m = /^(.+)\.json$/.exec(f)
    if (!m || !isChatId(m[1])) continue
    try {
      const r = cleanRecord(JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8')))
      if (r) metas.set(r.id, metaOf(r))
    } catch {
      // 깨진 파일은 목록에서 뺀다 (지우지는 않는다)
    }
  }
  return metas
}

export function listChats(): ChatMeta[] {
  return [...loadMetas().values()].sort((a, b) => b.updated.localeCompare(a.updated))
}

export function getChat(id: string): ChatRecord<Record<string, unknown>> | null {
  if (!isChatId(id)) return null
  try {
    return cleanRecord(JSON.parse(fs.readFileSync(fileOf(id), 'utf8')))
  } catch {
    return null
  }
}

export function saveChat(rec: unknown): { ok: boolean; meta?: ChatMeta; error?: string } {
  const r = cleanRecord(rec)
  if (!r) return { ok: false, error: '대화를 저장하지 못했습니다(모양이 맞지 않음).' }
  const text = JSON.stringify(r)
  if (text.length > MAX_RECORD) return { ok: false, error: '대화가 너무 길어 저장하지 못했습니다. 새 대화로 이어 가 주세요.' }
  writeAtomic(fileOf(r.id), text)
  const meta = metaOf(r)
  loadMetas().set(r.id, meta)
  return { ok: true, meta }
}

export function renameChat(id: string, title: string): ChatMeta | null {
  const r = getChat(id)
  if (!r) return null
  r.title = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || r.title
  const res = saveChat(r)
  return res.meta ?? null
}

export function deleteChat(id: string): boolean {
  if (!isChatId(id)) return false
  loadMetas().delete(id)
  try {
    fs.rmSync(fileOf(id), { force: true })
    return true
  } catch {
    return false
  }
}

/* ---------- 지침 모음 ---------- */

const presetFile = (): string => path.join(dir(), 'presets.json')

export function listPresets(): ChatPreset[] {
  try {
    const raw = JSON.parse(fs.readFileSync(presetFile(), 'utf8')) as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .map((p) => ({ id: str(p.id, 60), name: str(p.name, 100).trim(), text: str(p.text, 20000) }))
      .filter((p) => /^[\w-]{4,60}$/.test(p.id) && !p.id.startsWith('builtin') && p.name && p.text.trim())
  } catch {
    return []
  }
}

export function savePresets(list: unknown): ChatPreset[] {
  const clean = (Array.isArray(list) ? list : [])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p) => ({ id: str(p.id, 60), name: str(p.name, 100).trim(), text: str(p.text, 20000) }))
    .filter((p) => /^[\w-]{4,60}$/.test(p.id) && !p.id.startsWith('builtin') && p.name && p.text.trim())
    .slice(0, 100)
  writeAtomic(presetFile(), JSON.stringify(clean))
  return clean
}
