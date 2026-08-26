import { useCallback, useEffect, useState } from 'react'
import type { UpdateInfo } from '../shared/types'
import { ToastProvider } from './lib/toast'
import Onboarding from './pages/Onboarding'
import Home from './pages/Home'
import Roadmap from './pages/Roadmap'
import CalendarPage from './pages/CalendarPage'
import Guide from './pages/Guide'
import Learn from './pages/Learn'
import Search from './pages/Search'
import Chat from './pages/Chat'
import Committee from './pages/Committee'
import Deadlines from './pages/Deadlines'
import Journal from './pages/Journal'
import Data from './pages/Data'
import Settings from './pages/Settings'

export type PageId =
  | '홈'
  | '달력'
  | '로드맵'
  | '가이드'
  | '학습'
  | '검색'
  | '도우미'
  | '위원회'
  | '기한'
  | '일지'
  | '데이터'
  | '설정'

/**
 * 메뉴가 열한 개를 넘어서면서 한 줄로 늘어놓으니 무엇이 무엇인지 찾기 어려웠다.
 * 하는 일에 따라 네 묶음으로 나눈다.
 */
const NAV: { section: string; items: { id: PageId; icon: string; label: string }[] }[] = [
  {
    section: '오늘',
    items: [
      { id: '홈', icon: '🏠', label: '홈' },
      { id: '달력', icon: '🗓', label: '달력' },
      { id: '기한', icon: '⏰', label: '절차 기한' },
      { id: '일지', icon: '✍️', label: '업무 일지' }
    ]
  },
  {
    section: '업무 살펴보기',
    items: [
      { id: '로드맵', icon: '📊', label: '연간 업무 로드맵' },
      { id: '검색', icon: '🔎', label: '통합 검색' },
      { id: '도우미', icon: '💬', label: '업무 도우미 (AI)' },
      { id: '가이드', icon: '📋', label: '업무 상세 가이드' }
    ]
  },
  {
    section: '자료 만들기',
    items: [
      { id: '학습', icon: '📥', label: '문서로 업무 만들기' },
      { id: '위원회', icon: '⚖️', label: '선도위원회 자료' }
    ]
  },
  {
    section: '관리',
    items: [
      { id: '데이터', icon: '💾', label: '인수인계 · 백업' },
      { id: '설정', icon: '⚙️', label: '설정' }
    ]
  }
]

function Shell(): JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [jobTitle, setJobTitle] = useState('')
  const [schoolName, setSchoolName] = useState('')
  const [page, setPage] = useState<PageId>('홈')
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [updateHidden, setUpdateHidden] = useState(false)
  /** null이면 아직 안 받는 중, 숫자면 진행률, 'done'이면 받아 놓은 상태 */
  const [dlProgress, setDlProgress] = useState<number | 'done' | null>(null)
  const [dlError, setDlError] = useState('')

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

  // 새 버전 확인. 실패해도 화면에 아무 것도 띄우지 않는다.
  // 학교망에서 막히는 일이 있어서, 못 물어본 것과 최신인 것을 구분해 보여 주지 않는다.
  useEffect(() => {
    void (async () => {
      const info = await window.api.update.check()
      if (info.available) setUpdate(info)
    })()
  }, [])

  useEffect(() => {
    const offProgress = window.api.update.onProgress((p) => setDlProgress(p))
    const offDone = window.api.update.onDownloaded(() => setDlProgress('done'))
    const offError = window.api.update.onError((msg) => {
      setDlError(msg)
      setDlProgress(null)
    })
    return () => {
      offProgress()
      offDone()
      offError()
    }
  }, [])

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

        {NAV.map((group) => (
          <div className="nav-group" key={group.section}>
            <div className="nav-section">{group.section}</div>
            {group.items.map((n) => (
              <button
                key={n.id}
                className={`nav-btn ${page === n.id ? 'active' : ''}`}
                onClick={() => setPage(n.id)}
              >
                <span className="nav-icon">{n.icon}</span>
                <span>{n.label}</span>
              </button>
            ))}
          </div>
        ))}

        <div className="sidebar-foot">버전 {version}</div>
      </nav>

      <main className="main">
        {update && !updateHidden && (
          <div className="update-bar">
            <span className="update-dot" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>새 버전 {update.latest} 이 나왔습니다.</b>{' '}
              <span className="muted small">지금 쓰는 버전은 {update.current} 입니다.</span>
              <div className="small muted" style={{ marginTop: 2 }}>
                업데이트해도 정리해 둔 업무·공문·기한은 그대로 남습니다.
                {!update.canAutoInstall && ' 무설치(Portable)로 쓰고 계셔서 직접 받아 바꿔야 합니다.'}
              </div>
            </div>
            {/* 받아 놓은 뒤 */}
            {dlProgress === 'done' && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => void window.api.update.install()}
              >
                다시 시작하고 설치
              </button>
            )}

            {/* 받는 중 */}
            {typeof dlProgress === 'number' && (
              <span className="small" style={{ minWidth: 90 }}>
                받는 중… {dlProgress}%
              </span>
            )}

            {/* 아직 시작 안 함 */}
            {dlProgress === null && (
              <>
                {update.canAutoInstall && (
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() =>
                      void (async () => {
                        setDlError('')
                        setDlProgress(0)
                        const res = await window.api.update.download()
                        if (!res.ok) {
                          setDlError(res.error ?? '받지 못했습니다.')
                          setDlProgress(null)
                        }
                      })()
                    }
                  >
                    지금 받아서 설치
                  </button>
                )}
                <button
                  className={`btn btn-sm ${update.canAutoInstall ? '' : 'btn-primary'}`}
                  onClick={() => void window.api.shell.open(update.url)}
                >
                  받으러 가기
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setUpdateHidden(true)}>
                  나중에
                </button>
              </>
            )}

            {dlError && (
              <div className="small" style={{ flexBasis: '100%', color: 'var(--danger)' }}>
                {dlError} — [받으러 가기]로 직접 내려받아 설치해 주세요.
              </div>
            )}
          </div>
        )}

        {page === '홈' && <Home jobTitle={jobTitle} onGo={setPage} />}
        {page === '달력' && <CalendarPage />}
        {page === '로드맵' && <Roadmap />}
        {page === '가이드' && <Guide />}
        {page === '검색' && <Search jobTitle={jobTitle} onGo={setPage} />}
        {page === '도우미' && <Chat jobTitle={jobTitle} onGo={setPage} />}
        {page === '학습' && <Learn jobTitle={jobTitle} onGo={setPage} />}
        {page === '위원회' && <Committee onGo={setPage} />}
        {page === '기한' && <Deadlines />}
        {page === '일지' && <Journal />}
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
