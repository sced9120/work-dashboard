/**
 * 세특 작성실 — 학생부 살펴보기 · 주제 지도 (3.7.5~).
 * 한 학생의 학생부에서 주제를 뽑아 서로 잇고(옵시디언의 그래프처럼), 다음에 이어 갈 주제를 어느 영역에 두면 좋은지 보여 준다.
 * 읽는 관점과 '지킬 것'은 보고서(seteukReview.ts)와 같은 것을 쓴다. electron 도 DOM 도 쓰지 않는다.
 */

import type { ModelChoice } from './types'
import type { ReviewGrade } from './seteukReview'
import { reviewPerspective } from './seteukReview'

export type MapKind = '교과' | '자율' | '진로' | '동아리'

export interface MapTopic {
  id: string
  /** 12자 안쪽 주제명 */
  name: string
  /** 과목명 또는 자율 · 동아리 · 진로 · 행발 */
  areas: string[]
  /** 학생부 원문 인용 1~3개 */
  evidence: string[]
  /** 교과 역량 또는 공동체 역량 등 */
  competency: string
}
export interface MapLink {
  a: string
  b: string
  why: string
}
export interface MapSuggest {
  topic: string
  area: string
  kind: MapKind
  why: string
  /** 이어지는 기존 주제 id */
  from: string
  competency: string
  /** 교과 추천인데 학생부에 없는 과목 — 교사가 확인하라는 표시 */
  newArea?: boolean
}
export interface TopicMap {
  topics: MapTopic[]
  links: MapLink[]
  suggests: MapSuggest[]
}

export interface SeteukMapRequest {
  text: string
  grade: ReviewGrade
  career: string
  model?: ModelChoice
  dry?: boolean
}
export interface SeteukMapReply {
  ok: boolean
  error?: string
  map?: TopicMap
  /** dry 일 때 — 요청 글 */
  text?: string
}
export interface SeteukMapExportReply {
  ok: boolean
  error?: string
  /** 만든 폴더 */
  path?: string
  count?: number
}

export const MAP_MAX_TOPICS = 12
export const MAP_MAX_LINKS = 24
export const MAP_MAX_SUGGESTS = 6
export const MAP_KINDS: MapKind[] = ['교과', '자율', '진로', '동아리']
/** 교과가 아닌 영역(창체 · 행발) */
export const CHANGCHE_AREAS = ['자율', '동아리', '진로', '행발']
/** 학생부 머리에 붙는 말 가운데 과목이 아닌 것 */
const GENERIC_AREAS = ['과세특', '개세특', '세특', '교과', '교과세특', '창체', '창의적체험활동', '행동특성', '종합의견']

/** 교과냐 창체(자율 · 동아리 · 진로 · 행발)냐 */
export const areaKind = (area: string): '교과' | '창체' => (CHANGCHE_AREAS.includes(area) ? '창체' : '교과')

/* ---------- 지시문 ---------- */

const MAP_ROLE = `# 역할
당신은 학교생활기록부를 오래 써 온 고등학교 교사다. 동료 교사가 쓴 한 학생의 학생부를 읽고, 학생부에 드러난 탐구 주제를 지도(그래프)로 정리하고 다음에 이어 갈 주제를 어디에 두면 좋을지 제안한다.`

