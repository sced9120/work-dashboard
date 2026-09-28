/**
 * 발표자료(PPT) 만들기에 쓰는 자료 모양.
 *
 * AI 는 슬라이드의 "내용"만 만든다(제목·목록·카드·표·발표 메모).
 * 모양은 프로그램이 입힌다 — 기본 디자인이면 electron/main/slides.ts 가 직접 그리고,
 * 참고 PPT 를 주면 그 파일의 슬라이드 마스터·레이아웃을 그대로 살려 쓴다.
 */

export type SlideKind = '표지' | '구역' | '목록' | '카드' | '표' | '마무리'

export const SLIDE_KINDS: SlideKind[] = ['표지', '구역', '목록', '카드', '표', '마무리']

export interface SlideCard {
  title: string
  body: string
}

export interface Slide {
  kind: SlideKind
  title: string
  /** 표지·구역·마무리의 작은 글 */
  sub?: string
  bullets?: string[]
  cards?: SlideCard[]
  /** 첫 줄이 머리 행 */
  table?: string[][]
  /** 발표할 때 읽을 메모. PPT 의 [슬라이드 노트]에 들어간다. */
  notes?: string
}

export interface Deck {
  title: string
  slides: Slide[]
}

/** 색은 # 없는 여섯 자리 16진수 */
export interface SlideTheme {
  bg: string
  surface: string
  ink: string
  muted: string
  accent: string
  deep: string
  titleFont: string
  bodyFont: string
  /** 표지를 짙은 바탕에 흰 글씨로 */
  darkCover: boolean
}

export interface BuiltinDesign {
  id: string
  name: string
  theme: SlideTheme
}

const FONT = '맑은 고딕'

export const BUILTIN_DESIGNS: BuiltinDesign[] = [
  {
    id: 'blue',
    name: '맑은 파랑',
    theme: { bg: 'FFFFFF', surface: 'EEF3FB', ink: '1F2937', muted: '6B7280', accent: '2563EB', deep: '1E3A8A', titleFont: FONT, bodyFont: FONT, darkCover: true }
  },
  {
    id: 'green',
    name: '칠판 초록',
    theme: { bg: 'F7FAF5', surface: 'E3EFE0', ink: '1F2A1F', muted: '5B6B5B', accent: '2F855A', deep: '234E3A', titleFont: FONT, bodyFont: FONT, darkCover: true }
  },
  {
    id: 'warm',
    name: '따뜻한 주황',
    theme: { bg: 'FFFBF5', surface: 'FCE9D2', ink: '3B2A1A', muted: '7A6552', accent: 'DD6B20', deep: '7B341E', titleFont: FONT, bodyFont: FONT, darkCover: false }
  },
  {
    id: 'navy',
    name: '차분한 남색',
    theme: { bg: 'FFFFFF', surface: 'EDF0F5', ink: '1A202C', muted: '5A6475', accent: '2C5282', deep: '1A365D', titleFont: FONT, bodyFont: FONT, darkCover: true }
  },
  {
    id: 'violet',
    name: '보라',
    theme: { bg: 'FFFFFF', surface: 'F1ECFB', ink: '22223B', muted: '6B6883', accent: '6B46C1', deep: '44337A', titleFont: FONT, bodyFont: FONT, darkCover: false }
  },
  {
    id: 'dark',
    name: '어두운 발표',
    theme: { bg: '1A1D24', surface: '262B35', ink: 'F1F5F9', muted: '94A3B8', accent: '38BDF8', deep: '0F1115', titleFont: FONT, bodyFont: FONT, darkCover: true }
  }
]

/** 디자인을 어디서 가져왔는지. 참고 파일은 경로만 들고 다니고 실제 읽기는 메인에서 한다. */
export interface DesignSource {
  kind: 'builtin' | 'pptx' | 'designmd'
  label: string
  theme: SlideTheme
  builtinId?: string
  path?: string
  /** 참고 파일을 읽으며 알게 된 것 — 화면에 그대로 보여 준다 */
  notes?: string[]
}

export function builtinSource(id: string): DesignSource {
  const d = BUILTIN_DESIGNS.find((x) => x.id === id) ?? BUILTIN_DESIGNS[0]
  return { kind: 'builtin', label: d.name, theme: d.theme, builtinId: d.id }
}

/* ---------- 화면에서 고치기 ---------- */

/**
 * 슬라이드 본문을 글상자 하나로 고칠 수 있게 펼친다.
 * 목록은 한 줄에 하나, 카드는 "제목: 내용", 표는 "칸 | 칸 | 칸".
 */
