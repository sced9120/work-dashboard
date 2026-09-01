import type { Task } from '../../shared/types'
import { monthOf, monthOrder, weekOf } from '../../shared/schedule'

// 시기를 다루는 함수는 메인 쪽(인수인계 브리핑)에서도 써서 shared 로 옮겼다.
export { monthLabel, monthOf, weekOf } from '../../shared/schedule'

/** 학교 일정에 맞춰 3월부터 시작하는 순서로 정렬한다. */
export const schoolOrder = monthOrder

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const om = monthOrder(monthOf(a.task_date_display)) - monthOrder(monthOf(b.task_date_display))
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
