import { useSyncExternalStore } from 'react'
import type { CatalogResult, CatalogTool } from '../../shared/catalog'
import { EMPTY_CATALOG, isNewTool } from '../../shared/catalog'
import { syncPreset } from './theme'

/**
 * 도구 모음 · 받은 테마 목록 (메인이 저장소의 remote/catalog.json 을 받아 이 PC 에 둔다).
 * 프로그램을 켤 때 한 번 받고, 도구 모음 화면을 열 때마다 3시간이 지났으면 새로 받는다.
 */

export interface CatalogState extends CatalogResult {
  loading: boolean
}

let state: CatalogState = { catalog: EMPTY_CATALOG, fetchedAt: 0, from: 'builtin', loading: false }
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((f) => f())

export async function loadCatalog(force = false): Promise<CatalogState> {
  state = { ...state, loading: true }
  emit()
  try {
    const r = await window.api.catalog.get(force)
    state = { ...r, loading: false }
    syncPreset(r)
  } catch {
    state = { ...state, loading: false, error: '도구 목록을 읽지 못했습니다.' }
  }
  emit()
  return state
}

export function useCatalog(): CatalogState {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => state
  )
}

/* ---------- 새 도구 표시 ---------- */

const SEEN_KEY = 'wd_tools_seen'

function readSeen(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(SEEN_KEY) || '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

let seen = readSeen()

/** 도구 모음 화면을 열면 지금 있는 도구는 다 본 것으로 */
export function markToolsSeen(tools: CatalogTool[]): void {
  const next = Array.from(new Set([...seen, ...tools.map((t) => t.id)])).slice(-400)
  if (next.length === seen.length) return
  seen = next
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(next))
  } catch {
    // 다음에 또 ● 이 뜰 뿐이다
  }
  // 왼쪽 메뉴의 ● 를 다시 그리게 새 묶음으로
  state = { ...state }
  emit()
}

export function todayStr(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 올린 지 30일 안이고 아직 안 본 도구가 있는지 (왼쪽 메뉴의 ●) */
export function hasUnseenNew(tools: CatalogTool[]): boolean {
  const today = todayStr()
  return tools.some((t) => isNewTool(t, today) && !seen.includes(t.id))
}
