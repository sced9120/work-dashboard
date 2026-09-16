import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatFile, ChatTurn, ModelChoice } from '../../shared/types'
import { buildPlan, splitAnswer, type PlanItem } from '../../shared/agent'
import type { PageId } from '../App'
import { useToast } from '../lib/toast'
import ModelPicker from '../components/ModelPicker'

interface Props {
  jobTitle: string
  onGo: (p: PageId) => void
}

/** 화면에 그리는 한 마디. 도우미 답에는 근거 자료 이름이 붙는다. */
interface Msg extends ChatTurn {
  sources?: string[]
  error?: boolean
  /** 이 마디와 함께 올린 파일 이름 */
  files?: string[]
  /** 도우미가 내민 일감. 사람이 누르기 전에는 아무 일도 일어나지 않는다. */
  plan?: PlanItem[]
  /** 어느 것을 넣을지 — 처음에는 모두 켜 둔다 */
  picked?: boolean[]
  /** 넣었는지, 안 넣기로 했는지 */
  planDone?: '넣음' | '안 함'
  planCount?: number
}

const SUGGESTIONS = [
  '9월 16일부터 11월 30일까지 매주 목요일 방과후 1-7반으로 넣어 줘',
  '올해 이 업무에서 놓치면 안 되는 기한들을 정리해 줘',
  '이 업무가 접수되면 처리 절차를 순서대로 알려 줘',
  '이 업무를 처음 맡는 사람에게 3월에 할 일을 알려 줘'
]

