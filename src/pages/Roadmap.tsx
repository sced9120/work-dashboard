import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Task, TaskInput } from '../../shared/types'
import TaskForm from '../components/TaskForm'
import { useToast } from '../lib/toast'
import { monthLabel, monthOf, schoolOrder, sortTasks } from '../lib/util'

export default function Roadmap(): JSX.Element {
  const toast = useToast()
  const [tasks, setTasks] = useState<Task[]>([])
  const [tab, setTab] = useState<number | 'all'>('all')
  const [openId, setOpenId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    setTasks(await window.api.tasks.list())
  }, [])

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
  )
}
