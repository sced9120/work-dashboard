import { useSyncExternalStore } from 'react'
import type { TaskDraft } from '../../shared/types'

/**
 * 학습이 어디까지 갔는지를 화면 밖에 둔다.
 *
 * 예전에는 [문서로 업무 만들기] 화면이 진행 상태와 찾아낸 업무를 자기 안에
 * 들고 있었다. 그래서 학습을 걸어 두고 다른 화면으로 넘어가면
 *  - 어디까지 갔는지 볼 수 없고
 *  - 돌아왔을 때 찾아낸 것이 통째로 사라졌다
 * (분석은 계속 돌지만 결과를 받을 곳이 없어졌기 때문이다.)
 *
 * 그래서 React 바깥의 한 곳에 담아 두고, 화면들은 여기를 들여다보게 했다.
 * 프로그램을 끄지 않는 한 어느 화면에 있든 진행 표시가 따라다닌다.
 */

export interface LearnJob {
  running: boolean
  /** 무엇을 돌리는 중인지 — 위쪽 띠에 보여 준다 */
  label: string
  /** 전체 건수와 끝낸 건수 */
  total: number
  done: number
  /** 지금 다루고 있는 파일 */
  now: string
  /** 메인에서 올려 주는 잔 진행 메시지 */
  message: string
  /** 지금까지 찾아낸 업무 후보 */
  drafts: TaskDraft[]
  /** 실패한 것들 */
  failed: string[]
  /** 멈추기를 눌렀는가 */
  stopping: boolean
  /** 끝난 뒤 결과를 어디서 봐야 하는지 알려 주려고 */
  finishedAt: number
}

const EMPTY: LearnJob = {
  running: false,
  label: '',
  total: 0,
  done: 0,
  now: '',
  message: '',
  drafts: [],
  failed: [],
  stopping: false,
  finishedAt: 0
}

let state: LearnJob = EMPTY
const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of listeners) fn()
}

function set(patch: Partial<LearnJob>): void {
  state = { ...state, ...patch }
  emit()
}

export function getJob(): LearnJob {
  return state
}

/** 화면이 이 값을 따라 그리게 한다 */
export function useLearnJob(): LearnJob {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getJob,
    getJob
  )
}

/** 학습을 시작한다. 앞서 찾아 둔 것은 지우지 않고 이어 담는다. */
export function startJob(label: string, total: number): void {
  set({ running: true, label, total, done: 0, now: '', message: '', failed: [], stopping: false })
}

export function setProgress(patch: { done?: number; now?: string; message?: string }): void {
  set(patch)
}

/** 한 건이 끝날 때마다 찾은 것을 바로 담는다. 도중에 화면을 옮겨도 남는다. */
export function addDrafts(drafts: TaskDraft[]): void {
  if (!drafts.length) return
  set({ drafts: [...state.drafts, ...drafts] })
}

export function addFailure(line: string): void {
  set({ failed: [...state.failed, line] })
}

export function finishJob(): void {
  set({ running: false, now: '', message: '', stopping: false, finishedAt: Date.now() })
}

/** [멈추기] — 돌고 있는 쪽이 다음 건으로 넘어가기 전에 이 값을 본다 */
export function requestStop(): void {
  if (state.running) set({ stopping: true })
}

export function isStopping(): boolean {
  return state.stopping
}

/** 검토 목록에서 손댈 때 */
export function setDrafts(drafts: TaskDraft[]): void {
  set({ drafts })
}

export function clearDrafts(): void {
  set({ drafts: [], failed: [], finishedAt: 0 })
}
