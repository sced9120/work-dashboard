import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Task, TaskInput } from '../../shared/types'
import TaskForm from '../components/TaskForm'
import RoadmapInfographic from '../components/RoadmapInfographic'
import TopicView from '../components/TopicView'
import { useToast } from '../lib/toast'
import { monthLabel, monthOf, schoolOrder, sortTasks } from '../lib/util'
import { parsePins, parseRenames, type TopicPins, type TopicRenames } from '../lib/topics'

/** 주제 이름표는 DB 설정에 담아 인수인계 파일과 함께 넘어가게 한다. */
const RENAME_KEY = 'topic_renames'
/** 업무를 손으로 넣은 주제. 이것도 설정에 담겨 인수인계 파일에 함께 넘어간다. */
const PIN_KEY = 'topic_pins'

/** 목록에서 검색한 것을 한 주제로 묶으러 [업무별] 로 넘길 때 들고 가는 것 */
export interface GroupSeed {
  name: string
  ids: number[]
}

type ViewMode = '인포그래픽' | '업무별' | '목록'

const VIEWS: { id: ViewMode; icon: string; hint: string }[] = [
  { id: '인포그래픽', icon: '📊', hint: '한 해 흐름을 주제로 묶어 한눈에' },
  { id: '업무별', icon: '🗂', hint: '한 업무의 공문·진행을 날짜순으로' },
  { id: '목록', icon: '☰', hint: '업무 하나하나를 펼쳐 보고 고치는 곳' }
]

