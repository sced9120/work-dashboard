/**
 * 선도위원회 자료는 학생 개인정보가 들어간다.
 * AI에 보내기 전에 이름·연락처 따위를 가명으로 바꾸고,
 * 돌아온 결과에서 다시 실명으로 되돌린다.
 *
 * 치환표는 이 PC 메모리에만 있고 어디에도 저장·전송되지 않는다.
 */

import type { AliasPair } from '../../shared/types'

/** 사람이 실수로 지우지 못한 번호류를 기계적으로 가린다. */
const AUTO_RULES: { label: string; re: RegExp; to: string }[] = [
  { label: '주민등록번호', re: /\d{6}\s*[-–—]\s*\d{7}/g, to: '(주민등록번호 삭제)' },
  {
    label: '휴대전화',
    re: /01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}/g,
    to: '(연락처 삭제)'
  },
  {
    label: '일반전화',
    re: /0\d{1,2}[-.\s]\d{3,4}[-.\s]\d{4}/g,
    to: '(연락처 삭제)'
  },
  { label: '이메일', re: /[\w.+-]+@[\w-]+\.[\w.]+/g, to: '(이메일 삭제)' },
  // "2학년 3반 15번" 에서 반·번호는 식별성이 높아 지운다. 학년은 남긴다.
  {
    label: '반·번호',
    re: /(\d\s*학년)\s*\d+\s*반\s*(?:\d+\s*번)?/g,
    to: '$1 ○반'
  }
]

/** 이름 뒤에 흔히 붙는 말. 이런 게 붙어 있으면 사람 이름으로 본다. */
const NAME_MARKERS = [
  '학생',
  '군',
  '양',
  '씨',
  '선생님',
  '교사',
  '위원장',
  '위원',
  '부장',
  '어머니',
  '아버지',
  '보호자',
  '학부모'
]

/**
 * 글에서 사람 이름으로 보이는 것을 추려 낸다.
 * 확실하지 않으므로 화면에서 사람이 확인하도록 후보만 돌려준다.
 */
export function findNameCandidates(text: string): string[] {
  const found = new Set<string>()
  const marker = NAME_MARKERS.join('|')

  // 1) "홍길동 학생", "김철수 군" 처럼 뒤에 표지가 붙은 경우
  const withMarker = new RegExp(`([가-힣]{2,4})\\s*(?:${marker})`, 'g')
  for (const m of text.matchAll(withMarker)) found.add(m[1])

  // 2) "학생 홍길동", "위원 김영희" 처럼 앞에 표지가 붙은 경우
  const beforeMarker = new RegExp(`(?:${marker})\\s+([가-힣]{2,4})`, 'g')
  for (const m of text.matchAll(beforeMarker)) found.add(m[1])

  // 이미 가려 둔 것과 흔한 낱말은 후보에서 뺀다.
  const stop = new Set([
    '학생',
    '보호자',
    '학부모',
    '담임',
    '교사',
    '위원',
    '위원장',
    '해당',
    '대상',
    '본인',
    '피해',
    '가해',
    '관련',
    '이상',
    '아래',
    '위와',
    '다음'
  ])

  return [...found].filter((n) => !stop.has(n) && !n.includes('○') && !n.includes('*'))
}

/** 이름 목록에 역할별 가명을 붙인다. 같은 역할끼리 A, B, C… */
export function buildAliases(entries: { name: string; role: string }[]): AliasPair[] {
  const seq = new Map<string, number>()
  const out: AliasPair[] = []

  for (const e of entries) {
    const name = e.name.trim()
    if (!name) continue
    if (out.some((p) => p.real === name)) continue

    const role = e.role.trim() || '관계자'
    const n = (seq.get(role) ?? 0) + 1
    seq.set(role, n)
    out.push({ real: name, alias: `${role}${String.fromCharCode(64 + n)}` })
  }
  return out
}

/** 정규식에 쓰일 수 있는 글자를 막아 준다. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 실명 → 가명. 긴 이름부터 바꿔야 "김철" 이 "김철수" 를 깨뜨리지 않는다.
 * 번호류는 규칙으로 함께 지운다.
 */
export function maskText(text: string, pairs: AliasPair[]): string {
  let out = text

  const ordered = [...pairs].sort((a, b) => b.real.length - a.real.length)
  for (const p of ordered) {
    if (!p.real) continue
    out = out.replace(new RegExp(escapeRe(p.real), 'g'), p.alias)
  }

  for (const rule of AUTO_RULES) out = out.replace(rule.re, rule.to)
  return out
}

/** 가명 → 실명. 화면에 보여 줄 때만 되돌린다. */
export function unmaskText(text: string, pairs: AliasPair[]): string {
  let out = text
  const ordered = [...pairs].sort((a, b) => b.alias.length - a.alias.length)
  for (const p of ordered) {
    if (!p.alias) continue
    out = out.replace(new RegExp(escapeRe(p.alias), 'g'), p.real)
  }
  return out
}

/**
 * 가린 뒤에도 실명이 남아 있는지 되짚어 본다.
 * 하나라도 남으면 화면에서 경고를 띄운다.
 */
export function leakCheck(masked: string, pairs: AliasPair[]): string[] {
  return pairs.filter((p) => p.real && masked.includes(p.real)).map((p) => p.real)
}
