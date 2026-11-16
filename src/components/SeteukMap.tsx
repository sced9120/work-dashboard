import { useMemo, useState } from 'react'
import { areaKind, layoutMap, sugKey, toMarkdown } from '../../shared/seteukMap'
import type { LayoutNode, MapSuggest, MapTopic, TopicMap } from '../../shared/seteukMap'
import { useToast } from '../lib/toast'

/**
 * 학생부 주제 지도 — 그래프처럼 주제를 글상자로, 공통점을 선으로, 이어 갈 추천을 점선 상자로 보여 준다.
 * 자리는 shared/seteukMap.ts 의 layoutMap(같은 지도면 늘 같은 자리). 그림 크기에 맞춰 줄어든다(끌기 · 확대는 없음).
 */
interface Props {
  map: TopicMap
  /** 마크다운으로 복사할 때 제목에 쓰는 학생 표시 */
  label: string
}

const W = 900
const H = 520

/** 상자 가운데에서 other 쪽으로 나가는 선이 상자 테두리와 만나는 점 */
function edgePoint(n: LayoutNode, o: LayoutNode): { x: number; y: number } {
  const dx = o.x - n.x
  const dy = o.y - n.y
  if (!dx && !dy) return { x: n.x, y: n.y }
  const t = Math.min(dx ? n.w / 2 / Math.abs(dx) : Infinity, dy ? n.h / 2 / Math.abs(dy) : Infinity, 1)
  return { x: n.x + dx * t, y: n.y + dy * t }
}

