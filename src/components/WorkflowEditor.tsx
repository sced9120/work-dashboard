import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Task, WfEdge, WfNode, Workflow } from '../../shared/types'
import { WF_KINDS } from '../../shared/types'
import { useConfirm } from '../lib/confirm'
import { monthOf, schoolOrder, weekOf } from '../lib/util'

interface Props {
  /** 지금 그리고 있는 주제 */
  topic: string
  value: Workflow
  onChange: (next: Workflow) => void
  /** 인수인계로 받아 보기만 할 때는 손대지 못하게 한다 */
  readOnly?: boolean
  /** 등록된 업무로 처음 그림을 짤 때 쓴다 */
  tasks?: Task[]
}

const NODE_W = 190
const LINE_H = 19
const PAD_Y = 18
const GRID = 10

/** 글자 수로 상자 높이를 어림한다. 상자마다 따로 재지 않아도 선이 맞는다. */
function nodeHeight(n: WfNode): number {
  const perLine = Math.max(8, Math.floor((n.w - 24) / 12))
  const lines = n.text.split('\n').reduce(
    (sum, l) => sum + Math.max(1, Math.ceil(l.length / perLine)),
    0
  )
  return Math.max(46, lines * LINE_H + PAD_Y * 2)
}

function uid(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 등록된 업무를 시기 순으로 세워 첫 그림을 만든다. */
export function draftWorkflow(tasks: Task[]): Workflow {
  const sorted = [...tasks].sort((a, b) => {
    const om =
      schoolOrder(monthOf(a.task_date_display)) - schoolOrder(monthOf(b.task_date_display))
    if (om !== 0) return om
    return weekOf(a.task_date_display) - weekOf(b.task_date_display)
  })

  const nodes: WfNode[] = []
  const edges: WfEdge[] = []
  let y = 40

  const start: WfNode = { id: uid('n'), x: 60, y, w: NODE_W, text: '시작', kind: 'start' }
  nodes.push(start)
  y += nodeHeight(start) + 46

  let prev = start
  // 너무 길어지지 않게 앞쪽 12건만 세운다. 나머지는 사용자가 보태면 된다.
  for (const t of sorted.slice(0, 12)) {
    const when = t.task_date_display || '수시'
    const node: WfNode = {
      id: uid('n'),
      x: 60,
      y,
      w: NODE_W,
      text: `${when}\n${t.title}`,
      kind: 'step'
    }
    nodes.push(node)
    edges.push({ id: uid('e'), from: prev.id, to: node.id, label: '' })
    prev = node
    y += nodeHeight(node) + 46
  }

  const end: WfNode = { id: uid('n'), x: 60, y, w: NODE_W, text: '끝', kind: 'end' }
  nodes.push(end)
  edges.push({ id: uid('e'), from: prev.id, to: end.id, label: '' })

  return { nodes, edges }
}

/** 상자의 네 변 */
export type Side = 'top' | 'right' | 'bottom' | 'left'

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']

/** 그 변의 가운데 점이 판 위 어디인지 */
function handlePoint(n: WfNode, side: Side): { x: number; y: number } {
  const h = nodeHeight(n)
  if (side === 'top') return { x: n.x + n.w / 2, y: n.y }
  if (side === 'bottom') return { x: n.x + n.w / 2, y: n.y + h }
  if (side === 'left') return { x: n.x, y: n.y + h / 2 }
  return { x: n.x + n.w, y: n.y + h / 2 }
}

/** 두 상자 사이를 잇는 선. 세로로 늘어선 경우가 많아 위·아래를 먼저 본다. */
function anchors(
  a: WfNode,
  b: WfNode
): { x1: number; y1: number; x2: number; y2: number; vertical: boolean; sign: number } {
  const ah = nodeHeight(a)
  const bh = nodeHeight(b)
  const ac = { x: a.x + a.w / 2, y: a.y + ah / 2 }
  const bc = { x: b.x + b.w / 2, y: b.y + bh / 2 }

  const dx = bc.x - ac.x
  const dy = bc.y - ac.y

  // 가로로 더 멀면 옆구리끼리, 아니면 위아래끼리 잇는다
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0
      ? { x1: a.x + a.w, y1: ac.y, x2: b.x, y2: bc.y, vertical: false, sign: 1 }
      : { x1: a.x, y1: ac.y, x2: b.x + b.w, y2: bc.y, vertical: false, sign: -1 }
  }
  return dy > 0
    ? { x1: ac.x, y1: a.y + ah, x2: bc.x, y2: b.y, vertical: true, sign: 1 }
    : { x1: ac.x, y1: a.y, x2: bc.x, y2: b.y + bh, vertical: true, sign: -1 }
}

