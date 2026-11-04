import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { Task } from '../../shared/types'
import type { Cell, Edge, Placed, SizeLimit } from '../../shared/widgetGrid'
import { GRID_COLS, bottomOf, clampCell, compact, firstFree, place, resizeCell, stackOrder, toCell, untangle } from '../../shared/widgetGrid'
import type { PageId } from '../App'
import Calendar from './Calendar'
import type { CalView } from './Calendar'
import LastYear from './LastYear'
import MealCard from './MealCard'
import { Hero } from './TodayPanel'
import Icon from './Icon'
import type { IconName } from './Icon'
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
} from './HomeWidgets'
import { useToast } from '../lib/toast'

/**
 * 새 화면의 '오늘' 판 — 갤럭시 홈 화면처럼 위젯을 칸에 맞춰 놓는다.
 *  - 위젯을 길게 누르면(또는 [편집]) 편집이 열린다. 누른 채로 끌면 바로 옮겨진다.
 *  - 편집에서 위젯을 누르면 테두리 손잡이가 생기고, 손잡이를 끌면 칸 단위로 크기가 바뀐다.
 *  - 옮기거나 키우면 겹친 위젯은 아래로 비켜 간다. 손을 떼기 전에 다른 데로 가면 제자리로 돌아온다.
 *  - [＋ 위젯] 은 위젯 목록(크기 고르기), [설정] 은 위젯마다 배경 · 투명도 · 제목 줄.
 * 판은 DB 설정 today_board 에 남는다(예전 화면의 홈 배치와는 따로).
 */

type BoardId =
  | 'now'
  | 'clock'
  | 'meal'
  | 'deadlines'
  | 'notices'
  | 'mytt'
  | 'classtt'
  | 'calendar'
  | 'schedule'
  | 'tasks'
  | 'lastyear'
  | 'help'
  | 'quick'
  | 'school'

type Group = '오늘' | '시간표' | '일정' | '업무' | '학교'

interface Def {
  icon: IconName
  title: string
  desc: string
  group: Group
  /** 처음 크기 [가로 칸, 세로 줄] */
  size: [number, number]
  lim: SizeLimit
  /** 위젯 목록에서 고를 수 있는 크기 */
  sizes: [number, number][]
  /** 제목 옆 [열기] 로 갈 화면 */
  page?: PageId
}

