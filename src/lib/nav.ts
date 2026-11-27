import { useSyncExternalStore } from 'react'
import type { PageId } from '../App'
import type { IconName } from '../components/Icon'

export interface NavItem {
  id: PageId
  icon: IconName
  label: string
}

/**
 * 왼쪽 메뉴. 메뉴가 열한 개를 넘어서면서 한 줄로 늘어놓으니 무엇이 무엇인지 찾기 어려워
 * 하는 일에 따라 묶었다. 업무 도우미는 맨 위 ✦ 단추로, 인수인계 · 설정은 맨 아래로 뺐다.
 */
export const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: '오늘',
    items: [
      { id: '홈', icon: 'home', label: '홈' },
      { id: '이번주', icon: 'event', label: '이번 주 한눈에' },
      { id: '달력', icon: 'calendar', label: '달력' },
      { id: '시간표', icon: 'clock', label: '시간표' },
      { id: '기한', icon: 'hourglass', label: '절차 기한' },
      { id: '메신저', icon: 'chat', label: '메신저 정리' },
      { id: '일지', icon: 'pen', label: '업무 일지' },
      { id: '메모장', icon: 'note', label: '자유 메모장' }
    ]
  },
  {
    section: '담임',
    items: [
      { id: '담임', icon: 'class', label: '담임 (학생 명단 · 상담 · 출결 · 학생부)' },
      { id: '출결', icon: 'class', label: '출결 기록' }
    ]
  },
  {
    section: '업무 살펴보기',
    items: [
      { id: '로드맵', icon: 'bars', label: '연간 업무 로드맵' },
      { id: '워크플로우', icon: 'flow', label: '업무 워크플로우' },
      { id: '검색', icon: 'search', label: '통합 검색' },
      { id: '가이드', icon: 'guide', label: '업무 상세 가이드' },
      { id: '도움자료', icon: 'compass', label: '학교업무 도움자료' }
    ]
  },
  {
    section: '자료 만들기',
    items: [
      { id: '학습', icon: 'inbox', label: '문서로 업무 만들기' },
      { id: '위원회', icon: 'doc', label: '학교 문서 만들기' },
      { id: '발표', icon: 'screen', label: '발표자료 만들기' },
      { id: '세특', icon: 'pen', label: '세특 작성실' },
      { id: 'OCR', icon: 'scan', label: '문서 스캔 · 정리' },
      { id: '변환', icon: 'file', label: 'PDF 변환' },
      { id: 'PDF편집', icon: 'edit', label: 'PDF 편집' },
      { id: '도구', icon: 'grid', label: '도구 모음' }
    ]
  }
]

export const AI_ITEM: NavItem = { id: '도우미', icon: 'spark', label: '업무 도우미 (AI)' }
export const DATA_ITEM: NavItem = { id: '데이터', icon: 'box', label: '인수인계 · 백업' }
export const SETTINGS_ITEM: NavItem = { id: '설정', icon: 'sliders', label: '설정' }

/** 따라 배우기 목록처럼 메뉴를 한 줄로 늘어놓을 때 쓰는 차례 */
export const NAV_GROUPS: { section: string; items: NavItem[] }[] = [
  NAV[0],
  NAV[1],
  { section: NAV[2].section, items: [AI_ITEM, ...NAV[2].items] },
  NAV[3],
  { section: '관리', items: [DATA_ITEM, SETTINGS_ITEM] }
]

export function navLabel(id: PageId): string {
  for (const g of NAV_GROUPS) for (const n of g.items) if (n.id === id) return n.label
  return id
}

/* ---------- 새 화면 위 탭 ---------- */

export type TabId = 'today' | 'week' | 'work' | 'homeroom' | 'seteuk'

export interface TabSub {
  page: PageId
  label: string
}

export interface TabDef {
  id: TabId
  label: string
  subs: TabSub[]
}

/** 새 화면의 위 탭 차례 — 세특 작성실이 맨 오른쪽 */
export const TABS: TabDef[] = [
  { id: 'today', label: '오늘', subs: [{ page: '홈', label: '오늘' }] },
  {
    id: 'week',
    label: '이번 주',
    subs: [
      { page: '이번주', label: '한눈에' },
      { page: '시간표', label: '시간표' },
      { page: '달력', label: '달력' }
    ]
  },
  {
    id: 'work',
    label: '내 업무',
    subs: [
      { page: '로드맵', label: '연간 업무' },
      { page: '기한', label: '절차 기한' },
      { page: '워크플로우', label: '워크플로우' },
      { page: '가이드', label: '업무 가이드' },
      { page: '도움자료', label: '도움자료' },
      { page: '데이터', label: '인수인계 · 백업' }
    ]
  },
  // 담임 — 학생 명단 · 상담 · 출결 · 학생부 분석 (안의 칸은 화면 안에서 고른다)
  { id: 'homeroom', label: '담임', subs: [{ page: '담임', label: '담임' }] },
  // 세특은 학기 말에 몰아서 오래 쓰는 화면이라 만들기 안에 두지 않고 위 탭으로 바로 간다
  { id: 'seteuk', label: '세특 작성실', subs: [{ page: '세특', label: '세특 작성실' }] }
]

/** 지금 보일 위 탭 — 끈 메뉴의 탭은 뺀다 (담임만 끌 수 있다. 나머지는 첫 화면이 늘 보이는 것으로 친다) */
export function visibleTabs(p: NavPrefs): TabDef[] {
  return TABS.filter((t) => t.id !== 'homeroom' || isShown(p, '담임'))
}

