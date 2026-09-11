import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DocFull, SearchHit, Task, Workflow } from '../../shared/types'
import { BLANK_WORKFLOW } from '../../shared/types'
import WorkflowEditor, { draftWorkflow } from './WorkflowEditor'
import { useConfirm } from '../lib/confirm'
import { useToast } from '../lib/toast'
import {
  groupByTopic,
  rosterMatcher,
  UNSORTED,
  type TopicPins,
  type TopicRenames
} from '../lib/topics'
import type { GroupSeed } from '../pages/Roadmap'
import { monthOf, schoolOrder, todayStr, weekOf } from '../lib/util'

interface Props {
  tasks: Task[]
  /** 인포그래픽에서 넘어온 주제 */
  initial?: string | null
  /** 사람이 고쳐 붙인 주제 이름 */
  renames: TopicRenames
  /** 사람이 손으로 넣어 둔 주제 (업무 id → 주제 이름) */
  pins: TopicPins
  /**
   * 이름을 바꿀 때. autoName 은 프로그램이 붙인 원래 이름, oldName 은
   * 지금 보이는 이름. 손으로 넣은 업무는 oldName 으로 기억되어 있다.
   */
  onRename: (autoName: string, oldName: string, next: string) => Promise<void>
  /** 업무들을 한 주제에 넣는다. 이름이 비면 자동 묶음으로 돌려보낸다. */
  onPin: (ids: number[], name: string) => Promise<void>
  /** [목록] 에서 검색해 "한 주제로 묶기" 를 누르고 넘어온 것 */
  seed?: GroupSeed | null
  onSeedUsed?: () => void
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

/**
 * 이 주제의 [관련 공문] 에서 숨긴 공문 id. 값은 JSON 배열.
 *
 * 관련 공문은 주제 이름으로 찾아 온 것이라 엉뚱한 것이 섞인다.
 * 원문을 지우지는 않고 이 주제에서만 안 보이게 한다.
 */
function hideKey(topic: string): string {
  return `dochide:${topic}`
}

function parseIds(raw: string): number[] {
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []
  } catch {
    return []
  }
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
  pins,
  onRename,
  onPin,
  seed,
  onSeedUsed,
  onOpenTask,
  onChanged
}: Props): JSX.Element {
  const toast = useToast()
  const ask = useConfirm()
  const topics = useMemo(() => groupByTopic(tasks, renames, pins), [tasks, renames, pins])

  /** 업무 id → 지금 들어 있는 주제. 묶기 창에서 "어디서 오는지" 를 보여 준다. */
  const topicOf = useMemo(() => {
    const m = new Map<number, string>()
    for (const t of topics) for (const x of t.tasks) m.set(x.id, t.name)
    return m
  }, [topics])

  /** 이 주제에서 숨긴 공문 */
  const [hidden, setHidden] = useState<number[]>([])
  const [showHidden, setShowHidden] = useState(false)

  /**
   * 새 주제로 묶는 창.
   * picked 는 체크한 업무. 걸러 보기(filter)를 바꿔도 체크한 것은 남는다.
   */
  const [grouping, setGrouping] = useState<{
    name: string
    filter: string
    picked: Set<number>
  } | null>(null)
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

  // [목록] 에서 검색한 것을 묶으러 넘어오면 묶기 창을 바로 연다
  useEffect(() => {
    if (!seed) return
    setGrouping({ name: seed.name, filter: '', picked: new Set(seed.ids) })
    onSeedUsed?.()
  }, [seed, onSeedUsed])

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
    const [text, raw, rawHide] = await Promise.all([
      window.api.setting.get(flowKey(topic), ''),
      window.api.setting.get(wfKey(topic), ''),
      window.api.setting.get(hideKey(topic), '')
    ])
    setFlow(text)
    setWf(parseWorkflow(raw))
    setHidden(parseIds(rawHide))
    setShowHidden(false)
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

    // 글 흐름도, 그림 워크플로우, 숨긴 공문을 모두 새 이름으로 옮긴다
    for (const key of [flowKey, wfKey, hideKey]) {
      const old = await window.api.setting.get(key(current.name), '')
      if (!old) continue
      const already = await window.api.setting.get(key(next), '')
      // 합치는 경우 이미 있는 것을 덮지 않는다
      if (!already) await window.api.setting.set(key(next), old)
      await window.api.setting.set(key(current.name), '')
    }

    await onRename(current.autoName, current.name, next)
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
    const ok = await ask({
      title: `'${current.name}' 주제를 지울까요?`,
      body: (
        <>
          이 주제에 딸린 <b>업무 {n}건</b>이 함께 지워집니다.
          <br />
          보관된 공문 원문은 지워지지 않습니다.
        </>
      ),
      okText: '지우기',
      danger: true
    })
    if (!ok) return

    for (const t of current.tasks) await window.api.tasks.remove(t.id)

    // 이 주제에 붙여 둔 흐름도·워크플로우·숨긴 목록·이름표도 함께 치운다
    await window.api.setting.set(flowKey(current.name), '')
    await window.api.setting.set(wfKey(current.name), '')
    await window.api.setting.set(hideKey(current.name), '')
    if (renames[current.autoName]) await onRename(current.autoName, current.name, '')

    setPicked(null)
    await onChanged()
    toast(`'${current.name}' 주제와 업무 ${n}건을 지웠습니다.`)
  }

  /** 업무 하나를 다른 주제로 옮긴다. UNSORTED 로 보내면 "빼기" 가 된다. */
  const moveTask = async (t: Task, to: string): Promise<void> => {
    if (!to) return
    await onPin([t.id], to)
    toast(
      to === UNSORTED ? `'${t.title}' 을(를) 이 주제에서 뺐습니다.` : `'${to}' 로 옮겼습니다.`,
      'ok'
    )
  }

  /** 손으로 넣은 것을 풀어 제목대로 자동 묶음에 돌려보낸다 */
  const unpinTask = async (t: Task): Promise<void> => {
    await onPin([t.id], '')
    toast('자동으로 묶이게 되돌렸습니다.', 'ok')
  }

  const hideDoc = async (id: number): Promise<void> => {
    if (!current) return
    const next = [...new Set([...hidden, id])]
    setHidden(next)
    await window.api.setting.set(hideKey(current.name), JSON.stringify(next))
    toast('이 주제에서 숨겼습니다. 원문은 그대로 있습니다.', 'ok')
  }

  const unhideDoc = async (id: number): Promise<void> => {
    if (!current) return
    const next = hidden.filter((x) => x !== id)
    setHidden(next)
    await window.api.setting.set(hideKey(current.name), next.length ? JSON.stringify(next) : '')
  }

  /** 묶기 창에 보일 업무 — 걸러 보기에 맞는 것과, 이미 체크한 것 */
  const groupList = useMemo(() => {
    if (!grouping) return []
    const q = grouping.filter.trim().toLowerCase()
    return tasks.filter(
      (t) =>
        grouping.picked.has(t.id) ||
        (q && `${t.title} ${t.filename ?? ''}`.toLowerCase().includes(q))
    )
  }, [grouping, tasks])

  const makeGroup = async (): Promise<void> => {
    if (!grouping) return
    const name = grouping.name.trim()
    if (!name) {
      toast('주제 이름을 적어 주세요.', 'err')
      return
    }
    if (!grouping.picked.size) {
      toast('묶을 업무를 하나 이상 골라 주세요.', 'err')
      return
    }
    const merging = topics.some((t) => t.name === name)
    await onPin([...grouping.picked], name)
    setGrouping(null)
    setQuery('')
    setPicked(name)
    toast(
      merging
        ? `'${name}' 주제에 ${grouping.picked.size}건을 더했습니다.`
        : `'${name}' 주제를 만들어 ${grouping.picked.size}건을 넣었습니다.`,
      'ok'
    )
  }

  /** 업무분장표와 맞춰 보는 잣대 */
  const inRoster = useMemo(() => rosterMatcher(roster), [roster])
  const splitting = roster.trim().length > 0

  const shownTopics = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return topics
    return topics.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.tasks.some((x) => x.title.toLowerCase().includes(q))
    )
  }, [topics, query])

  /** 찾는 말이 제목에 든 업무 — 이것을 한 주제로 묶을 수 있다 */
  const matched = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return tasks.filter((t) => `${t.title} ${t.filename ?? ''}`.toLowerCase().includes(q))
  }, [tasks, query])

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

  const allDocItems = timeline.filter((i) => i.kind === 'doc')
  const docItems = allDocItems.filter((i) => !hidden.includes(i.hit!.id))
  const hiddenItems = allDocItems.filter((i) => hidden.includes(i.hit!.id))
  const taskItems = timeline.filter((i) => i.kind === 'task')

  return (
    <div className="topic-wrap">
      {/* ── 주제 목록 ── */}
      <div className="topic-side">
        <div className="row" style={{ gap: 6, marginBottom: 8 }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="주제·업무 찾기"
            className="topic-search"
            style={{ flex: 1, marginBottom: 0 }}
          />
          <button
            className="btn btn-sm btn-primary"
            title="업무를 골라 새 주제로 묶습니다"
            onClick={() => setGrouping({ name: '', filter: query, picked: new Set() })}
          >
            ＋ 새 주제
          </button>
        </div>

        {matched.length > 0 && (
          <div className="topic-found">
            <div className="small">
              제목에 <b>'{query.trim()}'</b> 가 든 업무 <b>{matched.length}건</b>
            </div>
            <button
              className="btn btn-sm"
              onClick={() =>
                setGrouping({
                  name: query.trim(),
                  filter: query.trim(),
                  picked: new Set(matched.map((t) => t.id))
                })
              }
            >
              🗂 한 주제로 묶기
            </button>
          </div>
        )}
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
                        <div className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
                          <button
                            className="tl-title"
                            style={{ flex: 1 }}
                            onClick={() => void showDoc(i.hit!.id)}
                          >
                            {i.title}
                          </button>
                          <button
                            className="btn btn-sm btn-ghost tl-hide"
                            title="이 주제의 관련 공문에서 뺍니다. 원문은 지워지지 않습니다"
                            onClick={() => void hideDoc(i.hit!.id)}
                          >
                            숨기기
                          </button>
                        </div>
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

              {hiddenItems.length > 0 && (
                <div className="small muted" style={{ marginTop: 10 }}>
                  <button className="link" onClick={() => setShowHidden((v) => !v)}>
                    숨긴 공문 {hiddenItems.length}건 {showHidden ? '접기' : '보기'}
                  </button>
                  {showHidden && (
                    <div className="list" style={{ marginTop: 6 }}>
                      {hiddenItems.map((i) => (
                        <div className="row" key={i.key} style={{ gap: 6 }}>
                          <span style={{ flex: 1, minWidth: 0 }}>{i.title}</span>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => void unhideDoc(i.hit!.id)}
                          >
                            다시 보이기
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 업무 — 학사 순서 */}
            <div className="card">
              <div className="card-title">
                <span>이 주제의 업무</span>
                <span className="muted small">3월부터 차례로</span>
                <span className="spacer" />
                <button
                  className="btn btn-sm"
                  title="다른 업무를 찾아 이 주제에 더합니다"
                  onClick={() =>
                    setGrouping({ name: current.name, filter: '', picked: new Set() })
                  }
                >
                  ＋ 업무 더하기
                </button>
              </div>
              {current.name === UNSORTED && (
                <div className="note note-info" style={{ marginBottom: 10 }}>
                  주제에서 뺀 업무가 모이는 곳입니다. [주제 옮기기] 로 다른 주제에 넣거나,
                  [자동으로] 를 눌러 제목대로 다시 묶이게 하세요.
                </div>
              )}
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
                      <div className="topic-task-tools">
                        <select
                          value=""
                          onChange={(e) => void moveTask(i.task!, e.target.value)}
                          title="이 업무를 다른 주제로 옮깁니다"
                        >
                          <option value="">주제 옮기기…</option>
                          {topics
                            .filter((x) => x.name !== current.name && x.name !== UNSORTED)
                            .map((x) => (
                              <option key={x.name} value={x.name}>
                                {x.name} ({x.tasks.length})
                              </option>
                            ))}
                        </select>
                        {current.name !== UNSORTED ? (
                          <button
                            className="btn btn-sm btn-ghost"
                            title="이 주제에서 빼서 [미분류] 로 보냅니다"
                            onClick={() => void moveTask(i.task!, UNSORTED)}
                          >
                            이 주제에서 빼기
                          </button>
                        ) : (
                          <button
                            className="btn btn-sm btn-ghost"
                            title="제목대로 다시 자동으로 묶이게 합니다"
                            onClick={() => void unpinTask(i.task!)}
                          >
                            자동으로
                          </button>
                        )}
                        {pins[String(i.task!.id)] && current.name !== UNSORTED && (
                          <span className="badge" title="손으로 이 주제에 넣은 업무입니다">
                            손으로 넣음
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── 새 주제로 묶기 ── */}
      {grouping && (
        <div className="sheet-back" onClick={() => setGrouping(null)}>
          <div
            className="sheet topic-sheet"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                void makeGroup()
              }
              if (e.key === 'Escape') setGrouping(null)
            }}
          >
            <div className="sheet-grip" />
            <div className="sheet-title">
              {topics.some((t) => t.name === grouping.name.trim())
                ? `'${grouping.name.trim()}' 에 업무 더하기`
                : '새 주제로 묶기'}
            </div>

            <input
              type="text"
              className="sheet-input-title"
              value={grouping.name}
              onChange={(e) => setGrouping({ ...grouping, name: e.target.value })}
              placeholder="주제 이름 (예: 배움터지킴이)"
              autoFocus
            />
            <p className="hint" style={{ marginTop: 4 }}>
              이미 있는 주제 이름을 적으면 그 주제에 더해집니다.
            </p>

            <input
              type="text"
              value={grouping.filter}
              onChange={(e) => setGrouping({ ...grouping, filter: e.target.value })}
              placeholder="넣을 업무 찾기 (제목·파일 이름)"
              style={{ marginTop: 6 }}
            />

            <div className="row" style={{ margin: '8px 0 6px' }}>
              <span className="small">
                <b>{grouping.picked.size}건</b> 골랐습니다
              </span>
              <span className="spacer" />
              <button
                className="btn btn-sm btn-ghost"
                onClick={() =>
                  setGrouping({
                    ...grouping,
                    picked: new Set([...grouping.picked, ...groupList.map((t) => t.id)])
                  })
                }
                disabled={!groupList.length}
              >
                보이는 것 모두
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setGrouping({ ...grouping, picked: new Set() })}
                disabled={!grouping.picked.size}
              >
                모두 해제
              </button>
            </div>

            <div className="topic-pick-list">
              {groupList.length === 0 ? (
                <div className="empty small">
                  {grouping.filter.trim()
                    ? '찾는 업무가 없습니다.'
                    : '위에 낱말을 적으면 넣을 업무를 찾아 줍니다.'}
                </div>
              ) : (
                groupList.map((t) => {
                  const on = grouping.picked.has(t.id)
                  const from = topicOf.get(t.id)
                  return (
                    <label key={t.id} className={`topic-pick ${on ? 'on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          const next = new Set(grouping.picked)
                          if (on) next.delete(t.id)
                          else next.add(t.id)
                          setGrouping({ ...grouping, picked: next })
                        }}
                      />
                      <span className="topic-pick-title">{t.title}</span>
                      {from && <span className="badge">{from}</span>}
                    </label>
                  )
                })
              )}
            </div>

            <div className="sheet-foot">
              <span className="muted small">Ctrl+Enter 로 바로 묶기</span>
              <span className="spacer" />
              <button className="btn" onClick={() => setGrouping(null)}>
                취소
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void makeGroup()}
                disabled={!grouping.name.trim() || !grouping.picked.size}
              >
                {grouping.picked.size}건 묶기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
