import { useMemo, useState } from 'react'
import type { FixedKind, SchoolTimetable, TtBlock, TtRules } from '../../shared/timetable'
import {
  BLOCK_PALETTE,
  DAY_NAMES,
  blockHas,
  hoursCheck,
  isFree,
  rulesReady,
  slotKey,
  slotOf,
  standardRows,
  suggestRules
} from '../../shared/timetable'
import { useConfirm } from '../lib/confirm'
import { useToast } from '../lib/toast'

export interface SetupResult {
  blocks: TtBlock[]
  cce: Record<string, string[]>
  club: Record<string, string[]>
}

interface Props {
  tt: SchoolTimetable
  /** 저장해 둔 설정 (지난 시간표로 정한 것일 수 있다) */
  rules: TtRules | null
  onSave: (r: SetupResult) => Promise<void>
  /** 이미 정해 둔 것을 고치는 중이면 [취소] 를 보인다 */
  onCancel?: () => void
  /** 읽은 모양이 틀렸을 때 AI 로 다시 읽기 (API 키가 있을 때만) */
  onAiRead?: () => void
}

type Draft = SetupResult
type Step = 0 | 1 | 2
const STEPS = ['① 읽은 자료', '② 블록', '③ 창체 · 동아리']
const FIXED: { kind: FixedKind; icon: string; cls: string }[] = [
  { kind: '창체', icon: '🎒', cls: 'cce' },
  { kind: '동아리', icon: '🎨', cls: 'club' }
]

/**
 * 시간표 정리 — 수업 바꾸기 전에 한 번.
 * ① 읽은 자료: 학교마다 다른 시간표를 표준 자료(교사 · 요일 · 교시 · 반 · 과목 · 블록 · 구분)로 바꾼 것을 확인한다.
 *    파일에 적힌 시수와 맞춰 보고, 엑셀로 저장해 고친 뒤 다시 읽을 수 있다.
 * ② 블록: 칸 색깔 · 묶음 글자로 짐작한 블록을 학년별 표에서 고친다. 블록 시간의 수업은 한 반만 바꿀 수 없다.
 * ③ 창체 · 동아리: 이 자리로는 수업을 옮기지 않는다. 파일에 없는 교시(예: 수 5 · 6교시)도 표시할 수 있다.
 */
