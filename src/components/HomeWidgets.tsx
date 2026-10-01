import { useCallback, useEffect, useState } from 'react'
import type { Deadline, Notice, Task } from '../../shared/types'
import type { NeisLesson, NeisSchool } from '../../shared/neis'
import { NEIS_MARK, NEIS_SCHOOL_KEY, addDays, scheduleToEvents, ymd } from '../../shared/neis'
import type { HelpCatalog, HelpItem } from '../../shared/helpdocs'
import { MY_HELP_KEY, parseMine } from '../../shared/helpdocs'
import { hoursOf, periodNow, slotText, weekDate } from '../../shared/timetable'
import type { PageId } from '../App'
import { ClassTable, NeisWeek } from '../pages/Timetable'
import { nowInfo, useTimetable } from '../lib/timetable'
import { useToast } from '../lib/toast'
import { monthOf, sortTasks, todayStr } from '../lib/util'
import TimetableBoard from './TimetableBoard'

/**
 * 홈 위젯의 속(본문)들. 겉 틀(제목 · 접기 · 넓게 · 닫기 · 옮기기)은 Home.tsx 가 그린다.
 */

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const md = (day: string): string => {
  const d = new Date(`${day}T00:00:00`)
  return `${d.getMonth() + 1}. ${d.getDate()}.(${WEEK[d.getDay()]})`
}

function dday(day: string, today: string): string {
  const n = Math.round((new Date(`${day}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000)
  return n === 0 ? '오늘' : n > 0 ? `D-${n}` : `${-n}일 지남`
}

async function linkedSchool(): Promise<NeisSchool | null> {
  try {
    const s = JSON.parse((await window.api.setting.get(NEIS_SCHOOL_KEY)) || 'null') as NeisSchool | null
    return s?.code ? s : null
  } catch {
    return null
  }
}

/* ---------- 학교 정보 (작은 띠) ---------- */

export function SchoolStrip({ onGo }: { onGo: (p: PageId) => void }): JSX.Element {
  const [school, setSchool] = useState<NeisSchool | null | undefined>(undefined)
  useEffect(() => {
    void (async () => setSchool(await linkedSchool()))()
  }, [])
  if (school === undefined) return <span className="muted small">…</span>
  if (!school) {
    return (
      <span className="small muted">
        나이스에 학교를 연결하면 학교 주소 · 전화 · 누리집이 여기 뜹니다.{' '}
        <button className="link" onClick={() => onGo('설정')}>
          설정에서 연결
        </button>
      </span>
    )
  }
  return (
    <span className="school-strip">
      <b>{school.name}</b>
      <span>{school.atptName}</span>
      {school.address && <span>{school.address}</span>}
      {school.tel && <span>☎ {school.tel}</span>}
      {school.homepage && (
        <button className="link" onClick={() => void window.api.shell.open(/^https?:/.test(school.homepage) ? school.homepage : `http://${school.homepage}`)}>
          누리집 ↗
        </button>
      )}
    </span>
  )
}

/* ---------- 다가오는 학사일정 ---------- */

interface Upcoming {
  date: string
  end: string
  title: string
  off: boolean
}

