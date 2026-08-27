import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DocFull, SearchHit, Task, Workflow } from '../../shared/types'
import { BLANK_WORKFLOW } from '../../shared/types'
import WorkflowEditor, { draftWorkflow } from './WorkflowEditor'
import { useToast } from '../lib/toast'
import { groupByTopic, rosterMatcher, type TopicRenames } from '../lib/topics'
import { monthOf, schoolOrder, todayStr, weekOf } from '../lib/util'

interface Props {
  tasks: Task[]
  /** 인포그래픽에서 넘어온 주제 */
  initial?: string | null
  /** 사람이 고쳐 붙인 주제 이름 */
  renames: TopicRenames
  /** 이름을 바꿀 때. autoName 은 프로그램이 붙인 원래 이름 */
  onRename: (autoName: string, next: string) => Promise<void>
  /** 낱낱의 업무를 목록에서 보고 싶을 때 */
  onOpenTask: (t: Task) => void
  /** 주제를 통째로 지운 뒤 목록을 다시 읽게 한다 */
  onChanged: () => Promise<void>
}

/** 흐름도는 DB 설정에 담아 인수인계 파일과 함께 넘어가게 한다. */
function flowKey(topic: string): string {
  return `flow:${topic}`
}

/** 그림 워크플로우도 같은 방식으로 담는다. 값은 JSON. */
function wfKey(topic: string): string {
  return `wf:${topic}`
}

function parseWorkflow(raw: string): Workflow {
  try {
    const v = JSON.parse(raw) as Workflow
    if (!v || !Array.isArray(v.nodes) || !Array.isArray(v.edges)) return BLANK_WORKFLOW
    return v
  } catch {
    return BLANK_WORKFLOW
  }
}

/** 이 주제의 업무들로 흐름도 초안을 짠다. AI 없이 있는 자료만 쓴다. */
function draftFlow(topic: string, list: Task[]): string {
  const sorted = [...list].sort((a, b) => {
    const om =
      schoolOrder(monthOf(a.task_date_display)) - schoolOrder(monthOf(b.task_date_display))
    if (om !== 0) return om
    return weekOf(a.task_date_display) - weekOf(b.task_date_display)
  })

  const lines: string[] = [`# ${topic} — 업무 흐름`, '']

  let lastWhen = ''
  for (const t of sorted) {
    const when = t.task_date_display || '수시'
    if (when !== lastWhen) {
      lines.push(`## ${when}`)
      lastWhen = when
    }
    lines.push(`- ${t.title}`)

    // 절차가 적혀 있으면 한 단계씩 들여 붙인다
    const steps = (t.workflow || '')
      .split(/\r?\n/)
      .map((s) => s.replace(/^[\s·\-*\d.)]+/, '').trim())
      .filter(Boolean)
    for (const s of steps.slice(0, 6)) lines.push(`    · ${s}`)

    if (t.key_points?.trim()) {
      lines.push(`    ⚠ ${t.key_points.trim().split(/\r?\n/)[0]}`)
    }
  }

  lines.push('')
  lines.push('## 다음 담당자에게')
  lines.push('- (놓치기 쉬운 것, 연락처, 협조 부서 등을 여기에 적어 두세요)')

  return lines.join('\n')
}