const DEFS: Record<BoardId, Def> = {
  now: { icon: 'spark', title: '지금 · 오늘 수업', desc: '지금 몇 교시인지, 오늘 교시 띠와 오늘 일정', group: '오늘', size: [5, 4], lim: { minW: 4, minH: 3, maxW: 8, maxH: 6 }, sizes: [[5, 4], [8, 4], [4, 5]], page: '시간표' },
  clock: { icon: 'clock', title: '날짜 · 시각', desc: '큰 시계와 오늘 날짜', group: '오늘', size: [3, 2], lim: { minW: 2, minH: 1, maxW: 4, maxH: 3 }, sizes: [[2, 1], [3, 2], [4, 2]] },
  meal: { icon: 'meal', title: '오늘 급식', desc: '조식 · 중식 · 석식 (나이스)', group: '오늘', size: [3, 2], lim: { minW: 2, minH: 2, maxW: 8, maxH: 5 }, sizes: [[3, 2], [4, 3], [8, 3]] },
  deadlines: { icon: 'hourglass', title: '절차 기한', desc: '다가오는 통보 · 통지 기한과 D-day', group: '오늘', size: [4, 3], lim: { minW: 3, minH: 2, maxW: 8, maxH: 6 }, sizes: [[4, 3], [4, 4]], page: '기한' },
  notices: { icon: 'pin', title: '메모 · 공지', desc: '다음 담당자에게 남길 메모', group: '오늘', size: [4, 4], lim: { minW: 3, minH: 3, maxW: 8, maxH: 8 }, sizes: [[4, 4], [4, 6], [8, 4]] },
  mytt: { icon: 'clock', title: '내 시간표', desc: '다음 수업과 한 주 시간표 그림', group: '시간표', size: [4, 5], lim: { minW: 3, minH: 3, maxW: 8, maxH: 8 }, sizes: [[4, 5], [8, 5]], page: '시간표' },
  classtt: { icon: 'class', title: '우리 반 시간표', desc: '담임 학급 시간표', group: '시간표', size: [4, 4], lim: { minW: 3, minH: 3, maxW: 8, maxH: 7 }, sizes: [[4, 4], [8, 4]], page: '시간표' },
  calendar: { icon: 'calendar', title: '달력', desc: '한 달 · 한 주 보기, 일정 넣기', group: '일정', size: [4, 6], lim: { minW: 4, minH: 4, maxW: 8, maxH: 9 }, sizes: [[4, 6], [8, 6]], page: '달력' },
  schedule: { icon: 'event', title: '다가오는 학사일정', desc: '앞으로 45일 안의 학교 행사 · 시험 · 휴업일', group: '일정', size: [4, 3], lim: { minW: 3, minH: 2, maxW: 8, maxH: 6 }, sizes: [[4, 3], [4, 4]], page: '달력' },
  tasks: { icon: 'guide', title: '이 달 업무', desc: '이번 달 · 수시 업무 체크', group: '업무', size: [4, 4], lim: { minW: 3, minH: 3, maxW: 8, maxH: 8 }, sizes: [[4, 4], [8, 4]], page: '로드맵' },
  lastyear: { icon: 'past', title: '작년 이맘때', desc: '지난 학년도 이맘때 했던 일', group: '업무', size: [4, 3], lim: { minW: 3, minH: 2, maxW: 8, maxH: 6 }, sizes: [[4, 3], [8, 3]], page: '로드맵' },
  help: { icon: 'compass', title: '내 업무 도움자료', desc: '고른 내 업무의 교육청 자료 폴더', group: '업무', size: [4, 3], lim: { minW: 3, minH: 2, maxW: 8, maxH: 6 }, sizes: [[4, 3]], page: '도움자료' },
  quick: { icon: 'rocket', title: '빠른 이동', desc: '자주 가는 화면 버튼', group: '업무', size: [4, 3], lim: { minW: 3, minH: 2, maxW: 8, maxH: 5 }, sizes: [[4, 3], [8, 2]] },
  school: { icon: 'school', title: '학교 정보', desc: '학교 이름 · 주소 · 전화 · 누리집 (한 줄 띠)', group: '학교', size: [8, 1], lim: { minW: 4, minH: 1, maxW: 8, maxH: 1 }, sizes: [[8, 1]], page: '설정' }
}

const GROUPS: Group[] = ['오늘', '시간표', '일정', '업무', '학교']

type WidgetBg = 'auto' | 'light' | 'dark'

interface Look {
  bg: WidgetBg
  /** 배경 투명도 (0 = 불투명, 90 = 거의 투명) */
  alpha: number
  /** 제목 줄 보이기 */
  title: boolean
}

const LOOK: Look = { bg: 'auto', alpha: 0, title: true }

interface Item extends Placed {
  id: BoardId
  look?: Partial<Look>
  view?: CalView
}

const KEY = 'today_board'
/** 한 줄 높이 · 칸 사이 (px) */
const ROW = 76
const GAP = 12
/** 이보다 좁으면 한 줄로 쌓고 편집은 닫는다 */
const NARROW = 720
/** 길게 누르기 (ms) · 끌기로 치는 거리 (px) */
const HOLD_MS = 450
const SLOP = 8

const DEFAULT_PLACES: [BoardId, number, number][] = [
  ['now', 0, 0],
  ['clock', 5, 0],
  ['meal', 5, 2],
  ['deadlines', 0, 4],
  ['notices', 4, 4],
  ['calendar', 0, 7],
  ['schedule', 4, 8],
  ['tasks', 4, 11]
]

const defaults = (): Item[] => DEFAULT_PLACES.map(([id, x, y]) => ({ id, x, y, w: DEFS[id].size[0], h: DEFS[id].size[1] }))

const lookOf = (it: Item): Look => ({ ...LOOK, ...it.look })

