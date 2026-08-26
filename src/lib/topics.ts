import type { Task } from '../../shared/types'

/**
 * 업무 제목에서 "무엇에 관한 일인지"(주제)를 뽑아낸다.
 *
 * 공문을 그대로 학습시키면 제목이 400개씩 쌓이는데, 실제로는
 * "학교폭력", "학생선도위원회", "배움터지킴이" 처럼 몇 가지 주제가 해마다
 * 되풀이되는 것이다. 그 되풀이를 찾아 묶는다.
 *
 * 부서마다 쓰는 말이 다르므로 낱말을 미리 박아 두지 않고, 제목들 사이에서
 * 실제로 자주 겹치는 말을 찾아 주제로 삼는다.
 */

/** 연도·학년·학기·차수처럼 주제와 상관없는 수식 */
const NOISE = [
  /\d{4}\s*학년도/g,
  /\d{4}\s*년도?/g,
  /\d\s*학년(?!도)/g,
  /\d\s*학기/g,
  /\d{1,2}\s*월/g,
  /\d{1,2}\s*주/g,
  /제\s*\d+\s*차/g,
  /\([^)]*\)/g,
  /\[[^\]]*\]/g
]

/**
 * 그 자체로는 주제가 되지 못하는 일반 업무 낱말.
 * "운영", "계획" 만 남으면 무슨 일인지 알 수 없기 때문이다.
 */
const GENERIC = new Set([
  '운영', '구성', '계획', '수립', '시행', '실시', '관리', '안내', '홍보',
  '제출', '신청', '보고', '점검', '확인', '추진', '지출', '구입', '정비',
  '작성', '활동', '결과', '자료', '명부', '관련', '현황', '요청', '및',
  '등', '위한', '대한', '따른', '내용', '사항', '업무', '학교', '기타',
  // 공문에 늘 붙지만 무슨 일인지는 알려 주지 않는 말들
  '구성원', '경비', '예산', '집행', '정산', '대상', '개최', '배정', '지원',
  '참석', '참여', '협조', '명단', '통보', '알림', '공지', '지침', '소요',
  '산출', '변경', '연장', '완료', '준비', '개선', '강화', '수요', '조사표',
  '결과보고', '계획서', '보고서', '실적'
])

/**
 * 주제로 쓰기에 너무 짧고 흔한 말인지.
 *
 * "지도"(급식 지도·생활지도…), "학생", "훈련" 처럼 두 글자짜리 낱말은
 * 여기저기 다 들어 있어 빈도가 가장 높게 나오는데, 정작 그것만 보면
 * 무슨 업무인지 알 수 없다. 낱말 하나짜리 주제는 세 글자 이상만 받는다.
 */
function tooThin(candidate: string): boolean {
  const words = candidate.split(' ')
  if (words.length === 1) return candidate.length < 3
  // 여러 낱말이면 붙였을 때 세 글자는 넘어야 한다
  return candidate.replace(/\s/g, '').length < 3
}

function tokenize(title: string): string[] {
  let s = title
  for (const re of NOISE) s = s.replace(re, ' ')
  return s
    .replace(/[·,/~\-—–:;"'’“”!?.]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
}

/**
 * 한 제목에서 나올 수 있는 1~3낱말짜리 후보들.
 * 값은 "제목 맨 앞에서 시작하는 말인가" — 공문 제목은 대개 주어가 앞에 온다.
 */
function candidates(tokens: string[]): Map<string, boolean> {
  const out = new Map<string, boolean>()
  for (let i = 0; i < tokens.length; i++) {
    for (let n = 1; n <= 3 && i + n <= tokens.length; n++) {
      const part = tokens.slice(i, i + n)
      // 전부 일반 낱말이면 주제가 될 수 없다
      if (part.every((p) => GENERIC.has(p))) continue
      const key = part.join(' ')
      if (tooThin(key)) continue
      if (!out.has(key)) out.set(key, i === 0)
    }
  }
  return out
}

export interface Topic {
  /** 화면에 보이는 주제 이름 (바꿔 놓았으면 바꾼 이름) */
  name: string
  /** 프로그램이 자동으로 붙인 원래 이름. 이름 바꾸기의 열쇠가 된다. */
  autoName: string
  tasks: Task[]
}

/** 자동으로 붙인 이름 → 사람이 고쳐 붙인 이름 */
export type TopicRenames = Record<string, string>

/** 설정에 저장된 이름표를 읽는다. 깨져 있으면 없는 셈 친다. */
export function parseRenames(raw: string): TopicRenames {
  try {
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: TopicRenames = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'string' && val.trim()) out[k] = val.trim()
    }
    return out
  } catch {
    return {}
  }
}

/**
 * 업무들을 주제별로 묶는다.
 *
 * 후보마다 "몇 개의 업무 제목에 나오는지"를 세고, 제목마다 가장 점수가 높은
 * 후보를 그 업무의 주제로 삼는다. 점수는 **빈도를 압도적으로 우선**한다.
 *
 * 길이를 앞세우면 "학생선도위원회"(5건) 대신 "학생선도위원회 구성원 명부"(2건)
 * 처럼 더 좁은 말이 뽑혀 같은 업무가 서너 조각으로 흩어진다. 빈도를 앞세우고
 * 비슷할 때만 제목 앞에 오는 말·긴 말을 택하도록 했다.
 */
export function groupByTopic(tasks: Task[], renames: TopicRenames = {}): Topic[] {
  // 1) 후보가 몇 개의 제목에 걸치는지 센다
  const freq = new Map<string, number>()
  const perTask = new Map<number, Map<string, boolean>>()

  for (const t of tasks) {
    const cands = candidates(tokenize(t.title ?? ''))
    perTask.set(t.id, cands)
    for (const key of cands.keys()) freq.set(key, (freq.get(key) ?? 0) + 1)
  }

  // 2) 업무마다 가장 좋은 후보를 고른다
  const buckets = new Map<string, Task[]>()

  for (const t of tasks) {
    const cands = perTask.get(t.id) ?? new Map<string, boolean>()
    let best = ''
    let bestScore = -1

    for (const [key, leading] of cands) {
      const f = freq.get(key) ?? 0
      if (f < 2) continue // 한 번만 나온 말은 주제로 보지 않는다
      const score = f * 100 + (leading ? 12 : 0) + key.length
      if (score > bestScore) {
        best = key
        bestScore = score
      }
    }

    // 겹치는 말이 없으면 제목 자체를 주제로 둔다 (한 건짜리 주제)
    if (!best) best = [...cands.keys()][0] ?? (t.title || '기타')

    if (!buckets.has(best)) buckets.set(best, [])
    buckets.get(best)!.push(t)
  }

  // 3) 사람이 고쳐 붙인 이름을 입힌다.
  //    두 주제를 같은 이름으로 바꾸면 하나로 합쳐진다 — 합치기가 따로 필요 없다.
  const merged = new Map<string, Topic>()
  for (const [autoName, list] of buckets) {
    const name = renames[autoName] || autoName
    const found = merged.get(name)
    if (found) found.tasks.push(...list)
    else merged.set(name, { name, autoName, tasks: [...list] })
  }

  return [...merged.values()].sort(
    (a, b) => b.tasks.length - a.tasks.length || a.name.localeCompare(b.name, 'ko')
  )
}

/** "3월 1주" → 1, "수시" → 0 (주를 모르는 것) */
export function weekNum(display: string): number {
  const m = /(\d{1,2})\s*주/.exec(display ?? '')
  return m ? Number(m[1]) : 0
}

export function weekLabel(week: number): string {
  return week === 0 ? '수시 · 주 미정' : `${week}주`
}
