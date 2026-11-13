import { useSyncExternalStore } from 'react'
import type { CatalogResult, CatalogTheme } from '../../shared/catalog'
import { THEME_VARS, sanitizeCatalog } from '../../shared/catalog'

/**
 * 화면 테마 (모양 · 밝기 · 왼쪽 메뉴 접기).
 *
 * PC마다, 쓰는 사람마다 따로 고르는 것이라 DB 설정(인수인계 파일로 넘어감)이 아니라
 * 이 창의 localStorage 에 둔다. 시작할 때 IPC 를 기다리지 않고 바로 읽을 수 있어서
 * 첫 화면부터 고른 모양으로 그린다 — 설정 파일에서 읽으면 한 번 파랗게 깜빡인다.
 *
 * 받은 테마(저장소의 remote/catalog.json, shared/catalog.ts)는 네 테마 가운데 하나의 모양에 색 토큰만 바꾼 것이다.
 * 글래스 · 라벤더는 3.6.2 에서 뺐다 — 골라 두었던 분은 HSOrbit 으로 옮긴다(read 가 모르는 이름은 기본값으로).
 * 고르면 그 내용을 통째로 여기 적어 두어, 다음에 켤 때 목록을 받기 전에도 바로 그 색으로 그린다.
 */

export type ThemeId = 'orbit' | 'classic' | 'bento' | 'midnight'
export type ModePref = 'system' | 'light' | 'dark'

export interface UiPrefs {
  theme: ThemeId
  mode: ModePref
  /** 왼쪽 메뉴를 아이콘만 남기고 접어 둔다 */
  navCollapsed: boolean
  /** 받은 테마 id. 빈칸이면 theme 그대로 */
  preset: string
  /** 화면 구성 — 예전 화면(왼쪽 메뉴) · 새 화면(위 탭 셋 · 만들기 · 물어보기 바, 미리 써 보기) */
  shell: ShellId
  /** 글자 크기 — 화면 전체를 이 배율로 그린다(1 = 보통) */
  fontScale: number
}

/** 고를 수 있는 글자 크기 */
export const FONT_SCALES: { value: number; label: string }[] = [
  { value: 0.9, label: '작게' },
  { value: 1, label: '보통' },
  { value: 1.1, label: '크게' },
  { value: 1.25, label: '아주 크게' }
]
const okScale = (v: unknown): number => (typeof v === 'number' && FONT_SCALES.some((f) => f.value === v) ? v : 1)

export type ShellId = 'classic' | 'new'

export const THEMES: { id: ThemeId; name: string; desc: string; prefer?: 'light' | 'dark' }[] = [
  { id: 'orbit', name: 'HSOrbit', desc: '종이 바탕 · 먹색 글 · 새벽 4시 주황 바늘. 기본 모양' },
  { id: 'bento', name: '회색 벤토', desc: '회색 타일을 촘촘히 붙인 모양. 강조할 것은 바탕과 반대 밝기로' },
  { id: 'classic', name: '기본(파랑)', desc: '예전부터 쓰던 파란 강조색 모양' },
  // 어두운 모양이 본모습이라 고르면 밝기를 어둡게로 바꾼다 (밝게로 되돌릴 수 있다)
  { id: 'midnight', name: '미드나잇', desc: '검정 바탕에 진회색 카드, 보라 · 주황 포인트. 고르면 어둡게로 바뀝니다', prefer: 'dark' }
]

export const MODES: { id: ModePref; label: string }[] = [
  { id: 'system', label: '윈도우 설정 따르기' },
  { id: 'light', label: '밝게' },
  { id: 'dark', label: '어둡게' }
]

const KEY = 'wd_ui'
const PRESET_KEY = 'wd_ui_preset'
/** 새 화면을 기본으로 한 번 바꿨는지 (3.6.4) — 그 뒤에는 고른 화면 구성을 그대로 둔다 */
const NEWSHELL_KEY = 'wd_ui_newshell'
/** 새 디자인(HSOrbit, 3.6.2)으로 한 번 바꿨는지 — 그 뒤에는 고른 테마를 그대로 둔다 */
const ORBIT_KEY = 'wd_ui_orbit'
const DEFAULTS: UiPrefs = { theme: 'orbit', mode: 'system', navCollapsed: false, preset: '', shell: 'new', fontScale: 1 }

function read(): UiPrefs {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) || 'null') as Partial<UiPrefs> | null
    return {
      theme: THEMES.some((t) => t.id === v?.theme) ? (v!.theme as ThemeId) : DEFAULTS.theme,
      mode: MODES.some((m) => m.id === v?.mode) ? (v!.mode as ModePref) : DEFAULTS.mode,
      navCollapsed: typeof v?.navCollapsed === 'boolean' ? v.navCollapsed : DEFAULTS.navCollapsed,
      preset: typeof v?.preset === 'string' ? v.preset : '',
      shell: v?.shell === 'classic' ? 'classic' : 'new',
      fontScale: okScale(v?.fontScale)
    }
  } catch {
    return { ...DEFAULTS }
  }
}

