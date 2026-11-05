import { useCallback, useEffect, useRef, useState } from 'react'
import type { Weather, WeatherKind, WeatherPlace } from '../../shared/weather'
import { DDAY_KEY, WEATHER_PLACE_KEY, airGrade, daysUntil, ddayLabel, parseDdays, shortPlace, sortDdays, weatherText, weatherTip, weatherTips } from '../../shared/weather'
import type { DDay } from '../../shared/weather'
import { NEIS_MARK, addDays, scheduleToEvents } from '../../shared/neis'
import type { PageId } from '../App'
import { todayStr } from '../lib/util'
import { useToast } from '../lib/toast'

/**
 * 오늘 판 · 홈의 날씨 위젯과 D-Day 위젯.
 *  - 날씨: 나이스에 연결한 학교 주소(시 · 군 · 구)의 날씨 · 미세먼지. 다른 곳은 [📍] 로 찾아 고른다. 30분마다 새로.
 *  - D-Day: 시험 · 방학식 · 수능 같은 날을 넣어 두면 남은 날을 센다. 학사일정에서 골라 넣을 수도 있다.
 */

const REFRESH_MS = 30 * 60 * 1000

function readPlace(raw: string): WeatherPlace | null {
  try {
    const v = JSON.parse(raw || 'null') as WeatherPlace | null
    return v && typeof v.name === 'string' && Number.isFinite(v.lat) && Number.isFinite(v.lon) ? v : null
  } catch {
    return null
  }
}

const deg = (n: number): string => `${Math.round(n)}°`

/** 날씨 선 그림 — 마크와 같은 굵기 · 둥근 끝, 글자색 한 가지 (해만 주황) */
const SUN = 'M12 3v1.6M12 19.4V21M3 12h1.6M19.4 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M5.6 18.4l1.1-1.1M17.3 6.7l1.1-1.1'
const CLOUD = 'M7.5 18.5h9a3.8 3.8 0 0 0 .5-7.57A5.5 5.5 0 0 0 6.6 12.2 3.2 3.2 0 0 0 7.5 18.5Z'
function WxIcon({ kind, size = 20 }: { kind: WeatherKind; size?: number }): JSX.Element {
  const p = { stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' }
  const sun = { ...p, stroke: 'var(--hand, #e07a3f)' }
  return (
    <svg className="wx-ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {kind === 'clear' && (
        <>
          <circle cx="12" cy="12" r="4.2" {...sun} />
          <path d={SUN} {...sun} />
        </>
      )}
      {kind === 'night' && <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z" {...p} />}
      {kind === 'partly' && (
        <>
          <circle cx="9" cy="8.5" r="3.2" {...sun} />
          <path d="M9 2.8v1.1M3.3 8.5h1.1M5 4.5l.8.8M13 4.5l-.8.8" {...sun} />
          <path d="M9 19.5h8a3.3 3.3 0 0 0 .4-6.57A4.8 4.8 0 0 0 8.3 13.9 2.8 2.8 0 0 0 9 19.5Z" {...p} />
        </>
      )}
      {kind === 'cloudy' && <path d={CLOUD} {...p} />}
      {kind === 'fog' && <path d="M4 9h13M6 13h14M4 17h12" {...p} />}
      {(kind === 'rain' || kind === 'snow' || kind === 'thunder') && <path d="M7.5 15.5h9a3.8 3.8 0 0 0 .5-7.57A5.5 5.5 0 0 0 6.6 9.2 3.2 3.2 0 0 0 7.5 15.5Z" {...p} />}
      {kind === 'rain' && <path d="M9 18.5 8.3 20.5M12.5 18.5l-.7 2M16 18.5l-.7 2" {...p} />}
      {kind === 'snow' && <path d="M9 19h.01M12.5 20.5h.01M16 19h.01" {...p} strokeWidth={2.4} />}
      {kind === 'thunder' && <path d="m12.5 16.5-2 3h3l-2 3" {...p} />}
    </svg>
  )
}

/* ---------- 날씨 ---------- */