export function bodyText(s: Slide): string {
  if (s.kind === '목록') return (s.bullets ?? []).join('\n')
  if (s.kind === '카드') return (s.cards ?? []).map((c) => `${c.title}: ${c.body}`).join('\n')
  if (s.kind === '표') return (s.table ?? []).map((r) => r.join(' | ')).join('\n')
  return s.sub ?? ''
}

export function withBody(s: Slide, text: string): Slide {
  const lines = text.split('\n').map((l) => l.trim())
  const kept = lines.filter(Boolean)
  const next: Slide = { kind: s.kind, title: s.title, ...(s.notes ? { notes: s.notes } : {}) }
  if (s.kind === '목록') next.bullets = kept
  else if (s.kind === '카드') {
    next.cards = kept.map((l) => {
      const at = l.search(/[:：]/)
      return at > 0 ? { title: l.slice(0, at).trim(), body: l.slice(at + 1).trim() } : { title: l, body: '' }
    })
  } else if (s.kind === '표') next.table = kept.map((l) => l.split('|').map((c) => c.trim()))
  else next.sub = text.trim()
  return next
}

/** 모양을 바꿀 때 내용을 최대한 옮겨 준다 */
export function changeKind(s: Slide, kind: SlideKind): Slide {
  const lines = bodyText(s)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return withBody({ kind, title: s.title, notes: s.notes }, lines.join('\n'))
}

/* ---------- AI 답 읽기 ---------- */

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function kindOf(v: unknown): SlideKind {
  const s = str(v)
  if ((SLIDE_KINDS as string[]).includes(s)) return s as SlideKind
  if (/표지|제목/.test(s)) return '표지'
  if (/구역|간지|장/.test(s)) return '구역'
  if (/카드|단계/.test(s)) return '카드'
  if (/표/.test(s)) return '표'
  if (/마무리|끝|감사/.test(s)) return '마무리'
  return '목록'
}

/**
 * AI 가 보낸 JSON 을 발표자료 모양으로 바로잡는다. 빠진 칸은 채우고 넘치는 것은 자른다.
 * 슬라이드 한 장에 글이 너무 많으면 화면을 넘치므로 여기서 한 번 더 막는다.
 */
export function normalizeDeck(raw: unknown, fallbackTitle: string): Deck {
  const o = (raw ?? {}) as Record<string, unknown>
  const list = Array.isArray(o.슬라이드) ? o.슬라이드 : Array.isArray(o.slides) ? o.slides : []
  const slides: Slide[] = []
  for (const item of list.slice(0, 40)) {
    const r = (item ?? {}) as Record<string, unknown>
    const kind = kindOf(r.모양 ?? r.kind)
    const title = str(r.제목 ?? r.title).slice(0, 80)
    const notes = str(r.메모 ?? r.notes).slice(0, 1500)
    const s: Slide = { kind, title, ...(notes ? { notes } : {}) }
    const sub = str(r.부제 ?? r.sub)
    if (kind === '목록') {
      const b = Array.isArray(r.내용) ? r.내용 : Array.isArray(r.bullets) ? r.bullets : []
      s.bullets = b.map(str).filter(Boolean).slice(0, 7).map((t) => t.slice(0, 120))
    } else if (kind === '카드') {
      const c = Array.isArray(r.카드) ? r.카드 : Array.isArray(r.cards) ? r.cards : []
      s.cards = c
        .map((x) => {
          const y = (x ?? {}) as Record<string, unknown>
          return { title: str(y.제목 ?? y.title).slice(0, 40), body: str(y.내용 ?? y.body).slice(0, 160) }
        })
        .filter((x) => x.title || x.body)
        .slice(0, 4)
    } else if (kind === '표') {
      const t = Array.isArray(r.표) ? r.표 : Array.isArray(r.table) ? r.table : []
      const rows = t
        .filter((row): row is unknown[] => Array.isArray(row))
        .map((row) => row.map(str).slice(0, 5).map((c) => c.slice(0, 60)))
        .filter((row) => row.some(Boolean))
        .slice(0, 8)
      const width = Math.max(0, ...rows.map((row) => row.length))
      s.table = rows.map((row) => [...row, ...Array(width - row.length).fill('')])
    } else if (sub) s.sub = sub.slice(0, 200)
    if (!s.title && kind !== '마무리') continue
    slides.push(s)
  }
  return { title: str(o.제목 ?? o.title) || fallbackTitle, slides }
}
