import { useEffect, useRef, useState } from 'react'
import type { ChatTurn, ModelChoice } from '../../shared/types'
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
}

const SUGGESTIONS = [
  '올해 이 업무에서 놓치면 안 되는 기한들을 정리해 줘',
  '학교폭력 사안이 접수되면 처리 절차를 순서대로 알려 줘',
  '보관된 공문 중에 예산·강사비와 관련된 게 있으면 요약해 줘',
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

  const send = async (text: string): Promise<void> => {
    const q = text.trim()
    if (!q || busy) return
    if (!hasKey) {
      toast('먼저 설정에서 API 키를 넣어 주세요.', 'err')
      return
    }

    const next: Msg[] = [...msgs, { role: 'user', content: q }]
    setMsgs(next)
    setInput('')
    setBusy(true)
    try {
      const history: ChatTurn[] = next.map((m) => ({ role: m.role, content: m.content }))
      const res = await window.api.ai.chat({ jobTitle, history, model: model ?? undefined })
      if (!res.ok) {
        toast(res.error ?? '답변을 만들지 못했습니다.', 'err')
        setMsgs((prev) => [
          ...prev,
          { role: 'assistant', content: res.error ?? '답변을 만들지 못했습니다.', error: true }
        ])
        return
      }
      setMsgs((prev) => [...prev, { role: 'assistant', content: res.answer, sources: res.sources }])
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

  return (
    <div className="chat-page">
      <div className="page-head" style={{ marginBottom: 12 }}>
        <h1>업무 도우미</h1>
        <p>
          이 프로그램에 보관해 둔 공문·업무·일지를 바탕으로 묻고 답합니다. 근거가 된 자료의 이름을
          함께 보여 줍니다.
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
          <div className="chat-welcome">
            <div className="chat-welcome-emoji">💬</div>
            <div className="chat-welcome-title">무엇을 도와드릴까요?</div>
            <p className="muted small" style={{ maxWidth: 460, textAlign: 'center' }}>
              {docCount > 0 ? (
                <>
                  보관된 공문 원문 {docCount.toLocaleString()}건과 등록된 업무·일지를 근거로
                  답합니다.
                </>
              ) : (
                <>
                  아직 보관된 공문이 없습니다.{' '}
                  <button className="link" onClick={() => onGo('학습')}>
                    [문서로 업무 만들기]
                  </button>{' '}
                  에서 공문을 올리면 그 내용을 근거로 답할 수 있습니다. 지금도 일반적인 안내는
                  가능합니다.
                </>
              )}
            </p>
            <div className="chat-suggest">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="chat-suggest-btn"
                  onClick={() => void send(s)}
                  disabled={busy}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-list">
            {msgs.map((m, i) => (
              <div key={i} className={`chat-row ${m.role}`}>
                <div className={`chat-bubble ${m.role} ${m.error ? 'err' : ''}`}>
                  <div className="chat-text">{m.content}</div>
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

      <div className="chat-composer">
        {msgs.length > 0 && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setMsgs([])}
            disabled={busy}
            title="대화를 지우고 새로 시작합니다"
          >
            새 대화
          </button>
        )}
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            hasKey ? '무엇이든 물어보세요. (Enter 전송 · Shift+Enter 줄바꿈)' : '설정에서 API 키를 먼저 넣어 주세요.'
          }
          rows={1}
          disabled={busy || !hasKey}
        />
        <button
          className="btn btn-primary"
          onClick={() => void send(input)}
          disabled={busy || !input.trim() || !hasKey}
        >
          {busy ? '…' : '보내기'}
        </button>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        답은 AI가 만든 것이라 틀릴 수 있습니다. 중요한 내용은 근거로 표시된 원문을 직접 확인하세요.
      </p>
    </div>
  )
}
