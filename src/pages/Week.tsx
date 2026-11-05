import { useEffect, useState } from 'react'
import type { Task } from '../../shared/types'
import { NEIS_MARK, addDays } from '../../shared/neis'
import { DDAY_KEY, parseDdays } from '../../shared/weather'
import { ATT_RECORDS_KEY, readRecords } from '../../shared/attendance'
import { periodNow, slotText, weekDate } from '../../shared/timetable'
import type { PageId } from '../App'
import Calendar from '../components/Calendar'
import Icon from '../components/Icon'
import { nowInfo, useTimetable } from '../lib/timetable'
import { todayStr } from '../lib/util'

/**
 * 새 화면 '이번 주' 첫 화면 — 이번 주 달력, 그 아래 앞으로 2주의 다가올 일과 작게 줄인 내 시간표.
 */

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const md = (day: string): string => {
  const d = new Date(`${day}T00:00:00`)
  return `${d.getMonth() + 1}. ${d.getDate()}.(${WEEK[d.getDay()]})`
}

type Kind = '기한' | '일정' | '학사' | 'D-Day'

interface Upcoming {
  date: string
  time: string
  title: string
  kind: Kind
  /** 지난 기한 */
  late?: boolean
  go: PageId
}

export default function Week({ onGo }: { onGo: (p: PageId) => void }): JSX.Element {
  const today = todayStr()
  const monday = weekDate(today, 0)
  const friday = weekDate(today, 4)
  const [tasks, setTasks] = useState<Task[]>([])
  const [items, setItems] = useState<Upcoming[] | null>(null)
  const [attTodo, setAttTodo] = useState(0)

  useEffect(() => {
    void (async () => {
      const to = addDays(today, 14)
      const [t, deadlines, events, ddRaw, attRaw] = await Promise.all([
        window.api.tasks.list(),
        window.api.deadlines.list(),
        window.api.events.between(today, to),
        window.api.setting.get(DDAY_KEY, '[]'),
        window.api.setting.get(ATT_RECORDS_KEY, '[]')
      ])
      setTasks(t)
      const list: Upcoming[] = []
      for (const d of deadlines) {
        if (d.done || !d.due_date || d.due_date > to) continue
        list.push({ date: d.due_date < today ? today : d.due_date, time: '', title: d.title, kind: '기한', late: d.due_date < today, go: '기한' })
      }
      for (const e of events) {
        if (e.done) continue
        const neis = e.content.includes(NEIS_MARK)
        list.push({ date: e.event_date < today ? today : e.event_date, time: e.start_time, title: e.title, kind: neis ? '학사' : '일정', go: '달력' })
      }
      for (const d of parseDdays(ddRaw)) {
        if (d.date >= today && d.date <= addDays(today, 30)) list.push({ date: d.date, time: '', title: d.title, kind: 'D-Day', go: '홈' })
      }
      list.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99'))
      setItems(list)
      setAttTodo(readRecords(attRaw).filter((r) => r.proof === '필요' || !r.neis).length)
    })()
  }, [today])

  const days = items ? [...new Set(items.map((i) => i.date))] : []
  const dayLabel = (d: string): string => (d === today ? '오늘' : d === addDays(today, 1) ? '내일' : md(d))
  const dleft = (d: string): string => {
    const n = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
    return n === 0 ? 'D-Day' : `D-${n}`
  }

  return (
    <div className="wk-page">
      <div className="page-head">
        <h1>이번 주</h1>
        <p>
          {md(monday)} – {md(friday)} · 오늘 {md(today)}
        </p>
      </div>

      <section className="card wk-cal">
        <Calendar tasks={tasks} compact view="week" onView={(v) => v === 'month' && onGo('달력')} onOpenFull={() => onGo('달력')} />
      </section>

      <div className="wk-grid">
        <section className="card wk-up">
          <div className="wk-head">
            <b>다가올 일</b>
            <span className="muted small">앞으로 2주 · 기한 · 일정 · 학사일정 · D-Day</span>
            <span className="spacer" />
            <button className="btn btn-sm btn-ghost" onClick={() => onGo('기한')}>
              기한 ↗
            </button>
          </div>
          {attTodo > 0 && (
            <button className="wk-att" onClick={() => onGo('출결')}>
              <Icon name="class" size={15} />
              출결 챙길 것 <b>{attTodo}</b>건 — 서류 · 나이스 입력
              <span className="spacer" />↗
            </button>
          )}
          {!items ? (
            <p className="muted small">불러오는 중…</p>
          ) : !items.length ? (
            <p className="muted small">앞으로 2주 동안 잡힌 일이 없습니다.</p>
          ) : (
            days.map((d) => (
              <div key={d} className={`wk-day ${d === today ? 'today' : ''}`}>
                <div className="wk-day-label">
                  <b>{dayLabel(d)}</b>
                  {d !== today && <small>{dleft(d)}</small>}
                </div>
                <div className="wk-day-items">
                  {items
                    .filter((i) => i.date === d)
                    .map((i, k) => (
                      <button key={k} className="wk-item" onClick={() => onGo(i.go)}>
                        <span className={`wk-tag k-${i.kind === 'D-Day' ? 'dday' : i.kind} ${i.late ? 'late' : ''}`}>{i.late ? '지남' : i.kind}</span>
                        {i.time && <span className="wk-time">{i.time}</span>}
                        <span className="wk-title">{i.title}</span>
                      </button>
                    ))}
                </div>
              </div>
            ))
          )}
        </section>

        <section className="card wk-tt">
          <div className="wk-head">
            <b>내 시간표</b>
            <span className="spacer" />
            <button className="btn btn-sm btn-ghost" onClick={() => onGo('시간표')}>
              시간표 ↗
            </button>
          </div>
          <MiniTimetable onGo={onGo} />
        </section>
      </div>
    </div>
  )
}

