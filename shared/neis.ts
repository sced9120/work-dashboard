/**
 * 나이스 교육정보 개방 포털(open.neis.go.kr) Open API 로 받는 학교 공개 자료.
 *
 * 학교 기본정보 · 급식 · 학사일정처럼 누구나 볼 수 있는 자료만 다룬다. 학생 개인정보는 오가지 않는다.
 * 인증키가 없어도 부를 수 있지만 한 번에 5건까지만 준다(다음 쪽을 달라고 해도 첫 5건을 되풀이한다).
 * 그래서 학교 찾기 · 오늘 급식은 키 없이 되고, 한 해치 학사일정은 키가 있어야 한다.
 *
 * 여기 있는 것은 받은 자료를 다듬는 함수뿐이다. 부르는 일은 electron/main/neis.ts 가 한다.
 */

import type { CalEventInput } from './types'

export const NEIS_PORTAL = 'https://open.neis.go.kr'
/** 인증키 신청 화면 (로그인 필요) */
export const NEIS_KEY_PAGE = 'https://open.neis.go.kr/portal/guide/actKeyPage.do'

/** 연결한 학교를 담아 두는 설정 이름. 인수인계 파일에 함께 넘어간다(다음 담당자도 같은 학교). */
export const NEIS_SCHOOL_KEY = 'neis_school'

/** 키 없이 부르면 한 번에 받을 수 있는 건수 */
export const KEYLESS_ROWS = 5

export interface NeisSchool {
  /** 시도교육청 코드 (예: S10) */
  atpt: string
  /** 예: 경상남도교육청 */
  atptName: string
  /** 행정표준코드 */
  code: string
  name: string
  /** 예: 고등학교 */
  kind: string
  address: string
  tel: string
  homepage: string
}

export interface NeisDish {
  name: string
  /** 알레르기 유발 식품 번호 (예: 1.5.6) */
  allergy: string
}

export interface NeisMeal {
  /** 조식 · 중식 · 석식 */
  kind: string
  dishes: NeisDish[]
  /** 예: 812.3 Kcal */
  cal: string
  /** 급식 인원 */
  count: number
}

export interface NeisMealDay {
  ok: boolean
  /** YYYY-MM-DD */
  date: string
  meals: NeisMeal[]
  error?: string
}

/** 학사일정 하루치 한 줄 */
export interface NeisDay {
  /** YYYY-MM-DD */
  date: string
  name: string
  content: string
  /** 수업공제일 구분: 휴업일 · 공휴일 · 해당없음 */
  off: string
  /** 몇 학년 행사인지. 모든 학년이면 빈 문자열 */
  grades: string
}

/** 나이스 학급 시간표 한 칸 */
export interface NeisLesson {
  /** YYYY-MM-DD */
  date: string
  period: number
  subject: string
}

export interface NeisResult<T> {
  ok: boolean
  data: T
  error?: string
}

/** 알레르기 번호 표 (학교 급식 표준) */
export const ALLERGY: Record<string, string> = {
  '1': '난류',
  '2': '우유',
  '3': '메밀',
  '4': '땅콩',
  '5': '대두',
  '6': '밀',
  '7': '고등어',
  '8': '게',
  '9': '새우',
  '10': '돼지고기',
  '11': '복숭아',
  '12': '토마토',
  '13': '아황산류',
  '14': '호두',
  '15': '닭고기',
  '16': '쇠고기',
  '17': '오징어',
  '18': '조개류',
  '19': '잣'
}

export function ymd(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 2026-10-01 → 20261001 */
export const compact = (day: string): string => day.replace(/-/g, '')
/** 20261001 → 2026-10-01 */
export const dashed = (v: string): string => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + n)
  return ymd(d)
}

/** "돈육순두부찌개 (1.5.6.9.10)<br/>깍두기 (9)" → 요리 목록 */
export function parseDishes(raw: string): NeisDish[] {
  return raw
    .split(/<br\s*\/?>/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(.*?)\s*\(([\d.\s]+)\)\s*$/)
      const name = (m ? m[1] : s).replace(/\s+/g, ' ').trim()
      const allergy = m ? m[2].replace(/\s+/g, '').replace(/\.+$/, '') : ''
      return { name, allergy }
    })
    .filter((d) => d.name)
}

