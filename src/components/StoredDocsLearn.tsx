import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Doc, DocKind, ModelChoice, Task, TaskDraft } from '../../shared/types'
import { groupNotices, joinNotice, parseNoticeName } from '../../shared/notice'
import { currentSchoolYear, schoolYearLabel } from '../../shared/types'
import { useConfirm } from '../lib/confirm'
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
  /** 공문을 길라잡이로 돌리려 할 때 종류를 바로잡아 주려고 */
  onKind: (k: DocKind) => void
}

/** 한 번에 돌릴 기본 건수. 실수로 수백 건을 한꺼번에 돌리지 않게 막아 둔다. */
const DEFAULT_LIMIT = 50

/** 이 프로그램이 긴 문서를 자르는 단위 (ai.ts 의 CHUNK_SIZE 와 같다) */
const CHUNK = 28000

/** 학년도 고르개에서 "공문에 매겨 둔 것을 그대로 쓴다" 를 뜻하는 값 */
const FOLLOW_DOC = -1

export default function StoredDocsLearn({ jobTitle, kind, model, onKind }: Props): JSX.Element {
  const toast = useToast()
  const ask = useConfirm()
  const [docs, setDocs] = useState<Doc[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [picked, setPicked] = useState<Set<number>>(new Set())
  /** 문서번호가 같은 본문·첨부를 한 공문으로 묶을지 */
  const [groupDocs, setGroupDocs] = useState(true)
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
    const [list, rows] = await Promise.all([window.api.docs.list(), window.api.tasks.list()])
    setDocs(list)
    setTasks(rows)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 보관해 둔 공문을 공문 단위로 묶는다.
   *
   * 파일 경로가 남아 있지 않으므로 학년도로 자리를 가른다.
   * 문서번호는 해마다 다시 매겨지기 때문이다.
   */
  const allGroups = useMemo(
    () =>
      groupDocs
        ? groupNotices(
            docs,
            (d) => d.filename,
            (d) => String(d.school_year ?? 0)
          )
        : docs.map((d) => ({ key: String(d.id), number: '', label: d.filename, items: [d] })),
    [docs, groupDocs]
  )

  /**
   * 이미 업무를 뽑아 둔 문서. 묶음 안에서 하나라도 뽑았으면 그 공문은 한 것으로 본다.
   * 묶어서 학습하면 업무가 본문에만 매달리기 때문이다.
   */
  const learned = useMemo(() => {
    const byId = new Set(tasks.map((t) => t.document_id).filter(Boolean))
    const byName = new Set(tasks.map((t) => t.filename).filter(Boolean))
    const out = new Set<number>()
    for (const g of allGroups) {
      if (g.items.some((d) => byId.has(d.id) || byName.has(d.filename))) {
        for (const d of g.items) out.add(d.id)
      }
    }
    return out
  }, [allGroups, tasks])

  const shownGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allGroups
    return allGroups.filter(
      (g) =>
        g.label.toLowerCase().includes(q) ||
        g.items.some((d) => d.filename.toLowerCase().includes(q))
    )
  }, [allGroups, query])

  const notYetGroups = useMemo(
    () => allGroups.filter((g) => !g.items.some((d) => learned.has(d.id))),
    [allGroups, learned]
  )

  const chosen = useMemo(() => docs.filter((d) => picked.has(d.id)), [docs, picked])

  /** 고른 것 가운데 공문 이름인 것 */
  const noticeChosen = useMemo(
    () => chosen.filter((d) => parseNoticeName(d.filename)),
    [chosen]
  )

  /** 고른 문서를 다시 공문 단위로 묶은 것 — 이 덩어리마다 한 번씩 보낸다 */
  const runGroups = useMemo(
    () => allGroups.filter((g) => g.items.some((d) => picked.has(d.id))),
    [allGroups, picked]
  )

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
    () =>
      runGroups.reduce(
        (s, g) => s + Math.max(1, Math.ceil(g.items.reduce((n, d) => n + d.chars, 0) / CHUNK)),
        0
      ),
    [runGroups]
  )
  const totalChars = useMemo(() => chosen.reduce((s, d) => s + d.chars, 0), [chosen])

  /** 묶음 하나를 통째로 켜고 끈다. 본문만 골라 보내면 첨부가 빠지기 때문이다. */
  const toggleGroup = (key: string): void => {
    const g = allGroups.find((x) => x.key === key)
    if (!g) return
    setPicked((prev) => {
      const next = new Set(prev)
      const on = g.items.every((d) => next.has(d.id))
      for (const d of g.items) {
        if (on) next.delete(d.id)
        else next.add(d.id)
      }
      return next
    })
  }

  const pickGroups = (list: typeof allGroups): void => {
    const next = new Set<number>()
    for (const g of list.slice(0, limit)) for (const d of g.items) next.add(d.id)
    setPicked(next)
  }

  const selectNotYet = (): void => pickGroups(notYetGroups)
  const selectAll = (): void => pickGroups(shownGroups)
  const selectNone = (): void => setPicked(new Set())

  const run = async (): Promise<void> => {
    if (!runGroups.length) {
      toast('학습할 공문을 골라 주세요.', 'err')
      return
    }
    const ok = await ask({
      title: `공문 ${runGroups.length}건을 AI로 분석할까요?`,
      body: (
        <>
          요청 약 <b>{calls}회</b> · 글자 {totalChars.toLocaleString()}자
          <br />
          사용량만큼 요금이 붙고 시간이 걸립니다.
          <br />
          중간에 <b>[멈추기]</b> 로 세울 수 있고, 그때까지 찾은 것은 남습니다.
        </>
      ),
      okText: '학습 시작'
    })
    if (!ok) return

    startJob('보관 문서 학습', runGroups.length)
    let found = 0

    // 도중에 무엇이 잘못되어도 '학습 중' 을 반드시 풀어야 한다.
    // 안 풀리면 이 화면의 입력칸이 모두 잠긴 채로 남는다.
    try {
      for (let i = 0; i < runGroups.length; i++) {
        if (isStopping()) break
        const g = runGroups[i]
        // 묶음을 대표하는 것은 본문이다. 뽑은 업무가 이 문서에 매달린다.
        const head = g.items[0]
        setProgress({ now: g.label, done: i })

        // 묶인 파일의 원문을 모아 한 덩어리로 잇는다.
        const parts: { name: string; text: string }[] = []
        for (const d of g.items) {
          const full = await window.api.docs.get(d.id)
          if (full?.content?.trim()) parts.push({ name: d.filename, text: full.content })
        }
        if (!parts.length) {
          addFailure(`${g.label} — 원문이 비어 있습니다`)
          continue
        }

        const joined = joinNotice(parts)
        // 켜 두면 개인정보를 가린 글만 나간다. 보관된 원문은 손대지 않는다.
        const text = scrub ? (await window.api.privacy.scrub(joined)).text : joined

        const res = await window.api.ai.analyze({
          filename: head.filename,
          text,
          kind,
          jobTitle,
          model: model ?? undefined
        })

        if (!res.ok) {
          addFailure(`${g.label} — ${res.error ?? '분석 실패'}`)
          // 키가 잘못됐거나 한도에 걸린 것이면 계속해 봐야 다 실패한다
          if (/키|한도|없습니다/.test(res.error ?? '')) {
            toast(`${res.error} — 중단합니다.`, 'err')
            break
          }
        } else if (res.drafts.length === 0) {
          addFailure(`${g.label} — 뽑을 업무를 찾지 못했습니다`)
        }

        // 이미 보관된 문서이므로 원문을 다시 넣지 않도록 id 를 달아 둔다.
        // 학년도는 고른 값을 쓰되, "공문을 따름" 이면 그 공문에 매겨 둔 것을 쓴다.
        addDrafts(
          res.drafts.map((x) => ({
            ...x,
            document_id: head.id,
            school_year: year === FOLLOW_DOC ? head.school_year : year
          }))
        )
        found += res.drafts.length
        setProgress({ done: i + 1 })
      }
    } finally {
      finishJob()
    }

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
        이미 보관해 둔 파일 <b>{docs.length}개</b>
        {groupDocs && allGroups.length !== docs.length && (
          <>
            {' '}
            를 공문 <b>{allGroups.length}건</b>으로 묶어
          </>
        )}{' '}
        파일 고르기 없이 그대로 AI에 넘깁니다. 아직 학습하지 않은 것은{' '}
        <b>{notYetGroups.length}건</b> 입니다.
      </p>

      {kind === '길라잡이/매뉴얼' && noticeChosen.length > 0 && (
        <div className="note note-warn" style={{ marginBottom: 10 }}>
          <b>고르신 것 가운데 {noticeChosen.length}개가 공문입니다.</b> 지금은
          [길라잡이·매뉴얼] 로 되어 있어 <b>파일마다 업무를 여러 건</b> 뽑습니다.
          [개별 공문] 으로 바꾸면 문서번호가 같은 것끼리 묶어 <b>공문 한 건에 업무 하나</b>로
          만듭니다.
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => onKind('개별 공문')}
              disabled={busy}
            >
              📃 개별 공문으로 바꾸기
            </button>
          </div>
        </div>
      )}

      {kind === '개별 공문' && (
        <label className="row" style={{ gap: 6, cursor: 'pointer', marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={groupDocs}
            onChange={(e) => setGroupDocs(e.target.checked)}
            disabled={busy}
            style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
          />
          <span className="small">
            같은 문서번호끼리 <b>한 공문으로 묶기</b>{' '}
            <span className="muted">— (본문)·(첨부) 를 한 건으로 봅니다</span>
          </span>
        </label>
      )}

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
        <button
          className="btn btn-sm"
          onClick={selectNotYet}
          disabled={busy || !notYetGroups.length}
        >
          아직 안 한 것 고르기 ({Math.min(notYetGroups.length, limit)})
        </button>
        <button className="btn btn-sm" onClick={selectAll} disabled={busy}>
          보이는 것 고르기
        </button>
        <button className="btn btn-sm btn-ghost" onClick={selectNone} disabled={busy}>
          선택 해제
        </button>
      </div>

      {runGroups.length > 0 && (
        <div className="note note-info" style={{ marginBottom: 10 }}>
          공문 <b>{runGroups.length}건</b>
          {runGroups.length !== chosen.length && <> (파일 {chosen.length}개)</>} 선택 · 글자{' '}
          {totalChars.toLocaleString()}자 · AI 요청 약 <b>{calls}회</b>
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
              {at}/{runGroups.length}
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
            <div style={{ width: `${runGroups.length ? (at / runGroups.length) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      <div className="storedlist">
        {shownGroups.length === 0 ? (
          <div className="empty">보관된 공문이 없습니다.</div>
        ) : (
          shownGroups.map((g) => {
            const head = g.items[0]
            const on = g.items.every((d) => picked.has(d.id))
            const chars = g.items.reduce((n, d) => n + d.chars, 0)
            return (
              <label key={g.key} className={`storeditem ${on ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleGroup(g.key)}
                  disabled={busy}
                />
                <span className="storeditem-name" title={g.items.map((d) => d.filename).join('\n')}>
                  {g.label}
                </span>
                {g.items.length > 1 && (
                  <span className="badge badge-accent">본문+첨부 {g.items.length}</span>
                )}
                {g.items.some((d) => learned.has(d.id)) && <span className="badge">학습함</span>}
                <span className="muted small">{head.doc_date || '날짜 미상'}</span>
                <span className={`badge ${head.school_year ? '' : 'badge-warn'}`}>
                  {schoolYearLabel(head.school_year)}
                </span>
                <span className="muted small">{chars.toLocaleString()}자</span>
              </label>
            )
          })
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
          disabled={busy || !runGroups.length}
        >
          {busy ? '분석 중…' : `🤖 고른 공문 ${runGroups.length}건 학습하기`}
        </button>
      </div>
    </div>
  )
}
