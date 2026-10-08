/**
 * 메뉴 · 위젯에 쓰는 선 아이콘. 회색 화면에서 이모지만 색이 튀어서 선 아이콘으로 바꿨다.
 * 따로 패키지를 받지 않고 그림을 여기 적어 둔다 — 설치파일에 그대로 들어가고 학교망과 상관없다.
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

const PATHS: Record<IconName, JSX.Element> = {
  home: <path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  hourglass: <path d="M6 3.5h12M6 20.5h12M7.5 3.5v2.5a4.5 4.5 0 0 0 9 0V3.5M7.5 20.5V18a4.5 4.5 0 0 1 9 0v2.5" />,
  pen: (
    <>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  bars: <path d="M3.5 20h17M6.5 16v-5M10.5 16V6M14.5 16V9M18.5 16v-3" />,
  flow: (
    <>
      <rect x="3.5" y="3.5" width="7" height="6" rx="1.5" />
      <rect x="13.5" y="14.5" width="7" height="6" rx="1.5" />
      <path d="M7 9.5v6a2 2 0 0 0 2 2h4.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  guide: (
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <path d="M9 4.5V3h6v1.5M9 10h6M9 13.5h6M9 17h3.5" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  inbox: (
    <>
      <path d="M12 3.5v9M8.5 9 12 12.5 15.5 9" />
      <path d="M3.5 14h4.5l1.5 2.5h5L16 14h4.5v4.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    </>
  ),
  doc: (
    <>
      <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" />
      <path d="M14 3.5V8h4.5M9 12.5h6M9 16h6" />
    </>
  ),
  screen: (
    <>
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="1.5" />
      <path d="M12 16v4M8 20.5h8" />
    </>
  ),
  box: (
    <>
      <rect x="3.5" y="4.5" width="17" height="4.5" rx="1" />
      <path d="M5 9v9.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="17" r="2" />
    </>
  ),
  spark: <path d="M12 2c.8 6.5 3.5 9.2 10 10-6.5.8-9.2 3.5-10 10-.8-6.5-3.5-9.2-10-10 6.5-.8 9.2-3.5 10-10z" fill="currentColor" stroke="none" />,
  chevron: <path d="m9.5 6 6 6-6 6" />,
  up: <path d="M12 19V5.5M6.5 11 12 5.5l5.5 5.5" />,
  cycle: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  cap: (
    <>
      <path d="M2.5 9.5 12 5l9.5 4.5L12 14z" />
      <path d="M6.5 11.5V16c1.5 1.6 3.4 2.5 5.5 2.5s4-.9 5.5-2.5v-4.5M21.5 9.5V15" />
    </>
  ),
  pin: <path d="M9 3.5h6l-1 6 3.5 3.5h-11L10 9.5zM12 13v7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  out: <path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2H11" />,
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <path d="M16.75 13.5v6.5M13.5 16.75H20" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3.1-3.1a4 4 0 0 0-5.7-5.7L11.6 6.7M14 10a4 4 0 0 0-5.7 0l-3.1 3.1a4 4 0 0 0 5.7 5.7l1.5-1.5" />,
  note: (
    <>
      <path d="M5.5 3.5h13a1 1 0 0 1 1 1v10l-6 6h-8a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" />
      <path d="M19.5 14.5h-5a1 1 0 0 0-1 1v5M8.5 8.5h7M8.5 12h4" />
    </>
  ),
  chat: (
    <>
      <path d="M4 5.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-4.5 4v-4H6a2 2 0 0 1-2-2z" />
      <path d="M8.5 9h7M8.5 12.5h4.5" />
    </>
  )
}

interface Props {
  name: IconName
  size?: number
  className?: string
}

export default function Icon({ name, size = 18, className }: Props): JSX.Element {
  return (
    <svg
      className={`ico ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
