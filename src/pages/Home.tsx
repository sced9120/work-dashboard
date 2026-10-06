import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Notice, Task } from '../../shared/types'
import type { PageId } from '../App'
import Calendar from '../components/Calendar'
import type { CalView } from '../components/Calendar'
import LastYear from '../components/LastYear'
import MealCard from '../components/MealCard'
import {
  ClassTtWidget,
  DeadlinesWidget,
  HelpWidget,
  MyTtWidget,
  NoticesWidget,
  QuickWidget,
  ScheduleWidget,
  SchoolStrip,
  TasksWidget
} from '../components/HomeWidgets'
import type { Box, PxBox } from '../lib/freeLayout'
import { MIN_H, MIN_W, boardHeight, clampPx, fromPx, masonry, settle, toPx } from '../lib/freeLayout'
import { useToast } from '../lib/toast'

interface Props {
  jobTitle: string
  onGo: (p: PageId) => void
}

/**
 * 홈은 위젯 판이다. 두 가지로 놓는다.
 * - 격자 배치: 두 칸 격자. 접기 · 넓게/좁게 · 닫기, [홈 꾸미기] 에서 끌어 옮기기 · 더하기, [자동 정렬]
 *   (시간에 쫓기는 것을 위로, 반쪽 위젯끼리 짝지어 빈칸 없이)
 * - 자유 배치: 창처럼 제목 줄을 끌어 아무 데나 놓고, 네 모서리를 끌어 크기를 바꾼다.
 *   [겹쳐 놓기] 를 끄면 옮긴 위젯은 그 자리에 두고 겹친 위젯을 아래로 밀어낸다.
 * 배치는 DB 설정(home_widgets · home_mode)에 남는다.
 */

export type WidgetId =
  | 'school'
  | 'meal'
  | 'mytt'
  | 'classtt'
  | 'schedule'
  | 'deadlines'
  | 'calendar'
  | 'tasks'
  | 'help'
  | 'lastyear'
  | 'notices'
  | 'quick'

interface WidgetDef {
  icon: string
  title: string
  desc: string
  /** 처음 넓이 */
  wide: boolean
  /** 자동 정렬 차례 (작을수록 위) */
  rank: number
  /** 제목 옆 [열기] 로 갈 화면 */
  page?: PageId
  /** 자유 배치에서 처음 높이 (px) */
  h: number
}

export const WIDGETS: Record<WidgetId, WidgetDef> = {
  school: { icon: '🏫', title: '학교 정보', desc: '나이스에서 받은 학교 이름 · 주소 · 전화 · 누리집 (작은 띠)', wide: true, rank: 0, page: '설정', h: 50 },
  meal: { icon: '🍱', title: '오늘 급식', desc: '조식 · 중식 · 석식 (나이스)', wide: true, rank: 1, h: 270 },
  mytt: { icon: '🕘', title: '내 시간표', desc: '지금 몇 교시인지, 다음 수업 · 한 주 시간표 그림', wide: false, rank: 2, page: '시간표', h: 480 },
  classtt: { icon: '⭐', title: '우리 반 시간표', desc: '담임 학급 시간표 (시간표 파일 또는 나이스)', wide: false, rank: 3, page: '시간표', h: 330 },
  schedule: { icon: '📅', title: '다가오는 학사일정', desc: '앞으로 45일 안의 학교 행사 · 시험 · 휴업일 (나이스)', wide: false, rank: 4, page: '달력', h: 260 },
  deadlines: { icon: '⏰', title: '절차 기한', desc: '다가오는 통보 · 통지 기한과 D-day', wide: false, rank: 5, page: '기한', h: 220 },
  calendar: { icon: '🗓', title: '달력', desc: '한 달 · 한 주 보기, 일정 넣기 · 옮기기', wide: true, rank: 6, page: '달력', h: 560 },
  tasks: { icon: '✅', title: '이 달 업무', desc: '이번 달 · 수시 업무 체크', wide: false, rank: 7, page: '로드맵', h: 240 },
  help: { icon: '🧭', title: '내 업무 도움자료', desc: '고른 내 업무의 교육청 자료 폴더', wide: false, rank: 8, page: '도움자료', h: 240 },
  lastyear: { icon: '🔁', title: '작년 이맘때', desc: '지난 학년도 이맘때 했던 일', wide: true, rank: 9, page: '로드맵', h: 220 },
  notices: { icon: '📌', title: '메모 · 공지', desc: '다음 담당자에게 남길 메모', wide: false, rank: 10, h: 300 },
  quick: { icon: '🚀', title: '빠른 이동', desc: '자주 가는 화면 버튼', wide: false, rank: 11, h: 260 }
}

