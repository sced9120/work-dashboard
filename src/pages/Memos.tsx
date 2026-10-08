import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Memo, MemoPatch, Workflow } from '../../shared/types'
import { BLANK_WORKFLOW } from '../../shared/types'
import Icon from '../components/Icon'
import WorkflowEditor from '../components/WorkflowEditor'
import { useConfirm } from '../lib/confirm'
import { flowOf, memoName, memoText, takeMemoRequest } from '../lib/memos'
import { useToast } from '../lib/toast'

/**
 * 자유 메모장 — 떠오른 것을 바로 적는 메모와, 업무 주제에 매이지 않은 자유 워크플로우.
 *
 * 적는 대로 잠시 뒤 저절로 저장한다(Ctrl+S 는 바로). 나 혼자 쓰는 것이 기본이라
 * '다음 담당자에게도 넘기기' 를 켠 것만 인수인계 파일에 들어간다.
 */

type Filter = '전체' | 'memo' | 'flow'
type SaveState = 'saved' | 'dirty' | 'saving'

const SAVE_DELAY = 900

/** 고친 때를 짧게 — 오늘이면 시각만 */
function when(stamp: string): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  if (!stamp) return ''
  if (stamp.startsWith(today)) return stamp.slice(11, 16)
  return `${Number(stamp.slice(5, 7))}월 ${Number(stamp.slice(8, 10))}일`
}

