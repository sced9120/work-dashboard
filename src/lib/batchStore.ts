import { useSyncExternalStore } from 'react'
import type { BatchFolder, BatchOptions, BatchResult, BatchRow, BatchStudent } from '../../shared/batch'
import { BATCH_DEFAULT_OPTIONS } from '../../shared/batch'
import type { ModelChoice } from '../../shared/types'

/**
 * 폴더 일괄 분석의 상태 — 화면 밖에 둔다. 다른 화면으로 가도 읽던 것은 계속 읽고, 돌아오면 그대로 있다.
 * 결과는 프로그램이 켜져 있는 동안만 있다(엑셀 · CSV 로 저장하지 않으면 사라진다). 정리할 항목 · 세특 지침은 이 PC 에 기억한다.
 */

export type RowStatus = 'idle' | 'reading' | 'done' | 'error'

export interface StudentState {
  status: RowStatus
  result?: BatchResult
  error?: string
}

export interface BatchState {
  folder: BatchFolder | null
  /** 이번에 읽을 학생 (체크) */
  picked: Record<string, boolean>
  rows: Record<string, StudentState>
  options: BatchOptions
  agree: boolean
  busy: boolean
  job: string
  started: number
  savedAt: number
  error: string
}

const OPT_KEY = 'wd_batch_options'

function loadOptions(): BatchOptions {
  try {
    const raw = JSON.parse(window.localStorage.getItem(OPT_KEY) || 'null') as Partial<BatchOptions> | null
    if (raw && typeof raw === 'object') {
      return {
        ...BATCH_DEFAULT_OPTIONS,
        ...raw,
        items: Array.isArray(raw.items) ? raw.items.filter((x) => typeof x === 'string') : BATCH_DEFAULT_OPTIONS.items
      }
    }
  } catch {
    // 기본값으로
  }
  return BATCH_DEFAULT_OPTIONS
}

let state: BatchState = {
  folder: null,
  picked: {},
  rows: {},
  options: loadOptions(),
  agree: false,
  busy: false,
  job: '',
  started: 0,
  savedAt: 0,
  error: ''
}
const listeners = new Set<() => void>()
const set = (patch: Partial<BatchState>): void => {
  state = { ...state, ...patch }
  listeners.forEach((f) => f())
}

export function useBatch(): BatchState {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => state
  )
}

export const batchState = (): BatchState => state

export function setOptions(patch: Partial<BatchOptions>): void {
  const options = { ...state.options, ...patch }
  set({ options })
  try {
    window.localStorage.setItem(OPT_KEY, JSON.stringify(options))
  } catch {
    // 이번에만
  }
}

export const resetOptions = (): void => setOptions(BATCH_DEFAULT_OPTIONS)

export const setAgree = (agree: boolean): void => set({ agree })

export function togglePick(key: string, on?: boolean): void {
  set({ picked: { ...state.picked, [key]: on ?? !state.picked[key] } })
}

export function pickAll(on: boolean): void {
  set({ picked: Object.fromEntries((state.folder?.students ?? []).map((s) => [s.key, on])) })
}

/** 새 폴더 — 결과는 비운다 */
export function setFolder(folder: BatchFolder): void {
  if (state.busy) return
  set({ folder, picked: Object.fromEntries(folder.students.map((s) => [s.key, true])), rows: {}, savedAt: 0, error: folder.ok ? '' : folder.error ?? '' })
}

export function clearFolder(): void {
  if (!state.busy) set({ folder: null, picked: {}, rows: {}, savedAt: 0, error: '' })
}

export function patchResult(key: string, patch: Partial<BatchResult>): void {
  const r = state.rows[key]
  if (!r?.result) return
  set({ rows: { ...state.rows, [key]: { ...r, result: { ...r.result, ...patch } } }, savedAt: 0 })
}

/** 화면이 없는 동안 끝나면 알려 줄 곳 (App 이 단다) */
let notify: ((message: string, ok: boolean) => void) | null = null
let mounted = false
export const setBatchNotifier = (fn: typeof notify): void => {
  notify = fn
}
export const setBatchMounted = (on: boolean): void => {
  mounted = on
}

let listening = false
function listen(): void {
  if (listening) return
  listening = true
  window.api.batch.onProgress((p) => {
    if (p.job !== state.job) return
    set({ rows: { ...state.rows, [p.key]: { status: p.status, result: p.result, error: p.error } } })
  })
}

const uid = (): string => {
  try {
    return crypto.randomUUID()
  } catch {
    return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  }
}

/** 고른 학생(only 를 주면 그 학생들)을 읽는다 */
export async function runBatch(model: ModelChoice | null, only?: string[]): Promise<void> {
  const f = state.folder
  if (!f || state.busy) return
  listen()
  const want = new Set(only ?? f.students.filter((s) => state.picked[s.key]).map((s) => s.key))
  const students = f.students.filter((s) => want.has(s.key))
  if (!students.length) {
    set({ error: '읽을 학생을 하나 이상 골라 주세요.' })
    return
  }
  const job = uid()
  const rows = { ...state.rows }
  for (const s of students) rows[s.key] = { status: 'idle' }
  set({ job, busy: true, started: Date.now(), rows, error: '', savedAt: 0 })
  let error = ''
  try {
    const r = await window.api.batch.run({
      job,
      students: students.map((s) => ({ key: s.key, sid: s.sid, name: s.name, ids: s.files.map((x) => x.id) })),
      options: state.options,
      model
    })
    if (!r.ok) error = r.error ?? '읽지 못했습니다.'
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  // 멈춰서 시작하지 못한 학생은 처음 상태로
  const after = { ...state.rows }
  for (const s of students) if (after[s.key]?.status === 'idle' || after[s.key]?.status === 'reading') after[s.key] = { status: 'idle' }
  set({ busy: false, rows: after, error })
  if (!mounted) {
    const done = students.filter((s) => after[s.key]?.status === 'done').length
    notify?.(error ? `폴더 일괄 분석: ${error}` : `폴더 일괄 분석: ${students.length}명 가운데 ${done}명을 마쳤습니다.`, !error)
  }
}

export function cancelBatch(): void {
  if (state.job) void window.api.batch.cancel(state.job)
}

/** 저장 · 화면에 쓸 행 — 결과가 있는 학생만 (학번 차례) */
export function resultRows(students: BatchStudent[], rows: Record<string, StudentState>): (BatchRow & { key: string })[] {
  return students
    .filter((s) => rows[s.key]?.status === 'done' || rows[s.key]?.status === 'error')
    .map((s) => ({ key: s.key, sid: s.sid, name: s.name, files: s.files.map((f) => f.name), result: rows[s.key]?.result, error: rows[s.key]?.error }))
}

export const markSaved = (): void => set({ savedAt: Date.now() })
