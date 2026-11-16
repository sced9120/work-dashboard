import { useEffect, useState } from 'react'
import type { ModelChoice } from '../../shared/types'
import { EMPTY_REF, GIANMUN_KINDS, extractRef, gianmunKind, type GianmunKindId, type GianmunRef } from '../../shared/gianmun'
import { useToast } from '../lib/toast'
import ModelPicker from './ModelPicker'

interface Props {
  /** 보관된 공문(문서) 번호 */
  docId: number
  /** 화면에 보일 공문 이름 */
  docName?: string
  onClose?: () => void
}

/**
 * 받은 공문으로 기안문 쓰기 — 보관된 공문 한 건을 근거로 AI 가 기안문 초안을 쓴다.
 * 공문 속 이름 · 연락처는 가린 채 보낸다.
 */
export default function GianmunCard({ docId, docName, onClose }: Props): JSX.Element {
  const toast = useToast()
  const [kind, setKind] = useState<GianmunKindId>('reply')
  const [ref, setRef] = useState<GianmunRef>(EMPTY_REF)
  const [extra, setExtra] = useState('')
  const [model, setModel] = useState<ModelChoice | null>(null)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [savedPath, setSavedPath] = useState('')

  useEffect(() => {
    let live = true
    void window.api.docs.get(docId).then((d) => {
      if (live && d) setRef(extractRef(d.content))
    })
    return () => {
      live = false
    }
  }, [docId])

  const setField = (k: keyof GianmunRef, v: string): void => setRef((r) => ({ ...r, [k]: v }))

  const make = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setSavedPath('')
    try {
      const r = await window.api.gianmun.draft({ docId, kind, ref, extra, model })
      if (r.ok) setText(r.text)
      else setError(r.error || '기안문을 만들지 못했습니다.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const copy = async (): Promise<void> => {
    await window.api.clipboard.write(text)
    toast('복사했습니다. 한글에 붙여 넣으세요.', 'ok')
  }

  const save = async (): Promise<void> => {
    const name = text.split('\n')[0]?.trim() || ref.title || '기안문'
    const r = await window.api.gianmun.save({ name, text })
    if (r.ok && r.path) {
      setSavedPath(r.path)
      toast(r.message, 'ok')
    } else if (r.message !== '저장을 취소했습니다.') {
      toast(r.message, 'err')
    }
  }

  const k = gianmunKind(kind)

  return (
    <div className="gianmun-card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <b>기안문 쓰기{docName ? ` — ${docName}` : ''}</b>
        {onClose && (
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            닫기
          </button>
        )}
      </div>

      <div className="field" style={{ marginTop: 10 }}>
        <label>기안 종류</label>
        <div className="tabs" role="radiogroup" aria-label="기안 종류">
          {GIANMUN_KINDS.map((x) => (
            <button
              key={x.id}
              role="radio"
              aria-checked={kind === x.id}
              className={`tab ${kind === x.id ? 'active' : ''}`}
              onClick={() => setKind(x.id)}
              disabled={busy}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>
          {k.desc}
        </div>
      </div>

      <div className="field">
        <label>관련 공문 정보 (공문에서 찾아 채웠습니다. 틀리면 고치세요)</label>
        <div className="gianmun-ref">
          <input value={ref.org} onChange={(e) => setField('org', e.target.value)} placeholder="발신 기관 (예: ○○교육청)" disabled={busy} />
          <input value={ref.docNo} onChange={(e) => setField('docNo', e.target.value)} placeholder="문서번호 (예: 교육과-1234)" disabled={busy} />
          <input value={ref.date} onChange={(e) => setField('date', e.target.value)} placeholder="시행일자 (예: 2026. 3. 5.)" disabled={busy} />
          <input value={ref.title} onChange={(e) => setField('title', e.target.value)} placeholder="공문 제목" disabled={busy} />
        </div>
      </div>

      <div className="field">
        <label>추가로 쓸 내용 (일정 · 예산 · 대상 등 — 적지 않은 것은 ○○ 로 비워 둡니다)</label>
        <textarea
          rows={3}
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="예: 4월 둘째 주 수요일, 3학년 전체, 예산 없음"
          disabled={busy}
        />
      </div>

      <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <ModelPicker feature="scenario" label="쓸 모델" onReady={setModel} onChange={setModel} />
        <button className="btn btn-primary" onClick={() => void make()} disabled={busy}>
          {busy ? '만드는 중…' : text ? '다시 만들기' : '기안문 만들기'}
        </button>
      </div>

      {error && (
        <div className="note note-danger" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}

      {text && (
        <div className="field" style={{ marginTop: 12 }}>
          <label>기안문 초안 (여기서 바로 고칠 수 있습니다)</label>
          <textarea
            className="gianmun-text"
            rows={16}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setSavedPath('')
            }}
          />
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => void copy()}>
              복사
            </button>
            <button className="btn btn-sm" onClick={() => void save()}>
              한글로 저장
            </button>
            {savedPath && (
              <button className="btn btn-sm btn-ghost" onClick={() => void window.api.hwp.open(savedPath)}>
                열기
              </button>
            )}
          </div>
        </div>
      )}

      <div className="small muted" style={{ marginTop: 8 }}>
        AI 초안입니다. 날짜 · 예산 · 대상 · 붙임을 확인하고 학교 기안 양식에 맞춰 고쳐 쓰세요.
      </div>
    </div>
  )
}
