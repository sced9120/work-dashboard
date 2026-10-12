import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatAttachment, ChatMeta, ChatMode } from '../../shared/chat'
import { CHAT_MODES, chatGroup } from '../../shared/chat'
import type { HwpForm } from '../../shared/hwpform'
import type { ModelChoice } from '../../shared/types'
import type { PageId } from '../App'
import { queueCommitteeTab, takeChat } from '../lib/chatBridge'
import type { ChatDoc, Msg, Rec } from '../lib/chatStore'
import {
  allPresets,
  deletePreset,
  initChats,
  isSaved,
  liveText,
  newChat,
  openChat,
  regenerate,
  removeChat,
  renameChat,
  runPlan,
  savePreset,
  sendChat,
  setInstruction,
  setMode,
  setTrust,
  stopChat,
  updateMsg,
  useChats,
  type SendResult
} from '../lib/chatStore'
import { useConfirm } from '../lib/confirm'
import { useToast } from '../lib/toast'
import { todayStr } from '../lib/util'
import FormFillCard from '../components/FormFillCard'
import Markdown from '../components/Markdown'
import ModelPicker from '../components/ModelPicker'

interface Props {
  jobTitle: string
  onGo: (p: PageId) => void
}

const SUGGESTIONS = [
  '9월 16일부터 11월 30일까지 매주 목요일 방과후 1-7반으로 넣어 줘',
  '올해 이 업무에서 놓치면 안 되는 기한들을 정리해 줘',
  '이 업무가 접수되면 처리 절차를 순서대로 알려 줘',
  '이 업무를 처음 맡는 사람에게 3월에 할 일을 알려 줘'
]

const FREE_SUGGESTIONS = [
  '올린 탐구 보고서로 교과 세특 초안을 써 줘',
  '이 글을 가정통신문 말투로 다듬어 줘',
  '학부모 상담 전에 확인할 질문 목록을 만들어 줘',
  '수업 시작 5분 동안 할 수 있는 활동을 추천해 줘'
]

const SIDE_KEY = 'wd_chat_side'

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
        <FormFillCard key={doc.round} form={doc.ref} formName={doc.formName} kind={doc.kind} content={doc.req.content} fileName={fileName} model={model} compact />
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

const kindIcon = (a: ChatAttachment): string => (a.kind === 'image' ? '🖼' : a.kind === 'pdf' ? '📑' : '📄')
const kindNote = (a: ChatAttachment): string =>
  a.kind === 'text' ? `${(a.text ?? '').length.toLocaleString()}자` : a.kind === 'image' ? '사진 그대로' : '스캔본 · 파일 그대로'

