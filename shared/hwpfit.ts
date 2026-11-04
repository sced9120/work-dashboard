/**
 * 양식으로 새로 짠 문서가 양식과 맞는지 — 프로그램이 하는 대조와, 검사관 AI 의 답 읽기.
 *
 * 쓰는 AI 는 양식을 "틀"로 새 문서를 쓰다 보니 늘 쓰는 문장을 빠뜨리거나(개최 통지의 "이에 … 참석하셔서"),
 * 번호 매긴 항목 줄을 지우거나(2. 장소), 양식에 없던 설명 문단을 지어 넣는 일이 있었다.
 * 그래서 쓴 다음에 ① 여기서 기계적으로 양식과 맞춰 보고 ② 그 결과를 검사관 AI 에게 함께 주어
 * 고친 문서를 다시 받는다. 검사관이 답하지 못하면 쓴 그대로 두고, 남은 문제만 화면에 알린다.
 *
 * 글자 모양 쪽 도움(칸 맞춤 빈칸 되살리기, 『 』 안 굵게)도 여기 둔다 — hwpgen 이 쓴다.
 */
import type { DocItem } from './hwpform'

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()
const bare = (s: string): string => s.replace(/\s+/g, '')
const leadOf = (s: string): string => /^[^\S\t\n\r]*/.exec(s)?.[0] ?? ''

/* ---------- 칸 맞춤 빈칸 ---------- */

/**
 * "학생 학번:                    학생 성명: " 처럼 빈칸으로 칸을 맞춘 양식 줄에 값을 넣으면
 * AI 가 빈칸을 하나로 줄여 버린다. 양식에서 뒤 항목("학생 성명:")이 시작하던 자리에 다시 오도록
 * 앞 빈칸 수를 맞춘다. 사람이 손으로 하는 것과 같다(값이 네 글자면 빈칸을 네 개 덜).
 */
export function alignLike(sample: string, text: string): string {
  const body = sample.slice(leadOf(sample).length)
  const marks: { col: number; head: string }[] = []
  const re = / {3,}(?=\S)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const col = m.index + m[0].length
    const head = /^[^\s:：]{1,8}(?: [^\s:：]{1,8})?\s*[:：]/.exec(body.slice(col))?.[0]
    if (head) marks.push({ col, head: bare(head) })
  }
  if (!marks.length || text.includes('\n')) return text
  const lead = leadOf(text)
  let t = text.slice(lead.length)
  for (const mk of marks) {
    const idx = looseIndex(t, mk.head)
    if (idx <= 0 || t[idx - 1] !== ' ') continue
    let s = idx
    while (s > 0 && t[s - 1] === ' ') s--
    if (s === 0 || /[,，、·]/.test(t[s - 1])) continue
    const pad = Math.max(2, mk.col - s)
    t = t.slice(0, s) + ' '.repeat(pad) + t.slice(idx)
  }
  return lead + t
}

/** 빈칸을 무시하고 head 가 시작하는 자리 */
function looseIndex(t: string, head: string): number {
  for (let i = 0; i < t.length; i++) {
    if (t[i] === ' ') continue
    let j = i
    let k = 0
    while (j < t.length && k < head.length) {
      if (t[j] === ' ') {
        j++
        continue
      }
      if (t[j] !== head[k]) break
      j++
      k++
    }
    if (k === head.length) return i
  }
  return -1
}

/* ---------- 괄호 안 글자 모양 ---------- */

const PAIRS: [string, string][] = [
  ['『', '』'],
  ['「', '」'],
  ['《', '》'],
  ['〈', '〉'],
  ['“', '”'],
  ['‘', '’'],
  ['(', ')'],
  ['[', ']'],
  ['<', '>']
]

function spans(s: string, open: string, close: string): [number, number][] {
  const out: [number, number][] = []
  let from = 0
  for (;;) {
    const a = s.indexOf(open, from)
    if (a < 0) break
    const b = s.indexOf(close, a + 1)
    if (b < 0) break
    out.push([a, b])
    from = b + 1
  }
  return out
}

/**
 * 양식에서 『 』 안만 굵게(밑줄 등) 했으면 새 글에서도 『 』 안을 그 모양으로 한다.
 * 글이 많이 바뀌면 글자 견주기(LCS)로는 엉뚱한 글자(닫는 괄호 하나)만 굵어지는 일이 있었다.
 * 괄호 쌍은 나오는 차례대로 짝짓는다. 괄호 안 모양이 문단의 바탕 모양과 같으면 손대지 않는다.
 */
