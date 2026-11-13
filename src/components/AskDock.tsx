import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { PageId } from '../App'
import { queueChat, queueSearch } from '../lib/chatBridge'
import { docsOf, initChats, liveText, newChat, openChat, planSummary, runPlan, sendChat, stopChat, updateMsg, useChats } from '../lib/chatStore'
import { useToast } from '../lib/toast'
import Icon from './Icon'
import Markdown from './Markdown'

/**
 * 새 화면 아래의 업무 도우미 말상자 + 옆 대화창.
 *
 * 말상자는 평소에 작게 떠 있다가, 마우스를 올리거나 글을 치면 넓어지고 [창으로] 단추가 보내기 단추 옆에 튀어나온다.
 * 물으면 화면을 옮기지 않고 오른쪽에 대화창이 열려 그 자리에서 이어 묻는다.
 * [창으로]를 누르면 같은 대화를 업무 도우미 화면 전체로 연다(받던 답도 그대로 이어진다).
 * 대화는 업무 도우미 화면과 같은 저장소(chatStore)를 쓴다 — 옆창에서 한 대화는 도우미 대화 목록에도 남는다.
 */
interface Props {
  page: PageId
  onGo: (p: PageId) => void
  jobTitle: string
}

export function focusAskEvent(): void {
  window.dispatchEvent(new Event('wd:focus-ask'))
}