export default function SeteukMap({ map, label }: Props): JSX.Element {
  const toast = useToast()
  const [sel, setSel] = useState<string | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)

  const lay = useMemo(() => layoutMap(map, W, H, { x: 14, y: 16 }), [map])
  const topicById = useMemo(() => new Map(map.topics.map((t) => [t.id, t])), [map])
  const topicKind = (t: MapTopic): 'su' | 'ch' => (t.areas.length && t.areas.every((a) => areaKind(a) === '창체') ? 'ch' : 'su')

  const selTopic = sel ? topicById.get(sel) : undefined
  const selSug: MapSuggest | undefined = sel?.startsWith('sug:') ? map.suggests[Number(sel.slice(4))] : undefined
  const linked = (id: string): string[] => map.links.filter((l) => l.a === id || l.b === id).map((l) => (l.a === id ? l.b : l.a))
  const onKey = (e: React.KeyboardEvent, key: string): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setSel(key)
    }
  }

  const copyMd = async (): Promise<void> => {
    await window.api.clipboard.write(toMarkdown(map, label))
    toast('마크다운으로 복사했습니다.', 'ok')
  }

  const sugs = map.suggests.map((s, i) => ({ s, i }))
  const groups: { title: string; items: { s: MapSuggest; i: number }[] }[] = [
    { title: '교과 세특', items: sugs.filter((x) => x.s.kind === '교과') },
    { title: '자율 · 진로 · 동아리', items: sugs.filter((x) => x.s.kind !== '교과') }
  ]
  const chip = (a: string): JSX.Element => (
    <span key={a} className={`smap-chip ${areaKind(a) === '창체' ? 'ch' : 'su'}`}>
      {a}
    </span>
  )

  return (
    <div className="smap">
      <div className="stk-import-head">
        <span className="stk-style-label">주제 지도</span>
        <span className="small muted">주제 {map.topics.length} · 연결 {map.links.length} · 추천 {map.suggests.length}</span>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => void copyMd()}>
          마크다운 복사
        </button>
      </div>

      <div className="smap-body">
        <div className="smap-graph">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="학생부 주제 지도" onClick={() => setSel(null)}>
            <defs>
              <marker id="smap-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className="smap-arrow" />
              </marker>
            </defs>
            {map.links.map((l, i) => {
              const a = lay.pos[l.a]
              const b = lay.pos[l.b]
              if (!a || !b) return null
              const p = edgePoint(a, b)
              const q = edgePoint(b, a)
              const on = sel === l.a || sel === l.b
              return (
                <g key={`l${i}`} onMouseEnter={() => setTip({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, text: l.why || '이어짐' })} onMouseLeave={() => setTip(null)}>
                  <title>{l.why}</title>
                  <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={`smap-link${on ? ' on' : ''}`} />
                  <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="smap-hit" />
                </g>
              )
            })}
            {map.suggests.map((s, i) => {
              const a = lay.pos[s.from]
              const b = lay.pos[sugKey(i)]
              if (!a || !b) return null
              const p = edgePoint(a, b)
              const q = edgePoint(b, a)
              return (
                <g key={`e${i}`} onMouseEnter={() => setTip({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, text: s.why || '이어 갈 추천' })} onMouseLeave={() => setTip(null)}>
                  <title>{s.why}</title>
                  <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="smap-sline" markerEnd="url(#smap-arrow)" />
                  <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="smap-hit" />
                </g>
              )
            })}
            {lay.nodes.map((n) => {
              if (n.type === 'topic') {
                const t = map.topics[n.index]
                const k = topicKind(t)
                return (
                  <g
                    key={n.key}
                    className={`smap-node ${k}${sel === n.key ? ' sel' : ''}`}
                    tabIndex={0}
                    role="button"
                    aria-label={`${t.name} — ${t.areas.join(', ')}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSel(n.key)
                    }}
                    onKeyDown={(e) => onKey(e, n.key)}
                  >
                    <rect x={n.x - n.w / 2} y={n.y - n.h / 2} width={n.w} height={n.h} rx={n.h / 2} />
                    <text x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central" fontSize={12 + Math.min(6, t.areas.length + t.evidence.length) * 0.5}>
                      {t.name}
                    </text>
                  </g>
                )
              }
              const s = map.suggests[n.index]
              const bw = s.area.length * 10 + 12
              return (
                <g
                  key={n.key}
                  className={`smap-node sug ${s.kind === '교과' ? 'su' : 'ch'}${sel === n.key ? ' sel' : ''}`}
                  tabIndex={0}
                  role="button"
                  aria-label={`추천 ${s.topic} — ${s.area}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSel(n.key)
                  }}
                  onKeyDown={(e) => onKey(e, n.key)}
                >
                  <rect x={n.x - n.w / 2} y={n.y - n.h / 2} width={n.w} height={n.h} rx={8} />
                  <text x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central" fontSize={12}>
                    {s.topic}
                  </text>
                  <g className="smap-badge">
                    <rect x={n.x + n.w / 2 - bw + 6} y={n.y - n.h / 2 - 9} width={bw} height={15} rx={7.5} />
                    <text x={n.x + n.w / 2 - bw / 2 + 6} y={n.y - n.h / 2 - 1.5} textAnchor="middle" dominantBaseline="central" fontSize={10}>
                      {s.area}
                    </text>
                  </g>
                </g>
              )
            })}
            {tip && (
              <g className="smap-tip" pointerEvents="none">
                <rect x={Math.min(Math.max(tip.x - (tip.text.length * 11 + 16) / 2, 2), W - tip.text.length * 11 - 18)} y={tip.y - 13} width={tip.text.length * 11 + 16} height={26} rx={6} />
                <text x={Math.min(Math.max(tip.x, (tip.text.length * 11 + 16) / 2 + 2), W - (tip.text.length * 11 + 16) / 2 - 2)} y={tip.y} textAnchor="middle" dominantBaseline="central" fontSize={11.5}>
                  {tip.text}
                </text>
              </g>
            )}
          </svg>
          <div className="smap-legend small muted">
            <span className="smap-chip su">교과</span>
            <span className="smap-chip ch">자율 · 동아리 · 진로 · 행발</span>
            <span>점선 상자 = 이어 갈 추천(화살표는 이어지는 주제에서) · 선에 올리면 이유 · 상자 크기 = 영역 · 원문이 많은 주제</span>
          </div>
        </div>

        <aside className="smap-panel" aria-live="polite">
          {selTopic ? (
            <>
              <div className="smap-ptitle">{selTopic.name}</div>
              <div className="smap-chips">{selTopic.areas.map(chip)}</div>
              {selTopic.competency && <p className="small">역량 — {selTopic.competency}</p>}
              {selTopic.evidence.map((e, i) => (
                <blockquote key={i} className="smap-quote">
                  {e}
                </blockquote>
              ))}
              {linked(selTopic.id).length > 0 && (
                <>
                  <div className="smap-sub">이어지는 주제</div>
                  <ul className="smap-list">
                    {map.links
                      .filter((l) => l.a === selTopic.id || l.b === selTopic.id)
                      .map((l, i) => {
                        const o = l.a === selTopic.id ? l.b : l.a
                        return (
                          <li key={i}>
                            <button className="smap-go" onClick={() => setSel(o)}>
                              {topicById.get(o)?.name}
                            </button>
                            {l.why && <span className="muted"> — {l.why}</span>}
                          </li>
                        )
                      })}
                  </ul>
                </>
              )}
            </>
          ) : selSug ? (
            <>
              <div className="smap-ptitle">{selSug.topic}</div>
              <div className="smap-chips">
                {chip(selSug.area)}
                <span className="smap-chip">추천</span>
              </div>
              {selSug.newArea && <p className="small smap-warn">학생부에 없는 과목입니다. 그 과목 수업에서 할 수 있는지 확인해 주세요.</p>}
              <p className="small">
                이어지는 주제{' '}
                <button className="smap-go" onClick={() => setSel(selSug.from)}>
                  {topicById.get(selSug.from)?.name}
                </button>
              </p>
              {selSug.why && <p className="small">{selSug.why}</p>}
              {selSug.competency && <p className="small">역량 — {selSug.competency}</p>}
            </>
          ) : (
            <p className="small muted">주제 상자를 누르면 학생부 원문과 이어지는 주제를, 점선 상자를 누르면 추천 이유를 봅니다.</p>
          )}
        </aside>
      </div>

      <div className="smap-recs">
        <div className="smap-sub">추천 주제</div>
        {map.suggests.length === 0 && <p className="small muted">추천이 없습니다.</p>}
        {groups.map(
          (g) =>
            g.items.length > 0 && (
              <div key={g.title} className="smap-group">
                <div className="smap-gt">{g.title}</div>
                <ul className="smap-list">
                  {g.items.map(({ s, i }) => (
                    <li key={i}>
                      <button className="smap-go" onClick={() => setSel(sugKey(i))}>
                        <b>{s.topic}</b>
                      </button>
                      {chip(s.area)}
                      <span className="muted"> ← {topicById.get(s.from)?.name}</span>
                      {s.why && <div className="small">{s.why}</div>}
                      {s.competency && <div className="small muted">역량 — {s.competency}</div>}
                      {s.newArea && <div className="small smap-warn">학생부에 없는 과목 — 확인 필요</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )
        )}
      </div>
      <p className="small muted">AI 가 학생부를 읽고 만든 정리입니다. 학생 · 수업 기록으로 확인한 뒤 쓰세요.</p>
    </div>
  )
}
