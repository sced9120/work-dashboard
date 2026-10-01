/**
 * 사슬 교체 — 내 수업(d1, p1)을 비우려고 같은 주 안에서 수업을 맞바꾸는 여러 방법을 찾는다.
 *
 * - 1:1 맞교체: 같은 반의 다른 시간 수업과 맞바꾼다 (두 선생님이 서로의 시간에 비어 있을 때)
 * - 순환 교체: 한 반 안에서 수업 셋(넷)이 돌아가며 자리를 바꾼다 (나 → B 자리, B → C 자리, C → 내 자리)
 * - 2중 · 3중 교체: 맞바꾼 선생님(또는 나)이 옮겨 간 시간에 다른 반 수업이 있으면, 그 반 수업도 맞바꿔 겹침을 푼다
 *
 * 방법: 한 번에 "한 반의 두 수업을 맞바꾸기" 를 하고, 선생님이 같은 시간에 두 반에 걸리면(겹침) 그 겹친 수업 가운데 하나를
 * 다시 같은 반의 다른 시간과 맞바꾸며 겹침이 없어질 때까지 따라간다(최대 3번). 블록 시간 · 창체 · 동아리 자리 · 공강 칸은
 * 옮기지 않고, 지난 날로도 옮기지 않는다. 마지막 모습이 같으면 한 가지로 센다.
 */

import type { SchoolTimetable, TtCell, TtRules } from './timetable'
import { fixedOf, isFree, lockAt } from './timetable'

/** 반 · 시간 자리 "2-4|요일-교시" (둘 다 0부터) */
type Pos = string
const posOf = (cls: string, d: number, p: number): Pos => `${cls}|${d}-${p}`
function parsePos(k: Pos): { cls: string; d: number; p: number } {
  const [cls, s] = k.split('|')
  const [d, p] = s.split('-').map(Number)
  return { cls, d, p }
}

export interface ChainMove {
  cls: string
  subject: string
  teachers: string[]
  from: { day: number; period: number }
  to: { day: number; period: number }
}

export type ChainKind = '맞교체' | '순환 교체' | '2중 교체' | '3중 교체'

export interface ChainOption {
  kind: ChainKind
  /** 맞바꾸기 횟수 */
  steps: number
  /** 자리를 옮기는 수업들 (내 수업이 맨 앞) */
  moves: ChainMove[]
  /** 나 말고 함께 옮기는 선생님 */
  teachers: string[]
}

export interface ChainSearch {
  /** 맞바꾸기를 몇 번까지 이어 볼지 (1~3, 기본 2) */
  maxSteps?: number
  /** 파일에 없지만 내가 비지 않은 시간 (손으로 적은 칸 · 우리 반 창체 등) */
  meBusy?: (d: number, p: number) => boolean
  /** 수업을 옮겨도 되는 시간인가 (지난 날 빼기) */
  allowed?: (d: number, p: number) => boolean
  /** 찾는 가짓수 상한 */
  limit?: number
}

