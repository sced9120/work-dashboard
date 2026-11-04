import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { PageId } from '../App'
import type { NavPrefs } from '../lib/nav'
import { isShown } from '../lib/nav'
import { queueChat, queueSearch } from '../lib/chatBridge'
import { newChat } from '../lib/chatStore'
import Icon from './Icon'
import type { IconName } from './Icon'

/**
 * 새 화면 (설정 → 화면 구성 → 새 화면). 예전 화면과 같은 자료 · 같은 안쪽 화면을 쓰고, 바깥 틀만 다르다.
 *  - 위 탭 셋: 오늘(위젯 판) · 이번 주(시간표 · 달력) · 내 업무(연간 업무 · 기한 · 워크플로우 · 가이드 · 도움자료 · 인수인계)
 *  - [＋ 만들기] 팝업: 자료 만들기 다섯 가지와 기록(메모장 · 일지)
 *  - 아래 떠 있는 물어보기 바: Enter 는 업무 도우미, 돋보기는 통합 검색 (Ctrl+K 로 커서가 온다)
 * 탭 밖의 화면(만들기 · 도우미 · 검색 · 설정)은 위에 [‹ 돌아가기] 를 달아 어디서 왔는지 돌아갈 수 있게 한다.
 */

type TabId = 'today' | 'week' | 'work'

interface Sub {
  page: PageId
  label: string
}

