import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormFillResult, FormPlan, FormRef, HwpKind } from '../../shared/hwpform'
import type { AliasPair, ModelChoice } from '../../shared/types'
import { aliasesFor } from '../lib/privacy'
import { useToast } from '../lib/toast'

interface Props {
  form: FormRef
  formName: string
  kind: HwpKind
  /** 양식에 담을 내용 */
  content: string
  /** 저장할 파일 이름의 첫 값 */
  fileName: string
  model?: ModelChoice | null
  /** 이미 정해 둔 가명. 같은 사람은 같은 가명으로 보낸다. */
  aliases?: AliasPair[]
  /** 업무 도우미 말풍선 안에 넣을 때 조금 작게 */
  compact?: boolean
}

interface Row {
  id: string
  label: string
  before: string
  text: string
  on: boolean
}

type Stage = '정하는 중' | '확인' | '저장 중' | '실패'

/**
 * AI 가 양식의 어느 자리에 무엇을 넣을지 정하고, 사람이 확인·고친 뒤 한글 파일로 저장한다.
 * [우리 학교 한글 양식] 탭과 업무 도우미가 함께 쓴다. 그릴 때 곧바로 AI 에게 묻는다.
 */
export default function FormFillCard({ form, formName, kind, content, fileName, model, aliases, compact }: Props): JSX.Element {
  const toast = useToast()
  const [stage, setStage] = useState<Stage>('정하는 중')
  const [error, setError] = useState('')
  const [plan, setPlan] = useState<FormPlan | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [name, setName] = useState(fileName)
  const [showSent, setShowSent] = useState(false)
  const [result, setResult] = useState<FormFillResult | null>(null)
  const started = useRef(false)

  const run = useCallback(async () => {
    setStage('정하는 중')
    setError('')
    try {
      const layout = await window.api.hwp.layout(form)
      if (!layout.ok) throw new Error(layout.error ?? '양식을 읽지 못했습니다.')
      const pairs = await aliasesFor(content, aliases ?? [])
      const res = await window.api.hwp.plan({ ref: form, content, aliases: pairs, model: model ?? undefined })
      setPlan(res)
      if (!res.ok) throw new Error(res.error ?? 'AI 가 자리를 정하지 못했습니다.')
      if (!res.edits.length) throw new Error('AI 가 바꿀 자리를 찾지 못했습니다. 넣을 내용을 더 자세히 적어 보세요.')
      const byId = new Map(layout.spots.map((s) => [s.id, s]))
      setRows(
        res.edits.map((e) => {
          const spot = byId.get(e.id)
          return {
            id: e.id,
            label: spot?.label || (e.id.startsWith('P') ? '본문' : e.id),
            before: spot?.text ?? '',
            text: e.text,
            on: true
          }
        })
      )
      setStage('확인')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStage('실패')
    }
    // 내용·양식이 바뀌면 부르는 쪽이 key 를 바꿔 새로 그린다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void run()
  }, [run])

  const save = async (): Promise<void> => {
    const edits = rows.filter((r) => r.on).map((r) => ({ id: r.id, text: r.text }))
    if (!edits.length) {
      toast('넣을 자리가 없습니다.', 'err')
      return
    }
    setStage('저장 중')
    try {
      const res = await window.api.hwp.save({ ref: form, edits, name })
      setResult(res)
      toast(res.message, res.ok ? 'ok' : 'err')
    } finally {
      setStage('확인')
    }
  }

  const setRow = (i: number, patch: Partial<Row>): void =>
    setRows((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  const multiLineHwp = kind === 'hwp' && rows.some((r) => r.on && r.text.includes('\n'))

  return (
    <div className={`fill-card ${compact ? 'compact' : ''}`}>
      <div className="fill-card-head">
        <b>📑 {formName}</b>
        <span className="badge">.{kind}</span>
        {stage === '확인' && rows.length > 0 && <span className="badge badge-accent">{rows.filter((r) => r.on).length}곳</span>}
      </div>

      {stage === '정하는 중' && <div className="muted small">양식의 어느 칸에 무엇을 넣을지 정하는 중…</div>}

      {stage === '실패' && (
        <div className="note note-warn">
          {error}
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn btn-sm" onClick={() => void run()}>
              다시 해 보기
            </button>
          </div>
        </div>
      )}

      {(stage === '확인' || stage === '저장 중') && rows.length > 0 && (
        <>
          <div className="muted small" style={{ marginBottom: 6 }}>
            아래 글이 양식의 각 자리에 들어갑니다. 저장하기 전에 고치거나 뺄 수 있습니다.
          </div>
          <div className="fill-rows">
            {rows.map((r, i) => (
              <div className="fill-row" key={r.id} style={{ opacity: r.on ? 1 : 0.5 }}>
                <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={r.on} onChange={(e) => setRow(i, { on: e.target.checked })} />
                  <span className="item-title">{r.label}</span>
                  <span className="muted small">{r.id}</span>
                </label>
                {r.before.trim() && (
                  <div className="muted small fill-before">
                    지금: {r.before.length > 140 ? `${r.before.slice(0, 140)}…` : r.before}
                  </div>
                )}
                <textarea
                  value={r.text}
                  onChange={(e) => setRow(i, { text: e.target.value })}
                  style={{ minHeight: r.text.includes('\n') || r.text.length > 60 ? 110 : 40 }}
                  disabled={!r.on}
                />
              </div>
            ))}
          </div>

          {plan?.leftover.trim() && (
            <div className="note note-warn" style={{ marginTop: 8 }}>
              <b>양식에 알맞은 자리가 없어 넣지 못한 내용:</b> {plan.leftover}
            </div>
          )}
          {multiLineHwp && (
            <div className="note note-warn" style={{ marginTop: 8 }}>
              .hwp 양식의 한 칸에 여러 줄을 넣으면 줄 끝의 글자 사이가 벌어져 보일 수 있습니다. 그럴 땐 한글에서 그 칸을{' '}
              <b>[왼쪽 정렬]</b> 로 바꾸거나, 양식을 <b>[다른 이름으로 저장 → HWPX]</b> 로 바꿔 넣어 두세요.
            </div>
          )}

          <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
              <label>저장할 파일 이름</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={() => void save()} disabled={stage === '저장 중'}>
              {stage === '저장 중' ? '만드는 중…' : `💾 한글 파일로 저장 (.${kind})`}
            </button>
          </div>

          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowSent((v) => !v)}>
              {showSent ? 'AI에 보낸 글 닫기' : 'AI에 보낸 글 보기'}
            </button>
          </div>
          {showSent && plan && (
            <div className="scroll-box" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>
              {plan.sentToAi}
            </div>
          )}
        </>
      )}

      {result && (
        <div className={`note ${result.ok ? 'note-ok' : 'note-warn'}`} style={{ marginTop: 10 }}>
          {result.ok ? `${result.applied}곳을 바꿔 저장했습니다.` : result.message}
          {result.path && <div className="small" style={{ marginTop: 3 }}>{result.path}</div>}
          {result.missed.length > 0 && (
            <div className="small" style={{ marginTop: 6 }}>
              <b>바꾸지 못한 자리 — 한글에서 직접 고쳐 주세요.</b>
              {result.missed.map((m) => (
                <div key={m.id}>
                  · {m.label}: {m.text.length > 60 ? `${m.text.slice(0, 60)}…` : m.text}
                </div>
              ))}
            </div>
          )}
          {result.path && (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn btn-sm btn-primary" onClick={() => void window.api.hwp.open(result.path ?? '')}>
                한글로 열기
              </button>
              <button className="btn btn-sm" onClick={() => void window.api.hwp.reveal(result.path ?? '')}>
                폴더 열기
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