export function ScheduleWidget({ onGo }: { onGo: (p: PageId) => void }): JSX.Element {
  const today = ymd(new Date())
  const [items, setItems] = useState<Upcoming[] | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    void (async () => {
      const to = addDays(today, 45)
      const school = await linkedSchool()
      const local = await window.api.local.load()
      if (school && local.neis_key?.trim()) {
        const r = await window.api.neis.schedule(today, to)
        if (r.ok) {
          const evs = scheduleToEvents(r.data, { skipSaturdayOff: true, skipHolidays: false, color: '' })
          setItems(evs.map((e) => ({ date: e.event_date, end: e.end_date, title: e.title, off: /휴업일|공휴일/.test(e.content) })))
          return
        }
        setNote(r.error ?? '')
      }
      // 키가 없으면 달력에 가져온 학사일정으로
      const evs = (await window.api.events.between(today, to)).filter((e) => e.content.includes(NEIS_MARK))
      if (evs.length) {
        setItems(evs.map((e) => ({ date: e.event_date, end: e.end_date || e.event_date, title: e.title, off: /휴업일/.test(e.content) })))
        return
      }
      setItems([])
      if (!school) setNote('나이스에 학교를 연결하고 인증키를 넣으면 학사일정이 여기 뜹니다.')
      else if (!local.neis_key?.trim()) setNote('인증키가 없으면 [달력 → 나이스 학사일정 가져오기] 로 넣어 둔 일정만 보입니다. 인증키를 넣으면 바로 받아 옵니다.')
    })()
  }, [today])

  if (!items) return <div className="muted small">불러오는 중…</div>
  if (!items.length) {
    return (
      <div className="muted small">
        {note || '앞으로 45일 안의 학사일정이 없습니다.'}{' '}
        <button className="link" onClick={() => onGo(note.includes('연결') ? '설정' : '달력')}>
          {note.includes('연결') ? '설정으로' : '달력으로'}
        </button>
      </div>
    )
  }
  return (
    <div className="upcoming">
      {items
        .filter((x) => x.end >= today)
        .slice(0, 8)
        .map((x) => (
          <div className="upcoming-row" key={`${x.date}-${x.title}`}>
            <span className={`badge ${x.date <= today ? 'badge-accent' : ''}`}>{x.date <= today ? '오늘' : dday(x.date, today)}</span>
            <span className="upcoming-date">
              {md(x.date)}
              {x.end !== x.date && ` ~ ${md(x.end)}`}
            </span>
            <span className="upcoming-title">{x.title}</span>
            {x.off && <span className="badge badge-warn">쉼</span>}
          </div>
        ))}
    </div>
  )
}

/* ---------- 내 시간표 ---------- */

export function MyTtWidget({ onGo, wide }: { onGo: (p: PageId) => void; wide: boolean }): JSX.Element {
  const T = useTimetable()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    // 교시가 바뀌는 것을 보여 주려고 1분마다 다시 그린다
    const t = setInterval(() => setTick((n) => n + 1), 60000)
    return () => clearInterval(t)
  }, [])
  void tick
  if (!T.loaded) return <div className="muted small">불러오는 중…</div>
  if (!T.my) {
    return (
      <div className="muted small">
        학교 시간표 엑셀을 불러오고 이름을 고르면(또는 직접 적으면) 내 시간표가 여기 뜹니다.{' '}
        <button className="link" onClick={() => onGo('시간표')}>
          시간표로
        </button>
      </div>
    )
  }
  const my = T.my
  const now = nowInfo()
  const cur = now.day >= 0 ? periodNow(my.periods, now.hhmm, T.times.length) : { index: -1, during: false }
  const todaySlots = now.day >= 0 ? my.grid[now.day].filter(Boolean).length : 0
  let line = ''
  if (now.day < 0) line = '오늘은 수업이 없는 날입니다.'
  else if (cur.index < 0) line = `오늘(${my.days[now.day]}) 수업 ${todaySlots}시간`
  else {
    const rest = my.grid[now.day].map((s, i) => ({ s, i })).filter((x) => x.s && x.i >= cur.index + (cur.during ? 1 : 0))
    const curSlot = cur.during ? my.grid[now.day][cur.index] : null
    const nxt = rest[0]
    line = [
      `오늘(${my.days[now.day]}) 수업 ${todaySlots}시간`,
      cur.index >= my.periods.length ? '오늘 수업이 끝났습니다' : cur.during ? `지금 ${my.periods[cur.index].label}${curSlot ? ` ${slotText(curSlot)}` : ' (빈 시간)'}` : '',
      nxt ? `다음: ${my.periods[nxt.i].label} ${slotText(nxt.s)}${my.periods[nxt.i].start ? ` (${my.periods[nxt.i].start})` : ''}` : ''
    ]
      .filter(Boolean)
      .join(' · ')
  }
  return (
    <div>
      <div className="mytt-line small">
        {line}
        <span className="muted"> · 한 주 {hoursOf(my)}시간</span>
      </div>
      <TimetableBoard my={my} length={T.times.length} compact={!wide} today={now.day} now={now.hhmm} />
    </div>
  )
}

/* ---------- 우리 반 시간표 ---------- */

