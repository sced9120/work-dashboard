/**
 * 도구 모음 · 받은 테마 — 저장소의 remote/catalog.json 하나로 모든 사용자에게 내려 준다.
 *
 * 만든이가 GitHub 에서 그 파일만 고치면(태그 · 새 버전 없이) 몇 시간 안에 모든 프로그램에 반영된다.
 * 바깥에서 받는 글이라 여기서 하나하나 걸러 쓴다:
 *  - 도구는 https 주소만 (브라우저로 연다)
 *  - 테마는 정해 둔 색 · 모양 토큰만, 값에는 주소를 적을 수 없게 ( : / 따옴표 ; 를 못 쓴다)
 * 잘못 적힌 항목은 그것만 빼고 나머지는 쓴다. 빠진 까닭은 dropped 에 남긴다(scripts/check-catalog.mjs 가 보여 준다).
 *
 * 이 파일은 다른 파일을 가져오지 않는다 — 검사 스크립트가 따로 읽어 쓴다.
 */

export type CatalogThemeBase = 'classic' | 'bento' | 'glass' | 'midnight' | 'lavender'

export interface CatalogTool {
  /** 영문 소문자 · 숫자 · - (메뉴에 고정할 때 이것으로 찾는다) */
  id: string
  name: string
  desc: string
  /** 이모지 한 개 (없으면 빈칸) */
  icon: string
  /** https 주소 */
  url: string
  /** 묶음 이름 (예: 학생부, 수업) */
  category: string
  tags: string[]
  /** 올린 날 YYYY-MM-DD — 30일 동안 '새로' 표시 */
  added: string
  /** 만든 사람 (선택) */
  by: string
}

export interface CatalogTheme {
  id: string
  name: string
  desc: string
  /** 모양은 이 테마를 따르고 색만 바꾼다 */
  base: CatalogThemeBase
  light: Record<string, string>
  dark: Record<string, string>
}

export interface Catalog {
  schema: number
  updated: string
  tools: CatalogTool[]
  themes: CatalogTheme[]
  /**
   * 의견 · 오류 보내기 설문지 주소 (https). 비면 의견 보내기 단추를 숨긴다.
   * 주소 안의 {version} · {os} 는 열 때 프로그램 버전 · 윈도우 버전으로 바꾼다(구글 설문지 '미리 채워진 링크').
   */
  feedback: string
}

/** 프로그램 화면이 받는 것 */
export interface CatalogResult {
  catalog: Catalog
  /** 마지막으로 받은 때 (ms). 한 번도 못 받았으면 0 */
  fetchedAt: number
  /** net = 방금 받음 · cache = 이 PC 에 둔 것 · builtin = 설치파일에 든 것 */
  from: 'net' | 'cache' | 'builtin'
  /** 이번에 받으려다 안 된 까닭 (있으면) */
  error?: string
}

export const EMPTY_CATALOG: Catalog = { schema: 1, updated: '', tools: [], themes: [], feedback: '' }

/** 받은 테마가 바꿀 수 있는 토큰 (src/themes.css 의 테마별 토큰과 같다. 메뉴 너비처럼 배치가 깨지는 것은 뺐다) */
export const THEME_VARS: readonly string[] = [
  '--bg', '--app-bg', '--surface', '--surface-2', '--surface-3', '--surface-solid', '--field-bg', '--btn-bg',
  '--border', '--border-strong', '--text', '--text-2', '--muted',
  '--accent', '--accent-soft', '--accent-strong', '--on-accent', '--focus-ring', '--btn-hover-line',
  '--danger', '--danger-soft', '--danger-line', '--danger-hover', '--danger-hover-line',
  '--warn', '--warn-soft', '--ok', '--ok-soft',
  '--note-info-line', '--note-info-fg', '--note-warn-line', '--note-ok-line', '--note-danger-line',
  '--toast-bg', '--toast-fg', '--radius', '--radius-lg', '--radius-btn', '--home-gap', '--shadow', '--glass',
  '--raise', '--on-raise', '--raise-danger', '--chip', '--on-chip',
  '--stack-1', '--stack-2', '--fan-1', '--fan-2', '--on-fan', '--card-shadow',
  '--side-bg', '--side-fg', '--side-title', '--side-muted', '--side-section', '--side-hover', '--side-active', '--side-on-active', '--side-line',
  '--tour-dim', '--tour-ring'
]

