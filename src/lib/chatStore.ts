import { useSyncExternalStore } from 'react'
import type { ChatAttachment, ChatMeta, ChatMode, ChatMsgBase, ChatPreset, ChatRecord, ChatSendTurn } from '../../shared/chat'
import { BUILTIN_PRESETS, chatTitle } from '../../shared/chat'
import type { DocRequest, PlanItem } from '../../shared/agent'
import { buildPlan, splitAnswer } from '../../shared/agent'
import type { FormRef, HwpForm, HwpKind } from '../../shared/hwpform'
import type { ModelChoice } from '../../shared/types'

/**
 * 업무 도우미 대화 — 화면 밖에 둔다. 다른 화면으로 가도 받던 답은 계속 받고, 다 받으면 그 대화에 저장된다.
 * 대화는 메인이 이 PC 의 chats/ 폴더에 대화마다 파일로 둔다(인수인계 파일에는 들어가지 않는다).
 */

/** 도우미가 내민 한글 파일 만들기 부탁과, 그것을 어느 양식으로 알아들었는지 */
export interface ChatDoc {
  req: DocRequest
  /** 찾은 양식. 양식 없이 만들거나 못 찾았으면 null */
  ref: FormRef | null
  kind: HwpKind | null
  formName: string
  /** [이 내용으로 다시 쓰기] 를 누를 때마다 늘려 확인 카드를 새로 그린다 */
  round: number
  /** 양식 없이 저장한 곳 */
  saved?: string
}

/** 화면에 그리는 한 마디. 업무 도우미 답에는 근거 · 일감 · 한글 파일 카드가 붙는다 */
export interface Msg extends ChatMsgBase {
  sources?: string[]
  /** 근거로 실은 학교업무 도움자료의 자료 폴더 */
  links?: { title: string; url: string }[]
  /** 도우미가 내민 일감. 사람이 누르기 전에는 아무 일도 일어나지 않는다. */
  plan?: PlanItem[]
  /** 어느 것을 넣을지 — 처음에는 모두 켜 둔다 */
  picked?: boolean[]
  /** 넣었는지, 안 넣기로 했는지 */
  planDone?: '넣음' | '안 함'
  planCount?: number
  /** 도우미가 내민 한글 파일 만들기 */
  doc?: ChatDoc
}

export type Rec = ChatRecord<Msg>

interface State {
  loaded: boolean
  metas: ChatMeta[]
  currentId: string
  /** 연 대화 (새 대화는 첫 마디를 보내기 전까지 여기에만 있다) */
  recs: Record<string, Rec>
  /** 받는 중인 답 — 대화 번호별 */
  live: Record<string, { reqId: string; text: string }>
  /** 이 대화에서는 묻지 않고 바로 넣기 (끄거나 새 대화면 다시 묻는다) */
  trust: Record<string, boolean>
  presets: ChatPreset[]
}

const CURRENT_KEY = 'wd_chat_current'
const MODE_KEY = 'wd_chat_mode'

