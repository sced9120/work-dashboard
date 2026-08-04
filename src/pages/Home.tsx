import { useCallback, useEffect, useState } from 'react'
import type { Notice, Task } from '../../shared/types'
import type { PageId } from '../App'
import { useToast } from '../lib/toast'
import { monthOf, sortTasks, todayStr } from '../lib/util'

interface Props {
  jobTitle: string
  onGo: (p: PageId) => void
}

const EMPTY = { title: '', content: '', link: '' }

export default function Home({ jobTitle, onGo }: Props): JSX.Element {
  const toast = useToast()
  const [notices, setNotices] = useState<Notice[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    setNotices(await window.api.notices.list())
    setTasks(await window.api.tasks.list())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const thisMonth = new Date().getMonth() + 1
  const monthTasks = sortTasks(
    tasks.filter((t) => {
      const m = monthOf(t.task_date_display)
      return m === thisMonth || m === 99
    })
  )
  const doneCount = tasks.filter((t) => t.is_completed === 1).length

  const toggle = async (t: Task): Promise<void> => {
    await window.api.tasks.update(t.id, { is_completed: t.is_completed === 1 ? 0 : 1 })
    await load()
  }

  const startEdit = (n: Notice): void => {
    setEditingId(n.id)
    setForm({ title: n.title, content: n.content, link: n.link ?? '' })
    setShowForm(true)
  }

  const cancelEdit = (): void => {
    setEditingId(null)
    setForm(EMPTY)
    setShowForm(false)
  }

  const save = async (): Promise<void> => {
    if (!form.title.trim()) {
      toast('제목을 입력해 주세요.', 'err')
      return
    }
    const payload = { ...form, date: todayStr() }
    if (editingId !== null) await window.api.notices.update(editingId, payload)
    else await window.api.notices.add(payload)
    cancelEdit()
    await load()
    toast('저장했습니다.', 'ok')
  }

  const remove = async (id: number): Promise<void> => {
    await window.api.notices.remove(id)
    if (editingId === id) cancelEdit()
    await load()
    toast('삭제했습니다.')
  }

  return (
    <>
      <div className="page-head">
        <h1>{jobTitle} 업무 대시보드</h1>
        <p>
          등록된 업무 {tasks.length}건 · 완료 {doneCount}건 · 공지 {notices.length}건
        </p>
      </div>

      <div className="cols cols-2">
        <div>
          <div className="card">
            <div className="card-title">
              <span>메모 · 공지</span>
              <button
                className="btn btn-sm"
                onClick={() => (showForm ? cancelEdit() : setShowForm(true))}
              >
                {showForm ? '닫기' : '＋ 새 글'}
              </button>
            </div>

            {showForm && (
              <div style={{ marginBottom: 14 }}>
                <div className="field">
                  <label htmlFor="nt">제목</label>
                  <input
                    id="nt"
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="예: 나이스 권한 신청 방법"
                  />
                </div>
                <div className="field">
                  <label htmlFor="nc">내용</label>
                  <textarea
                    id="nc"
                    value={form.content}
                    onChange={(e) => setForm({ ...form, content: e.target.value })}
                    placeholder="다음 담당자가 알아두면 좋을 내용을 적어두세요."
                  />
                </div>
                <div className="field">
                  <label htmlFor="nl">관련 링크 (선택)</label>
                  <input
                    id="nl"
                    type="text"
                    value={form.link}
                    onChange={(e) => setForm({ ...form, link: e.target.value })}
                    placeholder="예: https://www.neis.go.kr"
                  />
                </div>
                <div className="row row-end">
                  <button className="btn btn-ghost" onClick={cancelEdit}>
                    취소
                  </button>
                  <button className="btn btn-primary" onClick={() => void save()}>
                    {editingId !== null ? '수정 저장' : '등록'}
                  </button>
                </div>
              </div>
            )}

            <div className="list">
              {notices.length === 0 && <div className="empty">등록된 글이 없습니다.</div>}
              {notices.map((n) => (
                <div className="item" key={n.id}>
                  <div className="item-head">
                    <div>
                      <div className="item-title">{n.title}</div>
                      <div className="item-meta">{n.date}</div>
                    </div>
                    <div className="row">
                      <button className="btn btn-sm btn-ghost" onClick={() => startEdit(n)}>
                        수정
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => void remove(n.id)}
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                  <div className="item-body">{n.content}</div>
                  {n.link && (
                    <div style={{ marginTop: 8 }}>
                      <button className="btn btn-sm" onClick={() => void window.api.shell.open(n.link)}>
                        🔗 링크 열기
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-title">
              <span>{thisMonth}월 · 수시 업무</span>
              <span className="badge">{monthTasks.length}건</span>
            </div>

            {monthTasks.length === 0 ? (
              <div className="empty">
                이 달에 잡힌 업무가 없습니다.
                <div style={{ marginTop: 10 }}>
                  <button className="btn btn-sm" onClick={() => onGo('학습')}>
                    문서로 업무 만들기
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {monthTasks.map((t) => (
                  <label className="check-row" key={t.id}>
                    <input
                      type="checkbox"
                      checked={t.is_completed === 1}
                      onChange={() => void toggle(t)}
                    />
                    <span>
                      <span className={t.is_completed === 1 ? 'check-done' : ''}>{t.title}</span>
                      <span className="item-meta"> · {t.task_date_display}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title">빠른 이동</div>
            <div className="stack">
              <button className="btn" onClick={() => onGo('학습')}>
                📥 공문·매뉴얼로 업무 목록 만들기
              </button>
              <button className="btn" onClick={() => onGo('로드맵')}>
                🗓 연간 로드맵 보기
              </button>
              <button className="btn" onClick={() => onGo('데이터')}>
                💾 인수인계 파일 내보내기
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
