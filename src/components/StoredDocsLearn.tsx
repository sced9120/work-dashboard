import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Doc, DocKind, ModelChoice, TaskDraft } from '../../shared/types'
import { useToast } from '../lib/toast'

interface Props {
  jobTitle: string
  kind: DocKind
  model: ModelChoice | null
  /** 분석이 끝난 결과를 위쪽 검토 목록으로 올린다 */
  onDrafts: (drafts: TaskDraft[]) => void
}

/** 한 번에 돌릴 기본 건수. 실수로 수백 건을 한꺼번에 돌리지 않게 막아 둔다. */
const DEFAULT_LIMIT = 50

/** 이 프로그램이 긴 문서를 자르는 단위 (ai.ts 의 CHUNK_SIZE 와 같다) */
const CHUNK = 28000

export default function StoredDocsLearn({
  jobTitle,
  kind,
  model,
  onDrafts
}: Props): JSX.Element {
  const toast = useToast()
  const [docs, setDocs] = useState<Doc[]>([])
  const [learned, setLearned] = useState<Set<string>>(new Set())
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [limit, setLimit] = useState(DEFAULT_LIMIT)
  const [query, setQuery] = useState('')

  const [busy, setBusy] = useState(false)
  const [at, setAt] = useState(0)
  const [now, setNow] = useState('')
  const [failed, setFailed] = useState<string[]>([])
  const cancel = useRef(false)

  const load = useCallback(async () => {
    const [list, tasks] = await Promise.all([window.api.docs.list(), window.api.tasks.list()])
    setDocs(list)
    // 이미 그 파일에서 업무를 뽑아 둔 적이 있으면 "학습함" 으로 본다
    setLearned(new Set(tasks.map((t) => t.filename).filter(Boolean)))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return docs
    return docs.filter((d) => d.filename.toLowerCase().includes(q))
  }, [docs, query])

  const notYet = useMemo(() => docs.filter((d) => !learned.has(d.filename)), [docs, learned])

  const chosen = useMemo(() => docs.filter((d) => picked.has(d.id)), [docs, picked])

  /** 실제로 몇 번 요청이 나가는지 — 긴 문서는 나눠 보내므로 건수보다 많다 */
  const calls = useMemo(
    () => chosen.reduce((s, d) => s + Math.max(1, Math.ceil(d.chars / CHUNK)), 0),
    [chosen]
  )
  const totalChars = useMemo(() => chosen.reduce((s, d) => s + d.chars, 0), [chosen])

  const toggle = (id: number): void => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectNotYet = (): void => {
    setPicked(new Set(notYet.slice(0, limit).map((d) => d.id)))
  }
  const selectAll = (): void => {
    setPicked(new Set(shown.slice(0, limit).map((d) => d.id)))
  }
  const selectNone = (): void => setPicked(new Set())

  const run = async (): Promise<void> => {
    if (!chosen.length) {
      toast('학습할 공문을 골라 주세요.', 'err')
      return
    }
    const ok = confirm(
      `공문 ${chosen.length}건을 AI로 분석합니다.\n` +
        `요청 약 ${calls}회 · 글자 ${totalChars.toLocaleString()}자\n\n` +
        `사용량만큼 요금이 붙고 시간이 걸립니다. 계속할까요?\n` +
        `(중간에 [멈추기] 로 세울 수 있고, 그때까지 찾은 것은 남습니다)`
    )
    if (!ok) return

    cancel.current = false
    setBusy(true)
    setAt(0)
    setFailed([])

    const collected: TaskDraft[] = []
    const bad: string[] = []

    for (let i = 0; i < chosen.length; i++) {
      if (cancel.current) break
      const d = chosen[i]
      setNow(d.filename)
      setAt(i)

      const full = await window.api.docs.get(d.id)
      if (!full?.content?.trim()) {
        bad.push(`${d.filename} — 원문이 비어 있습니다`)
        continue
      }

      const res = await window.api.ai.analyze({
        filename: d.filename,
        text: full.content,
        kind,
        jobTitle,
        model: model ?? undefined
      })

      if (!res.ok) {
        bad.push(`${d.filename} — ${res.error ?? '분석 실패'}`)
        // 키가 잘못됐거나 한도에 걸린 것이면 계속해 봐야 다 실패한다
        if (/키|한도|없습니다/.test(res.error ?? '')) {
          toast(`${res.error} — 중단합니다.`, 'err')
          break
        }
      } else if (res.drafts.length === 0) {
        bad.push(`${d.filename} — 뽑을 업무를 찾지 못했습니다`)
      }

      // 이미 보관된 문서이므로 원문을 다시 넣지 않도록 id 를 달아 둔다
      collected.push(...res.drafts.map((x) => ({ ...x, document_id: d.id })))
    }

    setAt(chosen.length)
    setBusy(false)
    setNow('')
    setFailed(bad)

    if (collected.length) {
      onDrafts(collected)
      toast(
        `${collected.length}건을 찾았습니다. 위쪽 목록에서 확인하고 등록해 주세요.`,
        'ok'
      )
    } else {
      toast('업무로 뽑을 내용을 찾지 못했습니다.', 'err')
    }
    await load()
  }

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        이미 보관해 둔 공문 <b>{docs.length}건</b> 을 파일 고르기 없이 그대로 AI에 넘깁니다. 아직
        학습하지 않은 것은 <b>{notYet.length}건</b> 입니다.
      </p>

      <div className="row" style={{ marginBottom: 10 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="공문 이름으로 거르기"
          style={{ flex: 1, minWidth: 180 }}
          disabled={busy}
        />
        <span className="muted small">한 번에</span>
        <input
          type="number"
          min={1}
          max={500}
          value={limit}
          onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
          style={{ width: 78 }}
          disabled={busy}
        />
        <span className="muted small">건까지</span>
      </div>

      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn btn-sm" onClick={selectNotYet} disabled={busy || !notYet.length}>
          아직 안 한 것 고르기 ({Math.min(notYet.length, limit)})
        </button>
        <button className="btn btn-sm" onClick={selectAll} disabled={busy}>
          보이는 것 고르기
        </button>
        <button className="btn btn-sm btn-ghost" onClick={selectNone} disabled={busy}>
          선택 해제
        </button>
      </div>

      {chosen.length > 0 && (
        <div className="note note-info" style={{ marginBottom: 10 }}>
          <b>{chosen.length}건</b> 선택 · 글자 {totalChars.toLocaleString()}자 · AI 요청 약{' '}
          <b>{calls}회</b>
          <div className="small muted" style={{ marginTop: 4 }}>
            긴 공문은 여러 조각으로 나눠 보내므로 요청 수가 건수보다 많습니다. 사용량만큼 요금이
            붙습니다.
          </div>
        </div>
      )}

      {busy && (
        <div className="note note-warn" style={{ marginBottom: 10 }}>
          <div className="row">
            <b>
              {at}/{chosen.length}
            </b>
            <span className="small" style={{ flex: 1, minWidth: 0 }}>
              {now}
            </span>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => {
                cancel.current = true
                toast('이번 문서까지 마치고 멈춥니다.')
              }}
            >
              멈추기
            </button>
          </div>
          <div className="info-bar" style={{ marginTop: 8, maxWidth: 'none' }}>
            <div style={{ width: `${chosen.length ? (at / chosen.length) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      <div className="storedlist">
        {shown.length === 0 ? (
          <div className="empty">보관된 공문이 없습니다.</div>
        ) : (
          shown.map((d) => (
            <label key={d.id} className={`storeditem ${picked.has(d.id) ? 'on' : ''}`}>
              <input
                type="checkbox"
                checked={picked.has(d.id)}
                onChange={() => toggle(d.id)}
                disabled={busy}
              />
              <span className="storeditem-name">{d.filename}</span>
              {learned.has(d.filename) && <span className="badge">학습함</span>}
              <span className="muted small">{d.doc_date || '날짜 미상'}</span>
              <span className="muted small">{d.chars.toLocaleString()}자</span>
            </label>
          ))
        )}
      </div>

      {failed.length > 0 && (
        <div className="note note-danger" style={{ marginTop: 10 }}>
          <b>넘어간 것 {failed.length}건</b>
          <div className="scroll-box" style={{ marginTop: 6, maxHeight: 140 }}>
            {failed.join('\n')}
          </div>
        </div>
      )}

      <div className="row row-end" style={{ marginTop: 12 }}>
        <button
          className="btn btn-primary"
          onClick={() => void run()}
          disabled={busy || !chosen.length}
        >
          {busy ? '분석 중…' : `🤖 고른 ${chosen.length}건 학습하기`}
        </button>
      </div>
    </div>
  )
}
