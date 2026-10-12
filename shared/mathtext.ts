/**
 * 수식(LaTeX)을 읽기 쉬운 글자로 — OCR 결과를 엑셀 · 화면 · 복사로 옮길 때 쓴다.
 * Gemini 는 손글씨 수식을 $\begin{pmatrix} 4 & 1 \\ 2 & 3 \end{pmatrix}$ 처럼 LaTeX 로 적는 일이 많은데,
 * 엑셀 칸에서는 읽기 어렵다. 종이에 보이는 모양에 가깝게 (4 1; 2 3) · 5/3 · x² · a₁₁ · ≤ 로 바꾼다.
 * 받은 글 자체는 바꾸지 않는다(화면의 [받은 글 보기] 에 그대로 있다).
 */

/** $…$ · $$…$$ · \(…\) · \[…\] 수식 묶음. LaTeX 표시(\명령 · ^ · _ · { })가 없으면 수식으로 보지 않는다($5 같은 돈 표시) */
const SPAN = /(?<!\\)\$\$([^$]+?)\$\$|(?<!\\)\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g
const LOOKS_TEX = /\\[a-zA-Z]|[\^_{}]/
/** $ 없이 쓴 수식 — 행렬 · 분수 · 제곱근과 기호 이름(\times · \le …)만 바꾼다. 모르는 \명령은 그대로 둔다 */
const BARE = /\\begin\{(\w+\*?)\}[\s\S]*?\\end\{\1\}|\\[dt]?frac\s*\{[^{}]*\}\s*\{[^{}]*\}|\\sqrt\s*(?:\[[^\]]*\])?\{[^{}]*\}|\\([a-zA-Z]+)(?![a-zA-Z])/g

const SYMBOLS: Record<string, string> = {
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', leqslant: '≤', ge: '≥', geq: '≥', geqslant: '≥',
  ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', propto: '∝', infty: '∞', circ: '°', degree: '°',
  therefore: '∴', because: '∵', to: '→', rightarrow: '→', Rightarrow: '⇒', leftarrow: '←', Leftarrow: '⇐',
  leftrightarrow: '↔', Leftrightarrow: '⇔', iff: '⇔', implies: '⇒', in: '∈', notin: '∉', ni: '∋', cup: '∪', cap: '∩',
  subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃',
  neg: '¬', lnot: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨', angle: '∠', triangle: '△', perp: '⊥', parallel: '∥',
  cdots: '⋯', ldots: '…', dots: '…', vdots: '⋮', ddots: '⋱', prime: '′', sum: 'Σ', prod: 'Π', int: '∫', partial: '∂',
  nabla: '∇', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Sigma: 'Σ',
  Pi: 'Π', Phi: 'Φ', Omega: 'Ω', '%': '%', '#': '#', '&': '&', _: '_', '{': '{', '}': '}', '$': '$', '|': '‖'
}
/** 양옆을 한 칸씩 띄우는 기호(연산 · 관계). 나머지(그리스 문자 · ∠ · ° …)는 뒤 빈칸을 먹는다 — LaTeX 처럼 */
const SPACED = new Set('×·÷±∓≤≥≠≈≡∼∝→⇒←⇐↔⇔∈∉∋∪∩⊂⊆⊃⊇∧∨'.split(''))
/** \constructor 같은 이름이 Object 의 것을 집지 않게 */
const symbol = (name: string): string | undefined => (Object.prototype.hasOwnProperty.call(SYMBOLS, name) ? SYMBOLS[name] : undefined)
/** 글자 사이 띄우기 · 크기 조절처럼 버리는 것 */
const DROP = new Set(['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'displaystyle', 'textstyle', 'limits', 'nolimits', '!', ','])
const SPACE = new Set(['quad', 'qquad', ';', ':', ' ', 'enspace', 'thinspace'])
/** {안의 글} 만 남기는 것 */
const KEEP_ARG = new Set(['text', 'textrm', 'textbf', 'textit', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathcal', 'mathbb', 'operatorname', 'boldsymbol', 'bm', 'overline', 'underline', 'vec', 'hat', 'bar', 'widehat', 'overrightarrow', 'mbox'])

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' }
const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', h: 'ₕ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', p: 'ₚ', s: 'ₛ', t: 'ₜ', i: 'ᵢ', j: 'ⱼ', r: 'ᵣ', u: 'ᵤ', v: 'ᵥ'
}
const MATRIX: Record<string, [string, string]> = { pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], matrix: ['', ''], smallmatrix: ['', ''], array: ['', ''], cases: ['{ ', ''] }
/** 다 바꾼 행렬을 잠시 맡겨 두는 표시 — 다시 읽히지 않게(괄호 · ^ 가 또 바뀌지 않게) */
const HOLD = /\u0000(\d+)\u0000/g

/** s[i] 가 { 일 때 짝 } 까지의 안쪽 글과 다음 자리 */
function group(s: string, i: number): { body: string; end: number } {
  if (s[i] !== '{') {
    // {} 없이 한 글자(또는 \명령) — x^2, \frac12
    if (s[i] === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i))
      return m ? { body: m[0], end: i + m[0].length } : { body: '', end: i + 1 }
    }
    return { body: s[i] ?? '', end: i + 1 }
  }
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') {
      j++
      continue
    }
    if (s[j] === '{') depth++
    else if (s[j] === '}' && --depth === 0) return { body: s.slice(i + 1, j), end: j + 1 }
  }
  return { body: s.slice(i + 1), end: s.length }
}

