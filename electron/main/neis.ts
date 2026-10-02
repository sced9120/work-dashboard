/**
 * 나이스 교육정보 개방 포털 Open API 부르기 (자료 모양은 shared/neis.ts).
 *
 * 보내는 것은 학교 코드 · 날짜 · 인증키뿐이다. 인증키는 AI 키처럼 이 PC 에만(설정 파일, 암호화) 두고,
 * 연결한 학교는 DB 설정에 두어 인수인계 파일로 넘어가게 한다.
 */

import type { NeisDay, NeisLesson, NeisMeal, NeisMealDay, NeisResult, NeisSchool } from '../../shared/neis'
import { NEIS_SCHOOL_KEY, addDays, compact, dashed, gradesOf, parseDishes, sortMeals } from '../../shared/neis'
import * as db from './db'
import { httpFetch } from './http'
import { loadLocalSettings } from './secrets'

const HUB = 'https://open.neis.go.kr/hub/'
const TIMEOUT = 10000

type Row = Record<string, unknown>

class NeisError extends Error {}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

function explain(code: string, message: string): string {
  if (code === 'ERROR-290') return '나이스 인증키가 맞지 않습니다. [설정 → 나이스 연결] 에서 키를 다시 확인해 주세요.'
  if (code === 'ERROR-337') return '오늘 나이스에 부를 수 있는 양을 넘었습니다. 내일 다시 해 주세요.'
  if (code === 'INFO-300') return '나이스에서 이 인증키를 쓰지 못하게 막았습니다. 포털의 마이페이지를 확인해 주세요.'
  if (code === 'ERROR-500' || code === 'ERROR-600') return '나이스 서버에 문제가 있습니다. 잠시 뒤 다시 해 주세요.'
  return message || `나이스가 오류를 돌려주었습니다(${code}).`
}

/**
 * Open API 하나를 부른다. 자료가 없으면(INFO-200) 빈 배열.
 * 인증키가 있으면 한 번에 1000건, 없으면 5건까지 온다.
 */
async function hub(service: string, params: Record<string, string>, size = 1000): Promise<Row[]> {
  const key = loadLocalSettings().neis_key.trim()
  const q = new URLSearchParams({ Type: 'json', pIndex: '1', pSize: String(size), ...params })
  if (key) q.set('KEY', key)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
  let res: Response
  try {
    res = await httpFetch(`${HUB}${service}?${q.toString()}`, { signal: ctrl.signal })
  } catch {
    throw new NeisError('나이스에 연결하지 못했습니다. 인터넷이 되는지, 학교망에서 막히지 않았는지 확인해 주세요.')
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new NeisError(`나이스가 응답하지 않습니다(HTTP ${res.status}). 잠시 뒤 다시 해 주세요.`)
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new NeisError('나이스가 알 수 없는 답을 보냈습니다.')
  }
  const obj = body as Record<string, unknown>
  const top = obj.RESULT as { CODE?: string; MESSAGE?: string } | undefined
  if (top?.CODE) {
    if (top.CODE === 'INFO-200') return []
    throw new NeisError(explain(top.CODE, str(top.MESSAGE)))
  }
  const part = obj[service] as { head?: Row[]; row?: Row[] }[] | undefined
  if (!Array.isArray(part)) throw new NeisError('나이스가 알 수 없는 답을 보냈습니다.')
  const head = part[0]?.head ?? []
  const result = head.find((h) => 'RESULT' in h)?.RESULT as { CODE?: string; MESSAGE?: string } | undefined
  if (result?.CODE && result.CODE !== 'INFO-000') {
    if (result.CODE === 'INFO-200') return []
    throw new NeisError(explain(result.CODE, str(result.MESSAGE)))
  }
  return part[1]?.row ?? []
}

const fail = <T>(data: T, e: unknown): NeisResult<T> => ({
  ok: false,
  data,
  error: e instanceof NeisError ? e.message : e instanceof Error ? e.message : String(e)
})

export function hasNeisKey(): boolean {
  return !!loadLocalSettings().neis_key.trim()
}