/* ---------- 선이 상자를 뚫고 지나가지 않게 ---------- */

/** 상자를 감싸는 네모 (조금 넉넉하게) */
function box(n: WfNode, pad = 12): { l: number; r: number; t: number; b: number } {
  return { l: n.x - pad, r: n.x + n.w + pad, t: n.y - pad, b: n.y + nodeHeight(n) + pad }
}

/** 선분이 네모를 지나가는가 (가로·세로 선분만 다룬다) */
function hits(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  r: { l: number; r: number; t: number; b: number }
): boolean {
  const lo = (a: number, b: number): number => Math.min(a, b)
  const hi = (a: number, b: number): number => Math.max(a, b)
  return (
    hi(p1.x, p2.x) > r.l && lo(p1.x, p2.x) < r.r && hi(p1.y, p2.y) > r.t && lo(p1.y, p2.y) < r.b
  )
}

/** 꺾인 점들을 모서리가 둥근 길로 그린다 */
function roundedPath(pts: { x: number; y: number }[], radius = 10): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]
    const cur = pts[i]
    const next = pts[i + 1]
    // 모서리 앞뒤로 조금씩 잘라 내고 그 사이를 곡선으로 잇는다
    const r1 = Math.min(radius, Math.hypot(cur.x - prev.x, cur.y - prev.y) / 2)
    const r2 = Math.min(radius, Math.hypot(next.x - cur.x, next.y - cur.y) / 2)
    const r = Math.min(r1, r2)
    const a = {
      x: cur.x + Math.sign(prev.x - cur.x) * r,
      y: cur.y + Math.sign(prev.y - cur.y) * r
    }
    const b = {
      x: cur.x + Math.sign(next.x - cur.x) * r,
      y: cur.y + Math.sign(next.y - cur.y) * r
    }
    d += ` L ${a.x} ${a.y} Q ${cur.x} ${cur.y} ${b.x} ${b.y}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${last.x} ${last.y}`
  return d
}

/** 상자에서 나오고 들어갈 때 곧게 뻗는 길이 */
const STUB = 22

/**
 * 두 상자를 잇는 길을 낸다.
 *
 * 곧게 이으면 사이에 낀 상자를 뚫고 지나가 선이 보이지 않는다.
 * 그래서 직각으로 꺾어 가되, 가는 길에 걸리는 상자가 있으면 **옆으로 비켜**
 * 지나간다. 비킬 쪽은 걸린 상자들의 왼쪽·오른쪽 가운데 가까운 쪽을 고른다.
 */
