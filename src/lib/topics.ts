import type { Task } from '../../shared/types'

/**
 * 업무 제목에서 "무엇에 관한 일인지"(주제)를 뽑아낸다.
 *
 * 공문을 그대로 학습시키면 제목이 400개씩 쌓이는데, 실제로는
 * "방과후학교", "학교폭력", "교원 연수" 처럼 몇 가지 주제가 해마다
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

/**
 * 업무 id → 사람이 넣어 둔 주제 이름.
 *
 * 자동 묶음은 제목의 낱말로만 가르므로, 엉뚱한 곳에 들어가거나 원하는 주제가
 * 아예 없을 때 손쓸 방법이 없었다. 여기 적힌 업무는 자동 묶음을 건너뛰고
 * 적힌 주제로 곧장 간다.
 */
export type TopicPins = Record<string, string>

/** 주제에서 뺀 업무가 모이는 곳. 목록 맨 끝에 선다. */
export const UNSORTED = '미분류'

/** 설정에 저장된 표를 읽는다. 깨져 있으면 없는 셈 친다. */
export function parsePins(raw: string): TopicPins {
  try {
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: TopicPins = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (/^\d+$/.test(k) && typeof val === 'string' && val.trim()) out[k] = val.trim()
    }
    return out
  } catch {
    return {}
  }
}

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
export function groupByTopic(
  tasks: Task[],
  renames: TopicRenames = {},
  pins: TopicPins = {}
): Topic[] {
  // 1) 후보가 몇 개의 제목에 걸치는지 센다.
  //    손으로 넣은 업무도 함께 센다. 빼고 세면 하나를 옮기는 순간
  //    나머지 업무들의 주제까지 덩달아 흔들린다.
  const freq = new Map<string, number>()
  const perTask = new Map<number, Map<string, boolean>>()

  for (const t of tasks) {
    const cands = candidates(tokenize(t.title ?? ''))
    perTask.set(t.id, cands)
    for (const key of cands.keys()) freq.set(key, (freq.get(key) ?? 0) + 1)
  }

  // 2) 업무마다 가장 좋은 후보를 고른다. 손으로 넣은 업무는 건너뛴다.
  const buckets = new Map<string, Task[]>()
  const pinned: Task[] = []

  for (const t of tasks) {
    if (pins[String(t.id)]) {
      pinned.push(t)
      continue
    }
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

  // 4) 손으로 넣은 업무는 적힌 주제로 곧장 간다.
  //    같은 이름의 자동 주제가 있으면 거기 합쳐지고, 없으면 새 주제가 선다.
  for (const t of pinned) {
    const name = pins[String(t.id)]
    const found = merged.get(name)
    if (found) found.tasks.push(t)
    else merged.set(name, { name, autoName: name, tasks: [t] })
  }

  // 미분류는 늘 맨 끝. 나머지는 많은 순, 같으면 가나다순.
  return [...merged.values()].sort((a, b) => {
    if (a.name === UNSORTED) return 1
    if (b.name === UNSORTED) return -1
    return b.tasks.length - a.tasks.length || a.name.localeCompare(b.name, 'ko')
  })
}

/* ---------- 업무분장표와 맞춰 보기 ---------- */

/**
 * 업무분장표에 적힌 일인지 가려낸다.
 *
 * 전임자에게서 넘어온 공문에는 지금 담당자의 분장에 없는 것이 섞여 있다.
 * (부서가 바뀌었거나, 전임자가 겸했던 일이거나) 그것을 갈라 두면
 * "내가 맡은 일" 과 "참고로 남은 자료" 를 구분해 볼 수 있다.
 *
 * 분장표는 표를 붙여넣거나 파일에서 뽑은 글이라 형식이 제각각이다.
 * 그래서 낱말 단위로만 본다 — 주제의 낱말이 분장표에 나오면 내 일로 친다.
 */
export function rosterMatcher(roster: string): (topicName: string) => boolean {
  const hay = roster.toLowerCase().replace(/\s+/g, '')
  if (!hay) return () => true // 분장표를 안 적었으면 가르지 않는다

  return (topicName: string) => {
    const tokens = tokenize(topicName).filter((t) => !GENERIC.has(t))
    if (!tokens.length) return false
    // 낱말 하나라도 분장표에 있으면 내 일로 본다.
    //
    // 전부 맞추길 요구하면 안 된다 — 분장표는 "학교폭력 예방" 처럼 줄여 적는데
    // 공문에서 뽑은 주제는 "학교폭력 예방교육" 처럼 길어서 다 걸러진다.
    //
    // 대신 느슨한 만큼 헛짚기도 한다. "학교문화 책임규약" 은 분장표의
    // "학교문화지킴이" 와 '학교문화' 를 나눠 가져 내 일로 잡힌다. 이쪽으로
    // 틀리는 편을 골랐다 — 반대로 틀리면 내가 맡은 일이 '분장 밖' 으로
    // 숨어 버리기 때문이다. 갈라 놓은 것은 보기 편하라고 하는 것이지
    // 딱 잘라 나누는 것이 아니다.
    return tokens.some((t) => hay.includes(t.toLowerCase()))
  }
}

/** "3월 1주" → 1, "수시" → 0 (주를 모르는 것) */
export function weekNum(display: string): number {
  const m = /(\d{1,2})\s*주/.exec(display ?? '')
  return m ? Number(m[1]) : 0
}

export function weekLabel(week: number): string {
  return week === 0 ? '수시 · 주 미정' : `${week}주`
}
