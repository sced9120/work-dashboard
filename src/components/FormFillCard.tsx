import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComposeResult, DocItem, FormRef, FrameLayout, HwpKind } from '../../shared/hwpform'
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
  /** 문서 만들기에서 고른 문서 종류와 그 문서를 쓰는 법. AI 에게 함께 알려 준다. */
  guide?: string
}

type Stage = '쓰는 중' | '확인' | '저장 중' | '실패'

interface Saved {
  ok: boolean
  message: string
  path?: string
  notes: string[]
}

/**
 * 양식을 "틀"로 새 한글 문서를 만든다.
 *
 * AI 가 양식의 구성을 따라 새 문서의 글을 쓰고(문단마다 본뜰 양식 문단이 정해져 있다),
 * 사람이 확인·고친 뒤 저장하면 양식의 글꼴·문단 모양을 입혀 한글 파일로 만든다.
 * [우리 학교 한글 양식] 탭과 업무 도우미가 함께 쓴다. 그릴 때 곧바로 AI 에게 부탁한다.
 */
export default function FormFillCard({
  form,
  formName,
  kind,
  content,
  fileName,
  model,
  aliases,
  compact,
  guide
}: Props): JSX.Element {
  const toast = useToast()
  const [stage, setStage] = useState<Stage>('쓰는 중')
  const [error, setError] = useState('')
  const [frame, setFrame] = useState<FrameLayout | null>(null)
  const [res, setRes] = useState<ComposeResult | null>(null)
  const [items, setItems] = useState<DocItem[]>([])
  const [name, setName] = useState(fileName)
  const [showSent, setShowSent] = useState(false)
  const [saved, setSaved] = useState<Saved | null>(null)
  const started = useRef(false)

  const run = useCallback(async () => {
    setStage('쓰는 중')
    setError('')
    setSaved(null)
    try {
      const layout = await window.api.hwp.frame(form)
      if (!layout.ok) throw new Error(layout.error ?? '양식을 읽지 못했습니다.')
      setFrame(layout)
      const pairs = await aliasesFor(content, aliases ?? [])
      const r = await window.api.hwp.compose({ ref: form, content, aliases: pairs, guide, model: model ?? undefined })
      setRes(r)
      if (!r.ok) throw new Error(r.error ?? 'AI 가 문서를 쓰지 못했습니다.')
      setItems(r.items)
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

  /** 문단 모양을 고를 수 있는 양식 문단들 */
  const samples = useMemo(() => (frame?.blocks ?? []).filter((b) => b.kind === 'text'), [frame])
  const blockOf = useMemo(() => new Map((frame?.blocks ?? []).map((b) => [b.id, b])), [frame])
  const tableOf = useMemo(() => new Map((frame?.tables ?? []).map((t) => [t.id, t])), [frame])

  const save = async (): Promise<void> => {
    const list = items.filter((it) => (it.kind === 'p' ? it.text.trim() : it.rows.length))
    if (!list.length) {
      toast('넣을 글이 없습니다.', 'err')
      return
    }
    setStage('저장 중')
    try {
      const r = await window.api.hwp.build({ ref: form, items: list, name })
      setSaved(r)
      toast(r.message, r.ok ? 'ok' : 'err')
    } finally {
      setStage('확인')
    }
  }

  const patch = (i: number, next: DocItem | null, insert?: DocItem): void =>
    setItems((list) => {
      const out = [...list]
      if (next) out[i] = next
      else out.splice(i, 1)
      if (insert) out.splice(next ? i + 1 : i, 0, insert)
      return out
    })

  const sampleLabel = (id: string): string => {
    if (id.startsWith('B')) return '글상자'
    const b = blockOf.get(id)
    if (!b) return '본문'
    const head = b.text.length > 16 ? `${b.text.slice(0, 16)}…` : b.text
    return `${b.style} — ${head}`
  }

  const paraRow = (it: Extract<DocItem, { kind: 'p' }>, i: number): JSX.Element => (
    <div className="compose-p" key={i}>
      <div className="compose-p-head">
        {it.sample.startsWith('B') || !samples.some((b) => b.id === it.sample) ? (
          <span className="compose-chip" title="이 문단이 본뜰 양식 모양">
            {sampleLabel(it.sample)}
          </span>
        ) : (
          <select
            className="compose-chip"
            title="이 문단이 본뜰 양식 모양"
            value={it.sample}
            onChange={(e) => patch(i, { ...it, sample: e.target.value })}
          >
            {samples.map((b) => (
              <option key={b.id} value={b.id}>
                {sampleLabel(b.id)}
              </option>
            ))}
          </select>
        )}
        <span className="spacer" />
        <button
          className="btn btn-sm btn-ghost"
          title="아래에 같은 모양의 문단 넣기"
          onClick={() => patch(i, it, { kind: 'p', sample: it.sample, text: '' })}
        >
          ＋
        </button>
        <button className="btn btn-sm btn-ghost" title="이 문단 빼기" onClick={() => patch(i, null)}>
          ✕
        </button>
      </div>
      <textarea
        value={it.text}
        rows={Math.min(8, Math.max(1, Math.ceil(it.text.length / 60)))}
        onChange={(e) => patch(i, { ...it, text: e.target.value.replace(/\n/g, ' ') })}
      />
    </div>
  )

  const tableRow = (it: Extract<DocItem, { kind: 't' }>, i: number): JSX.Element => {
    const t = tableOf.get(it.sample)
    const setCell = (r: number, c: number, v: string): void =>
      patch(i, { ...it, rows: it.rows.map((row, ri) => (ri === r ? row.map((x, ci) => (ci === c ? v : x)) : row)) })
    return (
      <div className="compose-table" key={i}>
        <div className="compose-p-head">
          <span className="compose-chip">
            표 {it.sample}
            {t?.parent ? ` (${t.parent} 안)` : ''} · {it.rows.length}행
          </span>
          <span className="spacer" />
          <button
            className="btn btn-sm btn-ghost"
            title="같은 모양의 행을 끝에 더하기"
            onClick={() => patch(i, { ...it, rows: [...it.rows, (it.rows[it.rows.length - 1] ?? ['']).map(() => '')] })}
          >
            ＋ 행
          </button>
          <button className="btn btn-sm btn-ghost" title="이 표 빼기" onClick={() => patch(i, null)}>
            ✕
          </button>
        </div>
        <div className="compose-grid">
          {it.rows.map((row, r) => (
            <div className="compose-grid-row" key={r}>
              {row.map((cell, c) => (
                <textarea
                  key={c}
                  className={t && t.rows[r]?.[c]?.trim() && t.rows[r][c].trim() === cell.trim() ? 'same' : ''}
                  title={t && t.rows[r]?.[c]?.trim() === cell.trim() && cell.trim() ? '양식 그대로인 칸' : undefined}
                  value={cell}
                  rows={Math.min(6, Math.max(1, cell.split('\n').length, Math.ceil(cell.length / 24)))}
                  onChange={(e) => setCell(r, c, e.target.value)}
                />
              ))}
              <button
                className="btn btn-sm btn-ghost"
                title="이 행 빼기"
                onClick={() => patch(i, { ...it, rows: it.rows.filter((_, ri) => ri !== r) })}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={`fill-card ${compact ? 'compact' : ''}`}>
      <div className="fill-card-head">
        <b>📑 {formName}</b>
        <span className="badge">.{kind}</span>
        {stage !== '쓰는 중' && stage !== '실패' && <span className="badge badge-accent">문단 {items.length}개</span>}
      </div>

      {stage === '쓰는 중' && <div className="muted small">양식의 구성과 모양을 따라 새 문서를 쓰는 중…</div>}

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

      {(stage === '확인' || stage === '저장 중') && (
        <>
          <div className="muted small" style={{ marginBottom: 6 }}>
            양식의 글꼴·문단 모양을 그대로 입혀 새 문서로 만듭니다. 왼쪽 위는 그 문단이 본뜰 양식 모양입니다. 저장하기 전에 글을
            고치거나, 문단을 더하고 뺄 수 있습니다.
          </div>
          <div className="fill-rows compose-list">
            {items.map((it, i) => (it.kind === 'p' ? paraRow(it, i) : tableRow(it, i)))}
          </div>

          {res?.note.trim() && (
            <div className="note" style={{ marginTop: 8 }}>
              <b>AI 메모:</b> {res.note}
            </div>
          )}
          {frame?.notes.map((n) => (
            <div className="note note-warn" style={{ marginTop: 8 }} key={n}>
              {n}
            </div>
          ))}

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
            <button className="btn btn-sm btn-ghost" onClick={() => void run()} disabled={stage === '저장 중'}>
              ↻ AI 에게 다시 쓰게 하기
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowSent((v) => !v)}>
              {showSent ? 'AI에 보낸 글 닫기' : 'AI에 보낸 글 보기'}
            </button>
          </div>
          {showSent && res && (
            <div className="scroll-box" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>
              {res.sentToAi}
            </div>
          )}
        </>
      )}

      {saved && (
        <div className={`note ${saved.ok ? 'note-ok' : 'note-warn'}`} style={{ marginTop: 10 }}>
          {saved.message}
          {saved.notes.map((n) => (
            <div className="small" style={{ marginTop: 3 }} key={n}>
              {n}
            </div>
          ))}
          {saved.path && (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn btn-sm btn-primary" onClick={() => void window.api.hwp.open(saved.path ?? '')}>
                한글로 열기
              </button>
              <button className="btn btn-sm" onClick={() => void window.api.hwp.reveal(saved.path ?? '')}>
                폴더 열기
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