interface WidgetState {
  id: WidgetId
  wide: boolean
  folded: boolean
  /** 달력 위젯: 한 달 · 한 주 */
  view?: CalView
  /** 자유 배치에서의 자리 */
  box?: Box
}

interface HomeMode {
  free: boolean
  /** 자유 배치에서 위젯끼리 겹쳐 놓아도 되는지 */
  overlap: boolean
}

const HOME_KEY = 'home_widgets'
const MODE_KEY = 'home_mode'
const DEFAULT_ORDER: WidgetId[] = ['school', 'meal', 'mytt', 'schedule', 'calendar', 'deadlines', 'tasks', 'lastyear', 'notices', 'quick']
const defaults = (): WidgetState[] => DEFAULT_ORDER.map((id) => ({ id, wide: WIDGETS[id].wide, folded: false }))

const okBox = (b: unknown): b is Box =>
  !!b && typeof b === 'object' && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite((b as Record<string, number>)[k]))

function parseLayout(raw: string): WidgetState[] {
  try {
    const v = JSON.parse(raw || 'null') as WidgetState[] | null
    if (!Array.isArray(v)) return defaults()
    const seen = new Set<string>()
    return v
      .filter((w) => w && w.id in WIDGETS && !seen.has(w.id) && seen.add(w.id))
      .map((w) => ({ id: w.id, wide: !!w.wide, folded: !!w.folded, view: w.view, ...(okBox(w.box) ? { box: w.box } : {}) }))
  } catch {
    return defaults()
  }
}

function parseMode(raw: string): HomeMode {
  try {
    const v = JSON.parse(raw || 'null') as Partial<HomeMode> | null
    return { free: !!v?.free, overlap: !!v?.overlap }
  } catch {
    return { free: false, overlap: false }
  }
}

/**
 * 자동 정렬 — 차례(rank)대로 놓되, 반쪽 위젯 다음에 넓은 위젯이 오면 뒤에서 반쪽 짝을 끌어와 빈칸을 메운다.
 * 학교 정보 띠는 늘 맨 위.
 */
export function autoArrange(list: WidgetState[]): WidgetState[] {
  const rest = [...list].sort((a, b) => WIDGETS[a.id].rank - WIDGETS[b.id].rank)
  const out: WidgetState[] = []
  while (rest.length) {
    const w = rest.shift()!
    out.push(w)
    if (w.wide || w.folded) continue
    const j = rest.findIndex((x) => !x.wide && !x.folded)
    if (j >= 0) out.push(...rest.splice(j, 1))
  }
  return out
}

/** 자유 배치의 자리를 차례대로 벽돌 쌓기로 매긴다 (높이는 지금 높이, 없으면 위젯마다 정한 높이) */
function packFree(list: WidgetState[], W: number): WidgetState[] {
  const boxes = masonry(
    list.map((w) => ({ id: w.id, wide: w.wide || w.id === 'school', h: w.box?.h ?? WIDGETS[w.id].h })),
    W
  )
  return list.map((w) => ({ ...w, box: boxes[w.id] }))
}

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se'

interface Live {
  id: WidgetId
  kind: Handle
  mx: number
  my: number
  orig: PxBox
  cur: PxBox
}