export function findChains(
  tt: SchoolTimetable,
  me: string,
  d1: number,
  p1: number,
  rules: TtRules | null,
  opts: ChainSearch = {}
): ChainOption[] {
  const maxSteps = Math.min(3, Math.max(1, opts.maxSteps ?? 2))
  const allowed = opts.allowed ?? ((): boolean => true)
  const limit = opts.limit ?? 400
  const grids = new Map(tt.classes.map((c) => [c.id, c.grid]))
  const classIds = tt.classes.map((c) => c.id)
  const slotsOf = new Map(
    tt.classes.map((c) => [c.id, c.grid.flatMap((col, d) => col.map((x, p) => (x ? ([d, p] as [number, number]) : null)).filter((x): x is [number, number] => !!x))])
  )

  const mine = tt.classes.filter((c) => c.grid[d1]?.[p1]?.teachers.includes(me))
  if (mine.length !== 1) return []
  const X = mine[0].id
  const myOrigin = posOf(X, d1, p1)

  /** 바꾼 자리 → 원래 그 수업이 있던 자리. 없으면 그대로 */
  type State = Map<Pos, Pos>
  const parsed = new Map<Pos, { cls: string; d: number; p: number }>()
  const where = (k: Pos): { cls: string; d: number; p: number } => {
    let q = parsed.get(k)
    if (!q) parsed.set(k, (q = parsePos(k)))
    return q
  }
  const baseCell = (k: Pos): TtCell | null => {
    const q = where(k)
    return grids.get(q.cls)?.[q.d]?.[q.p] ?? null
  }
  const at = (st: State, cls: string, d: number, p: number): { cell: TtCell | null; origin: Pos } => {
    const k = posOf(cls, d, p)
    const o = st.get(k) ?? k
    return { cell: baseCell(o), origin: o }
  }
  /** 이 자리의 이 수업을 옮겨도 되는가 — 블록 · 창체 · 동아리 자리, 공강 칸, 지난 날은 안 된다 */
  const movable = (cls: string, d: number, p: number, cell: TtCell | null): boolean =>
    !!cell && cell.teachers.length > 0 && !isFree(cell) && !fixedOf(cell) && (rules ? !lockAt(rules, cls, d, p) : !cell.group) && allowed(d, p)

  if (!movable(X, d1, p1, at(new Map(), X, d1, p1).cell)) return []

  // 선생님이 그 시간에 들어 있는 반 수 (처음 시간표). 바꾼 자리만 더하고 빼서 센다
  const baseCount = new Map<string, number>()
  for (const c of tt.classes)
    c.grid.forEach((col, d) =>
      col.forEach((x, p) => {
        for (const t of x?.teachers ?? []) baseCount.set(`${t}|${d}-${p}`, (baseCount.get(`${t}|${d}-${p}`) ?? 0) + 1)
      })
    )
  const countAt = (st: State, t: string, d: number, p: number): number => {
    let n = baseCount.get(`${t}|${d}-${p}`) ?? 0
    for (const [k, o] of st) {
      const q = where(k)
      if (q.d !== d || q.p !== p) continue
      if (baseCell(k)?.teachers.includes(t)) n--
      if (baseCell(o)?.teachers.includes(t)) n++
    }
    return n
  }

  /** 겹침: 바뀐 자리에 들어온 선생님이 같은 시간에 다른 반에도 있다. 내가 비울 시간 · 내가 바쁜 시간으로 가면 끝 */
  const conflicts = (st: State): { teacher: string; d: number; p: number }[] | 'dead' => {
    const out: { teacher: string; d: number; p: number }[] = []
    const seen = new Set<string>()
    for (const [k, o] of st) {
      const { d, p } = where(k)
      for (const t of baseCell(o)?.teachers ?? []) {
        if (t === me && ((d === d1 && p === p1) || opts.meBusy?.(d, p))) return 'dead'
        const key = `${t}|${d}-${p}`
        if (seen.has(key)) continue
        seen.add(key)
        // 처음 시간표에 이미 겹쳐 있던 것(파일 사정)은 더 늘어날 때만 겹침으로 본다
        if (countAt(st, t, d, p) > Math.max(1, baseCount.get(key) ?? 0)) out.push({ teacher: t, d, p })
      }
    }
    return out
  }

  const found = new Map<string, { st: State; steps: number }>()
  let nodes = 0
  const NODE_LIMIT = 400000

  const record = (st: State, steps: number): void => {
    const key = [...st]
      .map(([k, o]) => `${k}<${o}`)
      .sort()
      .join(';')
    const had = found.get(key)
    if (!had || had.steps > steps) found.set(key, { st, steps })
  }

  const swap = (st: State, cls: string, a: [number, number], b: [number, number]): State => {
    const next = new Map(st)
    const ka = posOf(cls, ...a)
    const kb = posOf(cls, ...b)
    const oa = at(st, cls, ...a).origin
    const ob = at(st, cls, ...b).origin
    // 제자리로 돌아오면 지운다 (같은 모습을 한 가지로 세려고)
    if (ob === ka) next.delete(ka)
    else next.set(ka, ob)
    if (oa === kb) next.delete(kb)
    else next.set(kb, oa)
    return next
  }

  const dfs = (st: State, steps: number, depth: number, used: Set<string>): void => {
    if (++nodes > NODE_LIMIT) return
    const cf = conflicts(st)
    if (cf === 'dead') return
    if (!cf.length) {
      record(st, steps)
      return
    }
    if (steps >= depth || cf.length > 2 * (depth - steps)) return
    // 첫 겹침을 푼다: 겹친 선생님의 그 시간 수업 하나를 같은 반의 다른 시간 수업과 맞바꾼다
    const { teacher, d, p } = cf[0]
    for (const cls of classIds) {
      const here = at(st, cls, d, p)
      if (!here.cell?.teachers.includes(teacher) || here.origin === myOrigin || !movable(cls, d, p, here.cell)) continue
      for (const [ud, up] of slotsOf.get(cls) ?? []) {
        if (ud === d && up === p) continue
        const other = at(st, cls, ud, up)
        if (other.origin === myOrigin || !movable(cls, ud, up, other.cell)) continue
        // 같은 선생님 수업끼리 바꾸면 겹침이 그대로다
        if (other.cell!.teachers.some((x) => here.cell!.teachers.includes(x))) continue
        const key = `${cls}|${[`${d}-${p}`, `${ud}-${up}`].sort().join('~')}`
        if (used.has(key)) continue
        dfs(swap(st, cls, [d, p], [ud, up]), steps + 1, depth, new Set([...used, key]))
      }
    }
  }

  // 첫 걸음: 내 수업을 같은 반의 다른 시간 수업과 맞바꾼다. 가까운 날부터.
  // 1번 → 2번 → 3번 맞바꾸기 차례로 찾아, 짧은 방법이 상한에 밀려 빠지지 않게 한다
  const firsts = [...(slotsOf.get(X) ?? [])].sort((a, b) => Math.abs(a[0] - d1) - Math.abs(b[0] - d1) || a[0] - b[0] || a[1] - b[1])
  for (let depth = 1; depth <= maxSteps && found.size < limit && nodes <= NODE_LIMIT; depth++) {
    for (const [td, tp] of firsts) {
      if (td === d1 && tp === p1) continue
      const other = at(new Map(), X, td, tp)
      if (!movable(X, td, tp, other.cell) || other.cell!.teachers.includes(me)) continue
      const key = `${X}|${[`${d1}-${p1}`, `${td}-${tp}`].sort().join('~')}`
      dfs(swap(new Map(), X, [d1, p1], [td, tp]), 1, depth, new Set([key]))
    }
  }

  // 모양 정리
  const options: ChainOption[] = []
  for (const { st, steps } of found.values()) {
    const moves: ChainMove[] = []
    for (const [k, o] of st) {
      if (k === o) continue
      const to = parsePos(k)
      const from = parsePos(o)
      const cell = grids.get(from.cls)?.[from.d]?.[from.p]
      if (!cell) continue
      moves.push({ cls: from.cls, subject: cell.subject, teachers: cell.teachers, from: { day: from.d, period: from.p }, to: { day: to.d, period: to.p } })
    }
    moves.sort((a, b) => Number(posOf(b.cls, b.from.day, b.from.period) === myOrigin) - Number(posOf(a.cls, a.from.day, a.from.period) === myOrigin) || a.cls.localeCompare(b.cls, 'ko', { numeric: true }) || a.from.day - b.from.day || a.from.period - b.from.period)
    const teachers = [...new Set(moves.flatMap((m) => m.teachers))].filter((t) => t !== me)
    const oneClass = new Set(moves.map((m) => m.cls)).size === 1
    const kind: ChainKind = steps === 1 ? '맞교체' : oneClass ? '순환 교체' : steps === 2 ? '2중 교체' : '3중 교체'
    options.push({ kind, steps, moves, teachers })
  }
  const spread = (o: ChainOption): number => o.moves.reduce((n, m) => n + Math.abs(m.to.day - d1), 0)
  options.sort((a, b) => a.steps - b.steps || a.teachers.length - b.teachers.length || spread(a) - spread(b))
  return options.slice(0, limit)
}

