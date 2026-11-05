/**
 * 날씨 · D-Day 위젯이 쓰는 자료 모양과 셈.
 *
 * 날씨는 Open-Meteo(키 없음, 무료)에서, 자리는 나이스에 연결한 학교 주소의 시 · 군 · 구로 잡는다
 * (Electron 은 PC 의 위치를 바로 알 수 없다 — 구글 키가 있어야 함). 다른 곳은 이름으로 찾아 고른다.
 * 미세먼지 등급은 환경부 기준(PM10 30/80/150, PM2.5 15/35/75).
 */

export const WEATHER_PLACE_KEY = 'weather_place'
export const DDAY_KEY = 'ddays'

export interface WeatherPlace {
  name: string
  lat: number
  lon: number
  /** school = 학교 주소에서 잡음, pick = 직접 고름 */
  from: 'school' | 'pick'
}

export interface WeatherHour {
  /** 'HH:00' */
  time: string
  temp: number
  code: number
  pop: number
}

export interface Weather {
  now: { temp: number; feels: number; code: number; humidity: number; wind: number; isDay: boolean; time: string }
  today: { max: number; min: number; pop: number; code: number }
  tomorrow: { max: number; min: number; pop: number; code: number } | null
  /** 지금부터 앞으로 몇 시간 */
  hours: WeatherHour[]
  air: { pm10: number | null; pm25: number | null }
}

export type WeatherResult = { ok: true; data: Weather } | { ok: false; error: string }

const PROVINCE = /(특별시|광역시|특별자치시|특별자치도|도)$/
const CITY = /(시|군)$/
const DIST = /구$/

/**
 * 학교 주소에서 날씨를 찾을 지역 이름만 남긴다.
 * '경상남도 창원시 의창구 원이대로 1' → '경상남도 창원시 의창구', '서울특별시 강남구 …' → '서울특별시 강남구'
 */
export function regionOf(address: string): string {
  const words = address.replace(/\(.*?\)/g, ' ').trim().split(/\s+/).filter(Boolean)
  const out: string[] = []
  let i = 0
  if (words[i] && PROVINCE.test(words[i])) out.push(words[i++])
  if (words[i] && CITY.test(words[i])) out.push(words[i++])
  if (words[i] && DIST.test(words[i])) out.push(words[i++])
  // 광역시는 시 다음에 바로 구가 온다 — 위에서 CITY 를 건너뛰고 DIST 로 잡힌다
  return out.length ? out.join(' ') : ''
}

/** 짧게 보일 이름 — '경상남도 창원시 의창구' → '창원시 의창구' */
export function shortPlace(name: string): string {
  const w = name.split(/\s+/)
  return w.length > 1 && PROVINCE.test(w[0]) ? w.slice(1).join(' ') : name
}

export type WeatherKind = 'clear' | 'night' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'thunder'

/** WMO 날씨 코드 → 말 · 그림(이모지) · 선 그림 종류 */
export function weatherText(code: number, isDay = true): { label: string; emoji: string; kind: WeatherKind } {
  if (code === 0) return { label: '맑음', emoji: isDay ? '☀️' : '🌙', kind: isDay ? 'clear' : 'night' }
  if (code === 1) return { label: '대체로 맑음', emoji: isDay ? '🌤️' : '🌙', kind: isDay ? 'partly' : 'night' }
  if (code === 2) return { label: '구름 조금', emoji: '⛅', kind: 'partly' }
  if (code === 3) return { label: '흐림', emoji: '☁️', kind: 'cloudy' }
  if (code === 45 || code === 48) return { label: '안개', emoji: '🌫️', kind: 'fog' }
  if (code >= 51 && code <= 57) return { label: '이슬비', emoji: '🌦️', kind: 'rain' }
  if (code === 66 || code === 67) return { label: '어는 비', emoji: '🌧️', kind: 'rain' }
  if (code >= 61 && code <= 65) return { label: code === 65 ? '강한 비' : '비', emoji: '🌧️', kind: 'rain' }
  if (code >= 80 && code <= 82) return { label: '소나기', emoji: '🌦️', kind: 'rain' }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: '눈', emoji: '🌨️', kind: 'snow' }
  if (code >= 95) return { label: '뇌우', emoji: '⛈️', kind: 'thunder' }
  return { label: '—', emoji: '🌡️', kind: 'cloudy' }
}

export type AirGrade = '좋음' | '보통' | '나쁨' | '매우 나쁨'

const gradeOf = (v: number, cuts: [number, number, number]): number => (v <= cuts[0] ? 0 : v <= cuts[1] ? 1 : v <= cuts[2] ? 2 : 3)
const GRADES: AirGrade[] = ['좋음', '보통', '나쁨', '매우 나쁨']

/** 미세먼지 · 초미세먼지 중 나쁜 쪽 등급 (값이 없으면 null) */
export function airGrade(pm10: number | null, pm25: number | null): AirGrade | null {
  const g = [pm10 == null ? -1 : gradeOf(pm10, [30, 80, 150]), pm25 == null ? -1 : gradeOf(pm25, [15, 35, 75])]
  const worst = Math.max(...g)
  return worst < 0 ? null : GRADES[worst]
}