function routeEdge(a: WfNode, b: WfNode, all: WfNode[]): { d: string; mid: { x: number; y: number } } {
  const { x1, y1, x2, y2, vertical, sign } = anchors(a, b)
  const others = all.filter((n) => n.id !== a.id && n.id !== b.id)

  const pts: { x: number; y: number }[] = []

  if (vertical) {
    const sy = y1 + STUB * sign
    const ey = y2 - STUB * sign
    // 곧게 갈 수 있으면 그대로 간다
    const straight = [{ x: x1, y: y1 }, { x: x1, y: sy }, { x: x2, y: ey }, { x: x2, y: y2 }]
    const blocked = others.filter((n) =>
      hits({ x: Math.min(x1, x2), y: sy }, { x: Math.max(x1, x2), y: ey }, box(n))
    )
    if (!blocked.length) {
      pts.push(...(x1 === x2 ? [{ x: x1, y: y1 }, { x: x2, y: y2 }] : straight))
    } else {
      // 걸리는 상자들을 통째로 비켜 갈 x 를 고른다
      const leftOf = Math.min(...blocked.map((n) => box(n).l)) - 18
      const rightOf = Math.max(...blocked.map((n) => box(n).r)) + 18
      const detour = Math.abs(leftOf - x1) <= Math.abs(rightOf - x1) ? leftOf : rightOf
      pts.push(
        { x: x1, y: y1 },
        { x: x1, y: sy },
        { x: detour, y: sy },
        { x: detour, y: ey },
        { x: x2, y: ey },
        { x: x2, y: y2 }
      )
    }
  } else {
    const sx = x1 + STUB * sign
    const ex = x2 - STUB * sign
    const blocked = others.filter((n) =>
      hits({ x: sx, y: Math.min(y1, y2) }, { x: ex, y: Math.max(y1, y2) }, box(n))
    )
    if (!blocked.length) {
      pts.push(
        ...(y1 === y2
          ? [{ x: x1, y: y1 }, { x: x2, y: y2 }]
          : [{ x: x1, y: y1 }, { x: sx, y: y1 }, { x: sx, y: y2 }, { x: x2, y: y2 }])
      )
    } else {
      const above = Math.min(...blocked.map((n) => box(n).t)) - 18
      const below = Math.max(...blocked.map((n) => box(n).b)) + 18
      const detour = Math.abs(above - y1) <= Math.abs(below - y1) ? above : below
      pts.push(
        { x: x1, y: y1 },
        { x: sx, y: y1 },
        { x: sx, y: detour },
        { x: ex, y: detour },
        { x: ex, y: y2 },
        { x: x2, y: y2 }
      )
    }
  }

  // 글자와 단추를 놓을 자리 — 길의 한가운데
  const mid = pts.length % 2 === 1
    ? pts[(pts.length - 1) / 2]
    : {
        x: (pts[pts.length / 2 - 1].x + pts[pts.length / 2].x) / 2,
        y: (pts[pts.length / 2 - 1].y + pts[pts.length / 2].y) / 2
      }

  return { d: roundedPath(pts), mid }
}

