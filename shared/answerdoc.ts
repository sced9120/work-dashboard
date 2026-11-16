/**
 * 도우미의 답을 한글(.hwpx) · 엑셀 파일로 옮길 때 쓰는 순수 함수들.
 * 저장은 언제나 사용자의 클릭 + 저장 창으로만 — 여기서는 글만 다듬는다.
 */

import { splitAnswer } from './agent'

/** 그림 이모지 — 한글 · 한글 자모 · ※ ★ ✓ ▶ 같은 글머리 기호는 건드리지 않는다 */
const EMOJI = '(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F|[\\u{1F3FB}-\\u{1F3FF}]|\\u200D|\\uFE0F|\\u20E3)'
const EMOJI_RE = new RegExp(`${EMOJI}+[ \\t]?`, 'gu')

/** 이모지를 뺀다(바로 뒤 한 칸 띄어쓰기도 함께) */
export function stripEmoji(s: string): string {
  return s.replace(/([0-9#*])️?⃣/g, '$1').replace(EMOJI_RE, '')
}

/** 표 한 덩어리만 감싼 울타리인가 — 모든 줄이 | 로 시작하고 구분 줄이 있어야 한다 */
function isTableBody(body: string[]): boolean {
  const lines = body.filter((l) => l.trim())
  return lines.length >= 2 && lines.every((l) => l.trim().startsWith('|')) && lines.some((l) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l.trim()))
}

/** ```markdown 으로 표만 감싸 보낸 울타리를 벗긴다 — 코드 울타리(```python 등)는 그대로 둔다 */
export function unfenceTables(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const open = /^(\s{0,3})(`{3,}|~{3,})[ \t]*([A-Za-z]*)[ \t]*$/.exec(lines[i])
    if (!open) {
      out.push(lines[i++])
      continue
    }
    let end = -1
    for (let j = i + 1; j < lines.length; j++) {
      const c = /^\s{0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[j])
      if (c && c[1][0] === open[2][0] && c[1].length >= open[2].length) {
        end = j
        break
      }
    }
    const lang = open[3].toLowerCase()
    const body = end < 0 ? [] : lines.slice(i + 1, end)
    if (end >= 0 && (!lang || ['markdown', 'md', 'gfm', 'text', 'table'].includes(lang)) && isTableBody(body)) {
      out.push('', ...body, '')
      i = end + 1
    } else {
      const stop = end < 0 ? lines.length - 1 : end
      out.push(...lines.slice(i, stop + 1))
      i = stop + 1
    }
  }
  return out.join('\n')
}

/** 생각 과정 · 접은 풀이를 뺀다(닫히지 않은 <think> 는 끝까지) */
export function stripReasoning(s: string): string {
  return s
    .replace(/<(think|thinking|reasoning)>[\s\S]*?(<\/\1>|$)/gi, '')
    .replace(/<details[\s>][\s\S]*?<\/details>/gi, '')
}

/** 첫 `#` 제목(울타리 밖) — 이모지 · 강조 기호를 뗀 글. 없으면 빈 글 */
export function firstHeading(md: string): string {
  let fence = false
  for (const l of md.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(l)) fence = !fence
    if (fence) continue
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(l.trim())
    if (m) return stripEmoji(m[1]).replace(/\*\*|__|`/g, '').trim()
  }
  return ''
}

/**
 * 답을 한글 문서로 만들기 좋은 마크다운으로 — 도우미 제어 묶음 · 생각 과정 · 이모지를 빼고,
 * 표만 감싼 울타리를 벗기고, 첫 줄이 제목(#)이 아니면 title 로 제목을 단다.
 */
export function prepareAnswerMd(md: string, title?: string): string {
  let s = splitAnswer(stripReasoning(String(md ?? '').replace(/\r\n?/g, '\n'))).text.replace(/<<<[^\n]{0,3}$/, '')
  s = unfenceTables(s)
  s = stripEmoji(s)
    .replace(/^(\s*(?:#{1,6}|[-*+]|\d+[.)])) {2,}/gm, '$1 ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const head = cleanTitle(title ?? '')
  const first = s.split('\n').find((l) => l.trim()) ?? ''
  if (head && !/^#{1,6}\s/.test(first.trim())) s = `# ${head}\n\n${s}`
  return s
}

/** 엑셀 · 한글을 달라는 말인가 */
export function exportIntent(userText: string): { xlsx: boolean; hwp: boolean } {
  const t = String(userText ?? '')
  return {
    xlsx: /엑셀|표로|스프레드시트|xlsx|시트/i.test(t),
    hwp: /한글|hwpx?|문서로|파일로|보고서|공문|가정통신문|안내문|계획서/i.test(t)
  }
}

/** 제목으로 쓸 글 — 이모지 · 파일 이름에 못 쓰는 글자 · 겹친 공백을 정리 */
export function cleanTitle(s: string, max = 40): string {
  return stripEmoji(String(s ?? ''))
    .replace(/[\\/*?:"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, max)
    .trim()
}

/** `{제목}_{YYYYMMDD_HHMM}` — 제목이 비면 fallback */
export function exportFileName(title: string, fallback: string, now: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`
  return `${cleanTitle(title) || cleanTitle(fallback) || '문서'}_${stamp}`
}
