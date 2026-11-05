/**
 * 메신저 정리 — 쿨메신저 · 업무 메신저 · 카톡에서 붙여 넣은 글에서 할 일과 출결을 뽑는다.
 *
 * AI 에는 가린 글만 간다: 우리 반 학생 이름 → '학생7'(번호), 다른 사람 이름 → '사람A', 전화번호 · 반번호 → 지움.
 * 돌아온 답의 '학생7' 은 번호로 바로 이어 붙이고, 나머지 가명은 화면에 보일 때만 되돌린다.
 */

import type { AttProof, AttReason, AttType } from './attendance'
import { ATT_REASONS, ATT_TYPES, defaultProof } from './attendance'

export const MSG_INBOX_KEY = 'msg_inbox'

export interface TodoPick {
  title: string
  /** YYYY-MM-DD, 모르면 '' */
  due: string
  /** HH:MM, 없으면 '' */
  time: string
  /** 기한 = 마감 · 제출 · 회신 (절차 기한으로), 일정 = 회의 · 행사 (달력으로) */
  kind: '기한' | '일정'
  from: string
  note: string
}

export interface AttPick {
  /** '학생7' 처럼 가린 이름 (되돌린 뒤에는 실명일 수도) */
  who: string
  /** 명단 번호 (알아냈을 때) */
  no: number
  date: string
  type: AttType
  reason: AttReason
  note: string
  proof: AttProof
}

export interface MsgResult {
  todos: TodoPick[]
  attendance: AttPick[]
}

/** 폰에서 받은 글 (shared/relay.ts) */
export interface InboxItem {
  id: string
  /** 보낸 때 (ms) */
  t: number
  text: string
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토']

export function messengerPrompt(masked: string, today: string, roster: { no: number }[]): string {
  const d = new Date(`${today}T00:00:00`)
  const days = Array.from({ length: 14 }, (_, i) => {
    const x = new Date(d.getTime() + i * 86400000)
    const s = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    return `${s}(${WEEK[x.getDay()]})`
  })
  return `너는 학교 선생님의 메신저 글을 정리하는 도우미다. 아래 글(여러 메시지가 섞여 있을 수 있음)에서
(1) 선생님이 해야 할 일 · 챙길 일정과 (2) 학생 출결 연락을 뽑아 JSON 하나로만 답한다.

오늘: ${days[0]}. 앞으로 2주의 날짜: ${days.join(', ')}.
'내일' · '다음 주 금요일' · '11/20' 같은 말은 위 날짜로 바꿔 YYYY-MM-DD 로 적는다. 해가 없으면 오늘과 가까운 앞날로.

이름은 미리 가려 두었다: '학생숫자'는 우리 반 학생(숫자는 번호), '사람A' 같은 것은 다른 사람이다. 가명은 그대로 적는다.
${roster.length ? `우리 반 번호: ${roster.map((s) => s.no).join(', ')}` : '우리 반 명단은 없다.'}

## todos (할 일 · 일정)
- 제출 · 회신 · 마감 · 입력 · 결재처럼 '언제까지 해야 하는 일' → kind "기한", due 는 그 마감일
- 회의 · 연수 · 행사 · 상담처럼 '그때 있는 일' → kind "일정", due 는 그 날, time 은 시각(HH:MM, 없으면 "")
- title 은 무엇을 하는지 짧게(30자 안, 명사형: "학업성적관리위원회 회의록 제출"). 인사 · 감사 · 안내만 있는 글은 넣지 않는다
- from 은 보낸 부서 · 직위(예: "교무부", "3학년부장"), 모르면 ""
- note 에는 장소 · 준비물 · 제출 방법만 짧게. 날짜를 모르면 due 는 ""
- 글에 없는 일은 만들지 않는다

## attendance (출결)
학생이 오늘 · 어느 날 학교에 못 오거나(결석) 늦거나(지각) 일찍 가거나(조퇴) 수업 일부를 빠지는(결과) 연락만.
- type: "결석" · "지각" · "조퇴" · "결과" 가운데 하나
- reason: 아파서 · 병원 · 입원 → "질병", 까닭 없음 · 무단 · 늦잠 → "미인정", 교외체험학습 · 대회 · 공결 → "출석인정", 그 밖(가정 사정 · 경조사 등) → "기타"
- who: 가린 이름 그대로(예: "학생7"), date: 그 날
- note: 까닭을 짧게(예: "장염, 병원 들렀다 등교"), proof: 서류를 냈다는 말이 있으면 "냄", 아니면 "필요" (미인정은 "없음")
- 출결 연락이 아니면 넣지 않는다

답 모양(이 모양 그대로, 다른 말 없이):
{"todos":[{"title":"","due":"","time":"","kind":"기한","from":"","note":""}],"attendance":[{"who":"학생1","date":"","type":"결석","reason":"질병","note":"","proof":"필요"}]}

## 글
${masked}`
}

const str = (v: unknown, n = 120): string => (typeof v === 'string' ? v.trim().slice(0, n) : '')
const day = (v: unknown): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : '')
const hhmm = (v: unknown): string => {
  const m = typeof v === 'string' ? v.trim().match(/^(\d{1,2}):(\d{2})$/) : null
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
}

/** AI 답(JSON, 코드 울타리로 감쌌을 수도) → MsgResult. 모양이 틀린 줄은 버린다 */
export function parseMsgResult(raw: string): MsgResult {
  let body = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const a = body.indexOf('{')
  const b = body.lastIndexOf('}')
  if (a < 0 || b < a) return { todos: [], attendance: [] }
  body = body.slice(a, b + 1)
  let v: Record<string, unknown>
  try {
    v = JSON.parse(body) as Record<string, unknown>
  } catch {
    return { todos: [], attendance: [] }
  }
  const todos: TodoPick[] = (Array.isArray(v.todos) ? v.todos : [])
    .map((t: Record<string, unknown>) => ({
      title: str(t?.title, 60),
      due: day(t?.due),
      time: hhmm(t?.time),
      kind: (t?.kind === '일정' ? '일정' : '기한') as TodoPick['kind'],
      from: str(t?.from, 30),
      note: str(t?.note, 200)
    }))
    .filter((t) => t.title)
  const attendance: AttPick[] = (Array.isArray(v.attendance) ? v.attendance : [])
    .map((r: Record<string, unknown>) => {
      const who = str(r?.who, 20)
      const type = (ATT_TYPES as readonly string[]).includes(r?.type as string) ? (r.type as AttType) : null
      const reason = (ATT_REASONS as readonly string[]).includes(r?.reason as string) ? (r.reason as AttReason) : '기타'
      const proof: AttProof = r?.proof === '냄' ? '냄' : r?.proof === '없음' ? '없음' : defaultProof(reason)
      const m = who.match(/^학생\s*(\d{1,2})$/)
      return type ? { who, no: m ? Number(m[1]) : 0, date: day(r?.date), type, reason, note: str(r?.note, 200), proof } : null
    })
    .filter((r): r is AttPick => !!r && !!r.who)
  return { todos, attendance }
}
