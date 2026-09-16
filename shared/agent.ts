/**
 * 도우미가 "이렇게 넣을까요?" 하고 내미는 일감을 다룬다.
 *
 * 도우미는 말로만 답하지 않고, "9월 16일부터 11월 30일까지 매주 목요일 방과후
 * 1-7반" 같은 부탁을 받으면 실제로 넣을 것을 짜서 내민다. 다만 **스스로
 * 넣지는 않는다.** 사람이 목록을 보고 [넣기] 를 눌러야 들어간다.
 *
 * 여기 있는 것은 모두 **더하기**뿐이다. 지우거나 고치는 것은 도우미에게
 * 맡기지 않는다. 잘못 지우면 되돌릴 방법이 없기 때문이다.
 */

import type { CalEventInput, TaskInput } from './types'

/** 도우미가 적어 보낸 일감 하나 (펼치기 전) */
export interface AgentAction {
  kind: '일정' | '업무'
  title: string
  /* 일정 */
  from?: string
  to?: string
  /** 0=일 … 6=토. 있으면 그 기간 안의 이 요일마다 하루짜리로 펼친다 */
  weekdays?: number[]
  time?: string
  color?: string
  remind?: boolean
  memo?: string
  /* 업무 */
  when?: string
  steps?: string
  points?: string
}

/** 펼친 뒤 실제로 넣을 한 건 */
export interface PlanItem {
  kind: '일정' | '업무'
  /** 화면에 보일 한 줄 */
  label: string
  event?: CalEventInput
  task?: TaskInput
}

/** 한 번에 만들 수 있는 최대 건수. 실수로 몇 년치가 쏟아지지 않게 막는다. */
export const PLAN_LIMIT = 200

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']

function isDay(v: unknown): v is string {
  if (typeof v !== 'string' || !DAY_RE.test(v)) return false
  const d = new Date(`${v}T00:00:00`)
  return !Number.isNaN(d.getTime()) && v === ymd(d)
}