const MAP_TASK = `# 할 일 — 주제 지도
1. 주제 추출: 학생부에 실제로 있는 주제를 5~12개 뽑는다. 없는 주제를 지어내지 않는다.
   - id: t1, t2 … 차례로.
   - name: 12자 안쪽의 짧은 주제명(예: "유리함수 점근선").
   - areas: 그 주제가 나온 영역. 과목명(학생부에 쓰인 그대로) 또는 자율 · 동아리 · 진로 · 행발. 한 주제가 여러 영역에 걸치면 모두 쓴다.
   - evidence: 학생부 원문을 그대로 짧게 인용(1~3개, 각 60자 안팎). 고쳐 쓰거나 지어내지 않는다.
   - competency: 그 주제에서 드러난 교과 역량 또는 공동체 역량 등을 한 구절로(예: "수학적 추론", "협력 · 소통").
2. 연결: 개념 · 방법 · 질문을 함께 쓰는 주제끼리 잇는다. 억지로 잇지 않는다. 각 연결에 why 를 한 구절로 쓴다(예: "둘 다 빈도를 세어 규칙을 찾음").
3. 추천: 다음에 이어 갈 주제를 3~6개 제안한다.
   - 각 추천에 어느 기존 주제에서 이어지는지 from(주제 id)을 쓴다. 새 활동을 여러 개 늘리기보다 이미 한 탐구를 깊이 하거나 다른 과목의 개념으로 다시 보는 것을 먼저 권한다.
   - kind: 교과 · 자율 · 진로 · 동아리 가운데 하나. area: kind 가 교과이면 과목명, 아니면 kind 와 같은 말.
   - 중요한 규칙 — 교과와 자율 · 진로의 구분:
     · 과목(교과 세특)에 두는 추천은 그 과목 자체의 역량을 보여 주는, 그 과목 교육과정에 맞는 탐구여야 한다. 예) 수학이면 수학적 모델링 · 추론 · 문제 해결처럼 수학의 역량을 쓰는 탐구이지, 진로 관심만 이은 활동이 아니다.
     · 학생 자신의 관심이나 진로 탐색일 뿐 그 과목의 역량과 이어지지 않는 주제는 과목에 두지 않고 자율 또는 진로에 둔다(동아리 활동 맥락이면 동아리).
     · 모든 과목을 진로에 억지로 잇지 않는다.
   - why: 왜 이 영역에서 이 탐구가 맞는지, 어떤 역량이 드러나는지 한두 구절. competency: 그 영역에서 드러날 역량.
   - 위 '지킬 것'을 모두 따른다. 대회 · 논문 · 외부 프로그램 · 사교육 · 대학명은 추천하지 않고, 학교 수업과 학교가 주최 · 주관하는 활동 안에서만 제안한다. 점수 · 등급 · 합격 가능성은 말하지 않는다.`

const MAP_OUTPUT = `# 출력
JSON 하나만 낸다. 설명 · 머리말 · 코드 울타리 없이 아래 모양 그대로.
{"topics":[{"id":"t1","name":"","areas":[""],"evidence":[""],"competency":""}],"links":[{"a":"t1","b":"t2","why":""}],"suggests":[{"topic":"","area":"","kind":"교과","why":"","from":"t1","competency":""}]}
학생은 '이 학생'으로 부르고, 학생1 같은 가명은 그대로 둔다. 주제명 · 인용 · 이유는 한국어로.`

/** 주제 지도 지시문 — 읽는 관점 · 지킬 것은 학생부 살펴보기(보고서)와 같다 */
export function buildMapSystem(): string {
  return [MAP_ROLE, reviewPerspective(), MAP_TASK, MAP_OUTPUT].join('\n\n')
}

export function buildMapUser(maskedText: string, grade: ReviewGrade, career: string): string {
  const info = [`- 학년: ${grade}학년`]
  if (career.trim()) info.push(`- 진로 희망: ${career.trim().replace(/\s+/g, ' ')}`)
  return `# 학생 정보\n${info.join('\n')}\n\n# 학생부\n${maskedText.trim()}`
}

/* ---------- 읽기 ---------- */

const clip = (v: unknown, max: number): string => {
  const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max).trim() : t
}
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v])

