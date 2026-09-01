/**
 * "3월 1주" 처럼 뭉뚱그려 적은 시기를 다루는 함수들.
 *
 * 화면(로드맵 정렬)과 메인(인수인계 브리핑) 양쪽에서 같은 규칙으로 늘어놓아야
 * 해서 여기 두었다. 예전에는 화면 쪽에만 있었다.
 */

/** "3월 1주" → 3, "수시" → 99 */
export function monthOf(display: string): number {
  const m = /(\d{1,2})\s*월/.exec(display ?? '')
  if (!m) return 99
  const n = Number(m[1])
  return n >= 1 && n <= 12 ? n : 99
}

/** "3월 1주" → 1, 주를 모르면 9 (그 달의 맨 뒤로) */
export function weekOf(display: string): number {
  const m = /(\d{1,2})\s*주/.exec(display ?? '')
  return m ? Number(m[1]) : 9
}

/**
 * 학교의 한 해는 3월에 시작한다.
 * 3월을 0으로 놓아 3→4→…→12→1→2 차례가 되게 한다.
 */
export function monthOrder(month: number): number {
  if (month === 99) return 100
  return month >= 3 ? month - 3 : month + 9
}

export function monthLabel(month: number): string {
  return month === 99 ? '수시 · 기타' : `${month}월`
}