export default function Roadmap(): JSX.Element {
  const toast = useToast()
  const [tasks, setTasks] = useState<Task[]>([])
  const [view, setView] = useState<ViewMode>('인포그래픽')
  const [topic, setTopic] = useState<string | null>(null)
  const [renames, setRenames] = useState<TopicRenames>({})
  const [pins, setPins] = useState<TopicPins>({})
  const [seed, setSeed] = useState<GroupSeed | null>(null)
  const [tab, setTab] = useState<number | 'all'>('all')
  const [openId, setOpenId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    const [list, raw, rawPins] = await Promise.all([
      window.api.tasks.list(),
      window.api.setting.get(RENAME_KEY, ''),
      window.api.setting.get(PIN_KEY, '')
    ])
    setTasks(list)
    setRenames(parseRenames(raw))
    // 지워진 업무의 자리는 치운다. 남겨 두면 표가 끝없이 불어난다.
    const alive = new Set(list.map((t) => String(t.id)))
    const kept: TopicPins = {}
    for (const [id, name] of Object.entries(parsePins(rawPins))) if (alive.has(id)) kept[id] = name
    setPins(kept)
  }, [])

  const savePins = useCallback(async (next: TopicPins): Promise<void> => {
    setPins(next)
    await window.api.setting.set(PIN_KEY, JSON.stringify(next))
  }, [])

  /**
   * 업무들을 한 주제에 넣는다. name 이 비어 있으면 손으로 넣은 것을 풀어
   * 자동 묶음으로 돌려보낸다.
   */
  const pinTasks = useCallback(
    async (ids: number[], name: string): Promise<void> => {
      const next = { ...pins }
      const trimmed = name.trim()
      for (const id of ids) {
        if (trimmed) next[String(id)] = trimmed
        else delete next[String(id)]
      }
      await savePins(next)
    },
    [pins, savePins]
  )

  /**
   * 주제 이름을 바꾼다.
   *
   * 자동으로 묶인 업무는 이름표(renames)로, 손으로 넣은 업무는 넣어 둔 표(pins)
   * 로 따로 기억하므로 둘 다 새 이름으로 옮겨야 한다. 한쪽만 옮기면 주제가
   * 두 조각으로 갈라진다.
   */
  const renameTopic = useCallback(
    async (autoName: string, oldName: string, next: string): Promise<void> => {
      const trimmed = next.trim()
      const merged = { ...renames }
      // 원래 이름으로 되돌리면 이름표를 지운다
      if (!trimmed || trimmed === autoName) delete merged[autoName]
      else merged[autoName] = trimmed
      setRenames(merged)
      await window.api.setting.set(RENAME_KEY, JSON.stringify(merged))

      const movedPins = { ...pins }
      let touched = false
      for (const [id, name] of Object.entries(movedPins)) {
        if (name !== oldName) continue
        touched = true
        if (trimmed) movedPins[id] = trimmed
        else delete movedPins[id]
      }
      if (touched) await savePins(movedPins)
    },
    [renames, pins, savePins]
  )

  useEffect(() => {
    void load()
  }, [load])

  const months = useMemo(() => {
    const set = new Set(tasks.map((t) => monthOf(t.task_date_display)))
    return [...set].sort((a, b) => schoolOrder(a) - schoolOrder(b))
  }, [tasks])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sortTasks(
      tasks.filter((t) => {
        if (tab !== 'all' && monthOf(t.task_date_display) !== tab) return false
        if (!q) return true
        return `${t.title} ${t.draft_full} ${t.key_points} ${t.workflow}`.toLowerCase().includes(q)
      })
    )
  }, [tasks, tab, query])

  const save = async (id: number, value: TaskInput): Promise<void> => {
    await window.api.tasks.update(id, value)
    setEditingId(null)
    await load()
    toast('저장했습니다.', 'ok')
  }

  const add = async (value: TaskInput): Promise<void> => {
    await window.api.tasks.add(value)
    setAdding(false)
    await load()
    toast('업무를 등록했습니다.', 'ok')
  }

  const remove = async (t: Task): Promise<void> => {
    await window.api.tasks.remove(t.id)
    await load()
    toast(`'${t.title}' 을(를) 삭제했습니다.`)
  }

  const toggle = async (t: Task): Promise<void> => {
    await window.api.tasks.update(t.id, { is_completed: t.is_completed === 1 ? 0 : 1 })
    await load()
  }

  return (
    <>
      <div className="page-head">
        <h1>연간 업무 로드맵</h1>
        <p>3월부터 이듬해 2월까지, 학사 일정 순서로 정리됩니다.</p>
      </div>

      <div className="viewswitch">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={`viewswitch-btn ${view === v.id ? 'active' : ''}`}
            onClick={() => setView(v.id)}
            title={v.hint}
          >
            <span className="viewswitch-icon">{v.icon}</span>
            {v.id}
          </button>
        ))}
      </div>

      {view === '인포그래픽' && (
        <RoadmapInfographic
          tasks={tasks}
          renames={renames}
          pins={pins}
          onPickTopic={(name) => {
            setTopic(name)
            setView('업무별')
          }}
        />
      )}

      {view === '업무별' && (
        <TopicView
          tasks={tasks}
          initial={topic}
          renames={renames}
          pins={pins}
          onRename={renameTopic}
          onPin={pinTasks}
          seed={seed}
          onSeedUsed={() => setSeed(null)}
          onChanged={load}
          onOpenTask={(t) => {
            setView('목록')
            setTab('all')
            setQuery('')
            setOpenId(t.id)
          }}
        />
      )}

      {view === '목록' && (
        <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="업무 검색 (제목, 본문, 절차)"
            style={{ flex: 1, minWidth: 200 }}
          />
          <button className="btn btn-primary" onClick={() => setAdding((v) => !v)}>
            {adding ? '닫기' : '＋ 업무 직접 추가'}
          </button>
        </div>

        {adding && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <TaskForm onSave={add} onCancel={() => setAdding(false)} saveLabel="등록" />
          </div>
        )}

        {query.trim() && visible.length > 0 && (
          <div className="row" style={{ marginTop: 10 }}>
            <span className="muted small">
              '{query.trim()}' 로 찾은 업무 <b>{visible.length}건</b>
            </span>
            <button
              className="btn btn-sm"
              onClick={() => {
                setSeed({ name: query.trim(), ids: visible.map((t) => t.id) })
                setView('업무별')
              }}
              title="찾은 업무를 한 주제로 모읍니다. 이름은 다음 화면에서 고칠 수 있습니다"
            >
              🗂 이 {visible.length}건을 한 주제로 묶기
            </button>
          </div>
        )}
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
          전체 ({tasks.length})
        </button>
        {months.map((m) => (
          <button key={m} className={`tab ${tab === m ? 'active' : ''}`} onClick={() => setTab(m)}>
            {monthLabel(m)}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          {tasks.length === 0
            ? '아직 등록된 업무가 없습니다. [문서로 업무 만들기]에서 매뉴얼이나 공문을 올려 보세요.'
            : '조건에 맞는 업무가 없습니다.'}
        </div>
      ) : (
        <div>
          {visible.map((t) => {
            const open = openId === t.id
            return (
              <div className="acc" key={t.id}>
                <button
                  className="acc-head"
                  onClick={() => {
                    setOpenId(open ? null : t.id)
                    setEditingId(null)
                  }}
                >
                  <span className="caret">{open ? '▼' : '▶'}</span>
                  <span className="badge badge-accent">{t.task_date_display || '수시'}</span>
                  <span
                    style={{ fontWeight: 600 }}
                    className={t.is_completed === 1 ? 'check-done' : ''}
                  >
                    {t.title}
                  </span>
                  <span className="spacer" />
                  {t.filename && <span className="badge">{t.filename}</span>}
                </button>

                {open && (
                  <div className="acc-body">
                    {editingId === t.id ? (
                      <TaskForm
                        task={t}
                        onSave={(v) => save(t.id, v)}
                        onCancel={() => setEditingId(null)}
                        saveLabel="수정 저장"
                      />
                    ) : (
                      <>
                        <div className="row" style={{ marginBottom: 12 }}>
                          <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={t.is_completed === 1}
                              onChange={() => void toggle(t)}
                              style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
                            />
                            <span className="small">완료</span>
                          </label>
                          <span className="spacer" />
                          <button className="btn btn-sm" onClick={() => setEditingId(t.id)}>
                            수정
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => void remove(t)}>
                            삭제
                          </button>
                        </div>

                        {t.task_date_raw && (
                          <p className="small muted" style={{ marginTop: 0 }}>
                            문서상 시기: {t.task_date_raw}
                          </p>
                        )}

                        {t.workflow && (
                          <div className="note note-info" style={{ marginBottom: 8 }}>
                            <b>처리 절차</b>
                            <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{t.workflow}</div>
                          </div>
                        )}
                        {t.key_points && (
                          <div className="note note-warn" style={{ marginBottom: 8 }}>
                            <b>유의사항</b>
                            <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>
                              {t.key_points}
                            </div>
                          </div>
                        )}
                        {t.draft_full && <div className="scroll-box">{t.draft_full}</div>}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
        </>
      )}
    </>
  )
}
