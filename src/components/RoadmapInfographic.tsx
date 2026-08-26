import { useMemo } from 'react'
import type { Task } from '../../shared/types'
import { monthOf } from '../lib/util'
import { groupByTopic, weekLabel, weekNum } from '../lib/topics'

interface Props {
  tasks: Task[]
  /** 주제를 누르면 업무별 보기로 넘긴다 */
  onPickTopic: (topic: string) => void
}

/** 학사 연도 순서: 3월부터 이듬해 2월까지 */
const MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2] as const

/** 달마다 한 줄로 붙는 학사 흐름 설명 */
const SEASON: Record<number, string> = {
  3: '학기 시작 · 조직 구성',
  4: '계획 실행 · 1차 점검',
  5: '행사 · 상담 집중',
  6: '1학기 마무리 준비',
  7: '학기말 정리 · 방학',
  8: '2학기 준비',
  9: '2학기 시작',
  10: '행사 · 평가',
  11: '마무리 점검',
  12: '학년말 정리',
  1: '방학 · 인수인계 준비',
  2: '학년 마감 · 인계'
}

function semesterOf(month: number): 1 | 2 {
  return month >= 3 && month <= 8 ? 1 : 2
}

/** 한 주 안에서 주제별로 몇 건인지 */
interface WeekRow {
  week: number
  topics: { name: string; count: number; done: number }[]
  total: number
}