export function linkedSchool(): NeisSchool | null {
  try {
    const v = JSON.parse(db.getSetting(NEIS_SCHOOL_KEY, '') || 'null') as NeisSchool | null
    return v && v.atpt && v.code ? v : null
  } catch {
    return null
  }
}

/**
 * 문서를 만들 때 AI 에게 알려 줄 학교 기본정보 한 덩어리. 연결한 학교가 없으면 빈 문자열.
 * 가정통신문의 학교 주소 · 대표 전화 · 문의처 줄을 채우게 한다.
 */
export function schoolInfoForDocs(): string {
  const s = linkedSchool()
  if (!s) return ''
  return [
    `학교 기본정보(나이스): ${s.name} · ${s.atptName}`,
    s.address ? `주소: ${s.address}` : '',
    s.tel ? `대표 전화: ${s.tel}` : '',
    s.homepage ? `누리집: ${s.homepage}` : '',
    '문서에 학교 이름 · 주소 · 대표 전화 · 누리집을 적을 자리가 있으면 이 정보를 쓰세요. 담당자 개인 연락처는 지어내지 마세요.'
  ]
    .filter(Boolean)
    .join('\n')
}

function toSchool(r: Row): NeisSchool {
  return {
    atpt: str(r.ATPT_OFCDC_SC_CODE),
    atptName: str(r.ATPT_OFCDC_SC_NM),
    code: str(r.SD_SCHUL_CODE),
    name: str(r.SCHUL_NM),
    kind: str(r.SCHUL_KND_SC_NM),
    address: `${str(r.ORG_RDNMA)} ${str(r.ORG_RDNDA)}`.trim(),
    tel: str(r.ORG_TELNO),
    homepage: str(r.HMPG_ADRES)
  }
}

/** 학교 이름으로 찾기. 키가 없으면 5곳까지 */
export async function searchSchools(name: string): Promise<NeisResult<NeisSchool[]>> {
  const q = name.trim()
  if (q.length < 2) return { ok: false, data: [], error: '학교 이름을 두 글자 이상 적어 주세요.' }
  try {
    const rows = await hub('schoolInfo', { SCHUL_NM: q }, 30)
    return { ok: true, data: rows.map(toSchool) }
  } catch (e) {
    return fail([], e)
  }
}

/** 급식은 하루에 여러 번 부를 일이 없어 한 시간 동안 들고 있는다 */
const mealCache = new Map<string, { at: number; meals: NeisMeal[] }>()
const MEAL_TTL = 60 * 60 * 1000

function toMeal(r: Row): NeisMeal {
  return {
    kind: str(r.MMEAL_SC_NM),
    dishes: parseDishes(str(r.DDISH_NM)),
    cal: str(r.CAL_INFO).trim(),
    count: Number(r.MLSV_FGR) || 0
  }
}

/** 하루치 급식 (조식·중식·석식) */
export async function mealsOn(day: string): Promise<NeisMealDay> {
  const school = linkedSchool()
  if (!school) return { ok: false, date: day, meals: [], error: '연결한 학교가 없습니다.' }
  const cacheKey = `${school.code}:${day}`
  const hit = mealCache.get(cacheKey)
  if (hit && Date.now() - hit.at < MEAL_TTL) return { ok: true, date: day, meals: hit.meals }
  try {
    const rows = await hub('mealServiceDietInfo', {
      ATPT_OFCDC_SC_CODE: school.atpt,
      SD_SCHUL_CODE: school.code,
      MLSV_YMD: compact(day)
    }, 10)
    const meals = sortMeals(rows.map(toMeal))
    mealCache.set(cacheKey, { at: Date.now(), meals })
    return { ok: true, date: day, meals }
  } catch (e) {
    return { ok: false, date: day, meals: [], error: fail(null, e).error }
  }
}

/**
 * from 이후로 급식이 있는 첫날. 주말·방학을 건너뛸 때 쓴다.
 * 날짜 차례로 오므로 키가 없어도(5건) 첫날 것은 받는다.
 */
