import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Doc, DocKind, ModelChoice, TaskDraft } from '../../shared/types'
import { currentSchoolYear, schoolYearLabel } from '../../shared/types'
import { useToast } from '../lib/toast'
import {
  addDrafts,
  addFailure,
  finishJob,
  isStopping,
  requestStop,
  setProgress,
  startJob,
  useLearnJob
} from '../lib/learnJob'

interface Props {
  jobTitle: string
  kind: DocKind
  model: ModelChoice | null
}

/** 한 번에 돌릴 기본 건수. 실수로 수백 건을 한꺼번에 돌리지 않게 막아 둔다. */
const DEFAULT_LIMIT = 50

/** 이 프로그램이 긴 문서를 자르는 단위 (ai.ts 의 CHUNK_SIZE 와 같다) */
const CHUNK = 28000

/** 학년도 고르개에서 "공문에 매겨 둔 것을 그대로 쓴다" 를 뜻하는 값 */
const FOLLOW_DOC = -1

export default function StoredDocsLearn({ jobTitle, kind, model }: Props): JSX.Element {
  const toast = useToast()
  const [docs, setDocs] = useState<Doc[]>([])
  const [learned, setLearned] = useState<Set<string>>(new Set())
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [limit, setLimit] = useState(DEFAULT_LIMIT)
  const [query, setQuery] = useState('')

  // 진행 상태와 찾아낸 것은 화면 밖에 둔다 (src/lib/learnJob.ts).
  // 다른 화면으로 넘어가도 위쪽 띠에 "학습 중" 이 남는다.
  const job = useLearnJob()
  const busy = job.running
  const at = job.done
  const now = job.now
  const failed = job.failed

  /** AI 에 보내기 전에 이름·연락처를 ○○○ 으로 덮을지 */
  const [scrub, setScrub] = useState(false)

  /**
   * 뽑아낸 업무를 몇 학년도로 매길지.
   *
   * 기본은 공문에 이미 매겨 둔 학년도를 따르는 것이다. 다만 예전에 쌓아 둔
   * 공문은 학년도가 없어서(미지정) 그대로 두면 업무도 미지정이 된다.
   * 그럴 때 여기서 골라 한꺼번에 매길 수 있어야 한다.
   */
  const [year, setYear] = useState<number>(FOLLOW_DOC)

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

  /**
   * 고르개에 세울 학년도들.
   * 올해 둘레의 몇 해에, 보관된 공문에 실제로 매겨져 있는 해를 보탠다.
   */
  const yearChoices = useMemo(() => {
    const now = currentSchoolYear()
    const set = new Set<number>([now + 1, now, now - 1, now - 2, now - 3])
    for (const d of docs) if (d.school_year) set.add(d.school_year)
    return [...set].sort((a, b) => b - a)
  }, [docs])

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

    startJob('보관 문서 학습', chosen.length)
    let found = 0

    for (let i = 0; i < chosen.length; i++) {
      if (isStopping()) break
      const d = chosen[i]
      setProgress({ now: d.filename, done: i })

      const full = await window.api.docs.get(d.id)
      if (!full?.content?.trim()) {
        addFailure(`${d.filename} — 원문이 비어 있습니다`)
        continue
      }

      // 켜 두면 개인정보를 가린 글만 나간다. 보관된 원문은 손대지 않는다.
      const text = scrub ? (await window.api.privacy.scrub(full.content)).text : full.content

      const res = await window.api.ai.analyze({
        filename: d.filename,
        text,
        kind,
        jobTitle,
        model: model ?? undefined
      })

      if (!res.ok) {
        addFailure(`${d.filename} — ${res.error ?? '분석 실패'}`)
        // 키가 잘못됐거나 한도에 걸린 것이면 계속해 봐야 다 실패한다
        if (/키|한도|없습니다/.test(res.error ?? '')) {
          toast(`${res.error} — 중단합니다.`, 'err')
          break
        }
      } else if (res.drafts.length === 0) {
        addFailure(`${d.filename} — 뽑을 업무를 찾지 못했습니다`)
      }

      // 이미 보관된 문서이므로 원문을 다시 넣지 않도록 id 를 달아 둔다.
      // 학년도는 고른 값을 쓰되, "공문을 따름" 이면 그 공문에 매겨 둔 것을 쓴다.
      addDrafts(
        res.drafts.map((x) => ({
          ...x,
          document_id: d.id,
          school_year: year === FOLLOW_DOC ? d.school_year : year
        }))
      )
      found += res.drafts.length
      setProgress({ done: i + 1 })
    }

    finishJob()

    if (found) {
      toast(`${found}건을 찾았습니다. 위쪽 목록에서 확인하고 등록해 주세요.`, 'ok')
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
                requestStop()
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
              <span className={`badge ${d.school_year ? '' : 'badge-warn'}`}>
                {schoolYearLabel(d.school_year)}
              </span>
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

      <div className="field" style={{ maxWidth: 400, marginTop: 12 }}>
        <label>뽑아낸 업무를 몇 학년도로 매길까요?</label>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          disabled={busy}
        >
          <option value={FOLLOW_DOC}>공문에 매겨 둔 학년도를 따름</option>
          {yearChoices.map((y) => (
            <option key={y} value={y}>
              {schoolYearLabel(y)}
              {y === currentSchoolYear() ? ' · 올해' : ''}
            </option>
          ))}
        </select>
        <div className="hint">
          {year === FOLLOW_DOC ? (
            <>
              공문마다 매겨 둔 학년도를 그대로 씁니다. 학년도가 없는 공문에서 뽑은 업무는{' '}
              <b>미지정</b>으로 들어갑니다 — 지금 고르신 것 가운데{' '}
              <b>{chosen.filter((d) => !d.school_year).length}건</b>이 그렇습니다.
            </>
          ) : (
            <>
              공문에 무엇이 매겨져 있든 <b>{schoolYearLabel(year)}</b>로 몰아서 매깁니다.
            </>
          )}
        </div>
      </div>

      <label className="row" style={{ gap: 6, cursor: 'pointer', marginTop: 12 }}>
        <input
          type="checkbox"
          checked={scrub}
          onChange={(e) => setScrub(e.target.checked)}
          disabled={busy}
          style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
        />
        <span className="small">
          🧹 개인정보를 가리고 AI에 보내기{' '}
          <span className="muted">
            — 이름·연락처·주민등록번호·학번·주소를 ○○○ 으로 덮어 보냅니다. 보관된 원문은 그대로
            남습니다
          </span>
        </span>
      </label>

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