export default function RoadmapInfographic({ tasks, onPickTopic }: Props): JSX.Element {
  /** 업무 id → 주제 이름 */
  const topicOf = useMemo(() => {
    const map = new Map<number, string>()
    for (const t of groupByTopic(tasks)) {
      for (const task of t.tasks) map.set(task.id, t.name)
    }
    return map
  }, [tasks])

  /** 달 → 주 → 주제별 묶음 */
  const byMonth = useMemo(() => {
    const map = new Map<number, WeekRow[]>()
    const etc: Task[] = []

    const bucket = new Map<number, Map<number, Map<string, { n: number; done: number }>>>()

    for (const t of tasks) {
      const m = monthOf(t.task_date_display)
      if (m === 99) {
        etc.push(t)
        continue
      }
      const w = weekNum(t.task_date_display)
      const name = topicOf.get(t.id) ?? '기타'

      if (!bucket.has(m)) bucket.set(m, new Map())
      const weeks = bucket.get(m)!
      if (!weeks.has(w)) weeks.set(w, new Map())
      const topics = weeks.get(w)!
      const cur = topics.get(name) ?? { n: 0, done: 0 }
      cur.n++
      if (t.is_completed === 1) cur.done++
      topics.set(name, cur)
    }

    for (const [m, weeks] of bucket) {
      const rows: WeekRow[] = [...weeks.entries()]
        .map(([week, topics]) => {
          const list = [...topics.entries()]
            .map(([name, v]) => ({ name, count: v.n, done: v.done }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'))
          return { week, topics: list, total: list.reduce((s, x) => s + x.count, 0) }
        })
        // 수시(0)는 맨 뒤로
        .sort((a, b) => (a.week === 0 ? 99 : a.week) - (b.week === 0 ? 99 : b.week))
      map.set(m, rows)
    }

    return { map, etc }
  }, [tasks, topicOf])

  const total = tasks.length
  const done = tasks.filter((t) => t.is_completed === 1).length
  const pct = total ? Math.round((done / total) * 100) : 0
  const topicCount = new Set(topicOf.values()).size

  const sem1 = tasks.filter((t) => {
    const m = monthOf(t.task_date_display)
    return m !== 99 && semesterOf(m) === 1
  }).length
  const sem2 = tasks.filter((t) => {
    const m = monthOf(t.task_date_display)
    return m !== 99 && semesterOf(m) === 2
  }).length

  const busiest = useMemo(() => {
    let top = { month: 0, n: 0 }
    for (const [m, rows] of byMonth.map) {
      const n = rows.reduce((s, r) => s + r.total, 0)
      if (n > top.n) top = { month: m, n }
    }
    return top
  }, [byMonth])

  const thisMonth = new Date().getMonth() + 1

  if (total === 0) {
    return (
      <div className="empty">
        아직 등록된 업무가 없습니다. [문서로 업무 만들기]에서 매뉴얼이나 공문을 올리면 여기에 한 해
        흐름이 그려집니다.
      </div>
    )
  }

  return (
    <div className="info">
      {/* ── 한 해 요약 ── */}
      <div className="info-summary">
        <div className="info-ring" style={{ ['--pct' as string]: `${pct}` }}>
          <div className="info-ring-in">
            <b>{pct}%</b>
            <span>완료</span>
          </div>
        </div>
        <div className="info-stats">
          <div className="info-stat">
            <b>{total}</b>
            <span>전체 업무</span>
          </div>
          <div className="info-stat">
            <b>{topicCount}</b>
            <span>업무 주제</span>
          </div>
          <div className="info-stat">
            <b>{sem1}</b>
            <span>1학기 (3~8월)</span>
          </div>
          <div className="info-stat">
            <b>{sem2}</b>
            <span>2학기 (9~2월)</span>
          </div>
          {busiest.n > 0 && (
            <div className="info-stat">
              <b>{busiest.month}월</b>
              <span>가장 바쁜 달 ({busiest.n}건)</span>
            </div>
          )}
        </div>
      </div>

      <p className="hint" style={{ marginBottom: 14 }}>
        주마다 <b>무슨 일이 있었는지 주제로 묶어</b> 보여 줍니다. 주제를 누르면 그 업무의 공문과
        흐름을 볼 수 있고, 낱낱의 업무는 <b>[목록]</b> 에서 봅니다.
      </p>

      {/* ── 연간 흐름 ── */}
      <div className="info-timeline">
        {MONTHS.map((m) => {
          const rows = byMonth.map.get(m) ?? []
          const monthTotal = rows.reduce((s, r) => s + r.total, 0)
          const monthDone = rows.reduce(
            (s, r) => s + r.topics.reduce((a, t) => a + t.done, 0),
            0
          )
          const sem = semesterOf(m)
          const isNow = m === thisMonth

          return (
            <div key={m} className={`info-month sem${sem} ${isNow ? 'now' : ''}`}>
              <div className="info-spine">
                <div className="info-node">
                  <b>{m}</b>
                  <span>월</span>
                </div>
              </div>

              <div className="info-body">
                <div className="info-month-head">
                  <span className="info-season">{SEASON[m]}</span>
                  {isNow && <span className="badge badge-accent">이번 달</span>}
                  <span className="spacer" />
                  {monthTotal > 0 && (
                    <span className="muted small">
                      {monthDone}/{monthTotal} 완료
                    </span>
                  )}
                </div>

                {monthTotal === 0 ? (
                  <div className="info-empty">등록된 업무 없음</div>
                ) : (
                  <>
                    <div className="info-bar">
                      <div style={{ width: `${(monthDone / monthTotal) * 100}%` }} />
                    </div>

                    <div className="info-weeks">
                      {rows.map((r) => (
                        <div className="info-week" key={r.week}>
                          <div className="info-week-tag">{weekLabel(r.week)}</div>
                          <div className="info-topics">
                            {r.topics.map((t) => (
                              <button
                                key={t.name}
                                className={`info-topic ${t.done === t.count ? 'done' : ''}`}
                                onClick={() => onPickTopic(t.name)}
                                title={`'${t.name}' 업무 ${t.count}건 보기`}
                              >
                                <span className="info-topic-name">{t.name}</span>
                                {t.count > 1 && <span className="info-topic-n">{t.count}</span>}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── 시기를 못 잡은 것 ── */}
      {byMonth.etc.length > 0 && (
        <div className="info-etc">
          <div className="info-etc-head">
            수시 · 시기 미정 <span className="badge">{byMonth.etc.length}건</span>
          </div>
          <div className="info-topics">
            {[...new Set(byMonth.etc.map((t) => topicOf.get(t.id) ?? '기타'))].map((name) => {
              const n = byMonth.etc.filter((t) => (topicOf.get(t.id) ?? '기타') === name).length
              return (
                <button key={name} className="info-topic" onClick={() => onPickTopic(name)}>
                  <span className="info-topic-name">{name}</span>
                  {n > 1 && <span className="info-topic-n">{n}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