export default function TopicView({
  tasks,
  initial,
  renames,
  onRename,
  onOpenTask,
  onChanged
}: Props): JSX.Element {
  const toast = useToast()
  const topics = useMemo(() => groupByTopic(tasks, renames), [tasks, renames])
  const [picked, setPicked] = useState<string | null>(initial ?? null)
  const [query, setQuery] = useState('')

  const [docs, setDocs] = useState<SearchHit[]>([])
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [openDoc, setOpenDoc] = useState<DocFull | null>(null)

  const [flow, setFlow] = useState('')
  const [flowOpen, setFlowOpen] = useState(false)
  const [editing, setEditing] = useState(false)

  /** 그림 워크플로우 */
  const [wf, setWf] = useState<Workflow>(BLANK_WORKFLOW)
  const [wfOpen, setWfOpen] = useState(false)
  const [wfDirty, setWfDirty] = useState(false)

  /** 이름 바꾸는 중이면 그 값 */
  const [renaming, setRenaming] = useState<string | null>(null)
  /** 날짜를 고치는 중인 공문 id */
  const [dateEdit, setDateEdit] = useState<{ id: number; value: string } | null>(null)

  /** 업무분장표. 내 일과 전임자가 남긴 것을 가르는 데 쓴다 */
  const [roster, setRoster] = useState('')

  useEffect(() => {
    void (async () => setRoster(await window.api.setting.get('duty_roster')))()
  }, [])

  // 인포그래픽에서 주제를 눌러 들어오면 그 주제로 맞춘다
  useEffect(() => {
    if (initial) setPicked(initial)
  }, [initial])

  const current = useMemo(
    () => topics.find((t) => t.name === picked) ?? null,
    [topics, picked]
  )

  /** 주제와 관련된 공문을 찾아 온다. 통합 검색을 그대로 쓴다. */
  const loadDocs = useCallback(async (topic: string) => {
    setLoadingDocs(true)
    setOpenDoc(null)
    try {
      const hits = await window.api.search.run(topic)
      setDocs(hits.filter((h) => h.kind === 'document'))
    } finally {
      setLoadingDocs(false)
    }
  }, [])

  const loadFlow = useCallback(async (topic: string) => {
    const [text, raw] = await Promise.all([
      window.api.setting.get(flowKey(topic), ''),
      window.api.setting.get(wfKey(topic), '')
    ])
    setFlow(text)
    setWf(parseWorkflow(raw))
    setWfDirty(false)
    setEditing(false)
  }, [])

  useEffect(() => {
    if (!picked) return
    void loadDocs(picked)
    void loadFlow(picked)
    setFlowOpen(false)
    setWfOpen(false)
  }, [picked, loadDocs, loadFlow])

  const saveFlow = async (): Promise<void> => {
    if (!picked) return
    await window.api.setting.set(flowKey(picked), flow)
    setEditing(false)
    toast('흐름도를 저장했습니다. 인수인계 파일에 함께 넘어갑니다.', 'ok')
  }

  const saveWf = async (): Promise<void> => {
    if (!picked) return
    // 빈 그림은 값을 지워 둔다. 그래야 "아직 안 그림" 과 구분된다.
    const has = wf.nodes.length > 0
    await window.api.setting.set(wfKey(picked), has ? JSON.stringify(wf) : '')
    setWfDirty(false)
    toast(
      has
        ? '워크플로우를 저장했습니다. 인수인계 파일에 함께 넘어갑니다.'
        : '워크플로우를 비웠습니다.',
      'ok'
    )
  }

  const changeWf = (next: Workflow): void => {
    setWf(next)
    setWfDirty(true)
  }

  /**
   * 주제 이름을 바꾼다.
   * 흐름도는 이름을 열쇠로 저장돼 있으므로 새 이름으로 함께 옮긴다.
   * 옮기지 않으면 이름을 바꾸는 순간 정리해 둔 흐름도가 사라진 것처럼 보인다.
   */
  const applyRename = async (): Promise<void> => {
    if (!current || renaming === null) return
    const next = renaming.trim()
    if (!next || next === current.name) {
      setRenaming(null)
      return
    }

    // 글 흐름도와 그림 워크플로우 둘 다 새 이름으로 옮긴다
    for (const key of [flowKey, wfKey]) {
      const old = await window.api.setting.get(key(current.name), '')
      if (!old) continue
      const already = await window.api.setting.get(key(next), '')
      // 합치는 경우 이미 있는 것을 덮지 않는다
      if (!already) await window.api.setting.set(key(next), old)
      await window.api.setting.set(key(current.name), '')
    }

    await onRename(current.autoName, next)
    setPicked(next)
    setRenaming(null)
    toast(`'${next}' 로 바꿨습니다.`, 'ok')
  }

  const makeDraft = (): void => {
    if (!current) return
    setFlow(draftFlow(current.name, current.tasks))
    setFlowOpen(true)
    setEditing(true)
    toast('등록된 업무로 초안을 짰습니다. 고쳐서 저장하세요.', 'ok')
  }

  /** 잘못 잡힌 공문 날짜를 고친다. 법령 인용 연도가 잡히는 일이 있다. */
  const saveDate = async (): Promise<void> => {
    if (!dateEdit || !picked) return
    const { id, value } = dateEdit
    setDateEdit(null)
    await window.api.docs.setDate(id, value)
    await loadDocs(picked)
    toast(value ? `날짜를 ${value} 로 고쳤습니다.` : '날짜를 지웠습니다.', 'ok')
  }

  const showDoc = async (id: number): Promise<void> => {
    if (openDoc?.id === id) {
      setOpenDoc(null)
      return
    }
    setOpenDoc(await window.api.docs.get(id))
  }

  /**
   * 주제를 통째로 지운다.
   * 공문에서 뽑다 보면 "대상자", "자녀를" 처럼 업무가 아닌 것이 주제로 서기도 한다.
   * 그런 것은 딸린 업무까지 지워야 목록에서 사라진다. 공문 원문은 건드리지 않는다.
   */
  const removeTopic = async (): Promise<void> => {
    if (!current) return
    const n = current.tasks.length
    const ok = confirm(
      `'${current.name}' 주제를 지웁니다.\n\n` +
        `이 주제에 딸린 업무 ${n}건이 함께 지워집니다.\n` +
        `보관된 공문 원문은 지워지지 않습니다.\n\n계속할까요?`
    )
    if (!ok) return

    for (const t of current.tasks) await window.api.tasks.remove(t.id)

    // 이 주제에 붙여 둔 흐름도·워크플로우·이름표도 함께 치운다
    await window.api.setting.set(flowKey(current.name), '')
    await window.api.setting.set(wfKey(current.name), '')
    if (renames[current.autoName]) await onRename(current.autoName, '')

    setPicked(null)
    await onChanged()
    toast(`'${current.name}' 주제와 업무 ${n}건을 지웠습니다.`)
  }

  /** 업무분장표와 맞춰 보는 잣대 */
  const inRoster = useMemo(() => rosterMatcher(roster), [roster])
  const splitting = roster.trim().length > 0

  const shownTopics = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return topics
    return topics.filter((t) => t.name.toLowerCase().includes(q))
  }, [topics, query])

  /** 분장표가 있으면 내 일과 그 밖의 것으로 가른다 */
  const groups = useMemo(() => {
    if (!splitting) return [{ label: '', items: shownTopics }]
    const mine = shownTopics.filter((t) => inRoster(t.name))
    const rest = shownTopics.filter((t) => !inRoster(t.name))
    return [
      { label: `내 업무분장 (${mine.length})`, items: mine },
      { label: `분장 밖 · 전임자 자료 (${rest.length})`, items: rest }
    ].filter((g) => g.items.length > 0)
  }, [shownTopics, inRoster, splitting])

  /** 업무 + 공문을 날짜순으로 하나의 흐름에 늘어놓는다 */
  const timeline = useMemo(() => {
    if (!current) return []
    const items: {
      key: string
      kind: 'task' | 'doc'
      date: string
      when: string
      title: string
      task?: Task
      hit?: SearchHit
    }[] = []

    for (const t of current.tasks) {
      items.push({
        key: `t${t.id}`,
        kind: 'task',
        date: '',
        when: t.task_date_display || '수시',
        title: t.title,
        task: t
      })
    }
    for (const h of docs) {
      items.push({
        key: `d${h.id}`,
        kind: 'doc',
        date: h.date,
        when: h.date || '날짜 미상',
        title: h.title,
        hit: h
      })
    }

    // 날짜를 아는 것(공문)은 날짜순, 업무는 학사 순서. 공문을 먼저 놓는다.
    return items.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'doc' ? -1 : 1
      if (a.kind === 'doc') return (a.date || '9999').localeCompare(b.date || '9999')
      const om =
        schoolOrder(monthOf(a.when)) - schoolOrder(monthOf(b.when))
      if (om !== 0) return om
      return weekOf(a.when) - weekOf(b.when)
    })
  }, [current, docs])

  const docItems = timeline.filter((i) => i.kind === 'doc')
  const taskItems = timeline.filter((i) => i.kind === 'task')

  return (
    <div className="topic-wrap">
      {/* ── 주제 목록 ── */}
      <div className="topic-side">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="주제 찾기"
          className="topic-search"
        />
        <div className="topic-list">
          {groups.map((g) => (
            <div key={g.label || 'all'}>
              {g.label && <div className="topic-group">{g.label}</div>}
              {g.items.map((t) => {
                const done = t.tasks.filter((x) => x.is_completed === 1).length
                return (
                  <button
                    key={t.name}
                    className={`topic-item ${picked === t.name ? 'on' : ''}`}
                    onClick={() => setPicked(t.name)}
                  >
                    <span className="topic-item-name">{t.name}</span>
                    <span className="topic-item-n">
                      {done > 0 && <b>{done}/</b>}
                      {t.tasks.length}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
          {shownTopics.length === 0 && (
            <p className="muted small" style={{ padding: '8px 4px' }}>
              찾는 주제가 없습니다.
            </p>
          )}
        </div>

        <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
          {splitting ? (
            <>
              분장표의 낱말로 맞춰 본 것이라 <b>더러 헛짚습니다.</b> 보기 편하라고 갈라 둔 것이니,
              어긋나면 [설정]의 분장표에 그 말을 보태거나 주제 이름을 고치세요.
            </>
          ) : (
            <>
              [설정]에 <b>업무분장표</b>를 넣어 두면, 내 일과 전임자가 남긴 자료를 갈라서 보여
              줍니다.
            </>
          )}
        </p>
      </div>

      {/* ── 고른 주제 ── */}
      <div className="topic-main">
        {!current ? (
          <div className="empty">
            왼쪽에서 업무 주제를 고르면, 그 업무의 <b>공문과 진행 내용을 날짜순으로</b> 볼 수
            있습니다.
            <div className="small muted" style={{ marginTop: 8 }}>
              주제 이름이 어색하면 <b>[✎ 이름]</b> 으로 바꿀 수 있습니다. 두 주제를 같은 이름으로
              바꾸면 하나로 합쳐집니다.
            </div>
          </div>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-title">
                {renaming === null ? (
                  <>
                    <span>{current.name}</span>
                    <button
                      className="btn btn-sm btn-ghost"
                      title="이 주제의 이름을 바꿉니다"
                      onClick={() => setRenaming(current.name)}
                    >
                      ✎ 이름
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      type="text"
                      value={renaming}
                      onChange={(e) => setRenaming(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void applyRename()
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                      className="topic-rename"
                      autoFocus
                    />
                    <button className="btn btn-sm btn-primary" onClick={() => void applyRename()}>
                      바꾸기
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setRenaming(null)}>
                      취소
                    </button>
                  </>
                )}
                <span className="badge badge-accent">업무 {current.tasks.length}건</span>
                {docItems.length > 0 && <span className="badge">공문 {docItems.length}건</span>}
                {splitting && !inRoster(current.name) && (
                  <span className="badge badge-warn" title="업무분장표에서 찾지 못했습니다">
                    분장 밖
                  </span>
                )}
                <button
                  className="btn btn-sm btn-danger"
                  title="이 주제와 딸린 업무를 지웁니다 (공문 원문은 남습니다)"
                  onClick={() => void removeTopic()}
                >
                  🗑 주제 지우기
                </button>
                <span className="spacer" />
                <button className="btn btn-sm" onClick={() => setFlowOpen((v) => !v)}>
                  🗺 글 흐름도
                </button>
                <button
                  className={`btn btn-sm ${wf.nodes.length ? 'btn-primary' : ''}`}
                  onClick={() => setWfOpen((v) => !v)}
                  title="상자와 화살표로 그리는 워크플로우"
                >
                  🧩 워크플로우 그리기
                  {wf.nodes.length > 0 && ` (${wf.nodes.length})`}
                </button>
              </div>

              {wfOpen && (
                <div className="flow-panel">
                  {wf.nodes.length === 0 && (
                    <div className="note note-info" style={{ marginBottom: 10 }}>
                      상자를 놓아 업무 흐름을 그립니다. <b>[✍ 업무로 자동 배치]</b> 를 누르면
                      등록된 업무 {current.tasks.length}건을 시기 순으로 세워 첫 그림을 만들어
                      줍니다. 거기서 옮기고 고치시면 됩니다.
                    </div>
                  )}

                  <WorkflowEditor
                    topic={current.name}
                    value={wf}
                    onChange={changeWf}
                    tasks={current.tasks}
                  />

                  <div className="row row-end" style={{ marginTop: 10 }}>
                    {wfDirty && <span className="badge badge-warn">저장 안 된 변경</span>}
                    <span className="spacer" />
                    <button
                      className="btn btn-sm"
                      onClick={() => void loadFlow(current.name)}
                      disabled={!wfDirty}
                    >
                      되돌리기
                    </button>
                    <button className="btn btn-sm btn-primary" onClick={() => void saveWf()}>
                      저장
                    </button>
                  </div>
                </div>
              )}

              {flowOpen && (
                <div className="flow-panel">
                  {flow ? (
                    editing ? (
                      <>
                        <textarea
                          className="flow-edit"
                          value={flow}
                          onChange={(e) => setFlow(e.target.value)}
                          rows={16}
                        />
                        <div className="row row-end" style={{ marginTop: 8 }}>
                          <button className="btn btn-sm" onClick={() => void loadFlow(current.name)}>
                            되돌리기
                          </button>
                          <button className="btn btn-sm btn-primary" onClick={() => void saveFlow()}>
                            저장
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <pre className="flow-view">{flow}</pre>
                        <div className="row row-end" style={{ marginTop: 8 }}>
                          <button className="btn btn-sm" onClick={makeDraft}>
                            초안 다시 짜기
                          </button>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => setEditing(true)}
                          >
                            고치기
                          </button>
                        </div>
                      </>
                    )
                  ) : (
                    <div className="flow-empty">
                      <p style={{ marginTop: 0 }}>
                        아직 정리된 흐름도가 없습니다. 등록된 업무 {current.tasks.length}건으로
                        <b> 초안을 짜 드립니다.</b> 고쳐서 저장하면 <b>인수인계 파일에 함께</b>{' '}
                        넘어갑니다.
                      </p>
                      <button className="btn btn-primary" onClick={makeDraft}>
                        ✍ 흐름도 초안 짜기
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 공문 — 날짜순 */}
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-title">
                <span>관련 공문</span>
                <span className="muted small">오래된 것부터</span>
              </div>
              {loadingDocs ? (
                <p className="muted small" style={{ margin: 0 }}>
                  찾는 중…
                </p>
              ) : docItems.length === 0 ? (
                <p className="muted small" style={{ margin: 0 }}>
                  이 주제로 보관된 공문이 없습니다. [문서로 업무 만들기]에서 공문을 올리면 여기
                  모입니다.
                </p>
              ) : (
                <div className="tl">
                  {docItems.map((i) => (
                    <div className="tl-row" key={i.key}>
                      <div className="tl-date">
                        {dateEdit?.id === i.hit!.id ? (
                          <input
                            type="date"
                            className="tl-date-edit"
                            value={dateEdit.value}
                            autoFocus
                            onChange={(e) => setDateEdit({ id: i.hit!.id, value: e.target.value })}
                            onBlur={() => void saveDate()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void saveDate()
                              if (e.key === 'Escape') setDateEdit(null)
                            }}
                          />
                        ) : (
                          <button
                            className="tl-date-btn"
                            title="날짜가 잘못 잡혔으면 눌러서 고치세요"
                            onClick={() =>
                              setDateEdit({ id: i.hit!.id, value: i.date || todayStr() })
                            }
                          >
                            {i.date || '날짜 미상'}
                          </button>
                        )}
                      </div>
                      <div className="tl-dot" />
                      <div className="tl-body">
                        <button className="tl-title" onClick={() => void showDoc(i.hit!.id)}>
                          {i.title}
                        </button>
                        {i.hit!.snippets.slice(0, 1).map((s, si) => (
                          <div className="note" key={si} style={{ marginTop: 4 }}>
                            {s}
                          </div>
                        ))}
                        {openDoc?.id === i.hit!.id && (
                          <div className="scroll-box" style={{ marginTop: 8 }}>
                            {openDoc.content}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 업무 — 학사 순서 */}
            <div className="card">
              <div className="card-title">
                <span>이 주제의 업무</span>
                <span className="muted small">3월부터 차례로</span>
              </div>
              <div className="tl">
                {taskItems.map((i) => (
                  <div className="tl-row" key={i.key}>
                    <div className="tl-date">{i.when}</div>
                    <div className={`tl-dot ${i.task!.is_completed === 1 ? 'done' : ''}`} />
                    <div className="tl-body">
                      <button
                        className={`tl-title ${i.task!.is_completed === 1 ? 'check-done' : ''}`}
                        onClick={() => onOpenTask(i.task!)}
                      >
                        {i.title}
                      </button>
                      {i.task!.filename && (
                        <div className="item-meta">출처: {i.task!.filename}</div>
                      )}
                      {i.task!.key_points && (
                        <div className="note note-warn" style={{ marginTop: 4 }}>
                          {i.task!.key_points}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
