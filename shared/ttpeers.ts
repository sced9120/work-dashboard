/**
 * 동교과 선생님 — 수업을 바꾸거나 보강을 찾을 때 같은 교과 선생님을 먼저 보여 준다.
 *
 * 시간표에서 나와 같은 과목을 가르치는 분, 또는 같은 교과군(공통수학 · 미적분 · 확률과 통계 → 수학)을 가르치는 분을
 * 찾아 명단을 만든다. 학교마다 과목 이름을 줄여 적어서(확통 · 영Ⅱ · A_사문 …) 낱말 조각으로 교과를 짐작한다.
 * 한두 시간 맡은 과목(담임이 하는 진로 같은 것)으로 엮이지 않게, 그 선생님이 주로 가르치는 과목만 본다.
 * 사용자가 뺀 분 · 더한 분은 따로 적어 두고 늘 그 위에 얹는다 — 시간표를 다시 불러와도 손본 것이 남는다.
 * 선생님 이름이 들어 있어 인수인계 파일에는 넣지 않는다(db.ts PERSONAL_SETTINGS).
 */

import type { SchoolTimetable } from './timetable'
import { fixedOf, isFree } from './timetable'

export const TT_PEERS_KEY = 'timetable_peers'

export interface PeerPrefs {
  /** 직접 더한 분 */
  added: string[]
  /** 찾은 명단에서 뺀 분 */
  removed: string[]
  /** 확인한 시간표 · 이름 ("stamp|이름"). 다르면 "확인해 주세요" 를 띄운다 */
  confirmedFor: string
}

export const EMPTY_PEERS: PeerPrefs = { added: [], removed: [], confirmedFor: '' }

export interface PeerFound {
  name: string
  /** 나와 똑같이 가르치는 과목 */
  same: string[]
  /** 같은 교과군으로 묶인 그분의 과목 */
  related: string[]
}

export interface Peer {
  name: string
  /** 'same' 같은 과목 · 'group' 같은 교과 · 'added' 직접 더함 */
  why: 'same' | 'group' | 'added'
  /** 화면에 붙일 과목 이름 */
  subjects: string[]
}

/**
 * 교과군 — 위에서부터 맞춰 본다(겹치는 낱말이 있어 차례가 중요하다: 경제 수학 → 수학, 영미 문학 → 영어, 화법 → 국어).
 * 학교 부서와 맞게 역사 · 지리 · 윤리는 사회로, 물리 · 화학 · 생명 · 지구는 과학으로 묶는다.
 */
const GROUPS: [string, RegExp][] = [
  ['수학', /수학|미적|확률|확통|기하|대수|^공수|^수[ⅠⅡⅢI12]|^(통수|심수|수탐|기수|실수)/],
  ['영어', /영어|영미|^공영|^영[ⅠⅡⅢI12]?$|^영[ⅠⅡ]|^영(독|회|작|문|청|어)|^(진영|실영|심영|기영)/],
  // '중국어' 가 국어로 잡히지 않게 국어보다 먼저
  ['제2외국어', /일본어|중국어|독일어|프랑스어|스페인어|러시아어|아랍어|베트남어|^일어|^중어|^일문|^중문/],
  ['국어', /국어|문학|독서|화법|작문|문법|언어와?매체|^언매|^화작|^독작|^공국|^국[ⅠⅡI12]?$|매체|^(현문|문체|실국|심국|기국)|^고전($|읽)/],
  ['정보', /정보|컴퓨터|프로그래밍|소프트웨어|인공지능기초|데이터과학/],
  ['사회', /사회|^사문|^통사|^사탐|한국사|^한국$|^국사$|^한사$|세계사|동아시아|^동사$|^세사$|역사|지리|^한지$|^세지$|^여지$|윤리|^생윤$|^윤사$|도덕|경제|정치|^정법$|^법과/],
  ['과학', /과학|물리|화학|생명|지구|^통과|과탐|^과실|^(물질|전자|융과|생과|지과|행성|역학)|^물[ⅠⅡI12]?$|^화[ⅠⅡI12]$|^생[ⅠⅡI12]$|^지[ⅠⅡI12]$/],
  ['체육', /체육|운동|스포츠|^스(생|포)|^체탐|^체$/],
  ['음악', /음악|^음$|^음(연|감|창|미)|합창|연주/],
  ['미술', /미술|^미$|^미(창|감)|드로잉|조형|디자인/],
  ['기술·가정', /기술|가정|^기가$/],
  ['한문', /한문/],
  ['진로', /^진로$|진로와직업/],
  ['보건', /보건/],
  ['교양', /철학|논리|심리|교육학|종교|논술|환경/]
]

/** 비교할 모양 — 묶음 글자(A_) · 빈칸 · 가운뎃점 · 괄호를 뗀다 */
export function normSubject(s: string): string {
  return s
    .trim()
    .replace(/^[A-Za-z가-하]\s*[_:)]\s*/, '')
    .replace(/[\s·・,.\-_()（）[\]]/g, '')
}

/** 과목 이름이 아닌 칸 — "C블록" 처럼 블록 글자만 있거나, 과목을 모르는 "수업" */
const notSubject = (s: string): boolean => !s || s === '수업' || /^[A-Za-z가-하]블록$/.test(s)

/** 과목 → 교과군. 모르면 빈칸 */
export function subjectGroup(subject: string): string {
  const s = normSubject(subject)
  if (notSubject(s) || fixedOf({ subject: s })) return ''
  return GROUPS.find(([, re]) => re.test(s))?.[0] ?? ''
}