/** 모델 답에서 JSON 객체를 꺼낸다 — 코드 울타리 · 앞뒤 말 · 끝의 쉼표를 견딘다 */
export function extractJson(raw: string): unknown {
  const s = String(raw ?? '')
    .replace(/```(?:json)?/gi, '')
    .trim()
  const tries: string[] = [s]
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a >= 0 && b > a) tries.push(s.slice(a, b + 1))
  for (const t of tries) {
    for (const x of [t, t.replace(/,\s*([}\]])/g, '$1')]) {
      try {
        const j = JSON.parse(x)
        if (j && typeof j === 'object') return j
      } catch {
        // 다음 방법
      }
    }
  }
  return null
}

/** '자율활동' → '자율' 처럼 영역 이름을 고른다 */
export function normArea(v: unknown): string {
  const a = clip(v, 14)
  if (/^자율/.test(a)) return '자율'
  if (/^동아리/.test(a)) return '동아리'
  if (/^진로/.test(a)) return '진로'
  if (/^(행발|행동특성|종합의견)/.test(a)) return '행발'
  return a
}

/** 학생부 글에 머리로 붙은 영역 이름 — '[수학]' · '[과세특 · 수학 탐구]' 에서 뽑는다. 머리가 하나도 없으면 null(검사하지 않음) */
export function recordAreas(text: string): string[] | null {
  const out = new Set<string>()
  for (const m of String(text ?? '').matchAll(/\[([^\]\n]{1,40})\]/g)) {
    for (const p of m[1].split('·')) {
      const a = normArea(p)
      if (a.length >= 2 && !GENERIC_AREAS.includes(a)) out.add(a)
    }
  }
  return out.size ? [...out] : null
}

const areaSeen = (a: string, seen: string[] | null): boolean =>
  !seen || CHANGCHE_AREAS.includes(a) || seen.some((s) => s === a || (a.length >= 2 && (s.includes(a) || a.includes(s))))

/**
 * 모델 답을 지도로 읽는다. JSON 이 아니거나 모양이 틀리면 빈 지도.
 * record 를 주면 영역 이름을 그 글에서 본 것(과목)과 자율 · 동아리 · 진로 · 행발로만 받는다.
 */
export function parseMap(raw: string, record?: string): TopicMap {
  const empty: TopicMap = { topics: [], links: [], suggests: [] }
  const j = extractJson(raw) as { topics?: unknown; links?: unknown; suggests?: unknown } | null
  if (!j || typeof j !== 'object') return empty
  const seen = record == null ? null : recordAreas(record)

  const topics: MapTopic[] = []
  const used = new Set<string>()
  for (const t of list(j.topics)) {
    if (topics.length >= MAP_MAX_TOPICS) break
    const o = (t ?? {}) as Record<string, unknown>
    const name = clip(o.name, 12)
    if (!name) continue
    let id = clip(o.id, 20).replace(/\s+/g, '') || `t${topics.length + 1}`
    while (used.has(id)) id += '_'
    used.add(id)
    const areas: string[] = []
    for (const a of list(o.areas)) {
      const n = normArea(a)
      if (n && !areas.includes(n) && areaSeen(n, seen) && areas.length < 4) areas.push(n)
    }
    const evidence = list(o.evidence)
      .map((e) => clip(e, 90))
      .filter(Boolean)
      .slice(0, 3)
    topics.push({ id, name, areas, evidence, competency: clip(o.competency, 40) })
  }

  const byId = new Map(topics.map((t) => [t.id, t]))
  const pairs = new Set<string>()
  const links: MapLink[] = []
  for (const l of list(j.links)) {
    if (links.length >= MAP_MAX_LINKS) break
    const o = (l ?? {}) as Record<string, unknown>
    const a = clip(o.a, 20)
    const b = clip(o.b, 20)
    if (!byId.has(a) || !byId.has(b) || a === b) continue
    const key = [a, b].sort().join('|')
    if (pairs.has(key)) continue
    pairs.add(key)
    links.push({ a, b, why: clip(o.why, 120) })
  }

  const suggests: MapSuggest[] = []
  for (const s of list(j.suggests)) {
    if (suggests.length >= MAP_MAX_SUGGESTS) break
    const o = (s ?? {}) as Record<string, unknown>
    const topic = clip(o.topic, 16)
    if (!topic) continue
    const fromRaw = clip(o.from, 30)
    const from = byId.has(fromRaw) ? fromRaw : (topics.find((t) => t.name === fromRaw)?.id ?? '')
    if (!from) continue
    // 영역과 종류를 맞춘다 — 자율 · 동아리 · 진로(행발은 자율)에 두면 그 종류, 아니면 교과
    let area = normArea(o.area)
    let kind: MapKind
    const rawKind = clip(o.kind, 6) as MapKind
    if (area === '행발') area = '자율'
    if (area === '자율' || area === '동아리' || area === '진로') kind = area
    else if (area && (rawKind === '자율' || rawKind === '동아리' || rawKind === '진로')) {
      kind = rawKind
      area = rawKind
    } else if (area) kind = '교과'
    else if (MAP_KINDS.includes(rawKind) && rawKind !== '교과') {
      kind = rawKind
      area = rawKind
    } else continue
    const sug: MapSuggest = { topic, area, kind, why: clip(o.why, 140), from, competency: clip(o.competency, 40) }
    if (kind === '교과' && !areaSeen(area, seen)) sug.newArea = true
    suggests.push(sug)
  }
  return { topics, links, suggests }
}

/** 지도 안의 모든 글에 같은 바꾸기를 적용한다(가명을 이름으로 되돌릴 때) */
export function mapMapText(map: TopicMap, fn: (s: string) => string): TopicMap {
  return {
    topics: map.topics.map((t) => ({ ...t, name: fn(t.name), areas: t.areas.map(fn), evidence: t.evidence.map(fn), competency: fn(t.competency) })),
    links: map.links.map((l) => ({ ...l, why: fn(l.why) })),
    suggests: map.suggests.map((s) => ({ ...s, topic: fn(s.topic), area: fn(s.area), why: fn(s.why), competency: fn(s.competency) }))
  }
}

/* ---------- 배치 ---------- */

export interface Box {
  w: number
  h: number
}
/** 주제 글상자 크기 — 영역 수 · 인용 수가 많을수록 크게 */
export function topicWeight(t: MapTopic): number {
  return Math.min(6, t.areas.length + t.evidence.length)
}
export function topicFont(t: MapTopic): number {
  return 12 + topicWeight(t) * 0.5
}
export function topicBox(t: MapTopic): Box {
  const f = topicFont(t)
  return { w: Math.round(t.name.length * f * 1.02 + 26), h: Math.round(26 + topicWeight(t) * 2) }
}
export function suggestBox(s: MapSuggest): Box {
  return { w: Math.round(s.topic.length * 12 + 34), h: 26 }
}

export interface LayoutNode {
  /** 주제는 topic.id, 추천은 `sug:번호` */
  key: string
  type: 'topic' | 'suggest'
  index: number
  x: number
  y: number
  w: number
  h: number
}
export interface MapLayout {
  nodes: LayoutNode[]
  pos: Record<string, LayoutNode>
}
export const sugKey = (i: number): string => `sug:${i}`

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hash = (s: string): number => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * 같은 지도 · 같은 크기면 늘 같은 자리를 돌려준다.
 * 주제는 서로 이어진 것끼리 가깝게 원 위에 놓고 힘 모형(밀어내기 · 잇기 · 가운데로 당기기)을 정해진 횟수만큼 돌리고,
 * 추천은 이어지는 주제에서 바깥쪽으로 놓은 뒤, 상자끼리 겹치지 않게 밀어 내고 상자째 그림 안에 넣는다.
 */
export function layoutMap(map: TopicMap, w: number, h: number, margin: { x: number; y: number } = { x: 12, y: 10 }): MapLayout {
  const n = map.topics.length
  const A = Math.max(w, 1) / Math.max(h, 1)
  const rand = rng(hash(map.topics.map((t) => t.id).join('|') + '#' + map.suggests.map((s) => s.topic).join('|')))
  const idx = new Map(map.topics.map((t, i) => [t.id, i]))
  const adj: number[][] = map.topics.map(() => [])
  for (const l of map.links) {
    const a = idx.get(l.a)
    const b = idx.get(l.b)
    if (a != null && b != null) {
      adj[a].push(b)
      adj[b].push(a)
    }
  }
  // 1) 이어진 것이 이웃이 되도록 순서를 정해 타원 위에 놓는다
  const order: number[] = []
  const left = new Set(map.topics.map((_, i) => i))
  while (left.size) {
    let cur = [...left].sort((p, q) => adj[q].length - adj[p].length || p - q)[0]
    for (;;) {
      order.push(cur)
      left.delete(cur)
      const nx = adj[cur].filter((k) => left.has(k)).sort((p, q) => adj[q].length - adj[p].length || p - q)[0]
      if (nx == null) break
      cur = nx
    }
  }
  const px: number[] = new Array(n).fill(0)
  const py: number[] = new Array(n).fill(0)
  order.forEach((ti, k) => {
    const ang = (2 * Math.PI * k) / Math.max(n, 1) - Math.PI / 2
    px[ti] = Math.cos(ang) * A * 0.62 + (rand() - 0.5) * 0.04
    py[ti] = Math.sin(ang) * 0.62 + (rand() - 0.5) * 0.04
  })
  // 2) 힘 모형 — 정해진 횟수
  if (n > 1) {
    const k = Math.sqrt((4 * A) / n) * 0.9
    const ITER = 120
    for (let it = 0; it < ITER; it++) {
      const temp = 0.12 * (1 - it / ITER) + 0.004
      const dx: number[] = new Array(n).fill(0)
      const dy: number[] = new Array(n).fill(0)
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          let ex = px[i] - px[j]
          let ey = py[i] - py[j]
          const d = Math.max(Math.hypot(ex, ey), 0.03)
          const f = (k * k) / d
          ex /= d
          ey /= d
          dx[i] += ex * f
          dy[i] += ey * f
          dx[j] -= ex * f
          dy[j] -= ey * f
        }
      for (let i = 0; i < n; i++)
        for (const j of adj[i]) {
          if (j < i) continue
          let ex = px[i] - px[j]
          let ey = py[i] - py[j]
          const d = Math.max(Math.hypot(ex, ey), 0.03)
          const f = (d * d) / k
          ex /= d
          ey /= d
          dx[i] -= ex * f
          dy[i] -= ey * f
          dx[j] += ex * f
          dy[j] += ey * f
        }
      for (let i = 0; i < n; i++) {
        dx[i] -= px[i] * 0.5
        dy[i] -= py[i] * 0.5
        const len = Math.max(Math.hypot(dx[i], dy[i]), 1e-9)
        const step = Math.min(len, temp)
        px[i] += (dx[i] / len) * step
        py[i] += (dy[i] / len) * step
      }
    }
  }
  // 3) 추천 — 이어지는 주제에서 바깥쪽으로
  const cx = n ? px.reduce((a, b) => a + b, 0) / n : 0
  const cy = n ? py.reduce((a, b) => a + b, 0) / n : 0
  const sx: number[] = []
  const sy: number[] = []
  const share = new Map<string, number>()
  map.suggests.forEach((s) => share.set(s.from, (share.get(s.from) ?? 0) + 1))
  const seq = new Map<string, number>()
  map.suggests.forEach((s, i) => {
    const t = idx.get(s.from)
    const j = seq.get(s.from) ?? 0
    seq.set(s.from, j + 1)
    const m = share.get(s.from) ?? 1
    let ang = t == null ? (2 * Math.PI * i) / Math.max(map.suggests.length, 1) : Math.atan2(py[t] - cy, (px[t] - cx) / A)
    if (t != null && Math.hypot(px[t] - cx, py[t] - cy) < 0.05) ang = (2 * Math.PI * i) / Math.max(map.suggests.length, 1)
    ang += (j - (m - 1) / 2) * 0.55
    const bx = t == null ? cx : px[t]
    const by = t == null ? cy : py[t]
    sx.push(bx + Math.cos(ang) * A * 0.34)
    sy.push(by + Math.sin(ang) * 0.4)
  })
  // 4) 한 그림으로 맞춘다
  const all = [...px.map((x, i) => ({ x, y: py[i] })), ...sx.map((x, i) => ({ x, y: sy[i] }))]
  const minX = Math.min(...all.map((p) => p.x))
  const maxX = Math.max(...all.map((p) => p.x))
  const minY = Math.min(...all.map((p) => p.y))
  const maxY = Math.max(...all.map((p) => p.y))
  const nodes: LayoutNode[] = []
  const place = (key: string, type: LayoutNode['type'], index: number, x: number, y: number, box: Box): void => {
    nodes.push({ key, type, index, x, y, w: box.w, h: box.h })
  }
  const boxes: Box[] = [...map.topics.map(topicBox), ...map.suggests.map(suggestBox)]
  const halfW = boxes.length ? Math.max(...boxes.map((b) => b.w)) / 2 : 0
  const halfH = boxes.length ? Math.max(...boxes.map((b) => b.h)) / 2 : 0
  const innerX0 = margin.x + halfW
  const innerX1 = Math.max(innerX0, w - margin.x - halfW)
  const innerY0 = margin.y + halfH
  const innerY1 = Math.max(innerY0, h - margin.y - halfH)
  const fit = (v: number, lo: number, hi: number, a: number, b: number): number => (hi - lo < 1e-9 ? (a + b) / 2 : a + ((v - lo) / (hi - lo)) * (b - a))
  all.forEach((p, i) => {
    const x = fit(p.x, minX, maxX, innerX0, innerX1)
    const y = fit(p.y, minY, maxY, innerY0, innerY1)
    if (i < n) place(map.topics[i].id, 'topic', i, x, y, boxes[i])
    else place(sugKey(i - n), 'suggest', i - n, x, y, boxes[i])
  })
  // 5) 상자끼리 겹치지 않게 밀어 내고 그림 안에 넣는다
  const GAP = 6
  for (let it = 0; it < 80; it++) {
    let moved = false
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        const ox = (a.w + b.w) / 2 + GAP - Math.abs(a.x - b.x)
        const oy = (a.h + b.h) / 2 + GAP - Math.abs(a.y - b.y)
        if (ox <= 0 || oy <= 0) continue
        moved = true
        if (oy <= ox) {
          const s = a.y === b.y ? (i % 2 ? 1 : -1) : Math.sign(a.y - b.y)
          a.y += (s * oy) / 2
          b.y -= (s * oy) / 2
        } else {
          const s = a.x === b.x ? (i % 2 ? 1 : -1) : Math.sign(a.x - b.x)
          a.x += (s * ox) / 2
          b.x -= (s * ox) / 2
        }
      }
    for (const a of nodes) {
      a.x = Math.min(Math.max(a.x, a.w / 2 + 2), Math.max(w - a.w / 2 - 2, a.w / 2 + 2))
      a.y = Math.min(Math.max(a.y, a.h / 2 + 2), Math.max(h - a.h / 2 - 2, a.h / 2 + 2))
    }
    if (!moved) break
  }
  for (const a of nodes) {
    a.x = Math.round(a.x * 10) / 10
    a.y = Math.round(a.y * 10) / 10
  }
  const pos: Record<string, LayoutNode> = {}
  for (const a of nodes) pos[a.key] = a
  return { nodes, pos }
}

/* ---------- 옵시디언 · 마크다운 ---------- */

const safeName = (s: string): string =>
  s
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .slice(0, 40)
    .trim()

const tagOf = (s: string): string => s.replace(/[^0-9A-Za-z가-힣_-]/g, '')
const tags = (areas: string[], extra: string[]): string =>
  [...new Set([...extra, ...areas].map(tagOf).filter(Boolean))].map((t) => `#${t}`).join(' ')

/** 주제마다 노트 이름(파일 이름) — 겹치거나 index · 추천 과 같으면 번호를 붙인다 */
export function noteNames(map: TopicMap): Map<string, string> {
  const used = new Set(['index', '추천'])
  const out = new Map<string, string>()
  for (const t of map.topics) {
    const base = safeName(t.name) || '주제'
    let nm = base
    for (let k = 2; used.has(nm.toLowerCase()); k++) nm = `${base} ${k}`
    used.add(nm.toLowerCase())
    out.set(t.id, nm)
  }
  return out
}

/** 옵시디언 보관함에 넣을 노트들 — 주제마다 한 장, 목차(index), 추천 */
export function toObsidian(map: TopicMap, studentLabel: string): { path: string; content: string }[] {
  const names = noteNames(map)
  const nm = (id: string): string => names.get(id) ?? id
  const label = studentLabel.trim() || '학생'
  const files: { path: string; content: string }[] = []
  const nbr = new Map<string, MapLink[]>()
  for (const l of map.links) {
    nbr.set(l.a, [...(nbr.get(l.a) ?? []), l])
    nbr.set(l.b, [...(nbr.get(l.b) ?? []), l])
  }
  for (const t of map.topics) {
    const L: string[] = [`# ${t.name}`, '', tags(t.areas, ['주제', t.areas.length && t.areas.every((a) => areaKind(a) === '창체') ? '창체' : '교과']), '']
    if (t.areas.length) L.push(`- 영역: ${t.areas.join(' · ')}`)
    if (t.competency) L.push(`- 역량: ${t.competency}`)
    if (t.evidence.length) {
      L.push('', '## 학생부 원문', '')
      for (const e of t.evidence) L.push(`> ${e}`, '')
    }
    const ls = nbr.get(t.id) ?? []
    if (ls.length) {
      L.push('## 이어지는 주제', '')
      for (const l of ls) L.push(`- [[${nm(l.a === t.id ? l.b : l.a)}]]${l.why ? ` — ${l.why}` : ''}`)
      L.push('')
    }
    const sg = map.suggests.filter((s) => s.from === t.id)
    if (sg.length) {
      L.push('## 이어 갈 추천', '')
      for (const s of sg) L.push(`- ${s.topic} (${s.area}) — [[추천]]`)
      L.push('')
    }
    files.push({ path: `${nm(t.id)}.md`, content: L.join('\n').trimEnd() + '\n' })
  }
  const I: string[] = [`# 학생부 주제 지도 — ${label}`, '', '#주제지도', '', '## 주제', '']
  for (const t of map.topics) I.push(`- [[${nm(t.id)}]]${t.areas.length ? ` — ${t.areas.join(' · ')}` : ''}`)
  I.push('', '## 추천', '', '- [[추천]]', '', 'AI 가 학생부 글을 읽고 만든 정리입니다. 학생 · 수업 기록으로 확인한 뒤 쓰세요.')
  files.unshift({ path: 'index.md', content: I.join('\n') + '\n' })
  const R: string[] = [`# 이어 갈 주제 추천 — ${label}`, '', '#추천', '']
  for (const s of map.suggests) {
    R.push(`## ${s.topic}`, '', tags([s.area], ['추천', s.kind]), '', `- 영역: ${s.area} (${s.kind})${s.newArea ? ' — 학생부에 없는 과목, 확인 필요' : ''}`, `- 이어지는 주제: [[${nm(s.from)}]]`)
    if (s.why) R.push(`- 이유: ${s.why}`)
    if (s.competency) R.push(`- 역량: ${s.competency}`)
    R.push('')
  }
  if (!map.suggests.length) R.push('추천이 없습니다.', '')
  files.push({ path: '추천.md', content: R.join('\n').trimEnd() + '\n' })
  return files
}

/** 한 덩어리 마크다운 — [마크다운 복사] 용 */
export function toMarkdown(map: TopicMap, studentLabel: string): string {
  const byId = new Map(map.topics.map((t) => [t.id, t]))
  const L: string[] = [`# 학생부 주제 지도 — ${studentLabel.trim() || '학생'}`, '', '## 주제']
  for (const t of map.topics) {
    L.push('', `### ${t.name}`, `- 영역: ${t.areas.join(' · ') || '-'}`)
    if (t.competency) L.push(`- 역량: ${t.competency}`)
    for (const e of t.evidence) L.push(`> ${e}`)
  }
  if (map.links.length) {
    L.push('', '## 이어지는 주제')
    for (const l of map.links) L.push(`- ${byId.get(l.a)?.name ?? l.a} ↔ ${byId.get(l.b)?.name ?? l.b}${l.why ? ` — ${l.why}` : ''}`)
  }
  if (map.suggests.length) {
    L.push('', '## 이어 갈 추천')
    for (const s of map.suggests) L.push(`- **${s.topic}** (${s.area}) ← ${byId.get(s.from)?.name ?? s.from}${s.why ? ` — ${s.why}` : ''}${s.competency ? ` [${s.competency}]` : ''}`)
  }
  return L.join('\n') + '\n'
}

/** 폴더 이름 — 학생부지도_{학생}_{날짜} (이름에 못 쓰는 글자는 뺀다) */
export function mapFolderName(label: string, date: Date): string {
  const d = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  return `학생부지도_${safeName(label).replace(/\s+/g, '') || '학생'}_${d}`
}
