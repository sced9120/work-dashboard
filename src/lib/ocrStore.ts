import { useSyncExternalStore } from 'react'
import type { OcrAnswer, OcrFile, OcrProgress } from '../../shared/ocr'
import { OCR_MAX_TABS } from '../../shared/ocr'
import { answersToTables } from '../../shared/mdtable'

/**
 * 스캔 문서 → 엑셀의 탭 (최대 5개) — 화면 밖에 둔다. 다른 화면으로 가도 읽던 것은 계속 읽고, 돌아오면 그대로 있다.
 * 받은 결과는 이 프로그램이 켜져 있는 동안만 있다(파일로 저장하지 않는다). 탭을 닫으면 Gemini 에 올려 둔 파일도 지운다.
 */

export interface OcrTab {
  id: string
  files: OcrFile[]
  note: string
  /** 비어 있으면 화면이 정한 모델(권장 → 마지막에 고른 것) */
  model: string
  agree: boolean
  busy: boolean
  progress: OcrProgress | null
  started: number
  answers: OcrAnswer[]
  error: string
  showRaw: boolean
  /** 엑셀로 저장한 뒤 결과가 바뀌지 않았으면 그때 시각 */
  savedAt: number
}

interface State {
  tabs: OcrTab[]
  active: string
}

const uid = (): string => {
  try {
    return crypto.randomUUID()
  } catch {
    return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  }
}

const blank = (): OcrTab => ({
  id: uid(),
  files: [],
  note: '',
  model: '',
  agree: false,
  busy: false,
  progress: null,
  started: 0,
  answers: [],
  error: '',
  showRaw: false,
  savedAt: 0
})

const firstTab = blank()
let state: State = { tabs: [firstTab], active: firstTab.id }
const listeners = new Set<() => void>()
const set = (next: State): void => {
  state = next
  listeners.forEach((f) => f())
}

export function useOcrTabs(): State {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => state
  )
}

export const ocrState = (): State => state

export function patchTab(id: string, patch: Partial<OcrTab>): void {
  if (!state.tabs.some((t) => t.id === id)) return
  set({ ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
}

const tabOf = (id: string): OcrTab | undefined => state.tabs.find((t) => t.id === id)

/** 탭 이름 — 처음 고른 파일 이름 */
export function tabTitle(t: OcrTab, i: number): string {
  if (!t.files.length) return `새 탭 ${i + 1}`
  const n = t.files[0].name.replace(/\.[^.]+$/, '')
  return t.files.length > 1 ? `${n} 외 ${t.files.length - 1}` : n
}

/** 화면이 없는 동안 끝나면 알려 줄 곳 (App 이 단다) */
let notify: ((message: string, ok: boolean) => void) | null = null
let mounted = false
export function setOcrNotifier(fn: ((message: string, ok: boolean) => void) | null): void {
  notify = fn
}
export function setOcrMounted(on: boolean): void {
  mounted = on
}

let listening = false
/** 받는 중 소식은 처음 한 번 듣기 시작해 프로그램이 끝날 때까지 듣는다 (화면을 떠나도) */
export function initOcr(): void {
  if (listening) return
  listening = true
  window.api.ocr.onProgress((p) => {
    const { tab, ...progress } = p
    if (tabOf(tab)?.busy) patchTab(tab, { progress })
  })
}

export function newTab(): string | null {
  if (state.tabs.length >= OCR_MAX_TABS) return null
  const t = blank()
  set({ tabs: [...state.tabs, t], active: t.id })
  return t.id
}

export function setActive(id: string): void {
  if (tabOf(id)) set({ ...state, active: id })
}

/** 탭 닫기 — 읽던 것을 멈추고 Gemini 에 올려 둔 파일을 지운다. 마지막 탭이면 빈 탭으로 */
export function closeTab(id: string): void {
  const i = state.tabs.findIndex((t) => t.id === id)
  if (i < 0) return
  void window.api.ocr.clear(id)
  const tabs = state.tabs.filter((t) => t.id !== id)
  if (!tabs.length) tabs.push(blank())
  const active = state.active === id ? tabs[Math.min(i, tabs.length - 1)].id : state.active
  set({ tabs, active })
}

/** 결과가 있는데 엑셀로 저장하지 않았는지 — 닫기 전에 묻는다 */
export const unsaved = (t: OcrTab): boolean => t.answers.length > 0 && !t.savedAt

export function addFiles(id: string, files: OcrFile[]): void {
  const t = tabOf(id)
  if (!t || !files.length) return
  const seen = new Set(t.files.map((f) => `${f.name}\u0001${f.size}`))
  const add = files.filter((f) => !seen.has(`${f.name}\u0001${f.size}`))
  patchTab(id, { files: [...t.files, ...add].sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true })) })
}

const begin = (id: string): void => patchTab(id, { busy: true, progress: null, error: '', started: Date.now() })

function done(id: string, a: OcrAnswer, first: boolean): void {
  const t = tabOf(id)
  if (!t) return
  if (!a.ok) {
    patchTab(id, { busy: false, error: a.error ?? '읽지 못했습니다.' })
    if (!mounted && a.error !== '멈췄습니다.') notify?.(`스캔 문서 → 엑셀: 「${tabTitle(t, state.tabs.indexOf(t))}」 을(를) 읽지 못했습니다.`, false)
    return
  }
  const answers = first ? [a] : [...t.answers, a]
  patchTab(id, { busy: false, answers, savedAt: 0 })
  if (!mounted) {
    const rows = answersToTables(answers).reduce((n, x) => n + x.rows.length, 0)
    notify?.(`스캔 문서 → 엑셀: 「${tabTitle(t, state.tabs.indexOf(t))}」 ${a.truncated ? '— 답이 길어 끊겼습니다. 이어서 받아 주세요' : `읽기를 마쳤습니다 (${rows}행)`}.`, true)
  }
}

export async function runTab(id: string, model: string): Promise<OcrAnswer | null> {
  const t = tabOf(id)
  if (!t || t.busy) return null
  begin(id)
  patchTab(id, { answers: [], showRaw: false })
  let a: OcrAnswer
  try {
    a = await window.api.ocr.run({ tab: id, ids: t.files.map((f) => f.id), note: t.note, model })
  } catch (e) {
    a = { ok: false, text: '', finish: '', truncated: false, error: e instanceof Error ? e.message : String(e) }
  }
  done(id, a, true)
  return a
}

export async function moreTab(id: string): Promise<OcrAnswer | null> {
  const t = tabOf(id)
  if (!t || t.busy) return null
  begin(id)
  let a: OcrAnswer
  try {
    a = await window.api.ocr.continue(id)
  } catch (e) {
    a = { ok: false, text: '', finish: '', truncated: false, error: e instanceof Error ? e.message : String(e) }
  }
  done(id, a, false)
  return a
}

export function cancelTab(id: string): void {
  void window.api.ocr.cancel(id)
}
