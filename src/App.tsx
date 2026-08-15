import { useCallback, useEffect, useState } from 'react'
import { ToastProvider } from './lib/toast'
import Onboarding from './pages/Onboarding'
import Home from './pages/Home'
import Roadmap from './pages/Roadmap'
import Guide from './pages/Guide'
import Learn from './pages/Learn'
import Search from './pages/Search'
import Data from './pages/Data'
import Settings from './pages/Settings'

export type PageId = '홈' | '로드맵' | '가이드' | '학습' | '검색' | '데이터' | '설정'

const NAV: { id: PageId; icon: string; label: string }[] = [
  { id: '홈', icon: '🏠', label: '홈' },
  { id: '로드맵', icon: '🗓', label: '연간 업무 로드맵' },
  { id: '가이드', icon: '📋', label: '업무 상세 가이드' },
  { id: '검색', icon: '🔎', label: '통합 검색' },
  { id: '학습', icon: '📥', label: '문서로 업무 만들기' },
  { id: '데이터', icon: '💾', label: '인수인계 · 백업' },
  { id: '설정', icon: '⚙️', label: '설정' }
]

function Shell(): JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [jobTitle, setJobTitle] = useState('')
  const [schoolName, setSchoolName] = useState('')
  const [page, setPage] = useState<PageId>('홈')
  const [version, setVersion] = useState('')

  const reloadProfile = useCallback(async () => {
    const [job, school] = await Promise.all([
      window.api.setting.get('job_title'),
      window.api.setting.get('school_name')
    ])
    setJobTitle(job)
    setSchoolName(school)
  }, [])

  useEffect(() => {
    void (async () => {
      await reloadProfile()
      setVersion(await window.api.appVersion())
      setLoaded(true)
    })()
  }, [reloadProfile])

  if (!loaded) return <div className="onboard muted">불러오는 중…</div>

  if (!jobTitle) {
    return <Onboarding onDone={reloadProfile} />
  }

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-title">{jobTitle}</div>
          <div className="brand-sub">{schoolName || '업무 인수인계 대시보드'}</div>
        </div>

        {NAV.map((n) => (
          <button
            key={n.id}
            className={`nav-btn ${page === n.id ? 'active' : ''}`}
            onClick={() => setPage(n.id)}
          >
            <span className="nav-icon">{n.icon}</span>
            <span>{n.label}</span>
          </button>
        ))}

        <div className="sidebar-foot">버전 {version}</div>
      </nav>

      <main className="main">
        {page === '홈' && <Home jobTitle={jobTitle} onGo={setPage} />}
        {page === '로드맵' && <Roadmap />}
        {page === '가이드' && <Guide />}
        {page === '검색' && <Search jobTitle={jobTitle} onGo={setPage} />}
        {page === '학습' && <Learn jobTitle={jobTitle} onGo={setPage} />}
        {page === '데이터' && <Data onChanged={reloadProfile} />}
        {page === '설정' && <Settings onProfileChanged={reloadProfile} />}
      </main>
    </div>
  )
}

export default function App(): JSX.Element {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  )
}