const TABS: { id: TabId; label: string; subs: Sub[] }[] = [
  { id: 'today', label: '오늘', subs: [{ page: '홈', label: '오늘' }] },
  {
    id: 'week',
    label: '이번 주',
    subs: [
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
  }
]

interface MakeItem {
  page: PageId
  icon: IconName
  label: string
  desc: string
}

const MAKE: { title: string; items: MakeItem[] }[] = [
  {
    title: '자료 만들기',
    items: [
      { page: '학습', icon: 'inbox', label: '문서로 업무 만들기', desc: '공문 · 계획서를 넣으면 업무로 정리' },
      { page: '위원회', icon: 'doc', label: '학교 문서 만들기', desc: '한글 양식으로 계획서 · 회의록' },
      { page: '발표', icon: 'screen', label: '발표자료 만들기', desc: '연수 · 협의회 슬라이드' },
      { page: 'OCR', icon: 'scan', label: '문서 스캔 · 정리', desc: '스캔 · 사진 속 표를 엑셀로' },
      { page: '도구', icon: 'grid', label: '도구 모음', desc: '학교에서 자주 쓰는 사이트 · 도구' }
    ]
  },
  {
    title: '기록',
    items: [
      { page: '메모장', icon: 'note', label: '자유 메모장', desc: '아무 메모나 적어 두기' },
      { page: '일지', icon: 'pen', label: '업무 일지', desc: '한 일 · 한 줄 기록' }
    ]
  }
]

const OTHER_LABEL: Partial<Record<PageId, string>> = { 도우미: '업무 도우미', 검색: '통합 검색', 설정: '설정' }

export function tabOf(page: PageId): TabId | null {
  return TABS.find((t) => t.subs.some((s) => s.page === page))?.id ?? null
}

/** Ctrl+K — 물어보기 바로 커서를 옮긴다 */
export function focusAsk(): void {
  window.dispatchEvent(new Event('wd:focus-ask'))
}

interface Props {
  page: PageId
  onGo: (p: PageId) => void
  jobTitle: string
  schoolName: string
  navp: NavPrefs
  ocrBusy: boolean
  chatBusy: boolean
  newTools: boolean
  feedback: string
  onLearn: () => void
  onFeedback: () => void
  children: ReactNode
}

export default function NewShell(props: Props): JSX.Element {
  const { page, onGo, navp } = props
  const tab = tabOf(page)
  const [makeOpen, setMakeOpen] = useState(false)
  const [q, setQ] = useState('')
  const askRef = useRef<HTMLInputElement>(null)
  const makeRef = useRef<HTMLDivElement>(null)
  const makeBtn = useRef<HTMLButtonElement>(null)
  /** 탭마다 마지막에 본 칸 · 탭 밖 화면에서 돌아갈 곳 */
  const lastSub = useRef<Partial<Record<TabId, PageId>>>({})
  const back = useRef<PageId>('홈')
  if (tab) {
    lastSub.current[tab] = page
    back.current = page
  }

  useEffect(() => {
    const focus = (): void => {
      askRef.current?.focus()
      askRef.current?.select()
    }
    window.addEventListener('wd:focus-ask', focus)
    return () => window.removeEventListener('wd:focus-ask', focus)
  }, [])

  // 만들기 팝업: 바깥을 누르거나 Esc 면 닫고, 열면 첫 항목에 커서
  useEffect(() => {
    if (!makeOpen) return
    makeRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node
      if (makeRef.current?.contains(t) || makeBtn.current?.contains(t)) return
      setMakeOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setMakeOpen(false)
      makeBtn.current?.focus()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [makeOpen])

  const go = (p: PageId): void => {
    setMakeOpen(false)
    onGo(p)
  }

  const ask = (e: FormEvent): void => {
    e.preventDefault()
    const text = q.trim()
    if (!text) {
      askRef.current?.focus()
      return
    }
    // 새 대화를 열고 입력칸에 옮겨 적는다 — 보내기 전에 한 번 더 볼 수 있다
    newChat()
    queueChat(text)
    setQ('')
    onGo('도우미')
  }
  const find = (): void => {
    const text = q.trim()
    if (text) queueSearch(text)
    setQ('')
    onGo('검색')
  }

  const curTab = TABS.find((t) => t.id === tab)
  const subs = curTab ? curTab.subs.filter((s) => s.page === '홈' || isShown(navp, s.page)) : []
  const makeItem = MAKE.flatMap((g) => g.items).find((m) => m.page === page)
  const crumb = !tab ? (makeItem ? `만들기 › ${makeItem.label}` : OTHER_LABEL[page] ?? page) : ''
  const showAsk = page !== '도우미' && page !== '검색'

  return (
    <div className="nshell">
      <header className="ns-top">
        <div className="ns-brand">
          <span className="ns-logo" aria-hidden="true">
            <Icon name="box" size={16} />
          </span>
          <span className="ns-brand-text">
            <b>{props.schoolName || '업무 대시보드'}</b>
            <small>{props.jobTitle}</small>
          </span>
        </div>

        <nav className="ns-tabs" aria-label="화면">
          {TABS.map((t) => (
            <button
              key={t.id}
              data-page={t.subs[0].page}
              className={tab === t.id ? 'on' : ''}
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => go(lastSub.current[t.id] ?? t.subs[0].page)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="ns-tools">
          <button
            ref={makeBtn}
            className={`ns-make ${makeOpen ? 'on' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={makeOpen}
            onClick={() => setMakeOpen((v) => !v)}
          >
            <Icon name="plus" size={16} />
            만들기
            {props.ocrBusy && <i className="nav-busy" aria-label="읽는 중" />}
            {!props.ocrBusy && props.newTools && <i className="nav-new" aria-label="새 도구" />}
          </button>
          <button className="ns-icon" onClick={props.onLearn} aria-label="따라 배우기 (F1)" title="따라 배우기 (F1)">
            <Icon name="cap" size={18} />
          </button>
          {props.feedback && (
            <button className="ns-icon" onClick={props.onFeedback} aria-label="의견 · 오류 보내기" title="의견 · 오류 보내기">
              <Icon name="chat" size={18} />
            </button>
          )}
          <button
            data-page="설정"
            className={`ns-icon ${page === '설정' ? 'on' : ''}`}
            onClick={() => go('설정')}
            aria-label="설정"
            title="설정"
          >
            <Icon name="sliders" size={18} />
          </button>
        </div>

        {makeOpen && (
          <div ref={makeRef} className="ns-pop" role="dialog" aria-label="만들기">
            {MAKE.map((g) => {
              const items = g.items.filter((m) => isShown(navp, m.page))
              if (!items.length) return null
              return (
                <div key={g.title} className="ns-pop-group">
                  <div className="ns-pop-title">{g.title}</div>
                  <div className="ns-pop-grid">
                    {items.map((m) => (
                      <button key={m.page} data-page={m.page} className={`ns-pop-item ${page === m.page ? 'on' : ''}`} onClick={() => go(m.page)}>
                        <span className="ns-pop-ico">
                          <Icon name={m.icon} size={20} />
                          {m.page === 'OCR' && props.ocrBusy && <i className="nav-busy" aria-label="읽는 중" />}
                          {m.page === '도구' && props.newTools && <i className="nav-new" aria-label="새 도구" />}
                        </span>
                        <span className="ns-pop-text">
                          <b>{m.label}</b>
                          <small>{m.desc}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </header>

      {subs.length > 1 && (
        <div className="ns-subs" aria-label={`${curTab!.label} 안의 화면`}>
          {subs.map((s) => (
            <button key={s.page} data-page={s.page} className={page === s.page ? 'on' : ''} aria-current={page === s.page ? 'page' : undefined} onClick={() => go(s.page)}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      {!tab && (
        <div className="ns-crumb">
          <button className="ns-back" onClick={() => go(back.current)}>
            <Icon name="chevron" size={14} />
            돌아가기
          </button>
          <span>{crumb}</span>
        </div>
      )}

      <main className={`main ns-main ${page === '도우미' ? 'main-chat' : ''} ${showAsk ? 'has-ask' : ''}`}>{props.children}</main>

      {showAsk && (
        <form className="ns-ask" onSubmit={ask}>
          <span className="ns-ask-ico" aria-hidden="true">
            <Icon name="spark" size={17} />
          </span>
          {props.chatBusy && <i className="nav-busy ns-ask-busy" aria-label="도우미가 답을 쓰는 중" />}
          <input
            ref={askRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="업무 도우미에게 묻거나 찾기 (Ctrl+K)"
            aria-label="업무 도우미에게 묻거나 찾기"
          />
          <button type="button" className="ns-ask-find" onClick={find} aria-label="통합 검색에서 찾기" title="통합 검색에서 찾기">
            <Icon name="search" size={16} />
          </button>
          <button type="submit" className="ns-ask-go" aria-label="업무 도우미에게 보내기" title="업무 도우미 화면으로 옮겨 적습니다">
            <Icon name="up" size={16} />
          </button>
        </form>
      )}
    </div>
  )
}
