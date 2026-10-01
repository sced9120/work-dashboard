import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MyTimetable, SchoolTimetable } from '../../shared/timetable'
import { MY_CLASS_KEY, TT_MANUAL_KEY, TT_ME_KEY, TT_TIMES_KEY, myTimetable, withTimes } from '../../shared/timetable'

/** 과목 이름을 바꿔 보이기 { 수학: '공통수학' } */
export const TT_ALIAS_KEY = 'timetable_alias'

export interface TimesSetting {
  starts: string[]
  /** 수업 길이(분) */
  length: number
}

function parse<T>(raw: string, fallback: T): T {
  try {
    const v = JSON.parse(raw || 'null') as T | null
    return v ?? fallback
  } catch {
    return fallback
  }
}

export interface TimetableState {
  loaded: boolean
  tt: SchoolTimetable | null
  me: string
  manual: Record<string, string>
  times: TimesSetting
  alias: Record<string, string>
  myClass: string
  /** 학교 시간표 + 손으로 고친 칸 + 교시 시각 + 과목 이름 바꾸기를 모두 얹은 내 시간표. 아무것도 없으면 null */
  my: MyTimetable | null
  reload: () => Promise<void>
  save: (key: string, value: unknown) => Promise<void>
}

/** 시간표 화면 · 홈 위젯이 함께 쓰는 내 시간표 */
export function useTimetable(): TimetableState {
  const [loaded, setLoaded] = useState(false)
  const [tt, setTt] = useState<SchoolTimetable | null>(null)
  const [me, setMe] = useState('')
  const [manual, setManual] = useState<Record<string, string>>({})
  const [times, setTimes] = useState<TimesSetting>({ starts: [], length: 50 })
  const [alias, setAlias] = useState<Record<string, string>>({})
  const [myClass, setMyClass] = useState('')

  const reload = useCallback(async () => {
    const [t, m, man, tm, al, mc] = await Promise.all([
      window.api.tt.get(),
      window.api.setting.get(TT_ME_KEY),
      window.api.setting.get(TT_MANUAL_KEY),
      window.api.setting.get(TT_TIMES_KEY),
      window.api.setting.get(TT_ALIAS_KEY),
      window.api.setting.get(MY_CLASS_KEY)
    ])
    setTt(t)
    setMe(m)
    setManual(parse(man, {}))
    const ts = parse<Partial<TimesSetting>>(tm, {})
    setTimes({ starts: Array.isArray(ts.starts) ? ts.starts : [], length: Number(ts.length) || 50 })
    setAlias(parse(al, {}))
    setMyClass(mc)
    setLoaded(true)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const save = useCallback(
    async (key: string, value: unknown) => {
      await window.api.setting.set(key, typeof value === 'string' ? value : JSON.stringify(value))
      await reload()
    },
    [reload]
  )

  const my = useMemo(() => {
    if (!(tt && me) && !Object.keys(manual).length) return null
    const base = myTimetable(tt, me, manual)
    return {
      ...base,
      periods: withTimes(base.periods, times.starts),
      grid: base.grid.map((col) => col.map((s) => (s && !s.manual && alias[s.subject] ? { ...s, subject: alias[s.subject] } : s)))
    }
  }, [tt, me, manual, times, alias])

  return { loaded, tt, me, manual, times, alias, myClass, my, reload, save }
}

/** 오늘 요일 칸(월=0, 주말은 -1)과 지금 시각 HH:MM */
export function nowInfo(): { day: number; hhmm: string } {
  const d = new Date()
  const w = d.getDay()
  return {
    day: w >= 1 && w <= 6 ? w - 1 : -1,
    hhmm: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
}