export default function Memos(): JSX.Element {
  const toast = useToast()
  const ask = useConfirm()
  const [list, setList] = useState<Memo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [sel, setSel] = useState<number | null>(null)
  const [draft, setDraft] = useState<{ title: string; content: string } | null>(null)
  const [save, setSave] = useState<SaveState>('saved')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('전체')
  const pending = useRef<{ id: number; patch: MemoPatch } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async (): Promise<Memo[]> => {
    const rows = await window.api.memos.list()
    setList(rows)
    setLoaded(true)
    return rows
  }, [])

  /** 미뤄 둔 저장을 지금 한다 */
  const flush = useCallback(async (): Promise<void> => {
    window.clearTimeout(timer.current)
    const p = pending.current
    if (!p) return
    pending.current = null
    setSave('saving')
    await window.api.memos.update(p.id, p.patch)
    setSave(pending.current ? 'dirty' : 'saved')
    await load()
  }, [load])

  const schedule = (id: number, patch: MemoPatch): void => {
    const prev = pending.current && pending.current.id === id ? pending.current.patch : {}
    if (pending.current && pending.current.id !== id) void flush()
    pending.current = { id, patch: { ...prev, ...patch } }
    setSave('dirty')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY)
  }

  const select = useCallback(
    async (id: number | null, rows?: Memo[]): Promise<void> => {
      await flush()
      const m = (rows ?? list).find((x) => x.id === id)
      setSel(m ? m.id : null)
      setDraft(m ? { title: m.title ?? '', content: m.content ?? '' } : null)
      setSave('saved')
    },
    [flush, list]
  )

  const create = useCallback(
    async (kind: Memo['kind']): Promise<void> => {
      await flush()
      const id = await window.api.memos.add(kind, '', kind === 'flow' ? JSON.stringify(BLANK_WORKFLOW) : '')
      const rows = await load()
      setFilter('전체')
      setQ('')
      await select(id, rows)
      // 메모는 바로 칠 수 있게
      if (kind === 'memo') window.setTimeout(() => textRef.current?.focus(), 50)
    },
    [flush, load, select]
  )

  // 처음 열 때 · 다른 화면에서 "이것 열어 줘 / 새로 만들어 줘" 할 때
  useEffect(() => {
    let alive = true
    const handle = async (rows?: Memo[]): Promise<void> => {
      const r = takeMemoRequest()
      if (!r || !alive) return
      if ('create' in r) await create(r.create)
      else await select(r.open, rows)
    }
    void load().then((rows) => handle(rows))
    const onReq = (): void => void handle()
    window.addEventListener('wd:memo', onReq)
    return () => {
      alive = false
      window.removeEventListener('wd:memo', onReq)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 화면을 떠나도 적던 것은 저장한다
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      const p = pending.current
      if (p) void window.api.memos.update(p.id, p.patch)
    },
    []
  )

  // Ctrl+S 는 바로 저장
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void flush()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flush])

  const current = list.find((m) => m.id === sel) ?? null

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return list.filter((m) => {
      if (filter !== '전체' && m.kind !== filter) return false
      const hay = `${m.title}\n${memoText(m)}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [list, q, filter])

  const flow: Workflow = useMemo(() => (current?.kind === 'flow' && draft ? flowOf(draft.content) : BLANK_WORKFLOW), [current?.kind, draft])

  const setFlag = async (m: Memo, patch: MemoPatch): Promise<void> => {
    await flush()
    await window.api.memos.update(m.id, patch)
    await load()
  }

  const remove = async (m: Memo): Promise<void> => {
    const ok = await ask({
      title: `「${memoName(m)}」을(를) 지울까요?`,
      body: '지운 메모는 되돌릴 수 없습니다.',
      okText: '지우기',
      danger: true
    })
    if (!ok) return
    window.clearTimeout(timer.current)
    if (pending.current?.id === m.id) pending.current = null
    await window.api.memos.remove(m.id)
    const rows = await load()
    await select(null, rows)
    toast('지웠습니다.', 'ok')
  }

  const counts = { memo: list.filter((m) => m.kind === 'memo').length, flow: list.filter((m) => m.kind === 'flow').length }

  return (
    <>
      <div className="page-head">
        <h1>자유 메모장</h1>
        <p>
          떠오른 것을 바로 적는 메모와, 업무 주제에 매이지 않은 자유 워크플로우를 한곳에 둡니다. 적는 대로 저절로
          저장되고, 나만 보는 것이 기본입니다.
        </p>
      </div>

      <div className="memo-wrap">
        <div className="card memo-list">
          <div className="memo-new">
            <button className="btn btn-sm btn-primary" onClick={() => void create('memo')}>
              <Icon name="plus" size={14} /> 메모
            </button>
            <button className="btn btn-sm" onClick={() => void create('flow')}>
              <Icon name="plus" size={14} /> 워크플로우
            </button>
          </div>
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="메모 찾기" />
          <div className="memo-filter" role="radiogroup" aria-label="종류">
            {(
              [
                ['전체', `전체 ${list.length}`],
                ['memo', `메모 ${counts.memo}`],
                ['flow', `워크플로우 ${counts.flow}`]
              ] as [Filter, string][]
            ).map(([id, label]) => (
              <button key={id} role="radio" aria-checked={filter === id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>

          <div className="memo-items">
            {loaded && list.length === 0 && (
              <p className="small muted memo-empty-list">아직 메모가 없습니다. 위의 [＋ 메모] 로 시작하세요.</p>
            )}
            {loaded && list.length > 0 && shown.length === 0 && <p className="small muted memo-empty-list">맞는 메모가 없습니다.</p>}
            {shown.map((m) => {
              const live = m.id === sel && draft ? { ...m, ...draft } : m
              const text = memoText(live)
              return (
                <button key={m.id} className={`memo-item ${m.id === sel ? 'on' : ''}`} onClick={() => void select(m.id)}>
                  <span className="memo-item-ico">
                    <Icon name={m.kind === 'flow' ? 'flow' : 'note'} size={16} />
                  </span>
                  <span className="memo-item-body">
                    <b>{memoName(live)}</b>
                    <small>
                      {m.kind === 'flow'
                        ? `상자 ${flowOf(live.content).nodes.length}개`
                        : text.split('\n').slice(live.title.trim() ? 0 : 1).join(' ').slice(0, 50) || ' '}
                    </small>
                  </span>
                  <span className="memo-item-meta">
                    {m.pinned ? <Icon name="pin" size={12} /> : null}
                    {m.share ? <span className="memo-share-dot" title="다음 담당자에게 넘김" /> : null}
                    <small>{when(m.updated_at)}</small>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="card memo-edit">
          {!current || !draft ? (
            <div className="memo-blank">
              <span className="tool-empty-ico">
                <Icon name="note" size={28} />
              </span>
              <b>왼쪽에서 메모를 고르거나 새로 만드세요</b>
              <p className="small muted">
                회의 중 받아 적기, 할 일 · 아이디어 정리처럼 아무 글이나 좋습니다. 흐름이 있는 일은 워크플로우로 그려 두세요.
              </p>
              <div className="row">
                <button className="btn btn-primary btn-sm" onClick={() => void create('memo')}>
                  <Icon name="plus" size={14} /> 새 메모
                </button>
                <button className="btn btn-sm" onClick={() => void create('flow')}>
                  <Icon name="plus" size={14} /> 새 자유 워크플로우
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="memo-head">
                <input
                  className="memo-title"
                  type="text"
                  value={draft.title}
                  onChange={(e) => {
                    setDraft({ ...draft, title: e.target.value })
                    schedule(current.id, { title: e.target.value })
                  }}
                  placeholder={current.kind === 'flow' ? '워크플로우 이름 (예: 체험학습 신청 처리)' : '제목 (비워 두면 첫 줄)'}
                  maxLength={80}
                />
                <span className={`memo-save ${save}`}>
                  {save === 'saved' ? `저장됨 · ${when(current.updated_at)}` : save === 'saving' ? '저장 중…' : '고치는 중'}
                </span>
              </div>
              <div className="memo-tools">
                <span className="small muted">
                  {current.kind === 'flow' ? '자유 워크플로우' : '메모'} · {current.created_at.slice(0, 10)} 만듦
                </span>
                <span className="spacer" />
                <button className={`btn btn-sm ${current.pinned ? 'tool-pinned' : 'btn-ghost'}`} onClick={() => void setFlag(current, { pinned: current.pinned ? 0 : 1 })}>
                  <Icon name="pin" size={14} /> {current.pinned ? '맨 위에 고정됨' : '맨 위에 고정'}
                </button>
                <label className="memo-share" title="켜면 인수인계 파일에 이 메모가 함께 들어갑니다">
                  <input type="checkbox" checked={!!current.share} onChange={(e) => void setFlag(current, { share: e.target.checked ? 1 : 0 })} />
                  다음 담당자에게도 넘기기
                </label>
                <button className="btn btn-sm btn-ghost" onClick={() => void remove(current)}>
                  지우기
                </button>
              </div>

              {current.kind === 'memo' ? (
                <textarea
                  ref={textRef}
                  className="memo-text"
                  value={draft.content}
                  onChange={(e) => {
                    setDraft({ ...draft, content: e.target.value })
                    schedule(current.id, { content: e.target.value })
                  }}
                  onBlur={() => void flush()}
                  placeholder="여기에 적으세요. 적는 대로 저장됩니다."
                />
              ) : (
                <WorkflowEditor
                  topic={draft.title.trim() || '자유 워크플로우'}
                  value={flow}
                  onChange={(next) => {
                    const content = JSON.stringify(next)
                    setDraft({ ...draft, content })
                    schedule(current.id, { content })
                  }}
                />
              )}
              {current.share ? (
                <p className="hint" style={{ marginBottom: 0 }}>
                  이 {current.kind === 'flow' ? '워크플로우' : '메모'}는 인수인계 파일에 들어갑니다. 학생 이름 같은 개인정보는 적지 마세요.
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  )
}