const uid = (): string => {
  try {
    return crypto.randomUUID()
  } catch {
    return `c${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

const store = {
  get: (k: string): string => {
    try {
      return window.localStorage.getItem(k) || ''
    } catch {
      return ''
    }
  },
  set: (k: string, v: string): void => {
    try {
      window.localStorage.setItem(k, v)
    } catch {
      // 기억 못 해도 괜찮다
    }
  }
}

function draft(mode?: ChatMode): Rec {
  const now = new Date().toISOString()
  const m: ChatMode = mode ?? (store.get(MODE_KEY) === 'free' ? 'free' : 'work')
  return { id: uid(), title: '새 대화', mode: m, instruction: '', created: now, updated: now, count: 0, messages: [] }
}

const first = draft()
let state: State = { loaded: false, metas: [], currentId: first.id, recs: { [first.id]: first }, live: {}, trust: {}, presets: [] }
const listeners = new Set<() => void>()
const set = (patch: Partial<State>): void => {
  state = { ...state, ...patch }
  listeners.forEach((f) => f())
}

export function useChats(): State {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => state
  )
}

export const chatState = (): State => state

/** 저장된 대화인지 (새 대화는 첫 마디를 보낼 때 저장된다) */
export const isSaved = (id: string): boolean => state.metas.some((m) => m.id === id)

let started = false
/** 처음 한 번 — 목록 · 지침 모음을 읽고, 받는 중인 글을 듣기 시작한다(화면을 떠나도 계속 듣는다) */
export async function initChats(): Promise<void> {
  if (started) return
  started = true
  window.api.ai.onChatDelta((d) => {
    const entry = Object.entries(state.live).find(([, v]) => v.reqId === d.reqId)
    if (!entry) return
    set({ live: { ...state.live, [entry[0]]: { ...entry[1], text: d.text } } })
  })
  const [metas, presets] = await Promise.all([window.api.chats.list(), window.api.chats.presets().catch(() => [])])
  set({ loaded: true, metas, presets })
  const last = store.get(CURRENT_KEY)
  if (last && metas.some((m) => m.id === last)) await openChat(last)
}

function putRec(rec: Rec): void {
  set({ recs: { ...state.recs, [rec.id]: rec } })
}

async function persist(rec: Rec): Promise<string> {
  const res = await window.api.chats.save(rec)
  if (!res.ok || !res.meta) return res.error ?? '대화를 저장하지 못했습니다.'
  const meta = res.meta
  set({ metas: [meta, ...state.metas.filter((m) => m.id !== meta.id)].sort((a, b) => b.updated.localeCompare(a.updated)) })
  return ''
}

export function newChat(mode?: ChatMode): string {
  const cur = state.recs[state.currentId]
  // 아무것도 안 쓴 새 대화가 이미 열려 있으면 그것을 쓴다
  if (cur && !cur.messages.length && !isSaved(cur.id) && !state.live[cur.id]) {
    if (mode && cur.mode !== mode) putRec({ ...cur, mode })
    return cur.id
  }
  const r = draft(mode)
  set({ recs: { ...state.recs, [r.id]: r }, currentId: r.id })
  store.set(CURRENT_KEY, '')
  return r.id
}

export async function openChat(id: string): Promise<void> {
  if (!state.recs[id]) {
    const r = await window.api.chats.get(id)
    if (!r) return
    putRec(r as unknown as Rec)
  }
  set({ currentId: id })
  store.set(CURRENT_KEY, id)
}

export async function setMode(id: string, mode: ChatMode): Promise<void> {
  const r = state.recs[id]
  if (!r || r.mode === mode) return
  store.set(MODE_KEY, mode)
  const next = { ...r, mode }
  putRec(next)
  if (isSaved(id)) await persist(next)
}

let instTimer: number | undefined
export function setInstruction(id: string, instruction: string): void {
  const r = state.recs[id]
  if (!r) return
  const next = { ...r, instruction }
  putRec(next)
  window.clearTimeout(instTimer)
  if (isSaved(id)) instTimer = window.setTimeout(() => void persist(state.recs[id] ?? next), 600)
}

export async function renameChat(id: string, title: string): Promise<void> {
  const t = title.replace(/\s+/g, ' ').trim()
  if (!t) return
  const r = state.recs[id]
  if (r) putRec({ ...r, title: t })
  if (!isSaved(id)) return
  const meta = await window.api.chats.rename(id, t)
  if (meta) set({ metas: state.metas.map((m) => (m.id === id ? meta : m)) })
}

export async function removeChat(id: string): Promise<void> {
  const live = state.live[id]
  if (live) void window.api.ai.chatStop(live.reqId)
  await window.api.chats.remove(id)
  const recs = { ...state.recs }
  delete recs[id]
  set({ metas: state.metas.filter((m) => m.id !== id), recs })
  if (state.currentId === id) {
    const r = draft()
    set({ recs: { ...state.recs, [r.id]: r }, currentId: r.id })
    store.set(CURRENT_KEY, '')
  }
}

export function setTrust(id: string, on: boolean): void {
  set({ trust: { ...state.trust, [id]: on } })
}

/** 한 마디 고치기 (일감 고르기 · 한글 파일 카드) — 저장도 */
export function updateMsg(id: string, index: number, patch: Partial<Msg>): void {
  const r = state.recs[id]
  if (!r || !r.messages[index]) return
  const next = { ...r, messages: r.messages.map((m, i) => (i === index ? { ...m, ...patch } : m)) }
  putRec(next)
  if (isSaved(id)) void persist(next)
}

/** 이 대화에 올린 한글 파일 — 업무 도우미가 양식으로 쓸 수 있다 */
export function formFilesOf(rec: Rec | undefined): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = []
  for (const m of rec?.messages ?? []) {
    for (const a of m.attachments ?? []) if (a.path && /\.hwpx?$/i.test(a.name) && !out.some((f) => f.path === a.path)) out.push({ name: a.name, path: a.path })
  }
  return out
}

/* ---------- 양식 찾기 (업무 도우미의 한글 파일 만들기) ---------- */

/** 양식 이름을 비교할 때 띄어쓰기·꺾쇠·확장자는 보지 않는다 */
const formKey = (s: string): string =>
  s
    .replace(/\(이 대화에 올린 파일\)/, '')
    .replace(/\.(hwpx?)$/i, '')
    .replace(/[\s「」『』'"“”‘’]/g, '')
    .toLowerCase()

/**
 * 도우미가 적은 양식 이름을 넣어 둔 양식이나 올린 파일에서 찾는다.
 * 똑같은 이름을 먼저 보고, 없으면 한쪽이 다른 쪽을 품는 것이 하나뿐일 때만 고른다.
 */
export function findForm(name: string, forms: HwpForm[], files: { name: string; path: string }[]): { ref: FormRef; kind: HwpKind; formName: string } | null {
  const k = formKey(name)
  if (!k) return null
  const kindOfName = (n: string): HwpKind => (/\.hwpx$/i.test(n) ? 'hwpx' : 'hwp')
  const exact = forms.find((f) => formKey(f.name) === k || formKey(f.filename) === k)
  if (exact) return { ref: { id: exact.id }, kind: exact.kind, formName: exact.name }
  const file = files.find((f) => formKey(f.name) === k)
  if (file) return { ref: { path: file.path, name: file.name }, kind: kindOfName(file.name), formName: file.name }
  const near = forms.filter((f) => formKey(f.name).includes(k) || k.includes(formKey(f.name)))
  if (near.length === 1) return { ref: { id: near[0].id }, kind: near[0].kind, formName: near[0].name }
  const nearFile = files.filter((f) => formKey(f.name).includes(k) || k.includes(formKey(f.name)))
  if (nearFile.length === 1) return { ref: { path: nearFile[0].path, name: nearFile[0].name }, kind: kindOfName(nearFile[0].name), formName: nearFile[0].name }
  return null
}

/** 받는 중인 업무 도우미 답에서 일감 · 문서 묶음은 숨긴다 */
export function liveText(rec: Rec | undefined, text: string): string {
  if (rec?.mode === 'free') return text
  return splitAnswer(text).text.replace(/<<<[^\n]{0,3}$/, '')
}

/* ---------- 보내기 ---------- */

/** 보낼 대화 — 오류 · 빈 답은 빼고 */
function sendable(messages: Msg[]): ChatSendTurn[] {
  return messages
    .filter((m) => !m.error && (m.role === 'user' || m.content.trim()))
    .map((m) => ({ role: m.role, content: m.content, ...(m.attachments?.length ? { attachments: m.attachments } : {}) }))
}

export interface SendResult {
  ok: boolean
  error?: string
  /** 묻지 않고 바로 넣었으면 몇 건 */
  inserted?: { events: number; tasks: number }
}

async function ask(id: string, rec: Rec, ctx: { jobTitle: string; model: ModelChoice | null }): Promise<SendResult> {
  const reqId = uid()
  set({ live: { ...state.live, [id]: { reqId, text: '' } } })
  const files = formFilesOf(rec)
  let res
  try {
    res = await window.api.ai.chatStream({
      reqId,
      mode: rec.mode,
      jobTitle: ctx.jobTitle,
      instruction: rec.instruction,
      history: sendable(rec.messages),
      formFiles: files.map((f) => f.name),
      ...(ctx.model ? { model: ctx.model } : {})
    })
  } catch (e) {
    res = { ok: false, answer: '', sources: [], error: e instanceof Error ? e.message : String(e) }
  }
  const live = { ...state.live }
  delete live[id]
  // 받는 사이에 대화를 지웠으면 버린다
  const cur = state.recs[id]
  if (!cur) {
    set({ live })
    return { ok: false }
  }
  let reply: Msg
  if (!res.ok) {
    reply = { role: 'assistant', content: res.error ?? '답변을 만들지 못했습니다.', error: true }
  } else if (cur.mode === 'free') {
    reply = { role: 'assistant', content: res.answer || '(답을 받기 전에 멈췄습니다)', ...(res.stopped ? { stopped: true } : {}) }
  } else {
    const { text: answer, actions, doc: req } = splitAnswer(res.answer)
    const plan = res.stopped ? [] : buildPlan(actions)
    let doc: ChatDoc | undefined
    if (req && !res.stopped) {
      // 방금 넣은 양식도 찾을 수 있게 목록을 새로 읽는다
      const list = await window.api.hwp.list()
      const found = req.form ? findForm(req.form, list, files) : null
      doc = { req, ref: found?.ref ?? null, kind: found?.kind ?? null, formName: found?.formName ?? req.form, round: 0 }
    }
    reply = {
      role: 'assistant',
      content: answer || (plan.length ? '이렇게 넣을까요?' : doc ? '이렇게 만들어 볼게요.' : res.stopped ? '(답을 받기 전에 멈췄습니다)' : ''),
      sources: res.sources,
      ...(res.links?.length ? { links: res.links } : {}),
      ...(plan.length ? { plan, picked: plan.map(() => true) } : {}),
      ...(doc ? { doc } : {}),
      ...(res.stopped ? { stopped: true } : {})
    }
  }
  const next: Rec = { ...cur, messages: [...cur.messages, reply], updated: new Date().toISOString() }
  state = { ...state, live }
  putRec(next)
  const saveErr = await persist(next)
  // [이 대화에서는 묻지 않기] 를 켜 두었으면 바로 넣는다
  if (reply.plan?.length && state.trust[id]) {
    const n = await runPlan(id, next.messages.length - 1, reply.plan)
    return { ok: true, inserted: n }
  }
  if (!res.ok) return { ok: false, error: res.error }
  return saveErr ? { ok: false, error: saveErr } : { ok: true }
}

/** 질문(과 올린 파일)을 보낸다 */
export async function sendChat(id: string, text: string, attachments: ChatAttachment[], ctx: { jobTitle: string; model: ModelChoice | null }): Promise<SendResult> {
  const r = state.recs[id]
  const q = text.trim()
  if (!r || state.live[id] || (!q && !attachments.length)) return { ok: false }
  const user: Msg = { role: 'user', content: q, ...(attachments.length ? { attachments } : {}) }
  const now = new Date().toISOString()
  const next: Rec = {
    ...r,
    title: r.messages.length || r.title !== '새 대화' ? r.title : chatTitle(q, attachments.map((a) => a.name)),
    messages: [...r.messages, user],
    updated: now
  }
  putRec(next)
  store.set(CURRENT_KEY, id)
  store.set(MODE_KEY, next.mode)
  await persist(next)
  return ask(id, next, ctx)
}

/** 마지막 답을 다시 받는다 */
export async function regenerate(id: string, ctx: { jobTitle: string; model: ModelChoice | null }): Promise<SendResult> {
  const r = state.recs[id]
  if (!r || state.live[id]) return { ok: false }
  const msgs = [...r.messages]
  while (msgs.length && msgs[msgs.length - 1].role === 'assistant') msgs.pop()
  if (!msgs.length) return { ok: false }
  const next = { ...r, messages: msgs }
  putRec(next)
  return ask(id, next, ctx)
}

export function stopChat(id: string): void {
  const live = state.live[id]
  if (live) void window.api.ai.chatStop(live.reqId)
}

/**
 * 일감을 실제로 넣는다. 여기서 처음으로 자료가 바뀐다.
 * 넣을 것을 인자로 받는다 — 방금 받은 답을 곧바로 넣는 경우에 아직 담기지 않은 것을 뒤지지 않게.
 */
export async function runPlan(id: string, index: number, items: PlanItem[]): Promise<{ events: number; tasks: number }> {
  const events = items.filter((x) => x.event).map((x) => x.event!)
  const tasks = items.filter((x) => x.task).map((x) => x.task!)
  for (const e of events) await window.api.events.add(e)
  if (tasks.length) await window.api.tasks.addMany(tasks)
  updateMsg(id, index, { planDone: '넣음', planCount: items.length })
  return { events: events.length, tasks: tasks.length }
}

/* ---------- 지침 모음 ---------- */

export const allPresets = (): ChatPreset[] => [...BUILTIN_PRESETS, ...state.presets]

export async function savePreset(name: string, text: string): Promise<ChatPreset | null> {
  const n = name.trim()
  if (!n || !text.trim()) return null
  const same = state.presets.find((p) => p.name === n)
  const p: ChatPreset = { id: same?.id ?? `p-${uid().slice(0, 12)}`, name: n, text }
  const list = await window.api.chats.savePresets([...state.presets.filter((x) => x.id !== p.id), p])
  set({ presets: list })
  return list.find((x) => x.id === p.id) ?? null
}

export async function deletePreset(pid: string): Promise<void> {
  const list = await window.api.chats.savePresets(state.presets.filter((x) => x.id !== pid))
  set({ presets: list })
}