export async function nextMealDay(from: string, dir: 1 | -1 = 1): Promise<NeisMealDay> {
  const school = linkedSchool()
  if (!school) return { ok: false, date: from, meals: [], error: '연결한 학교가 없습니다.' }
  if (dir === -1) {
    // 뒤로 갈 때는 하루씩 (키 없이 받는 5건이 앞쪽부터 오기 때문)
    for (let i = 1, day = addDays(from, -1); i <= 21; i++, day = addDays(day, -1)) {
      const r = await mealsOn(day)
      if (!r.ok || r.meals.length) return r
    }
    return { ok: true, date: addDays(from, -1), meals: [] }
  }
  try {
    const start = addDays(from, 1)
    const rows = await hub('mealServiceDietInfo', {
      ATPT_OFCDC_SC_CODE: school.atpt,
      SD_SCHUL_CODE: school.code,
      MLSV_FROM_YMD: compact(start),
      MLSV_TO_YMD: compact(addDays(from, 45))
    }, 30)
    if (!rows.length) return { ok: true, date: start, meals: [] }
    const first = rows.map((r) => str(r.MLSV_YMD)).sort()[0]
    const meals = sortMeals(rows.filter((r) => str(r.MLSV_YMD) === first).map(toMeal))
    const day = dashed(first)
    mealCache.set(`${school.code}:${day}`, { at: Date.now(), meals })
    return { ok: true, date: day, meals }
  } catch (e) {
    return { ok: false, date: from, meals: [], error: fail(null, e).error }
  }
}

/** 학사일정. 한 해치는 5건을 넘으므로 인증키가 있어야 한다 */
export async function schedule(from: string, to: string): Promise<NeisResult<NeisDay[]>> {
  const school = linkedSchool()
  if (!school) return { ok: false, data: [], error: '연결한 학교가 없습니다. [설정 → 나이스 연결] 에서 학교를 먼저 고르세요.' }
  if (!hasNeisKey()) {
    return { ok: false, data: [], error: '학사일정을 한꺼번에 받으려면 나이스 인증키가 필요합니다. [설정 → 나이스 연결] 에서 넣어 주세요.' }
  }
  try {
    const rows = await hub('SchoolSchedule', {
      ATPT_OFCDC_SC_CODE: school.atpt,
      SD_SCHUL_CODE: school.code,
      AA_FROM_YMD: compact(from),
      AA_TO_YMD: compact(to)
    })
    const days: NeisDay[] = rows.map((r) => ({
      date: dashed(str(r.AA_YMD)),
      name: str(r.EVENT_NM).trim(),
      content: str(r.EVENT_CNTNT).trim(),
      off: str(r.SBTR_DD_SC_NM).trim(),
      grades: gradesOf([
        str(r.ONE_GRADE_EVENT_YN),
        str(r.TW_GRADE_EVENT_YN),
        str(r.THREE_GRADE_EVENT_YN),
        str(r.FR_GRADE_EVENT_YN),
        str(r.FIV_GRADE_EVENT_YN),
        str(r.SIX_GRADE_EVENT_YN)
      ])
    }))
    return { ok: true, data: days }
  } catch (e) {
    return fail([], e)
  }
}

/** 홈 · 도우미가 자주 부르므로 학사일정은 여섯 시간 들고 있는다 */
const scheduleCache = new Map<string, { at: number; data: NeisDay[] }>()
const SCHEDULE_TTL = 6 * 60 * 60 * 1000

export async function scheduleCached(from: string, to: string): Promise<NeisResult<NeisDay[]>> {
  const school = linkedSchool()
  const k = `${school?.code}:${from}:${to}`
  const hit = scheduleCache.get(k)
  if (hit && Date.now() - hit.at < SCHEDULE_TTL) return { ok: true, data: hit.data }
  const r = await schedule(from, to)
  if (r.ok) scheduleCache.set(k, { at: Date.now(), data: r.data })
  return r
}

