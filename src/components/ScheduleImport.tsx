import { useEffect, useState } from 'react'
import type { CalEventInput } from '../../shared/types'
import { EVENT_COLORS } from '../../shared/types'
import type { NeisSchool } from '../../shared/neis'
import { NEIS_SCHOOL_KEY, schoolYearRange, scheduleToEvents, ymd } from '../../shared/neis'
import type { PageId } from '../App'
import { useToast } from '../lib/toast'

interface Props {
  onDone: () => void
  onClose: () => void
  onGo: (p: PageId) => void
}

type Range = '남은' | '전체'

interface Pick {
  event: CalEventInput
  exists: boolean
  on: boolean
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const md = (day: string): string => {
  const d = new Date(`${day}T00:00:00`)
  return `${d.getMonth() + 1}. ${d.getDate()}.(${WEEK[d.getDay()]})`
}

/**
 * 나이스 학사일정을 달력에 넣는다. 넣기 전에 목록으로 보여 주고, 고른 것만 넣는다.
 * 같은 날 같은 이름의 일정이 이미 있으면 빼 두어 두 번 가져와도 겹치지 않는다.
 */
export default function ScheduleImport({ onDone, onClose, onGo }: Props): JSX.Element {
  const toast = useToast()
  const today = ymd(new Date())
  const year = schoolYearRange(today)
  const [school, setSchool] = useState<NeisSchool | null | undefined>(undefined)
  const [hasKey, setHasKey] = useState(false)
  const [range, setRange] = useState<Range>('남은')
  const [skipSat, setSkipSat] = useState(true)
  const [skipHol, setSkipHol] = useState(true)
  const [color, setColor] = useState('purple')
  const [busy, setBusy] = useState(false)
  const [picks, setPicks] = useState<Pick[] | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const s = JSON.parse((await window.api.setting.get(NEIS_SCHOOL_KEY)) || 'null') as NeisSchool | null
        setSchool(s?.code ? s : null)
      } catch {
        setSchool(null)
      }
      setHasKey(!!(await window.api.local.load()).neis_key?.trim())
    })()
  }, [])

  const load = async (): Promise<void> => {
    const from = range === '남은' ? today : year.from
    setBusy(true)
    setPicks(null)
    try {
      const res = await window.api.neis.schedule(from, year.to)
      if (!res.ok) {
        toast(res.error ?? '학사일정을 받지 못했습니다.', 'err')
        return
      }
      const events = scheduleToEvents(res.data, { skipSaturdayOff: skipSat, skipHolidays: skipHol, color })
      const have = new Set((await window.api.events.between(from, year.to)).map((e) => `${e.event_date}|${e.title}`))
      setPicks(
        events.map((e) => {
          const exists = have.has(`${e.event_date}|${e.title}`)
          return { event: e, exists, on: !exists }
        })
      )
      if (!events.length) toast('이 기간에 나이스에 올라온 학사일정이 없습니다.')
    } finally {
      setBusy(false)
    }
  }

  const put = async (): Promise<void> => {
    if (!picks) return
    const list = picks.filter((p) => p.on).map((p) => ({ ...p.event, color }))
    if (!list.length) {
      toast('넣을 일정을 골라 주세요.', 'err')
      return
    }
    setBusy(true)
    try {
      const r = await window.api.events.addMany(list)
      toast(`학사일정 ${r.added}건을 달력에 넣었습니다.${r.skipped ? ` (이미 있던 ${r.skipped}건은 건너뜀)` : ''}`, 'ok')
      setPicks(null)
      onDone()
    } finally {
      setBusy(false)
    }
  }

  const count = picks?.filter((p) => p.on).length ?? 0

  return (
    <div className="card">
      <div className="card-title">
        <span>📥 나이스 학사일정 가져오기</span>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          닫기
        </button>
      </div>

      {school === undefined ? (
        <div className="muted small">확인하는 중…</div>
      ) : !school || !hasKey ? (
        <div className="note note-warn">
          {!school ? (
            <>학교를 먼저 연결해야 합니다. </>
          ) : (
            <>
              학사일정은 한 번에 5건을 넘어서 <b>나이스 인증키</b>가 있어야 받을 수 있습니다(무료, 신청하면 바로 발급).{' '}
            </>
          )}
          <button className="btn btn-sm" onClick={() => onGo('설정')}>
            설정 → 나이스 연결
          </button>
        </div>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            <b>{school.name}</b> 의 {year.year}학년도 학사일정을 나이스에서 받아, 고른 것만 달력에 넣습니다. 이름이
            같은 일정이 날짜로 이어지면(기말고사 사흘 등) 여러 날짜리 일정 하나로 묶습니다.
          </p>
          <div className="row" style={{ marginBottom: 10 }}>
            <select value={range} onChange={(e) => setRange(e.target.value as Range)} style={{ width: 'auto' }}>
              <option value="남은">오늘부터 학년도 끝까지</option>
              <option value="전체">{year.year}학년도 전체 (3월부터)</option>
            </select>
            <label className="neis-opt">
              <input type="checkbox" checked={skipSat} onChange={(e) => setSkipSat(e.target.checked)} />
              <span>토요휴업일 빼기</span>
            </label>
            <label className="neis-opt">
              <input type="checkbox" checked={skipHol} onChange={(e) => setSkipHol(e.target.checked)} />
              <span>공휴일 빼기 (달력에 이미 빨갛게 뜸)</span>
            </label>
            <select value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 'auto' }} title="넣을 일정의 색">
              {EVENT_COLORS.map((c) => (
                <option key={c.id} value={c.id}>
                  색: {c.label}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={() => void load()} disabled={busy}>
              {busy && !picks ? '받는 중…' : '🔎 학사일정 불러오기'}
            </button>
          </div>

          {picks && picks.length > 0 && (
            <>
              <div className="row" style={{ marginBottom: 6 }}>
                <span className="muted small">
                  {picks.length}건 · 고른 것 {count}건
                  {picks.some((p) => p.exists) && ` · 이미 달력에 있는 ${picks.filter((p) => p.exists).length}건은 빼 두었습니다`}
                </span>
                <span className="spacer" />
                <button className="btn btn-sm btn-ghost" onClick={() => setPicks(picks.map((p) => ({ ...p, on: !p.exists })))}>
                  모두 고르기
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setPicks(picks.map((p) => ({ ...p, on: false })))}>
                  모두 빼기
                </button>
              </div>
              <div className="neis-picks">
                {picks.map((p, i) => (
                  <label className={`neis-pick ${p.exists ? 'exists' : ''}`} key={`${p.event.event_date}-${p.event.title}`}>
                    <input
                      type="checkbox"
                      checked={p.on}
                      onChange={(e) => setPicks(picks.map((x, xi) => (xi === i ? { ...x, on: e.target.checked } : x)))}
                    />
                    <span className="neis-pick-date">
                      {md(p.event.event_date)}
                      {p.event.end_date !== p.event.event_date && ` ~ ${md(p.event.end_date)}`}
                    </span>
                    <span className="neis-pick-title">{p.event.title}</span>
                    {/휴업일/.test(p.event.content) && <span className="badge badge-warn">휴업일</span>}
                    {p.exists && <span className="badge">이미 있음</span>}
                  </label>
                ))}
              </div>
              <div className="row row-end" style={{ marginTop: 10 }}>
                <button className="btn btn-primary" onClick={() => void put()} disabled={busy || count === 0}>
                  {count}건 달력에 넣기
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