export default function WorkflowEditor({
  topic,
  value,
  onChange,
  readOnly = false,
  tasks = []
}: Props): JSX.Element {
  const ask = useConfirm()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [editingText, setEditingText] = useState<string | null>(null)

  /** 눌러 고른 화살표. 고르면 가운데에 [−] [✎] 가 뜬다. */
  const [pickedEdge, setPickedEdge] = useState<string | null>(null)
  /** 화살표에 붙일 말을 고치는 중이면 그 값 */
  const [edgeLabel, setEdgeLabelDraft] = useState<string | null>(null)

  /**
   * 연결선을 끌고 있는 중.
   *
   * 고른 상자의 네 변 가운데 점을 잡아 끌면, 커서를 따라 선이 따라오다가
   * 다른 상자에 놓는 순간 화살표가 된다. over 는 지금 커서가 얹힌 상자로,
   * 놓기 전에 어디로 이어지는지 보여 주려고 들고 있다.
   */
  const [link, setLink] = useState<{
    from: string
    x1: number
    y1: number
    x2: number
    y2: number
    over: string | null
  } | null>(null)

  /** 창 전체에서 받는 손가락 움직임이 최신 값을 보게 하는 그릇 */
  const linkRef = useRef(link)
  linkRef.current = link

  /** 끌고 있는 상자와, 상자 안에서 붙잡은 지점 */
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)

  const byId = useMemo(() => {
    const m = new Map<string, WfNode>()
    for (const n of value.nodes) m.set(n.id, n)
    return m
  }, [value.nodes])

  /** 판 크기 — 상자들을 다 담고 여유를 둔다 */
  const size = useMemo(() => {
    let w = 900
    let h = 520
    for (const n of value.nodes) {
      w = Math.max(w, n.x + n.w + 80)
      h = Math.max(h, n.y + nodeHeight(n) + 80)
    }
    return { w, h }
  }, [value.nodes])

  const patch = useCallback(
    (next: Partial<Workflow>) => onChange({ ...value, ...next }),
    [onChange, value]
  )

  const moveNode = useCallback(
    (id: string, x: number, y: number) => {
      patch({
        nodes: value.nodes.map((n) =>
          n.id === id
            ? { ...n, x: Math.max(0, Math.round(x / GRID) * GRID), y: Math.max(0, Math.round(y / GRID) * GRID) }
            : n
        )
      })
    },
    [patch, value.nodes]
  )

  /** 화면 위의 자리를 판 위의 자리로 옮긴다 (스크롤한 만큼 더해 준다) */
  const toCanvas = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const el = wrapRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    return { x: clientX - r.left + el.scrollLeft, y: clientY - r.top + el.scrollTop }
  }, [])

  /** 그 자리에 있는 상자의 id. 연결선을 놓을 곳을 찾을 때 쓴다. */
  const nodeAt = (clientX: number, clientY: number): string | null => {
    const el = document.elementFromPoint(clientX, clientY)
    const host = el instanceof Element ? el.closest('[data-node]') : null
    return host?.getAttribute('data-node') ?? null
  }

  const connect = useCallback(
    (from: string, to: string) => {
      if (from === to) return
      if (value.edges.some((e) => e.from === from && e.to === to)) return
      patch({ edges: [...value.edges, { id: uid('e'), from, to, label: '' }] })
    },
    [patch, value.edges]
  )

  // 끌기 — 판 전체에서 받아야 빨리 움직여도 놓치지 않는다
  useEffect(() => {
    if (readOnly) return

    const onMove = (e: PointerEvent): void => {
      // 연결선을 끄는 중이면 선 끝을 커서에 붙인다
      const l = linkRef.current
      if (l) {
        const p = toCanvas(e.clientX, e.clientY)
        const over = nodeAt(e.clientX, e.clientY)
        setLink({ ...l, x2: p.x, y2: p.y, over: over && over !== l.from ? over : null })
        return
      }
      if (!drag.current) return
      const p = toCanvas(e.clientX, e.clientY)
      moveNode(drag.current.id, p.x - drag.current.dx, p.y - drag.current.dy)
    }

    const onUp = (e: PointerEvent): void => {
      const l = linkRef.current
      if (l) {
        const to = nodeAt(e.clientX, e.clientY)
        if (to) connect(l.from, to)
        setLink(null)
      }
      drag.current = null
    }

    // 끌던 도중 Esc 를 누르면 없던 일로 한다
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && linkRef.current) setLink(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [moveNode, readOnly, toCanvas, connect])

  const startDrag = (e: React.PointerEvent, n: WfNode): void => {
    if (readOnly || editingText === n.id) return
    const p = toCanvas(e.clientX, e.clientY)
    drag.current = { id: n.id, dx: p.x - n.x, dy: p.y - n.y }
    setSelected(n.id)
  }

  /** 네 변의 가운데 점을 잡고 끌기 시작 */
  const startLink = (e: React.PointerEvent, n: WfNode, side: Side): void => {
    if (readOnly) return
    // 상자 끌기로 넘어가지 않게 막는다
    e.stopPropagation()
    e.preventDefault()
    const p = handlePoint(n, side)
    setLink({ from: n.id, x1: p.x, y1: p.y, x2: p.x, y2: p.y, over: null })
  }

  const addNode = (kind: WfNode['kind']): void => {
    const n: WfNode = {
      id: uid('n'),
      x: 60 + ((value.nodes.length * 30) % 240),
      y: 40 + ((value.nodes.length * 40) % 300),
      w: NODE_W,
      text: kind === 'decision' ? '조건?' : '새 단계',
      kind
    }
    patch({ nodes: [...value.nodes, n] })
    setSelected(n.id)
    setEditingText(n.id)
  }

  const removeNode = (id: string): void => {
    patch({
      nodes: value.nodes.filter((n) => n.id !== id),
      edges: value.edges.filter((e) => e.from !== id && e.to !== id)
    })
    setSelected(null)
  }

  const setText = (id: string, text: string): void => {
    patch({ nodes: value.nodes.map((n) => (n.id === id ? { ...n, text } : n)) })
  }

  const setKind = (id: string, kind: WfNode['kind']): void => {
    patch({ nodes: value.nodes.map((n) => (n.id === id ? { ...n, kind } : n)) })
  }

  const resize = (id: string, delta: number): void => {
    patch({
      nodes: value.nodes.map((n) =>
        n.id === id ? { ...n, w: Math.min(360, Math.max(120, n.w + delta)) } : n
      )
    })
  }

  const clickNode = (n: WfNode): void => {
    if (readOnly) return
    setSelected(n.id)
  }

  const removeEdge = (id: string): void => {
    patch({ edges: value.edges.filter((e) => e.id !== id) })
  }

  const setEdgeLabel = (id: string, label: string): void => {
    patch({ edges: value.edges.map((e) => (e.id === id ? { ...e, label } : e)) })
  }

  const sel = selected ? byId.get(selected) : null

  return (
    <div className={`wf ${readOnly ? 'ro' : ''}`}>
      {!readOnly && (
        <div className="wf-bar">
          {WF_KINDS.map((k) => (
            <button key={k.id} className="btn btn-sm" onClick={() => addNode(k.id)}>
              ＋ {k.label}
            </button>
          ))}
          <span className="spacer" />
          {tasks.length > 0 && (
            <button
              className="btn btn-sm"
              title="등록된 업무를 시기 순으로 세워 첫 그림을 만듭니다"
              onClick={() =>
                void (async () => {
                  if (value.nodes.length) {
                    const ok = await ask({
                      title: '지금 그림을 지우고 새로 그릴까요?',
                      body: '등록된 업무를 시기 순으로 세워 첫 그림을 만듭니다.',
                      okText: '새로 그리기',
                      danger: true
                    })
                    if (!ok) return
                  }
                  onChange(draftWorkflow(tasks))
                  setSelected(null)
                })()
              }
            >
              ✍ 업무로 자동 배치
            </button>
          )}
        </div>
      )}

      {/*
        안내 띠는 판 위에 떠 있다. 흐름대로 자리를 차지하면 띠가 나타나는 순간
        판이 아래로 밀려, 끌던 손 밑에서 상자가 움직여 엉뚱한 곳에 놓인다.
      */}
      <div className="wf-stage">
        {link && (
          <div className="note note-info wf-hint">
            <b>이을 상자에 놓으세요.</b>{' '}
            {link.over ? (
              <>
                <b>{byId.get(link.from)?.text.split('\n')[0]}</b> →{' '}
                <b>{byId.get(link.over)?.text.split('\n')[0]}</b> 로 이어집니다.
              </>
            ) : (
              <>빈 곳에 놓거나 Esc 를 누르면 그만둡니다.</>
            )}
          </div>
        )}

        <div className="wf-canvas-wrap" ref={wrapRef}>
        <div
          className="wf-canvas"
          style={{ width: size.w, height: size.h }}
          onClick={(e) => {
            // 빈 바닥을 눌렀을 때만 — 상자나 선을 누른 것은 그대로 둔다
            if (e.target !== e.currentTarget) return
            setPickedEdge(null)
            setEdgeLabelDraft(null)
            setSelected(null)
          }}
        >
          <svg width={size.w} height={size.h} className="wf-svg">
            <defs>
              <marker
                id="wf-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border-strong)" />
              </marker>
              <marker
                id="wf-arrow-live"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
              </marker>
            </defs>

            {value.edges.map((e) => {
              const a = byId.get(e.from)
              const b = byId.get(e.to)
              if (!a || !b) return null
              // 사이에 낀 상자를 피해 직각으로 돌아간다
              const { d, mid } = routeEdge(a, b, value.nodes)
              const on = pickedEdge === e.id
              return (
                <g key={e.id} className={`wf-edge ${on ? 'on' : ''}`}>
                  <path d={d} fill="none" className="wf-edge-line" markerEnd="url(#wf-arrow)" />

                  {/* 눈에 보이는 선은 얇아서 누르기 어렵다. 넓은 선을 겹쳐 둔다. */}
                  {!readOnly && (
                    <path
                      d={d}
                      fill="none"
                      className="wf-edge-grab"
                      onClick={() => setPickedEdge(on ? null : e.id)}
                    >
                      <title>누르면 지우거나 글자를 넣을 수 있습니다</title>
                    </path>
                  )}

                  {e.label && !on && (
                    <text x={mid.x} y={mid.y - 8} className="wf-edge-label" textAnchor="middle">
                      {e.label}
                    </text>
                  )}
                </g>
              )
            })}

            {/* 끌고 있는 연결선 — 놓을 상자에 얹히면 파랗게 바뀐다 */}
            {link && (
              <line
                x1={link.x1}
                y1={link.y1}
                x2={link.x2}
                y2={link.y2}
                className={`wf-link-preview ${link.over ? 'on' : ''}`}
                markerEnd="url(#wf-arrow-live)"
              />
            )}
          </svg>

          {value.nodes.map((n) => (
            <div
              key={n.id}
              data-node={n.id}
              className={`wf-node k-${n.kind} ${selected === n.id ? 'sel' : ''} ${
                link?.over === n.id ? 'drop' : ''
              } ${link?.from === n.id ? 'linking' : ''}`}
              style={{ left: n.x, top: n.y, width: n.w, minHeight: nodeHeight(n) }}
              onPointerDown={(e) => startDrag(e, n)}
              onClick={() => clickNode(n)}
              onDoubleClick={() => !readOnly && setEditingText(n.id)}
            >
              {editingText === n.id ? (
                <textarea
                  className="wf-node-edit"
                  value={n.text}
                  autoFocus
                  onChange={(e) => setText(n.id, e.target.value)}
                  onBlur={() => setEditingText(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditingText(null)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="wf-node-text">{n.text}</span>
              )}

              {/* 고른 상자의 네 변 가운데 점. 끌어다 다른 상자에 놓으면 이어진다. */}
              {!readOnly &&
                selected === n.id &&
                editingText !== n.id &&
                SIDES.map((side) => (
                  <span
                    key={side}
                    className={`wf-handle h-${side}`}
                    onPointerDown={(e) => startLink(e, n, side)}
                    title="끌어다 다른 상자에 놓으면 화살표가 이어집니다"
                  />
                ))}
            </div>
          ))}

          {/* 고른 화살표의 단추 — 길 한가운데에 뜬다 */}
          {!readOnly &&
            pickedEdge &&
            (() => {
              const e = value.edges.find((x) => x.id === pickedEdge)
              const a = e && byId.get(e.from)
              const b = e && byId.get(e.to)
              if (!e || !a || !b) return null
              const { mid } = routeEdge(a, b, value.nodes)
              return (
                <div className="wf-edge-tools" style={{ left: mid.x, top: mid.y }}>
                  {edgeLabel === null ? (
                    <>
                      <button
                        className="wf-edge-btn del"
                        title="이 화살표를 지웁니다"
                        onClick={() => {
                          removeEdge(e.id)
                          setPickedEdge(null)
                        }}
                      >
                        −
                      </button>
                      <button
                        className="wf-edge-btn"
                        title="화살표에 붙일 말 (예 / 아니오 같은 것)"
                        onClick={() => setEdgeLabelDraft(e.label)}
                      >
                        ✎
                      </button>
                    </>
                  ) : (
                    <input
                      type="text"
                      className="wf-edge-input"
                      value={edgeLabel}
                      autoFocus
                      placeholder="예 / 아니오"
                      onChange={(ev) => setEdgeLabelDraft(ev.target.value)}
                      onBlur={() => {
                        setEdgeLabel(e.id, edgeLabel.trim())
                        setEdgeLabelDraft(null)
                      }}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter') {
                          setEdgeLabel(e.id, edgeLabel.trim())
                          setEdgeLabelDraft(null)
                        }
                        if (ev.key === 'Escape') setEdgeLabelDraft(null)
                      }}
                    />
                  )}
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {!readOnly && (
        <div className="wf-foot">
          {sel ? (
            <>
              <span className="muted small">고른 상자</span>
              <select
                value={sel.kind}
                onChange={(e) => setKind(sel.id, e.target.value as WfNode['kind'])}
              >
                {WF_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
              <button className="btn btn-sm" onClick={() => setEditingText(sel.id)}>
                ✎ 글자
              </button>
              <button className="btn btn-sm" onClick={() => resize(sel.id, -30)}>
                ￩ 좁게
              </button>
              <button className="btn btn-sm" onClick={() => resize(sel.id, 30)}>
                넓게 ￫
              </button>
              <span className="muted small">
                네 변의 <b>파란 점</b>을 끌어다 다른 상자에 놓으면 이어집니다
              </span>
              <span className="spacer" />
              <button className="btn btn-sm btn-danger" onClick={() => removeNode(sel.id)}>
                삭제
              </button>
            </>
          ) : (
            <span className="muted small">
              상자를 <b>끌어서</b> 옮기고, <b>두 번 눌러</b> 글자를 고칩니다. 상자를 한 번 누르면
              네 변에 <b>파란 점</b>이 생기는데, 그것을 <b>끌어다 다른 상자에 놓으면</b> 화살표가
              이어집니다. — {topic}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
