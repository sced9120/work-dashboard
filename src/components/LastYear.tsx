import { useMemo } from 'react'
import type { Task } from '../../shared/types'
import { currentSchoolYear, schoolYearLabel } from '../../shared/types'
import type { PageId } from '../App'
import { monthOf, weekOf } from '../lib/util'

interface Props {
  tasks: Task[]
  onGo: (p: PageId) => void
}

/** 오늘이 그 달의 몇째 주인지 (1~5) */
function weekOfMonth(d: Date): number {
  return Math.floor((d.getDate() - 1) / 7) + 1
}

/**
 * 작년 이맘때.
 *
 * 쌓아 둔 자료는 "찾아보는 것" 이었다. 찾을 생각을 해야만 쓸모가 있었다는 뜻이다.
 * 이 칸은 반대로 **먼저 알려 준다** — 지난 학년도의 이맘때 무슨 일을 했는지.
 *
 * 처음 업무를 맡은 사람은 무엇이 다가오는지 모른다. 전임자의 한 해가 그대로
 * 예고편이 되어 준다. 그것이 이 프로그램에 지난 자료를 남겨 두는 까닭이다.
 */
export default function LastYear({ tasks, onGo }: Props): JSX.Element | null {
  const now = new Date()
  const thisYear = currentSchoolYear()
  const month = now.getMonth() + 1
  const week = weekOfMonth(now)

  const past = useMemo(() => {
    // 지난 학년도의 일 가운데, 이번 주와 다음 주에 해당하는 것
    const older = tasks.filter((t) => t.school_year > 0 && t.school_year < thisYear)
    if (!older.length) return []

    return older
      .filter((t) => {
        if (monthOf(t.task_date_display) !== month) return false
        const w = weekOf(t.task_date_display)
        // 주를 모르는 것(9)은 그 달 안이면 함께 보여 준다
        return w === 9 || (w >= week && w <= week + 1)
      })
      .sort((a, b) => {
        const ow = weekOf(a.task_date_display) - weekOf(b.task_date_display)
        if (ow !== 0) return ow
        return b.school_year - a.school_year
      })
  }, [tasks, thisYear, month, week])

  if (!past.length) return null

  // 같은 일이 해마다 되풀이되므로 제목이 같은 것은 한 번만 보여 준다
  const seen = new Set<string>()
  const shown = past.filter((t) => {
    if (seen.has(t.title)) return false
    seen.add(t.title)
    return true
  })

  return (
    <div className="card">
      <div className="card-title">
        <span>
          🔁 작년 이맘때 <span className="muted">— {month}월 {week}주 무렵</span>
        </span>
        <button className="btn btn-sm btn-ghost" onClick={() => onGo('로드맵')}>
          로드맵에서 보기
        </button>
      </div>

      <p className="hint" style={{ marginTop: 0 }}>
        지난 학년도의 이맘때 했던 일입니다. <b>올해도 곧 돌아올 일</b>이니 미리 챙겨 두세요.
      </p>

      <div className="list">
        {shown.slice(0, 8).map((t) => (
          <div className="item" key={t.id}>
            <div className="item-head">
              <div style={{ minWidth: 0 }}>
                <div className="item-title">{t.title}</div>
                {t.key_points.trim() && (
                  <div className="item-meta" style={{ whiteSpace: 'pre-wrap' }}>
                    {t.key_points.split('\n')[0].slice(0, 120)}
                  </div>
                )}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <span className="badge">{t.task_date_display}</span>
                <span className="badge badge-accent">{schoolYearLabel(t.school_year)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {shown.length > 8 && (
        <p className="muted small" style={{ marginBottom: 0 }}>
          그 밖에 {shown.length - 8}건이 더 있습니다.
        </p>
      )}
    </div>
  )
}