export default function TimetableSetup({ tt, rules, onSave, onCancel, onAiRead }: Props): JSX.Element {
  const ask = useConfirm()
  const toast = useToast()
  const hint = useMemo(() => suggestRules(tt), [tt])
  const hours = useMemo(() => hoursCheck(tt), [tt])
  const grades = useMemo(() => [...new Set(tt.classes.map((c) => c.grade))].sort((a, b) => a - b), [tt])

  // 처음 모양. 시간표를 새로 불러왔으면 파일에서 다시 짐작하되, 창체 · 동아리 자리와
  // (파일에 블록 표시가 없을 때) 지난번에 정한 블록은 가져온다
  const [start] = useState(() => {
    if (rules && rulesReady(tt, rules)) return { draft: { blocks: rules.blocks, cce: rules.cce, club: rules.club ?? {} }, kept: '' }
    const keepBlocks = !hint.by && !!rules?.blocks.length
    const keepFixed = !!rules && [rules.cce, rules.club ?? {}].some((m) => Object.values(m).some((v) => v.length))
    const kept = keepBlocks && keepFixed ? '블록 · 창체 · 동아리 자리' : keepBlocks ? '블록' : keepFixed ? '창체 · 동아리 자리' : ''
    return {
      draft: {
        blocks: keepBlocks ? rules!.blocks : hint.blocks,
        cce: keepFixed ? rules!.cce : hint.cce,
        club: keepFixed ? rules!.club ?? {} : hint.club
      },
      kept
    }
  })
  const [draft, setDraft] = useState<Draft>(start.draft)
  const [step, setStep] = useState<Step>(0)
  const [grade, setGrade] = useState(() => grades.find((g) => draft.blocks.some((b) => b.grade === g)) ?? grades[0] ?? 1)
  const [brush, setBrush] = useState<string>('')
  const [allGrades, setAllGrades] = useState(grades.length > 1)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<string>(() => `t:${tt.teachers[0] ?? ''}`)

  const rows = useMemo(() => standardRows(tt, { ...draft, confirmedFor: '', confirmedAt: '' }), [tt, draft])
  const kinds = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.kind]: (m[r.kind] ?? 0) + 1 }), {})

  const blocks = draft.blocks.filter((b) => b.grade === grade)
  const classes = tt.classes.filter((c) => c.grade === grade).map((c) => c.id)
  const maxP = Math.max(tt.periods.length, 7)
  const at = (d: number, p: number): string => `${tt.days[d]} ${p + 1}교시`

  const setBlock = (id: string, patch: Partial<TtBlock>): void =>
    setDraft((x) => ({ ...x, blocks: x.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) }))

  const fixedMap = (x: Draft, kind: FixedKind): Record<string, string[]> => (kind === '창체' ? x.cce : x.club)

  const toggle = (d: number, p: number): void => {
    const k = slotKey(d, p)
    const fk = FIXED.find((f) => f.kind === brush)?.kind
    if (fk) {
      setDraft((x) => {
        const m = { ...fixedMap(x, fk) }
        const on = !(m[String(grade)] ?? []).includes(k)
        for (const g of allGrades ? grades : [grade]) {
          const cur = (m[String(g)] ?? []).filter((s) => s !== k)
          m[String(g)] = on ? [...cur, k] : cur
        }
        return fk === '창체' ? { ...x, cce: m } : { ...x, club: m }
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
    const what = step === 1 ? '블록' : '창체 · 동아리 자리'
    const ok = await ask({
      title: `${what}${step === 1 ? '을' : '를'} 시간표 파일에서 다시 짐작할까요?`,
      body: `지금까지 고친 ${what}${step === 1 ? '은' : '는'} 없어지고 처음부터 다시 칠합니다.`,
      okText: '다시 짐작하기'
    })
    if (!ok) return
    setDraft((x) => (step === 1 ? { ...x, blocks: hint.blocks } : { ...x, cce: hint.cce, club: hint.club }))
    setBrush('')
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const clean = (m: Record<string, string[]>): Record<string, string[]> =>
        Object.fromEntries(Object.entries(m).filter(([, v]) => v.length).map(([g, v]) => [g, [...v].sort(byKey)]))
      const cleanBlocks = draft.blocks.filter((b) => b.slots.length).map((b) => ({ ...b, name: b.name.trim(), slots: [...b.slots].sort(byKey) }))
      await onSave({ blocks: cleanBlocks, cce: clean(draft.cce), club: clean(draft.club) })
    } finally {
      setSaving(false)
    }
  }

  const exportStd = async (): Promise<void> => {
    const r = await window.api.tt.exportStandard(rows)
    if (r.message !== '취소했습니다.') toast(r.message, r.ok ? 'ok' : 'err')
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

  const count = (m: Record<string, string[]>): number => Object.values(m).reduce((n, v) => n + v.length, 0)
  const missingText = compactSlots(tt, hint.missing)

  /* ---------- 학년별 표 (② · ③ 이 함께 쓴다) ---------- */
  const grid = (
    <>
      <div className="tabs" style={{ marginBottom: 8 }}>
        {grades.map((g) => (
          <button
            key={g}
            className={`tab ${g === grade ? 'active' : ''}`}
            onClick={() => {
              setGrade(g)
              // 블록은 학년마다 따로라 고른 블록을 놓는다 (창체 · 동아리는 그대로)
              if (!FIXED.some((f) => f.kind === brush)) setBrush('')
            }}
          >
            {g}학년{' '}
            <span className="muted small">
              {step === 1
                ? `블록 ${draft.blocks.filter((b) => b.grade === g).length}`
                : `창체 ${draft.cce[String(g)]?.length ?? 0} · 동아리 ${draft.club[String(g)]?.length ?? 0}`}
            </span>
          </button>
        ))}
      </div>

      <div className="tt-brushes">
        <span className="small muted">누를 때 칠할 것:</span>
        {step === 1 &&
          blocks.map((b, i) => (
            <button key={b.id} className={`tt-brush ${brush === b.id ? 'active' : ''}`} onClick={() => setBrush(brush === b.id ? '' : b.id)}>
              <span className="tt-swatch" style={{ background: b.color }} />
              {b.name || `블록 ${i + 1}`}
            </button>
          ))}
        {step === 1 && (
          <button className="btn btn-sm" onClick={addBlock}>
            + 블록 더하기
          </button>
        )}
        {step === 2 &&
          FIXED.map((f) => (
            <button key={f.kind} className={`tt-brush ${f.cls} ${brush === f.kind ? 'active' : ''}`} onClick={() => setBrush(brush === f.kind ? '' : f.kind)}>
              {f.icon} {f.kind}
            </button>
          ))}
        {step === 2 && grades.length > 1 && (
          <label className="small" style={{ marginLeft: 6 }}>
            <input type="checkbox" checked={allGrades} onChange={(e) => setAllGrades(e.target.checked)} /> 모든 학년 똑같이
          </label>
        )}
      </div>
      {!brush && (
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          위에서 {step === 1 ? '블록' : '창체나 동아리'}를 고른 뒤 시간 칸을 누르면 넣고 뺍니다.
        </p>
      )}

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
                  const fx = FIXED.filter((f) => fixedMap(draft, f.kind)[String(grade)]?.includes(k))
                  const off = p + 1 > (tt.dayPeriods[d] ?? 0)
                  return (
                    <td
                      key={d}
                      className={`${off ? 'off' : ''} ${brush ? 'pickable' : ''}`}
                      style={here[0] && !fx.length ? { background: here[0].color } : undefined}
                      onClick={() => brush && toggle(d, p)}
                      title={off ? `${at(d, p)} — 시간표 파일에 없는 교시` : at(d, p)}
                    >
                      {fx.map((f) => (
                        <span key={f.kind} className={`tt-chip ${f.cls}`}>
                          {f.kind}
                        </span>
                      ))}
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
    </>
  )

  /* ---------- ① 읽은 자료: 고른 선생님 · 반의 표준 자료 ---------- */
  const shown = rows.filter((r) => (view.startsWith('t:') ? r.teacher === view.slice(2) : r.cls === view.slice(2)))

  return (
    <div className="card">
      <div className="card-title">
        <span>🧱 수업 바꾸기 전에 — 시간표 정리</span>
        <div className="tt-steps">
          {STEPS.map((s, i) => (
            <button key={s} className={`tt-step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} onClick={() => setStep(i as Step)}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        학교마다 시간표 모양이 달라, 먼저 읽은 시간표를 <b>표준 자료</b>(교사 · 요일 · 교시 · 반 · 과목 · 블록 · 구분)로 바꿔 확인하고,{' '}
        <b>블록</b>(여러 반이 함께 움직이는 선택 수업)과 <b>창체 · 동아리</b> 시간을 정합니다. 블록 시간의 수업은 한 반만 따로 바꾸지 않고,
        창체 · 동아리 자리로는 수업을 옮기지 않습니다. 세 단계를 마쳐야 수업 바꾸기를 쓸 수 있습니다.
      </p>
      {start.kept && (
        <div className="note note-info" style={{ marginBottom: 8 }}>
          지난번에 정한 {start.kept}{start.kept === '블록' ? '을' : '를'} 가져왔습니다. 시간표가 바뀌었으면 함께 확인해 주세요.
        </div>
      )}

      {step === 0 && (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="badge">선생님 {tt.teachers.length}분</span>
            <span className="badge">반 {tt.classes.length}개</span>
            <span className="badge">수업 {kinds['수업'] ?? 0}</span>
            <span className="badge">블록 수업 {kinds['블록'] ?? 0}</span>
            <span className="badge">공강 {kinds['공강'] ?? 0}</span>
            <span className="badge">창체 {kinds['창체'] ?? 0} · 동아리 {kinds['동아리'] ?? 0}</span>
            <span className="muted small">{tt.layouts.join(' + ')} 모양으로 읽음</span>
          </div>
          {tt.warnings.map((w) => (
            <div key={w} className="note note-warn" style={{ marginBottom: 8 }}>
              {w}
            </div>
          ))}
          {hours.checked > 0 && hours.diff.length === 0 && (
            <div className="note note-ok" style={{ marginBottom: 8 }}>
              ✅ 파일에 적힌 선생님별 시수(이름 옆 괄호 숫자)와 읽은 수업 수가 <b>{hours.checked}분 모두 맞습니다.</b>
            </div>
          )}
          {hours.diff.length > 0 && (
            <div className="note note-warn" style={{ marginBottom: 8 }}>
              파일에 적힌 시수와 읽은 수업 수가 다른 선생님이 {hours.diff.length}분 있습니다(맞춰 본 {hours.checked}분 가운데). 아래에서 골라
              확인해 주세요:{' '}
              {hours.diff.slice(0, 12).map((h) => (
                <button key={h.teacher} className="link" onClick={() => setView(`t:${h.teacher}`)} style={{ marginRight: 8 }}>
                  {h.teacher} (파일 {h.expected} · 읽음 {h.read})
                </button>
              ))}
              {hours.diff.length > 12 ? `외 ${hours.diff.length - 12}분` : ''}
            </div>
          )}
          {hours.checked === 0 && (
            <p className="muted small" style={{ margin: '0 0 8px' }}>
              파일에 선생님별 시수가 적혀 있지 않아 맞춰 보지 못했습니다. 아래에서 선생님 한두 분을 골라 맞는지 봐 주세요.
            </p>
          )}

          <div className="row" style={{ marginBottom: 6 }}>
            <select value={view} onChange={(e) => setView(e.target.value)} style={{ width: 'auto', minWidth: 180 }}>
              <optgroup label="선생님">
                {tt.teachers.map((t) => (
                  <option key={t} value={`t:${t}`}>
                    {t}
                  </option>
                ))}
              </optgroup>
              <optgroup label="반">
                {tt.classes.map((c) => (
                  <option key={c.id} value={`c:${c.id}`}>
                    {c.id}
                  </option>
                ))}
              </optgroup>
            </select>
            <span className="muted small">{shown.length}줄 · 표준 자료 모두 {rows.length}줄</span>
          </div>
          <div className="tt-table-wrap">
            <table className="tt-std">
              <thead>
                <tr>
                  <th>교사</th>
                  <th>요일</th>
                  <th>교시</th>
                  <th>반</th>
                  <th>과목</th>
                  <th>블록</th>
                  <th>구분</th>
                </tr>
              </thead>
              <tbody>
                {[...shown]
                  .sort((a, b) => a.day - b.day || a.period - b.period)
                  .map((r, i) => (
                    <tr key={i} className={`k-${r.kind}`}>
                      <td>{r.teacher}</td>
                      <td>{DAY_NAMES[r.day]}</td>
                      <td>{r.period}</td>
                      <td>{r.cls}</td>
                      <td>{r.subject}</td>
                      <td>{r.block}</td>
                      <td>{r.kind}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="note note-info" style={{ marginTop: 10 }}>
            틀린 곳이 있으면 <b>[📤 표준 자료 엑셀로 저장]</b> 해서 엑셀에서 고친 뒤, <b>[시간표 파일 다시 불러오기]</b> 로 그 파일을 고르세요.
            표준 자료 모양은 학교가 달라도 그대로 읽습니다.
            {onAiRead ? ' 시간표 모양 자체를 잘못 읽었으면 [🤖 AI로 다시 읽기] 를 써 보세요.' : ''}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-sm" onClick={() => void exportStd()}>
              📤 표준 자료 엑셀로 저장
            </button>
            {onAiRead && (
              <button className="btn btn-sm" onClick={onAiRead}>
                🤖 AI로 다시 읽기
              </button>
            )}
          </div>
        </>
      )}

      {step === 1 && (
        <>
          {!hint.by && (
            <div className="note note-warn" style={{ marginBottom: 8 }}>
              이 시간표 파일에는 블록 표시(칸 색깔이나 <code>A_사문</code> 같은 묶음 글자)가 없어 블록을 찾지 못했습니다.{' '}
              <b>블록 시간을 알려 주세요.</b> 학년을 고르고 <b>[+ 블록 더하기]</b> 를 누른 뒤 그 블록의 시간 칸을 누르면 됩니다. 블록이
              없는 학교면 그대로 다음으로 넘어가세요.
            </div>
          )}
          {hint.by && (
            <p className="muted small" style={{ margin: '0 0 8px' }}>
              {hint.by}로 짐작해 칠했습니다. 학년이 다르면 다른 블록이고, 같은 학년에서도 드는 반이 다르면 따로 나눴습니다.
            </p>
          )}
          {hint.notes
            .filter((n) => n.includes('블록') || n.includes('색'))
            .map((n) => (
              <div key={n} className="note note-info" style={{ marginBottom: 8 }}>
                {n}
              </div>
            ))}
          {grid}
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
        </>
      )}

      {step === 2 && (
        <>
          <div className="note note-warn" style={{ marginBottom: 8 }}>
            <b>창체 · 동아리 시간을 꼭 표시해 주세요.</b> 이 자리로는 수업을 옮기지 않습니다.
            {missingText && (
              <>
                {' '}
                시간표 파일에 없는 교시({missingText})는 빗금 칸입니다. 교사 시간표에는 창체 · 동아리가 비어 있기 쉬우니, 그 시간이면 빗금
                칸을 눌러 표시하세요.
              </>
            )}
          </div>
          {hint.notes
            .filter((n) => n.includes('비어 있는'))
            .map((n) => (
              <div key={n} className="note note-info" style={{ marginBottom: 8 }}>
                {n}
              </div>
            ))}
          {grid}
        </>
      )}

      <div className="row row-end" style={{ marginTop: 12 }}>
        <span className="muted small" style={{ marginRight: 'auto' }}>
          블록 {draft.blocks.filter((b) => b.slots.length).length}개 · 창체 {count(draft.cce)}칸 · 동아리 {count(draft.club)}칸
        </span>
        {step > 0 && (hint.by || step === 2) && (
          <button className="btn btn-sm btn-ghost" onClick={() => void reset()}>
            파일에서 다시 짐작하기
          </button>
        )}
        {onCancel && (
          <button className="btn btn-sm" onClick={onCancel}>
            취소
          </button>
        )}
        {step > 0 && (
          <button className="btn btn-sm" onClick={() => setStep((step - 1) as Step)}>
            ← 이전
          </button>
        )}
        {step < 2 ? (
          <button
            className="btn btn-primary"
            onClick={() => {
              setStep((step + 1) as Step)
              setBrush('')
            }}
          >
            다음: {STEPS[step + 1].slice(2)} →
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? '저장하는 중…' : '✅ 이대로 정하기'}
          </button>
        )}
      </div>
    </div>
  )
}

const byKey = (a: string, b: string): number => slotOf(a)[0] - slotOf(b)[0] || slotOf(a)[1] - slotOf(b)[1]

/** 3-1 · 3-2 · 3-4 → 1·2·4반 */
const short = (cls: string[]): string => `${cls.map((c) => c.split('-')[1]).join('·')}반`

/** ["2-4","2-5","2-6","4-6"] → "수 5~7교시, 금 7교시" */
function compactSlots(tt: SchoolTimetable, keys: string[]): string {
  const byDay = new Map<number, number[]>()
  for (const k of keys) {
    const [d, p] = slotOf(k)
    if (!byDay.has(d)) byDay.set(d, [])
    byDay.get(d)!.push(p + 1)
  }
  return [...byDay]
    .map(([d, ps]) => {
      const lo = Math.min(...ps)
      const hi = Math.max(...ps)
      return `${tt.days[d]} ${lo === hi ? lo : `${lo}~${hi}`}교시`
    })
    .join(', ')
}

/** 블록 · 창체 · 동아리 설정을 한 줄로 */
export function rulesSummary(rules: TtRules): string {
  const n = (m?: Record<string, string[]>): number => Object.values(m ?? {}).reduce((s, v) => s + v.length, 0)
  return `블록 ${rules.blocks.length}개 · 창체 ${n(rules.cce)}칸 · 동아리 ${n(rules.club)}칸`
}
