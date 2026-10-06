/**
 * 구글 캘린더와 일정을 주고받는다 (원하는 사람만). 읽기 · 쓰기 규칙은 shared/ics.ts.
 *
 * - 보기: 구글 캘린더의 "iCal 형식의 비공개 주소"에서 받아 달력에 겹쳐 보인다. 받기만 하고 바꾸지 않는다.
 *   주소는 아는 사람은 누구나 일정을 볼 수 있는 비밀이라 AI 키처럼 이 PC 에만(암호화) 둔다.
 * - 보내기: 이 프로그램의 일정을 .ics 파일로 저장해 구글 캘린더에서 [가져오기] 한다.
 *   절차 기한(학생 이름이 섞일 수 있음) · 메모는 고른 경우에만 넣는다.
 */

import { app, dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { IcsEvent, IcsOut } from '../../shared/ics'
import { parseIcs, toIcs } from '../../shared/ics'
import * as db from './db'
import { httpFetch } from './http'
import { loadLocalSettings } from './secrets'

const TTL = 15 * 60 * 1000
let cache: { url: string; at: number; text: string } | null = null

/** webcal:// 은 https:// 로. 그 밖에 http(s) 가 아니면 빈 문자열 */
export function normalizeUrl(raw: string): string {
  const u = raw.trim().replace(/^webcals?:\/\//i, 'https://')
  return /^https?:\/\/\S+$/i.test(u) ? u : ''
}

async function fetchText(force = false): Promise<string> {
  const url = normalizeUrl(loadLocalSettings().gcal_url ?? '')
  if (!url) throw new Error('구글 캘린더 주소가 없습니다.')
  if (!force && cache && cache.url === url && Date.now() - cache.at < TTL) return cache.text
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  let res: Response
  try {
    res = await httpFetch(url, { signal: ctrl.signal })
  } catch {
    throw new Error('구글 캘린더에 연결하지 못했습니다. 인터넷이 되는지, 학교망에서 막히지 않았는지 확인해 주세요.')
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 404 || res.status === 403 || res.status === 401) {
    throw new Error('주소가 맞지 않거나 바뀌었습니다. 구글 캘린더 설정에서 "iCal 형식의 비공개 주소"를 다시 복사해 주세요.')
  }
  if (!res.ok) throw new Error(`구글 캘린더가 응답하지 않습니다(HTTP ${res.status}).`)
  const text = await res.text()
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('캘린더(iCal) 주소가 아닙니다. "iCal 형식의 비공개 주소"를 넣어 주세요.')
  cache = { url, at: Date.now(), text }
  return text
}

export async function gcalEvents(from: string, to: string): Promise<{ ok: boolean; events: IcsEvent[]; error?: string }> {
  if (!normalizeUrl(loadLocalSettings().gcal_url ?? '')) return { ok: true, events: [] }
  try {
    return { ok: true, events: parseIcs(await fetchText(), from, to) }
  } catch (e) {
    return { ok: false, events: [], error: e instanceof Error ? e.message : String(e) }
  }
}

export async function gcalTest(): Promise<{ ok: boolean; message: string }> {
  try {
    const text = await fetchText(true)
    const d = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    const from = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    const t = new Date(d)
    t.setDate(t.getDate() + 30)
    const to = `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`
    const n = parseIcs(text, from, to).length
    return { ok: true, message: `구글 캘린더에 연결했습니다. 앞으로 30일 안의 일정 ${n}건을 달력에 함께 보여 드립니다.` }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export function clearGcalCache(): void {
  cache = null
}

/** 이 프로그램의 일정을 .ics 파일로 저장한다 */
export async function exportIcs(
  win: BrowserWindow | null,
  args: { from: string; to: string; deadlines: boolean; memo: boolean }
): Promise<{ ok: boolean; message: string; count?: number; path?: string }> {
  const ok = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  if (!ok(args.from) || !ok(args.to) || args.from > args.to) return { ok: false, message: '기간을 다시 골라 주세요.' }
  const out: IcsOut[] = db.listEventsBetween(args.from, args.to).map((e) => ({
    uid: `wd-event-${e.id}@work-dashboard`,
    title: e.title,
    start: e.event_date,
    end: e.end_date || e.event_date,
    time: e.start_time || '',
    ...(args.memo && e.content ? { description: e.content } : {})
  }))
  if (args.deadlines) {
    // 기한은 제목만 보낸다 — 사안 · 메모에 학생 이름이 들기 쉽다
    for (const d of db.listDeadlines()) {
      if (d.done || !d.due_date || d.due_date < args.from || d.due_date > args.to) continue
      out.push({ uid: `wd-deadline-${d.id}@work-dashboard`, title: `⏰ ${d.title}`, start: d.due_date, end: d.due_date, time: '' })
    }
  }
  if (!out.length) return { ok: false, message: '이 기간에 보낼 일정이 없습니다.' }
  if (!win) return { ok: false, message: '창을 찾을 수 없습니다.' }
  const res = await dialog.showSaveDialog(win, {
    title: '구글 캘린더로 보낼 파일 저장',
    defaultPath: path.join(app.getPath('documents'), `업무대시보드_일정_${args.from}_${args.to}.ics`),
    filters: [{ name: 'iCalendar', extensions: ['ics'] }]
  })
  if (res.canceled || !res.filePath) return { ok: false, message: '취소했습니다.' }
  fs.writeFileSync(res.filePath, toIcs(out, '업무 대시보드'), 'utf8')
  return { ok: true, message: `일정 ${out.length}건을 저장했습니다: ${res.filePath}`, count: out.length, path: res.filePath }
}