/** 작은 한 주 시간표 — 오늘 줄은 주황 바탕, 지금 교시는 먹색 칸 */
function MiniTimetable({ onGo }: { onGo: (p: PageId) => void }): JSX.Element {
  const T = useTimetable()
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60000)
    return () => clearInterval(t)
  }, [])
  if (!T.loaded) return <p className="muted small">불러오는 중…</p>
  const my = T.my
  if (!my) {
    return (
      <p className="muted small">
        학교 시간표 엑셀을 불러오면 한 주 시간표가 여기 작게 뜹니다.{' '}
        <button className="link" onClick={() => onGo('시간표')}>
          시간표로
        </button>
      </p>
    )
  }
  const now = nowInfo()
  const cur = now.day >= 0 ? periodNow(my.periods, now.hhmm, T.times.length) : { index: -1, during: false }
  const days = my.days.slice(0, 5)
  return (
    <table className="mtt">
      <thead>
        <tr>
          <th />
          {days.map((d, i) => (
            <th key={d} className={i === now.day ? 'today' : ''}>
              {d}
              {my.dates?.[i] && <small>{Number(my.dates[i].slice(8))}</small>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {my.periods.map((p, pi) => (
          <tr key={p.no}>
            <th>
              {p.no}
              {p.start && <small>{p.start}</small>}
            </th>
            {days.map((_, di) => {
              const s = my.grid[di]?.[pi] ?? null
              const isNow = di === now.day && pi === cur.index && cur.during
              // 지난 날은 그대로 두고(한 주를 읽기 쉽게) 오늘 끝난 교시만 흐리게
              const past = di === now.day && (pi < cur.index || (pi === cur.index && !cur.during && cur.index >= 0))
              const changed = my.changes?.[`${di}-${pi}`] !== undefined
              return (
                <td key={di} className={`${di === now.day ? 'today' : ''} ${isNow ? 'now' : ''} ${past ? 'past' : ''} ${s ? 'has' : ''} ${changed ? 'changed' : ''}`}>
                  {s ? <span title={slotText(s)}>{s.subject || slotText(s)}</span> : null}
                  {s?.cls && <small>{s.cls}</small>}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
