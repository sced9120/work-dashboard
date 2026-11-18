/**
 * 출결 기록 → 결석계 한글 양식 채우기 (3.7.8~).
 *
 * 출결 기록에서 결석을 학생별로 '연속한 평일'끼리 묶어 한 건(기간 · 일수)으로 만들고,
 * 학교가 올려 둔 한글 양식의 칸(라벨 옆 빈 칸 · {{칸}})에 값을 짝지어 넣는다.
 * 이 파일에는 화면 · 메인이 함께 쓰는 순수 함수만 둔다. 실제 한글 파일 채우기는 electron/main/hwpdoc.ts.
 */
import type { AttProof, AttReason, AttRecord, AttType, Student } from './attendance'

const pad = (n: number): string => String(n).padStart(2, '0')
const dayOf = (s: string): Date => new Date(`${s}T00:00:00`)
const str = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const WEEK = ['일', '월', '화', '수', '목', '금', '토']

/** 다음 평일 (금요일 다음은 월요일) */
export function nextWeekday(day: string): string {
  const d = dayOf(day)
  do d.setDate(d.getDate() + 1)
  while (d.getDay() === 0 || d.getDay() === 6)
  return str(d)
}

/** '2026. 3. 6.' — withWeek 면 '2026. 3. 6.(금)' */
export function fmtDay(day: string, withWeek = false): string {
  const d = dayOf(day)
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.` + (withWeek ? `(${WEEK[d.getDay()]})` : '')
}

/** 결석계 한 건 — 한 학생의 연속한 결석 */
export interface AttDocItem {
  /** 묶은 기록 id 를 이은 것 — 화면에서 고르는 열쇠 */
  key: string
  no: number
  name: string
  /** 담임 반 (예: 2-4) */
  cls: string
  type: AttType
  reason: AttReason
  /** 기록의 메모(사유 내용) — 여럿이면 첫 글 */
  reasonText: string
  /** 증빙: 모두 냄이면 냄, 하나라도 필요면 필요, 아니면 없음 */
  proof: AttProof
  start: string
  end: string
  /** 결석 일수 — 묶은 기록 수. 공휴일이 끼면 화면에서 고친다 */
  days: number
  recordIds: string[]
}

/**
 * 같은 학생 · 같은 종류 · 같은 사유의 기록이 평일로 이어지면 한 건으로 묶는다(금 → 월도 이어진 것).
 * types 에 든 종류만 다룬다(기본 결석).
 */
export function groupAbsences(records: AttRecord[], students: Student[], cls: string, types: AttType[] = ['결석']): AttDocItem[] {
  const name = new Map(students.map((s) => [s.no, s.name]))
  const by = new Map<string, AttRecord[]>()
  for (const r of records) {
    if (!types.includes(r.type)) continue
    const k = `${r.no}|${r.type}|${r.reason}`
    by.set(k, [...(by.get(k) ?? []), r])
  }
  const out: AttDocItem[] = []
  for (const list of by.values()) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date))
    let run: AttRecord[] = []
    const flush = (): void => {
      if (!run.length) return
      const first = run[0]
      out.push({
        key: run.map((r) => r.id).join('+'),
        no: first.no,
        name: name.get(first.no) ?? `${first.no}번`,
        cls,
        type: first.type,
        reason: first.reason,
        reasonText: run.map((r) => r.note.trim()).find(Boolean) ?? '',
        proof: run.some((r) => r.proof === '필요') ? '필요' : run.every((r) => r.proof === '없음') ? '없음' : '냄',
        start: first.date,
        end: run[run.length - 1].date,
        days: run.length,
        recordIds: run.map((r) => r.id)
      })
      run = []
    }
    for (const r of sorted) {
      if (run.length && nextWeekday(run[run.length - 1].date) !== r.date && run[run.length - 1].date !== r.date) flush()
      if (!run.some((x) => x.date === r.date)) run.push(r)
    }
    flush()
  }
  return out.sort((a, b) => b.start.localeCompare(a.start) || a.no - b.no)
}

/* ---------- 양식 칸에 들어갈 값 ---------- */

export interface AttDocField {
  key: string
  /** 칸 고르기에 보일 이름 */
  label: string
}

export const ATT_DOC_FIELDS: AttDocField[] = [
  { key: 'name', label: '성명' },
  { key: 'clsNo', label: '학년 반 번호 (2학년 4반 5번)' },
  { key: 'grade', label: '학년' },
  { key: 'klass', label: '반' },
  { key: 'no', label: '번호' },
  { key: 'period', label: '결석 기간 (시작 ~ 끝)' },
  { key: 'start', label: '시작일' },
  { key: 'end', label: '마지막 날' },
  { key: 'days', label: '결석 일수 (숫자)' },
  { key: 'periodDays', label: '기간과 일수 (… ~ …, 2일간)' },
  { key: 'type', label: '구분 (결석 · 지각 · 조퇴 · 결과)' },
  { key: 'reasonType', label: '사유 종류 (질병 · 미인정 · 기타 · 출석인정)' },
  { key: 'reason', label: '사유 내용 (적어 둔 메모)' },
  { key: 'proof', label: '증빙 서류 (제출 · 미제출)' },
  { key: 'signDay', label: '서명일 (마지막 날의 다음 평일)' },
  { key: 'today', label: '작성일 (오늘)' }
]

const norm = (s: string): string => s.replace(/[\s:：·ㆍ()（）\[\]]/g, '')

/** 양식 칸의 라벨로 무엇이 들어갈지 짐작한다. 모르면 '' (비움) */
export function guessField(label: string): string {
  const t = norm(label)
  if (!t || t.length > 14) return ''
  if (/성명|이름|학생명|학생이름/.test(t)) return 'name'
  if (/일수/.test(t)) return 'days'
  if (/학년.*반.*번호|반.*번호|학번/.test(t)) return 'clsNo'
  if (/시작|부터|출발/.test(t)) return 'start'
  if (/종료|마지막|까지|끝/.test(t)) return 'end'
  if (/기간|일시|결석일|사고일|결석기간/.test(t)) return 'period'
  if (/사유|이유|증상|병명|내용/.test(t)) return 'reason'
  if (/증빙|첨부|서류/.test(t)) return 'proof'
  if (/서명일|서류날짜|서류일/.test(t)) return 'signDay'
  if (/작성일|제출일|날짜|신청일/.test(t)) return 'today'
  if (/종류|구분|결석구분/.test(t)) return 'reasonType'
  if (t === '학년') return 'grade'
  if (t === '반') return 'klass'
  if (t === '번호' || t === '번') return 'no'
  return ''
}

/** 한 건의 값 — 칸 열쇠(ATT_DOC_FIELDS.key) → 글 */
export function itemValues(item: AttDocItem, today: string, overrides: { days?: number; reasonText?: string } = {}): Record<string, string> {
  const days = overrides.days ?? item.days
  const reason = (overrides.reasonText ?? item.reasonText).trim() || item.reason
  const same = item.start === item.end
  const parts = item.cls.split(/[-–]/)
  const grade = parts.length >= 2 ? parts[0].trim() : ''
  const klass = parts.length >= 2 ? parts[1].trim() : item.cls.trim()
  const period = same ? fmtDay(item.start, true) : `${fmtDay(item.start, true)} ~ ${fmtDay(item.end, true)}`
  return {
    name: item.name,
    clsNo: [grade && `${grade}학년`, klass && `${klass}반`, `${item.no}번`].filter(Boolean).join(' '),
    grade,
    klass,
    no: String(item.no),
    period,
    start: fmtDay(item.start, true),
    end: fmtDay(item.end, true),
    days: String(days),
    periodDays: `${period} (${days}일간)`,
    type: item.type,
    reasonType: item.reason,
    reason,
    proof: item.proof === '냄' ? '제출' : item.proof === '필요' ? '미제출' : '해당 없음',
    signDay: fmtDay(nextWeekday(item.end)),
    today: fmtDay(today)
  }
}

/** 칸 → 값 짝. 열쇠는 {{칸 이름}} 이면 'slot:이름', 라벨 옆 빈 칸이면 그 칸의 id(T0.1.2) */
export type AttDocMap = Record<string, string>

export const slotKey = (name: string): string => `slot:${name}`

/** {{칸}} 이름이 필드 이름과 같거나 비슷하면 그것으로, 라벨 옆 빈 칸은 라벨로 짐작해 짝을 짓는다 */
export function autoMap(slots: string[], blanks: { id: string; label?: string }[], spots: { id: string; text: string }[] = []): AttDocMap {
  const map: AttDocMap = {}
  for (const s of slots) {
    const exact = ATT_DOC_FIELDS.find((f) => f.key === s.trim() || norm(f.label) === norm(s))
    map[slotKey(s)] = exact?.key ?? guessField(s)
  }
  for (const b of blanks) {
    let f = guessField(b.label ?? '')
    // '3 | 학년 | [  ] | 반 | [  ] | 번' 처럼 숫자 뒤에 단위 칸이 붙은 표는 단위 칸 오른쪽 빈 칸이 '다음 단위'의 값이다
    const t = norm(b.label ?? '')
    if (spots.length && (t === '학년' || t === '반')) {
      const rowOf = (id: string): string => id.replace(/\.\d+$/, '')
      const colOf = (id: string): number => Number(id.slice(id.lastIndexOf('.') + 1))
      const shifted = spots.some((x) => rowOf(x.id) === rowOf(b.id) && /^\d+$/.test(norm(x.text)) && colOf(x.id) < colOf(b.id))
      if (shifted) f = t === '학년' ? 'klass' : 'no'
    }
    map[b.id] = f
  }
  return map
}

/** 한 건을 양식에 넣을 값으로 — 메인이 fillSlots 에 그대로 넘긴다 */
export function fillArgs(map: AttDocMap, values: Record<string, string>): { values: Record<string, string>; blanks: Record<string, string> } {
  const slotVals: Record<string, string> = {}
  const blanks: Record<string, string> = {}
  for (const [target, field] of Object.entries(map)) {
    const v = field ? values[field] : ''
    if (!v) continue
    if (target.startsWith('slot:')) slotVals[target.slice(5)] = v
    else blanks[target] = v
  }
  return { values: slotVals, blanks }
}

/** 파일 이름 — 결석계_이름_20260306 (파일 이름에 못 쓰는 글자는 뺀다) */
export function docFileName(item: AttDocItem, title = '결석계'): string {
  const safe = (s: string): string => s.replace(/[\\/:*?"<>|]/g, '').trim()
  return `${safe(title) || '결석계'}_${safe(item.name)}_${item.start.replace(/-/g, '')}`
}

/* ---------- 한 칸 안에 '○ 사유 : …' 줄이 든 양식 ---------- */

const LINE_RE = /^\s*[○●·※-]?\s*(사\s*유|기\s*간|증\s*빙\s*서\s*류)\s*[:：]/

/** 칸 안에 사유 · 기간 · 증빙서류 줄이 둘 이상이면 '줄로 채울 칸' 이다 */
export function isLineSpot(text: string): boolean {
  return text.split('\n').filter((l) => LINE_RE.test(l)).length >= 2
}

/** '○ 결석종류 : 병결' 줄의 값 — 한 파일에 병결 · 인정결 같은 양식이 여럿 들었을 때 어느 것인지 알아보는 이름 */
export function lineSpotKind(text: string): string {
  const m = text.match(/결\s*석\s*종\s*류\s*[:：]\s*([^\n]*)/)
  return m ? m[1].trim() : ''
}

export interface LineFillOptions {
  days?: number
  reasonText?: string
  /** 증빙서류 이름 (예: 진료확인서) — 비면 그 줄은 두고 */
  proofName?: string
}

const ymd = (day: string): string => {
  const d = dayOf(day)
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}

/**
 * 칸 안의 줄에 값을 넣는다. 줄의 모양(○ 표시 · 띄어쓰기 · '까지 ( )일간')은 그대로 두고 빈 곳만 채운다.
 *  · '사 유 :' → 사유
 *  · '기 간 : 2023년 월 일 ~ 2023년 월 일까지 ( )일간' → 시작 · 끝 날짜와 일수
 *  · '증빙서류 :' → 증빙서류 이름
 *  · '2023년  월  일' 만 있는 줄 → 서명일(마지막 날의 다음 평일)
 */
export function fillCellLines(text: string, item: AttDocItem, opt: LineFillOptions = {}): string {
  const days = opt.days ?? item.days
  const reason = (opt.reasonText ?? item.reasonText).trim() || item.reason
  const sign = nextWeekday(item.end)
  return text
    .split('\n')
    .map((line) => {
      const m = line.match(LINE_RE)
      if (m) {
        const label = m[1].replace(/\s+/g, '')
        const head = line.slice(0, m[0].length)
        if (label === '사유') return `${head} ${reason}`
        if (label === '기간') {
          let n = 0
          let out = line.replace(/(\d{4})\s*년\s*(?:\d{1,2}\s*월\s*(?:\d{1,2}\s*일)?|월\s*일)/g, () => ymd(n++ === 0 ? item.start : item.end))
          out = out.replace(/\(\s*\d*\s*\)\s*일/, `(${days})일`)
          return out
        }
        if (label === '증빙서류') return opt.proofName?.trim() ? `${head} ${opt.proofName.trim()}` : line
      }
      if (/^\s*\d{4}\s*년\s+월\s+일\s*$/.test(line)) return line.replace(/\d{4}\s*년\s+월\s+일/, ymd(sign))
      return line
    })
    .join('\n')
    // 칸 안의 줄을 고쳐 쓰면 연속한 공백이 하나로 줄어 '사    유' 같은 정렬이 깨지므로, 두 칸 이상의 공백은 줄바꿈 없는 공백으로 둔다
    .replace(/ {2,}/g, (m) => ' '.repeat(m.length))
}

/** 한 건이 쓸 표 고르기 — 사유 종류와 '결석종류' 이름이 비슷한 것. 없으면 첫 번째 */
export function pickVariant(variants: { table: string; kind: string }[], item: Pick<AttDocItem, 'type' | 'reason'>): string {
  if (!variants.length) return ''
  const want: string[] =
    item.reason === '질병' ? ['병'] : item.reason === '출석인정' ? ['인정'] : item.reason === '미인정' ? ['미인정'] : ['기타']
  const typeWord = item.type === '지각' ? '지각' : item.type === '조퇴' ? '조퇴' : item.type === '결과' ? '결과' : '결'
  const score = (k: string): number => (want.some((w) => k.includes(w)) ? 2 : 0) + (k.includes(typeWord) ? 1 : 0) - (item.reason !== '미인정' && k.includes('미인정') ? 3 : 0)
  return [...variants].sort((a, b) => score(b.kind) - score(a.kind))[0].table
}

/** 표 번호(T0.4.0 → T0) — 표가 아닌 자리(문단 · {{칸}})는 '' */
export const tableOf = (id: string): string => (/^T\d+\./.exec(id)?.[0].slice(0, -1) ?? '')

/** 고른 표에 속한 칸과 표 밖의 칸만 남긴다 */
export function onlyTable(map: AttDocMap, table: string): AttDocMap {
  if (!table) return map
  return Object.fromEntries(Object.entries(map).filter(([k]) => !tableOf(k) || tableOf(k) === table))
}
