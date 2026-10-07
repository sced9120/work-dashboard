import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { CalEvent, Deadline } from '../../shared/types'
import type { NeisMealDay, NeisSchool } from '../../shared/neis'
import { NEIS_MARK, NEIS_SCHOOL_KEY, addDays, ymd } from '../../shared/neis'
import type { MySlot } from '../../shared/timetable'
import { endOf, hoursOf, lunchOf, periodNow, slotText } from '../../shared/timetable'
import type { PageId } from '../App'
import { queueChat } from '../lib/chatBridge'
import { nowInfo, useTimetable } from '../lib/timetable'
import { useToast } from '../lib/toast'
import Icon from './Icon'

/**
 * 홈의 '오늘' 위젯. 홈을 열었을 때 가장 먼저 알아야 할 것을 한 판에 모은다.
 *  - 큰 칸: 지금 몇 교시 · 오늘 교시 띠 · 오늘 일정
 *  - 그 아래: 업무 도우미에게 바로 묻기, 빠른 이동 칩
 *  - 오른쪽: 통합 검색, 절차 기한 카드 묶음(맨 앞이 가장 급한 것), 오늘 급식 부채꼴
 * 자료는 내 시간표 · 달력 · 절차 기한 · 나이스 급식에서 그대로 가져온다.
 */

