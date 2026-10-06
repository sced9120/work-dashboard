/**
 * iCalendar(.ics) 읽기 · 쓰기 — 구글 캘린더와 일정을 주고받는다.
 *
 * - 읽기: 구글 캘린더의 "iCal 형식 비공개 주소"에서 받은 글을 달력에 겹쳐 보일 일정으로 바꾼다(읽기만).
 *   반복 일정(RRULE: 매일 · 매주 · 매달 · 매년, 간격 · 횟수 · 끝나는 날 · 요일), 뺀 날(EXDATE), 한 번만 바꾼 날(RECURRENCE-ID)을 다룬다.
 * - 쓰기: 이 프로그램의 일정을 .ics 파일로 — 구글 캘린더 [설정 → 가져오기/내보내기 → 가져오기] 로 넣는다.
 * 시각은 한국 시각으로 본다(TZID 가 없거나 Asia/Seoul 이면 그대로, 끝에 Z 가 붙은 세계 표준시는 이 PC 시각으로 바꾼다).
 */

export interface IcsEvent {
  uid: string
  title: string
  /** YYYY-MM-DD */
  start: string
  /** YYYY-MM-DD (마지막 날, 포함) */
  end: string
  /** HH:MM, 하루 종일이면 빈 문자열 */
  time: string
  location: string
}

const pad = (n: number): string => String(n).padStart(2, '0')
const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + n)
  return ymd(d)
}

/* ---------- 읽기 ---------- */

interface Prop {
  name: string
  params: Record<string, string>
  value: string
}

/** 접힌 줄을 펴고(다음 줄이 빈칸 · 탭으로 시작하면 이어 붙임) 줄마다 이름 · 매개변수 · 값으로 */
function props(text: string): Prop[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const joined: string[] = []
  for (const l of lines) {
    if (/^[ \t]/.test(l) && joined.length) joined[joined.length - 1] += l.slice(1)
    else joined.push(l)
  }
  const out: Prop[] = []
  for (const l of joined) {
    // 값 안의 : 는 그대로 두고, 매개변수 안의 "…:…" (따옴표)도 건너뛴다
    let i = 0
    let quoted = false
    for (; i < l.length; i++) {
      const c = l[i]
      if (c === '"') quoted = !quoted
      else if (c === ':' && !quoted) break
    }
    if (i >= l.length) continue
    const head = l.slice(0, i)
    const value = l.slice(i + 1)
    const [name, ...ps] = head.split(';')
    const params: Record<string, string> = {}
    for (const p of ps) {
      const k = p.indexOf('=')
      if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, '')
    }
    out.push({ name: name.toUpperCase(), params, value })
  }
  return out
}

const unescape = (v: string): string => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')

/** 날짜 · 시각 값 → 이 PC 시각의 Date 와 하루 종일 여부 */
function when(p: Prop): { date: Date; allDay: boolean } | null {
  const v = p.value.trim()
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/)
  if (!m) return null
  const [, y, mo, d, hh, mi, ss, z] = m
  if (!hh || p.params.VALUE === 'DATE') return { date: new Date(Number(y), Number(mo) - 1, Number(d)), allDay: true }
  if (z) return { date: new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), Number(ss ?? 0))), allDay: false }
  return { date: new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), Number(ss ?? 0)), allDay: false }
}

interface RawEvent {
  uid: string
  title: string
  location: string
  start: { date: Date; allDay: boolean }
  end: { date: Date; allDay: boolean } | null
  rrule: Record<string, string> | null
  exdates: Set<string>
  recurrenceId: string
  cancelled: boolean
}

const DOW: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