export function allergyNames(code: string): string {
  return code
    .split('.')
    .filter(Boolean)
    .map((n) => ALLERGY[n] ?? n)
    .join(', ')
}

const MEAL_ORDER: Record<string, number> = { 조식: 0, 중식: 1, 석식: 2 }

export function sortMeals(meals: NeisMeal[]): NeisMeal[] {
  return [...meals].sort((a, b) => (MEAL_ORDER[a.kind] ?? 9) - (MEAL_ORDER[b.kind] ?? 9))
}

/** 오늘이 든 학년도(3월 ~ 이듬해 2월)의 첫날·끝날 */
export function schoolYearRange(today: string): { from: string; to: string; year: number } {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const year = m >= 3 ? y : y - 1
  const end = new Date(year + 1, 2, 0) // 이듬해 2월 끝날
  return { from: `${year}-03-01`, to: ymd(end), year }
}

const isWeekend = (day: string): boolean => {
  const w = new Date(`${day}T00:00:00`).getDay()
  return w === 0 || w === 6
}

export interface ScheduleOptions {
  /** 토요휴업일은 해마다 모든 토요일에 붙어 있어 달력만 어지럽힌다 */
  skipSaturdayOff: boolean
  /** 공휴일은 달력에 이미 빨갛게 뜬다 */
  skipHolidays: boolean
  color: string
}

/** 달력에 넣을 후보 한 건 */
export interface ScheduleItem {
  event: CalEventInput
  /** 같은 날 같은 이름의 일정이 이미 달력에 있다 */
  exists: boolean
}

export const NEIS_MARK = '나이스 학사일정에서 가져옴'

/**
 * 나이스 학사일정을 달력 일정으로 바꾼다.
 * 이름이 같은 일정이 날짜로 이어지면(주말을 건너뛰어도) 여러 날짜리 일정 하나로 묶는다.
 * 예) 2학기 기말고사 12/8·12/9·12/10 → 12/8 ~ 12/10 하나
 */
export function scheduleToEvents(days: NeisDay[], opt: ScheduleOptions): CalEventInput[] {
  const kept = days
    .filter((d) => d.name.trim())
    .filter((d) => !(opt.skipSaturdayOff && /토요\s*휴업/.test(d.name)))
    .filter((d) => !(opt.skipHolidays && d.off === '공휴일'))
    .sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date.localeCompare(b.date)))

  const out: CalEventInput[] = []
  /** 이름(+학년) → 지금 이어 붙이는 중인 일정 */
  const open = new Map<string, CalEventInput>()
  for (const d of kept) {
    const title = d.grades ? `${d.name.trim()} (${d.grades})` : d.name.trim()
    const cur = open.get(title)
    if (cur) {
      let gapOk = true
      for (let day = addDays(cur.end_date, 1); day < d.date; day = addDays(day, 1)) {
        if (!isWeekend(day)) {
          gapOk = false
          break
        }
      }
      if (d.date === cur.end_date) continue
      if (gapOk) {
        cur.end_date = d.date
        continue
      }
    }
    const content = [d.content.trim(), d.off && d.off !== '해당없음' ? `${d.off}` : '', NEIS_MARK]
      .filter(Boolean)
      .join('\n')
    const ev: CalEventInput = {
      event_date: d.date,
      end_date: d.date,
      start_time: '',
      title,
      content,
      color: opt.color,
      remind: 0,
      done: 0
    }
    out.push(ev)
    open.set(title, ev)
  }
  return out
}

/** "Y" 인 학년만 모아 "1·2학년" 처럼. 모든 학년이거나 알 수 없으면 빈 문자열 */
export function gradesOf(flags: string[]): string {
  const on: number[] = []
  let known = 0
  flags.forEach((f, i) => {
    if (f === 'Y' || f === 'N') known++
    if (f === 'Y') on.push(i + 1)
  })
  if (!known || on.length === 0 || on.length === known) return ''
  return `${on.join('·')}학년`
}
