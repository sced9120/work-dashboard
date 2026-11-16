import { Suspense, lazy, useEffect, useState } from 'react'
import type { PageId } from '../App'
import ClassRoster from '../components/ClassRoster'
import CounselBoard from '../components/CounselBoard'
import SeteukReview from '../components/SeteukReview'

const Attendance = lazy(() => import('./Attendance'))

/**
 * 담임 — 우리 반 학생 명단 · 상담 기록 · 출결 · 학생부 분석을 한곳에.
 * 칸 넷은 이 화면 안의 작은 단추로 고르고, 마지막에 본 칸을 기억한다.
 * 옛 '출결' 화면은 App 이 initial="출결" 로 이 화면을 열어 준다(옛 링크 · 위젯이 그대로 동작).
 */
export type HomeroomTab = '학생 명단' | '상담 기록' | '출결' | '학생부 분석'

export const HOMEROOM_TABS: HomeroomTab[] = ['학생 명단', '상담 기록', '출결', '학생부 분석']
const TAB_KEY = 'wd_homeroom_tab'

function readTab(): HomeroomTab {
  try {
    const v = window.localStorage.getItem(TAB_KEY)
    return HOMEROOM_TABS.find((t) => t === v) ?? '학생 명단'
  } catch {
    return '학생 명단'
  }
}

export default function Homeroom({ onGo, initial }: { onGo: (p: PageId) => void; initial?: HomeroomTab }): JSX.Element {
  const [tab, setTab] = useState<HomeroomTab>(initial ?? readTab())
  const pick = (t: HomeroomTab): void => {
    setTab(t)
    try {
      window.localStorage.setItem(TAB_KEY, t)
    } catch {
      // 이번 실행 동안만
    }
  }
  // 명단의 [상담 기록] 처럼 다른 칸에서 '이 칸으로' 를 부르면 바꾼다 (src/lib/counselNav.ts 의 wd-homeroom-tab)
  useEffect(() => {
    const h = (e: Event): void => {
      const t = (e as CustomEvent<HomeroomTab>).detail
      if (HOMEROOM_TABS.includes(t)) pick(t)
    }
    window.addEventListener('wd-homeroom-tab', h)
    return () => window.removeEventListener('wd-homeroom-tab', h)
  }, [])

  return (
    <>
      <div className="page-head">
        <h1>담임</h1>
        <p>우리 반 학생 명단 · 상담 · 출결 · 학생부를 한곳에서.</p>
      </div>

      <div className="memo-filter" role="radiogroup" aria-label="담임 화면" style={{ marginBottom: 14 }}>
        {HOMEROOM_TABS.map((t) => (
          <button key={t} role="radio" aria-checked={tab === t} className={tab === t ? 'on' : ''} onClick={() => pick(t)}>
            {t}
          </button>
        ))}
      </div>

      <Suspense fallback={<p className="muted small">화면을 여는 중…</p>}>
        {tab === '학생 명단' && <ClassRoster onGo={onGo} />}
        {tab === '상담 기록' && <CounselBoard onGo={onGo} />}
        {tab === '출결' && <Attendance onGo={onGo} embedded />}
        {tab === '학생부 분석' && <SeteukReview />}
      </Suspense>
    </>
  )
}
