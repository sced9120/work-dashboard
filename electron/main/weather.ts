/**
 * 날씨 위젯 — Open-Meteo(날씨 · 미세먼지, 키 없음)와 OpenStreetMap Nominatim(지역 이름 → 좌표).
 *
 * 보내는 것은 좌표(소수 둘째 자리까지, 1km 쯤) 와 지역 이름뿐이다. 학교 주소는 시 · 군 · 구까지만 잘라 보낸다.
 * Nominatim 은 1초에 한 번 · 앱 이름을 밝히라는 약속이 있어, 찾은 좌표는 DB 설정에 두고 다시 묻지 않는다.
 */

import { app } from 'electron'
import type { NeisSchool } from '../../shared/neis'
import { NEIS_SCHOOL_KEY } from '../../shared/neis'
import type { WeatherPlace, WeatherResult } from '../../shared/weather'
import { parseWeather, regionOf } from '../../shared/weather'
import * as db from './db'
import { httpFetch } from './http'

const TIMEOUT = 10000
/** 같은 자리는 15분 안에 다시 묻지 않는다 */
const FRESH_MS = 15 * 60 * 1000

const cache = new Map<string, { at: number; r: WeatherResult }>()

async function getJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const res = await httpFetch(url, { signal: ctrl.signal, headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

const round2 = (v: number): string => (Math.round(v * 100) / 100).toFixed(2)

export async function weatherAt(lat: number, lon: number, force = false): Promise<WeatherResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { ok: false, error: '자리가 맞지 않습니다.' }
  const key = `${round2(lat)},${round2(lon)}`
  const hit = cache.get(key)
  if (!force && hit && hit.r.ok && Date.now() - hit.at < FRESH_MS) return hit.r
  const at = { latitude: round2(lat), longitude: round2(lon), timezone: 'Asia/Seoul' }
  const fq = new URLSearchParams({
    ...at,
    current: 'temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
    forecast_days: '2',
    wind_speed_unit: 'ms'
  })
  const aq = new URLSearchParams({ ...at, current: 'pm10,pm2_5' })
  let r: WeatherResult
  try {
    const [f, a] = await Promise.all([
      getJson(`https://api.open-meteo.com/v1/forecast?${fq.toString()}`),
      // 미세먼지는 못 받아도 날씨는 보인다
      getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${aq.toString()}`).catch(() => null)
    ])
    const data = parseWeather(f, a)
    r = data ? { ok: true, data } : { ok: false, error: '날씨 서버가 알 수 없는 답을 보냈습니다.' }
  } catch {
    r = { ok: false, error: '날씨를 받지 못했습니다. 인터넷이 되는지, 학교망에서 막히지 않았는지 확인해 주세요.' }
  }
  if (!r.ok && hit?.r.ok) return hit.r // 잠깐 끊겨도 앞서 받은 것을 보인다
  cache.set(key, { at: Date.now(), r })
  return r
}

let lastNominatim = 0

/** 지역 이름으로 찾기 (대한민국 안) */
export async function searchPlaces(q: string): Promise<{ ok: boolean; places: WeatherPlace[]; error?: string }> {
  const name = q.trim().slice(0, 60)
  if (!name) return { ok: true, places: [] }
  // 1초에 한 번
  const wait = lastNominatim + 1100 - Date.now()
  if (wait > 0) await new Promise((s) => setTimeout(s, wait))
  lastNominatim = Date.now()
  try {
    const v = await getJson(
      `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: name, format: 'jsonv2', limit: '6', countrycodes: 'kr', 'accept-language': 'ko' }).toString()}`,
      { 'User-Agent': `work-dashboard/${app.getVersion()} (weather widget; github.com/sced9120/work-dashboard)` }
    )
    const places: WeatherPlace[] = (Array.isArray(v) ? v : [])
      .map((x: Record<string, unknown>) => ({
        // '의창구, 창원시, 경상남도, 대한민국' → '경상남도 창원시 의창구'
        name: String(x.display_name ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s && s !== '대한민국' && !/^\d{5}$/.test(s))
          .slice(0, 4)
          .reverse()
          .join(' '),
        lat: Number(x.lat),
        lon: Number(x.lon),
        from: 'pick' as const
      }))
      .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon))
    return { ok: true, places }
  } catch {
    return { ok: false, places: [], error: '지역을 찾지 못했습니다. 인터넷 연결을 확인해 주세요.' }
  }
}

/** 나이스에 연결한 학교 주소의 시 · 군 · 구 자리 (연결 안 했거나 못 찾으면 null) */
export async function schoolPlace(): Promise<WeatherPlace | null> {
  let school: NeisSchool | null = null
  try {
    school = JSON.parse(db.getSetting(NEIS_SCHOOL_KEY, '') || 'null') as NeisSchool | null
  } catch {
    school = null
  }
  const region = regionOf(school?.address ?? '')
  if (!region) return null
  // 구까지 → 시 · 군까지 → 시도만 차례로 줄여 찾는다
  const words = region.split(' ')
  for (let n = words.length; n >= 1; n--) {
    const r = await searchPlaces(words.slice(0, n).join(' '))
    if (r.places[0]) return { name: words.slice(0, n).join(' '), lat: r.places[0].lat, lon: r.places[0].lon, from: 'school' }
    if (!r.ok) return null
  }
  return null
}
