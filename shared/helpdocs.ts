/**
 * 학교업무 도움자료 — 교육청이 업무마다 엮어 둔 자료 폴더(업무흐름도·계획 예시·서식)의 목록.
 *
 * 목록은 경상남도교육청 학교업무 도움자료 누리집(hryoon0.github.io/helppage)에서 옮겨 와
 * electron/main/helpdocs.json 에 넣어 두었다. 파일은 들고 있지 않고 이름과 자료 폴더 주소만 있다.
 *
 * 연간 업무·로드맵에 미리 넣지 않는다. 담당자가 처음 설정에서 "내 업무"를 적으면 맞는 것을 골라 주고,
 * 통합 검색·업무 도우미가 질문에 맞는 자료 폴더를 함께 찾아 준다.
 * 여기 있는 것은 모두 목록만 받아 계산하는 함수다(메인·화면 어디서나 쓸 수 있게).
 */

export type HelpGroupId = 'kindergarten' | 'elementary' | 'secondary' | 'special' | 'admin' | 'staff'

export interface HelpItem {
  /** 누리집의 항목 id (예: s-6-3) */
  id: string
  /** 예: 6-03. 학교폭력예방 및 근절 */
  title: string
  /** 자료 폴더 주소 */
  url: string
  /** 폴더에 든 파일 이름 */
  files: string[]
}

export interface HelpSection {
  /** 예: 6. 인성 */
  title: string
  items: HelpItem[]
}

export interface HelpGroup {
  id: HelpGroupId
  /** 예: 중고등학교 */
  label: string
  sections: HelpSection[]
}

export interface HelpCatalog {
  source: { title: string; edition: string; url: string; taken: string }
  groups: HelpGroup[]
}

/** 찾은 업무 하나 */
export interface HelpHit {
  id: string
  title: string
  groupId: HelpGroupId
  group: string
  section: string
  url: string
  fileCount: number
  /** 찾는 말이 걸린 파일 이름 (앞쪽 몇 개) */
  matched: string[]
  score: number
}

/** 적은 내 업무 한 줄과, 거기에 맞는 도움자료 */
export interface HelpMatch {
  line: string
  hits: HelpHit[]
}

export const SCHOOL_LEVELS = ['유치원', '초등학교', '중학교', '고등학교', '특수학교'] as const
export type SchoolLevel = (typeof SCHOOL_LEVELS)[number]

/** 학교급에 맞는 도움자료 묶음. 교무행정·일반행정은 어느 학교급이나 함께 본다. */
export function levelGroup(level: string): HelpGroupId | null {
  switch (level) {
    case '유치원':
      return 'kindergarten'
    case '초등학교':
      return 'elementary'
    case '중학교':
    case '고등학교':
      return 'secondary'
    case '특수학교':
      return 'special'
    default:
      return null
  }
}

export const COMMON_GROUPS: HelpGroupId[] = ['admin', 'staff']

/** 학교 이름으로 학교급을 어림한다. 모르면 빈 문자열 */
export function guessLevel(school: string): SchoolLevel | '' {
  const s = school.replace(/\s+/g, '')
  if (!s) return ''
  if (/유치원$/.test(s)) return '유치원'
  if (/초등학교$|초$/.test(s)) return '초등학교'
  if (/중학교$|중$/.test(s)) return '중학교'
  if (/고등학교$|고$|고교$/.test(s)) return '고등학교'
  if (/특수학교$/.test(s)) return '특수학교'
  return ''
}

/** "내 업무"로 고른 항목 id 를 설정에 담는 이름 */
export const MY_HELP_KEY = 'my_help'
export const LEVEL_KEY = 'school_level'

