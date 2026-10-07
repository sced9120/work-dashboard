import { useSyncExternalStore } from 'react'

/**
 * 화면 테마 (모양 · 밝기 · 왼쪽 메뉴 접기).
 *
 * PC마다, 쓰는 사람마다 따로 고르는 것이라 DB 설정(인수인계 파일로 넘어감)이 아니라
 * 이 창의 localStorage 에 둔다. 시작할 때 IPC 를 기다리지 않고 바로 읽을 수 있어서
 * 첫 화면부터 고른 모양으로 그린다 — 설정 파일에서 읽으면 한 번 파랗게 깜빡인다.
 */

export type ThemeId = 'classic' | 'bento' | 'glass'
export type ModePref = 'system' | 'light' | 'dark'

export interface UiPrefs {
  theme: ThemeId
  mode: ModePref
  /** 왼쪽 메뉴를 아이콘만 남기고 접어 둔다 */
  navCollapsed: boolean
}

export const THEMES: { id: ThemeId; name: string; desc: string }[] = [
  { id: 'bento', name: '회색 벤토', desc: '회색 타일을 촘촘히 붙인 모양. 강조할 것은 바탕과 반대 밝기로' },
  { id: 'glass', name: '글래스', desc: '뿌연 유리 카드에 남보라 · 민트 포인트' },
  { id: 'classic', name: '기본', desc: '지금까지 쓰던 파란 강조색 모양' }
]

export const MODES: { id: ModePref; label: string }[] = [
  { id: 'system', label: '윈도우 설정 따르기' },
  { id: 'light', label: '밝게' },
  { id: 'dark', label: '어둡게' }
]

const KEY = 'wd_ui'
const DEFAULTS: UiPrefs = { theme: 'bento', mode: 'system', navCollapsed: false }

function read(): UiPrefs {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) || 'null') as Partial<UiPrefs> | null
    return {
      theme: THEMES.some((t) => t.id === v?.theme) ? (v!.theme as ThemeId) : DEFAULTS.theme,
      mode: MODES.some((m) => m.id === v?.mode) ? (v!.mode as ModePref) : DEFAULTS.mode,
      navCollapsed: typeof v?.navCollapsed === 'boolean' ? v.navCollapsed : DEFAULTS.navCollapsed
    }
  } catch {
    return { ...DEFAULTS }
  }
}

let prefs: UiPrefs = read()
const listeners = new Set<() => void>()
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

/** 지금 실제로 그리는 밝기 */
export function resolvedMode(p: UiPrefs = prefs): 'light' | 'dark' {
  if (p.mode === 'system') return darkQuery.matches ? 'dark' : 'light'
  return p.mode
}

/** <html> 에 테마를 단다. styles.css · themes.css 가 이 값을 보고 색을 고른다. */
export function applyTheme(): void {
  const root = document.documentElement
  const mode = resolvedMode()
  root.dataset.theme = prefs.theme
  root.dataset.mode = mode
  root.style.colorScheme = mode
  // 창 제목 줄 · 스크롤바도 같은 밝기로. 예전 버전 preload 에는 없으므로 없으면 넘어간다.
  void window.api?.ui?.setNativeTheme?.(prefs.mode)
}

darkQuery.addEventListener('change', () => {
  if (prefs.mode !== 'system') return
  applyTheme()
  listeners.forEach((f) => f())
})

export function getUiPrefs(): UiPrefs {
  return prefs
}

export function setUiPrefs(patch: Partial<UiPrefs>): void {
  prefs = { ...prefs, ...patch }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // 저장이 막혀도 이번 실행 동안은 고른 모양으로 보인다
  }
  applyTheme()
  listeners.forEach((f) => f())
}

function subscribe(f: () => void): () => void {
  listeners.add(f)
  return () => listeners.delete(f)
}

export function useUiPrefs(): UiPrefs {
  return useSyncExternalStore(subscribe, getUiPrefs)
}
