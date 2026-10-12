import { useEffect, useMemo, useRef, useState } from 'react'
import type { MdTable } from '../../shared/mdtable'
import { answersToTables, extractTables, plainCell, proseOf, toTsv } from '../../shared/mdtable'
import type { OcrAnswer, OcrFile, OcrProgress } from '../../shared/ocr'
import { OCR_DEFAULT_MODEL, fmtBytes } from '../../shared/ocr'
import { OCR_AGENT_PROMPT } from '../../shared/ocrPrompt'
import { modelsFor } from '../../shared/types'
import type { PageId } from '../App'
import Icon from '../components/Icon'
import { useCatalog } from '../lib/catalog'
import { useToast } from '../lib/toast'

interface Props {
  onGo: (p: PageId) => void
}

const MODEL_KEY = 'wd_ocr_model'
/** 화면에 미리 보여 줄 행 수 (엑셀에는 모두 들어간다) */
const PREVIEW_ROWS = 200

/**
 * 스캔 문서 → 엑셀 (OCR). 스캔한 PDF · 사진을 사용자의 Gemini 키로 보내 원문 그대로 표로 받고 엑셀로 저장한다.
 * 받은 결과는 저장하지 않는다(이 화면을 떠나면 사라진다). 실제 일은 electron/main/ocr.ts.
 */