const BASES: readonly CatalogThemeBase[] = ['classic', 'bento', 'glass', 'midnight', 'lavender']
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
/** 색 · 길이 · 그러데이션만. 주소(url( · : · /)와 따옴표 · ; · { } 를 쓸 수 없다 */
const SAFE_VALUE = /^[#a-zA-Z0-9.,%()\s-]{1,160}$/
const MAX_TOOLS = 200
const MAX_THEMES = 30

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** 이모지 한 글자쯤 (글자 · 기호 몇 개까지) */
function iconOf(v: unknown): string {
  const s = str(v, 16)
  return [...s].length <= 4 ? s : ''
}

function httpsUrl(v: unknown): string {
  const s = str(v, 600)
  if (!/^https:\/\//i.test(s)) return ''
  try {
    const u = new URL(s)
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password ? u.href : ''
  } catch {
    return ''
  }
}

function varsOf(v: unknown, where: string, dropped: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const name = k.startsWith('--') ? k : `--${k}`
    const val = typeof raw === 'string' ? raw.trim() : ''
    if (!THEME_VARS.includes(name)) {
      dropped.push(`${where}: ${k} 는 바꿀 수 없는 토큰입니다`)
    } else if (!SAFE_VALUE.test(val) || /url\s*\(|image|expression/i.test(val)) {
      dropped.push(`${where}: ${k} 값 "${val.slice(0, 40)}" 을(를) 쓸 수 없습니다 (색 · 길이 · 그러데이션만)`)
    } else {
      out[name] = val
    }
  }
  return out
}

/** 받은 글을 걸러 쓸 수 있는 목록으로. 잘못된 항목은 빼고 까닭을 dropped 에 적는다 */
export function sanitizeCatalog(raw: unknown): { catalog: Catalog; dropped: string[] } {
  const dropped: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { catalog: { ...EMPTY_CATALOG, tools: [], themes: [] }, dropped: ['맨 바깥이 { } 묶음이 아닙니다'] }
  }
  const r = raw as Record<string, unknown>
  const schema = typeof r.schema === 'number' ? r.schema : 1
  if (schema > 1) dropped.push(`schema ${schema} 은(는) 이 버전이 모르는 형식입니다 — 아는 칸만 씁니다`)

  const tools: CatalogTool[] = []
  const seen = new Set<string>()
  const rawTools = Array.isArray(r.tools) ? r.tools : []
  rawTools.slice(0, MAX_TOOLS).forEach((t, i) => {
    const o = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
    const where = `도구 ${i + 1}번(${str(o.name, 20) || str(o.id, 20) || '이름 없음'})`
    const id = str(o.id, 40).toLowerCase()
    const name = str(o.name, 40)
    const url = httpsUrl(o.url)
    if (!ID.test(id)) return void dropped.push(`${where}: id 는 영문 소문자 · 숫자 · - 로 적어 주세요`)
    if (seen.has(id)) return void dropped.push(`${where}: id "${id}" 가 겹칩니다`)
    if (!name) return void dropped.push(`${where}: name(이름)이 비었습니다`)
    if (!url) return void dropped.push(`${where}: url 은 https:// 로 시작하는 주소여야 합니다`)
    seen.add(id)
    const added = str(o.added, 10)
    tools.push({
      id,
      name,
      desc: str(o.desc, 240),
      icon: iconOf(o.icon),
      url,
      category: str(o.category, 20) || '도구',
      tags: (Array.isArray(o.tags) ? o.tags : []).map((x) => str(x, 20)).filter(Boolean).slice(0, 10),
      added: DAY.test(added) ? added : '',
      by: str(o.by, 30)
    })
  })
  if (rawTools.length > MAX_TOOLS) dropped.push(`도구는 ${MAX_TOOLS}개까지만 씁니다`)

  const themes: CatalogTheme[] = []
  const seenTheme = new Set<string>()
  const rawThemes = Array.isArray(r.themes) ? r.themes : []
  rawThemes.slice(0, MAX_THEMES).forEach((t, i) => {
    const o = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
    const where = `테마 ${i + 1}번(${str(o.name, 20) || str(o.id, 20) || '이름 없음'})`
    const id = str(o.id, 40).toLowerCase()
    const name = str(o.name, 20)
    const base = BASES.find((b) => b === o.base)
    if (!ID.test(id)) return void dropped.push(`${where}: id 는 영문 소문자 · 숫자 · - 로 적어 주세요`)
    if (seenTheme.has(id)) return void dropped.push(`${where}: id "${id}" 가 겹칩니다`)
    if (!name) return void dropped.push(`${where}: name(이름)이 비었습니다`)
    if (!base) return void dropped.push(`${where}: base 는 bento · glass · classic · midnight · lavender 가운데 하나여야 합니다`)
    const light = varsOf(o.light, `${where} light`, dropped)
    const dark = varsOf(o.dark, `${where} dark`, dropped)
    if (!Object.keys(light).length && !Object.keys(dark).length) return void dropped.push(`${where}: 바꿀 색이 하나도 없습니다`)
    seenTheme.add(id)
    themes.push({ id, name, desc: str(o.desc, 80), base, light, dark })
  })
  if (rawThemes.length > MAX_THEMES) dropped.push(`테마는 ${MAX_THEMES}개까지만 씁니다`)

  // 의견 보내기 — { "url": "https://..." } 또는 주소 글자 그대로
  const fbRaw = r.feedback && typeof r.feedback === 'object' ? (r.feedback as Record<string, unknown>).url : r.feedback
  const feedback = fbRaw ? httpsUrl(fbRaw) : ''
  if (fbRaw && !feedback) dropped.push('feedback(의견 보내기) 주소는 https:// 로 시작해야 합니다')

  return { catalog: { schema: 1, updated: str(r.updated, 20), tools, themes, feedback }, dropped }
}

/** 의견 보내기 주소에 버전을 채운다. {version} · {os} (주소 안에서 %7B…%7D 로 바뀌어 있어도) */
export function fillFeedback(url: string, version: string, os: string): string {
  const put = (s: string, key: string, v: string): string => s.replace(new RegExp(`([{]|%7B)${key}([}]|%7D)`, 'gi'), encodeURIComponent(v))
  return put(put(url, 'version', version), 'os', os)
}

/** 올린 지 30일 안이면 '새로' */
export function isNewTool(t: CatalogTool, today: string): boolean {
  if (!t.added) return false
  const a = Date.parse(`${t.added}T00:00:00`)
  const b = Date.parse(`${today}T00:00:00`)
  return Number.isFinite(a) && Number.isFinite(b) && b - a >= 0 && b - a <= 30 * 86400000
}
