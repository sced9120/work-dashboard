import { createElement } from 'react'
// Lucian Icons (MIT) — 움직이는 선 아이콘. 쓰는 것만 설치파일에 넣었다(src/vendor/lucian-icons, 인터넷 요청 없음).
import '../vendor/lucian-icons/archive.js'
import '../vendor/lucian-icons/branch.js'
import '../vendor/lucian-icons/building.js'
import '../vendor/lucian-icons/calendar.js'
import '../vendor/lucian-icons/chart.js'
import '../vendor/lucian-icons/chat.js'
import '../vendor/lucian-icons/check.js'
import '../vendor/lucian-icons/clipboard.js'
import '../vendor/lucian-icons/clock.js'
import '../vendor/lucian-icons/compass.js'
import '../vendor/lucian-icons/document.js'
import '../vendor/lucian-icons/flag.js'
import '../vendor/lucian-icons/graduation.js'
import '../vendor/lucian-icons/grid.js'
import '../vendor/lucian-icons/history.js'
import '../vendor/lucian-icons/home.js'
import '../vendor/lucian-icons/inbox.js'
import '../vendor/lucian-icons/link.js'
import '../vendor/lucian-icons/monitor.js'
import '../vendor/lucian-icons/notebook.js'
import '../vendor/lucian-icons/pin.js'
import '../vendor/lucian-icons/plus.js'
import '../vendor/lucian-icons/refresh.js'
import '../vendor/lucian-icons/rocket.js'
import '../vendor/lucian-icons/scan.js'
import '../vendor/lucian-icons/search.js'
import '../vendor/lucian-icons/sliders.js'
import '../vendor/lucian-icons/sparkle.js'
import '../vendor/lucian-icons/stickynote.js'
import '../vendor/lucian-icons/stopwatch.js'
import '../vendor/lucian-icons/users.js'
import '../vendor/lucian-icons/utensils.js'

/**
 * 메뉴 · 위젯 · 단추에 쓰는 아이콘.
 *
 * Lucian Icons(https://lucianlabs.dev/icons/, MIT)를 쓴다. 단추에 마우스를 올리면 살짝 움직인다(움직임 줄이기 설정이면 멈춤).
 * 아이콘마다 제 색이 있지만 화면에서 튀지 않게 테마의 색 하나(--li-accent)와 옅은 바탕(--li-tint)으로 칠한다 — src/themes.css 14번.
 * 접기 손잡이 · 위로 · 밖으로 열기 같은 작은 화살표만 예전처럼 여기 그린 선을 쓴다.
 */

export type IconName =
  | 'home'
  | 'calendar'
  | 'clock'
  | 'hourglass'
  | 'pen'
  | 'bars'
  | 'flow'
  | 'search'
  | 'guide'
  | 'compass'
  | 'inbox'
  | 'doc'
  | 'screen'
  | 'box'
  | 'sliders'
  | 'spark'
  | 'chevron'
  | 'up'
  | 'cycle'
  | 'check'
  | 'cap'
  | 'pin'
  | 'plus'
  | 'out'
  | 'grid'
  | 'link'
  | 'note'
  | 'chat'
  | 'scan'
  // 홈 위젯 제목
  | 'school'
  | 'meal'
  | 'class'
  | 'event'
  | 'past'
  | 'rocket'

type Drawn = 'chevron' | 'up' | 'out'

/** 이 앱의 이름 → Lucian 아이콘 */
const LUCIAN: Record<Exclude<IconName, Drawn>, string> = {
  home: 'home',
  calendar: 'calendar',
  clock: 'clock',
  hourglass: 'stopwatch',
  pen: 'notebook',
  bars: 'chart',
  flow: 'branch',
  search: 'search',
  guide: 'clipboard',
  compass: 'compass',
  inbox: 'inbox',
  doc: 'document',
  screen: 'monitor',
  box: 'archive',
  sliders: 'sliders',
  spark: 'sparkle',
  cycle: 'refresh',
  check: 'check',
  cap: 'graduation',
  pin: 'pin',
  plus: 'plus',
  grid: 'grid',
  link: 'link',
  note: 'stickynote',
  chat: 'chat',
  scan: 'scan',
  school: 'building',
  meal: 'utensils',
  class: 'users',
  event: 'flag',
  past: 'history',
  rocket: 'rocket'
}

const PATHS: Record<Drawn, JSX.Element> = {
  chevron: <path d="m9.5 6 6 6-6 6" />,
  up: <path d="M12 19V5.5M6.5 11 12 5.5l5.5 5.5" />,
  out: <path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2H11" />
}

interface Props {
  name: IconName
  size?: number
  className?: string
}

export default function Icon({ name, size = 18, className }: Props): JSX.Element {
  if (name in LUCIAN) {
    // React 18 은 웹 컴포넌트에 className 을 class 로 바꿔 주지 않아 class 로 넘긴다
    const props: Record<string, string> = { size: String(size), class: `ico ${className ?? ''}`.trim(), 'aria-hidden': 'true' }
    return createElement(`lucian-${LUCIAN[name as Exclude<IconName, Drawn>]}`, props)
  }
  return (
    <svg
      className={`ico ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name as Drawn]}
    </svg>
  )
}