/** 반복 일정의 시작 날들 (from~to 안의 것만, 너무 많으면 끊는다) */
function occurrences(ev: RawEvent, from: string, to: string): Date[] {
  const s = ev.start.date
  if (!ev.rrule) return [s]
  const r = ev.rrule
  const freq = r.FREQ
  const interval = Math.max(1, Number(r.INTERVAL) || 1)
  const count = Number(r.COUNT) || 0
  const untilP = r.UNTIL ? when({ name: 'UNTIL', params: {}, value: r.UNTIL }) : null
  const until = untilP ? ymd(untilP.date) : ''
  const byday = (r.BYDAY ?? '').split(',').filter(Boolean)
  const bymonthday = (r.BYMONTHDAY ?? '').split(',').filter(Boolean).map(Number)
  const out: Date[] = []
  let made = 0
  const take = (d: Date): boolean => {
    const day = ymd(d)
    if (until && day > until) return false
    if (count && made >= count) return false
    if (d < s) return true
    made++
    if (day >= addDays(from, -366) && day <= to) out.push(d)
    return true
  }
  const at = (y: number, mo: number, d: number): Date => new Date(y, mo, d, s.getHours(), s.getMinutes(), s.getSeconds())
  const end = new Date(`${to}T23:59:59`)
  // 횟수 제한이 없으면 오래전에 시작한 반복은 보려는 때 가까이로 건너뛴다
  let first = 0
  if (!count) {
    const days = (new Date(`${from}T00:00:00`).getTime() - s.getTime()) / 86400000 - 400
    const per = freq === 'DAILY' ? 1 : freq === 'WEEKLY' ? 7 : freq === 'MONTHLY' ? 31 : 366
    if (days > 0) first = Math.floor(days / (per * interval))
  }
  for (let step = first; step < first + 5000; step++) {
    if (freq === 'DAILY') {
      const d = at(s.getFullYear(), s.getMonth(), s.getDate() + step * interval)
      if (d > end || !take(d)) break
    } else if (freq === 'WEEKLY') {
      const weekStart = at(s.getFullYear(), s.getMonth(), s.getDate() - s.getDay() + step * 7 * interval)
      if (weekStart > end) break
      const days = byday.length ? byday.map((b) => DOW[b.slice(-2)]).filter((x) => x !== undefined).sort() : [s.getDay()]
      let stop = false
      for (const w of days) {
        const d = at(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + w)
        if (d > end || !take(d)) {
          stop = true
          break
        }
      }
      if (stop) break
    } else if (freq === 'MONTHLY') {
      const base = new Date(s.getFullYear(), s.getMonth() + step * interval, 1)
      if (base > end) break
      const y = base.getFullYear()
      const mo = base.getMonth()
      const last = new Date(y, mo + 1, 0).getDate()
      let days: number[] = []
      if (byday.length) {
        for (const b of byday) {
          const mm = b.match(/^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/)
          if (!mm) continue
          const w = DOW[mm[2]]
          const all: number[] = []
          for (let d = 1; d <= last; d++) if (new Date(y, mo, d).getDay() === w) all.push(d)
          const n = Number(mm[1] ?? 0)
          if (!n) days.push(...all)
          else if (n > 0 && all[n - 1]) days.push(all[n - 1])
          else if (n < 0 && all[all.length + n]) days.push(all[all.length + n])
        }
      } else days = bymonthday.length ? bymonthday.map((d) => (d < 0 ? last + 1 + d : d)) : [s.getDate()]
      let stop = false
      for (const d of [...new Set(days)].filter((d) => d >= 1 && d <= last).sort((a, b) => a - b)) {
        if (!take(at(y, mo, d))) {
          stop = true
          break
        }
      }
      if (stop) break
    } else if (freq === 'YEARLY') {
      const y = s.getFullYear() + step * interval
      const d = at(y, s.getMonth(), s.getDate())
      if (d > end || !take(d)) break
    } else {
      return [s]
    }
    if (out.length > 1000) break
  }
  return out
}

/**
 * .ics 글 → from~to 와 겹치는 일정. 취소된 일정은 뺀다.
 */