export function ClassTtWidget({ onGo }: { onGo: (p: PageId) => void }): JSX.Element {
  const T = useTimetable()
  const [neis, setNeis] = useState<{ rows: NeisLesson[]; error?: string } | null>(null)
  const monday = weekDate(ymd(new Date()), 0)
  const inFile = !!T.tt?.classes.some((c) => c.id === T.myClass)

  useEffect(() => {
    if (!T.loaded || !T.myClass || inFile) return
    void (async () => {
      const [g, n] = T.myClass.split('-').map(Number)
      const r = await window.api.neis.classTimetable(g, n, monday, weekDate(monday, 4))
      setNeis({ rows: r.data, error: r.ok ? undefined : r.error })
    })()
  }, [T.loaded, T.myClass, inFile, monday])

  if (!T.loaded) return <div className="muted small">불러오는 중…</div>
  if (!T.myClass) {
    return (
      <div className="muted small">
        [시간표 → 파일 · 설정] 에서 우리 반(예: 2-4)을 정하면 여기 뜹니다.{' '}
        <button className="link" onClick={() => onGo('시간표')}>
          시간표로
        </button>
      </div>
    )
  }
  if (inFile && T.tt) return <ClassTable tt={T.tt} id={T.myClass} compact />
  if (!neis) return <div className="muted small">불러오는 중…</div>
  if (neis.error) return <div className="muted small">{neis.error} 학교 시간표 엑셀을 불러오면 키 없이도 보입니다.</div>
  return <NeisWeek rows={neis.rows} monday={monday} />
}

/* ---------- 절차 기한 ---------- */

export function DeadlinesWidget({ onGo }: { onGo: (p: PageId) => void }): JSX.Element {
  const today = todayStr()
  const [list, setList] = useState<Deadline[] | null>(null)
  useEffect(() => {
    void (async () => setList(await window.api.deadlines.list()))()
  }, [])
  if (!list) return <div className="muted small">불러오는 중…</div>
  const open = list.filter((d) => !d.done && d.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date))
  if (!open.length) {
    return (
      <div className="muted small">
        챙길 기한이 없습니다.{' '}
        <button className="link" onClick={() => onGo('기한')}>
          기한 넣기
        </button>
      </div>
    )
  }
  return (
    <div className="upcoming">
      {open.slice(0, 6).map((d) => (
        <div className="upcoming-row" key={d.id}>
          <span className={`badge ${d.due_date < today ? 'badge-danger' : d.due_date <= addDays(today, 3) ? 'badge-warn' : ''}`}>{dday(d.due_date, today)}</span>
          <span className="upcoming-date">{md(d.due_date)}</span>
          <span className="upcoming-title">{d.title}</span>
        </div>
      ))}
      {open.length > 6 && <div className="muted small">그 밖에 {open.length - 6}건</div>}
    </div>
  )
}

/* ---------- 내 업무 도움자료 ---------- */

export function HelpWidget({ onGo }: { onGo: (p: PageId) => void }): JSX.Element {
  const [items, setItems] = useState<HelpItem[] | null>(null)
  useEffect(() => {
    void (async () => {
      const [cat, raw] = await Promise.all([window.api.help.catalog(), window.api.setting.get(MY_HELP_KEY, '[]')])
      const mine = parseMine(raw)
      const all = new Map<string, HelpItem>()
      for (const g of (cat as HelpCatalog).groups) for (const s of g.sections) for (const it of s.items) all.set(it.id, it)
      setItems(mine.flatMap((id) => (all.get(id) ? [all.get(id)!] : [])))
    })()
  }, [])
  if (!items) return <div className="muted small">불러오는 중…</div>
  if (!items.length) {
    return (
      <div className="muted small">
        고른 내 업무가 없습니다.{' '}
        <button className="link" onClick={() => onGo('도움자료')}>
          내 업무 고르기
        </button>
      </div>
    )
  }
  return (
    <div className="upcoming">
      {items.map((it) => (
        <div className="upcoming-row" key={it.id}>
          <span className="upcoming-title">{it.title.replace(/^[\d-]+\.\s*/, '')}</span>
          <span className="muted small">자료 {it.files.length}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => void window.api.shell.open(it.url)}>
            📂 ↗
          </button>
        </div>
      ))}
    </div>
  )
}

/* ---------- 이 달 업무 ---------- */