/** 고른 받은 테마 — 저장해 둔 것도 다시 걸러 쓴다 */
function readPreset(): CatalogTheme | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PRESET_KEY) || 'null') as unknown
    return raw ? (sanitizeCatalog({ themes: [raw] }).catalog.themes[0] ?? null) : null
  } catch {
    return null
  }
}

function writePreset(t: CatalogTheme | null): void {
  try {
    if (t) window.localStorage.setItem(PRESET_KEY, JSON.stringify(t))
    else window.localStorage.removeItem(PRESET_KEY)
  } catch {
    // 저장이 막혀도 이번 실행 동안은 고른 색으로 보인다
  }
}

let prefs: UiPrefs = read()
let preset: CatalogTheme | null = readPreset()

// 새 디자인이 나오면 한 번만 HSOrbit 으로 옮긴다(받은 테마도 그만 씀). 설정 → 화면 테마에서 예전 모양으로 되돌릴 수 있다.
try {
  if (window.localStorage.getItem(ORBIT_KEY) !== '1') {
    window.localStorage.setItem(ORBIT_KEY, '1')
    if (prefs.theme !== 'orbit' || prefs.preset) {
      prefs = { ...prefs, theme: 'orbit', preset: '' }
      preset = null
      window.localStorage.setItem(KEY, JSON.stringify(prefs))
      window.localStorage.removeItem(PRESET_KEY)
    }
  }
} catch {
  // 저장이 막혀 있으면 고른 모양 그대로
}

// 3.6.4: 새 화면(위 탭 셋)을 기본으로 — 왼쪽 메뉴 화면은 '옛 버전 화면' 으로 설정에 남는다
try {
  if (window.localStorage.getItem(NEWSHELL_KEY) !== '1') {
    window.localStorage.setItem(NEWSHELL_KEY, '1')
    if (prefs.shell !== 'new') {
      prefs = { ...prefs, shell: 'new' }
      window.localStorage.setItem(KEY, JSON.stringify(prefs))
    }
  }
} catch {
  // 저장이 막혀 있으면 고른 화면 그대로
}
/** 받은 테마로 덮어쓴 토큰 — 다른 것을 고르면 지운다 */
let applied: string[] = []
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
  const p = prefs.preset && preset?.id === prefs.preset ? preset : null
  root.dataset.theme = p ? p.base : prefs.theme
  root.dataset.mode = mode
  root.dataset.shell = prefs.shell
  if (p) root.dataset.preset = p.id
  else delete root.dataset.preset
  root.style.colorScheme = mode
  for (const k of applied) root.style.removeProperty(k)
  applied = []
  if (p) {
    for (const [k, v] of Object.entries(mode === 'dark' ? p.dark : p.light)) {
      if (!THEME_VARS.includes(k)) continue
      root.style.setProperty(k, v)
      applied.push(k)
    }
  }
  // 창 제목 줄 · 스크롤바도 같은 밝기로. 예전 버전 preload 에는 없으므로 없으면 넘어간다.
  void window.api?.ui?.setNativeTheme?.(prefs.mode)
  // 글자 크기 — 창 전체 배율로 바꿔야 표 · 단추 · 여백이 함께 커져 어긋나지 않는다
  void window.api?.ui?.setZoom?.(prefs.fontScale)
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

/** 받은 테마를 고른다. null 이면 받은 테마를 그만 쓰고 그 모양의 기본 색으로 */
export function choosePreset(t: CatalogTheme | null): void {
  preset = t
  writePreset(t)
  if (t) setUiPrefs({ theme: t.base, preset: t.id })
  else setUiPrefs({ preset: '' })
}

/**
 * 목록을 새로 받으면 고른 받은 테마를 맞춘다. 만든이가 색을 고쳤으면 따라가고,
 * 목록에서 뺐으면(제대로 받았을 때만) 그 모양의 기본 색으로 돌아간다.
 */
export function syncPreset(r: CatalogResult): void {
  if (!prefs.preset) return
  const t = r.catalog.themes.find((x) => x.id === prefs.preset)
  if (t) {
    if (JSON.stringify(t) === JSON.stringify(preset)) return
    preset = t
    writePreset(t)
    prefs = { ...prefs, theme: t.base }
    try {
      window.localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch {
      // 이번 실행 동안만
    }
    applyTheme()
    listeners.forEach((f) => f())
  } else if (r.from === 'net') {
    choosePreset(null)
  }
}

function subscribe(f: () => void): () => void {
  listeners.add(f)
  return () => listeners.delete(f)
}

export function useUiPrefs(): UiPrefs {
  return useSyncExternalStore(subscribe, getUiPrefs)
}
