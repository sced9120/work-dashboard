import { useMemo, useState } from 'react'
import type { SchoolTimetable, TtBlock, TtRules } from '../../shared/timetable'
import { BLOCK_PALETTE, blockHas, isFree, rulesReady, slotKey, slotOf, suggestRules } from '../../shared/timetable'
import { useConfirm } from '../lib/confirm'

interface Props {
  tt: SchoolTimetable
  /** 저장해 둔 설정 (지난 시간표로 정한 것일 수 있다) */
  rules: TtRules | null
  onSave: (r: { blocks: TtBlock[]; cce: Record<string, string[]> }) => Promise<void>
  /** 이미 정해 둔 것을 고치는 중이면 [취소] 를 보인다 */
  onCancel?: () => void
}

interface Draft {
  blocks: TtBlock[]
  cce: Record<string, string[]>
}

const CCE = '창체'

/**
 * 블록 · 창체 확인 — 수업 바꾸기 전에 한 번.
 * 시간표 파일의 칸 색깔 · 묶음 글자로 짐작한 블록을 학년별 표에 칠해 보여 주고, 사용자가 고친다.
 * 블록 시간의 수업은 한 반만 바꿀 수 없고, 창체 자리로는 수업을 옮기지 않는다.
 */
export default function BlockSetup({ tt, rules, onSave, onCancel }: Props): JSX.Element {
  const ask = useConfirm()
  const hint = useMemo(() => suggestRules(tt), [tt])
  const grades = useMemo(() => [...new Set(tt.classes.map((c) => c.grade))].sort((a, b) => a - b), [tt])

  // 처음 모양. 시간표를 새로 불러왔으면 파일에서 다시 짐작하되, 창체 자리와
  // (파일에 블록 표시가 없을 때) 지난번에 정한 블록은 가져온다
  const [start] = useState(() => {
    if (rules && rulesReady(tt, rules)) return { draft: { blocks: rules.blocks, cce: rules.cce }, kept: '' }
    const keepBlocks = !hint.by && !!rules?.blocks.length
    const keepCce = !!rules && Object.values(rules.cce).some((v) => v.length)
    const kept = keepBlocks && keepCce ? '블록 · 창체 자리' : keepBlocks ? '블록' : keepCce ? '창체 자리' : ''
    return { draft: { blocks: keepBlocks ? rules!.blocks : hint.blocks, cce: keepCce ? rules!.cce : hint.cce }, kept }
  })
  const [draft, setDraft] = useState<Draft>(start.draft)
  const [grade, setGrade] = useState(() => grades.find((g) => draft.blocks.some((b) => b.grade === g)) ?? grades[0] ?? 1)
  const [brush, setBrush] = useState<string>('')
  const [saving, setSaving] = useState(false)

  const blocks = draft.blocks.filter((b) => b.grade === grade)
  const classes = tt.classes.filter((c) => c.grade === grade).map((c) => c.id)
  const cce = draft.cce[String(grade)] ?? []
  const maxP = tt.periods.length
  const at = (d: number, p: number): string => `${tt.days[d]} ${p + 1}교시`

  const setBlock = (id: string, patch: Partial<TtBlock>): void =>
    setDraft((x) => ({ ...x, blocks: x.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) }))

  const toggle = (d: number, p: number): void => {
    const k = slotKey(d, p)
    if (brush === CCE) {
      setDraft((x) => {
        const cur = x.cce[String(grade)] ?? []
        const next = cur.includes(k) ? cur.filter((s) => s !== k) : [...cur, k]
        return { ...x, cce: { ...x.cce, [String(grade)]: next } }
      })
      return
    }
    const b = draft.blocks.find((x) => x.id === brush)
    if (!b) return
    setBlock(b.id, { slots: b.slots.includes(k) ? b.slots.filter((s) => s !== k) : [...b.slots, k] })
  }

  const addBlock = (): void => {
    const used = new Set(draft.blocks.map((b) => b.color))
    const color = BLOCK_PALETTE.find((c) => !used.has(c)) ?? BLOCK_PALETTE[draft.blocks.length % BLOCK_PALETTE.length]
    const id = `u${Date.now().toString(36)}`
    setDraft((x) => ({ ...x, blocks: [...x.blocks, { id, name: '', grade, classes: [], slots: [], color }] }))
    setBrush(id)
  }

  const removeBlock = (id: string): void => {
    setDraft((x) => ({ ...x, blocks: x.blocks.filter((b) => b.id !== id) }))
    if (brush === id) setBrush('')
  }

  /** 드는 반 켜고 끄기 — 모두 켜지면 "전체 반"(빈 목록) */
  const toggleClass = (b: TtBlock, cls: string): void => {
    const cur = b.classes.length ? b.classes : classes
    const next = cur.includes(cls) ? cur.filter((c) => c !== cls) : [...cur, cls]
    if (!next.length) return
    setBlock(b.id, { classes: classes.every((c) => next.includes(c)) ? [] : next.sort((x, y) => x.localeCompare(y, 'ko', { numeric: true })) })
  }

  const reset = async (): Promise<void> => {
    const ok = await ask({
      title: '시간표 파일에서 다시 짐작할까요?',
      body: '지금까지 고친 블록 · 창체는 없어지고, 칸 색깔 · 묶음 글자로 처음부터 다시 칠합니다.',
      okText: '다시 짐작하기'
    })
    if (ok) {
      setDraft({ blocks: hint.blocks, cce: hint.cce })
      setBrush('')
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const cleanCce = Object.fromEntries(Object.entries(draft.cce).filter(([, v]) => v.length).map(([g, v]) => [g, [...v].sort(byKey)]))
      const cleanBlocks = draft.blocks.filter((b) => b.slots.length).map((b) => ({ ...b, name: b.name.trim(), slots: [...b.slots].sort(byKey) }))
      await onSave({ blocks: cleanBlocks, cce: cleanCce })
    } finally {
      setSaving(false)
    }
  }

  /** 그 시간 그 학년에 있는 과목 (칸을 알아보기 쉽게) */
  const subjectsAt = (d: number, p: number): string => {
    const names = [
      ...new Set(
        tt.classes
          .filter((c) => c.grade === grade)
          .map((c) => c.grid[d]?.[p])
          .filter((x) => x && !isFree(x))
          .map((x) => x!.subject)
      )
    ]
    return names.length > 3 ? `${names.slice(0, 3).join(' · ')} 외 ${names.length - 3}` : names.join(' · ')
  }

  const totalCce = Object.values(draft.cce).reduce((n, v) => n + v.length, 0)

  return (
    <div className="card">
      <div className="card-title">
        <span>🧱 수업 바꾸기 전에 — 블록 · 창체 확인</span>
        {hint.by ? <span className="badge badge-accent">{hint.by}로 짐작</span> : <span className="badge">짐작 못 함</span>}
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        <b>블록</b>(여러 반이 함께 움직이는 선택 수업) 시간의 수업은 한 반만 따로 바꿀 수 없고, <b>창체 자리</b>로는 수업을 옮기지
        않습니다. 시간표 파일에서 짐작해 칠해 두었으니 학년마다 맞는지 보고, 틀린 곳은 고친 뒤 <b>[이대로 정하기]</b> 를 눌러 주세요.
        정해야 수업 바꾸기를 쓸 수 있고, 시간표 파일을 다시 불러오면 한 번 더 확인합니다.
      </p>

      {!hint.by && (
        <div className="note note-warn" style={{ marginBottom: 8 }}>
          이 시간표 파일에는 블록 표시(칸 색깔이나 <code>A_사문</code> 같은 묶음 글자)가 없어 블록을 찾지 못했습니다.{' '}
          <b>블록 시간을 알려 주세요.</b> 학년을 고르고 <b>[+ 블록 더하기]</b> 를 누른 뒤 그 블록의 시간 칸을 누르면 됩니다. 블록이
          없는 학교면 그대로 정하셔도 됩니다.
        </div>
      )}
      {start.kept && (
        <div className="note note-info" style={{ marginBottom: 8 }}>
          지난번에 정한 {start.kept}{start.kept === '블록' ? '을' : '를'} 가져왔습니다. 시간표가 바뀌었으면 함께 확인해 주세요.
        </div>
      )}
      {hint.notes.map((n) => (
        <div key={n} className="note note-info" style={{ marginBottom: 8 }}>
          {n}
        </div>
      ))}
      <div className="note note-warn" style={{ marginBottom: 10 }}>
        <b>특히 창체 자리는 꼭 표시해 주세요.</b> 창체 시간이 시간표 파일에 없는 교시(예: 수요일 5 · 6교시)에 있으면 빗금 칸을 눌러
        표시하면 됩니다.
      </div>

      <div className="tabs" style={{ marginBottom: 8 }}>
        {grades.map((g) => {
          const n = draft.blocks.filter((b) => b.grade === g).length
          const c = draft.cce[String(g)]?.length ?? 0
          return (
            <button
              key={g}
              className={`tab ${g === grade ? 'active' : ''}`}
              onClick={() => {
                setGrade(g)
                // 블록은 학년마다 따로라 고른 블록을 놓는다 (창체는 그대로)
                if (brush !== CCE) setBrush('')
              }}
            >
              {g}학년 <span className="muted small">블록 {n} · 창체 {c}</span>
            </button>
          )
        })}
      </div>

      <div className="tt-brushes">
        <span className="small muted">누를 때 칠할 것:</span>
        {blocks.map((b, i) => (
          <button key={b.id} className={`tt-brush ${brush === b.id ? 'active' : ''}`} onClick={() => setBrush(brush === b.id ? '' : b.id)}>
            <span className="tt-swatch" style={{ background: b.color }} />
            {b.name || `블록 ${i + 1}`}
          </button>
        ))}
        <button className={`tt-brush cce ${brush === CCE ? 'active' : ''}`} onClick={() => setBrush(brush === CCE ? '' : CCE)}>
          🎒 창체
        </button>
        <button className="btn btn-sm" onClick={addBlock}>
          + 블록 더하기
        </button>
      </div>
      {!brush && <p className="muted small" style={{ margin: '4px 0 0' }}>위에서 블록이나 창체를 고른 뒤 시간 칸을 누르면 넣고 뺍니다.</p>}

      <div className="tt-table-wrap" style={{ marginTop: 8 }}>
        <table className="tt-table tt-rules">
          <thead>
            <tr>
              <th />
              {tt.days.map((d) => (
                <th key={d}>{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxP }, (_, p) => (
              <tr key={p}>
                <th>{p + 1}</th>
                {tt.days.map((_, d) => {
                  const k = slotKey(d, p)
                  const here = blocks.filter((b) => b.slots.includes(k))
                  const isC = cce.includes(k)
                  const off = p + 1 > (tt.dayPeriods[d] ?? 0)
                  return (
                    <td
                      key={d}
                      className={`${off ? 'off' : ''} ${brush ? 'pickable' : ''}`}
                      style={here[0] && !isC ? { background: here[0].color } : undefined}
                      onClick={() => brush && toggle(d, p)}
                      title={at(d, p)}
                    >
                      {isC && <span className="tt-chip cce">창체</span>}
                      {here.map((b) => (
                        <span key={b.id} className="tt-chip" style={{ background: b.color }}>
                          {b.name || `블록 ${blocks.indexOf(b) + 1}`}
                          {b.classes.length > 0 && <small> {short(b.classes)}</small>}
                        </span>
                      ))}
                      {!off && <span className="tt-at-subj">{subjectsAt(d, p)}</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="list" style={{ marginTop: 10 }}>
        {blocks.length === 0 && (
          <div className="empty">{grade}학년은 블록이 없습니다. 블록이 있으면 [+ 블록 더하기] 로 만들고 시간 칸을 누르세요.</div>
        )}
        {blocks.map((b, i) => (
          <div key={b.id} className={`item tt-block-row ${brush === b.id ? 'active' : ''}`}>
            <div className="item-head">
              <div className="row" style={{ minWidth: 0, flex: 1 }}>
                <span className="tt-swatch big" style={{ background: b.color }} />
                <input
                  type="text"
                  value={b.name}
                  placeholder={`블록 ${i + 1}`}
                  onChange={(e) => setBlock(b.id, { name: e.target.value })}
                  style={{ width: 90 }}
                />
                <span className="small">
                  {b.slots.length ? [...b.slots].sort(byKey).map((k) => at(...slotOf(k))).join(' · ') : '시간 없음 — 칸을 눌러 넣으세요'}
                </span>
              </div>
              <div className="row">
                <button className={`btn btn-sm ${brush === b.id ? 'btn-primary' : ''}`} onClick={() => setBrush(brush === b.id ? '' : b.id)}>
                  {brush === b.id ? '✓ 칠하는 중' : '칸 칠하기'}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => removeBlock(b.id)}>
                  빼기
                </button>
              </div>
            </div>
            <div className="row tt-cls-toggles">
              <span className="small muted">드는 반 {b.classes.length ? `${b.classes.length}개` : '— 전체'}</span>
              {classes.map((c) => (
                <button key={c} className={`btn btn-sm ${blockHas(b, c) ? 'on' : ''}`} onClick={() => toggleClass(b, c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="row row-end" style={{ marginTop: 12 }}>
        <span className="muted small" style={{ marginRight: 'auto' }}>
          모두 블록 {draft.blocks.filter((b) => b.slots.length).length}개 · 창체 {totalCce}칸
        </span>
        {hint.by && (
          <button className="btn btn-sm btn-ghost" onClick={() => void reset()}>
            파일에서 다시 짐작하기
          </button>
        )}
        {onCancel && (
          <button className="btn btn-sm" onClick={onCancel}>
            취소
          </button>
        )}
        <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? '저장하는 중…' : '✅ 이대로 정하기'}
        </button>
      </div>
    </div>
  )
}

const byKey = (a: string, b: string): number => slotOf(a)[0] - slotOf(b)[0] || slotOf(a)[1] - slotOf(b)[1]

/** 3-1 · 3-2 · 3-4 → 1·2·4반 */
const short = (cls: string[]): string => `${cls.map((c) => c.split('-')[1]).join('·')}반`

/** 블록 · 창체 설정을 한 줄로 */
export function rulesSummary(rules: TtRules): string {
  const n = rules.blocks.length
  const c = Object.values(rules.cce).reduce((s, v) => s + v.length, 0)
  return `블록 ${n}개 · 창체 ${c}칸`
}
