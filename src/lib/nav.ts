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
      { id: '달력', icon: 'calendar', label: '달력' },
      { id: '시간표', icon: 'clock', label: '시간표' },
      { id: '기한', icon: 'hourglass', label: '절차 기한' },
      { id: '일지', icon: 'pen', label: '업무 일지' }
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
      { id: '발표', icon: 'screen', label: '발표자료 만들기' }
    ]
  }
]

export const AI_ITEM: NavItem = { id: '도우미', icon: 'spark', label: '업무 도우미 (AI)' }
export const DATA_ITEM: NavItem = { id: '데이터', icon: 'box', label: '인수인계 · 백업' }
export const SETTINGS_ITEM: NavItem = { id: '설정', icon: 'sliders', label: '설정' }

/** 따라 배우기 목록처럼 메뉴를 한 줄로 늘어놓을 때 쓰는 차례 */
export const NAV_GROUPS: { section: string; items: NavItem[] }[] = [
  NAV[0],
  { section: NAV[1].section, items: [AI_ITEM, ...NAV[1].items] },
  NAV[2],
  { section: '관리', items: [DATA_ITEM, SETTINGS_ITEM] }
]

export function navLabel(id: PageId): string {
  for (const g of NAV_GROUPS) for (const n of g.items) if (n.id === id) return n.label
  return id
}
