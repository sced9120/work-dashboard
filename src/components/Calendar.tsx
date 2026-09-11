import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react'
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
  /** 달력 화면에서 [작게] 를 눌렀을 때 — 홈의 작은 달력으로 돌아간다 */
  onShrink?: () => void
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 날짜에 며칠을 더한다. 우리나라는 서머타임이 없어 하루는 늘 하루다. */
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + n)
  return ymd(d)
}

/** a 에서 b 까지 며칠인지. b 가 앞이면 음수 */
function diffDays(a: string, b: string): number {
  const x = new Date(`${a}T00:00:00`).getTime()
  const y = new Date(`${b}T00:00:00`).getTime()
  return Math.round((y - x) / 86400000)
}

/** "2026-09-09" → "9. 9." */
function short(day: string): string {
  return `${Number(day.slice(5, 7))}. ${Number(day.slice(8, 10))}.`
}

/** 한 주 안에 그릴 막대 하나 */
export interface WeekBar {
  key: string
  /** 몇째 칸에서 시작하는지 (0=일요일) */
  start: number
  /** 몇 칸에 걸치는지 */
  span: number
  /** 몇째 줄에 놓는지 (0부터) */
  lane: number
  /** 앞 주에서 이어져 들어오는가 — 왼쪽 모서리를 각지게 그린다 */
  fromPrev: boolean
  /** 다음 주로 이어져 나가는가 — 오른쪽 모서리를 각지게 그린다 */
  toNext: boolean
  label: string
  /** 색 이름. 절차 기한이면 'deadline' */
  color: string
  done: boolean
  /** 일정이면 그 일정. 절차 기한은 끌어 옮기지 않으므로 비어 있다 */
  event?: CalEvent
}

/**
 * 한 주(일~토)에 들어오는 일정을 막대로 늘어놓는다.
 *
 * 예전에는 날짜 칸마다 일정을 따로 그려서, 9일부터 15일까지인 일정이
 * 일곱 칸에 똑같은 이름으로 일곱 번 찍혔다. 이제는 이어진 날을 한 줄의
 * 막대로 그린다. 주가 바뀌면 거기서 끊고, 다음 주 첫 칸에서 이어 그린다.
 *
 * 줄은 위에서부터 채운다. 겹치지 않는 가장 윗줄에 놓고, 줄이 모자라면
 * 그 날들에 "＋몇" 을 센다. 절차 기한은 놓치면 안 되므로 맨 먼저 자리를 준다.
 */
export function layoutWeek(
  days: string[],
  events: CalEvent[],
  deadlines: Deadline[],
  lanes: number
): { bars: WeekBar[]; hidden: number[] } {
  const first = days[0]
  const last = days[days.length - 1]

  interface Item extends Omit<WeekBar, 'lane'> {
    rank: number
  }
  const items: Item[] = []

  for (const d of deadlines) {
    const i = days.indexOf(d.due_date)
    if (i < 0) continue
    items.push({
      key: `d${d.id}`,
      start: i,
      span: 1,
      fromPrev: false,
      toNext: false,
      label: `⏰ ${d.title}`,
      color: 'deadline',
      done: false,
      rank: 0
    })
  }

  for (const e of events) {
    const from = e.event_date
    const to = e.end_date && e.end_date >= from ? e.end_date : from
    if (to < first || from > last) continue
    const s = from < first ? 0 : days.indexOf(from)
    const t = to > last ? days.length - 1 : days.indexOf(to)
    if (s < 0 || t < 0) continue
    const fromPrev = from < first
    items.push({
      key: `e${e.id}`,
      start: s,
      span: t - s + 1,
      fromPrev,
      toNext: to > last,
      // 시각은 첫 토막에만 붙인다. 이어진 토막에까지 붙이면 다시 시작하는 것처럼 읽힌다.
      label: `${!fromPrev && e.start_time ? `${e.start_time} ` : ''}${e.title}`,
      color: `c-${e.color || 'blue'}`,
      done: e.done === 1,
      event: e,
      rank: 1
    })
  }

  // 기한 먼저, 그다음 일찍 시작하는 것, 같으면 긴 것 — 긴 막대가 위에 서야 덜 얽힌다
  items.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.start - b.start ||
      b.span - a.span ||
      a.label.localeCompare(b.label, 'ko')
  )

  const taken: boolean[][] = Array.from({ length: lanes }, () =>
    Array.from({ length: days.length }, () => false)
  )
  const hidden = Array.from({ length: days.length }, () => 0)
  const bars: WeekBar[] = []

  for (const it of items) {
    const cols = Array.from({ length: it.span }, (_, k) => it.start + k)
    const lane = taken.findIndex((row) => cols.every((c) => !row[c]))
    if (lane < 0) {
      for (const c of cols) hidden[c]++
      continue
    }
    for (const c of cols) taken[lane][c] = true
    const { rank: _rank, ...bar } = it
    bars.push({ ...bar, lane })
  }

  return { bars, hidden }
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

