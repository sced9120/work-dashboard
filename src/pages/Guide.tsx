import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Task } from '../../shared/types'
import { useToast } from '../lib/toast'
import { sortTasks } from '../lib/util'

/**
 * 업무 하나를 골라 자세히 보고, 본인이 알게 된 요령을 덧붙이는 화면.
 * 예전 버전에서는 여기서 내용을 고쳐도 저장되지 않았다.
 */
export default function Guide(): JSX.Element {
  const toast = useToast()
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [points, setPoints] = useState('')
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    const list = await window.api.tasks.list()
    setTasks(list)
    return list
  }, [])

  useEffect(() => {
    void (async () => {
      const list = await load()
      const sorted = sortTasks(list)
      if (sorted.length) setSelectedId((cur) => cur ?? sorted[0].id)
    })()
  }, [load])

  const selected = tasks.find((t) => t.id === selectedId) ?? null

  useEffect(() => {
    setDraft(selected?.draft_full ?? '')
    setPoints(selected?.key_points ?? '')
    setDirty(false)
  }, [selected])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sortTasks(tasks).filter((t) => !q || t.title.toLowerCase().includes(q))
  }, [tasks, query])

  const save = async (): Promise<void> => {
    if (!selected) return
    await window.api.tasks.update(selected.id, { draft_full: draft, key_points: points })
    await load()
    setDirty(false)
    toast('저장했습니다.', 'ok')
  }

  const pick = (id: number): void => {
    if (dirty && !window.confirm('저장하지 않은 수정 내용이 있습니다. 그냥 이동할까요?')) return
    setSelectedId(id)
  }

  return (
    <>
      <div className="page-head">
        <h1>업무 상세 가이드</h1>
        <p>업무를 하나씩 열어보고, 직접 겪은 요령을 덧붙여 두면 다음 담당자에게 그대로 넘어갑니다.</p>
      </div>

      {tasks.length === 0 ? (
        <div className="empty">등록된 업무가 없습니다.</div>
      ) : (
        <div className="cols cols-guide">
          <div className="card">
            <div className="card-title">업무 목록</div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="업무명 검색"
              style={{ marginBottom: 10 }}
            />
            <div style={{ maxHeight: 520, overflowY: 'auto' }}>
              {filtered.map((t) => (
                <button
                  key={t.id}
                  className={`nav-btn ${t.id === selectedId ? 'active' : ''}`}
                  style={
                    t.id === selectedId
                      ? undefined
                      : { color: 'var(--text)', display: 'block', width: '100%' }
                  }
                  onClick={() => pick(t.id)}
                >
                  <div style={{ fontWeight: 600 }}>{t.title}</div>
                  <div
                    style={{
                      fontSize: 12,
                      opacity: 0.75
                    }}
                  >
                    {t.task_date_display || '수시'}
                  </div>
                </button>
              ))}
              {filtered.length === 0 && <div className="empty">검색 결과가 없습니다.</div>}
            </div>
          </div>

          <div>
            {selected && (
              <>
                <div className="card">
                  <div className="card-title">
                    <span>{selected.title}</span>
                    <span className="badge badge-accent">
                      {selected.task_date_display || '수시'}
                    </span>
                  </div>

                  <div className="row small muted" style={{ marginBottom: 12 }}>
                    <span>구분: {selected.task_type || '직접 등록'}</span>
                    {selected.filename && <span>· 출처: {selected.filename}</span>}
                    {selected.task_date_raw && <span>· 문서상 시기: {selected.task_date_raw}</span>}
                  </div>

                  {selected.workflow ? (
                    <div className="note note-info">
                      <b>처리 절차</b>
                      <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{selected.workflow}</div>
                    </div>
                  ) : (
                    <div className="note note-info">절차가 비어 있습니다. 로드맵에서 채워 넣을 수 있습니다.</div>
                  )}
                </div>

                <div className="card">
                  <div className="card-title">
                    <span>유의사항 · 나만의 요령</span>
                    {dirty && <span className="badge badge-warn">저장 안 됨</span>}
                  </div>
                  <textarea
                    value={points}
                    onChange={(e) => {
                      setPoints(e.target.value)
                      setDirty(true)
                    }}
                    placeholder="예: 담당 장학사 연락처, 매년 반복되는 실수, 결재 라인"
                    style={{ minHeight: 110 }}
                  />

                  <div className="field" style={{ marginTop: 14 }}>
                    <label>상세 본문</label>
                    <textarea
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value)
                        setDirty(true)
                      }}
                      style={{ minHeight: 320 }}
                    />
                  </div>

                  <div className="row row-end">
                    <button className="btn btn-primary" onClick={() => void save()} disabled={!dirty}>
                      저장
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
