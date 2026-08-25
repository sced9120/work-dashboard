import { useMemo } from 'react'
import type { Task } from '../../shared/types'
import { monthOf, weekOf } from '../lib/util'

interface Props {
  tasks: Task[]
  onPick: (t: Task) => void
}

/** 학사 연도 순서: 3월부터 이듬해 2월까지. 마지막 칸은 시기를 모르는 것들. */
const MONTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2] as const

/** 달마다 한 줄로 붙는 학사 흐름 설명. 인포그래픽의 뼈대가 된다. */
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

export default function RoadmapInfographic({ tasks, onPick }: Props): JSX.Element {
  const byMonth = useMemo(() => {
    const map = new Map<number, Task[]>()
    for (const m of MONTHS) map.set(m, [])
    const etc: Task[] = []

    for (const t of tasks) {
      const m = monthOf(t.task_date_display)
      if (map.has(m)) map.get(m)!.push(t)
      else etc.push(t)
    }
    for (const list of map.values()) {
      list.sort((a, b) => weekOf(a.task_date_display) - weekOf(b.task_date_display))
    }
    return { map, etc }
  }, [tasks])

  const total = tasks.length
  const done = tasks.filter((t) => t.is_completed === 1).length
  const pct = total ? Math.round((done / total) * 100) : 0

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
    for (const [m, list] of byMonth.map) {
      if (list.length > top.n) top = { month: m, n: list.length }
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
            <b>{done}</b>
            <span>마친 것</span>
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

      {/* ── 연간 흐름 ── */}
      <div className="info-timeline">
        {MONTHS.map((m) => {
          const list = byMonth.map.get(m) ?? []
          const mDone = list.filter((t) => t.is_completed === 1).length
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
                  {list.length > 0 && (
                    <span className="muted small">
                      {mDone}/{list.length} 완료
                    </span>
                  )}
                </div>

                {list.length === 0 ? (
                  <div className="info-empty">등록된 업무 없음</div>
                ) : (
                  <>
                    <div className="info-bar">
                      <div
                        style={{ width: `${list.length ? (mDone / list.length) * 100 : 0}%` }}
                      />
                    </div>
                    <div className="info-cards">
                      {list.map((t) => (
                        <button
                          key={t.id}
                          className={`info-card ${t.is_completed === 1 ? 'done' : ''}`}
                          onClick={() => onPick(t)}
                          title={t.key_points || t.title}
                        >
                          <span className="info-card-when">{t.task_date_display || '수시'}</span>
                          <span className="info-card-title">{t.title}</span>
                        </button>
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
          <div className="info-cards">
            {byMonth.etc.map((t) => (
              <button
                key={t.id}
                className={`info-card ${t.is_completed === 1 ? 'done' : ''}`}
                onClick={() => onPick(t)}
              >
                <span className="info-card-when">수시</span>
                <span className="info-card-title">{t.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