export function parseIcs(text: string, from: string, to: string): IcsEvent[] {
  const all = props(text)
  const raws: RawEvent[] = []
  let cur: RawEvent | null = null
  let depth = 0
  for (const p of all) {
    if (p.name === 'BEGIN' && p.value.toUpperCase() === 'VEVENT') {
      cur = { uid: '', title: '', location: '', start: { date: new Date(NaN), allDay: true }, end: null, rrule: null, exdates: new Set(), recurrenceId: '', cancelled: false }
      depth = 0
      continue
    }
    if (!cur) continue
    if (p.name === 'BEGIN') {
      depth++
      continue
    }
    if (p.name === 'END') {
      if (depth > 0) {
        depth--
        continue
      }
      if (p.value.toUpperCase() === 'VEVENT') {
        if (!Number.isNaN(cur.start.date.getTime())) raws.push(cur)
        cur = null
      }
      continue
    }
    if (depth > 0) continue // VALARM 등
    switch (p.name) {
      case 'UID':
        cur.uid = p.value
        break
      case 'SUMMARY':
        cur.title = unescape(p.value).trim()
        break
      case 'LOCATION':
        cur.location = unescape(p.value).trim()
        break
      case 'DTSTART': {
        const w = when(p)
        if (w) cur.start = w
        break
      }
      case 'DTEND': {
        const w = when(p)
        if (w) cur.end = w
        break
      }
      case 'RRULE':
        cur.rrule = Object.fromEntries(p.value.split(';').map((kv) => kv.split('=') as [string, string]).filter((x) => x.length === 2).map(([k, v]) => [k.toUpperCase(), v]))
        break
      case 'EXDATE':
        for (const v of p.value.split(',')) {
          const w = when({ ...p, value: v })
          if (w) cur.exdates.add(ymd(w.date))
        }
        break
      case 'RECURRENCE-ID': {
        const w = when(p)
        if (w) cur.recurrenceId = ymd(w.date)
        break
      }
      case 'STATUS':
        cur.cancelled = p.value.toUpperCase() === 'CANCELLED'
        break
    }
  }

  // 한 번만 바꾼 날(RECURRENCE-ID)은 원래 반복에서 빼고 바뀐 것을 쓴다
  const overridden = new Set(raws.filter((r) => r.recurrenceId).map((r) => `${r.uid}|${r.recurrenceId}`))
  const out: IcsEvent[] = []
  for (const r of raws) {
    if (r.cancelled) continue
    // 길이(날 수) — 하루 종일은 DTEND 가 다음 날이라 하루 뺀다
    const startDay = ymd(r.start.date)
    let spanDays = 0
    if (r.end) {
      const endDay = ymd(r.end.date)
      const diff = Math.round((new Date(`${endDay}T00:00:00`).getTime() - new Date(`${startDay}T00:00:00`).getTime()) / 86400000)
      spanDays = r.start.allDay ? Math.max(0, diff - 1) : Math.max(0, diff - (r.end.date.getHours() === 0 && r.end.date.getMinutes() === 0 && diff > 0 ? 1 : 0))
    }
    for (const d of r.recurrenceId ? [r.start.date] : occurrences(r, from, to)) {
      const s = ymd(d)
      if (!r.recurrenceId && (r.exdates.has(s) || overridden.has(`${r.uid}|${s}`))) continue
      const e = addDays(s, spanDays)
      if (e < from || s > to) continue
      out.push({
        uid: r.uid,
        title: r.title || '(제목 없음)',
        start: s,
        end: e,
        time: r.start.allDay ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`,
        location: r.location
      })
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.time.localeCompare(b.time))
}

/* ---------- 쓰기 ---------- */

export interface IcsOut {
  uid: string
  title: string
  /** YYYY-MM-DD */
  start: string
  end: string
  /** HH:MM 또는 빈 문자열(하루 종일) */
  time: string
  description?: string
}

const esc = (v: string): string => v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** 75 바이트마다 접는다 (한글이 잘리지 않게 글자 단위로) */
function fold(line: string): string {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line
  const parts: string[] = []
  let cur = ''
  let size = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(cur)
      cur = ''
      size = 0
    }
    cur += ch
    size += n
  }
  parts.push(cur)
  return parts.join('\r\n ')
}

const compact = (day: string): string => day.replace(/-/g, '')

/** 일정 목록 → .ics 글 (한국 시각) */
export function toIcs(events: IcsOut[], calName: string, now = new Date()): string {
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//work-dashboard//업무 인수인계 대시보드//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(calName)}`,
    'X-WR-TIMEZONE:Asia/Seoul',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Seoul',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'TZNAME:KST',
    'END:STANDARD',
    'END:VTIMEZONE'
  ]
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`, `SUMMARY:${esc(e.title)}`)
    if (e.time) {
      const [h, m] = e.time.split(':').map(Number)
      const endH = Math.min(23, h + 1)
      const endDay = e.end && e.end > e.start ? e.end : e.start
      lines.push(`DTSTART;TZID=Asia/Seoul:${compact(e.start)}T${pad(h)}${pad(m)}00`)
      lines.push(`DTEND;TZID=Asia/Seoul:${compact(endDay)}T${pad(endDay === e.start ? endH : h)}${pad(endDay === e.start && h >= 23 ? 59 : m)}00`)
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compact(e.start)}`)
      lines.push(`DTEND;VALUE=DATE:${compact(addDays(e.end && e.end >= e.start ? e.end : e.start, 1))}`)
    }
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
