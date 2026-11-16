/**
 * 상담 기록 저장 — settings 표의 counsel_<학년도> / counsel_meta 줄.
 * 'counsel_' 로 시작하는 줄은 인수인계 파일에 넣지 않는다(db.exportTo). 이 PC 의 백업에는 DB 통째라 들어간다.
 * 상담 예정은 달력 일정으로도 만든다 — 제목은 이름 없이 '상담 — 3번'(일정은 .ics 로 내보낼 수 있어서).
 */
import * as db from './db'
import {
  COUNSEL_META_KEY,
  cleanPlan,
  cleanRecord,
  counselKey,
  isCounselYearKey,
  planTitle,
  readMeta,
  readStore,
  schoolYearOf,
  type CounselMeta,
  type CounselPlan,
  type CounselRecord,
  type CounselStore,
  type PlanInput,
  type RecordInput
} from '../../shared/counsel'

export interface CounselLoad {
  year: number
  years: number[]
  records: CounselRecord[]
  plans: CounselPlan[]
  meta: CounselMeta
}

const nowStr = (): string => new Date().toISOString().slice(0, 19).replace('T', ' ')

const readYear = (year: number): CounselStore => readStore(db.getSetting(counselKey(year), ''))
const writeYear = (year: number, s: CounselStore): void => {
  if (!s.records.length && !s.plans.length) db.setSetting(counselKey(year), '')
  else db.setSetting(counselKey(year), JSON.stringify(s))
}

function yearsStored(): number[] {
  return db
    .settingsByPrefix('counsel_')
    .map((r) => r.key)
    .filter(isCounselYearKey)
    .map((k) => Number(k.slice(8)))
    .sort((a, b) => b - a)
}

const saveError = (message: string): { ok: false; message: string } => ({ ok: false, message })

/** 달력에서 지워진 일정은 예정에서 연결만 끊는다 */
function syncEventIds(plans: CounselPlan[]): CounselPlan[] {
  if (!plans.some((p) => p.eventId)) return plans
  const alive = new Set(db.listEvents().map((e) => e.id))
  return plans.map((p) => {
    if (!p.eventId || alive.has(p.eventId)) return p
    const { eventId: _gone, ...rest } = p
    return rest
  })
}

export function counselLoad(year?: number): CounselLoad {
  const today = new Date()
  const y = Number.isInteger(year) && (year as number) > 2000 ? (year as number) : schoolYearOf(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`)
  const s = readYear(y)
  const years = Array.from(new Set([...yearsStored(), y])).sort((a, b) => b - a)
  return { year: y, years, records: s.records, plans: syncEventIds(s.plans), meta: readMeta(db.getSetting(COUNSEL_META_KEY, '')) }
}

/** 기록 저장(새로 · 고치기). planId 가 오면 그 예정은 '했음' 으로 보고 지운다(달력 일정도) */
export function counselSave(input: RecordInput, planId?: string): { ok: true; record: CounselRecord } | { ok: false; message: string } {
  const now = nowStr()
  // 날짜를 다른 학년도로 옮겨 고칠 수 있으니 같은 번호 기록을 모든 학년도에서 찾는다
  let prev: CounselRecord | undefined
  let prevYear = 0
  if (input?.id) {
    for (const y of yearsStored()) {
      const f = readYear(y).records.find((r) => r.id === input.id)
      if (f) {
        prev = f
        prevYear = y
        break
      }
    }
  }
  const rec = cleanRecord(input, now, prev)
  if (!rec) return saveError('학생 · 날짜를 확인하고, 내용이나 주제를 하나는 적어 주세요.')
  const year = schoolYearOf(rec.date)
  if (prev && prevYear !== year) {
    const old = readYear(prevYear)
    old.records = old.records.filter((r) => r.id !== rec.id)
    writeYear(prevYear, old)
  }
  const s = readYear(year)
  s.records = [...s.records.filter((r) => r.id !== rec.id), rec]
  if (planId) {
    for (const y of new Set([year, ...yearsStored()])) {
      const st = y === year ? s : readYear(y)
      const p = st.plans.find((x) => x.id === planId)
      if (!p) continue
      if (p.eventId) db.deleteEvent(p.eventId)
      st.plans = st.plans.filter((x) => x.id !== planId)
      if (y !== year) writeYear(y, st)
    }
  }
  writeYear(year, s)
  return { ok: true, record: rec }
}

export function counselDelete(id: string): boolean {
  for (const y of yearsStored()) {
    const s = readYear(y)
    if (!s.records.some((r) => r.id === id)) continue
    s.records = s.records.filter((r) => r.id !== id)
    writeYear(y, s)
    return true
  }
  return false
}

/** 상담 예정 저장 — 달력 일정을 함께 만들고(고치면 일정도 고침) 일정 번호를 예정에 적어 둔다 */
export function counselPlan(input: PlanInput): { ok: true; plan: CounselPlan } | { ok: false; message: string } {
  let prev: CounselPlan | undefined
  let prevYear = 0
  if (input?.id) {
    for (const y of yearsStored()) {
      const f = readYear(y).plans.find((p) => p.id === input.id)
      if (f) {
        prev = f
        prevYear = y
        break
      }
    }
  }
  const plan = cleanPlan(input, prev)
  if (!plan) return saveError('학생과 날짜를 확인해 주세요.')
  const event = { event_date: plan.date, end_date: plan.date, start_time: plan.time, title: planTitle(plan.no), content: '', color: 'blue', remind: 1, done: 0 }
  const alive = prev?.eventId && db.listEvents().some((e) => e.id === prev!.eventId)
  if (alive) {
    db.updateEvent(prev!.eventId!, event)
    plan.eventId = prev!.eventId
  } else {
    plan.eventId = db.addEvent(event)
  }
  const year = schoolYearOf(plan.date)
  if (prev && prevYear !== year) {
    const old = readYear(prevYear)
    old.plans = old.plans.filter((p) => p.id !== plan.id)
    writeYear(prevYear, old)
  }
  const s = readYear(year)
  s.plans = [...s.plans.filter((p) => p.id !== plan.id), plan]
  writeYear(year, s)
  return { ok: true, plan }
}

/** 상담 예정 취소 — 달력 일정도 지운다 */
export function counselPlanCancel(id: string): boolean {
  for (const y of yearsStored()) {
    const s = readYear(y)
    const p = s.plans.find((x) => x.id === id)
    if (!p) continue
    if (p.eventId) db.deleteEvent(p.eventId)
    s.plans = s.plans.filter((x) => x.id !== id)
    writeYear(y, s)
    return true
  }
  return false
}

/** 학부모 연락처 · 메모(번호별) · 담임 이름. no 가 0 이면 담임 이름만 */
export function counselMetaSave(patch: { no?: number; contact?: string; memo?: string; teacher?: string }): CounselMeta {
  const m = readMeta(db.getSetting(COUNSEL_META_KEY, ''))
  if (typeof patch.teacher === 'string') m.teacher = patch.teacher
  if (patch.no && Number.isInteger(patch.no) && patch.no > 0) {
    m.students[String(patch.no)] = { contact: patch.contact ?? m.students[String(patch.no)]?.contact ?? '', memo: patch.memo ?? m.students[String(patch.no)]?.memo ?? '' }
  }
  const clean = readMeta(JSON.stringify(m))
  db.setSetting(COUNSEL_META_KEY, JSON.stringify(clean))
  return clean
}
