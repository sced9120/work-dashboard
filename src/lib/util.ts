import type { Task } from '../../shared/types'

/** "3월 1주" → 3, "수시" → 99. 로드맵 정렬에 쓴다. */
export function monthOf(display: string): number {
  const m = /(\d{1,2})\s*월/.exec(display ?? '')
  if (!m) return 99
  const n = Number(m[1])
  return n >= 1 && n <= 12 ? n : 99
}

/** 학교 일정에 맞춰 3월부터 시작하는 순서로 정렬한다. */
export function schoolOrder(month: number): number {
  if (month === 99) return 100
  return month >= 3 ? month - 3 : month + 9
}

export function weekOf(display: string): number {
  const m = /(\d{1,2})\s*주/.exec(display ?? '')
  return m ? Number(m[1]) : 9
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const om = schoolOrder(monthOf(a.task_date_display)) - schoolOrder(monthOf(b.task_date_display))
    if (om !== 0) return om
    const ow = weekOf(a.task_date_display) - weekOf(b.task_date_display)
    if (ow !== 0) return ow
    return a.title.localeCompare(b.title, 'ko')
  })
}

export function todayStr(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function monthLabel(month: number): string {
  return month === 99 ? '수시 · 기타' : `${month}월`
}