export default function AskDock({ page, onGo, jobTitle }: Props): JSX.Element | null {
  const chats = useChats()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [chatId, setChatId] = useState('')
  const [hover, setHover] = useState(false)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const hidden = page === '도우미' || page === '검색'
  const rec = chatId ? chats.recs[chatId] : undefined
  const live = chatId ? chats.live[chatId] : undefined
  const wide = hover || focused || !!q || open

  useEffect(() => {
    void initChats()
  }, [])

  // 폰에서 수업 관찰 · 출결이 들어오면 어느 화면에 있든 알린다 ([지금 가져오기] 로 직접 가져온 때는 그 카드가 알린다)
  useEffect(() => {
    let manual = 0
    const mark = (): void => {
      manual = Date.now()
    }
    window.addEventListener('relay:manual-pull', mark)
    const off = window.api.relay.onRouted((r) => {
      if (Date.now() - manual < 20000) return
      const parts = [r.obs ? `수업 관찰 ${r.obs}건` : '', r.att ? `출결 ${r.att}건` : ''].filter(Boolean)
      if (parts.length) toast(`폰에서 ${parts.join(' · ')}이 들어왔습니다.`, 'ok')
    })
    return () => {
      off()
      window.removeEventListener('relay:manual-pull', mark)
    }
  }, [toast])

  // Ctrl+K — 말상자로 커서
  useEffect(() => {
    const focus = (): void => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('wd:focus-ask', focus)
    return () => window.removeEventListener('wd:focus-ask', focus)
  }, [])

  // Esc — 옆창 닫기 (말상자에 글이 있으면 글부터 지운다)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (document.activeElement === inputRef.current && q) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, q])

  // 새 마디 · 받는 글이 오면 맨 아래로
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [rec?.messages.length, live?.text, open])

  // 도우미 화면으로 옮기면 옆창은 닫는다(같은 대화가 그 화면에 열린다)
  useEffect(() => {
    if (hidden) setOpen(false)
  }, [hidden])

  if (hidden) return null

  const ask = (e: FormEvent): void => {
    e.preventDefault()
    const text = q.trim()
    if (!text) {
      inputRef.current?.focus()
      return
    }
    // 옆창이 열려 있으면 그 대화에 이어 묻고, 아니면 새 업무 도우미 대화로 시작한다
    let id = open && rec ? chatId : ''
    if (!id) {
      id = newChat('work')
      setChatId(id)
    }
    setOpen(true)
    setQ('')
    void sendChat(id, text, [], { jobTitle, model: null })
  }

  /** 업무 도우미 화면 전체로 — 옆창 대화가 있으면 그 대화를, 말상자에 글만 있으면 그 글을 옮겨 적어 둔다 */
  const toWindow = (): void => {
    const text = q.trim()
    if (open && rec && rec.messages.length) {
      void openChat(chatId)
      if (text) queueChat(text)
    } else if (text) {
      newChat('work')
      queueChat(text)
    }
    setQ('')
    setOpen(false)
    onGo('도우미')
  }

  const find = (): void => {
    const text = q.trim()
    if (text) queueSearch(text)
    setQ('')
    onGo('검색')
  }

  const fresh = (): void => {
    const id = newChat('work')
    setChatId(id)
    inputRef.current?.focus()
  }

  const messages = rec?.messages ?? []

  return (
    <>
      {open && (
        <aside className="ask-side" aria-label="업무 도우미 대화">
          <header className="ask-side-head">
            <span className="ask-side-title">
              <Icon name="spark" size={16} />
              <b>{rec && rec.title !== '새 대화' ? rec.title : '업무 도우미'}</b>
            </span>
            <span className="spacer" />
            <button className="btn btn-sm btn-ghost" onClick={fresh} disabled={!!live} title="새 대화를 시작합니다">
              새 대화
            </button>
            <button className="btn btn-sm" onClick={toWindow} title="이 대화를 업무 도우미 화면 전체로 엽니다">
              창으로
            </button>
            <button className="ask-side-x" onClick={() => setOpen(false)} aria-label="옆 대화창 닫기" title="닫기 (Esc)">
              ×
            </button>
          </header>
          <div ref={bodyRef} className="ask-side-body">
            {!messages.length && !live && <p className="small muted ask-side-empty">아래 말상자에 물어보세요. 화면은 그대로 두고 여기서 이어 묻습니다.</p>}
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="ask-msg ask-me">
                  {m.content}
                </div>
              ) : (
                <div key={i} className={`ask-msg ask-ai ${m.error ? 'ask-err' : ''}`}>
                  {m.content.trim() ? <Markdown text={m.content} /> : m.error ? '답을 받지 못했습니다.' : null}
                  {m.plan && m.plan.length > 0 && (
                    <div className="ask-plan">
                      <ul>
                        {m.plan.slice(0, 6).map((p, pi) => (
                          <li key={pi}>
                            <span className="plan-kind">{p.kind}</span> {p.label}
                          </li>
                        ))}
                        {m.plan.length > 6 && <li className="muted">외 {m.plan.length - 6}건</li>}
                      </ul>
                      {m.planDone ? (
                        <span className="small muted">{m.planDone === '넣음' ? `${m.planCount}건 넣었습니다` : '넣지 않았습니다'}</span>
                      ) : (
                        <div className="ask-plan-btns">
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() =>
                              void (async () => {
                                const n = await runPlan(chatId, i, m.plan ?? [])
                                toast(planSummary(n), 'ok')
                              })()
                            }
                          >
                            {m.plan.length}건 넣기
                          </button>
                          <button className="btn btn-sm btn-ghost" onClick={() => updateMsg(chatId, i, { planDone: '안 함', planCount: 0 })}>
                            넣지 않기
                          </button>
                          <button className="link small" onClick={toWindow}>
                            골라서 넣기 →
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {docsOf(m).length > 0 && (
                    <button className="link small ask-more" onClick={toWindow}>
                      한글 파일 카드는 창에서 보기 →
                    </button>
                  )}
                </div>
              )
            )}
            {live && (
              <div className="ask-msg ask-ai ask-live">
                {liveText(rec, live.text).trim() ? <Markdown text={liveText(rec, live.text)} /> : <span className="muted small">생각하는 중…</span>}
              </div>
            )}
          </div>
          {live && (
            <div className="ask-side-foot">
              <button className="btn btn-sm" onClick={() => stopChat(chatId)}>
                멈추기
              </button>
            </div>
          )}
        </aside>
      )}

      <form
        className={`ns-ask ${wide ? 'wide' : ''} ${open ? 'docked' : ''}`}
        onSubmit={ask}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
        }}
      >
        <span className="ns-ask-ico" aria-hidden="true">
          <Icon name="spark" size={17} />
        </span>
        {Object.keys(chats.live).length > 0 && <i className="nav-busy ns-ask-busy" aria-label="도우미가 답을 쓰는 중" />}
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={open ? '이어서 물어보기' : wide ? '업무 도우미에게 묻거나 찾기 (Ctrl+K)' : '업무 도우미'}
          aria-label="업무 도우미에게 묻거나 찾기"
        />
        <button type="button" className="ns-ask-find" onClick={find} aria-label="통합 검색에서 찾기" title="통합 검색에서 찾기" tabIndex={wide ? 0 : -1}>
          <Icon name="search" size={16} />
        </button>
        <button type="submit" className="ns-ask-go" aria-label="업무 도우미에게 묻기" title="옆 대화창에서 묻습니다">
          <Icon name="up" size={16} />
        </button>
        {wide && (
          <button type="button" className="ns-ask-win" onClick={toWindow} aria-label="업무 도우미 창으로 전환" title="업무 도우미 화면 전체로 엽니다">
            <Icon name="out" size={15} />
            <span>창으로</span>
          </button>
        )}
      </form>
    </>
  )
}