function cleanLook(v: unknown): Partial<Look> | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const out: Partial<Look> = {}
  if (o.bg === 'light' || o.bg === 'dark' || o.bg === 'auto') out.bg = o.bg
  if (typeof o.alpha === 'number' && Number.isFinite(o.alpha)) out.alpha = Math.max(0, Math.min(90, Math.round(o.alpha)))
  if (typeof o.title === 'boolean') out.title = o.title
  return Object.keys(out).length ? out : undefined
}

export function parseBoard(raw: string): Item[] {
  try {
    const v = JSON.parse(raw || 'null') as { items?: unknown } | null
    if (!v || !Array.isArray(v.items)) return defaults()
    const seen = new Set<string>()
    const list: Item[] = []
    for (const r of v.items as Record<string, unknown>[]) {
      if (!r || typeof r.id !== 'string' || !(r.id in DEFS) || seen.has(r.id)) continue
      if (!['x', 'y', 'w', 'h'].every((k) => Number.isFinite(r[k] as number))) continue
      seen.add(r.id)
      const id = r.id as BoardId
      const c = clampCell(r as unknown as Cell, DEFS[id].lim)
      const look = cleanLook(r.look)
      list.push({ id, ...c, ...(look ? { look } : {}), ...(r.view === 'week' || r.view === 'month' ? { view: r.view } : {}) })
    }
    return untangle(list) as Item[]
  } catch {
    return defaults()
  }
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const two = (n: number): string => String(n).padStart(2, '0')

/** 날짜 · 시각 위젯 — 크기에 맞춰 글자가 커진다 */
function ClockBody(): JSX.Element {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="tw-clock">
      <b>
        {two(now.getHours())}:{two(now.getMinutes())}
      </b>
      <span>
        {now.getMonth() + 1}월 {now.getDate()}일 {WEEK[now.getDay()]}요일
      </span>
    </div>
  )
}

type Kind = 'move' | Edge

interface Live {
  id: BoardId
  kind: Kind
  startX: number
  startY: number
  /** 잡은 곳이 위젯 왼쪽 위에서 얼마나 떨어졌는지 */
  grabX: number
  grabY: number
  orig: Item[]
  origCell: Cell
  /** 실제로 끌기 시작했는지 (조금 움직이기 전까지는 누르기) */
  moved: boolean
  /** 옮기는 중인 위젯의 화면 자리 (손가락을 그대로 따라감) */
  px?: { left: number; top: number }
  target: Cell
  preview: Item[]
}

interface Props {
  jobTitle: string
  onGo: (p: PageId) => void
}

