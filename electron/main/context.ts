/**
 * 업무 도우미가 이 학교의 급식 · 학사일정 · 내 시간표를 알고 답하도록, 질문에 맞는 것만 골라 근거로 싣는다.
 * 급식 · 학사일정은 나이스(학교를 연결했을 때), 시간표는 불러온 학교 시간표와 내가 고친 칸에서 온다.
 */

import type { NeisDay } from '../../shared/neis'
import { NEIS_MARK, addDays, scheduleToEvents } from '../../shared/neis'
import type { MyTimetable } from '../../shared/timetable'
import { MY_CLASS_KEY, TT_MANUAL_KEY, TT_ME_KEY, TT_TIMES_KEY, endOf, myTimetable, slotText, withTimes } from '../../shared/timetable'
import * as db from './db'
import { hasNeisKey, linkedSchool, mealsBetween, scheduleCached } from './neis'
import { loadTimetable } from './timetable'

export interface ContextSource {
  label: string
  text: string
  room: number
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const md = (day: string): string => {
  const d = new Date(`${day}T00:00:00`)
  return `${d.getMonth() + 1}. ${d.getDate()}.(${WEEK[d.getDay()]})`
}

/** 질문에 나온 날짜들. 못 찾으면 빈 배열 */
export function datesIn(q: string, today: string): string[] {
  const out = new Set<string>()
  const y = Number(today.slice(0, 4))
  if (/오늘/.test(q)) out.add(today)
  if (/내일/.test(q)) out.add(addDays(today, 1))
  if (/모레/.test(q)) out.add(addDays(today, 2))
  if (/어제/.test(q)) out.add(addDays(today, -1))
  const w = new Date(`${today}T00:00:00`).getDay()
  const monday = addDays(today, -((w + 6) % 7))
  const week = (start: string): void => {
    for (let i = 0; i < 5; i++) out.add(addDays(start, i))
  }
  if (/이번\s*주/.test(q)) week(monday)
  if (/다음\s*주/.test(q)) week(addDays(monday, 7))
  for (const m of q.matchAll(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) {
    const mm = Number(m[1])
    const dd = Number(m[2])
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) out.add(`${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`)
  }
  const dayWords = ['월', '화', '수', '목', '금']
  for (const m of q.matchAll(/(다음\s*주\s*)?([월화수목금])요일/g)) {
    const k = dayWords.indexOf(m[2])
    out.add(addDays(monday, k + (m[1] ? 7 : 0)))
  }
  return [...out].sort()
}

function timetableText(my: MyTimetable, length: number): string {
  const lines: string[] = []
  my.days.forEach((dn, d) => {
    const items = my.periods
      .map((p, i) => ({ p, s: my.grid[d][i] }))
      .filter((x) => x.s)
      .map((x) => `${x.p.no}교시${x.p.start ? `(${x.p.start}~${endOf(x.p, length)})` : ''} ${slotText(x.s)}`)
    lines.push(`${dn}: ${items.length ? items.join(', ') : '수업 없음'}`)
  })
  return lines.join('\n')
}

/** 질문에 맞는 학교 자료 */
export async function schoolContext(question: string, today: string): Promise<ContextSource[]> {
  const q = question
  const out: ContextSource[] = []
  const school = linkedSchool()

  if (school) {
    out.push({
      label: `학교 정보: ${school.name}`,
      text: `${school.name} (${school.atptName} · ${school.kind})\n주소: ${school.address}\n대표 전화: ${school.tel}\n누리집: ${school.homepage}`,
      room: 400
    })
  }

  if (school && /급식|점심|저녁|중식|석식|조식|메뉴|식단|반찬|밥|알레르기/.test(q)) {
    let days = datesIn(q, today)
    if (!days.length) days = [today, addDays(today, 1)]
    const from = days[0]
    const to = days[days.length - 1] > addDays(from, 13) ? addDays(from, 13) : days[days.length - 1]
    const got = await mealsBetween(from, to)
    const want = new Set(days)
    const lines = got
      .filter((g) => want.has(g.date) || days.length > 2)
      .map((g) =>
        !g.ok
          ? `${md(g.date)}: 받지 못함 (${g.error})`
          : !g.meals.length
            ? `${md(g.date)}: 급식 없음`
            : `${md(g.date)}\n${g.meals.map((m) => `- ${m.kind}: ${m.dishes.map((x) => x.name + (x.allergy ? `(${x.allergy})` : '')).join(', ')}${m.cal ? ` · ${m.cal}` : ''}`).join('\n')}`
      )
    if (lines.length) {
      out.push({
        label: `나이스 급식: ${md(from)}${to !== from ? ` ~ ${md(to)}` : ''}`,
        text: `${school.name} 급식 (괄호 안 숫자는 알레르기 유발 식품 번호: 1난류 2우유 3메밀 4땅콩 5대두 6밀 7고등어 8게 9새우 10돼지고기 11복숭아 12토마토 13아황산류 14호두 15닭고기 16쇠고기 17오징어 18조개류 19잣)\n${lines.join('\n')}`,
        room: 4000
      })
    }
  }

  if (/일정|학사|시험|고사|방학|휴업|개학|행사|축제|체육대회|수학여행|체험학습|졸업|입학|모의|평가|휴일|쉬는\s*날|언제/.test(q)) {
    const from = addDays(today, -14)
    const to = addDays(today, 150)
    let days: NeisDay[] = []
    let where = ''
    if (school && hasNeisKey()) {
      const r = await scheduleCached(from, to)
      if (r.ok) {
        days = r.data
        where = '나이스'
      }
    }
    let events = days.length ? scheduleToEvents(days, { skipSaturdayOff: true, skipHolidays: false, color: '' }) : []
    if (!events.length) {
      // 키가 없으면 달력에 가져와 둔 학사일정으로
      events = db.listEventsBetween(from, to).filter((e) => e.content.includes(NEIS_MARK))
      where = events.length ? '달력에 가져온 나이스' : ''
    }
    if (events.length) {
      const lines = events
        .slice(0, 120)
        .map((e) => `${md(e.event_date)}${e.end_date && e.end_date !== e.event_date ? ` ~ ${md(e.end_date)}` : ''} ${e.title}${/휴업일/.test(e.content) ? ' [휴업일]' : ''}`)
      out.push({
        label: `${where} 학사일정: ${md(from)} ~ ${md(to)}`,
        text: `오늘은 ${md(today)} 입니다.\n${lines.join('\n')}`,
        room: 5000
      })
    }
  }

  if (/시간표|교시|수업|공강|보강|교체|우리\s*반|담임\s*반/.test(q)) {
    const tt = loadTimetable()
    const me = db.getSetting(TT_ME_KEY, '')
    let manual: Record<string, string> = {}
    let times: { starts?: string[]; length?: number } = {}
    try {
      manual = JSON.parse(db.getSetting(TT_MANUAL_KEY, '') || '{}')
      times = JSON.parse(db.getSetting(TT_TIMES_KEY, '') || '{}')
    } catch {
      /* 깨진 값은 무시 */
    }
    const length = times.length || 50
    if ((tt && me) || Object.keys(manual).length) {
      const my = myTimetable(tt, me, manual)
      my.periods = withTimes(my.periods, times.starts ?? [])
      out.push({ label: '내 시간표', text: `요일별 내 수업 (반 과목)\n${timetableText(my, length)}`, room: 2500 })
    }
    const mine = db.getSetting(MY_CLASS_KEY, '')
    const cls = tt?.classes.find((c) => c.id === mine)
    if (tt && cls) {
      const lines = tt.days.map(
        (dn, d) => `${dn}: ${cls.grid[d].map((x, p) => (x ? `${p + 1}교시 ${x.group ? `${x.group}_` : ''}${x.subject}` : '')).filter(Boolean).join(', ')}`
      )
      out.push({ label: `우리 반 시간표: ${mine}`, text: lines.join('\n'), room: 2000 })
    }
  }

  return out
}
