import { useCallback, useEffect, useState } from 'react'
import type { NeisMealDay, NeisSchool } from '../../shared/neis'
import { NEIS_SCHOOL_KEY, allergyNames, ymd } from '../../shared/neis'
import type { PageId } from '../App'

interface Props {
  onGo: (p: PageId) => void
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토']

function label(day: string): string {
  const d = new Date(`${day}T00:00:00`)
  return `${d.getMonth() + 1}. ${d.getDate()}.(${WEEK[d.getDay()]})`
}

/**
 * 홈의 급식 위젯. 나이스에 학교를 연결해 두면 오늘(없으면 다음 급식일)의 조식 · 중식 · 석식을 보여 준다.
 * 인증키 없이도 된다(하루치는 5건을 넘지 않는다). 겉 틀(제목 · 접기)은 홈 위젯이 그린다.
 */
export default function MealCard({ onGo }: Props): JSX.Element | null {
  const today = ymd(new Date())
  const [school, setSchool] = useState<NeisSchool | null | undefined>(undefined)
  const [day, setDay] = useState<NeisMealDay | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const s = JSON.parse((await window.api.setting.get(NEIS_SCHOOL_KEY)) || 'null') as NeisSchool | null
        setSchool(s?.code ? s : null)
      } catch {
        setSchool(null)
      }
    })()
  }, [])

  const show = useCallback(async (fn: () => Promise<NeisMealDay>) => {
    setBusy(true)
    try {
      setDay(await fn())
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (!school) return
    void show(async () => {
      const r = await window.api.neis.meals(today)
      // 오늘 급식이 없으면(주말 · 방학) 다음 급식일을 보여 준다
      if (r.ok && !r.meals.length) {
        const next = await window.api.neis.nextMeals(today, 1)
        return next.ok && next.meals.length ? next : r
      }
      return r
    })
  }, [school, today, show])

  if (school === undefined) return <div className="muted small">불러오는 중…</div>

  if (!school) {
    return (
      <div className="meal-hint">
        <span className="small">
          <b>나이스에 우리 학교를 연결하면</b> 오늘 급식(중식 · 석식)이 여기 뜹니다. 인증키 없이도 됩니다.
        </span>
        <button className="btn btn-sm btn-primary" onClick={() => onGo('설정')}>
          설정에서 연결하기
        </button>
      </div>
    )
  }

  const date = day?.date ?? today
  const isToday = date === today

  return (
    <div className="meal-card">
      <div className="meal-nav">
        <span>
          <b>{label(date)}</b>
          {!isToday && day?.meals.length ? (
            <span className="badge" style={{ marginLeft: 6 }}>
              {date > today ? '다음 급식일' : '지난 급식'}
            </span>
          ) : null}
        </span>
        <span className="row" style={{ gap: 2 }}>
          <button
            className="btn btn-sm btn-ghost"
            title="앞의 급식일"
            disabled={busy}
            onClick={() => void show(() => window.api.neis.nextMeals(date, -1))}
          >
            ◀
          </button>
          {!isToday && (
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void show(() => window.api.neis.meals(today))}>
              오늘
            </button>
          )}
          <button
            className="btn btn-sm btn-ghost"
            title="다음 급식일"
            disabled={busy}
            onClick={() => void show(() => window.api.neis.nextMeals(date, 1))}
          >
            ▶
          </button>
        </span>
      </div>

      {busy && !day ? (
        <div className="muted small">불러오는 중…</div>
      ) : day && !day.ok ? (
        <div className="muted small">
          {day.error}{' '}
          <button className="link" onClick={() => void show(() => window.api.neis.meals(date))}>
            다시 불러오기
          </button>
        </div>
      ) : !day?.meals.length ? (
        <div className="muted small">{isToday ? '오늘은 급식이 없습니다.' : '이 날은 급식이 없습니다.'}</div>
      ) : (
        <div className="meal-cols">
          {day.meals.map((m) => (
            <div className="meal" key={m.kind}>
              <div className="meal-kind">
                {m.kind}
                {m.cal && <span className="muted small"> · {m.cal}</span>}
              </div>
              <ul>
                {m.dishes.map((d, i) => (
                  <li key={i} title={d.allergy ? `알레르기: ${allergyNames(d.allergy)}` : undefined}>
                    {d.name}
                    {d.allergy && <sup className="meal-allergy">{d.allergy}</sup>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <div className="meal-foot muted small">
        {school.name} · 숫자는 알레르기 유발 식품 번호(마우스를 올리면 이름)
      </div>
    </div>
  )
}
