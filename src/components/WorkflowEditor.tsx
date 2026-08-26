import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Task, WfEdge, WfNode, Workflow } from '../../shared/types'
import { WF_KINDS } from '../../shared/types'
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

/** 두 상자 사이를 잇는 선. 세로로 늘어선 경우가 많아 위·아래를 먼저 본다. */
function anchors(a: WfNode, b: WfNode): { x1: number; y1: number; x2: number; y2: number } {
  const ah = nodeHeight(a)
  const bh = nodeHeight(b)
  const ac = { x: a.x + a.w / 2, y: a.y + ah / 2 }
  const bc = { x: b.x + b.w / 2, y: b.y + bh / 2 }

  const dx = bc.x - ac.x
  const dy = bc.y - ac.y

  // 가로로 더 멀면 옆구리끼리, 아니면 위아래끼리 잇는다
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0
      ? { x1: a.x + a.w, y1: ac.y, x2: b.x, y2: bc.y }
      : { x1: a.x, y1: ac.y, x2: b.x + b.w, y2: bc.y }
  }
  return dy > 0
    ? { x1: ac.x, y1: a.y + ah, x2: bc.x, y2: b.y }
    : { x1: ac.x, y1: a.y, x2: bc.x, y2: b.y + bh }
}

export default function WorkflowEditor({
  topic,
  value,
  onChange,
  readOnly = false,
  tasks = []
}: Props): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<string | null>(null)
  /** 연결 시작점으로 잡아 둔 상자 */
  const [linking, setLinking] = useState<string | null>(null)
  const [editingText, setEditingText] = useState<string | null>(null)

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

  // 끌기 — 판 전체에서 받아야 빨리 움직여도 놓치지 않는다
  useEffect(() => {
    if (readOnly) return
    const onMove = (e: PointerEvent): void => {
      if (!drag.current || !wrapRef.current) return
      const r = wrapRef.current.getBoundingClientRect()
      const x = e.clientX - r.left + wrapRef.current.scrollLeft - drag.current.dx
      const y = e.clientY - r.top + wrapRef.current.scrollTop - drag.current.dy
      moveNode(drag.current.id, x, y)
    }
    const onUp = (): void => {
      drag.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [moveNode, readOnly])

  const startDrag = (e: React.PointerEvent, n: WfNode): void => {
    if (readOnly || editingText === n.id) return
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return
    drag.current = {
      id: n.id,
      dx: e.clientX - r.left + (wrapRef.current?.scrollLeft ?? 0) - n.x,
      dy: e.clientY - r.top + (wrapRef.current?.scrollTop ?? 0) - n.y
    }
    setSelected(n.id)
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

  /** 연결 만들기 — 시작점을 잡아 두고 다음에 누른 상자로 잇는다 */
  const clickNode = (n: WfNode): void => {
    if (readOnly) return
    if (linking && linking !== n.id) {
      const exists = value.edges.some((e) => e.from === linking && e.to === n.id)
      if (!exists) {
        patch({ edges: [...value.edges, { id: uid('e'), from: linking, to: n.id, label: '' }] })
      }
      setLinking(null)
      return
    }
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
              onClick={() => {
                if (value.nodes.length && !confirm('지금 그림을 지우고 새로 그립니다. 계속할까요?')) return
                onChange(draftWorkflow(tasks))
                setSelected(null)
              }}
            >
              ✍ 업무로 자동 배치
            </button>
          )}
        </div>
      )}

      {linking && (
        <div className="note note-info wf-hint">
          <b>이을 상자를 누르세요.</b> 화살표가 <b>{byId.get(linking)?.text.split('\n')[0]}</b> →
          누른 상자 방향으로 생깁니다.{' '}
          <button className="link" onClick={() => setLinking(null)}>
            취소
          </button>
        </div>
      )}

      <div className="wf-canvas-wrap" ref={wrapRef}>
        <div className="wf-canvas" style={{ width: size.w, height: size.h }}>
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
            </defs>

            {value.edges.map((e) => {
              const a = byId.get(e.from)
              const b = byId.get(e.to)
              if (!a || !b) return null
              const { x1, y1, x2, y2 } = anchors(a, b)
              const mx = (x1 + x2) / 2
              const my = (y1 + y2) / 2
              // 살짝 굽혀 두 상자가 나란할 때도 선이 보이게 한다
              const cx = Math.abs(x2 - x1) > Math.abs(y2 - y1) ? mx : x1
              const cy = Math.abs(x2 - x1) > Math.abs(y2 - y1) ? y1 : my
              return (
                <g key={e.id} className="wf-edge">
                  <path
                    d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                    fill="none"
                    stroke="var(--border-strong)"
                    strokeWidth={2}
                    markerEnd="url(#wf-arrow)"
                  />
                  {e.label && (
                    <text x={mx} y={my - 6} className="wf-edge-label" textAnchor="middle">
                      {e.label}
                    </text>
                  )}
                  {!readOnly && (
                    <circle
                      cx={mx}
                      cy={my}
                      r={9}
                      className="wf-edge-hit"
                      onClick={() => {
                        const label = prompt('화살표에 붙일 말 (비우면 지웁니다)', e.label)
                        if (label === null) return
                        if (label === '__x') removeEdge(e.id)
                        else setEdgeLabel(e.id, label)
                      }}
                      onDoubleClick={() => removeEdge(e.id)}
                    >
                      <title>누르면 글자 넣기 · 두 번 누르면 화살표 삭제</title>
                    </circle>
                  )}
                </g>
              )
            })}
          </svg>

          {value.nodes.map((n) => (
            <div
              key={n.id}
              className={`wf-node k-${n.kind} ${selected === n.id ? 'sel' : ''} ${
                linking === n.id ? 'linking' : ''
              }`}
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
            </div>
          ))}
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
              <button
                className={`btn btn-sm ${linking === sel.id ? 'btn-primary' : ''}`}
                onClick={() => setLinking(linking === sel.id ? null : sel.id)}
              >
                → 연결
              </button>
              <span className="spacer" />
              <button className="btn btn-sm btn-danger" onClick={() => removeNode(sel.id)}>
                삭제
              </button>
            </>
          ) : (
            <span className="muted small">
              상자를 <b>끌어서</b> 옮기고, <b>두 번 눌러</b> 글자를 고칩니다. 상자를 고른 뒤
              <b> [→ 연결]</b> 로 화살표를 잇습니다. — {topic}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