function ymd(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** "2026-09-17" → "9. 17.(목)" */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`)
  return `${d.getMonth() + 1}. ${d.getDate()}.(${WEEKDAY_NAMES[d.getDay()]})`
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 도우미가 보낸 JSON 한 덩어리를 일감으로 읽는다.
 *
 * 모델이 칸 이름을 조금씩 다르게 적거나 요일을 "목"·"목요일"·4 로 적는 일이
 * 있어 넉넉히 받아 준다. 대신 날짜처럼 틀리면 곤란한 것은 깐깐하게 본다.
 */
export function parseActions(raw: unknown): AgentAction[] {
  const box = raw as { 할일?: unknown }
  const list = Array.isArray(box?.할일) ? box.할일 : Array.isArray(raw) ? raw : []
  const out: AgentAction[] = []

  for (const item of list) {
    const o = item as Record<string, unknown>
    const kind = str(o.종류) === '업무' ? '업무' : '일정'
    const title = str(o.제목)
    if (!title) continue

    if (kind === '업무') {
      out.push({
        kind,
        title,
        when: str(o.시기) || '수시',
        steps: str(o.절차),
        points: str(o.포인트)
      })
      continue
    }

    const from = isDay(o.시작일) ? (o.시작일 as string) : ''
    if (!from) continue
    const to = isDay(o.종료일) && (o.종료일 as string) >= from ? (o.종료일 as string) : from

    out.push({
      kind,
      title,
      from,
      to,
      weekdays: readWeekdays(o.요일),
      time: /^\d{1,2}:\d{2}$/.test(str(o.시각)) ? str(o.시각) : '',
      color: str(o.색) || 'blue',
      remind: o.기한 === true,
      memo: str(o.메모)
    })
  }
  return out
}

/** "목", "목요일", 4 를 모두 4(목) 로 읽는다 */
function readWeekdays(v: unknown): number[] {
  const arr = Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]
  const out: number[] = []
  for (const one of arr) {
    if (typeof one === 'number' && one >= 0 && one <= 6) {
      out.push(one)
      continue
    }
    const s = str(one).replace(/요일$/, '')
    const i = WEEKDAY_NAMES.indexOf(s)
    if (i >= 0) out.push(i)
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

/**
 * 일감 하나를 실제로 넣을 건수로 펼친다.
 *
 * 요일이 적혀 있으면 기간 안의 그 요일마다 하루짜리 일정을 만든다.
 * "9월 16일부터 11월 30일까지 매주 목요일" 이 그것이다. 요일이 없으면
 * 시작일부터 종료일까지 이어지는 일정 한 건이다.
 */
export function expandAction(a: AgentAction): PlanItem[] {
  if (a.kind === '업무') {
    return [
      {
        kind: '업무',
        label: `${a.when || '수시'} · ${a.title}`,
        task: {
          title: a.title,
          task_date_display: a.when || '수시',
          task_date_raw: '',
          task_type: '도우미가 넣음',
          workflow: a.steps ?? '',
          draft_full: '',
          key_points: a.points ?? '',
          filename: '',
          is_completed: 0,
          document_id: 0
        }
      }
    ]
  }

  const from = a.from ?? ''
  const to = a.to || from
  if (!from) return []

  const base = {
    start_time: a.time ?? '',
    title: a.title,
    content: a.memo ?? '',
    color: a.color || 'blue',
    remind: a.remind ? 1 : 0,
    done: 0
  }

  // 요일을 안 적었으면 시작일부터 종료일까지 이어지는 한 건
  if (!a.weekdays?.length) {
    const label =
      to !== from
        ? `${dayLabel(from)} ~ ${dayLabel(to)} · ${a.title}`
        : `${dayLabel(from)} · ${a.title}`
    return [{ kind: '일정', label, event: { ...base, event_date: from, end_date: to } }]
  }

  const out: PlanItem[] = []
  const cur = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  while (cur <= end && out.length < PLAN_LIMIT) {
    if (a.weekdays.includes(cur.getDay())) {
      const day = ymd(cur)
      out.push({
        kind: '일정',
        label: `${dayLabel(day)} · ${a.title}`,
        event: { ...base, event_date: day, end_date: day }
      })
    }
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

/** 일감 여럿을 한 목록으로 펼친다 */
export function buildPlan(actions: AgentAction[]): PlanItem[] {
  const out: PlanItem[] = []
  for (const a of actions) {
    for (const item of expandAction(a)) {
      if (out.length >= PLAN_LIMIT) return out
      out.push(item)
    }
  }
  return out
}

/* ---------- 도우미 답에서 일감 묶음을 떼어 낸다 ---------- */

/**
 * 답 안에 끼워 보내는 표시.
 *
 * ```json 같은 흔한 표시를 쓰면 도우미가 코드를 설명할 때와 헷갈린다.
 * 사람이 쓸 일 없는 표시를 골랐다.
 */
const OPEN = '<<<할일'
const CLOSE = '할일>>>'

export interface SplitAnswer {
  /** 사람에게 보여 줄 말 */
  text: string
  actions: AgentAction[]
}

/** 도우미 답을 "보여 줄 말" 과 "내밀 일감" 으로 가른다 */
export function splitAnswer(answer: string): SplitAnswer {
  const s = answer.indexOf(OPEN)
  if (s < 0) return { text: answer.trim(), actions: [] }
  const e = answer.indexOf(CLOSE, s)
  if (e < 0) return { text: answer.slice(0, s).trim(), actions: [] }

  const body = answer.slice(s + OPEN.length, e).trim()
  const text = `${answer.slice(0, s)}${answer.slice(e + CLOSE.length)}`.trim()

  try {
    return { text, actions: parseActions(JSON.parse(body)) }
  } catch {
    // 깨진 묶음은 없는 셈 친다. 말만 보여 주면 사람이 다시 부탁할 수 있다.
    return { text, actions: [] }
  }
}

/** 도우미에게 알려 줄 일감 적는 법 */
export function actionGuide(today: string): string {
  return `[할 일 넣어 드리기]

담당자가 "넣어 줘", "등록해 줘", "잡아 줘" 처럼 **실제로 적어 두기를 부탁**하면,
답 끝에 아래 묶음을 하나만 붙이세요. 붙이면 화면에 목록이 뜨고, 담당자가
확인하고 누를 때 비로소 들어갑니다. 당신이 직접 넣는 것이 아닙니다.

${OPEN}
{"할일":[{"종류":"일정","제목":"방과후 1-7반","시작일":"2026-09-16","종료일":"2026-11-30","요일":["목"],"시각":"","색":"blue","기한":false,"메모":""}]}
${CLOSE}

- 오늘은 ${today} 입니다. "다음 주 화요일" 같은 말은 **YYYY-MM-DD 로 바꿔** 적으세요.
- "매주 목요일" 처럼 되풀이하는 것은 날짜를 하나하나 적지 말고 **"요일"** 에 적으세요.
  기간 안의 그 요일마다 프로그램이 알아서 펼칩니다.
- 하루짜리면 시작일과 종료일을 같게, 여러 날에 걸치면 다르게 적습니다.
- 업무 로드맵에 넣는 것이면 {"종류":"업무","제목":"","시기":"9월 3주","절차":"","포인트":""} 입니다.
- 색은 blue·green·orange·red·purple·gray 중 하나입니다.
- **날짜나 제목이 분명하지 않으면 묶음을 붙이지 말고 되물으세요.**
- 지우거나 고치는 일은 할 수 없습니다. 부탁받으면 어디서 직접 하면 되는지 알려 주세요.
- 묻기만 하는 질문에는 묶음을 붙이지 마세요.`
}