/** 같은 반 · 같은 시간에 두 수업이 들어가거나 한 선생님이 같은 시간에 두 곳에 있는지 — 시험과 확인에 쓴다 */
export function applyMoves(tt: SchoolTimetable, moves: ChainMove[]): { clash: string[] } {
  const grid = new Map(tt.classes.map((c) => [c.id, c.grid.map((col) => col.slice())]))
  for (const m of moves) grid.get(m.cls)![m.from.day][m.from.period] = null
  for (const m of moves) {
    const cell = tt.classes.find((c) => c.id === m.cls)!.grid[m.from.day][m.from.period]
    const g = grid.get(m.cls)!
    if (g[m.to.day][m.to.period]) return { clash: [`${m.cls} ${m.to.day}-${m.to.period} 에 수업이 둘`] }
    g[m.to.day][m.to.period] = cell
  }
  const clash: string[] = []
  const days = tt.days.length
  for (let d = 0; d < days; d++)
    for (let p = 0; p < tt.periods.length; p++) {
      const seen = new Map<string, number>()
      for (const g of grid.values()) for (const t of g[d]?.[p]?.teachers ?? []) seen.set(t, (seen.get(t) ?? 0) + 1)
      for (const [t, n] of seen) if (n > 1) clash.push(`${t} ${d}-${p}`)
    }
  return { clash }
}
