import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DocFull, SearchHit, Task } from '../../shared/types'
import { useToast } from '../lib/toast'
import { groupByTopic } from '../lib/topics'
import { monthOf, schoolOrder, weekOf } from '../lib/util'

interface Props {
  tasks: Task[]
  /** 인포그래픽에서 넘어온 주제 */
  initial?: string | null
  /** 낱낱의 업무를 목록에서 보고 싶을 때 */
  onOpenTask: (t: Task) => void
}

/** 흐름도는 DB 설정에 담아 인수인계 파일과 함께 넘어가게 한다. */
function flowKey(topic: string): string {
  return `flow:${topic}`
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

export default function TopicView({ tasks, initial, onOpenTask }: Props): JSX.Element {
  const toast = useToast()
  const topics = useMemo(() => groupByTopic(tasks), [tasks])
  const [picked, setPicked] = useState<string | null>(initial ?? null)
  const [query, setQuery] = useState('')

  const [docs, setDocs] = useState<SearchHit[]>([])
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [openDoc, setOpenDoc] = useState<DocFull | null>(null)

  const [flow, setFlow] = useState('')
  const [flowOpen, setFlowOpen] = useState(false)
  const [editing, setEditing] = useState(false)

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
    setFlow(await window.api.setting.get(flowKey(topic), ''))
    setEditing(false)
  }, [])

  useEffect(() => {
    if (!picked) return
    void loadDocs(picked)
    void loadFlow(picked)
    setFlowOpen(false)
  }, [picked, loadDocs, loadFlow])

  const saveFlow = async (): Promise<void> => {
    if (!picked) return
    await window.api.setting.set(flowKey(picked), flow)
    setEditing(false)
    toast('흐름도를 저장했습니다. 인수인계 파일에 함께 넘어갑니다.', 'ok')
  }

  const makeDraft = (): void => {
    if (!current) return
    setFlow(draftFlow(current.name, current.tasks))
    setFlowOpen(true)
    setEditing(true)
    toast('등록된 업무로 초안을 짰습니다. 고쳐서 저장하세요.', 'ok')
  }

  const showDoc = async (id: number): Promise<void> => {
    if (openDoc?.id === id) {
      setOpenDoc(null)
      return
    }
    setOpenDoc(await window.api.docs.get(id))
  }

  const shownTopics = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return topics
    return topics.filter((t) => t.name.toLowerCase().includes(q))
  }, [topics, query])

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
          {shownTopics.map((t) => {
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
          {shownTopics.length === 0 && (
            <p className="muted small" style={{ padding: '8px 4px' }}>
              찾는 주제가 없습니다.
            </p>
          )}
        </div>
      </div>

      {/* ── 고른 주제 ── */}
      <div className="topic-main">
        {!current ? (
          <div className="empty">
            왼쪽에서 업무 주제를 고르면, 그 업무의 <b>공문과 진행 내용을 날짜순으로</b> 볼 수
            있습니다.
          </div>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-title">
                <span>{current.name}</span>
                <span className="badge badge-accent">업무 {current.tasks.length}건</span>
                {docItems.length > 0 && <span className="badge">공문 {docItems.length}건</span>}
                <span className="spacer" />
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => setFlowOpen((v) => !v)}
                >
                  🗺 업무 흐름도
                </button>
              </div>

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
                      <div className="tl-date">{i.date || '날짜 미상'}</div>
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