/** 왼쪽 대화 목록 */
function ChatList({ currentId, busyIds }: { currentId: string; busyIds: Set<string> }): JSX.Element {
  const { metas } = useChats()
  const ask = useConfirm()
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState('')
  const [title, setTitle] = useState('')
  const list = useMemo(() => {
    const k = q.replace(/\s+/g, '').toLowerCase()
    return k ? metas.filter((m) => m.title.replace(/\s+/g, '').toLowerCase().includes(k)) : metas
  }, [metas, q])
  const groups = useMemo(() => {
    const out: { name: string; items: ChatMeta[] }[] = []
    for (const m of list) {
      const g = chatGroup(m.updated)
      const last = out[out.length - 1]
      if (last && last.name === g) last.items.push(m)
      else out.push({ name: g, items: [m] })
    }
    return out
  }, [list])

  const remove = async (m: ChatMeta): Promise<void> => {
    const ok = await ask({
      title: '이 대화를 지울까요?',
      body: `「${m.title}」 대화를 이 PC 에서 지웁니다. 되돌릴 수 없습니다.\n(대화에 올린 파일 자체는 지우지 않습니다.)`,
      okText: '지우기',
      danger: true
    })
    if (ok) await removeChat(m.id)
  }
  const commit = async (id: string): Promise<void> => {
    await renameChat(id, title)
    setEditing('')
  }

  return (
    <aside className="chat-side">
      <button className="btn btn-primary btn-sm chat-new" onClick={() => newChat()}>
        ＋ 새 채팅
      </button>
      <input type="search" className="chat-search" placeholder="대화 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chat-side-list">
        {!metas.length && <p className="hint">보관한 대화가 없습니다. 첫 질문을 보내면 여기에 남습니다.</p>}
        {metas.length > 0 && !list.length && <p className="hint">「{q}」 이(가) 들어간 대화가 없습니다.</p>}
        {groups.map((g) => (
          <div key={g.name}>
            <div className="chat-side-group">{g.name}</div>
            {g.items.map((m) =>
              editing === m.id ? (
                <div key={m.id} className="chat-side-item active">
                  <input
                    autoFocus
                    className="chat-rename"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commit(m.id)
                      if (e.key === 'Escape') setEditing('')
                    }}
                    onBlur={() => void commit(m.id)}
                    aria-label="대화 이름"
                  />
                </div>
              ) : (
                <div key={m.id} className={`chat-side-item ${m.id === currentId ? 'active' : ''}`}>
                  <button className="chat-side-open" onClick={() => void openChat(m.id)} title={m.title}>
                    <span className="chat-side-icon">{m.mode === 'free' ? '💬' : '📚'}</span>
                    <span className="chat-side-title">{m.title}</span>
                    {busyIds.has(m.id) && <span className="chat-side-busy" title="답을 받는 중" />}
                  </button>
                  <button
                    className="chat-side-act"
                    title="이름 바꾸기"
                    aria-label={`${m.title} 이름 바꾸기`}
                    onClick={() => {
                      setTitle(m.title)
                      setEditing(m.id)
                    }}
                  >
                    ✏️
                  </button>
                  <button className="chat-side-act" title="지우기" aria-label={`${m.title} 지우기`} onClick={() => void remove(m)}>
                    🗑
                  </button>
                </div>
              )
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}

/** 일반 대화의 지침 — 이 대화 내내 따른다. 저장해 두고 다시 쓸 수 있다 */
function InstructionBox({ rec, locked }: { rec: Rec; locked: boolean }): JSX.Element {
  const toast = useToast()
  const ask = useConfirm()
  useChats()
  const presets = allPresets()
  const [open, setOpen] = useState(!rec.messages.length)
  const [name, setName] = useState('')
  const firstLine = rec.instruction.trim().split('\n')[0] ?? ''
  // 새 대화에서는 펴 두고, 첫 마디를 보내면 접는다 (대화 칸을 넓게)
  const empty = !rec.messages.length
  useEffect(() => setOpen(empty), [rec.id, empty])

  const save = async (): Promise<void> => {
    const n = name.trim() || firstLine.slice(0, 30)
    const p = await savePreset(n, rec.instruction)
    if (p) {
      toast(`지침 「${p.name}」 을(를) 저장했습니다. 다음 대화에서 골라 쓸 수 있습니다.`, 'ok')
      setName('')
    }
  }
  const mine = presets.filter((p) => !p.builtin)

  return (
    <div className={`chat-inst ${open ? 'open' : ''}`}>
      <button className="chat-inst-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="chat-inst-label">📝 지침</span>
        <span className="chat-inst-sum">{firstLine ? firstLine : '없음 — 눌러서 이 대화에서 따를 지침을 적을 수 있습니다'}</span>
        <span className="muted small">{open ? '접기 ▲' : '펴기 ▼'}</span>
      </button>
      {open && (
        <div className="chat-inst-body">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <select
              value=""
              onChange={(e) => {
                const p = presets.find((x) => x.id === e.target.value)
                if (p) setInstruction(rec.id, p.text)
              }}
              disabled={locked}
              style={{ width: 'auto', minWidth: 200 }}
              aria-label="저장한 지침 불러오기"
            >
              <option value="">저장한 지침 불러오기…</option>
              {mine.length > 0 && (
                <optgroup label="내 지침">
                  {mine.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="보기">
                {presets
                  .filter((p) => p.builtin)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            </select>
            {mine.length > 0 && (
              <select
                value=""
                onChange={async (e) => {
                  const p = mine.find((x) => x.id === e.target.value)
                  if (!p) return
                  if (await ask({ title: `지침 「${p.name}」 을(를) 지울까요?`, okText: '지우기', danger: true })) await deletePreset(p.id)
                }}
                style={{ width: 'auto' }}
                aria-label="저장한 지침 지우기"
              >
                <option value="">지침 지우기…</option>
                {mine.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <textarea
            className="chat-inst-text"
            value={rec.instruction}
            onChange={(e) => setInstruction(rec.id, e.target.value)}
            rows={4}
            disabled={locked}
            placeholder={'이 대화에서 AI 가 따를 지침. 예)\n- 올린 보고서를 바탕으로 교과 세특 초안을 500자 안팎으로 쓴다\n- 문장은 ~함. ~임. 으로 끝낸다\n- 결과물에 없는 활동은 지어내지 않는다'}
          />
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="지침 이름 (예: 수학 세특)" style={{ maxWidth: 240 }} />
            <button className="btn btn-sm" onClick={() => void save()} disabled={!rec.instruction.trim()}>
              💾 이 지침 저장
            </button>
            <span className="hint" style={{ margin: 0 }}>
              지침은 대화마다 따로 저장되고, 대화 중에도 고칠 수 있습니다.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Chat({ jobTitle, onGo }: Props): JSX.Element {
  const toast = useToast()
  const chats = useChats()
  const rec = chats.recs[chats.currentId]
  const id = chats.currentId
  const live = chats.live[id]
  const busy = !!live
  const busyIds = useMemo(() => new Set(Object.keys(chats.live)), [chats.live])

  const [input, setInput] = useState('')
  const [hasKey, setHasKey] = useState(true)
  const [docCount, setDocCount] = useState(0)
  const [model, setModel] = useState<ModelChoice | null>(null)
  const [files, setFiles] = useState<ChatAttachment[]>([])
  const [reading, setReading] = useState(false)
  const [forms, setForms] = useState<HwpForm[]>([])
  const [drag, setDrag] = useState(0)
  const [side, setSide] = useState(() => {
    try {
      return window.localStorage.getItem(SIDE_KEY) !== '0'
    } catch {
      return true
    }
  })
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void initChats()
    void (async () => {
      setDocCount(await window.api.docs.count())
      setForms(await window.api.hwp.list())
      const s = await window.api.local.load()
      setHasKey(!!(s.openai_key || s.gemini_key || s.claude_key))
    })()
    // 다른 화면에서 [💬 도우미와 대화로] 를 눌러 왔으면 새 업무 도우미 대화에 첫 마디를 적어 둔다
    const draft = takeChat()
    if (draft) {
      newChat('work')
      setInput(draft)
      setTimeout(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }, 0)
    }
  }, [])

  // 대화를 바꾸면 올려 둔 파일은 비운다 (그 대화에 보낼 것이 아니므로)
  useEffect(() => setFiles([]), [id])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [rec?.messages.length, live?.text, id])

  const toggleSide = (): void => {
    setSide(!side)
    try {
      window.localStorage.setItem(SIDE_KEY, side ? '0' : '1')
    } catch {
      // 이번에만
    }
  }

  const addPaths = async (paths: string[]): Promise<void> => {
    if (!paths.length) return
    setReading(true)
    try {
      const { attachments, errors } = await window.api.chats.attach(paths)
      for (const e of errors) toast(e, 'err')
      if (attachments.length) {
        setFiles((prev) => [...prev, ...attachments.filter((a) => !prev.some((p) => p.path && p.path === a.path))])
        const scans = attachments.filter((a) => a.kind !== 'text').length
        toast(
          `${attachments.length}개를 올렸습니다.${scans ? ` 사진 · 스캔본 ${scans}개는 AI 가 그림으로 읽습니다.` : ''} 이어서 무엇을 할지 적어 주세요.`,
          'ok'
        )
      }
    } finally {
      setReading(false)
    }
  }

  const attach = async (): Promise<void> => addPaths(await window.api.chats.pick())

  const after = (r: SendResult): void => {
    if (r.inserted) toast(`${r.inserted.events ? `일정 ${r.inserted.events}건` : ''}${r.inserted.events && r.inserted.tasks ? ' · ' : ''}${r.inserted.tasks ? `업무 ${r.inserted.tasks}건` : ''} 을 넣었습니다.`, 'ok')
    else if (!r.ok && r.error) toast(r.error, 'err')
  }

  const send = async (text: string): Promise<void> => {
    if ((!text.trim() && !files.length) || busy || !rec) return
    if (!hasKey) {
      toast('먼저 설정에서 API 키를 넣어 주세요.', 'err')
      return
    }
    const sent = files
    setInput('')
    setFiles([])
    after(await sendChat(id, text, sent, { jobTitle, model }))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send(input)
    }
  }

  const doRunPlan = async (at: number, m: Msg): Promise<void> => {
    const items = (m.plan ?? []).filter((_, pi) => m.picked?.[pi])
    if (!items.length) {
      toast('넣을 것을 하나 이상 골라 주세요.', 'err')
      return
    }
    const n = await runPlan(id, at, items)
    toast(`${n.events ? `일정 ${n.events}건` : ''}${n.events && n.tasks ? ' · ' : ''}${n.tasks ? `업무 ${n.tasks}건` : ''} 을 넣었습니다.`, 'ok')
  }

  const copy = async (text: string): Promise<void> => {
    await window.api.clipboard.write(text)
    toast('답을 복사했습니다.', 'ok')
  }

  // 끌어 놓기 — 창 어디에 놓아도 이 화면이면 올린다
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDrag(0)
    if (busy || !hasKey) return
    const paths = [...e.dataTransfer.files].map((f) => window.api.files.pathOf(f)).filter(Boolean)
    if (!paths.length) {
      toast('파일을 끌어 놓아 주세요. (글 조각 · 웹 그림은 올릴 수 없습니다)', 'err')
      return
    }
    void addPaths(paths)
  }
  const hasFiles = (e: React.DragEvent): boolean => [...e.dataTransfer.types].includes('Files')

  const mode: ChatMode = rec?.mode ?? 'work'
  const free = mode === 'free'
  const msgs = rec?.messages ?? []
  const lastAssistant = msgs.length && msgs[msgs.length - 1].role === 'assistant' ? msgs.length - 1 : -1
  const trust = !!chats.trust[id]

  const welcome = free ? (
    <div className="chat-welcome">
      <div className="chat-welcome-emoji">💬</div>
      <div className="chat-welcome-title">일반 대화</div>
      <p className="muted small" style={{ maxWidth: 500, textAlign: 'center' }}>
        보관한 공문 · 업무는 싣지 않고 그냥 대화합니다. 위 <b>📝 지침</b>에 적은 대로 대화 내내 따릅니다.
        <br />
        학생 결과물(보고서 · 활동지 · 사진 · 스캔 PDF)을 <b>끌어 놓거나 [📎 파일]</b>로 올리고 세특 초안을 부탁해 보세요. 그림을 만들어 주지는 않습니다.
      </p>
      <div className="chat-suggest">
        {FREE_SUGGESTIONS.map((s) => (
          <button key={s} className="chat-suggest-btn" onClick={() => setInput(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>
    </div>
  ) : (
    <div className="chat-welcome">
      <div className="chat-welcome-emoji">📚</div>
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
        <b>일정이나 업무를 넣어 달라고 하셔도 됩니다.</b> 넣을 목록을 먼저 보여 드리고, 누르시면 그때 들어갑니다.
        <br />
        <b>"이런 내용으로 회의록 양식에 맞춰 만들어 줘"</b> 처럼 부탁하시면 넣어 둔 한글 양식의 모양으로 새 한글 파일을 만들어 드립니다. [📎 파일] 로 올린 한글
        파일을 양식으로 써도 됩니다.
        <br />
        교육청 <b>학교업무 도움자료</b>(업무흐름도·서식) 가운데 질문에 맞는 자료 폴더도 함께 찾아 드립니다.
      </p>
      <div className="chat-suggest">
        {[...(forms.length ? [`「${forms[0].name}」 양식에 맞춰 한글 파일로 만들어 줘`] : []), ...SUGGESTIONS].map((s) => (
          <button key={s} className="chat-suggest-btn" onClick={() => void send(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>
    </div>
  )

  const bubble = (m: Msg, i: number): JSX.Element => (
    <div key={i} className={`chat-row ${m.role}`}>
      <div className={`chat-bubble ${m.role} ${m.error ? 'err' : ''}`}>
        {m.attachments && m.attachments.length > 0 && (
          <div className="chat-files">
            {m.attachments.map((a, ai) => (
              <span key={`${a.name}${ai}`} className="chat-file-chip" title={a.name}>
                {kindIcon(a)} {a.name}
              </span>
            ))}
          </div>
        )}
        {m.content &&
          (m.role === 'assistant' && !m.error ? (
            <div className="chat-md">
              <Markdown text={m.content} />
            </div>
          ) : (
            <div className="chat-text">{m.content}</div>
          ))}
        {m.stopped && <div className="chat-stopped">⏹ 멈춘 곳까지 받았습니다</div>}

        {m.plan && (
          <div className="plan">
            <div className="plan-head">
              <b>이렇게 넣을까요?</b>
              <span className="badge badge-accent">{m.plan.length}건</span>
              {m.planDone && <span className={`badge ${m.planDone === '넣음' ? 'badge-accent' : ''}`}>{m.planDone === '넣음' ? `${m.planCount}건 넣었습니다` : '넣지 않았습니다'}</span>}
            </div>
            <div className="plan-list">
              {m.plan.map((p, pi) => (
                <label key={pi} className={`plan-item ${m.planDone ? 'locked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={m.picked?.[pi] ?? false}
                    disabled={!!m.planDone}
                    onChange={() => updateMsg(id, i, { picked: (m.picked ?? []).map((v, vi) => (vi === pi ? !v : v)) })}
                  />
                  <span className="plan-kind">{p.kind}</span>
                  <span className="plan-label">{p.label}</span>
                </label>
              ))}
            </div>
            {!m.planDone ? (
              <div className="plan-foot">
                <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={trust} onChange={(e) => setTrust(id, e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--accent)' }} />
                  <span className="small muted">이 대화에서는 묻지 않고 바로 넣기</span>
                </label>
                <span className="spacer" />
                <button className="btn btn-sm" onClick={() => updateMsg(id, i, { planDone: '안 함', planCount: 0 })}>
                  안 넣기
                </button>
                <button className="btn btn-sm btn-primary" onClick={() => void doRunPlan(i, m)}>
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

        {m.doc && <DocCard doc={m.doc} forms={forms} model={model} onGo={onGo} onChange={(next) => updateMsg(id, i, { doc: next })} />}

        {m.links && m.links.length > 0 && (
          <div className="chat-sources">
            <span className="chat-sources-label">도움자료</span>
            {m.links.map((l) => (
              <button key={l.url} className="chat-source-chip chat-link-chip" title="교육청 학교업무 도움자료의 자료 폴더를 브라우저로 엽니다" onClick={() => void window.api.shell.open(l.url)}>
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

        {m.role === 'assistant' && !m.error && m.content && (
          <div className="chat-acts">
            <button className="chat-act" onClick={() => void copy(m.content)} title="답을 복사합니다">
              📋 복사
            </button>
            {i === lastAssistant && (
              <button className="chat-act" onClick={() => void regenerate(id, { jobTitle, model }).then(after)} disabled={busy} title="같은 질문으로 답을 다시 받습니다">
                🔄 다시 받기
              </button>
            )}
          </div>
        )}
        {m.error && i === lastAssistant && (
          <div className="chat-acts">
            <button className="chat-act" onClick={() => void regenerate(id, { jobTitle, model }).then(after)} disabled={busy}>
              🔄 다시 해 보기
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div
      className="chat-page"
      data-drop=""
      onDragEnter={(e) => hasFiles(e) && setDrag((n) => n + 1)}
      onDragLeave={(e) => hasFiles(e) && setDrag((n) => Math.max(0, n - 1))}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="page-head" style={{ marginBottom: 10 }}>
        <h1>업무 도우미</h1>
        <p>보관해 둔 공문 · 업무 · 일지를 바탕으로 묻고 답하거나(업무 도우미), 지침을 주고 그냥 대화합니다(일반 대화). 대화는 왼쪽 목록에 남습니다.</p>
      </div>

      {!hasKey && (
        <div className="note note-warn" style={{ marginBottom: 10 }}>
          AI 도우미는 API 키가 있어야 씁니다.{' '}
          <button className="link" onClick={() => onGo('설정')}>
            설정에서 키 넣기
          </button>
        </div>
      )}

      <div className={`chat-layout ${side ? '' : 'side-closed'}`}>
        {side && <ChatList currentId={id} busyIds={busyIds} />}

        <div className="chat-main">
          <div className="chat-bar">
            <button className="btn btn-sm btn-ghost" onClick={toggleSide} title={side ? '대화 목록 숨기기' : '대화 목록 보기'} aria-label={side ? '대화 목록 숨기기' : '대화 목록 보기'}>
              {side ? '◀' : '☰'}
            </button>
            {!side && (
              <button className="btn btn-sm" onClick={() => newChat()}>
                ＋ 새 채팅
              </button>
            )}
            <div className="chat-modes" role="radiogroup" aria-label="대화 모드">
              {CHAT_MODES.map((m) => (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={mode === m.id}
                  className={`chat-mode ${mode === m.id ? 'active' : ''}`}
                  onClick={() => rec && void setMode(rec.id, m.id)}
                  disabled={busy}
                  title={m.desc}
                >
                  {m.icon} {m.label}
                </button>
              ))}
            </div>
            <span className="chat-bar-title" title={rec?.title}>
              {rec && isSaved(rec.id) ? rec.title : ''}
            </span>
          </div>

          {hasKey && <ModelPicker feature="chat" label="이 대화에 쓸 모델" onReady={setModel} onChange={setModel} />}

          {free && rec && <InstructionBox rec={rec} locked={busy} />}

          <div className="chat-thread">
            {msgs.length === 0 && !busy ? (
              welcome
            ) : (
              <div className="chat-list">
                {msgs.map(bubble)}
                {busy && (
                  <div className="chat-row assistant">
                    <div className="chat-bubble assistant">
                      {liveText(rec, live.text).trim() ? (
                        <div className="chat-md">
                          <Markdown text={liveText(rec, live.text)} />
                        </div>
                      ) : (
                        <span className="chat-typing">
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
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
                  {kindIcon(f)} {f.name} <span className="muted">{kindNote(f)}</span>
                  <button className="chat-file-x" title="빼기" onClick={() => setFiles((prev) => prev.filter((_, xi) => xi !== i))}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="chat-composer">
            <button className="btn btn-sm" onClick={() => void attach()} disabled={busy || reading || !hasKey} title="문서 · 사진을 올려 함께 보며 이야기합니다. 끌어 놓아도 됩니다.">
              {reading ? '읽는 중…' : '📎 파일'}
            </button>
            <textarea
              ref={inputRef}
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                !hasKey
                  ? '설정에서 API 키를 먼저 넣어 주세요.'
                  : free
                    ? '무엇이든 적어 보세요. 파일을 끌어 놓아도 됩니다. (Enter 전송 · Shift+Enter 줄바꿈)'
                    : '무엇이든 물어보세요. 넣어 달라고 하셔도 됩니다. (Enter 전송 · Shift+Enter 줄바꿈)'
              }
              rows={1}
              disabled={!hasKey}
            />
            {busy ? (
              <button className="btn" onClick={() => stopChat(id)} title="답 받기를 멈춥니다">
                ⏹ 멈추기
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => void send(input)} disabled={(!input.trim() && !files.length) || !hasKey}>
                보내기
              </button>
            )}
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            답은 AI가 만든 것이라 틀릴 수 있습니다.{' '}
            {free ? (
              <>올린 파일 · 적은 글은 그대로 AI 로 갑니다. 학생 이름은 가리고 올리면 안전합니다.</>
            ) : (
              <>
                <b>넣기 전에 날짜와 건수를, 저장하기 전에 칸마다 들어갈 글을 꼭 확인하세요.</b> 도우미는 더하기만 할 수 있고, 지우거나 고치지는 못합니다.
              </>
            )}
          </p>
        </div>
      </div>

      {drag > 0 && hasKey && !busy && (
        <div className="drop-cover">
          <div className="drop-cover-box">📎 여기에 놓으면 대화에 올립니다</div>
        </div>
      )}
    </div>
  )
}