/** 선생님께 알릴 것 — 우산 · 바깥 활동 · 더위 · 추위 (short 는 작은 위젯용) */
export function weatherTips(w: Weather): { short: string; long: string }[] {
  const tips: { short: string; long: string }[] = []
  const rainSoon = w.hours.slice(0, 10).some((h) => h.pop >= 60)
  if (w.now.code >= 51 && w.now.code <= 82) tips.push({ short: '비 와요', long: '지금 비가 와요 — 체육 · 바깥 활동은 실내로' })
  else if (rainSoon || w.today.pop >= 60) tips.push({ short: '우산 챙기기', long: '비 소식이 있어요 — 우산 챙기세요' })
  const g = airGrade(w.air.pm10, w.air.pm25)
  if (g === '나쁨' || g === '매우 나쁨') tips.push({ short: '바깥 활동 줄이기', long: `미세먼지 ${g} — 바깥 활동 줄이기` })
  if (w.today.max >= 33) tips.push({ short: '폭염', long: '폭염 — 물 · 그늘 챙기기' })
  else if (w.today.min <= -5) tips.push({ short: '한파', long: '한파 — 따뜻하게' })
  return tips
}

export function weatherTip(w: Weather): string {
  return weatherTips(w)
    .map((t) => t.long)
    .join(' · ')
}

type Json = Record<string, unknown>
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Open-Meteo forecast · air-quality 답 → Weather. 모양이 틀리면 null */
export function parseWeather(fc: unknown, aq: unknown, hoursAhead = 12): Weather | null {
  if (!fc || typeof fc !== 'object') return null
  const f = fc as Json
  const cur = f.current as Json | undefined
  const daily = f.daily as Json | undefined
  const hourly = f.hourly as Json | undefined
  if (!cur || !daily) return null
  const nowTime = String(cur.time ?? '')
  const day = (i: number): Weather['today'] | null =>
    arr(daily.time)[i] == null
      ? null
      : {
          max: num(arr(daily.temperature_2m_max)[i]),
          min: num(arr(daily.temperature_2m_min)[i]),
          pop: num(arr(daily.precipitation_probability_max)[i]),
          code: num(arr(daily.weather_code)[i])
        }
  const today = day(0)
  if (!today) return null
  const hours: WeatherHour[] = []
  if (hourly) {
    const times = arr(hourly.time).map(String)
    // 지금 시각이 든 시(時)부터
    const hourNow = nowTime.slice(0, 13)
    let start = times.findIndex((t) => t.slice(0, 13) >= hourNow)
    if (start < 0) start = 0
    for (let i = start; i < times.length && hours.length < hoursAhead; i++) {
      hours.push({
        time: `${times[i].slice(11, 13)}:00`,
        temp: num(arr(hourly.temperature_2m)[i]),
        code: num(arr(hourly.weather_code)[i]),
        pop: num(arr(hourly.precipitation_probability)[i])
      })
    }
  }
  const aqCur = (aq && typeof aq === 'object' ? ((aq as Json).current as Json | undefined) : undefined) ?? {}
  return {
    now: {
      temp: num(cur.temperature_2m),
      feels: num(cur.apparent_temperature, num(cur.temperature_2m)),
      code: num(cur.weather_code),
      humidity: num(cur.relative_humidity_2m),
      wind: num(cur.wind_speed_10m),
      isDay: num(cur.is_day, 1) === 1,
      time: nowTime
    },
    today,
    tomorrow: day(1),
    hours,
    air: { pm10: numOrNull(aqCur.pm10), pm25: numOrNull(aqCur.pm2_5) }
  }
}

/* ---------- D-Day ---------- */

export interface DDay {
  id: string
  title: string
  /** YYYY-MM-DD */
  date: string
}

export function parseDdays(raw: string): DDay[] {
  try {
    const v = JSON.parse(raw || '[]') as unknown
    if (!Array.isArray(v)) return []
    return v
      .filter((d): d is DDay => !!d && typeof d.title === 'string' && typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date))
      .map((d) => ({ id: typeof d.id === 'string' && d.id ? d.id : `${d.date}-${d.title}`, title: d.title.trim().slice(0, 40), date: d.date }))
      .filter((d) => d.title)
  } catch {
    return []
  }
}

/** 오늘에서 그날까지 며칠 (지났으면 음수) */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
}

/** 'D-12' · 'D-Day' · 'D+3' */
export function ddayLabel(date: string, today: string): string {
  const n = daysUntil(date, today)
  return n === 0 ? 'D-Day' : n > 0 ? `D-${n}` : `D+${-n}`
}

/** 다가오는 것 먼저(가까운 순), 지난 것은 뒤로(최근 순) */
export function sortDdays(list: DDay[], today: string): DDay[] {
  const up = list.filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  const past = list.filter((d) => d.date < today).sort((a, b) => b.date.localeCompare(a.date))
  return [...up, ...past]
}