/** 여러 날 급식. 키가 있으면 한 번에, 없으면 하루씩(최대 7일) */
export async function mealsBetween(from: string, to: string): Promise<NeisMealDay[]> {
  const school = linkedSchool()
  if (!school) return []
  const days: string[] = []
  for (let d = from; d <= to && days.length < 14; d = addDays(d, 1)) days.push(d)
  if (!hasNeisKey()) {
    const out: NeisMealDay[] = []
    for (const d of days.slice(0, 7)) out.push(await mealsOn(d))
    return out
  }
  try {
    const rows = await hub('mealServiceDietInfo', {
      ATPT_OFCDC_SC_CODE: school.atpt,
      SD_SCHUL_CODE: school.code,
      MLSV_FROM_YMD: compact(from),
      MLSV_TO_YMD: compact(to)
    }, 100)
    return days.map((d) => {
      const meals = sortMeals(rows.filter((r) => str(r.MLSV_YMD) === compact(d)).map(toMeal))
      mealCache.set(`${school.code}:${d}`, { at: Date.now(), meals })
      return { ok: true, date: d, meals }
    })
  } catch (e) {
    return [{ ok: false, date: from, meals: [], error: fail(null, e).error }]
  }
}

/** 학교 종류에 맞는 나이스 시간표 이름 */
function timetableService(kind: string): string {
  if (kind.includes('초등')) return 'elsTimetable'
  if (kind.includes('중학')) return 'misTimetable'
  if (kind.includes('특수')) return 'spsTimetable'
  return 'hisTimetable'
}

const lessonCache = new Map<string, { at: number; data: NeisLesson[] }>()

/** 학급 시간표(나이스). 한 주가 5건을 넘어 키가 있어야 한다 */
export async function classTimetable(grade: number, cls: number, from: string, to: string): Promise<NeisResult<NeisLesson[]>> {
  const school = linkedSchool()
  if (!school) return { ok: false, data: [], error: '연결한 학교가 없습니다.' }
  if (!hasNeisKey()) return { ok: false, data: [], error: '학급 시간표는 한 주가 5건을 넘어 나이스 인증키가 있어야 받을 수 있습니다.' }
  const k = `${school.code}:${grade}-${cls}:${from}:${to}`
  const hit = lessonCache.get(k)
  if (hit && Date.now() - hit.at < SCHEDULE_TTL) return { ok: true, data: hit.data }
  try {
    const rows = await hub(timetableService(school.kind), {
      ATPT_OFCDC_SC_CODE: school.atpt,
      SD_SCHUL_CODE: school.code,
      GRADE: String(grade),
      CLASS_NM: String(cls),
      TI_FROM_YMD: compact(from),
      TI_TO_YMD: compact(to)
    })
    const data = rows
      .map((r) => ({ date: dashed(str(r.ALL_TI_YMD)), period: Number(r.PERIO) || 0, subject: str(r.ITRT_CNTNT).replace(/^-\s*/, '').trim() }))
      .filter((x) => x.period > 0 && x.subject)
    lessonCache.set(k, { at: Date.now(), data })
    return { ok: true, data }
  } catch (e) {
    return fail([], e)
  }
}

/** [연결 확인] — 연결한 학교(없으면 아무 학교)를 한 번 불러 본다 */
export async function testNeis(): Promise<{ ok: boolean; message: string }> {
  const school = linkedSchool()
  try {
    const rows = await hub('schoolInfo', school ? { ATPT_OFCDC_SC_CODE: school.atpt, SD_SCHUL_CODE: school.code } : { SCHUL_NM: '고등학교' }, hasNeisKey() ? 10 : 5)
    const who = school ? `${school.name}` : '나이스'
    if (hasNeisKey()) return { ok: true, message: `인증키로 ${who}에 연결했습니다(${rows.length}건 받음). 학사일정도 받을 수 있습니다.` }
    return { ok: true, message: `${who}에 연결했습니다. 인증키가 없어 한 번에 5건까지만 받습니다(학교 찾기 · 오늘 급식은 됩니다).` }
  } catch (e) {
    return { ok: false, message: fail(null, e).error ?? '연결하지 못했습니다.' }
  }
}

/** 학교를 바꾸면 전 학교의 급식을 들고 있지 않는다 */
export function clearNeisCache(): void {
  mealCache.clear()
  scheduleCache.clear()
  lessonCache.clear()
}
