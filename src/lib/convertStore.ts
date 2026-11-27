import { useSyncExternalStore } from 'react'
import type { ConvFile, ConvList, ConvMerge, ConvOptions, ConvResult } from '../../shared/convert'
import { CONV_MAX_FILES } from '../../shared/convert'

/**
 * PDF 변환의 상태 — 화면 밖에 둔다. 다른 화면으로 가도 바꾸던 것은 계속 하고, 돌아오면 그대로 있다.
 * 고른 방식(합치기 · 엑셀 맞춤)은 이 PC 에 기억한다.
 */

export type ConvStatus = 'idle' | 'waiting' | 'working' | 'done' | 'error'

export interface ConvState {
  files: ConvFile[]
  /** 형식 때문에 뺀 파일 이름 */
  skipped: string[]
  rows: Record<string, { status: ConvStatus; error?: string }>
  options: ConvOptions
  busy: boolean
  job: string
  result: ConvResult | null
}

const OPT_KEY = 'wd_convert_options'

function loadOptions(): ConvOptions {
  try {
    const v = JSON.parse(window.localStorage.getItem(OPT_KEY) || 'null') as Partial<ConvOptions> | null
    const merge: ConvMerge = v?.merge === 'student' || v?.merge === 'all' ? v.merge : 'none'
    return { merge, excelFit: v?.excelFit !== false }
  } catch {
    return { merge: 'none', excelFit: true }
  }
}

let state: ConvState = { files: [], skipped: [], rows: {}, options: loadOptions(), busy: false, job: '', result: null }
const listeners = new Set<() => void>()
const set = (patch: Partial<ConvState>): void => {
  state = { ...state, ...patch }
  listeners.forEach((f) => f())
}

export function useConvert(): ConvState {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => state
  )
}

export function setConvOptions(patch: Partial<ConvOptions>): void {
  const options = { ...state.options, ...patch }
  set({ options })
  try {
    window.localStorage.setItem(OPT_KEY, JSON.stringify(options))
  } catch {
    // 이번에만
  }
}

/** 고른 것을 목록 뒤에 더한다. 방금 끝낸 목록이 있으면 비우고 새로 담는다 */
export function addList(list: ConvList): void {
  if (state.busy) return
  const old = state.result ? [] : state.files
  // 같은 파일을 두 번 담지 않는다 (메인이 같은 경로에는 같은 번호를 준다)
  const have = new Set(old.map((f) => f.id))
  const files = [...old, ...list.files.filter((f) => !have.has(f.id))].slice(0, CONV_MAX_FILES)
  set({ files, skipped: [...(state.result ? [] : state.skipped), ...list.skipped], rows: state.result ? {} : state.rows, result: null })
}

export function removeFile(id: string): void {
  if (!state.busy) set({ files: state.files.filter((f) => f.id !== id), result: null })
}

export function clearFiles(): void {
  if (!state.busy) set({ files: [], skipped: [], rows: {}, result: null })
}

/** 화면이 없는 동안 끝나면 알려 줄 곳 (App 이 단다) */
let notify: ((message: string, ok: boolean) => void) | null = null
let mounted = false
export const setConvertNotifier = (fn: typeof notify): void => {
  notify = fn
}
export const setConvertMounted = (on: boolean): void => {
  mounted = on
}

let listening = false
function listen(): void {
  if (listening) return
  listening = true
  window.api.convert.onProgress((p) => {
    if (p.job !== state.job) return
    set({ rows: { ...state.rows, [p.id]: { status: p.status, error: p.error } } })
  })
}

export async function runConvert(): Promise<void> {
  if (state.busy || !state.files.length) return
  listen()
  const job = crypto.randomUUID()
  set({ job, busy: true, result: null, rows: Object.fromEntries(state.files.map((f) => [f.id, { status: 'waiting' as const }])) })
  let result: ConvResult
  try {
    result = await window.api.convert.run({ job, ids: state.files.map((f) => f.id), options: state.options })
  } catch (e) {
    result = { ok: false, folder: '', made: 0, failed: 0, notes: [], error: e instanceof Error ? e.message : String(e) }
  }
  // 멈춰서 하지 못한 파일은 처음 상태로
  const rows = Object.fromEntries(
    Object.entries(state.rows).map(([id, r]) => [id, r.status === 'waiting' || r.status === 'working' ? { status: 'idle' as const } : r])
  )
  set({ busy: false, rows, result })
  if (!mounted && !result.canceled) {
    notify?.(result.ok ? `PDF 변환을 마쳤습니다. ${result.made}개를 만들었습니다${result.failed ? ` (바꾸지 못한 파일 ${result.failed}개)` : ''}.` : `PDF 변환: ${result.error ?? '만들지 못했습니다.'}`, result.ok && !result.failed)
  }
}

export function cancelConvert(): void {
  if (state.job) void window.api.convert.cancel(state.job)
}