export default function TodayBoard({ jobTitle, onGo }: Props): JSX.Element {
  const toast = useToast()
  const [items, setItems] = useState<Item[] | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [editing, setEditing] = useState(false)
  const [sel, setSel] = useState<BoardId | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [picker, setPicker] = useState(false)
  const [lookFor, setLookFor] = useState<BoardId | null>(null)
  const [noticeAdding, setNoticeAdding] = useState(false)
  const [W, setW] = useState(0)
  const boardRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef<Live | null>(null)
  const itemsRef = useRef<Item[] | null>(null)
  itemsRef.current = items
  const hold = useRef<{ timer: number; x: number; y: number; cancel: () => void } | null>(null)

  const loadTasks = useCallback(async () => setTasks(await window.api.tasks.list()), [])
  useEffect(() => {
    void loadTasks()
    void (async () => setItems(parseBoard(await window.api.setting.get(KEY))))()
  }, [loadTasks])

  useLayoutEffect(() => {
    const el = boardRef.current
    if (!el) return
    const update = (): void => setW(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [items === null])

  const narrow = W > 0 && W < NARROW
  // 창을 좁히면 편집을 닫는다 (한 줄로 쌓인 판에서는 칸 자리가 보이지 않는다)
  useEffect(() => {
    if (narrow && editing) {
      setEditing(false)
      setSel(null)
    }
  }, [narrow, editing])

  const commit = (next: Item[]): void => {
    setItems(next)
    void window.api.setting.set(KEY, JSON.stringify({ v: 1, items: next }))
  }

  const cellW = W ? (W - GAP * (GRID_COLS - 1)) / GRID_COLS : 0
  const pxOf = (c: Cell): { left: number; top: number; width: number; height: number } => ({
    left: c.x * (cellW + GAP),
    top: c.y * (ROW + GAP),
    width: c.w * cellW + (c.w - 1) * GAP,
    height: c.h * ROW + (c.h - 1) * GAP
  })

  /* ---------- 끌기 (옮기기 · 크기) ---------- */

  const begin = (id: BoardId, kind: Kind, x: number, y: number, moved = false): void => {
    const list = itemsRef.current
    const board = boardRef.current
    const it = list?.find((w) => w.id === id)
    if (!list || !board || !it || !cellW) return
    const r = board.getBoundingClientRect()
    const p = pxOf(it)
    const l: Live = {
      id,
      kind,
      startX: x,
      startY: y,
      grabX: x - r.left - p.left,
      grabY: y - r.top - p.top,
      orig: list,
      origCell: { x: it.x, y: it.y, w: it.w, h: it.h },
      moved,
      target: { x: it.x, y: it.y, w: it.w, h: it.h },
      preview: list
    }
    liveRef.current = l
    setLive(l)
    const scroller = board.closest('.main') as HTMLElement | null

    const onMove = (ev: PointerEvent): void => {
      const cur = liveRef.current
      const b = boardRef.current
      if (!cur || !b) return
      if (!cur.moved && Math.hypot(ev.clientX - cur.startX, ev.clientY - cur.startY) < 4) return
      const lim = DEFS[cur.id].lim
      const rect = b.getBoundingClientRect()
      let next: Live
      if (cur.kind === 'move') {
        const left = ev.clientX - rect.left - cur.grabX
        const top = ev.clientY - rect.top - cur.grabY
        const c = toCell(left, top, cellW, ROW, GAP)
        const target = clampCell({ ...c, w: cur.origCell.w, h: cur.origCell.h }, lim)
        const same = target.x === cur.target.x && target.y === cur.target.y
        next = { ...cur, moved: true, px: { left, top }, target, preview: same && cur.moved ? cur.preview : (place(cur.orig, cur.id, target) as Item[]) }
      } else {
        const dx = Math.round((ev.clientX - cur.startX) / (cellW + GAP))
        const dy = Math.round((ev.clientY - cur.startY) / (ROW + GAP))
        const target = resizeCell(cur.origCell, cur.kind, dx, dy, lim)
        next = { ...cur, moved: true, target, preview: place(cur.orig, cur.id, target) as Item[] }
      }
      liveRef.current = next
      setLive(next)
      // 창 아래 · 위 끝에 가까이 끌면 판이 따라 흐른다
      if (scroller) {
        const sr = scroller.getBoundingClientRect()
        if (ev.clientY > sr.bottom - 60) scroller.scrollTop += 14
        else if (ev.clientY < sr.top + 60) scroller.scrollTop -= 14
      }
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      const fin = liveRef.current
      liveRef.current = null
      setLive(null)
      if (fin?.moved) commit(fin.preview)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  /** 길게 누른 뒤 손을 떼면 그 아래 단추가 눌리지 않게 한 번 막는다 */
  const swallowClick = (): void => {
    const stop = (e: MouseEvent): void => {
      e.stopPropagation()
      e.preventDefault()
    }
    window.addEventListener('click', stop, { capture: true, once: true })
    window.setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 600)
  }

  const cancelHold = (): void => {
    hold.current?.cancel()
    hold.current = null
  }

  const enterEdit = (id: BoardId | null): void => {
    if (narrow) return
    setEditing(true)
    setSel(id)
  }

  const onWidgetDown = (e: ReactPointerEvent, id: BoardId): void => {
    if (e.button !== 0 || narrow) return
    if (editing) {
      if ((e.target as HTMLElement).closest('.tw-handle, .tw-bubble')) return
      e.preventDefault()
      setSel(id)
      begin(id, 'move', e.clientX, e.clientY)
      return
    }
    // 글 쓰는 칸에서는 길게 눌러도 편집으로 가지 않는다 (글자 고르기)
    if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
    cancelHold()
    const sx = e.clientX
    const sy = e.clientY
    let lx = sx
    let ly = sy
    const move = (ev: PointerEvent): void => {
      lx = ev.clientX
      ly = ev.clientY
      if (Math.hypot(lx - sx, ly - sy) > SLOP) cancelHold()
    }
    const up = (): void => cancelHold()
    const timer = window.setTimeout(() => {
      cancelHold()
      swallowClick()
      window.getSelection()?.removeAllRanges()
      enterEdit(id)
      // 누른 채로 끌면 바로 옮겨진다 (갤럭시처럼)
      begin(id, 'move', lx, ly, false)
    }, HOLD_MS)
    hold.current = {
      timer,
      x: sx,
      y: sy,
      cancel: () => {
        window.clearTimeout(timer)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onBoardDown = (e: ReactPointerEvent): void => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('tw-cell')) return
    if (editing) {
      setSel(null)
      return
    }
    if (e.button !== 0 || narrow) return
    cancelHold()
    const sx = e.clientX
    const sy = e.clientY
    const move = (ev: PointerEvent): void => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > SLOP) cancelHold()
    }
    const up = (): void => cancelHold()
    const timer = window.setTimeout(() => {
      cancelHold()
      enterEdit(null)
    }, HOLD_MS)
    hold.current = {
      timer,
      x: sx,
      y: sy,
      cancel: () => {
        window.clearTimeout(timer)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  useEffect(() => () => cancelHold(), [])

  if (!items) return <div className="muted">불러오는 중…</div>

  const remove = (id: BoardId): void => {
    commit(items.filter((w) => w.id !== id))
    setSel(null)
    if (lookFor === id) setLookFor(null)
    toast(`'${DEFS[id].title}' 위젯을 뺐습니다. [＋ 위젯] 에서 다시 넣을 수 있습니다.`)
  }

  const add = (id: BoardId, w: number, h: number): void => {
    const spot = firstFree(items, w, h)
    commit([...items, { id, x: spot.x, y: spot.y, w, h }])
    setPicker(false)
    setSel(id)
    // 새로 넣은 위젯이 보이게 그 자리로 흐른다
    window.setTimeout(() => document.querySelector(`[data-bid="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50)
  }

  const setLook = (id: BoardId, p: Partial<Look>): void => {
    commit(items.map((w) => (w.id === id ? { ...w, look: { ...w.look, ...p } } : w)))
  }

  const onKey = (e: ReactKeyboardEvent, it: Item): void => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
    if (d) {
      e.preventDefault()
      const lim = DEFS[it.id].lim
      const target = e.shiftKey ? resizeCell(it, 'se', d[0], d[1], lim) : clampCell({ ...it, x: it.x + d[0], y: it.y + d[1] }, lim)
      commit(place(items, it.id, target) as Item[])
      setSel(it.id)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      remove(it.id)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      setLookFor(it.id)
    } else if (e.key === 'Escape') {
      if (sel) setSel(null)
      else setEditing(false)
    }
  }

  /* ---------- 위젯 속 ---------- */

  const body = (it: Item): JSX.Element => {
    switch (it.id) {
      case 'now':
        return <Hero onGo={onGo} />
      case 'clock':
        return <ClockBody />
      case 'meal':
        return <MealCard onGo={onGo} />
      case 'deadlines':
        return <DeadlinesWidget onGo={onGo} />
      case 'notices':
        return <NoticesWidget adding={noticeAdding} onAdding={setNoticeAdding} />
      case 'mytt':
        return <MyTtWidget onGo={onGo} wide={it.w >= 6} />
      case 'classtt':
        return <ClassTtWidget onGo={onGo} />
      case 'calendar':
        return (
          <Calendar
            tasks={tasks}
            compact
            monthLanes={it.w >= 6 ? 3 : 2}
            onOpenFull={() => onGo('달력')}
            view={it.view ?? 'month'}
            onView={(v) => commit(items.map((w) => (w.id === 'calendar' ? { ...w, view: v } : w)))}
          />
        )
      case 'schedule':
        return <ScheduleWidget onGo={onGo} />
      case 'tasks':
        return <TasksWidget tasks={tasks} onChanged={() => void loadTasks()} onGo={onGo} />
      case 'lastyear':
        return <LastYear tasks={tasks} onGo={onGo} bare />
      case 'help':
        return <HelpWidget onGo={onGo} />
      case 'quick':
        return <QuickWidget onGo={onGo} />
      case 'school':
        return <SchoolStrip onGo={onGo} />
    }
  }

  // 끄는 중이면 미리 본 자리, 아니면 저장된 자리
  const shown = live?.moved ? live.preview : items
  const rows = Math.max(bottomOf(shown), 1) + (editing ? 3 : 0)
  const boardH = narrow ? undefined : rows * ROW + (rows - 1) * GAP
  const list = narrow ? stackOrder(items) : items
  const lookItem = lookFor ? items.find((w) => w.id === lookFor) : undefined
  const placedIds = new Set(items.map((w) => w.id))
  const d = new Date()

  const widget = (it: Item): JSX.Element => {
    const def = DEFS[it.id]
    const look = lookOf(it)
    const cell = shown.find((w) => w.id === it.id) ?? it
    const dragging = live?.moved && live.id === it.id
    const p = pxOf(dragging && live?.kind !== 'move' ? live!.target : cell)
    const pos = dragging && live?.kind === 'move' && live.px ? live.px : p
    const isSel = editing && sel === it.id
    const style: CSSProperties & Record<string, string | number> = narrow
      ? { height: it.h * ROW + (it.h - 1) * GAP, '--tw-op': `${100 - look.alpha}%` }
      : {
          transform: `translate(${pos.left}px, ${pos.top}px)`,
          width: p.width,
          height: p.height,
          zIndex: dragging ? 30 : isSel ? 20 : 1,
          '--tw-op': `${100 - look.alpha}%`
        }
    const strip = it.id === 'school'
    return (
      <section
        key={it.id}
        data-bid={it.id}
        className={`hw tw look-${look.bg} ${narrow ? 'stacked' : ''} ${editing ? 'edit' : ''} ${isSel ? 'sel' : ''} ${dragging ? 'dragging' : ''} ${dragging && live?.kind === 'move' ? 'moving' : ''} ${
          look.title && !strip ? '' : 'notitle'
        }`}
        style={style}
        onPointerDown={(e) => onWidgetDown(e, it.id)}
        onContextMenu={(e) => {
          if (narrow || (e.target as HTMLElement).closest('input, textarea')) return
          e.preventDefault()
          enterEdit(it.id)
        }}
        tabIndex={editing ? 0 : undefined}
        aria-label={editing ? `${def.title} 위젯, 가로 ${it.w}칸 세로 ${it.h}줄` : undefined}
        aria-roledescription={editing ? '옮길 수 있는 위젯' : undefined}
        aria-describedby={editing ? 'tb-keys' : undefined}
        onFocus={editing ? () => setSel(it.id) : undefined}
        onKeyDown={editing ? (e) => onKey(e, it) : undefined}
      >
        {look.title && !strip && (
          <header className="hw-head">
            <span className="hw-title">
              <Icon name={def.icon} size={16} className="hw-ico" />
              {def.title}
            </span>
            <span className="spacer" />
            {!editing && it.id === 'notices' && (
              <button className="btn btn-sm" onClick={() => setNoticeAdding((v) => !v)}>
                {noticeAdding ? '닫기' : '＋ 새 글'}
              </button>
            )}
            {!editing && def.page && (
              <button className="hw-btn" onClick={() => onGo(def.page!)} title={`${def.title} 화면으로`} aria-label={`${def.title} 화면으로`}>
                ↗
              </button>
            )}
          </header>
        )}
        <div className="hw-body tw-body" {...(editing ? ({ inert: '' } as object) : {})}>
          {body(it)}
        </div>
        {isSel && !dragging && (
          <>
            {(['n', 's', 'e', 'w', 'se'] as Edge[]).map((edge) => (
              <span
                key={edge}
                className={`tw-handle ${edge}`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.preventDefault()
                  e.stopPropagation()
                  begin(it.id, edge, e.clientX, e.clientY)
                }}
                aria-hidden="true"
              />
            ))}
          </>
        )}
        {dragging && live?.kind !== 'move' && (
          <span className="tw-size-live">
            {live!.target.w} × {live!.target.h}
          </span>
        )}
      </section>
    )
  }

  return (
    <div className={`tb ${editing ? 'tb-editing' : ''}`}>
      <div className="page-head page-head-row">
        <div>
          <h1>오늘</h1>
          <p>
            {d.getMonth() + 1}월 {d.getDate()}일 {WEEK[d.getDay()]}요일 · {jobTitle}
          </p>
        </div>
        {!narrow && !editing && (
          <button className="btn btn-sm" onClick={() => enterEdit(null)} title="위젯을 길게 눌러도 편집이 열립니다">
            <Icon name="grid" size={15} />
            편집
          </button>
        )}
      </div>

      {narrow && <p className="muted small tb-narrow">창이 좁아 위젯을 한 줄로 쌓았습니다. 창을 넓히면 옮기고 크기를 바꿀 수 있습니다.</p>}
      {items.length === 0 && (
        <div className="empty">
          위젯이 없습니다. <button className="link" onClick={() => setPicker(true)}>[＋ 위젯]</button> 에서 넣어 주세요.
        </div>
      )}

      <div
        ref={boardRef}
        className={`tb-board ${editing ? 'editing' : ''} ${live?.moved ? 'busy' : ''} ${narrow ? 'stacked' : ''}`}
        style={{ height: boardH }}
        onPointerDown={onBoardDown}
      >
        {editing &&
          !narrow &&
          cellW > 0 &&
          Array.from({ length: rows * GRID_COLS }, (_, i) => {
            const c = pxOf({ x: i % GRID_COLS, y: Math.floor(i / GRID_COLS), w: 1, h: 1 })
            return <span key={i} className="tw-cell" style={{ transform: `translate(${c.left}px, ${c.top}px)`, width: c.width, height: c.height }} />
          })}
        {live?.moved && live.kind === 'move' && (
          <span
            className="tw-ghost"
            style={(() => {
              const g = pxOf(live.target)
              return { transform: `translate(${g.left}px, ${g.top}px)`, width: g.width, height: g.height }
            })()}
          />
        )}
        {list.map(widget)}
        {/* 고른 위젯의 메뉴 — 위젯 밖에 두어 위젯 배경(어둡게 등)을 따라가지 않는다 */}
        {editing &&
          !narrow &&
          sel &&
          !live?.moved &&
          (() => {
            const it = items.find((w) => w.id === sel)
            if (!it) return null
            const p = pxOf(it)
            const below = it.y === 0
            return (
              <div
                className={`tw-bubble ${below ? 'below' : ''}`}
                style={{ left: p.left + p.width / 2, top: below ? p.top + p.height + 14 : p.top - 14 }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button onClick={() => setLookFor(it.id)}>
                  <Icon name="sliders" size={14} />
                  위젯 설정
                </button>
                <span className="tw-size">
                  {it.w} × {it.h}
                </span>
                <button className="danger" onClick={() => remove(it.id)}>
                  빼기
                </button>
              </div>
            )
          })()}
      </div>

      {editing && (
        <div className="tb-editbar" role="toolbar" aria-label="오늘 판 편집">
          <span id="tb-keys" className="tb-editbar-hint">
            끌어 옮기고, 가장자리를 끌어 크기를 바꿉니다 · 키보드: 화살표 옮기기 · Shift+화살표 크기 · Delete 빼기
          </span>
          <button className="btn" onClick={() => setPicker(true)}>
            <Icon name="plus" size={15} />
            위젯
          </button>
          <button className="btn" onClick={() => commit(compact(items) as Item[])} title="위젯을 위로 모아 빈칸을 없앱니다">
            빈칸 메우기
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              commit(defaults())
              setSel(null)
            }}
          >
            처음 모양
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditing(false)
              setSel(null)
              setLookFor(null)
            }}
          >
            완료
          </button>
        </div>
      )}

      {picker && (
        <WidgetPicker
          placed={placedIds}
          onAdd={add}
          onClose={() => setPicker(false)}
        />
      )}

      {lookItem && (
        <section className="tb-look" aria-label={`${DEFS[lookItem.id].title} 위젯 설정`}>
          <div className="tb-look-head">
            <b>위젯 설정</b>
            <span className="muted small">{DEFS[lookItem.id].title}</span>
          </div>
          {(() => {
            const look = lookOf(lookItem)
            return (
              <>
                <div className="tb-look-row">
                  <span className="tb-look-label">배경</span>
                  <div className="tb-seg" role="group" aria-label="배경 색">
                    {(
                      [
                        ['auto', '테마 따라'],
                        ['light', '밝게'],
                        ['dark', '어둡게']
                      ] as [WidgetBg, string][]
                    ).map(([v, label]) => (
                      <button key={v} className={look.bg === v ? 'on' : ''} aria-pressed={look.bg === v} onClick={() => setLook(lookItem.id, { bg: v })}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="tb-look-row">
                  <span className="tb-look-label">
                    투명도 <b>{look.alpha}%</b>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={90}
                    step={10}
                    value={look.alpha}
                    onChange={(e) => setLook(lookItem.id, { alpha: Number(e.target.value) })}
                  />
                </label>
                {lookItem.id !== 'school' && (
                  <label className="tb-look-check">
                    <input type="checkbox" checked={look.title} onChange={(e) => setLook(lookItem.id, { title: e.target.checked })} />
                    <span>제목 줄 보이기</span>
                  </label>
                )}
                <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => commit(items.map((w) => (w.id === lookItem.id ? { ...w, look: undefined } : w)))}>
                    기본값으로
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={() => setLookFor(null)}>
                    닫기
                  </button>
                </div>
              </>
            )
          })()}
        </section>
      )}
    </div>
  )
}

/** 위젯 목록 — 갈래별 카드, 크기를 골라 넣는다 */
function WidgetPicker({ placed, onAdd, onClose }: { placed: Set<BoardId>; onAdd: (id: BoardId, w: number, h: number) => void; onClose: () => void }): JSX.Element {
  const [q, setQ] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const words = q.trim()
  const ids = (Object.keys(DEFS) as BoardId[]).filter((id) => !words || `${DEFS[id].title} ${DEFS[id].desc}`.includes(words))

  return (
    <div className="tb-picker-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="tb-picker" role="dialog" aria-modal="true" aria-label="위젯 넣기">
        <div className="tb-picker-head">
          <b>위젯</b>
          <input ref={ref} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="위젯 찾기" aria-label="위젯 찾기" />
          <button className="hw-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="tb-picker-body">
          {GROUPS.map((g) => {
            const inGroup = ids.filter((id) => DEFS[id].group === g)
            if (!inGroup.length) return null
            return (
              <div key={g} className="tb-picker-group">
                <div className="tb-picker-gname">{g}</div>
                <div className="tb-picker-list">
                  {inGroup.map((id) => {
                    const def = DEFS[id]
                    const on = placed.has(id)
                    return (
                      <div key={id} className={`tb-pick ${on ? 'on' : ''}`}>
                        <span className="tb-pick-ico">
                          <Icon name={def.icon} size={20} />
                        </span>
                        <span className="tb-pick-text">
                          <b>{def.title}</b>
                          <small>{def.desc}</small>
                        </span>
                        <span className="tb-pick-sizes">
                          {on ? (
                            <span className="muted small">판에 있음</span>
                          ) : (
                            def.sizes.map(([w, h]) => (
                              <button key={`${w}x${h}`} className="tb-size" onClick={() => onAdd(id, w, h)} aria-label={`${def.title} 가로 ${w}칸 세로 ${h}줄로 넣기`}>
                                <i style={{ width: w * 5, height: h * 5 }} aria-hidden="true" />
                                {w}×{h}
                              </button>
                            ))
                          )}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {ids.length === 0 && <p className="muted small">'{words}' 에 맞는 위젯이 없습니다.</p>}
        </div>
      </section>
    </div>
  )
}