export default function Chat({ jobTitle, onGo }: Props): JSX.Element {
  const toast = useToast()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [hasKey, setHasKey] = useState(true)
  const [docCount, setDocCount] = useState(0)
  const [model, setModel] = useState<ModelChoice | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  /** 올려 둔 파일. 보낼 때 함께 넘어간다. */
  const [files, setFiles] = useState<ChatFile[]>([])
  const [reading, setReading] = useState(false)

  /**
   * 이 대화에서는 묻지 않고 바로 넣기.
   *
   * 프로그램을 끄거나 [새 대화] 를 누르면 다시 묻는다. 남의 자료를 건드리는
   * 일이라 기본은 늘 "묻기" 다.
   */
  const [trust, setTrust] = useState(false)

  useEffect(() => {
    void (async () => {
      setDocCount(await window.api.docs.count())
      const s = await window.api.local.load()
      setHasKey(!!(s.openai_key || s.gemini_key || s.claude_key))
    })()
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [msgs, busy])

  const attach = async (): Promise<void> => {
    const picked = await window.api.files.pick()
    if (!picked.length) return
    setReading(true)
    try {
      const added: ChatFile[] = []
      for (const p of picked) {
        const doc = await window.api.files.extract(p.path)
        if (doc.error) toast(`${p.name}: ${doc.error}`, 'err')
        else if (doc.text.trim()) added.push({ name: p.name, text: doc.text })
      }
      if (added.length) {
        setFiles((prev) => [...prev, ...added])
        toast(`${added.length}개를 올렸습니다. 이어서 무엇을 할지 적어 주세요.`, 'ok')
      }
    } finally {
      setReading(false)
    }
  }

  /**
   * 일감을 실제로 넣는다. 여기서 처음으로 자료가 바뀐다.
   *
   * 넣을 것을 인자로 받는다. 화면 상태에서 다시 찾으면, 방금 받은 답을
   * 곧바로 넣는 경우에 아직 담기지 않은 것을 뒤지게 된다.
   */
  const runPlan = async (at: number, items: PlanItem[]): Promise<void> => {
    if (!items.length) {
      toast('넣을 것을 하나 이상 골라 주세요.', 'err')
      return
    }

    const events = items.filter((x) => x.event).map((x) => x.event!)
    const tasks = items.filter((x) => x.task).map((x) => x.task!)
    for (const e of events) await window.api.events.add(e)
    if (tasks.length) await window.api.tasks.addMany(tasks)

    setMsgs((prev) =>
      prev.map((m, i) => (i === at ? { ...m, planDone: '넣음', planCount: items.length } : m))
    )
    toast(
      `${events.length ? `일정 ${events.length}건` : ''}${events.length && tasks.length ? ' · ' : ''}${
        tasks.length ? `업무 ${tasks.length}건` : ''
      } 을 넣었습니다.`,
      'ok'
    )
  }

  const send = async (text: string): Promise<void> => {
    const q = text.trim()
    if ((!q && !files.length) || busy) return
    if (!hasKey) {
      toast('먼저 설정에서 API 키를 넣어 주세요.', 'err')
      return
    }

    const sent = files
    const next: Msg[] = [
      ...msgs,
      { role: 'user', content: q, files: sent.map((f) => f.name) }
    ]
    setMsgs(next)
    setInput('')
    setFiles([])
    setBusy(true)
    try {
      const history: ChatTurn[] = next.map((m) => ({ role: m.role, content: m.content }))
      const res = await window.api.ai.chat({
        jobTitle,
        history,
        files: sent,
        model: model ?? undefined
      })
      if (!res.ok) {
        toast(res.error ?? '답변을 만들지 못했습니다.', 'err')
        setMsgs((prev) => [
          ...prev,
          { role: 'assistant', content: res.error ?? '답변을 만들지 못했습니다.', error: true }
        ])
        return
      }

      const { text: answer, actions } = splitAnswer(res.answer)
      const plan = buildPlan(actions)
      const reply: Msg = {
        role: 'assistant',
        content: answer || (plan.length ? '이렇게 넣을까요?' : ''),
        sources: res.sources,
        ...(plan.length ? { plan, picked: plan.map(() => true) } : {})
      }
      setMsgs((prev) => [...prev, reply])

      // [이 대화에서는 묻지 않기] 를 켜 두었으면 바로 넣는다
      if (plan.length && trust) await runPlan(next.length, plan)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send(input)
    }
  }

  const welcome = useMemo(
    () => (
      <div className="chat-welcome">
        <div className="chat-welcome-emoji">💬</div>
        <div className="chat-welcome-title">무엇을 도와드릴까요?</div>
        <p className="muted small" style={{ maxWidth: 480, textAlign: 'center' }}>
          {docCount > 0 ? (
            <>보관된 공문 원문 {docCount.toLocaleString()}건과 등록된 업무·일지를 근거로 답합니다.</>
          ) : (
            <>
              아직 보관된 공문이 없습니다.{' '}
              <button className="link" onClick={() => onGo('학습')}>
                [문서로 업무 만들기]
              </button>{' '}
              에서 공문을 올리면 그 내용을 근거로 답할 수 있습니다.
            </>
          )}
          <br />
          <b>일정이나 업무를 넣어 달라고 하셔도 됩니다.</b> 넣을 목록을 먼저 보여 드리고, 누르시면
          그때 들어갑니다.
        </p>
        <div className="chat-suggest">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chat-suggest-btn" onClick={() => void send(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
      </div>
    ),
    // send 는 매번 새로 만들어지므로 넣지 않는다. 눌렀을 때의 값이면 충분하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docCount, busy]
  )

  return (
    <div className="chat-page">
      <div className="page-head" style={{ marginBottom: 12 }}>
        <h1>업무 도우미</h1>
        <p>
          보관해 둔 공문·업무·일지를 바탕으로 묻고 답합니다. 파일을 올려 함께 보거나, 일정·업무를
          넣어 달라고 할 수도 있습니다.
        </p>
      </div>

      {!hasKey && (
        <div className="note note-warn" style={{ marginBottom: 12 }}>
          AI 도우미는 API 키가 있어야 씁니다.{' '}
          <button className="link" onClick={() => onGo('설정')}>
            설정에서 키 넣기
          </button>
        </div>
      )}

      {hasKey && (
        <ModelPicker feature="chat" label="이 대화에 쓸 모델" onReady={setModel} onChange={setModel} />
      )}

      <div className="chat-thread">
        {msgs.length === 0 ? (
          welcome
        ) : (
          <div className="chat-list">
            {msgs.map((m, i) => (
              <div key={i} className={`chat-row ${m.role}`}>
                <div className={`chat-bubble ${m.role} ${m.error ? 'err' : ''}`}>
                  {m.files && m.files.length > 0 && (
                    <div className="chat-files">
                      {m.files.map((f) => (
                        <span key={f} className="chat-file-chip" title={f}>
                          📄 {f}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.content && <div className="chat-text">{m.content}</div>}

                  {m.plan && (
                    <div className="plan">
                      <div className="plan-head">
                        <b>이렇게 넣을까요?</b>
                        <span className="badge badge-accent">{m.plan.length}건</span>
                        {m.planDone && (
                          <span className={`badge ${m.planDone === '넣음' ? 'badge-accent' : ''}`}>
                            {m.planDone === '넣음' ? `${m.planCount}건 넣었습니다` : '넣지 않았습니다'}
                          </span>
                        )}
                      </div>

                      <div className="plan-list">
                        {m.plan.map((p, pi) => (
                          <label key={pi} className={`plan-item ${m.planDone ? 'locked' : ''}`}>
                            <input
                              type="checkbox"
                              checked={m.picked?.[pi] ?? false}
                              disabled={!!m.planDone}
                              onChange={() =>
                                setMsgs((prev) =>
                                  prev.map((x, xi) =>
                                    xi === i
                                      ? {
                                          ...x,
                                          picked: (x.picked ?? []).map((v, vi) =>
                                            vi === pi ? !v : v
                                          )
                                        }
                                      : x
                                  )
                                )
                              }
                            />
                            <span className="plan-kind">{p.kind}</span>
                            <span className="plan-label">{p.label}</span>
                          </label>
                        ))}
                      </div>

                      {!m.planDone ? (
                        <div className="plan-foot">
                          <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={trust}
                              onChange={(e) => setTrust(e.target.checked)}
                              style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
                            />
                            <span className="small muted">이 대화에서는 묻지 않고 바로 넣기</span>
                          </label>
                          <span className="spacer" />
                          <button
                            className="btn btn-sm"
                            onClick={() =>
                              setMsgs((prev) =>
                                prev.map((x, xi) =>
                                  xi === i ? { ...x, planDone: '안 함', planCount: 0 } : x
                                )
                              )
                            }
                          >
                            안 넣기
                          </button>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() =>
                              void runPlan(
                                i,
                                (m.plan ?? []).filter((_, pi) => m.picked?.[pi])
                              )
                            }
                          >
                            {(m.picked ?? []).filter(Boolean).length}건 넣기
                          </button>
                        </div>
                      ) : (
                        m.planDone === '넣음' && (
                          <div className="plan-foot">
                            <span className="spacer" />
                            <button className="btn btn-sm" onClick={() => onGo('달력')}>
                              달력에서 보기
                            </button>
                            <button className="btn btn-sm" onClick={() => onGo('로드맵')}>
                              로드맵에서 보기
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  )}

                  {m.sources && m.sources.length > 0 && (
                    <div className="chat-sources">
                      <span className="chat-sources-label">근거</span>
                      {m.sources.map((s, si) => (
                        <span key={si} className="chat-source-chip" title={s}>
                          [{si + 1}] {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="chat-row assistant">
                <div className="chat-bubble assistant">
                  <span className="chat-typing">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {files.length > 0 && (
        <div className="chat-attached">
          <span className="small muted">함께 보낼 파일</span>
          {files.map((f, i) => (
            <span key={`${f.name}${i}`} className="chat-file-chip">
              📄 {f.name} <span className="muted">{f.text.length.toLocaleString()}자</span>
              <button
                className="chat-file-x"
                title="빼기"
                onClick={() => setFiles((prev) => prev.filter((_, xi) => xi !== i))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="chat-composer">
        {msgs.length > 0 && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setMsgs([])
              setFiles([])
              setTrust(false)
            }}
            disabled={busy}
            title="대화를 지우고 새로 시작합니다"
          >
            새 대화
          </button>
        )}
        <button
          className="btn btn-sm"
          onClick={() => void attach()}
          disabled={busy || reading || !hasKey}
          title="공문이나 서식을 올려 함께 보며 이야기합니다"
        >
          {reading ? '읽는 중…' : '📎 파일'}
        </button>
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            hasKey
              ? '무엇이든 물어보세요. 넣어 달라고 하셔도 됩니다. (Enter 전송 · Shift+Enter 줄바꿈)'
              : '설정에서 API 키를 먼저 넣어 주세요.'
          }
          rows={1}
          disabled={busy || !hasKey}
        />
        <button
          className="btn btn-primary"
          onClick={() => void send(input)}
          disabled={busy || (!input.trim() && !files.length) || !hasKey}
        >
          {busy ? '…' : '보내기'}
        </button>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        답은 AI가 만든 것이라 틀릴 수 있습니다. <b>넣기 전에 날짜와 건수를 꼭 확인하세요.</b>{' '}
        도우미는 더하기만 할 수 있고, 지우거나 고치지는 못합니다.
      </p>
    </div>
  )
}
