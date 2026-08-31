import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CalEvent, CalEventInput, Deadline, Task } from '../../shared/types'
import { BLANK_EVENT, EVENT_COLORS } from '../../shared/types'
import { holidayLabel, holidayMap, lunarKnown, LUNAR_TO } from '../lib/holidays'
import { useToast } from '../lib/toast'
import { monthOf, todayStr, weekOf } from '../lib/util'

interface Props {
  tasks: Task[]
  /** 달력 전용 화면에서 칸을 크게 쓴다 */
  big?: boolean
  /** 홈에 얹을 때. 이 달 일정만 간추려 보여 준다 */
  compact?: boolean
  /** 홈에서 [크게 보기] 를 눌렀을 때 */
  onOpenFull?: () => void
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 그 날짜가 일정 기간 안에 드는가 */
function covers(e: CalEvent, day: string): boolean {
  const end = e.end_date || e.event_date
  return e.event_date <= day && day <= end
}

/** 오늘 기준 남은 날. 지났으면 음수 */
function daysLeft(due: string): number | null {
  if (!due) return null
  const target = new Date(`${due}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

function ddayLabel(due: string): string {
  const d = daysLeft(due)
  if (d === null) return ''
  if (d === 0) return '오늘'
  if (d < 0) return `${-d}일 지남`
  return `D-${d}`
}

export default function Calendar({ tasks, big, compact, onOpenFull }: Props): JSX.Element {
  const toast = useToast()
  const today = todayStr()

  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() + 1 }
  })
  const [events, setEvents] = useState<CalEvent[]>([])
  const [deadlines, setDeadlines] = useState<Deadline[]>([])
  const [selected, setSelected] = useState<string>(today)

  /** 편집 중인 일정. id 가 없으면 새로 넣는 중 */
  const [form, setForm] = useState<(CalEventInput & { id?: number }) | null>(null)

  const load = useCallback(async () => {
    const [ev, dl] = await Promise.all([
      window.api.events.list(),
      window.api.deadlines.list()
    ])
    setEvents(ev)
    setDeadlines(dl)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** 달력 격자에 깔 날짜들 (앞뒤 달 포함해 7의 배수로 채운다) */
  const grid = useMemo(() => {
    const first = new Date(cursor.year, cursor.month - 1, 1)
    const start = new Date(first)
    start.setDate(1 - first.getDay())

    const cells: { date: string; inMonth: boolean; dow: number }[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      cells.push({
        date: ymd(d),
        inMonth: d.getMonth() + 1 === cursor.month && d.getFullYear() === cursor.year,
        dow: d.getDay()
      })
      // 마지막 주가 통째로 다음 달이면 그 줄은 그리지 않는다.
      if (i >= 34 && (i + 1) % 7 === 0) {
        const restAllNext = cells.slice(i - 6, i + 1).every((c) => !c.inMonth)
        if (restAllNext) return cells.slice(0, i - 6)
      }
    }
    return cells
  }, [cursor])

  /**
   * 공휴일. 달력 격자에는 앞뒤 달이 함께 나오므로 해도 앞뒤로 한 해씩 담는다.
   * 인터넷을 쓰지 않고 프로그램 안에서 셈한다.
   */
  const holidays = useMemo(
    () => holidayMap([cursor.year - 1, cursor.year, cursor.year + 1]),
    [cursor.year]
  )

  /** 이 달의 공휴일 — 아래에 한눈에 모아 보여 준다 */
  const monthHolidays = useMemo(() => {
    const head = `${cursor.year}-${pad(cursor.month)}-`
    return [...holidays.values()]
      .filter((h) => h.date.startsWith(head))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [holidays, cursor])

  const eventsOn = useCallback(
    (day: string) => events.filter((e) => covers(e, day)),
    [events]
  )
  const deadlinesOn = useCallback(
    (day: string) => deadlines.filter((d) => d.due_date === day),
    [deadlines]
  )

  /** 이 달에 해당하는 업무(뭉뚱그린 시기) — 날짜가 없어 아래에 따로 보여 준다 */
  const monthTasks = useMemo(
    () =>
      tasks
        .filter((t) => monthOf(t.task_date_display) === cursor.month)
        .sort((a, b) => weekOf(a.task_date_display) - weekOf(b.task_date_display)),
    [tasks, cursor.month]
  )

  const move = (delta: number): void => {
    setCursor((c) => {
      const m = c.month + delta
      if (m < 1) return { year: c.year - 1, month: 12 }
      if (m > 12) return { year: c.year + 1, month: 1 }
      return { ...c, month: m }
    })
  }

  const goToday = (): void => {
    const d = new Date()
    setCursor({ year: d.getFullYear(), month: d.getMonth() + 1 })
    setSelected(today)
  }

  const openNew = (day: string): void => {
    setForm({ ...BLANK_EVENT, event_date: day, end_date: day })
  }

  const openEdit = (e: CalEvent): void => {
    setForm({ ...e })
  }

  const save = async (): Promise<void> => {
    if (!form) return
    if (!form.title.trim()) {
      toast('제목을 적어 주세요.', 'err')
      return
    }
    if (!form.event_date) {
      toast('날짜를 골라 주세요.', 'err')
      return
    }
    // 종료일이 시작일보다 앞이면 하루짜리로 본다.
    const end = form.end_date && form.end_date >= form.event_date ? form.end_date : form.event_date

    const value: CalEventInput = {
      event_date: form.event_date,
      end_date: end,
      start_time: form.start_time ?? '',
      title: form.title.trim(),
      content: form.content ?? '',
      color: form.color || 'blue',
      remind: form.remind ? 1 : 0,
      done: form.done ? 1 : 0
    }

    if (form.id) await window.api.events.update(form.id, value)
    else await window.api.events.add(value)

    setForm(null)
    await load()
    toast(form.id ? '수정했습니다.' : '일정을 넣었습니다.', 'ok')
  }

  const remove = async (e: CalEvent): Promise<void> => {
    await window.api.events.remove(e.id)
    setForm(null)
    await load()
    toast(`'${e.title}' 을(를) 지웠습니다.`)
  }

  const toggleDone = async (e: CalEvent): Promise<void> => {
    await window.api.events.update(e.id, { done: e.done === 1 ? 0 : 1 })
    await load()
  }

  const selectedEvents = eventsOn(selected)
  const selectedDeadlines = deadlinesOn(selected)
  const selectedHoliday = holidays.get(selected)

  return (
    <div className={`cal ${big ? "cal-big" : ""} ${compact ? "cal-compact" : ""}`}>
      {/* ── 달 이동 ── */}
      <div className="cal-bar">
        <button className="cal-nav" onClick={() => move(-1)} title="이전 달">
          ‹
        </button>
        <div className="cal-title">
          {cursor.year}년 <b>{cursor.month}월</b>
        </div>
        <button className="cal-nav" onClick={() => move(1)} title="다음 달">
          ›
        </button>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={goToday}>
          오늘
        </button>
        {compact && onOpenFull && (
          <button className="btn btn-sm" onClick={onOpenFull} title="달력 화면으로 크게 보기">
            ⛶ 크게
          </button>
        )}
        <button className="btn btn-sm btn-primary" onClick={() => openNew(selected || today)}>
          ＋ 일정
        </button>
      </div>

      {/* ── 요일 머리 ── */}
      <div className="cal-grid cal-head">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`cal-dow ${i === 0 ? 'sun' : ''} ${i === 6 ? 'sat' : ''}`}>
            {w}
          </div>
        ))}
      </div>

      {/* ── 날짜 격자 ── */}
      <div className="cal-grid">
        {grid.map((cell) => {
          const evs = eventsOn(cell.date)
          const dls = deadlinesOn(cell.date)
          const hol = holidays.get(cell.date)
          const isToday = cell.date === today
          const isSel = cell.date === selected
          // 공휴일이면 한 줄을 이름에 내주므로 일정은 두 개까지만 보인다
          const shown = evs.slice(0, hol ? 2 : 3)
          const rest = evs.length + dls.length - shown.length

          return (
            <button
              key={cell.date}
              className={`cal-cell ${cell.inMonth ? '' : 'out'} ${isToday ? 'today' : ''} ${isSel ? 'sel' : ''}`}
              onClick={() => setSelected(cell.date)}
              onDoubleClick={() => openNew(cell.date)}
              title={hol ? holidayLabel(hol) : undefined}
            >
              <span className="cal-top">
                <span
                  className={`cal-num ${cell.dow === 0 || hol ? 'sun' : ''} ${
                    cell.dow === 6 && !hol ? 'sat' : ''
                  }`}
                >
                  {Number(cell.date.slice(8, 10))}
                </span>
                {hol && <span className="cal-hol">{hol.name}</span>}
              </span>

              <span className="cal-chips">
                {dls.map((d) => (
                  <span key={`d${d.id}`} className="cal-chip deadline" title={d.title}>
                    ⏰ {d.title}
                  </span>
                ))}
                {shown.map((e) => (
                  <span
                    key={e.id}
                    className={`cal-chip c-${e.color} ${e.done === 1 ? 'done' : ''}`}
                    title={e.title}
                  >
                    {e.start_time ? `${e.start_time} ` : ''}
                    {e.title}
                  </span>
                ))}
                {rest > 0 && <span className="cal-more">＋{rest}</span>}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── 고른 날 상세 ── */}
      <div className="card cal-day">
        <div className="card-title">
          <span>
            {selected.replace(/-/g, '. ')}
            {selected === today && <span className="badge badge-accent" style={{ marginLeft: 8 }}>오늘</span>}
            {selectedHoliday && (
              <span className="badge badge-danger" style={{ marginLeft: 8 }}>
                {holidayLabel(selectedHoliday)}
              </span>
            )}
          </span>
          <button className="btn btn-sm btn-primary" onClick={() => openNew(selected)}>
            ＋ 이 날에 넣기
          </button>
        </div>

        {selectedDeadlines.length === 0 && selectedEvents.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            이 날에는 아무것도 없습니다. 날짜를 두 번 눌러도 바로 넣을 수 있습니다.
          </p>
        ) : (
          <div className="list">
            {selectedDeadlines.map((d) => (
              <div className="item" key={`dl-${d.id}`}>
                <div className="item-head">
                  <div style={{ minWidth: 0 }}>
                    <div className="item-title">
                      <span className="badge badge-warn">절차 기한</span> {d.title}
                    </div>
                    {d.case_ref && <div className="item-meta">{d.case_ref}</div>}
                  </div>
                  <span className="badge">{ddayLabel(d.due_date)}</span>
                </div>
              </div>
            ))}

            {selectedEvents.map((e) => (
              <div className="item" key={e.id}>
                <div className="item-head">
                  <div style={{ minWidth: 0, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={e.done === 1}
                      onChange={() => void toggleDone(e)}
                      style={{ marginTop: 5, width: 15, height: 15, accentColor: 'var(--accent)' }}
                      title="완료"
                    />
                    <div style={{ minWidth: 0 }}>
                      <div className={`item-title ${e.done === 1 ? 'check-done' : ''}`}>
                        <span className={`cal-dot c-${e.color}`} /> {e.title}
                      </div>
                      <div className="item-meta">
                        {e.start_time || '하루 종일'}
                        {e.end_date && e.end_date !== e.event_date
                          ? ` · ${e.event_date} ~ ${e.end_date}`
                          : ''}
                        {e.remind === 1 && ` · ⏰ ${ddayLabel(e.end_date || e.event_date)}`}
                      </div>
                    </div>
                  </div>
                  <div className="row">
                    <button className="btn btn-sm btn-ghost" onClick={() => openEdit(e)}>
                      수정
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => void remove(e)}>
                      삭제
                    </button>
                  </div>
                </div>
                {e.content && (
                  <div className="note" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
                    {e.content}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 이 달의 공휴일 ── */}
      {!compact && (
        <div className="card">
          <div className="card-title">
            <span>{cursor.month}월 공휴일</span>
            {monthHolidays.length > 0 && (
              <span className="badge badge-danger">{monthHolidays.length}일</span>
            )}
          </div>
          {monthHolidays.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              이 달에는 공휴일이 없습니다.
            </p>
          ) : (
            <div className="cal-tasklist">
              {monthHolidays.map((h) => (
                <span key={h.date} className="badge badge-danger">
                  {Number(h.date.slice(8, 10))}일 · {holidayLabel(h)}
                </span>
              ))}
            </div>
          )}
          <p className="hint" style={{ marginBottom: 0 }}>
            {lunarKnown(cursor.year)
              ? '선거일과 임시공휴일은 그때그때 정해져 규칙이 없습니다. 정해지면 일정으로 넣어 두세요.'
              : `설날·부처님오신날·추석은 음력이라 ${LUNAR_TO}년까지만 넣어 두었습니다. 그 밖의 해는 날짜가 정해진 공휴일만 뜹니다.`}
          </p>
        </div>
      )}

      {/* ── 이 달의 업무 (뭉뚱그린 시기라 날짜 칸에는 못 올린다) ── */}
      {!compact && monthTasks.length > 0 && (
        <div className="card">
          <div className="card-title">
            <span>{cursor.month}월 업무</span>
            <span className="badge badge-accent">{monthTasks.length}건</span>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>
            로드맵의 업무는 “{cursor.month}월 1주” 처럼 주 단위라 날짜 칸에 올리지 않고 여기 모아
            보여 줍니다. 날짜가 정해지면 위에서 일정으로 넣어 두세요.
          </p>
          <div className="cal-tasklist">
            {monthTasks.map((t) => (
              <span key={t.id} className={`badge ${t.is_completed === 1 ? '' : 'badge-accent'}`}>
                {t.task_date_display} · {t.title}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── 넣기·수정 시트 (갤럭시 달력식) ── */}
      {form && (
        <div className="sheet-back" onClick={() => setForm(null)}>
          <div className="sheet" onClick={(ev) => ev.stopPropagation()}>
            <div className="sheet-grip" />
            <div className="sheet-title">{form.id ? '일정 고치기' : '새 일정'}</div>

            <input
              type="text"
              className="sheet-input-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="제목"
              autoFocus
            />

            <div className="sheet-row">
              <label className="sheet-label">날짜</label>
              <input
                type="date"
                value={form.event_date}
                onChange={(e) => {
                  const v = e.target.value
                  setForm({
                    ...form,
                    event_date: v,
                    // 종료일이 앞서 있으면 같이 끌고 온다
                    end_date: !form.end_date || form.end_date < v ? v : form.end_date
                  })
                }}
              />
              <span className="muted small">~</span>
              <input
                type="date"
                value={form.end_date || form.event_date}
                min={form.event_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              />
            </div>

            <div className="sheet-row">
              <label className="sheet-label">시각</label>
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              />
              <span className="muted small">비워 두면 하루 종일</span>
              {form.start_time && (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setForm({ ...form, start_time: '' })}
                >
                  지우기
                </button>
              )}
            </div>

            <div className="sheet-row">
              <label className="sheet-label">색</label>
              <div className="row" style={{ gap: 6 }}>
                {EVENT_COLORS.map((c) => (
                  <button
                    key={c.id}
                    className={`cal-swatch c-${c.id} ${form.color === c.id ? 'on' : ''}`}
                    title={c.label}
                    onClick={() => setForm({ ...form, color: c.id })}
                  />
                ))}
              </div>
            </div>

            <label className="sheet-check">
              <input
                type="checkbox"
                checked={form.remind === 1}
                onChange={(e) => setForm({ ...form, remind: e.target.checked ? 1 : 0 })}
                style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
              />
              <span>
                <b>기한으로 챙기기</b>
                <span className="muted"> — D-day 가 붙고, 기한 알림을 켜 두었다면 함께 알려 줍니다</span>
              </span>
            </label>

            <textarea
              className="sheet-memo"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="메모 (선택)"
              rows={3}
            />

            <div className="sheet-foot">
              {form.id && (
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    const found = events.find((x) => x.id === form.id)
                    if (found) void remove(found)
                  }}
                >
                  삭제
                </button>
              )}
              <span className="spacer" />
              <button className="btn" onClick={() => setForm(null)}>
                취소
              </button>
              <button className="btn btn-primary" onClick={() => void save()}>
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