export function WeatherWidget({ onGo, w = 3, h = 2 }: { onGo: (p: PageId) => void; w?: number; h?: number }): JSX.Element {
  const [place, setPlace] = useState<WeatherPlace | null | undefined>(undefined)
  const [data, setData] = useState<Weather | null>(null)
  const [error, setError] = useState('')
  const [picking, setPicking] = useState(false)

  // 자리: 저장한 것 → 없으면 학교 주소에서
  useEffect(() => {
    void (async () => {
      const saved = readPlace(await window.api.setting.get(WEATHER_PLACE_KEY))
      if (saved) return setPlace(saved)
      const school = await window.api.weather.schoolPlace()
      if (school) void window.api.setting.set(WEATHER_PLACE_KEY, JSON.stringify(school))
      setPlace(school)
    })()
  }, [])

  const load = useCallback(
    async (force = false) => {
      if (!place) return
      const r = await window.api.weather.at(place.lat, place.lon, force)
      if (r.ok) {
        setData(r.data)
        setError('')
      } else setError(r.error)
    },
    [place]
  )

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  const choose = (p: WeatherPlace): void => {
    setPlace(p)
    setData(null)
    setPicking(false)
    void window.api.setting.set(WEATHER_PLACE_KEY, JSON.stringify(p))
  }

  if (place === undefined) return <div className="muted small">자리 찾는 중…</div>
  if (picking || !place) {
    return (
      <PlacePicker
        intro={!place ? '나이스에 학교를 연결하면 학교가 있는 곳 날씨가 바로 뜹니다. 아니면 지역을 찾아 골라 주세요.' : ''}
        onPick={choose}
        onCancel={place ? () => setPicking(false) : undefined}
        onGo={onGo}
        showSchoolLink={!place}
      />
    )
  }
  if (!data) {
    return (
      <div className="muted small">
        {error || '날씨 받는 중…'}{' '}
        {error && (
          <button className="link" onClick={() => void load(true)}>
            다시
          </button>
        )}
      </div>
    )
  }

  const t = weatherText(data.now.code, data.now.isDay)
  const air = airGrade(data.air.pm10, data.air.pm25)
  const tip = weatherTip(data)
  const tips = weatherTips(data)
  const wide = w >= 6
  const tall = h >= 3
  const hours = data.hours.slice(0, wide ? 12 : tall ? 6 : 0)

  return (
    <div className={`wx ${wide ? 'wide' : ''} ${tall ? 'tall' : ''}`}>
      <div className="wx-main">
        <span className="wx-emoji">
          <WxIcon kind={t.kind} size={40} />
        </span>
        <span className="wx-temp">{deg(data.now.temp)}</span>
        <span className="wx-side">
          <b>{t.label}</b>
          <span>
            최고 {deg(data.today.max)} · 최저 {deg(data.today.min)}
          </span>
          <span>
            체감 {deg(data.now.feels)}
            {data.today.pop > 0 && ` · 비 ${data.today.pop}%`}
          </span>
        </span>
      </div>
      <div className="wx-meta">
        {air && (
          <span className={`wx-air g${['좋음', '보통', '나쁨', '매우 나쁨'].indexOf(air)}`} title={`미세먼지 ${data.air.pm10 ?? '—'} · 초미세먼지 ${data.air.pm25 ?? '—'} ㎍/㎥`}>
            미세먼지 {air}
          </span>
        )}
        {!tall &&
          tips.map((x) => (
            <span key={x.short} className="wx-chip" title={x.long}>
              {x.short}
            </span>
          ))}
        {wide && data.tomorrow && (
          <span className="wx-tomorrow">
            내일 {weatherText(data.tomorrow.code).label} {deg(data.tomorrow.min)} / {deg(data.tomorrow.max)}
            {data.tomorrow.pop > 0 && ` · 비 ${data.tomorrow.pop}%`}
          </span>
        )}
        <button className="wx-place" onClick={() => setPicking(true)} title="다른 곳 날씨 보기">
          {shortPlace(place.name)}
        </button>
      </div>
      {tip && tall && <div className="wx-tip" title={tip}>{tip}</div>}
      {hours.length > 0 && (
        <div className="wx-hours" role="list" aria-label="시간별 날씨">
          {hours.map((x) => (
            <span key={x.time} className="wx-hour" role="listitem" title={`${x.time} ${weatherText(x.code).label}${x.pop ? ` · 비 ${x.pop}%` : ''}`}>
              <small>
                {Number(x.time.slice(0, 2))}시{x.pop >= 30 && <em className="wx-pop"> {x.pop}%</em>}
              </small>
              <span>
                <WxIcon kind={weatherText(x.code).kind} size={15} /> <b>{deg(x.temp)}</b>
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function PlacePicker({
  intro,
  onPick,
  onCancel,
  onGo,
  showSchoolLink
}: {
  intro: string
  onPick: (p: WeatherPlace) => void
  onCancel?: () => void
  onGo: (p: PageId) => void
  showSchoolLink: boolean
}): JSX.Element {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [list, setList] = useState<WeatherPlace[] | null>(null)
  const [note, setNote] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])

  const find = async (): Promise<void> => {
    if (!q.trim() || busy) return
    setBusy(true)
    const r = await window.api.weather.search(q)
    setBusy(false)
    setList(r.places)
    setNote(r.ok ? (r.places.length ? '' : `'${q.trim()}' 을 찾지 못했습니다. 시 · 군 · 구 이름으로 찾아 보세요(예: 창원시 의창구).`) : r.error ?? '')
  }

  const useSchool = async (): Promise<void> => {
    setBusy(true)
    const p = await window.api.weather.schoolPlace()
    setBusy(false)
    if (p) onPick(p)
    else setNote('나이스에 연결한 학교가 없거나 학교 주소로 자리를 찾지 못했습니다.')
  }

  return (
    <div className="wx-pick">
      {intro && <p className="muted small">{intro}</p>}
      <div className="row" style={{ gap: 6 }}>
        <input
          ref={ref}
          type="search"
          value={q}
          placeholder="지역 이름 (예: 김해시, 진주시)"
          aria-label="날씨 볼 지역 이름"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void find()}
        />
        <button className="btn btn-sm" onClick={() => void find()} disabled={busy}>
          {busy ? '…' : '찾기'}
        </button>
      </div>
      {list && list.length > 0 && (
        <div className="wx-results">
          {list.map((p) => (
            <button key={`${p.lat},${p.lon}`} className="btn btn-sm btn-ghost" onClick={() => onPick(p)}>
              {p.name}
            </button>
          ))}
        </div>
      )}
      {note && <p className="muted small">{note}</p>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {!showSchoolLink && (
          <button className="link small" onClick={() => void useSchool()}>
            학교 자리로 되돌리기
          </button>
        )}
        {showSchoolLink && (
          <button className="link small" onClick={() => onGo('설정')}>
            나이스 학교 연결하러 가기
          </button>
        )}
        {onCancel && (
          <button className="link small" onClick={onCancel}>
            닫기
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------- D-Day ---------- */

interface Pick {
  title: string
  date: string
}

/** 학사일정에서 D-Day 로 넣을 만한 날 (앞으로 1년) */
async function schoolDays(today: string): Promise<Pick[]> {
  const to = addDays(today, 365)
  let list: Pick[] = []
  const local = await window.api.local.load()
  if (local.neis_key?.trim()) {
    const r = await window.api.neis.schedule(today, to)
    if (r.ok) list = scheduleToEvents(r.data, { skipSaturdayOff: true, skipHolidays: true, color: '' }).map((e) => ({ title: e.title, date: e.event_date }))
  }
  if (!list.length) list = (await window.api.events.between(today, to)).filter((e) => e.content.includes(NEIS_MARK)).map((e) => ({ title: e.title, date: e.event_date }))
  const seen = new Set<string>()
  return list
    .filter((x) => x.date >= today && !/토요휴업|재량휴업|공휴일|대체/.test(x.title))
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((x) => !seen.has(x.title) && seen.add(x.title))
    .slice(0, 40)
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const md = (day: string): string => {
  const d = new Date(`${day}T00:00:00`)
  return `${d.getMonth() + 1}. ${d.getDate()}.(${WEEK[d.getDay()]})`
}

export function DdayWidget({ h = 2 }: { h?: number }): JSX.Element {
  const toast = useToast()
  const today = todayStr()
  const [list, setList] = useState<DDay[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [picks, setPicks] = useState<Pick[] | null>(null)

  useEffect(() => {
    void (async () => setList(parseDdays(await window.api.setting.get(DDAY_KEY, '[]'))))()
  }, [])

  const save = (next: DDay[]): void => {
    setList(next)
    void window.api.setting.set(DDAY_KEY, JSON.stringify(next))
  }

  const openAdd = (): void => {
    setAdding(true)
    setTitle('')
    setDate('')
    if (!picks) void schoolDays(today).then(setPicks)
  }

  const add = (): void => {
    if (!title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast('이름과 날짜를 넣어 주세요.', 'err')
      return
    }
    save([...(list ?? []), { id: `${Date.now()}`, title: title.trim().slice(0, 40), date }])
    setAdding(false)
  }

  if (!list) return <div className="muted small">불러오는 중…</div>

  if (adding) {
    return (
      <div className="dd-add">
        <input type="text" value={title} placeholder="이름 (예: 2학기 기말고사)" aria-label="D-Day 이름" onChange={(e) => setTitle(e.target.value)} maxLength={40} autoFocus />
        <input type="date" value={date} aria-label="날짜" onChange={(e) => setDate(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        {picks && picks.length > 0 && (
          <select
            value=""
            aria-label="학사일정에서 고르기"
            onChange={(e) => {
              const p = picks[Number(e.target.value)]
              if (p) {
                setTitle(p.title)
                setDate(p.date)
              }
            }}
          >
            <option value="">학사일정에서 고르기…</option>
            {picks.map((p, i) => (
              <option key={`${p.date}-${p.title}`} value={i}>
                {md(p.date)} {p.title}
              </option>
            ))}
          </select>
        )}
        <div className="row row-end" style={{ gap: 6 }}>
          <button className="btn btn-sm btn-ghost" onClick={() => setAdding(false)}>
            취소
          </button>
          <button className="btn btn-sm btn-primary" onClick={add}>
            넣기
          </button>
        </div>
      </div>
    )
  }

  if (!list.length) {
    return (
      <div className="muted small">
        시험 · 방학식 · 수능처럼 기다리는 날을 넣으면 남은 날을 셉니다.{' '}
        <button className="link" onClick={openAdd}>
          ＋ D-Day 넣기
        </button>
      </div>
    )
  }

  const sorted = sortDdays(list, today)
  const [first, ...rest] = sorted
  const n = daysUntil(first.date, today)
  const restShown = rest.slice(0, Math.max(0, h * 2 - 3))

  return (
    <div className="dd">
      <div className={`dd-hero ${n === 0 ? 'today' : n < 0 ? 'past' : ''}`}>
        <b>{ddayLabel(first.date, today)}</b>
        <span>
          <span className="dd-title">{first.title}</span>
          <small>{md(first.date)}</small>
        </span>
      </div>
      {restShown.map((d) => (
        <div key={d.id} className={`dd-row ${d.date < today ? 'past' : ''}`}>
          <span className="dd-badge">{ddayLabel(d.date, today)}</span>
          <span className="dd-title">{d.title}</span>
          <small className="muted">{md(d.date)}</small>
          <button className="dd-x" onClick={() => save(list.filter((x) => x.id !== d.id))} aria-label={`${d.title} 지우기`} title="지우기">
            ✕
          </button>
        </div>
      ))}
      <div className="dd-foot">
        <button className="link small" onClick={openAdd}>
          ＋ 넣기
        </button>
        <button className="link small muted" onClick={() => save(list.filter((x) => x.id !== first.id))} title={`'${first.title}' 지우기`}>
          맨 위 지우기
        </button>
        {rest.length > restShown.length && <small className="muted">그 밖에 {rest.length - restShown.length}개 (위젯을 키우면 보임)</small>}
      </div>
    </div>
  )
}