export function parseMine(raw: string): string[] {
  try {
    const v = JSON.parse(raw || '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/* ---------- 찾기 ---------- */

/**
 * 학교에서 흔히 부르는 이름 → 도움자료 목록에 쓰인 이름.
 * 분장표에는 "학폭", "생기부", "선도" 처럼 줄여 적는 일이 많아서 이것 없이는 잘 못 찾는다.
 */
const SYNONYMS: Record<string, string[]> = {
  학폭: ['학교폭력'],
  생기부: ['학교생활기록부', '생활기록부'],
  학생부: ['학교생활기록부', '생활기록부'],
  교권: ['교육활동보호'],
  교육활동침해: ['교육활동보호'],
  선도: ['생활교육', '학교규칙'],
  생활지도: ['생활교육'],
  학생생활: ['생활교육', '학교규칙'],
  생활규정: ['학교규칙'],
  학칙: ['학교규칙'],
  방과후: ['방과후학교', '돌봄'],
  늘봄: ['돌봄', '방과후학교'],
  체험학습: ['현장체험학습', '교외체험학습'],
  수학여행: ['현장체험학습'],
  수련회: ['현장체험학습'],
  수련활동: ['현장체험학습'],
  자치: ['자치활동'],
  학생회: ['자치활동'],
  봉사: ['봉사활동'],
  금연: ['흡연예방'],
  흡연: ['흡연예방'],
  보건: ['건강', '보건업무'],
  성교육: ['성교육', '양성평등'],
  성고충: ['성희롱', '성폭력'],
  시험: ['평가', '학업성적관리'],
  고사: ['평가', '학업성적관리'],
  성적: ['학업성적관리', '평가'],
  전학: ['전입학', '전출입', '학적'],
  학적: ['학적', '전입학'],
  결석: ['출결'],
  홈페이지: ['누리집'],
  에듀파인: ['K-에듀파인'],
  공문: ['문서관리'],
  예산: ['예ㆍ결산', '학교회계'],
  결산: ['예ㆍ결산'],
  운영위원회: ['학교운영위원회'],
  학운위: ['학교운영위원회'],
  환경: ['생태전환'],
  정보보안: ['정보보안'],
  스포츠: ['스포츠클럽'],
  팝스: ['학생건강체력평가'],
  PAPS: ['학생건강체력평가'],
  위클래스: ['상담'],
  상담: ['상담'],
  진로: ['진로'],
  다문화: ['다문화교육'],
  연수: ['교원연수'],
  장학: ['자율장학'],
  학부모: ['학부모참여교육', '학부모 참여'],
  교과서: ['교과용도서', '교과서'],
  독서: ['독서교육', '학교도서관'],
  도서관: ['학교도서관'],
  축제: ['학교 축제', '학예회'],
  교복: ['교복 구매'],
  급식: ['급식관리'],
  감염병: ['감염병'],
  인수인계: ['업무인계인수'],
  맞춤통합: ['학생맞춤통합지원', '학생맞춤형통합지원'],
  통합지원: ['학생맞춤통합지원', '학생맞춤형통합지원']
}

/** 무게를 낮출 흔한 낱말. 분장표에 늘 붙어 다니지만 업무를 가르는 데는 쓸모가 적다. */
const LIGHT_WORDS = new Set([
  '업무', '담당', '관리', '운영', '계획', '지원', '관련', '기타', '총괄', '업무분장', '부장', '교사', '담임',
  '학교', '교육', '추진', '실시', '처리', '사업', '활동', '각종', '주관', '협조', '보조', '전반'
])

/** 도우미 질문에서 뺄 말 */
const QUESTION_WORDS = new Set([
  '어떻게', '무엇', '뭐', '뭔가', '알려줘', '알려', '주세요', '해줘', '하나요', '해야', '하면', '되나요', '있나요',
  '관련', '대해', '대한', '자료', '방법', '절차', '순서', '작년', '올해', '이번', '다음', '그리고', '그런데'
])

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.(hwpx?|pdf|docx?|xlsx?|pptx?|zip|jpg|png|hwt|txt)$/g, ' ')
    .replace(/[0-9]+/g, ' ')
    .replace(/[^a-z가-힣]+/g, ' ')
    .trim()
}

function wordsOf(s: string): string[] {
  return normalize(s)
    .split(/\s+/)
    .filter((w) => w.length >= 2)
}

function gramsOf(word: string): string[] {
  if (word.length <= 2) return [word]
  const out: string[] = []
  for (let i = 0; i + 2 <= word.length; i++) out.push(word.slice(i, i + 2))
  return out
}

function gramSet(text: string): Set<string> {
  const out = new Set<string>()
  for (const w of wordsOf(text)) for (const g of gramsOf(w)) out.add(g)
  return out
}

interface Entry {
  item: HelpItem
  group: HelpGroup
  section: string
  titleFlat: string
  sectionFlat: string
  filesFlat: string[]
  title: Set<string>
  files: Set<string>
  sect: Set<string>
}

export interface HelpIndex {
  entries: Entry[]
  idf: Map<string, number>
}

const flat = (s: string): string => normalize(s).replace(/\s+/g, '')

/** 목록을 한 번 훑어 찾기 쉽게 만든다 */
export function buildIndex(catalog: HelpCatalog): HelpIndex {
  const entries: Entry[] = []
  const df = new Map<string, number>()
  for (const group of catalog.groups) {
    for (const sec of group.sections) {
      for (const item of sec.items) {
        const title = gramSet(item.title)
        const files = gramSet(item.files.join(' '))
        const sect = gramSet(sec.title)
        entries.push({
          item,
          group,
          section: sec.title,
          titleFlat: flat(item.title),
          sectionFlat: flat(sec.title),
          filesFlat: item.files.map(flat),
          title,
          files,
          sect
        })
        for (const g of new Set([...title, ...files])) df.set(g, (df.get(g) ?? 0) + 1)
      }
    }
  }
  const n = entries.length || 1
  const idf = new Map<string, number>()
  for (const [g, c] of df) idf.set(g, Math.log(1 + n / c))
  return { entries, idf }
}

/** 낱말 하나를 이름 그대로 또는 흔히 부르는 다른 이름으로 */
function variants(word: string): string[] {
  const out = new Set([word])
  for (const [k, list] of Object.entries(SYNONYMS)) {
    const key = k.toLowerCase()
    if (word === key || (key.length >= 2 && word.startsWith(key))) for (const v of list) out.add(flat(v))
  }
  return [...out].filter((v) => v.length >= 2)
}

interface WordScore {
  score: number
  weight: number
  /** 파일 이름에 걸렸으면 그 이름 */
  files: number[]
}

function wordScore(ix: HelpIndex, e: Entry, word: string, light: boolean): WordScore {
  const grams = gramsOf(word)
  const weight = grams.reduce((s, g) => s + (ix.idf.get(g) ?? Math.log(1 + ix.entries.length)), 0) / grams.length
  let best = 0
  let files: number[] = []
  for (const v of variants(word)) {
    const vg = gramsOf(v)
    const total = vg.reduce((s, g) => s + (ix.idf.get(g) ?? 1), 0) || 1
    const frac = (set: Set<string>): number => vg.reduce((s, g) => s + (set.has(g) ? ix.idf.get(g) ?? 1 : 0), 0) / total
    const inTitle = e.titleFlat.includes(v) ? 1 : 0.8 * frac(e.title)
    const hitFiles: number[] = []
    e.filesFlat.forEach((f, i) => {
      if (f.includes(v)) hitFiles.push(i)
    })
    const inFiles = hitFiles.length ? Math.min(0.75, 0.5 + 0.05 * hitFiles.length) : 0.45 * frac(e.files)
    const inSect = e.sectionFlat.includes(v) ? 0.4 : 0
    const s = Math.max(inTitle, inFiles, inSect)
    if (s > best) best = s
    if (hitFiles.length > files.length) files = hitFiles
  }
  return { score: best, weight: light ? weight * 0.3 : weight, files }
}

function toHit(e: Entry, score: number, fileIdx: number[]): HelpHit {
  return {
    id: e.item.id,
    title: e.item.title,
    groupId: e.group.id,
    group: e.group.label,
    section: e.section,
    url: e.item.url,
    fileCount: e.item.files.length,
    matched: [...new Set(fileIdx)].slice(0, 6).map((i) => e.item.files[i]),
    score
  }
}

/** 이 학교급에서 볼 묶음. 학교급을 모르면 모두 본다. */
function allowedGroups(level: string): Set<HelpGroupId> | null {
  const g = levelGroup(level)
  return g ? new Set<HelpGroupId>([g, ...COMMON_GROUPS]) : null
}

/** 목차(0. 일러두기 및 목록)는 업무가 아니라서 고를 거리에서 뺀다 */
const isIndex = (e: Entry): boolean => /^0\./.test(e.section)

/**
 * 교감 업무·신규 교사 도움자료처럼 여러 업무를 한데 모은 폴더는 파일 이름이 온갖 업무에 걸린다.
 * 그 업무의 자기 폴더가 먼저 나오게 덜 친다.
 */
const bundleFactor = (e: Entry): number => (/도움자료/.test(e.item.title) ? 0.6 : 1)

/**
 * 적은 업무 한 줄에 맞는 도움자료를 고른다. 0~1 사이 점수로 매긴다.
 * 줄의 낱말마다 제목·파일 이름에 얼마나 걸리는지 보고, 흔한 낱말(업무·운영…)은 덜 친다.
 */
export function matchLine(ix: HelpIndex, line: string, level: string, limit = 3): HelpHit[] {
  const words = [...new Set(wordsOf(line))]
  if (!words.length) return []
  const allowed = allowedGroups(level)
  const out: HelpHit[] = []
  for (const e of ix.entries) {
    if (isIndex(e)) continue
    if (allowed && !allowed.has(e.group.id)) continue
    let sum = 0
    let wsum = 0
    const files: number[] = []
    for (const w of words) {
      const r = wordScore(ix, e, w, LIGHT_WORDS.has(w))
      sum += r.score * r.weight
      wsum += r.weight
      if (r.score >= 0.5) files.push(...r.files)
    }
    let score = wsum ? sum / wsum : 0
    // 같은 이름의 업무가 학교급 묶음과 교무행정 양쪽에 있으면 학교급 쪽을 앞세운다
    if (COMMON_GROUPS.includes(e.group.id)) score *= 0.85
    score *= bundleFactor(e)
    if (score >= 0.42) out.push(toHit(e, Math.round(score * 100) / 100, files))
  }
  out.sort((a, b) => b.score - a.score)
  // 가장 잘 맞는 것보다 한참 처지는 것은 고를 거리로 내밀지 않는다
  const top = out[0]?.score ?? 0
  return out.filter((h) => h.score >= top * 0.6).slice(0, limit)
}

/** 분장표 글을 줄로 나눠 줄마다 맞는 것을 찾는다. 줄머리 번호·기호는 뗀다. */
export function matchDuties(ix: HelpIndex, text: string, level: string, perLine = 3): HelpMatch[] {
  const lines = text
    .split(/\r?\n|[,;]/)
    .map((l) => l.replace(/^[\s\-*•·○●□■◦▶>#\d.)]+/, '').trim())
    .filter((l) => l.length >= 2)
  const seen = new Set<string>()
  const out: HelpMatch[] = []
  for (const line of lines) {
    if (seen.has(line)) continue
    seen.add(line)
    out.push({ line, hits: matchLine(ix, line, level, perLine) })
    if (out.length >= 60) break
  }
  return out
}

/**
 * 통합 검색. 띄어 쓴 낱말을 모두 품은 업무만 낸다(다른 이름으로 불러도 된다).
 * 내 업무와 내 학교급 것을 앞에 둔다.
 */
export function searchHelp(ix: HelpIndex, query: string, level: string, mine: string[], limit = 15): HelpHit[] {
  const terms = query
    .split(/\s+/)
    .map(flat)
    .filter((t) => t.length >= 1)
  if (!terms.length) return []
  const home = levelGroup(level)
  const out: HelpHit[] = []
  for (const e of ix.entries) {
    let score = 0
    const files: number[] = []
    let all = true
    for (const t of terms) {
      let best = 0
      for (const v of variants(t).concat(t)) {
        let s = 0
        if (e.titleFlat.includes(v)) s += 5
        if (e.sectionFlat.includes(v)) s += 1
        const hit: number[] = []
        e.filesFlat.forEach((f, i) => {
          if (f.includes(v)) hit.push(i)
        })
        s += Math.min(5, hit.length)
        if (s > best) {
          best = s
          files.push(...hit)
        }
      }
      if (!best) {
        all = false
        break
      }
      score += best
    }
    if (!all) continue
    score *= bundleFactor(e)
    // 내 학교급 것을 앞에, 어느 학교나 쓰는 교무·일반행정을 그 다음에
    if (home && e.group.id === home) score += 6
    else if (home && COMMON_GROUPS.includes(e.group.id)) score += 2
    if (mine.includes(e.item.id)) score += 5
    out.push(toHit(e, score, files))
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

/**
 * 도우미 질문에 맞는 도움자료. 질문에는 조사·물음말이 섞여 있어 낱말마다 따로 보고,
 * 제목에 또렷이 걸리는 낱말이 있는 것만 낸다.
 */
export function retrieveHelp(ix: HelpIndex, question: string, level: string, mine: string[], limit = 3): HelpHit[] {
  const words = [...new Set(wordsOf(question))].filter((w) => !QUESTION_WORDS.has(w) && !LIGHT_WORDS.has(w))
  if (!words.length) return []
  const allowed = allowedGroups(level)
  const out: HelpHit[] = []
  for (const e of ix.entries) {
    if (isIndex(e)) continue
    if (allowed && !allowed.has(e.group.id)) continue
    let score = 0
    let strong = false
    const files: number[] = []
    for (const w of words) {
      const r = wordScore(ix, e, w, false)
      if (r.score < 0.5) continue
      score += r.score * r.weight
      if (r.score >= 0.8) strong = true
      files.push(...r.files)
    }
    if (!strong) continue
    score *= bundleFactor(e)
    if (mine.includes(e.item.id)) score *= 1.3
    out.push(toHit(e, Math.round(score * 100) / 100, files))
  }
  out.sort((a, b) => b.score - a.score)
  // 가장 잘 맞는 것의 절반도 안 되는 것은 뺀다 — 낱말 하나 겹친 것까지 싣지 않게
  const top = out[0]?.score ?? 0
  return out.filter((h) => h.score >= top * 0.5).slice(0, limit)
}

/** 도우미·AI 요약에 실을 글. 파일 내용은 없고 이름만 있다는 것을 밝힌다. */
export function helpSourceText(item: HelpItem, hit: HelpHit, max = 40): string {
  const first = [...hit.matched, ...item.files.filter((f) => !hit.matched.includes(f))].slice(0, max)
  return (
    `교육청 학교업무 도움자료의 자료 폴더입니다(${hit.group} › ${hit.section}). 파일 이름만 있고 내용은 없습니다.\n` +
    `들어 있는 파일 ${item.files.length}개${item.files.length > max ? ` 가운데 ${max}개` : ''}:\n` +
    first.map((f) => `- ${f}`).join('\n')
  )
}

export function findItem(catalog: HelpCatalog, id: string): { item: HelpItem; group: HelpGroup; section: string } | null {
  for (const group of catalog.groups)
    for (const sec of group.sections)
      for (const item of sec.items) if (item.id === id) return { item, group, section: sec.title }
  return null
}