export default function Ocr({ onGo }: Props): JSX.Element {
  const toast = useToast()
  const remote = useCatalog().catalog.ocr
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [models, setModels] = useState<string[]>([OCR_DEFAULT_MODEL])
  const [model, setModel] = useState('')
  const [files, setFiles] = useState<OcrFile[]>([])
  const [note, setNote] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<OcrProgress | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [answers, setAnswers] = useState<OcrAnswer[]>([])
  const [error, setError] = useState('')
  const [showRaw, setShowRaw] = useState(false)
  const started = useRef(0)

  useEffect(() => {
    void (async () => {
      const s = await window.api.local.load()
      setHasKey(!!s.gemini_key?.trim())
      const list = modelsFor('gemini', s.custom_models, s.hidden_models)
      setModels([...new Set([OCR_DEFAULT_MODEL, ...list])])
    })()
    const off = window.api.ocr.onProgress((p) => setProgress(p))
    // 화면을 떠나면 Gemini 에 올려 둔 파일을 지운다
    return () => {
      off()
      void window.api.ocr.clear()
    }
  }, [])

  // 만든이가 정한 기본 모델 → 이 PC 에서 마지막으로 고른 모델
  useEffect(() => {
    if (model) return
    let saved = ''
    try {
      saved = window.localStorage.getItem(MODEL_KEY) || ''
    } catch {
      // 기억 못 해도 기본 모델로
    }
    setModel(saved || remote.model || OCR_DEFAULT_MODEL)
  }, [remote.model, model])

  useEffect(() => {
    if (!busy) return
    const t = window.setInterval(() => setSeconds(Math.round((Date.now() - started.current) / 1000)), 1000)
    return () => window.clearInterval(t)
  }, [busy])

  const text = answers.map((a) => a.text).join('\n\n')
  const tables = useMemo<MdTable[]>(() => answersToTables(answers), [answers])
  const lead = useMemo(() => (answers[0] ? proseOf(answers[0].text).split('\n').find((l) => l.trim()) ?? '' : ''), [answers])
  const last = answers[answers.length - 1]
  const rowCount = tables.reduce((n, t) => n + t.rows.length, 0)
  const usage = answers.reduce((u, a) => ({ input: u.input + (a.usage?.input ?? 0), output: u.output + (a.usage?.output ?? 0) }), { input: 0, output: 0 })

  const pick = async (): Promise<void> => {
    const got = await window.api.ocr.pick()
    if (!got.length) return
    setFiles((cur) => [...cur, ...got.filter((g) => !cur.some((c) => c.name === g.name && c.size === g.size))])
  }

  const begin = (): void => {
    setBusy(true)
    setError('')
    setProgress(null)
    setSeconds(0)
    started.current = Date.now()
  }

  const run = async (): Promise<void> => {
    begin()
    setAnswers([])
    setShowRaw(false)
    try {
      const a = await window.api.ocr.run({ ids: files.map((f) => f.id), note, model })
      if (!a.ok) {
        setError(a.error ?? '읽지 못했습니다.')
        return
      }
      setAnswers([a])
      if (!extractTables(a.text).length) toast('표 모양으로 받지 못했습니다. 아래 [받은 글 보기] 에서 확인해 주세요.', 'err')
    } finally {
      setBusy(false)
    }
  }

  const more = async (): Promise<void> => {
    begin()
    try {
      const a = await window.api.ocr.continue()
      if (!a.ok) {
        setError(a.error ?? '이어 받지 못했습니다.')
        return
      }
      setAnswers((cur) => [...cur, a])
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    const title = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : tables[0]?.title || ''
    const r = await window.api.ocr.save(tables, title)
    if (r.message !== '취소했습니다.') toast(r.message, r.ok ? 'ok' : 'err')
  }

  const copy = async (): Promise<void> => {
    await window.api.clipboard.write(tables.map(toTsv).join('\n\n'))
    toast('표를 복사했습니다. 엑셀 · 한글 표에 그대로 붙여 넣을 수 있습니다.', 'ok')
  }

  const status = !progress
    ? '보내는 중…'
    : progress.phase === 'upload'
      ? `큰 파일을 Gemini 에 올리는 중… (${progress.chars + 1}/${progress.rows})`
      : progress.phase === 'wait'
        ? 'Gemini 가 문서를 읽는 중…'
        : `받는 중 — 표 ${progress.rows}줄 · ${progress.chars.toLocaleString()}자`

  return (
    <>
      <div className="page-head">
        <h1>스캔 문서 → 엑셀</h1>
        <p>
          스캔한 PDF · 사진을 Gemini 가 <b>글자 그대로</b> 읽어 표로 만들고, 엑셀 파일로 저장합니다. 요약하지 않고, 취소선으로 지운 글은
          빼고, 헷갈리는 글자는 [불확실: …] 로 남깁니다. 설정에 넣어 둔 <b>내 Gemini API 키</b>를 씁니다.
        </p>
      </div>

      {hasKey === false && (
        <div className="note note-warn ocr-nokey">
          Gemini API 키가 없습니다. [설정 → AI 연결] 에서 Gemini 키를 넣으면 쓸 수 있습니다(다른 AI 를 쓰고 있어도 이 기능은 Gemini 키로
          동작합니다).{' '}
          <button className="btn btn-sm" onClick={() => onGo('설정')}>
            설정으로
          </button>
        </div>
      )}

      <div className="ocr-grid">
        <div className="card">
          <div className="card-title">
            <span>1. 읽을 파일</span>
            {files.length > 0 && <span className="badge">{files.length}개 · {fmtBytes(files.reduce((n, f) => n + f.size, 0))}</span>}
          </div>
          <div className="row">
            <button className="btn btn-primary btn-sm" onClick={() => void pick()} disabled={busy}>
              <Icon name="plus" size={14} /> 파일 고르기
            </button>
            {files.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={() => setFiles([])} disabled={busy}>
                모두 빼기
              </button>
            )}
          </div>
          {files.length > 0 ? (
            <ul className="ocr-files">
              {files.map((f) => (
                <li key={f.id}>
                  <span className="ocr-file-kind">{f.mime === 'application/pdf' ? 'PDF' : '사진'}</span>
                  <span className="ocr-file-name">{f.name}</span>
                  <small>{fmtBytes(f.size)}</small>
                  <button className="btn btn-ghost btn-sm" onClick={() => setFiles(files.filter((x) => x.id !== f.id))} disabled={busy} aria-label={`${f.name} 빼기`}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">PDF · PNG · JPG · WEBP · HEIC. 여러 개를 고르면 이름 차례로 한 표에 모아 읽습니다(PDF 50MB · 사진 20MB 까지).</p>
          )}
        </div>

        <div className="card">
          <div className="card-title">2. 어떻게 읽을까요</div>
          <div className="field">
            <label>추가 요청 (선택)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="예: 학번 순으로 정렬해 주세요 / 영어 본문만 / 마지막 쪽 표는 빼 주세요"
              disabled={busy}
            />
          </div>
          <div className="field">
            <label>Gemini 모델</label>
            <select value={model} onChange={(e) => {
              setModel(e.target.value)
              try {
                window.localStorage.setItem(MODEL_KEY, e.target.value)
              } catch {
                // 이번에만
              }
            }} disabled={busy} style={{ width: 'auto', minWidth: 220 }}>
              {[...new Set([model, ...models])].filter(Boolean).map((m) => (
                <option key={m} value={m}>
                  {m}
                  {m === (remote.model || OCR_DEFAULT_MODEL) ? ' (권장)' : ''}
                </option>
              ))}
            </select>
            <div className="hint">그림을 높은 해상도로 보고(High-Res), 생각은 짧게, 검색 · 도구는 쓰지 않습니다.</div>
          </div>
          <details className="neis-howto">
            <summary>읽는 지침 보기</summary>
            <pre className="ocr-prompt">{remote.prompt || OCR_AGENT_PROMPT}</pre>
          </details>
        </div>
      </div>

      <div className="card ocr-send">
        <div className="note note-danger small" style={{ marginBottom: 10 }}>
          <b>보내는 것:</b> 고른 파일 <b>원본 그대로</b>(학생 이름 · 학번 · 글씨 모두)를 내 Gemini 키로 Google 에 보냅니다. 사진 속 글자라 미리
          가릴 수 없습니다.
          <br />
          무료 등급 키로 보낸 내용은 Google 이 서비스 개선에 쓰고 사람이 볼 수도 있습니다. 학생 자료는 <b>결제를 켠(유료 등급) 키</b>를 쓰고, 학교
          · 교육청의 생성형 AI 지침을 먼저 확인하세요. 받은 결과는 이 프로그램에 저장하지 않습니다.
        </div>
        <label className="ocr-agree">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} disabled={busy} />
          위 내용을 확인했고, 이 파일을 Gemini 로 보내도 됩니다
        </label>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn-primary" onClick={() => void run()} disabled={busy || !files.length || !agree || !hasKey}>
            {busy ? '읽는 중…' : '🔎 읽어서 표로 만들기'}
          </button>
          {busy && (
            <>
              <span className="small">
                {status} · {seconds}초
              </span>
              <button className="btn btn-sm btn-ghost" onClick={() => void window.api.ocr.cancel()}>
                멈추기
              </button>
            </>
          )}
        </div>
        {busy && <p className="hint">쪽수가 많으면 몇 분 걸릴 수 있습니다. 다른 화면으로 가면 멈춥니다.</p>}
        {error && <div className="note note-warn" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      {answers.length > 0 && (
        <div className="card ocr-result">
          <div className="card-title">
            <span>3. 결과</span>
            <span className="badge">
              표 {tables.length}개 · {rowCount}행
            </span>
            {usage.output > 0 && <span className="muted small">사용량 · 보냄 {usage.input.toLocaleString()} · 받음 {usage.output.toLocaleString()} 토큰</span>}
          </div>
          {lead && <p className="small muted" style={{ marginTop: 0 }}>{lead.replace(/^>\s*/, '').replace(/\*\*/g, '')}</p>}
          {last?.truncated && (
            <div className="note note-warn" style={{ marginBottom: 10 }}>
              답이 길어 중간에서 끊겼습니다. 이어서 받으면 마지막 행 다음부터 같은 표에 붙입니다.{' '}
              <button className="btn btn-sm btn-primary" onClick={() => void more()} disabled={busy}>
                이어서 받기
              </button>
            </div>
          )}
          <div className="row" style={{ marginBottom: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={!tables.length || busy}>
              📥 엑셀로 저장
            </button>
            <button className="btn btn-sm" onClick={() => void copy()} disabled={!tables.length || busy}>
              📋 표 복사
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowRaw(!showRaw)}>
              {showRaw ? '받은 글 닫기' : '받은 글 보기'}
            </button>
            <span className="muted small">결과는 이 화면에만 있습니다 — 엑셀로 저장하지 않으면 사라집니다.</span>
          </div>
          {showRaw && <pre className="ocr-raw">{text}</pre>}
          {tables.map((t, ti) => (
            <div className="ocr-table-wrap" key={ti}>
              {(t.title || tables.length > 1) && <div className="ocr-table-title">{t.title || `표 ${ti + 1}`}</div>}
              <div className="ocr-scroll">
                <table className="ocr-table">
                  <thead>
                    <tr>
                      {t.header.map((h, i) => (
                        <th key={i}>{plainCell(h)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.slice(0, PREVIEW_ROWS).map((r, ri) => (
                      <tr key={ri}>
                        {t.header.map((_, ci) => (
                          <td key={ci} className={/\[(불확실|판독 불가)/.test(r[ci] ?? '') ? 'ocr-doubt' : ''}>
                            {plainCell(r[ci] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {t.rows.length > PREVIEW_ROWS && <p className="hint">… {t.rows.length - PREVIEW_ROWS}행 더 있습니다(엑셀에는 모두 들어갑니다).</p>}
            </div>
          ))}
          {tables.some((t) => t.rows.some((r) => r.some((c) => /\[(불확실|판독 불가)/.test(c)))) && (
            <p className="hint">노랗게 칠한 칸은 Gemini 가 [불확실] · [판독 불가] 로 표시한 곳입니다. 원본과 맞춰 고쳐 주세요.</p>
          )}
        </div>
      )}
    </>
  )
}