export default function Calendar({
  tasks,
  big,
  compact,
  onOpenFull,
  onShrink
}: Props): JSX.Element {
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

  /**
   * 끌어 옮기는 중인 일정과, 어느 날을 붙잡았는지.
   *
   * 여러 날짜리 일정은 가운데를 잡고 끌 수도 있다. 잡은 날에서 놓은 날까지의
   * 차이만큼 시작일과 종료일을 함께 민다. 그래야 기간이 그대로 유지된다.
   */
  const drag = useRef<{ id: number; grab: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [dropDay, setDropDay] = useState<string | null>(null)

  /** 한 주에 막대를 몇 줄까지 그릴지 */
  const lanes = compact ? 2 : big ? 4 : 3

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

  /** 격자를 일주일씩 자른다. 막대는 주 단위로 그린다. */
  const weeks = useMemo(() => {
    const out: (typeof grid)[] = []
    for (let i = 0; i < grid.length; i += 7) out.push(grid.slice(i, i + 7))
    return out
  }, [grid])

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

  /** 막대 위에서 누른 자리가 몇째 날인지 — 막대 폭을 칸 수로 나누어 셈한다 */
  const dayUnder = (
    e: { clientX: number; currentTarget: Element },
    bar: WeekBar,
    days: string[]
  ): string => {
    const r = e.currentTarget.getBoundingClientRect()
    const w = r.width / bar.span
    const k = Math.max(0, Math.min(bar.span - 1, Math.floor((e.clientX - r.left) / w)))
    return days[bar.start + k]
  }

  const startDrag = (e: ReactDragEvent, id: number, grab: string): void => {
    drag.current = { id, grab }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(id))
    // 막대를 바로 투명하게 하면 끌기가 끊긴다. 한 박자 늦게 표시한다.
    setTimeout(() => setDragging(true), 0)
  }

  const endDrag = (): void => {
    drag.current = null
    setDragging(false)
    setDropDay(null)
  }

  const dropOn = async (day: string): Promise<void> => {
    const d = drag.current
    endDrag()
    if (!d) return
    const ev = events.find((x) => x.id === d.id)
    if (!ev) return
    const delta = diffDays(d.grab, day)
    if (delta === 0) return

    const from = addDays(ev.event_date, delta)
    const to = addDays(ev.end_date || ev.event_date, delta)
    await window.api.events.update(ev.id, { event_date: from, end_date: to })
    setSelected(day)
    await load()
    toast(
      `'${ev.title}' 을(를) ${short(from)}${to !== from ? ` ~ ${short(to)}` : ''} 로 옮겼습니다.`,
      'ok'
    )
  }

  /** 날짜 칸이 끌어 온 것을 받을 수 있게 */
  const dropProps = (day: string) => ({
    onDragOver: (e: ReactDragEvent) => {
      if (!drag.current) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (dropDay !== day) setDropDay(day)
    },
    onDragLeave: () => {
      if (dropDay === day) setDropDay(null)
    },
    onDrop: (e: ReactDragEvent) => {
      e.preventDefault()
      void dropOn(day)
    }
  })

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
        {big && onShrink && (
          <button className="btn btn-sm" onClick={onShrink} title="홈의 작은 달력으로 돌아갑니다">
            ⊟ 작게
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

      {/* ── 날짜 격자 — 주마다 한 줄. 여러 날짜리 일정은 막대로 이어 그린다 ── */}
      <div className={`cal-weeks ${dragging ? 'dragging' : ''}`}>
        {weeks.map((week) => {
          const days = week.map((c) => c.date)
          const { bars, hidden } = layoutWeek(days, events, deadlines, lanes)

          return (
            <div
              key={days[0]}
              className="cal-week"
              style={{
                gridTemplateRows: `var(--cal-top) repeat(${lanes}, var(--cal-lane)) minmax(var(--cal-more), 1fr)`
              }}
            >
              {week.map((cell, ci) => {
                const hol = holidays.get(cell.date)
                const isToday = cell.date === today
                const isSel = cell.date === selected
                return (
                  <button
                    key={cell.date}
                    className={`cal-cell ${cell.inMonth ? '' : 'out'} ${isToday ? 'today' : ''} ${
                      isSel ? 'sel' : ''
                    } ${dropDay === cell.date ? 'drop' : ''}`}
                    style={{ gridColumn: ci + 1 }}
                    onClick={() => setSelected(cell.date)}
                    onDoubleClick={() => openNew(cell.date)}
                    title={hol ? holidayLabel(hol) : undefined}
                    {...dropProps(cell.date)}
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
                  </button>
                )
              })}

              {bars.map((b) => (
                <div
                  key={b.key}
                  className={`cal-ev ${b.color} ${b.done ? 'done' : ''} ${b.fromPrev ? 'from-prev' : ''} ${
                    b.toNext ? 'to-next' : ''
                  }`}
                  style={{ gridColumn: `${b.start + 1} / span ${b.span}`, gridRow: b.lane + 2 }}
                  title={
                    b.event
                      ? `${b.event.title}${
                          b.event.end_date && b.event.end_date !== b.event.event_date
                            ? ` (${short(b.event.event_date)} ~ ${short(b.event.end_date)})`
                            : ''
                        } — 끌어서 다른 날로 옮길 수 있습니다`
                      : b.label
                  }
                  draggable={!!b.event}
                  onDragStart={
                    b.event
                      ? (e) => startDrag(e, b.event!.id, dayUnder(e, b, days))
                      : undefined
                  }
                  onDragEnd={endDrag}
                  onClick={(e: ReactMouseEvent) => setSelected(dayUnder(e, b, days))}
                  onDoubleClick={() => b.event && openEdit(b.event)}
                >
                  {b.label}
                </div>
              ))}

              {hidden.map(
                (n, ci) =>
                  n > 0 && (
                    <span
                      key={`more${ci}`}
                      className="cal-more"
                      style={{ gridColumn: ci + 1, gridRow: lanes + 2 }}
                    >
                      ＋{n}
                    </span>
                  )
              )}
            </div>
          )
        })}
      </div>

      {!compact && (
        <p className="hint" style={{ margin: '6px 2px 0' }}>
          일정을 <b>끌어서</b> 다른 날에 놓으면 옮겨집니다. 여러 날짜리 일정은 기간을 그대로
          두고 통째로 옮겨집니다.
        </p>
      )}

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
              <div
                className="item cal-drag-item"
                key={e.id}
                draggable
                onDragStart={(ev) => startDrag(ev, e.id, selected)}
                onDragEnd={endDrag}
                title="끌어서 달력의 다른 날에 놓으면 옮겨집니다"
              >
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
          <div
            className="sheet"
            onClick={(ev) => ev.stopPropagation()}
            onKeyDown={(ev) => {
              // 어느 칸에 있든 Ctrl+Enter 로 바로 저장한다. 메모 칸에서도 된다.
              if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
                ev.preventDefault()
                void save()
              }
              if (ev.key === 'Escape') setForm(null)
            }}
          >
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
              <span className="muted small">Ctrl+Enter 저장</span>
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