/** 이 화면이 속한 위 탭 */
export function tabIdOf(page: PageId): TabId | null {
  // 출결 은 담임 안으로 옮겼다 — 옛 링크 · 위젯으로 열어도 담임 탭에 불이 켜진다
  if (page === '출결') return 'homeroom'
  return TABS.find((t) => t.subs.some((s) => s.page === page))?.id ?? null
}

/* ---------- 메뉴 고르기 (보이기 · 차례 · 바로가기) ---------- */

/**
 * 쓰는 사람마다 다르게 고르는 것이라 테마처럼 이 PC 의 localStorage 에 둔다(인수인계 파일로 넘어가지 않는다).
 * 꺼 둔 메뉴도 화면은 그대로 있다 — 홈 위젯 · 검색 결과 등에서 들어갈 수 있다.
 */

/** 늘 보이는 메뉴 (끌 수 없다) */
export const FIXED_PAGES: PageId[] = ['홈', '설정']

export interface NavLink {
  id: string
  name: string
  /** http(s) 주소 — 브라우저로 연다 */
  url: string
  /** 이모지 한 개 (없으면 고리 아이콘) */
  icon: string
  /** 도구 모음에서 고정한 것이면 그 도구 id (이름 · 주소가 바뀌면 따라간다) */
  tool?: string
}

export interface NavPrefs {
  hidden: PageId[]
  /** 묶음마다 메뉴 차례 (묶음 이름 → 화면 id) */
  order: Record<string, PageId[]>
  links: NavLink[]
}

const NAV_KEY = 'wd_nav'
const ALL_PAGES = new Set<string>(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id)))
export const EMPTY_NAV: NavPrefs = { hidden: [], order: {}, links: [] }

/** 바로가기 주소로 쓸 수 있는지 — http(s) 만 */
export function linkUrl(raw: string): string {
  const s = raw.trim()
  if (!/^https?:\/\//i.test(s)) return ''
  try {
    const u = new URL(s)
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname ? u.href : ''
  } catch {
    return ''
  }
}

function readNav(): NavPrefs {
  try {
    const v = JSON.parse(window.localStorage.getItem(NAV_KEY) || 'null') as Partial<NavPrefs> | null
    const pages = (a: unknown): PageId[] =>
      Array.isArray(a) ? (a.filter((x) => typeof x === 'string' && ALL_PAGES.has(x)) as PageId[]) : []
    const order: Record<string, PageId[]> = {}
    if (v?.order && typeof v.order === 'object') for (const [k, a] of Object.entries(v.order)) order[k] = pages(a)
    const links = (Array.isArray(v?.links) ? v.links : [])
      .filter((l): l is NavLink => !!l && typeof l.id === 'string' && typeof l.name === 'string' && !!linkUrl(String(l.url)))
      .map((l) => ({ id: l.id, name: l.name.slice(0, 30), url: linkUrl(l.url), icon: typeof l.icon === 'string' ? l.icon.slice(0, 8) : '', ...(typeof l.tool === 'string' ? { tool: l.tool } : {}) }))
      .slice(0, 30)
    return { hidden: pages(v?.hidden).filter((p) => !FIXED_PAGES.includes(p)), order, links }
  } catch {
    return { ...EMPTY_NAV }
  }
}

let navPrefs: NavPrefs = readNav()
const navListeners = new Set<() => void>()

export function getNavPrefs(): NavPrefs {
  return navPrefs
}

export function setNavPrefs(patch: Partial<NavPrefs>): void {
  navPrefs = { ...navPrefs, ...patch }
  try {
    window.localStorage.setItem(NAV_KEY, JSON.stringify(navPrefs))
  } catch {
    // 이번 실행 동안만
  }
  navListeners.forEach((f) => f())
}

export function useNavPrefs(): NavPrefs {
  return useSyncExternalStore(
    (f) => {
      navListeners.add(f)
      return () => navListeners.delete(f)
    },
    getNavPrefs
  )
}

export const isShown = (p: NavPrefs, id: PageId): boolean => FIXED_PAGES.includes(id) || !p.hidden.includes(id)

/** 고른 차례로 늘어놓은 묶음 (끈 메뉴도 들어 있다 — 메뉴 고르기 화면용) */
export function orderedNav(p: NavPrefs): { section: string; items: NavItem[] }[] {
  return NAV.map((g) => {
    const saved = (p.order[g.section] ?? []).map((id) => g.items.find((i) => i.id === id)).filter((i): i is NavItem => !!i)
    return { section: g.section, items: [...saved, ...g.items.filter((i) => !saved.includes(i))] }
  })
}

/** 왼쪽 메뉴에 보일 묶음 (끈 메뉴는 빼고, 빈 묶음도 뺀다) */
export function sidebarNav(p: NavPrefs): { section: string; items: NavItem[] }[] {
  return orderedNav(p)
    .map((g) => ({ section: g.section, items: g.items.filter((i) => isShown(p, i.id)) }))
    .filter((g) => g.items.length > 0)
}

/** 따라 배우기 목록 — 끈 메뉴는 뺀다 */
export function shownGroups(p: NavPrefs): { section: string; items: NavItem[] }[] {
  return NAV_GROUPS.map((g) => ({ section: g.section, items: g.items.filter((i) => isShown(p, i.id)) })).filter((g) => g.items.length > 0)
}

/* 왼쪽 메뉴의 [메뉴 편집] → 설정 화면의 메뉴 고르기 카드로 */
let menuEditWanted = false

export function requestMenuEdit(): void {
  menuEditWanted = true
  window.dispatchEvent(new Event('wd:menu-edit'))
}

export function takeMenuEdit(): boolean {
  const v = menuEditWanted
  menuEditWanted = false
  return v
}
