import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatFile, ChatTurn, ModelChoice } from '../../shared/types'
import { buildPlan, splitAnswer, type DocRequest, type PlanItem } from '../../shared/agent'
import type { FormRef, HwpForm, HwpKind } from '../../shared/hwpform'
import type { PageId } from '../App'
import { queueCommitteeTab, takeChat } from '../lib/chatBridge'
import { useToast } from '../lib/toast'
import { todayStr } from '../lib/util'
import FormFillCard from '../components/FormFillCard'
import ModelPicker from '../components/ModelPicker'

interface Props {
  jobTitle: string
  onGo: (p: PageId) => void
}

/** 도우미가 내민 한글 파일 만들기 부탁과, 그것을 어느 양식으로 알아들었는지 */
interface ChatDoc {
  req: DocRequest
  /** 찾은 양식. 양식 없이 만들거나 못 찾았으면 null */
  ref: FormRef | null
  kind: HwpKind | null
  formName: string
  /** [이 내용으로 다시 쓰기] 를 누를 때마다 늘려 확인 카드를 새로 그린다 */
  round: number
  /** 양식 없이 저장한 곳 */
  saved?: string
}

/** 이 대화에 올린 한글 파일. 양식으로 쓸 수 있다. 보관함에는 넣지 않는다. */
interface FormFile {
  name: string
  path: string
}