export function TasksWidget({ tasks, onChanged, onGo }: { tasks: Task[]; onChanged: () => void; onGo: (p: PageId) => void }): JSX.Element {
  const thisMonth = new Date().getMonth() + 1
  const list = sortTasks(tasks.filter((t) => [thisMonth, 99].includes(monthOf(t.task_date_display))))
  if (!list.length) {
    return (
      <div className="muted small">
        이 달에 잡힌 업무가 없습니다.{' '}
        <button className="link" onClick={() => onGo('학습')}>
          문서로 업무 만들기
        </button>
      </div>
    )
  }
  return (
    <div>
      {list.map((t) => (
        <label className="check-row" key={t.id}>
          <input
            type="checkbox"
            checked={t.is_completed === 1}
            onChange={() =>
              void (async () => {
                await window.api.tasks.update(t.id, { is_completed: t.is_completed === 1 ? 0 : 1 })
                onChanged()
              })()
            }
          />
          <span>
            <span className={t.is_completed === 1 ? 'check-done' : ''}>{t.title}</span>
            <span className="item-meta"> · {t.task_date_display}</span>
          </span>
        </label>
      ))}
    </div>
  )
}

/* ---------- 메모 · 공지 ---------- */

const EMPTY = { title: '', content: '', link: '' }

export function NoticesWidget({ adding, onAdding }: { adding: boolean; onAdding: (v: boolean) => void }): JSX.Element {
  const toast = useToast()
  const [notices, setNotices] = useState<Notice[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(EMPTY)

  const load = useCallback(async () => setNotices(await window.api.notices.list()), [])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (adding && editingId === null) setForm(EMPTY)
  }, [adding, editingId])

  const cancel = (): void => {
    setEditingId(null)
    setForm(EMPTY)
    onAdding(false)
  }
  const save = async (): Promise<void> => {
    if (!form.title.trim()) {
      toast('제목을 입력해 주세요.', 'err')
      return
    }
    const payload = { ...form, date: todayStr() }
    if (editingId !== null) await window.api.notices.update(editingId, payload)
    else await window.api.notices.add(payload)
    cancel()
    await load()
    toast('저장했습니다.', 'ok')
  }

  return (
    <div>
      {adding && (
        <div style={{ marginBottom: 12 }}>
          <div className="field">
            <label>제목</label>
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: 나이스 권한 신청 방법" />
          </div>
          <div className="field">
            <label>내용</label>
            <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="다음 담당자가 알아두면 좋을 내용을 적어두세요." />
          </div>
          <div className="field">
            <label>관련 링크 (선택)</label>
            <input type="text" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="예: https://www.neis.go.kr" />
          </div>
          <div className="row row-end">
            <button className="btn btn-ghost" onClick={cancel}>
              취소
            </button>
            <button className="btn btn-primary" onClick={() => void save()}>
              {editingId !== null ? '수정 저장' : '등록'}
            </button>
          </div>
        </div>
      )}
      <div className="list">
        {notices.length === 0 && <div className="muted small">등록된 글이 없습니다.</div>}
        {notices.map((n) => (
          <div className="item" key={n.id}>
            <div className="item-head">
              <div>
                <div className="item-title">{n.title}</div>
                <div className="item-meta">{n.date}</div>
              </div>
              <div className="row">
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    setEditingId(n.id)
                    setForm({ title: n.title, content: n.content, link: n.link ?? '' })
                    onAdding(true)
                  }}
                >
                  수정
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() =>
                    void (async () => {
                      await window.api.notices.remove(n.id)
                      if (editingId === n.id) cancel()
                      await load()
                      toast('삭제했습니다.')
                    })()
                  }
                >
                  삭제
                </button>
              </div>
            </div>
            {n.content && <div className="item-body">{n.content}</div>}
            {n.link && (
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-sm" onClick={() => void window.api.shell.open(n.link)}>
                  🔗 링크 열기
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- 빠른 이동 ---------- */

export function QuickWidget({ onGo }: { onGo: (p: PageId) => void }): JSX.Element {
  const links: { page: PageId; label: string }[] = [
    { page: '학습', label: '📥 공문 · 매뉴얼로 업무 목록 만들기' },
    { page: '위원회', label: '📑 학교 문서 만들기' },
    { page: '도우미', label: '💬 업무 도우미에게 묻기' },
    { page: '로드맵', label: '📊 연간 로드맵 보기' },
    { page: '데이터', label: '💾 인수인계 파일 내보내기' }
  ]
  return (
    <div className="stack">
      {links.map((l) => (
        <button key={l.page} className="btn" onClick={() => onGo(l.page)}>
          {l.label}
        </button>
      ))}
    </div>
  )
}
