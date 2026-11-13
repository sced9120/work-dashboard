import { useCallback, useEffect, useState } from 'react'
import type { ModelChoice } from '../../shared/types'
import { BLANK_DEADLINE, BLANK_EVENT } from '../../shared/types'
import type { AttPick, InboxItem, TodoPick } from '../../shared/messenger'
import type { AttReason, AttRecord, AttType, Roster } from '../../shared/attendance'
import { ATT_REASONS, ATT_RECORDS_KEY, ATT_ROSTER_KEY, ATT_TYPES, defaultProof, readRecords, readRoster, upsertRecords } from '../../shared/attendance'
import RelayCard from '../components/RelayCard'
import type { PageId } from '../App'
import ModelPicker from '../components/ModelPicker'
import Icon from '../components/Icon'
import { useToast } from '../lib/toast'

/**
 * 메신저 정리 — 쿨메신저 · 업무 메신저 · 카톡 글을 붙여 넣으면 할 일(절차 기한 · 달력)과 출결(출결 기록)을 뽑는다.
 * 폰에서 보낸 글(폰에서 보내기)도 여기 '폰에서 온 글' 로 모인다.
 */

type Todo = TodoPick & { on: boolean }
type Att = AttPick & { on: boolean }

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const md = (day: string): string => {
  if (!day) return '날짜 모름'
  const d = new Date(`${day}T00:00:00`)
  return `${d.getMonth() + 1}. ${d.getDate()}.(${WEEK[d.getDay()]})`
}
const when = (t: number): string => {
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function Messenger({ onGo }: { onGo: (p: PageId) => void }): JSX.Element {
  const toast = useToast()
  const [text, setText] = useState('')
  const [used, setUsed] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [masked, setMasked] = useState<string | null>(null)
  const [todos, setTodos] = useState<Todo[] | null>(null)
  const [atts, setAtts] = useState<Att[]>([])
  const [inbox, setInbox] = useState<InboxItem[]>([])
  const [roster, setRoster] = useState<Roster>({ cls: '', students: [] })
  const [model, setModel] = useState<ModelChoice | null>(null)
  const [hasKey, setHasKey] = useState(true)

  const loadInbox = useCallback(async () => setInbox(await window.api.inbox.list()), [])
  useEffect(() => {
    void loadInbox()
    void (async () => {
      setRoster(readRoster(await window.api.setting.get(ATT_ROSTER_KEY)))
      const s = await window.api.local.load()
      setHasKey(!!(s.openai_key || s.gemini_key || s.claude_key || s.exaone_key))
    })()
    return window.api.inbox.onChanged(() => void loadInbox())
  }, [loadInbox])

  const paste = async (): Promise<void> => {
    const v = (await window.api.clipboard.read()).trim()
    if (!v) return toast('클립보드가 비어 있습니다.', 'err')
    setText((t) => (t.trim() ? `${t.trimEnd()}\n\n${v}` : v))
  }

  const preview = async (): Promise<void> => {
    if (masked !== null) return setMasked(null)
    setMasked(await window.api.msg.mask(text))
  }

  const run = async (): Promise<void> => {
    if (!text.trim() || busy) return
    setBusy(true)
    setError('')
    const r = await window.api.msg.extract(text, model ?? undefined)
    setBusy(false)
    if (!r.ok || !r.result) {
      setError(r.error ?? '정리하지 못했습니다.')
      return
    }
    setTodos(r.result.todos.map((t) => ({ ...t, on: true })))
    setAtts(r.result.attendance.map((a) => ({ ...a, on: a.no > 0 && !!a.date })))
    if (!r.result.todos.length && !r.result.attendance.length) toast('할 일이나 출결로 볼 만한 글이 없었습니다.')
  }

  const apply = async (): Promise<void> => {
    let nTodo = 0
    let nEvent = 0
    for (const t of todos ?? []) {
      if (!t.on || !t.title.trim()) continue
      if (t.kind === '일정' && t.due) {
        await window.api.events.add({ ...BLANK_EVENT, event_date: t.due, end_date: t.due, start_time: t.time, title: t.title.trim(), content: [t.from, t.note].filter(Boolean).join(' · ') })
        nEvent++
      } else {
        await window.api.deadlines.add({ ...BLANK_DEADLINE, title: t.title.trim(), due_date: t.due, case_ref: t.from, note: t.note })
        nTodo++
      }
    }
    const picked = atts.filter((a) => a.on && a.no > 0 && a.date)
    if (picked.length) {
      const list = readRecords(await window.api.setting.get(ATT_RECORDS_KEY, '[]'))
      const add: AttRecord[] = picked.map((a) => ({ id: `${Date.now()}-${a.no}-${a.type}`, date: a.date, no: a.no, type: a.type, reason: a.reason, note: a.note, proof: a.proof, neis: false }))
      await window.api.setting.set(ATT_RECORDS_KEY, JSON.stringify(upsertRecords(list, add)))
    }
    if (used.length) await window.api.inbox.remove(used)
    const parts = [nTodo && `절차 기한 ${nTodo}건`, nEvent && `달력 일정 ${nEvent}건`, picked.length && `출결 ${picked.length}건`].filter(Boolean)
    toast(parts.length ? `${parts.join(' · ')}을 넣었습니다.` : '넣은 것이 없습니다.', parts.length ? 'ok' : undefined)
    setTodos(null)
    setAtts([])
    setText('')
    setUsed([])
    setMasked(null)
  }

  const takeInbox = (it: InboxItem): void => {
    setText((t) => (t.trim() ? `${t.trimEnd()}\n\n${it.text}` : it.text))
    setUsed((u) => [...new Set([...u, it.id])])
  }

  const setTodo = (i: number, p: Partial<Todo>): void => setTodos((l) => (l ? l.map((t, k) => (k === i ? { ...t, ...p } : t)) : l))
  const setAtt = (i: number, p: Partial<Att>): void => setAtts((l) => l.map((a, k) => (k === i ? { ...a, ...p } : a)))
  const nOn = (todos ?? []).filter((t) => t.on).length + atts.filter((a) => a.on && a.no > 0 && a.date).length

  return (
    <div className="msg-page">
      <div className="page-head">
        <h1>메신저 정리</h1>
        <p>쿨메신저 · 업무 메신저 · 카톡 글을 붙여 넣으면 할 일과 출결을 뽑아 절차 기한 · 달력 · 출결 기록에 넣습니다.</p>
      </div>

      <div className="msg-grid">
        <section className="card msg-in">
          <div className="msg-in-head">
            <b>붙여 넣은 글</b>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={() => void paste()}>
              클립보드에서 붙여 넣기
            </button>
          </div>
          <textarea
            className="msg-text"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setMasked(null)
            }}
            placeholder={'여러 메시지를 한꺼번에 붙여 넣어도 됩니다.\n예) [교무부] 11/14(금)까지 2학기 수행평가 계획서를 학년 공유 폴더에 올려 주세요.\n예) 선생님, 2학년 4반 민준이 엄마입니다. 오늘 장염으로 병원 들렀다 늦게 등교합니다.'}
          />
          <p className="muted small msg-privacy">
            보내기 전에 이 PC 에서 가립니다 — 출결 기록 명단의 학생은 <b>학생7</b>(번호), 다른 이름은 <b>사람A</b>, 전화번호 · 반번호는 지웁니다.{' '}
            <button className="link" onClick={() => void preview()} disabled={!text.trim()}>
              {masked !== null ? '닫기' : 'AI 에 갈 글 보기'}
            </button>
          </p>
          {masked !== null && <pre className="msg-masked">{masked || '(빈 글)'}</pre>}
          {!roster.students.length && (
            <p className="note note-info small">
              출결까지 뽑으려면 <button className="link" onClick={() => onGo('출결')}>[출결 기록]</button> 에 우리 반 명단을 먼저 넣어 주세요. 명단이 없으면 할 일만 뽑고, 학생 이름은 사람A 처럼 가립니다.
            </p>
          )}
          {!hasKey ? (
            <p className="note note-warn small">
              AI 키가 없습니다. <button className="link" onClick={() => onGo('설정')}>[설정 → AI 연결]</button> 에서 키를 넣어 주세요.
            </p>
          ) : (
            <div className="row msg-run">
              <ModelPicker feature="analyze" label="모델" onReady={setModel} onChange={setModel} />
              <span className="spacer" />
              <button className="btn btn-primary" onClick={() => void run()} disabled={busy || !text.trim()}>
                {busy ? '정리하는 중…' : '할 일 · 출결 뽑기'}
              </button>
            </div>
          )}
          {error && <p className="note note-danger small">{error}</p>}

          {inbox.length > 0 && (
            <div className="msg-inbox">
              <div className="msg-inbox-head">
                <b>폰에서 온 글</b>
                <span className="badge badge-accent">{inbox.length}</span>
              </div>
              {inbox.map((it) => (
                <div key={it.id} className={`msg-inbox-item ${used.includes(it.id) ? 'used' : ''}`}>
                  <small className="muted">{when(it.t)}</small>
                  <span className="msg-inbox-text">{it.text}</span>
                  <span className="row" style={{ gap: 4 }}>
                    <button className="btn btn-sm" onClick={() => takeInbox(it)} disabled={used.includes(it.id)}>
                      {used.includes(it.id) ? '넣음' : '위로 넣기'}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => void window.api.inbox.remove([it.id])} title="지우기" aria-label="이 글 지우기">
                      <Icon name="trash" size={14} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card msg-out">
          <b>뽑은 것</b>
          {todos === null ? (
            <p className="muted small">왼쪽에 글을 넣고 [할 일 · 출결 뽑기] 를 누르면 여기에 나옵니다. 넣기 전에 고치거나 뺄 수 있습니다.</p>
          ) : (
            <>
              <div className="msg-sec">할 일 · 일정 {todos.length}</div>
              {todos.length === 0 && <p className="muted small">없음</p>}
              {todos.map((t, i) => (
                <div key={i} className={`msg-row ${t.on ? '' : 'off'}`}>
                  <input type="checkbox" checked={t.on} onChange={(e) => setTodo(i, { on: e.target.checked })} aria-label="넣기" />
                  <div className="msg-row-body">
                    <input type="text" value={t.title} onChange={(e) => setTodo(i, { title: e.target.value })} aria-label="할 일" />
                    <div className="msg-row-meta">
                      <select value={t.kind} onChange={(e) => setTodo(i, { kind: e.target.value as Todo['kind'] })} aria-label="넣을 곳">
                        <option value="기한">절차 기한</option>
                        <option value="일정">달력 일정</option>
                      </select>
                      <input type="date" value={t.due} onChange={(e) => setTodo(i, { due: e.target.value })} aria-label="날짜" />
                      {t.kind === '일정' && <input type="time" value={t.time} onChange={(e) => setTodo(i, { time: e.target.value })} aria-label="시각" />}
                      {t.from && <span className="muted small">{t.from}</span>}
                    </div>
                    {t.note && <small className="muted">{t.note}</small>}
                  </div>
                </div>
              ))}

              <div className="msg-sec">출결 {atts.length}</div>
              {atts.length === 0 && <p className="muted small">없음</p>}
              {atts.map((a, i) => (
                <div key={i} className={`msg-row ${a.on ? '' : 'off'}`}>
                  <input type="checkbox" checked={a.on} disabled={!a.no || !a.date} onChange={(e) => setAtt(i, { on: e.target.checked })} aria-label="넣기" />
                  <div className="msg-row-body">
                    <div className="msg-row-meta">
                      <select
                        value={a.no}
                        onChange={(e) => {
                          const no = Number(e.target.value)
                          setAtt(i, { no, on: no > 0 && !!a.date })
                        }}
                        aria-label="학생"
                      >
                        <option value={0}>{a.no ? '' : `${a.who} (명단에서 고르기)`}</option>
                        {roster.students.map((s) => (
                          <option key={s.no} value={s.no}>
                            {s.no}. {s.name}
                          </option>
                        ))}
                      </select>
                      <input type="date" value={a.date} onChange={(e) => setAtt(i, { date: e.target.value, on: a.no > 0 && !!e.target.value })} aria-label="날짜" />
                      <select value={a.type} onChange={(e) => setAtt(i, { type: e.target.value as AttType })} aria-label="구분">
                        {ATT_TYPES.map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                      <select value={a.reason} onChange={(e) => setAtt(i, { reason: e.target.value as AttReason, proof: defaultProof(e.target.value as AttReason) })} aria-label="사유">
                        {ATT_REASONS.map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </div>
                    <input type="text" value={a.note} onChange={(e) => setAtt(i, { note: e.target.value })} placeholder="내용" aria-label="내용" />
                    <small className="muted">
                      {md(a.date)} · 서류 {a.proof}
                    </small>
                  </div>
                </div>
              ))}

              <div className="row row-end" style={{ marginTop: 12, gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => (setTodos(null), setAtts([]))}>
                  버리기
                </button>
                <button className="btn btn-primary" onClick={() => void apply()} disabled={!nOn}>
                  고른 {nOn}건 넣기
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      <RelayCard
        tab="text"
        title="폰에서 보내기"
        desc="폰에서 메신저 · 카톡 글을 보내면 몇 분 안에 위 '폰에서 온 글' 로 옵니다"
        howTo={<p className="small">카톡 · 메신저 글을 길게 눌러 복사 → 폰 화면의 [글 보내기] 탭에 붙여 넣고 [보내기]. 카톡은 다른 프로그램이 대화를 읽을 길을 열어 두지 않아 복사 한 번은 직접 하셔야 합니다.</p>}
      />
    </div>
  )
}