export function bracketShapes<T>(sample: string, shapes: T[], text: string, mapped: T[], base: T): T[] {
  const out = [...mapped]
  for (const [o, c] of PAIRS) {
    const a = spans(sample, o, c)
    if (!a.length) continue
    const b = spans(text, o, c)
    for (let k = 0; k < Math.min(a.length, b.length); k++) {
      const [s0, s1] = a[k]
      const [t0, t1] = b[k]
      if (s1 - s0 < 2 || t1 - t0 < 2) continue
      const inner = shapes.slice(s0 + 1, s1)
      const count = new Map<T, number>()
      inner.forEach((v) => count.set(v, (count.get(v) ?? 0) + 1))
      let top = inner[0]
      let n = 0
      for (const [v, x] of count) if (x > n) (top = v), (n = x)
      if (top === base || n < inner.length * 0.8) continue
      for (let i = t0 + 1; i < t1; i++) out[i] = top
      out[t0] = shapes[s0]
      out[t1] = shapes[s1]
    }
  }
  return out
}

/* ---------- 양식과 맞춰 보기 ---------- */

export interface FormPara {
  id: string
  text: string
  kind: string
}

export interface Finding {
  /** 빠진 문장 · 빠진 항목 · 번호 · 새 문단 · 제목 · 빈칸 */
  kind: string
  /** 양식 문단 번호 */
  where: string
  detail: string
}

const MARK = /^(?:\d+\.(?!\d)|\(\d+\)|\d+\)|[가-하]\.|\([가-하]\)|[가-하]\)|[□■○●◦ㅇ◎◇◆▶▷※*·•\-–—①-⑳])\s*/

/** 항목 줄의 이름: "1. 일 시: …" → "일시", "3. 참석대상" → "참석대상" */
export function itemKey(text: string): string {
  const t = squash(text)
  const m = MARK.exec(t)
  if (!m) {
    const c = /^([^:：]{1,10})[:：]/.exec(t)
    return c ? bare(c[1]) : ''
  }
  const rest = t.slice(m[0].length)
  const c = /^([^:：]{1,10})[:：]/.exec(rest)
  if (c) return bare(c[1])
  return bare(rest).slice(0, 6)
}

function numberOf(text: string): { kind: string; n: number } | null {
  const t = squash(text)
  let m = /^(\d+)\.(?!\d)/.exec(t)
  if (m) return { kind: '1.', n: +m[1] }
  m = /^([가-하])\./.exec(t)
  if (m) return { kind: '가.', n: '가나다라마바사아자차카타파하'.indexOf(m[1]) + 1 }
  return null
}