export default function Home({ jobTitle, onGo }: Props): JSX.Element {
  const toast = useToast()
  const [tasks, setTasks] = useState<Task[]>([])
  const [notices, setNotices] = useState<Notice[]>([])
  const [layout, setLayout] = useState<WidgetState[] | null>(null)
  const [mode, setMode] = useState<HomeMode>({ free: false, overlap: false })
  const [editing, setEditing] = useState(false)
  const [dragId, setDragId] = useState<WidgetId | null>(null)
  const [noticeAdding, setNoticeAdding] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const [boardW, setBoardW] = useState(0)
  const [live, setLive] = useState<Live | null>(null)
  const liveRef = useRef<Live | null>(null)

  const load = useCallback(async () => {
    setTasks(await window.api.tasks.list())
    setNotices(await window.api.notices.list())
  }, [])

  useEffect(() => {
    void load()
    void (async () => {
      const [raw, m] = await Promise.all([window.api.setting.get(HOME_KEY), window.api.setting.get(MODE_KEY)])
      setLayout(parseLayout(raw))
      setMode(parseMode(m))
    })()
  }, [load])

  // 자유 배치 판의 너비 — 창 크기가 바뀌면 따라간다
  useLayoutEffect(() => {
    const el = boardRef.current
    if (!el) return
    const update = (): void => setBoardW(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [mode.free, layout === null])

  const commit = (next: WidgetState[]): void => {
    setLayout(next)
    void window.api.setting.set(HOME_KEY, JSON.stringify(next))
  }
  const saveMode = (m: HomeMode): void => {
    setMode(m)
    void window.api.setting.set(MODE_KEY, JSON.stringify(m))
  }

  // 자유 배치에서 자리가 없는 위젯(새로 더한 것)은 맨 아래에 놓는다
  useEffect(() => {
    if (!mode.free || !layout || !boardW) return
    if (layout.every((w) => w.box)) return
    let bottom = layout.reduce((m, w) => (w.box ? Math.max(m, w.box.y + w.box.h) : m), 0)
    const next = layout.map((w) => {
      if (w.box) return w
      const h = WIDGETS[w.id].h
      const box = { x: 0, y: bottom ? bottom + 14 : 0, w: w.wide || w.id === 'school' ? 1 : 0.5, h }
      bottom = box.y + h
      return { ...w, box }
    })
    commit(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode.free, layout, boardW])

  if (!layout) return <div className="muted">불러오는 중…</div>

  const patch = (id: WidgetId, p: Partial<WidgetState>): void => commit(layout.map((w) => (w.id === id ? { ...w, ...p } : w)))
  const remove = (id: WidgetId): void => {
    commit(layout.filter((w) => w.id !== id))
    toast(`'${WIDGETS[id].title}' 위젯을 닫았습니다. [✏️ 홈 꾸미기] 에서 다시 더할 수 있습니다.`)
  }
  const move = (id: WidgetId, delta: number): void => {
    const i = layout.findIndex((w) => w.id === id)
    const j = i + delta
    if (j < 0 || j >= layout.length) return
    const next = [...layout]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }
  const dropOn = (target: WidgetId): void => {
    if (!dragId || dragId === target) return
    const from = layout.find((w) => w.id === dragId)!
    const rest = layout.filter((w) => w.id !== dragId)
    const at = rest.findIndex((w) => w.id === target)
    rest.splice(at, 0, from)
    commit(rest)
    setDragId(null)
  }
  const hidden = (Object.keys(WIDGETS) as WidgetId[]).filter((id) => !layout.some((w) => w.id === id))
  const doneCount = tasks.filter((t) => t.is_completed === 1).length

  /* ---------- 자유 배치 ---------- */

  /** 격자에서 보이던 자리 그대로 자유 배치로 옮긴다 */
  const toFree = (): void => {
    const grid = gridRef.current
    const W = grid?.clientWidth ?? 0
    if (!grid || !W) {
      saveMode({ ...mode, free: true })
      return
    }
    const base = grid.getBoundingClientRect()
    let next = layout.map((w) => {
      const el = grid.querySelector<HTMLElement>(`[data-wid="${w.id}"]`)
      if (!el) return w
      const r = el.getBoundingClientRect()
      // 접힌 위젯은 펼쳤을 때의 높이를 둔다
      const h = w.folded ? w.box?.h ?? WIDGETS[w.id].h : r.height
      return { ...w, box: fromPx({ left: r.left - base.left, top: r.top - base.top, width: r.width, height: h }, W) }
    })
    // 10px 칸에 붙이며 생긴 겹침을 한 번 정리한다
    const top = [...next].filter((w) => w.box).sort((a, b) => a.box!.y - b.box!.y)[0]
    if (top) {
      const settled = new Map(settle(next.filter((w) => w.box).map((w) => ({ id: w.id, box: toPx(w.box!, W) })), top.id).map((s) => [s.id, s.box]))
      next = next.map((w) => (settled.has(w.id) ? { ...w, box: fromPx(settled.get(w.id)!, W) } : w))
    }
    commit(next)
    saveMode({ ...mode, free: true })
  }

  const begin = (e: ReactPointerEvent, id: WidgetId, kind: Handle): void => {
    if (!mode.free || !boardW || e.button !== 0) return
    if (kind === 'move' && (e.target as HTMLElement).closest('button, a, input, select, textarea')) return
    const w = layout.find((x) => x.id === id)
    if (!w?.box) return
    e.preventDefault()
    const orig = toPx(w.box, boardW)
    const l: Live = { id, kind, mx: e.clientX, my: e.clientY, orig, cur: orig }
    liveRef.current = l
    setLive(l)
    // 겹쳐 놓기에서는 만진 위젯이 맨 위로 온다
    if (mode.overlap && layout[layout.length - 1].id !== id) commit([...layout.filter((x) => x.id !== id), w])

    const onMove = (ev: PointerEvent): void => {
      const cur = liveRef.current
      if (!cur) return
      const dx = ev.clientX - cur.mx
      const dy = ev.clientY - cur.my
      const o = cur.orig
      let p: PxBox
      if (cur.kind === 'move') p = { ...o, left: o.left + dx, top: o.top + dy }
      else {
        const west = cur.kind === 'nw' || cur.kind === 'sw'
        const north = cur.kind === 'nw' || cur.kind === 'ne'
        p = {
          left: west ? o.left + Math.min(dx, o.width - MIN_W) : o.left,
          width: west ? o.width - Math.min(dx, o.width - MIN_W) : o.width + dx,
          top: north ? o.top + Math.min(dy, o.height - MIN_H) : o.top,
          height: north ? o.height - Math.min(dy, o.height - MIN_H) : o.height + dy
        }
      }
      const next = { ...cur, cur: clampPx(p, boardW) }
      liveRef.current = next
      setLive(next)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const fin = liveRef.current
      liveRef.current = null
      setLive(null)
      if (!fin) return
      setLayout((cur) => {
        if (!cur) return cur
        const placedBox = fromPx(fin.cur, boardW)
        let next = cur.map((x) => (x.id === fin.id ? { ...x, box: placedBox } : x))
        if (!mode.overlap) {
          const settled = settle(
            next.filter((x) => x.box).map((x) => ({ id: x.id, box: toPx(x.box!, boardW) })),
            fin.id
          )
          const byId = new Map(settled.map((s) => [s.id, s.box]))
          next = next.map((x) => (x.id !== fin.id && byId.has(x.id) ? { ...x, box: fromPx(byId.get(x.id)!, boardW) } : x))
        }
        void window.api.setting.set(HOME_KEY, JSON.stringify(next))
        return next
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /* ---------- 위젯 속 ---------- */

  const body = (w: WidgetState): JSX.Element | null => {
    switch (w.id) {
      case 'school':
        return <SchoolStrip onGo={onGo} />
      case 'meal':
        return <MealCard onGo={onGo} />
      case 'mytt':
        return <MyTtWidget onGo={onGo} wide={mode.free ? (w.box?.w ?? 0) * boardW > 560 : w.wide} />
      case 'classtt':
        return <ClassTtWidget onGo={onGo} />
      case 'schedule':
        return <ScheduleWidget onGo={onGo} />
      case 'deadlines':
        return <DeadlinesWidget onGo={onGo} />
      case 'calendar':
        return (
          <Calendar
            tasks={tasks}
            compact
            monthLanes={(mode.free ? (w.box?.w ?? 0) * boardW > 700 : w.wide) ? 3 : 2}
            onOpenFull={() => onGo('달력')}
            view={w.view ?? 'month'}
            onView={(v) => patch('calendar', { view: v })}
          />
        )
      case 'tasks':
        return <TasksWidget tasks={tasks} onChanged={() => void load()} onGo={onGo} />
      case 'help':
        return <HelpWidget onGo={onGo} />
      case 'lastyear':
        return <LastYear tasks={tasks} onGo={onGo} bare />
      case 'notices':
        return <NoticesWidget adding={noticeAdding} onAdding={setNoticeAdding} />
      case 'quick':
        return <QuickWidget onGo={onGo} />
    }
  }

  const extra = (w: WidgetState): JSX.Element | null => {
    if (w.id === 'notices')
      return (
        <button className="btn btn-sm" onClick={() => setNoticeAdding((v) => !v)}>
          {noticeAdding ? '닫기' : '＋ 새 글'}
        </button>
      )
    if (w.id === 'tasks') {
      const m = new Date().getMonth() + 1
      return <span className="muted small">{m}월 · 완료 {doneCount}/{tasks.length}</span>
    }
    return null
  }

  /** 위젯 하나 (격자 · 자유 배치가 함께 쓴다) */
  const widget = (w: WidgetState, i: number): JSX.Element => {
    const def = WIDGETS[w.id]
    const strip = w.id === 'school'
    const free = mode.free
    const isLive = live?.id === w.id
    const px = free && w.box && boardW ? (isLive ? live!.cur : toPx(w.box, boardW)) : null
    const style = px
      ? { left: px.left, top: px.top, width: px.width, height: w.folded ? undefined : px.height, zIndex: isLive ? layout.length + 5 : i + 1 }
      : undefined
    return (
      <section
        key={w.id}
        data-wid={w.id}
        style={style}
        className={`hw ${!free && (w.wide || strip) ? 'wide' : ''} ${w.folded ? 'folded' : ''} ${strip ? 'strip' : ''} ${
          dragId === w.id ? 'dragging' : ''
        } ${free ? 'free' : ''} ${isLive ? 'live' : ''}`}
        draggable={editing && !free}
        onDragStart={(e) => {
          setDragId(w.id)
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', w.id)
        }}
        onDragEnd={() => setDragId(null)}
        onDragOver={(e) => {
          if (dragId && dragId !== w.id) e.preventDefault()
        }}
        onDrop={(e) => {
          e.preventDefault()
          dropOn(w.id)
        }}
      >
        <header className="hw-head" onPointerDown={free ? (e) => begin(e, w.id, 'move') : undefined} title={free ? '제목 줄을 끌어 옮기고, 모서리를 끌어 크기를 바꿉니다' : undefined}>
          {editing && !free && <span className="hw-grip" title="끌어서 옮기기">⠿</span>}
          <span className="hw-title">
            {def.icon} {strip && !w.folded ? '' : def.title}
          </span>
          {strip && !w.folded ? <span className="hw-strip-body">{body(w)}</span> : <span className="spacer" />}
          {!w.folded && !strip && extra(w)}
          <span className="hw-tools">
            {editing && !free && (
              <>
                <button className="hw-btn" onClick={() => move(w.id, -1)} disabled={i === 0} title="앞으로">
                  ↑
                </button>
                <button className="hw-btn" onClick={() => move(w.id, 1)} disabled={i === layout.length - 1} title="뒤로">
                  ↓
                </button>
              </>
            )}
            {def.page && !editing && (
              <button className="hw-btn" onClick={() => onGo(def.page!)} title={`${def.title} 화면으로`}>
                ↗
              </button>
            )}
            <button className="hw-btn" onClick={() => patch(w.id, { folded: !w.folded })} title={w.folded ? '펼치기' : '접기'}>
              {w.folded ? '▸' : '▾'}
            </button>
            {!strip && !free && (
              <button className="hw-btn" onClick={() => patch(w.id, { wide: !w.wide })} title={w.wide ? '좁게 (반쪽)' : '넓게 (한 줄)'}>
                ↔
              </button>
            )}
            <button className="hw-btn" onClick={() => remove(w.id)} title="닫기 (홈 꾸미기에서 다시 더할 수 있음)">
              ✕
            </button>
          </span>
        </header>
        {!w.folded && !strip && <div className="hw-body">{body(w)}</div>}
        {free && !w.folded &&
          (['nw', 'ne', 'sw', 'se'] as Handle[]).map((h) => (
            <span key={h} className={`hw-corner ${h}`} onPointerDown={(e) => begin(e, w.id, h)} title="끌어서 크기 바꾸기" />
          ))}
      </section>
    )
  }

  const freeBoxes = mode.free && boardW ? layout.filter((w) => w.box).map((w) => (live?.id === w.id ? live.cur : toPx(w.box!, boardW))) : []

  return (
    <>
      <div className="page-head page-head-row">
        <div>
          <h1>{jobTitle} 업무 대시보드</h1>
          <p>
            등록된 업무 {tasks.length}건 · 완료 {doneCount}건 · 공지 {notices.length}건
          </p>
        </div>
        <div className="row">
          {editing && (
            <>
              <button
                className="btn btn-sm"
                onClick={() => {
                  const arranged = autoArrange(layout)
                  commit(mode.free && boardW ? packFree(arranged, boardW) : arranged)
                }}
                title={mode.free ? '급한 것부터 위로, 두 칸에 빈틈 없이 쌓습니다' : '급한 것부터 위로, 반쪽 위젯끼리 짝지어 빈칸 없이'}
              >
                🧲 자동 정렬
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => commit(mode.free && boardW ? packFree(defaults(), boardW) : defaults())}
              >
                ↺ 처음 모양
              </button>
            </>
          )}
          <button className={`btn btn-sm ${editing ? 'btn-primary' : ''}`} onClick={() => setEditing((v) => !v)}>
            {editing ? '✓ 꾸미기 끝' : '✏️ 홈 꾸미기'}
          </button>
        </div>
      </div>

      {editing && (
        <div className="card hw-add">
          <div className="card-title">
            <span>배치</span>
          </div>
          <div className="row hw-modes">
            <label className={`hw-mode ${!mode.free ? 'on' : ''}`}>
              <input type="radio" checked={!mode.free} onChange={() => saveMode({ ...mode, free: false })} />
              <span>
                <b>격자 배치</b>
                <small>두 칸 격자에 맞춰 놓습니다. 끌어 옮기기 · ↑↓ · 넓게/좁게</small>
              </span>
            </label>
            <label className={`hw-mode ${mode.free ? 'on' : ''}`}>
              <input type="radio" checked={mode.free} onChange={() => !mode.free && toFree()} />
              <span>
                <b>자유 배치 (창처럼)</b>
                <small>제목 줄을 끌어 아무 데나 놓고, 네 모서리를 끌어 크기를 바꿉니다</small>
              </span>
            </label>
            {mode.free && (
              <label className="neis-opt" title="끄면 옮긴 위젯은 그 자리에 두고, 겹친 위젯을 아래로 밀어냅니다">
                <input type="checkbox" checked={mode.overlap} onChange={(e) => saveMode({ ...mode, overlap: e.target.checked })} />
                <span>겹쳐 놓기 허용</span>
              </label>
            )}
          </div>

          <div className="card-title" style={{ marginTop: 14 }}>
            <span>＋ 위젯 더하기</span>
            <span className="muted small">
              {mode.free
                ? '자유 배치에서는 위젯을 놓으면 맨 아래에 들어옵니다. ▾ 접기, ✕ 닫기.'
                : '위젯을 끌어 옮기거나 ↑ ↓ 로 차례를 바꾸세요. ↔ 는 넓게 · 좁게, ✕ 는 닫기입니다.'}
            </span>
          </div>
          {hidden.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>모든 위젯이 홈에 있습니다.</p>
          ) : (
            <div className="hw-add-list">
              {hidden.map((id) => (
                <button key={id} className="pickcard" onClick={() => commit([...layout, { id, wide: WIDGETS[id].wide, folded: false }])}>
                  <span className="pickcard-icon">{WIDGETS[id].icon}</span>
                  <span className="pickcard-body">
                    <span className="pickcard-name">{WIDGETS[id].title}</span>
                    <span className="pickcard-sum">{WIDGETS[id].desc}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {layout.length === 0 && (
        <div className="empty">
          홈에 위젯이 없습니다. <button className="link" onClick={() => setEditing(true)}>[✏️ 홈 꾸미기]</button> 에서 더해 주세요.
        </div>
      )}

      {mode.free ? (
        <div
          ref={boardRef}
          className={`hw-board ${editing ? 'editing' : ''} ${live ? 'busy' : ''}`}
          style={{ height: boardHeight(freeBoxes) + (live ? 200 : 0) }}
        >
          {layout.map((w, i) => widget(w, i))}
        </div>
      ) : (
        <div ref={gridRef} className={`hw-grid ${editing ? 'editing' : ''}`}>
          {layout.map((w, i) => widget(w, i))}
        </div>
      )}
    </>
  )
}