/** 선생님마다 과목별 주당 시간 (파일에 적힌 이름 그대로). 여러 반이 함께 듣는 한 수업도 한 시간으로 센다 */
export function teacherHours(tt: SchoolTimetable): Map<string, Map<string, number>> {
  const seen = new Set<string>()
  const out = new Map<string, Map<string, number>>()
  tt.classes.forEach((c) =>
    c.grid.forEach((col, d) =>
      col.forEach((x, p) => {
        if (!x || isFree(x) || fixedOf(x)) return
        for (const t of x.teachers) {
          const k = `${t}|${d}-${p}|${x.subject}`
          if (seen.has(k)) continue
          seen.add(k)
          if (!out.has(t)) out.set(t, new Map())
          const m = out.get(t)!
          m.set(x.subject, (m.get(x.subject) ?? 0) + 1)
        }
      })
    )
  )
  return out
}

/** 선생님마다 가르치는 과목 */
export function teacherSubjects(tt: SchoolTimetable): Map<string, Set<string>> {
  return new Map([...teacherHours(tt)].map(([t, m]) => [t, new Set(m.keys())]))
}

/**
 * 주로 가르치는 과목 — 주 2시간 이상이고, 그 과목의 교과(모르면 그 과목 하나)가 그 선생님 수업의 5분의 1 이상인 것.
 * 없으면 가장 많은 과목 하나. 블록 글자만 적힌 칸은 과목을 모르므로 셈에서 뺀다.
 */
export function mainSubjects(hours: Map<string, number> | undefined): string[] {
  if (!hours) return []
  const named = [...hours].filter(([s]) => !notSubject(normSubject(s)))
  const total = named.reduce((n, [, h]) => n + h, 0)
  const keyOf = (s: string): string => subjectGroup(s) || `과목:${normSubject(s)}`
  const byGroup = new Map<string, number>()
  for (const [s, h] of named) byGroup.set(keyOf(s), (byGroup.get(keyOf(s)) ?? 0) + h)
  const main = named.filter(([s, h]) => h >= 2 && (byGroup.get(keyOf(s)) ?? 0) >= total / 5).map(([s]) => s)
  if (main.length) return main
  const top = named.sort((a, b) => b[1] - a[1])[0]
  return top ? [top[0]] : []
}

/**
 * 나와 같은 과목 · 같은 교과군을 가르치는 분을 찾는다.
 * alias(과목 이름 바꿔 보이기)는 내 과목에만 얹는다 — "C블록" 같은 블록 글자는 반마다 다른 과목이라 남의 칸에는 쓰지 않는다.
 */
export function findPeers(tt: SchoolTimetable, me: string, alias: Record<string, string> = {}): { groups: string[]; mine: string[]; found: PeerFound[] } {
  const hours = teacherHours(tt)
  // 내 과목: 블록 글자에 과목 이름을 붙여 두었으면(alias) 그 이름으로 세고, 주로 가르치는 것만
  const myHours = new Map<string, number>()
  for (const [s, h] of hours.get(me) ?? []) {
    const name = alias[s] ?? s
    myHours.set(name, (myHours.get(name) ?? 0) + h)
  }
  const mine = mainSubjects(myHours)
  const mineNorm = new Set(mine.map(normSubject))
  const groups = [...new Set(mine.map(subjectGroup).filter(Boolean))]
  const found: PeerFound[] = []
  for (const [t, m] of hours) {
    if (t === me) continue
    const theirs = mainSubjects(m).map((s) => alias[s] ?? s)
    const same = theirs.filter((s) => !notSubject(normSubject(s)) && mineNorm.has(normSubject(s)))
    const related = theirs.filter((s) => !same.includes(s) && groups.includes(subjectGroup(s)))
    if (same.length || related.length) found.push({ name: t, same: [...new Set(same)], related: [...new Set(related)] })
  }
  found.sort((a, b) => Number(!a.same.length) - Number(!b.same.length) || a.name.localeCompare(b.name, 'ko'))
  return { groups, mine, found }
}

/** 찾은 명단에 뺀 분 · 더한 분을 얹은 실제 명단 (시간표에 없는 이름은 뺀다) */
export function peerList(tt: SchoolTimetable, me: string, alias: Record<string, string>, prefs: PeerPrefs | null): Peer[] {
  const p = prefs ?? EMPTY_PEERS
  const names = new Set(tt.teachers)
  const out: Peer[] = findPeers(tt, me, alias)
    .found.filter((f) => !p.removed.includes(f.name))
    .map((f) => ({ name: f.name, why: f.same.length ? 'same' : 'group', subjects: f.same.length ? f.same : f.related }))
  const subjects = teacherSubjects(tt)
  for (const n of p.added) {
    if (n === me || !names.has(n) || out.some((x) => x.name === n)) continue
    out.push({ name: n, why: 'added', subjects: [...(subjects.get(n) ?? [])].slice(0, 3) })
  }
  return out
}

/** 어느 시간표 · 누구로 확인했는지 */
export const peerStamp = (tt: SchoolTimetable, me: string): string => `${tt.stamp || `${tt.file}|${tt.loadedAt}`}|${me}`

export function parsePeers(raw: string): PeerPrefs {
  try {
    const v = JSON.parse(raw || 'null') as Partial<PeerPrefs> | null
    const names = (a: unknown): string[] => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [])
    return { added: names(v?.added), removed: names(v?.removed), confirmedFor: typeof v?.confirmedFor === 'string' ? v.confirmedFor : '' }
  } catch {
    return { ...EMPTY_PEERS }
  }
}