function sentences(text: string): string[] {
  return squash(text)
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 같은 구성이 되풀이된 양식(학생별 여러 장)은 첫 벌만 본다 */
function formUnit(form: FormPara[]): FormPara[] {
  const firstText = form.find((p) => p.kind === 'text')
  if (!firstText) return form
  const start = form.indexOf(firstText)
  const again = form.findIndex((p, i) => i > start + 2 && p.kind === 'text' && p.text === firstText.text)
  return again > 0 ? form.slice(0, again) : form
}

/** 새 문서를 벌로 나눈다 — 첫 문단의 본이 다시 나오면 다음 벌 */
function docUnits(items: DocItem[]): DocItem[][] {
  const first = items[0]?.sample
  const units: DocItem[][] = []
  let cur: DocItem[] = []
  items.forEach((it, i) => {
    if (i > 0 && it.sample === first && cur.length >= 3) {
      units.push(cur)
      cur = []
    }
    cur.push(it)
  })
  if (cur.length) units.push(cur)
  return units
}

const paraText = (it: DocItem): string => (it.kind === 'p' ? it.text : it.rows.map((r) => r.join(' ')).join(' '))

/**
 * 프로그램이 하는 대조. 양식의 첫 벌과 새 문서의 벌마다를 맞춰 보고, 같은 문제는 한 번만 적는다.
 *  - 빠진 문단: 숫자·"이름:" 없는 양식 문단(머리 줄 · 자르는 선 · 늘 쓰는 글)이 통째로 없음
 *  - 빠진 문장: 양식에서 숫자·가린 이름이 없는 10자 넘는 문장(늘 쓰는 문구)이 새 문서에 없음
 *  - 빠진 항목: 양식의 번호 줄·"이름:" 줄(일시, 장소 …)이 새 문서에 없음
 *  - 번호: 1. 다음에 3. 처럼 건너뜀
 *  - 새 문단: 양식의 긴 글 문단 하나의 모양으로 문단을 여러 개 씀(설명을 지어 붙인 경우가 많다)
 *  - 제목: 첫 문단이 양식과 다름
 *  - 빈칸: 받는 사람이 쓰는 ( ) 빈칸을 채움
 */
export function checkAgainstForm(form: FormPara[], items: DocItem[]): Finding[] {
  const unit = formUnit(form).filter((p) => p.kind === 'text')
  const out: Finding[] = []
  const seen = new Set<string>()
  const add = (f: Finding): void => {
    const k = `${f.kind}|${f.where}|${f.detail}`
    if (seen.has(k)) return
    seen.add(k)
    out.push(f)
  }
  const units = docUnits(items.filter((it) => paraText(it).trim()))
  if (!units.length || !unit.length) return out

  for (const u of units) {
    const all = bare(u.map(paraText).join(''))
    const keys = new Set(u.filter((it) => it.kind === 'p').map((it) => itemKey(paraText(it))).filter(Boolean))
    const paras = new Set(u.filter((it) => it.kind === 'p').map((it) => bare(paraText(it))))
    for (const p of unit) {
      // 문단이 통째로 없음 — 자르는 선(……), "학 부 모 의 견 서" 같은 머리 줄도 여기서 잡는다
      if (!/\d|○|[:：]/.test(p.text) && bare(p.text).length >= 2 && !paras.has(bare(p.text)) && (bare(p.text).length < 15 || !all.includes(bare(p.text)))) {
        add({ kind: '빠진 문단', where: p.id, detail: squash(p.text).slice(0, 40) })
        continue
      }
      for (const s of sentences(p.text)) {
        // 숫자·가린 이름이 든 문장은 이번 일마다 바뀌는 글, "이름:" 줄은 아래 '빠진 항목'에서 본다
        if (s.length < 10 || /\d|○|[:：]/.test(s) || !/[가-힣]/.test(s)) continue
        if (!all.includes(bare(s))) add({ kind: '빠진 문장', where: p.id, detail: s })
      }
      const key = itemKey(p.text)
      if (key && (MARK.test(squash(p.text)) || /[:：]/.test(p.text)) && key.length >= 2 && !keys.has(key)) {
        add({ kind: '빠진 항목', where: p.id, detail: squash(p.text).slice(0, 40) })
      }
    }
    // 번호 건너뜀
    let last: { kind: string; n: number } | null = null
    for (const it of u) {
      if (it.kind !== 'p') continue
      const num = numberOf(it.text)
      if (!num) continue
      if (last && last.kind === num.kind && num.n !== 1 && num.n !== last.n + 1) {
        add({ kind: '번호', where: it.sample, detail: `${last.n} 다음이 ${num.n} 입니다: ${squash(it.text).slice(0, 30)}` })
      }
      if (!last || last.kind === num.kind || num.kind === '1.') last = num
    }
    // 긴 글 문단 하나의 모양으로 여러 문단
    const uses = new Map<string, DocItem[]>()
    for (const it of u) if (it.kind === 'p') uses.set(it.sample, [...(uses.get(it.sample) ?? []), it])
    for (const [id, list] of uses) {
      const p = unit.find((x) => x.id === id)
      if (!p || list.length < 2 || p.text.length < 60 || MARK.test(p.text)) continue
      const extra = list.filter((it) => !sentences(p.text).some((s) => bare(paraText(it)).includes(bare(s).slice(0, 12))))
      for (const it of extra.length ? extra : list.slice(1)) {
        add({ kind: '새 문단', where: id, detail: squash(paraText(it)).slice(0, 60) })
      }
    }
    // 받는 사람이 쓰는 빈칸
    for (const p of unit) {
      if (!/\(\s*\)/.test(p.text)) continue
      const mine = u.filter((it) => it.sample === p.id && it.kind === 'p')
      if (mine.length && mine.every((it) => !/\(\s*\)/.test(paraText(it)))) {
        add({ kind: '빈칸', where: p.id, detail: squash(p.text).slice(0, 40) })
      }
    }
  }
  // 제목
  const title = unit[0]
  const firstOut = items.find((it) => it.kind === 'p')
  if (title && firstOut && firstOut.sample === title.id && bare(paraText(firstOut)) !== bare(title.text)) {
    add({ kind: '제목', where: title.id, detail: `양식 "${title.text}" → "${squash(paraText(firstOut))}"` })
  }
  return out
}

const KIND_HINT: Record<string, string> = {
  '빠진 문단': '양식의 이 문단이 통째로 없습니다. 머리 줄 · 자르는 선 · 늘 쓰는 글이면 그대로 넣고, 지난 일의 내용이면 빼도 됩니다',
  '빠진 문장': '양식의 이 문장이 새 문서에 없습니다. 늘 쓰는 문구면 그대로 넣고, 지난 일의 내용이면 빼도 됩니다',
  '빠진 항목': '양식의 이 항목 줄이 새 문서에 없습니다',
  번호: '번호가 건너뜁니다',
  '새 문단': '양식에는 한 문단인데 이 모양으로 문단을 더 썼습니다. 양식에 없던 설명을 지어 넣었는지 보세요',
  제목: '제목이 양식과 다릅니다',
  빈칸: '받는 사람이 직접 쓰는 ( ) 빈칸을 채웠습니다'
}

/** 검사관에게 줄 대조 결과 */
export function findingsText(list: Finding[]): string {
  if (!list.length) return '- 프로그램이 찾은 문제 없음'
  return list.map((f) => `- [${f.where}] ${f.kind}: ${f.detail} (${KIND_HINT[f.kind] ?? ''})`).join('\n')
}

/** 화면에 보여 줄 한 줄 */
export function findingLine(f: Finding): string {
  const head: Record<string, string> = {
    '빠진 문단': '양식의 문단이 빠졌습니다',
    '빠진 문장': '양식의 문장이 빠졌습니다',
    '빠진 항목': '양식의 항목 줄이 빠졌습니다',
    번호: '번호가 건너뜁니다',
    '새 문단': '양식에 없던 문단이 있습니다',
    제목: '제목이 양식과 다릅니다',
    빈칸: '받는 사람이 쓰는 빈칸을 채웠습니다'
  }
  return `${head[f.kind] ?? f.kind} — ${f.detail}`
}

/* ---------- 검사관 답 읽기 ---------- */

export interface Inspection {
  /** 검사관이 찾아 고친 것 */
  fixed: string[]
  /** 담당자에게 물을 것 — 질문과 양식에 있던 값 */
  ask: { q: string; hint: string }[]
  /** 고친 문서([P3] 줄). 없으면 '' */
  doc: string
}

/**
 * ## 검사 / ## 물을 것 / ## 고친 문서 세 칸으로 된 답을 읽는다.
 * "## 고친 문서" 가 없으면 doc 은 빈칸이다(쓴 그대로 둔다).
 */
export function parseInspection(raw: string): Inspection {
  const text = raw.replace(/\r\n?/g, '\n').replace(/^```[^\n]*\n?|\n?```\s*$/g, '')
  const parts = new Map<string, string>()
  const re = /^#{1,3}\s*(검사|물을\s*것|고친\s*문서)\s*$/gm
  const heads: { name: string; at: number; end: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) heads.push({ name: m[1].replace(/\s+/g, ' '), at: m.index, end: m.index + m[0].length })
  heads.forEach((h, i) => parts.set(h.name, text.slice(h.end, heads[i + 1]?.at ?? text.length).trim()))
  const bullets = (s: string | undefined): string[] =>
    (s ?? '')
      .split('\n')
      .map((l) => l.replace(/^\s*[-*•]\s*/, '').trim())
      .filter((l) => l && !/^(없음|없습니다|해당\s*없음)\.?$/.test(l))
  const fixed = bullets(parts.get('검사'))
  const ask = bullets(parts.get('물을 것')).map((l) => {
    const [q, ...rest] = l.split('|')
    return { q: q.trim(), hint: rest.join('|').trim() }
  })
  const doc = (parts.get('고친 문서') ?? '').trim()
  return { fixed, ask, doc: /^\s*(그대로|고칠\s*것\s*없음)\.?\s*$/.test(doc) ? '' : doc }
}