const skipSpace = (s: string, i: number): number => {
  while (s[i] === ' ') i++
  return i
}

/** 위 · 아래 첨자: 모두 바꿀 수 있으면 작은 글자(², ₁₁), 아니면 ^(…) · _(…) */
function script(body: string, map: Record<string, string>, mark: string): string {
  const t = body.replace(/\s+/g, '')
  if (t && [...t].every((c) => map[c])) return [...t].map((c) => map[c]).join('')
  if (mark === '^' && (t === '°' || t === '∘')) return '°'
  return t.length === 1 ? `${mark}${t}` : `${mark}(${t})`
}

/** 분수 칸: 한 덩어리면 그대로, 아니면 괄호 */
const frac = (a: string, b: string): string => {
  const wrap = (x: string): string => (/^[\w.′²³⁰¹⁴-⁹₀-₉]+$|^\(.*\)$/u.test(x) ? x : `(${x})`)
  return `${wrap(a.trim())}/${wrap(b.trim())}`
}

/** LaTeX 한 덩어리를 글자로 */
export function texToText(tex: string): string {
  let s = tex.replace(/\u0000/g, '')
  const held: string[] = []
  // 행렬 칸: 안쪽 행렬(맡겨 둔 것)은 다시 읽지 않고 그대로 끼운다
  const cell = (c: string): string => c.split(/\u0000(\d+)\u0000/).map((part, k) => (k % 2 ? held[+part] : texToText(part))).join('')
  // 행렬 · 경우: \begin{pmatrix} a & b \\ c & d \end{pmatrix} → (a b; c d). 안쪽 행렬부터
  for (let guard = 0; guard < 20; guard++) {
    const m = /\\begin\{(\w+\*?)\}(?:\{[^}]*\})?((?:(?!\\begin\{)[\s\S])*?)\\end\{\1\}/.exec(s)
    if (!m) break
    const [open, close] = MATRIX[m[1].replace('*', '')] ?? ['(', ')']
    const rows = m[2]
      .split(/\\\\/)
      .map((r) => r.split('&').map((c) => cell(c).trim()).filter((c, i, all) => c || all.length === 1).join(' '))
      .filter((r) => r.trim())
    held.push(`${open}${rows.join('; ')}${close}`)
    s = s.slice(0, m.index) + `\u0000${held.length - 1}\u0000` + s.slice(m.index + m[0].length)
  }
  let out = ''
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i))
      if (!m) {
        i++
        continue
      }
      const name = m[1]
      i += m[0].length
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
        const a = group(s, skipSpace(s, i))
        const b = group(s, skipSpace(s, a.end))
        out += frac(texToText(a.body), texToText(b.body))
        i = b.end
      } else if (name === 'sqrt') {
        let root = ''
        if (s[i] === '[') {
          const close = s.indexOf(']', i)
          root = script(texToText(s.slice(i + 1, close)), SUP, '^')
          i = close + 1
        }
        const a = group(s, skipSpace(s, i))
        const body = texToText(a.body)
        out += `${root}√${/^[\w.]+$/.test(body) ? body : `(${body})`}`
        i = a.end
      } else if (name === 'binom') {
        const a = group(s, skipSpace(s, i))
        const b = group(s, skipSpace(s, a.end))
        out += `C(${texToText(a.body)}, ${texToText(b.body)})`
        i = b.end
      } else if (KEEP_ARG.has(name)) {
        const a = group(s, skipSpace(s, i))
        out += texToText(a.body)
        i = a.end
      } else if (symbol(name)) {
        const sym = symbol(name) as string
        out += SPACED.has(sym) ? ` ${sym} ` : sym
        if (/^[a-zA-Z]+$/.test(name)) i = skipSpace(s, i)
      } else if (SPACE.has(name)) {
        out += ' '
      } else if (DROP.has(name)) {
        // 버린다
        if (/^[a-zA-Z]+$/.test(name)) i = skipSpace(s, i)
      } else {
        // \sin \log \lim 처럼 이름 그대로 읽는 것
        out += name
      }
      continue
    }
    if (ch === '^' || ch === '_') {
      const a = group(s, skipSpace(s, i + 1))
      out += script(texToText(a.body), ch === '^' ? SUP : SUB, ch)
      i = a.end
      continue
    }
    if (ch === '{' || ch === '}') {
      i++
      continue
    }
    out += ch
    i++
  }
  return out
    .replace(/([(\[]) +/g, '$1')
    .replace(/ +([)\]])/g, '$1')
    .replace(HOLD, (_, k: string) => held[+k])
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** 칸 글 안의 수식만 글자로 바꾼다 */
export function mathText(cell: string): string {
  if (!cell.includes('$') && !cell.includes('\\')) return cell
  return cell
    .replace(SPAN, (all, d2: string, d1: string, p: string, b: string, at: number, whole: string) => {
      const tex = d2 ?? d1 ?? p ?? b ?? ''
      // pandoc 규칙: $ 바로 안쪽이 빈칸이 아니고 닫는 $ 뒤에 숫자가 없으면 수식($|A|$). $5 와 $7 은 돈
      const tight = /^\S/.test(tex) && /\S$/.test(tex) && !/^\d/.test(whole.slice(at + all.length))
      return LOOKS_TEX.test(tex) || tight ? texToText(tex) : all
    })
    .replace(BARE, (all, _env: string, name: string) => (name === undefined || symbol(name) ? texToText(all) : all))
    .replace(/\\\$/g, '$')
}