type Go = (p: PageId) => void

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const md = (day: string): string => {
  const d = new Date(`${day}T00:00:00`)
  return `${d.getMonth() + 1}. ${d.getDate()}.(${WEEK[d.getDay()]})`
}
const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}
function dday(day: string, today: string): string {
  const n = Math.round((new Date(`${day}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000)
  return n === 0 ? 'D-day' : n > 0 ? `D-${n}` : `${-n}일 지남`
}

/** 빠른 이동. 앞의 셋은 자주 쓰는 것이라 채워 둔다. */
const CHIPS: { page: PageId; label: string; on?: boolean }[] = [
  { page: '학습', label: '공문 넣기', on: true },
  { page: '기한', label: '기한 넣기', on: true },
  { page: '일지', label: '일지 쓰기', on: true },
  { page: '위원회', label: '학교 문서' },
  { page: '발표', label: '발표자료' },
  { page: '로드맵', label: '로드맵' },
  { page: '도움자료', label: '도움자료' },
  { page: '가이드', label: '업무 가이드' },
  { page: '데이터', label: '인수인계' }
]

/* ---------- 큰 칸: 오늘 ---------- */

interface TrackItem {
  label: string
  start: string
  slot: MySlot | null
  state: 'done' | 'now' | 'up'
  lunchAfter: boolean
}

function Hero({ onGo }: { onGo: Go }): JSX.Element {
  const T = useTimetable()
  const [events, setEvents] = useState<CalEvent[] | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    // 교시가 바뀌는 것을 보여 주려고 1분마다 다시 그린다
    const t = setInterval(() => setTick((n) => n + 1), 60000)
    return () => clearInterval(t)
  }, [])
  void tick

  useEffect(() => {
    void (async () => {
      const today = ymd(new Date())
      const evs = await window.api.events.between(today, today)
      setEvents(
        evs
          .filter((e) => e.event_date <= today && (e.end_date || e.event_date) >= today)
          .sort((a, b) => (a.start_time || '99').localeCompare(b.start_time || '99'))
      )
    })()
  }, [])

  const d = new Date()
  const now = nowInfo()
  let head = '오늘을 한눈에'
  let sub = ''
  let pct = 0
  let track: TrackItem[] = []

  if (T.my) {
    const my = T.my
    const len = T.times.length
    if (now.day < 0 || now.day >= my.grid.length) {
      head = '오늘은 수업이 없는 날입니다'
      sub = `한 주 ${hoursOf(my)}시간`
    } else {
      const count = my.dayPeriods?.[now.day] || my.periods.length
      const periods = my.periods.slice(0, count)
      const row = my.grid[now.day]
      const timed = periods.length > 0 && periods.every((p) => p.start)
      const cur = timed ? periodNow(periods, now.hhmm, len) : { index: -1, during: false }
      const lessons = row.slice(0, count).filter(Boolean).length
      if (!timed) {
        head = `오늘 수업 ${lessons}시간`
        sub = '교시 시각을 넣으면 지금 몇 교시인지 알려 드립니다'
      } else if (cur.index >= periods.length) {
        head = '오늘 수업이 끝났습니다'
        sub = `오늘 수업 ${lessons}시간`
      } else if (cur.during) {
        const p = periods[cur.index]
        const s = row[cur.index]
        const end = endOf(p, len)
        head = s ? `${p.label} 수업 중` : `${p.label} 빈 시간`
        sub = [s ? slotText(s) : '', `${p.start}–${end}`, `${toMin(end) - toMin(now.hhmm)}분 남음`].filter(Boolean).join(' · ')
        pct = Math.min(100, Math.max(0, ((toMin(now.hhmm) - toMin(p.start)) / len) * 100))
      } else {
        const nextI = row.findIndex((s, i) => !!s && i >= cur.index && i < count)
        if (nextI < 0) {
          head = '오늘 남은 수업이 없습니다'
          sub = `오늘 수업 ${lessons}시간`
        } else {
          const p = periods[nextI]
          head = `다음은 ${p.label}`
          sub = `${slotText(row[nextI])} · ${p.start} 시작 · ${toMin(p.start) - toMin(now.hhmm)}분 뒤`
        }
      }
      const lunch = timed ? lunchOf(periods, len) : null
      track = periods.map((p, i) => ({
        label: p.label,
        start: p.start,
        slot: row[i] ?? null,
        state: !timed ? 'up' : i < cur.index ? 'done' : i === cur.index && cur.during ? 'now' : 'up',
        lunchAfter: lunch?.after === i
      }))
    }
  }

  const cols = track.flatMap((t) => (t.lunchAfter ? ['minmax(0, 1fr)', '22px'] : ['minmax(0, 1fr)'])).join(' ')

  return (
    <section className="td-hero">
      <div className="td-top">
        <span className="td-ey">
          오늘 · {d.getMonth() + 1}월 {d.getDate()}일 {WEEK[d.getDay()]}요일
        </span>
        <button className="td-ghost" onClick={() => onGo('시간표')}>
          시간표 <Icon name="out" size={13} />
        </button>
      </div>
      <div className="td-head">{head}</div>
      {sub && <div className="td-sub">{sub}</div>}

      {T.loaded && !T.my && (
        <div className="td-empty">
          학교 시간표 파일을 불러오면 지금 몇 교시인지, 다음 수업이 무엇인지 여기 뜹니다.{' '}
          <button className="link" onClick={() => onGo('시간표')}>
            시간표로
          </button>
        </div>
      )}

      {track.length > 0 && (
        <ol className="td-track" style={{ gridTemplateColumns: cols }} aria-label="오늘 교시">
          {track.flatMap((t, i) => {
            const cell = (
              <li key={i} className={`td-per ${t.state} ${t.slot ? '' : 'free'}`}>
                <span className="td-per-n">
                  {t.label}
                  {t.state === 'now' ? ' · 지금' : ''}
                </span>
                <span className="td-per-b">
                  {t.slot ? (
                    <>
                      <b>{t.slot.cls || t.slot.subject}</b>
                      {t.slot.cls && <small>{t.slot.subject}</small>}
                    </>
                  ) : (
                    <small>빈 시간</small>
                  )}
                  {t.state === 'now' && <i className="td-per-bar" style={{ width: `${pct}%` }} />}
                </span>
                <span className="td-per-t">{t.start}</span>
              </li>
            )
            return t.lunchAfter
              ? [
                  cell,
                  <li key={`l${i}`} className="td-per lunch" aria-label="점심">
                    <span className="td-per-n">&nbsp;</span>
                    <span className="td-per-b">점심</span>
                    <span className="td-per-t">&nbsp;</span>
                  </li>
                ]
              : [cell]
          })}
        </ol>
      )}

      <div className="td-agenda-h">
        오늘 일정 <span>달력에서</span>
      </div>
      {events === null ? (
        <div className="td-empty">불러오는 중…</div>
      ) : events.length === 0 ? (
        <div className="td-empty">
          오늘 달력에 적힌 일정이 없습니다.{' '}
          <button className="link" onClick={() => onGo('달력')}>
            일정 넣기
          </button>
        </div>
      ) : (
        <ul className="td-agenda">
          {events.slice(0, 4).map((e) => (
            <li key={e.id}>
              <span className="td-time">{e.start_time || '하루 종일'}</span>
              <span className="td-what">{e.title}</span>
              <span className="td-tag">{e.content.includes(NEIS_MARK) ? '학사일정' : '달력'}</span>
            </li>
          ))}
          {events.length > 4 && <li className="td-more">그 밖에 {events.length - 4}건</li>}
        </ul>
      )}
    </section>
  )
}

/* ---------- 도우미에게 바로 묻기 ---------- */

function Ask({ onGo, deadlines }: { onGo: Go; deadlines: Deadline[] }): JSX.Element {
  const [q, setQ] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const first = deadlines[0]
  const ideas = [first ? `「${first.title}」 처리 절차를 순서대로 알려 줘` : '이 업무가 접수되면 처리 절차를 순서대로 알려 줘', '이번 달에 챙겨야 할 업무를 정리해 줘']

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const text = q.trim()
    if (!text) {
      ref.current?.focus()
      return
    }
    // 도우미 화면 입력칸에 옮겨 적고 넘어간다. 보내기 전에 한 번 더 볼 수 있다.
    queueChat(text)
    onGo('도우미')
  }

  return (
    <div className="td-arm">
      <div className="td-ideas">
        <span className="td-label">이렇게 물어보세요</span>
        {ideas.map((t) => (
          <button
            key={t}
            className="td-idea"
            onClick={() => {
              setQ(t)
              ref.current?.focus()
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <form className="td-ask" onSubmit={submit}>
        <span className="td-ask-ico">
          <Icon name="spark" size={16} />
        </span>
        <input ref={ref} type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="업무 도우미에게 물어보기" aria-label="업무 도우미에게 물어보기" />
        <button type="submit" className="td-ask-go" aria-label="도우미에게 보내기" title="도우미 화면으로 옮겨 적습니다">
          <Icon name="up" size={16} />
        </button>
      </form>
    </div>
  )
}

/* ---------- 절차 기한 카드 묶음 ---------- */

function Deadlines({ onGo, list, onChanged }: { onGo: Go; list: Deadline[] | null; onChanged: () => void }): JSX.Element {
  const toast = useToast()
  const today = ymd(new Date())
  const top = (list ?? []).slice(0, 3)
  const [front, setFront] = useState<number | null>(null)
  const frontId = top.some((d) => d.id === front) ? front : top[0]?.id ?? null
  // 뒤에서 앞으로: 맨 앞(마지막)이 고른 카드, 나머지는 급한 차례를 거꾸로
  const order = [...top.filter((d) => d.id !== frontId).reverse(), ...top.filter((d) => d.id === frontId)]

  const finish = async (d: Deadline): Promise<void> => {
    await window.api.deadlines.update(d.id, { done: 1 })
    toast(`'${d.title}' 을(를) 처리한 것으로 옮겼습니다. [절차 기한]에서 되돌릴 수 있습니다.`, 'ok')
    onChanged()
  }

  if (list === null) return <div className="td-stack" />
  if (!top.length) {
    return (
      <div className="td-stack">
        <div className="td-card front" style={{ top: 0 }}>
          <div className="td-card-row">
            <span className="td-d">기한</span>
            <span className="td-card-t">챙길 기한이 없습니다</span>
          </div>
          <div className="td-card-more">
            통보 · 통지처럼 날짜가 정해진 일을 넣어 두면 가장 급한 것이 맨 앞에 옵니다.
            <button className="td-card-go" onClick={() => onGo('기한')}>
              ＋ 기한 넣기
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="td-stack" aria-label="절차 기한">
      {order.map((d, pos) => {
        const isFront = d.id === frontId
        const soon = d.due_date <= addDays(today, 3)
        return (
          <div
            key={d.id}
            className={`td-card ${isFront ? 'front' : `back b${order.length - 1 - pos}`}`}
            style={{ top: pos * 50 }}
            role={isFront ? undefined : 'button'}
            tabIndex={isFront ? undefined : 0}
            aria-label={isFront ? undefined : `${d.title} 앞으로 가져오기`}
            onClick={() => !isFront && setFront(d.id)}
            onKeyDown={(e) => {
              if (!isFront && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                setFront(d.id)
              }
            }}
          >
            <div className="td-card-row">
              <button
                className="td-tog"
                title="처리했으면 눌러 주세요"
                aria-label={`${d.title} 처리함`}
                onClick={(e) => {
                  e.stopPropagation()
                  void finish(d)
                }}
              >
                <Icon name="check" size={11} />
              </button>
              <span className={`td-d ${soon ? 'soon' : ''}`}>{dday(d.due_date, today)}</span>
              <span className="td-card-t">{d.title}</span>
            </div>
            {isFront && (
              <div className="td-card-more">
                <span className="td-label">절차 기한 · {top[0].id === d.id ? '가장 급한 것' : '고른 것'}</span>
                기한 {md(d.due_date)}
                {d.case_ref ? ` · ${d.case_ref}` : ''}
                {(list?.length ?? 0) > 3 && <span className="td-label"> · 그 밖에 {list!.length - 3}건</span>}
                <button className="td-card-go" onClick={() => onGo('기한')}>
                  절차 기한 <Icon name="out" size={12} />
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ---------- 오늘 급식 부채꼴 ---------- */

function Meals({ onGo }: { onGo: Go }): JSX.Element {
  const today = ymd(new Date())
  const [state, setState] = useState<{ linked: boolean; day: NeisMealDay | null } | null>(null)
  const [front, setFront] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      let school: NeisSchool | null = null
      try {
        school = JSON.parse((await window.api.setting.get(NEIS_SCHOOL_KEY)) || 'null') as NeisSchool | null
      } catch {
        school = null
      }
      if (!school?.code) {
        setState({ linked: false, day: null })
        return
      }
      let r = await window.api.neis.meals(today)
      // 오늘 급식이 없으면(주말 · 방학) 다음 급식일
      if (r.ok && !r.meals.length) {
        const next = await window.api.neis.nextMeals(today, 1)
        if (next.ok && next.meals.length) r = next
      }
      setState({ linked: true, day: r })
    })()
  }, [today])

  const meals = state?.day?.ok ? state.day.meals.slice(0, 3) : []
  const hhmm = nowInfo().hhmm
  const wanted = hhmm < '09:00' ? '조식' : hhmm < '13:30' ? '중식' : '석식'
  const frontKind =
    (front && meals.some((m) => m.kind === front) ? front : null) ??
    meals.find((m) => m.kind === wanted)?.kind ??
    meals.find((m) => m.kind === '중식')?.kind ??
    meals[0]?.kind ??
    null
  const ordered = [...meals.filter((m) => m.kind !== frontKind), ...meals.filter((m) => m.kind === frontKind)]
  const ghosts = Math.max(0, 3 - ordered.length)
  const other = state?.day?.date && state.day.date !== today
  const cycle = (): void => {
    if (meals.length < 2) return
    const i = meals.findIndex((m) => m.kind === frontKind)
    setFront(meals[(i + 1) % meals.length].kind)
  }

  return (
    <div className="td-fan" aria-label="오늘 급식">
      <div className="td-fan-clip">
        <div className="td-fan-head">
          <span className="td-pill">{other ? `다음 급식 ${md(state!.day!.date)}` : '오늘 급식'}</span>
          <button className="td-fan-next" onClick={cycle} disabled={meals.length < 2} title="다음 끼니" aria-label="다음 끼니">
            <Icon name="cycle" size={14} />
          </button>
        </div>
        {state === null ? null : !state.linked ? (
          <div className="td-fan-note">
            나이스에 학교를 연결하면 조식 · 중식 · 석식이 여기 뜹니다.{' '}
            <button className="link" onClick={() => onGo('설정')}>
              설정에서 연결
            </button>
          </div>
        ) : !meals.length ? (
          <div className="td-fan-note">{state.day?.error || '가까운 날의 급식 정보가 없습니다.'}</div>
        ) : (
          <>
            {Array.from({ length: ghosts }, (_, i) => (
              <div key={`g${i}`} className={`td-meal ghost f${i}`} aria-hidden="true" />
            ))}
            {ordered.map((m, i) => {
              const pos = ghosts + i
              const isFront = m.kind === frontKind
              return (
                <div
                  key={m.kind}
                  className={`td-meal f${pos} ${isFront ? 'front' : ''}`}
                  onClick={() => !isFront && setFront(m.kind)}
                  title={isFront ? undefined : `${m.kind} 보기`}
                >
                  <div className="td-meal-k">
                    {m.kind}
                    {m.cal && <span>{m.cal.replace(/\s*kcal/i, ' kcal')}</span>}
                  </div>
                  <ul className="td-meal-list">
                    {m.dishes.slice(0, 6).map((x, j) => (
                      <li key={j}>{x.name}</li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

/* ---------- 한 판 ---------- */

export default function TodayPanel({ onGo }: { onGo: Go }): JSX.Element {
  const [deadlines, setDeadlines] = useState<Deadline[] | null>(null)

  const load = useCallback(async () => {
    const all = await window.api.deadlines.list()
    setDeadlines(all.filter((d) => !d.done && d.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date)))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="today">
      <div className="td-grid">
        <div className="td-left">
          <Hero onGo={onGo} />
          <Ask onGo={onGo} deadlines={deadlines ?? []} />
          <section className="td-chips" aria-label="빠른 이동">
            <div className="td-chips-h">
              <span className="td-pill">빠른 이동</span>
              <span className="td-label">채운 칩은 자주 쓰는 화면</span>
            </div>
            <div className="td-chip-grid">
              {CHIPS.map((c) => (
                <button key={c.page} className={`td-chip ${c.on ? 'on' : ''}`} onClick={() => onGo(c.page)}>
                  {c.label}
                </button>
              ))}
            </div>
          </section>
        </div>
        <div className="td-right">
          <button className="td-search" onClick={() => onGo('검색')}>
            <Icon name="search" />
            <span>업무 · 공문 · 도움자료 찾기</span>
            <kbd>Ctrl K</kbd>
          </button>
          <Deadlines onGo={onGo} list={deadlines} onChanged={() => void load()} />
          <Meals onGo={onGo} />
        </div>
      </div>
    </div>
  )
}