/** 양식 이름을 비교할 때 띄어쓰기·꺾쇠·확장자는 보지 않는다 */
const formKey = (s: string): string =>
  s
    .replace(/\(이 대화에 올린 파일\)/, '')
    .replace(/\.(hwpx?)$/i, '')
    .replace(/[\s「」『』'"“”‘’]/g, '')
    .toLowerCase()

/**
 * 도우미가 적은 양식 이름을 넣어 둔 양식이나 올린 파일에서 찾는다.
 * 똑같은 이름을 먼저 보고, 없으면 한쪽이 다른 쪽을 품는 것이 하나뿐일 때만 고른다.
 */
function findForm(
  name: string,
  forms: HwpForm[],
  files: FormFile[]
): { ref: FormRef; kind: HwpKind; formName: string } | null {
  const k = formKey(name)
  if (!k) return null
  const kindOfName = (n: string): HwpKind => (/\.hwpx$/i.test(n) ? 'hwpx' : 'hwp')
  const exact = forms.find((f) => formKey(f.name) === k || formKey(f.filename) === k)
  if (exact) return { ref: { id: exact.id }, kind: exact.kind, formName: exact.name }
  const file = files.find((f) => formKey(f.name) === k)
  if (file) return { ref: { path: file.path, name: file.name }, kind: kindOfName(file.name), formName: file.name }
  const near = forms.filter((f) => formKey(f.name).includes(k) || k.includes(formKey(f.name)))
  if (near.length === 1) return { ref: { id: near[0].id }, kind: near[0].kind, formName: near[0].name }
  const nearFile = files.filter((f) => formKey(f.name).includes(k) || k.includes(formKey(f.name)))
  if (nearFile.length === 1) {
    return { ref: { path: nearFile[0].path, name: nearFile[0].name }, kind: kindOfName(nearFile[0].name), formName: nearFile[0].name }
  }
  return null
}

/** 화면에 그리는 한 마디. 도우미 답에는 근거 자료 이름이 붙는다. */
interface Msg extends ChatTurn {
  sources?: string[]
  /** 근거로 실은 학교업무 도움자료의 자료 폴더 */
  links?: { title: string; url: string }[]
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
  /** 도우미가 내민 한글 파일 만들기 */
  doc?: ChatDoc
}

const SUGGESTIONS = [
  '9월 16일부터 11월 30일까지 매주 목요일 방과후 1-7반으로 넣어 줘',
  '올해 이 업무에서 놓치면 안 되는 기한들을 정리해 줘',
  '이 업무가 접수되면 처리 절차를 순서대로 알려 줘',
  '이 업무를 처음 맡는 사람에게 3월에 할 일을 알려 줘'
]

/** 도우미가 내민 한글 파일 만들기 카드 */
function DocCard({
  doc,
  forms,
  model,
  onChange,
  onGo
}: {
  doc: ChatDoc
  forms: HwpForm[]
  model: ModelChoice | null
  onChange: (next: ChatDoc) => void
  onGo: (p: PageId) => void
}): JSX.Element {
  const toast = useToast()
  const [draft, setDraft] = useState(doc.req.content)
  const [name, setName] = useState(doc.req.fileName || `문서_${todayStr()}`)
  const [busy, setBusy] = useState(false)
  const fileName = doc.req.fileName || `${doc.formName}_${todayStr()}`

  // 양식을 찾았으면 곧바로 양식을 틀로 새 문서를 쓴다 (저장은 확인한 뒤)
  if (doc.req.form && doc.ref && doc.kind) {
    return (
      <div className="plan">
        <details className="doc-content">
          <summary className="small muted">도우미가 정리한 내용 ({doc.req.content.length.toLocaleString()}자) — 고쳐서 다시 쓰게 할 수 있습니다</summary>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} style={{ minHeight: 140, marginTop: 6 }} />
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="btn btn-sm"
              onClick={() => onChange({ ...doc, req: { ...doc.req, content: draft }, round: doc.round + 1 })}
              disabled={!draft.trim()}
            >
              이 내용으로 다시 쓰기
            </button>
          </div>
        </details>
        <FormFillCard
          key={doc.round}
          form={doc.ref}
          formName={doc.formName}
          kind={doc.kind}
          content={doc.req.content}
          fileName={fileName}
          model={model}
          compact
        />
      </div>
    )
  }

  if (doc.req.form) {
    return (
      <div className="plan">
        <div className="note note-warn">
          「{doc.req.form}」 양식을 찾지 못했습니다.{' '}
          {forms.length ? <>넣어 둔 양식: {forms.map((f) => `「${f.name}」`).join(', ')}</> : '넣어 둔 양식이 없습니다.'}
        </div>
        <div className="plan-foot">
          <span className="spacer" />
          <button
            className="btn btn-sm"
            onClick={() => {
              queueCommitteeTab('보관함')
              onGo('위원회')
            }}
          >
            양식 넣으러 가기
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => onChange({ ...doc, req: { ...doc.req, form: '' } })}>
            양식 없이 한글 파일로
          </button>
        </div>
      </div>
    )
  }

  // 양식 없이 한글 기본 모양으로
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await window.api.hwp.newDoc({ name, text: draft })
      toast(res.message, res.ok ? 'ok' : 'err')
      if (res.ok && res.path) onChange({ ...doc, saved: res.path })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="plan">
      <div className="plan-head">
        <b>📄 한글 파일로 만들까요?</b>
        <span className="badge">양식 없이 · .hwpx</span>
      </div>
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} style={{ minHeight: 160 }} />
      <div className="row" style={{ marginTop: 8, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1, minWidth: 180, marginBottom: 0 }}>
          <label>저장할 파일 이름</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !draft.trim()}>
          {busy ? '만드는 중…' : '💾 한글 파일로 저장'}
        </button>
      </div>
      {doc.saved && (
        <div className="note note-ok" style={{ marginTop: 8 }}>
          저장했습니다: {doc.saved}
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn btn-sm btn-primary" onClick={() => void window.api.hwp.open(doc.saved ?? '')}>
              한글로 열기
            </button>
            <button className="btn btn-sm" onClick={() => void window.api.hwp.reveal(doc.saved ?? '')}>
              폴더 열기
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

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
  /** 넣어 둔 한글 양식과, 이 대화에 올린 한글 파일 */
  const [forms, setForms] = useState<HwpForm[]>([])
  const [formFiles, setFormFiles] = useState<FormFile[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)

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
      setForms(await window.api.hwp.list())
      const s = await window.api.local.load()
      setHasKey(!!(s.openai_key || s.gemini_key || s.claude_key))
    })()
    // 다른 화면에서 [💬 도우미와 대화로] 를 눌러 왔으면 첫 마디를 적어 둔다
    const draft = takeChat()
    if (draft) {
      setInput(draft)
      setTimeout(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }, 0)
    }
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
        // 한글 파일은 양식으로도 쓸 수 있게 경로를 기억해 둔다
        if (/\.hwpx?$/i.test(p.name)) {
          setFormFiles((prev) => (prev.some((f) => f.path === p.path) ? prev : [...prev, { name: p.name, path: p.path }]))
        }
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
        formFiles: formFiles.map((f) => f.name),
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

      const { text: answer, actions, doc: req } = splitAnswer(res.answer)
      const plan = buildPlan(actions)
      let doc: ChatDoc | undefined
      if (req) {
        // 방금 넣은 양식도 찾을 수 있게 목록을 새로 읽는다
        const list = await window.api.hwp.list()
        setForms(list)
        const found = req.form ? findForm(req.form, list, formFiles) : null
        doc = {
          req,
          ref: found?.ref ?? null,
          kind: found?.kind ?? null,
          formName: found?.formName ?? req.form,
          round: 0
        }
      }
      const reply: Msg = {
        role: 'assistant',
        content: answer || (plan.length ? '이렇게 넣을까요?' : doc ? '이렇게 만들어 볼게요.' : ''),
        sources: res.sources,
        ...(res.links?.length ? { links: res.links } : {}),
        ...(plan.length ? { plan, picked: plan.map(() => true) } : {}),
        ...(doc ? { doc } : {})
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
          <br />
          <b>"이런 내용으로 회의록 양식에 맞춰 만들어 줘"</b> 처럼 부탁하시면 넣어 둔 한글 양식의 모양으로
          새 한글 파일을 만들어 드립니다. [📎 파일] 로 올린 한글 파일을 양식으로 써도 됩니다.
          <br />
          교육청 <b>학교업무 도움자료</b>(업무흐름도·서식) 가운데 질문에 맞는 자료 폴더도 함께 찾아 드립니다.
        </p>
        <div className="chat-suggest">
          {[
            ...(forms.length ? [`「${forms[0].name}」 양식에 맞춰 한글 파일로 만들어 줘`] : []),
            ...SUGGESTIONS
          ].map((s) => (
            <button key={s} className="chat-suggest-btn" onClick={() => void send(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
      </div>
    ),
    // send 는 매번 새로 만들어지므로 넣지 않는다. 눌렀을 때의 값이면 충분하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docCount, busy, forms]
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

                  {m.doc && (
                    <DocCard
                      doc={m.doc}
                      forms={forms}
                      model={model}
                      onGo={onGo}
                      onChange={(next) => setMsgs((prev) => prev.map((x, xi) => (xi === i ? { ...x, doc: next } : x)))}
                    />
                  )}

                  {m.links && m.links.length > 0 && (
                    <div className="chat-sources">
                      <span className="chat-sources-label">도움자료</span>
                      {m.links.map((l) => (
                        <button
                          key={l.url}
                          className="chat-source-chip chat-link-chip"
                          title="교육청 학교업무 도움자료의 자료 폴더를 브라우저로 엽니다"
                          onClick={() => void window.api.shell.open(l.url)}
                        >
                          📂 {l.title} ↗
                        </button>
                      ))}
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
              setFormFiles([])
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
          ref={inputRef}
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
        답은 AI가 만든 것이라 틀릴 수 있습니다. <b>넣기 전에 날짜와 건수를, 저장하기 전에 칸마다 들어갈 글을 꼭 확인하세요.</b>{' '}
        도우미는 더하기만 할 수 있고, 지우거나 고치지는 못합니다.
      </p>
    </div>
  )
}
