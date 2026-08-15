import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Deadline, DeadlineInput } from '../../shared/types'
import { BLANK_DEADLINE, DEADLINE_PRESETS } from '../../shared/types'
import { useToast } from '../lib/toast'

/** 오늘 기준 남은 날. 지났으면 음수. */
export function daysLeft(due: string): number | null {
  if (!due) return null
  const target = new Date(`${due}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

export function ddayLabel(due: string): string {
  const d = daysLeft(due)
  if (d === null) return '기한 없음'
  if (d === 0) return '오늘'
  if (d < 0) return `${-d}일 지남`
  return `D-${d}`
}

function urgencyClass(due: string, done: number): string {
  if (done === 1) return 'badge'
  const d = daysLeft(due)
  if (d === null) return 'badge'
  if (d < 0) return 'badge badge-danger'
  if (d <= 3) return 'badge badge-warn'
  return 'badge badge-accent'
}

export default function Deadlines(): JSX.Element {
  const toast = useToast()
  const [items, setItems] = useState<Deadline[]>([])
  const [form, setForm] = useState<DeadlineInput>(BLANK_DEADLINE)
  const [adding, setAdding] = useState(false)
  const [showDone, setShowDone] = useState(false)

  const load = useCallback(async () => {
    setItems(await window.api.deadlines.list())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(
    () => items.filter((d) => showDone || d.done !== 1),
    [items, showDone]
  )

  const overdue = items.filter((d) => d.done !== 1 && (daysLeft(d.due_date) ?? 99) < 0).length
  const soon = items.filter((d) => {
    if (d.done === 1) return false
    const left = daysLeft(d.due_date)
    return left !== null && left >= 0 && left <= 7
  }).length

  const add = async (): Promise<void> => {
    if (!form.title.trim()) {
      toast('무엇을 해야 하는지 적어 주세요.', 'err')
      return
    }
    await window.api.deadlines.add(form)
    setForm(BLANK_DEADLINE)
    setAdding(false)
    await load()
    toast('기한을 등록했습니다.', 'ok')
  }

  const toggle = async (d: Deadline): Promise<void> => {
    await window.api.deadlines.update(d.id, { done: d.done === 1 ? 0 : 1 })
    await load()
  }

  const remove = async (d: Deadline): Promise<void> => {
    await window.api.deadlines.remove(d.id)
    await load()
    toast('삭제했습니다.')
  }

  return (
    <>
      <div className="page-head">
        <h1>절차 기한</h1>
        <p>통보·통지·이행처럼 날짜를 놓치면 절차에 하자가 생기는 것들을 챙깁니다.</p>
      </div>

      <div className="note note-warn" style={{ marginBottom: 14 }}>
        여기 적은 내용은 <b>인수인계 파일에 들어가지 않습니다.</b> 사안·학생 정보가 섞이기 쉬운
        곳이라 기본으로 빼고 내보냅니다. 필요하면 [인수인계 · 백업]에서 포함하도록 바꿀 수 있습니다.
      </div>

      {(overdue > 0 || soon > 0) && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row">
            {overdue > 0 && <span className="badge badge-danger">기한 지남 {overdue}건</span>}
            {soon > 0 && <span className="badge badge-warn">일주일 안 {soon}건</span>}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <button className="btn btn-primary" onClick={() => setAdding((v) => !v)}>
            {adding ? '닫기' : '＋ 기한 추가'}
          </button>
          <span className="spacer" />
          <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
              style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
            />
            <span className="small">처리한 것도 보기</span>
          </label>
        </div>

        {adding && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div className="field">
              <label>무엇을</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="예: 심의 결과 통지"
              />
              <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                {DEADLINE_PRESETS.map((p) => (
                  <button
                    key={p}
                    className="btn btn-sm btn-ghost"
                    onClick={() => setForm({ ...form, title: p })}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="row" style={{ gap: 12 }}>
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label>기한</label>
                <input
                  type="date"
                  value={form.due_date}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label>관련 사안 (선택)</label>
                <input
                  type="text"
                  value={form.case_ref}
                  onChange={(e) => setForm({ ...form, case_ref: e.target.value })}
                  placeholder="예: 제3회 선도위 흡연 건"
                />
              </div>
            </div>

            <div className="field">
              <label>메모 (선택)</label>
              <textarea
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="근거 규정, 담당자, 준비물 등"
                style={{ minHeight: 70 }}
              />
            </div>

            <div className="row row-end">
              <button className="btn btn-ghost" onClick={() => setAdding(false)}>
                취소
              </button>
              <button className="btn btn-primary" onClick={() => void add()}>
                등록
              </button>
            </div>
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          {items.length === 0
            ? '아직 등록한 기한이 없습니다. 위 [＋ 기한 추가]로 넣어 보세요.'
            : '남은 기한이 없습니다.'}
        </div>
      ) : (
        <div className="list">
          {visible.map((d) => (
            <div className="item" key={d.id}>
              <div className="item-head">
                <label className="row" style={{ gap: 10, cursor: 'pointer', minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={d.done === 1}
                    onChange={() => void toggle(d)}
                    style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div className="item-title">
                      <span className={urgencyClass(d.due_date, d.done)}>
                        {d.done === 1 ? '처리함' : ddayLabel(d.due_date)}
                      </span>{' '}
                      <span className={d.done === 1 ? 'check-done' : ''}>{d.title}</span>
                    </div>
                    <div className="item-meta">
                      {d.due_date || '기한 미정'}
                      {d.case_ref ? ` · ${d.case_ref}` : ''}
                    </div>
                  </div>
                </label>
                <button className="btn btn-sm btn-danger" onClick={() => void remove(d)}>
                  삭제
                </button>
              </div>
              {d.note && (
                <div className="note" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
                  {d.note}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
