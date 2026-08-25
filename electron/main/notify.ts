/**
 * 기한이 다가오면 윈도우 알림을 띄운다.
 *
 * 알림은 프로그램이 켜져 있어야 뜬다. 그래서 트레이 상주와 시작 시 자동 실행이
 * 함께 있어야 실제로 쓸모가 있다. 셋 다 기본은 꺼져 있고 [설정]에서 켠다.
 */

import { app, Notification } from 'electron'
import * as db from './db'
import { loadLocalSettings } from './secrets'

/** 켜져 있는 동안 몇 시간마다 다시 살펴볼지 */
const RECHECK_HOURS = 6

/** 같은 기한을 하루에 여러 번 알리지 않도록 기억해 둔다. (id-날짜) */
const alreadyNotified = new Set<string>()

let timer: NodeJS.Timeout | null = null

function todayStamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function dayLabel(due: string): string {
  const target = new Date(`${due}T00:00:00`)
  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const left = Math.round((target.getTime() - midnight.getTime()) / 86400000)
  if (left === 0) return '오늘까지'
  if (left < 0) return `${-left}일 지났습니다`
  return `${left}일 남았습니다`
}

/** 알림 한 건으로 다룰 최소 정보. 절차 기한과 달력 일정을 같이 담는다. */
interface DueItem {
  /** 종류까지 넣어 id 가 겹치지 않게 한다 */
  key: string
  title: string
  due: string
  sub: string
}

/** 기한을 살펴보고 알림을 띄운다. 조건이 아니면 아무 것도 하지 않는다. */
export function checkDeadlinesNow(): void {
  const s = loadLocalSettings()
  if (!s.notify_deadlines) return
  if (!Notification.isSupported()) return

  const stamp = todayStamp()
  let items: DueItem[]
  try {
    items = [
      ...db.dueDeadlines(s.notify_days).map((d) => ({
        key: `deadline-${d.id}`,
        title: d.title,
        due: d.due_date,
        sub: d.case_ref
      })),
      // 달력에서 [기한으로 챙기기] 를 켜 둔 일정도 같이 알린다.
      ...db.dueEvents(s.notify_days).map((e) => ({
        key: `event-${e.id}`,
        title: e.title,
        due: e.end_date || e.event_date,
        sub: e.start_time
      }))
    ]
  } catch {
    // 아직 DB가 열리지 않았거나 읽을 수 없는 상태. 다음 차례에 다시 본다.
    return
  }

  const fresh = items.filter((d) => !alreadyNotified.has(`${d.key}-${stamp}`))
  if (!fresh.length) return

  for (const d of fresh) alreadyNotified.add(`${d.key}-${stamp}`)

  // 여러 건이면 알림을 쏟아붓지 않고 하나로 묶는다.
  if (fresh.length === 1) {
    const d = fresh[0]
    new Notification({
      title: `기한 알림 — ${dayLabel(d.due)}`,
      body: d.sub ? `${d.title}\n${d.sub}` : d.title
    }).show()
    return
  }

  const lines = fresh.slice(0, 4).map((d) => `· ${d.title} (${dayLabel(d.due)})`)
  if (fresh.length > 4) lines.push(`· 그 밖에 ${fresh.length - 4}건`)

  new Notification({
    title: `챙겨야 할 기한 ${fresh.length}건`,
    body: lines.join('\n')
  }).show()
}

/** 프로그램이 켜져 있는 동안 주기적으로 살펴본다. */
export function startDeadlineWatch(): void {
  stopDeadlineWatch()
  checkDeadlinesNow()
  timer = setInterval(checkDeadlinesNow, RECHECK_HOURS * 60 * 60 * 1000)
}

export function stopDeadlineWatch(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/**
 * 설정이 바뀌면 OS 쪽 설정(자동 실행)과 감시 상태를 실제로 맞춘다.
 * 저장만 하고 반영하지 않으면 사용자는 켰다고 생각하는데 동작하지 않는다.
 */
export function applyLocalSettings(): void {
  const s = loadLocalSettings()

  try {
    app.setLoginItemSettings({
      openAtLogin: s.open_at_login,
      // 자동 실행일 때는 창을 띄우지 않고 트레이에만 올린다.
      args: s.keep_in_tray ? ['--hidden'] : []
    })
  } catch {
    // 자동 실행을 못 거는 환경(Portable, 정책 제한)에서는 조용히 넘긴다.
  }

  if (s.notify_deadlines) startDeadlineWatch()
  else stopDeadlineWatch()
}
