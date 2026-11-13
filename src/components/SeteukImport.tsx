import { useEffect, useMemo, useRef, useState } from 'react'
import { answersToTables } from '../../shared/mdtable'
import { fmtBytes } from '../../shared/ocr'
import type { OcrAnswer, OcrFile } from '../../shared/ocr'
import { SETEUK_OCR_NOTE, matchNotes, sheetFromPaste, studentLabel } from '../../shared/seteuk'
import type { SeteukImport as Found, SeteukImportHit, SeteukSheet, SeteukStudent } from '../../shared/seteuk'
import { POINTS_MIN_CHARS } from '../../shared/seteukExport'
import { useToast } from '../lib/toast'

/**
 * 세특 작성실 — 관찰 기록 가져오기.
 * 스캔한 활동지 · 사진은 [문서 스캔 · 정리] 와 같은 길(내 Gemini · OpenAI 키)로 읽어 학생마다 한 행인 표로 받고,
 * 엑셀에서 복사한 표는 AI 없이 바로 읽는다. 어느 쪽이든 명단과 맞춘 것을 먼저 보여 주고, 눌러야 관찰 기록에 넣는다.
 */

/** 스캔 읽기에 쓰는 탭 이름 — [문서 스캔 · 정리] 의 탭과 따로 읽는다 */
const TAB = 'seteuk'
/** 답이 길어 끊기면 이만큼까지 이어 받는다 */
const MAX_MORE = 6

interface Props {
  /** 지금 표에 보이는 학생 (반을 골랐으면 그 반만) — 이 안에서 맞춘다 */
  students: SeteukStudent[]
  onApply: (hits: SeteukImportHit[]) => void
  onClose: () => void
}

type Mode = 'scan' | 'paste'

export default function SeteukImport({ students, onApply, onClose }: Props): JSX.Element {
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('scan')
  const [files, setFiles] = useState<OcrFile[]>([])
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState(0)
  const [error, setError] = useState('')
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [sheets, setSheets] = useState<SeteukSheet[] | null>(null)
  const [paste, setPaste] = useState('')
  const [points, setPoints] = useState(false)
  const [shrinking, setShrinking] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    void (async () => {
      const s = await window.api.local.load()
      setHasKey(!!s.gemini_key?.trim() || !!s.openai_key?.trim())
    })()
    const off = window.api.ocr.onProgress((p) => {
      if (p.tab === TAB) setRows(p.rows)
    })
    return () => {
      alive.current = false
      off()
      // 읽던 것을 멈추고, 올려 둔 파일을 지운다
      void window.api.ocr.clear(TAB)
    }
  }, [])

  const pasted = useMemo(() => (mode === 'paste' ? sheetFromPaste(paste) : null), [mode, paste])
  const found: Found | null = useMemo(() => {
    const src = mode === 'paste' ? (pasted ? [pasted] : null) : sheets
    return src ? matchNotes(src, students) : null
  }, [mode, pasted, sheets, students])

  const pick = async (): Promise<void> => {
    const got = await window.api.ocr.pick()
    if (got.length) setFiles((prev) => [...prev, ...got])
  }

  const read = async (): Promise<void> => {
    if (busy || !files.length || !agree) return
    setBusy(true)
    setError('')
    setRows(0)
    setSheets(null)
    const answers: OcrAnswer[] = []
    try {
      let a = await window.api.ocr.run({ tab: TAB, ids: files.map((f) => f.id), note: SETEUK_OCR_NOTE, model: '' })
      for (let k = 0; ; k++) {
        if (!a.ok) {
          if (!answers.length) throw new Error(a.error ?? '읽지 못했습니다.')
          break
        }
        answers.push(a)
        if (!a.truncated || k >= MAX_MORE) break
        a = await window.api.ocr.continue(TAB)
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e))
    }
    void window.api.ocr.clear(TAB)
    if (!alive.current) return
    setBusy(false)
    if (!answers.length) return
    const tables = answersToTables(answers)
    setSheets(tables)
    if (!tables.length) setError('표를 받지 못했습니다. 파일이 선명한지 보고 다시 읽어 주세요.')
    else if (answers[answers.length - 1].truncated) setError('답이 길어 끝까지 받지 못했습니다. 받은 데까지만 보여 드립니다 — 파일을 나눠 다시 읽어 주세요.')
  }

  const longs = found ? found.hits.filter((h) => h.text.trim().length >= POINTS_MIN_CHARS).length : 0

  const apply = async (): Promise<void> => {
    if (!found?.hits.length || shrinking) return
    let hits = found.hits
    let failed = 0
    if (points && longs) {
      setShrinking(true)
      try {
        const r = await window.api.seteuk.points(
          hits.map((h) => ({ id: h.id, text: h.text })),
          null
        )
        const byId = new Map(r.out.map((o) => [o.id, o]))
        failed = r.out.filter((o) => o.error).length
        hits = hits.map((h) => ({ ...h, text: byId.get(h.id)?.text ?? h.text }))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setShrinking(false)
        return
      }
      if (!alive.current) return
      setShrinking(false)
    }
    onApply(hits)
    toast(
      `${hits.length}명의 관찰 기록에 넣었습니다.` +
        (points && longs ? ` 긴 글 ${longs - failed}편은 요점만 넣었습니다.` : '') +
        (failed ? ` ${failed}편은 요점을 뽑지 못해 원문을 넣었습니다.` : '') +
        (found.misses.length ? ` 맞추지 못한 ${found.misses.length}줄은 넣지 않았습니다.` : ''),
      failed ? 'err' : 'ok'
    )
    onClose()
  }

  const short = (t: string): string => {
    const one = t.replace(/\s+/g, ' ')
    return one.length > 70 ? one.slice(0, 70) + '…' : one
  }

  return (
    <div className="stk-panel stk-import">
      <div className="stk-import-head">
        <div className="memo-filter" role="radiogroup" aria-label="가져올 곳">
          <button role="radio" aria-checked={mode === 'scan'} className={mode === 'scan' ? 'on' : ''} onClick={() => setMode('scan')} disabled={busy}>
            스캔 · 사진에서
          </button>
          <button role="radio" aria-checked={mode === 'paste'} className={mode === 'paste' ? 'on' : ''} onClick={() => setMode('paste')} disabled={busy}>
            엑셀 표 붙여넣기
          </button>
        </div>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          닫기
        </button>
      </div>

      {mode === 'scan' ? (
        <>
          <p className="small">
            학생이 쓴 활동지 · 소감문 · 관찰 기록지를 스캔한 PDF 나 사진을 고르면, 학생마다 한 줄로 읽어 명단과 맞춥니다. 번호나
            이름이 적혀 있어야 맞출 수 있습니다.
          </p>
          <div className="row">
            <button className="btn btn-sm" onClick={() => void pick()} disabled={busy}>
              파일 고르기
            </button>
            {files.length > 0 && (
              <button className="btn btn-sm btn-ghost" onClick={() => setFiles([])} disabled={busy}>
                모두 빼기
              </button>
            )}
            <span className="small muted">PDF · JPG · PNG · HEIC, 여러 개 고를 수 있습니다</span>
          </div>
          {files.length > 0 && (
            <ul className="stk-files small">
              {files.map((f) => (
                <li key={f.id}>
                  {f.name} <span className="muted">{fmtBytes(f.size)}</span>
                  <button className="link" onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))} disabled={busy} aria-label={`${f.name} 빼기`}>
                    빼기
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hasKey === false ? (
            <p className="note note-warn small">
              스캔 · 사진은 Gemini 나 OpenAI 키가 있어야 읽습니다(K-EXAONE 은 글만 읽습니다). [설정 → AI 연결] 에서 키를 넣어 주세요.
            </p>
          ) : (
            <>
              <div className="note note-danger small">
                <b>보내는 것:</b> 고른 파일 <b>원본 그대로</b>(학생 이름 · 학번 · 글씨 모두)를 내 Gemini(없으면 OpenAI) 키로 보냅니다. 사진 속
                글자라 미리 가릴 수 없습니다. 학교 · 교육청의 생성형 AI 지침을 먼저 확인하고, 학생 자료는 결제를 켠 키를 쓰세요.
                초안을 받을 때와 달리 이름이 그대로 갑니다.
              </div>
              <label className="stk-agree small">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} disabled={busy} />위 내용을 확인했고, 이 파일을 보내도
                됩니다
              </label>
              <div className="row">
                {busy ? (
                  <>
                    <button className="btn btn-sm" onClick={() => void window.api.ocr.cancel(TAB)}>
                      멈추기
                    </button>
                    <span className="small muted" role="status">
                      읽는 중… {rows ? `${rows}줄 받음` : '쪽수가 많으면 몇 분 걸립니다'}
                    </span>
                  </>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={() => void read()} disabled={!files.length || !agree}>
                    읽어서 명단과 맞추기
                  </button>
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <p className="small">
            엑셀에 적어 둔 관찰 기록을 <b>번호(또는 이름)와 내용 칸</b>이 함께 들어가게 끌어 복사해 붙여 넣으세요. 머리줄(반 · 번호 ·
            이름 · 학번)이 있으면 그 자리를 따릅니다. AI 로 보내지 않습니다.
          </p>
          <textarea className="stk-roster" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'번호\t이름\t내용\n1\t이름\t발표에서 …'} aria-label="관찰 기록 표 붙여넣기" />
          {paste.trim() && !pasted && <p className="note note-warn small">칸이 하나뿐입니다. 번호나 이름 칸을 함께 복사해 주세요.</p>}
        </>
      )}

      {error && <p className="note note-danger small">{error}</p>}

      {found && (
        <div className="stk-found">
          <p className="small">
            <b>명단과 맞춘 학생 {found.hits.length}명</b>
            {found.misses.length > 0 && <span className="stk-over"> · 맞추지 못한 줄 {found.misses.length}</span>}
            <span className="muted"> — 지금 표에 보이는 {students.length}명 안에서 맞춥니다. 번호만 있는 자료는 반을 먼저 고르세요.</span>
          </p>
          {found.hits.length > 0 && (
            <ul className="stk-found-list small">
              {found.hits.map((h) => {
                const s = students.find((x) => x.id === h.id)
                return (
                  <li key={h.id}>
                    <b>{s ? `${studentLabel(s)} ${s.name}` : h.id}</b> {short(h.text)}
                  </li>
                )
              })}
            </ul>
          )}
          {found.misses.length > 0 && (
            <details className="small">
              <summary>맞추지 못한 줄 보기</summary>
              <ul className="stk-found-list">
                {found.misses.map((m, i) => (
                  <li key={i}>
                    <b>{m.label}</b> {short(m.text)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {longs > 0 && (
            <label className="stk-points small">
              <input type="checkbox" checked={points} onChange={(e) => setPoints(e.target.checked)} disabled={shrinking} />
              <span>
                <b>긴 글 {longs}편은 AI 로 요점만 뽑아 넣기</b>
                <span className="muted">
                  {' '}
                  — 보고서 · 소감문처럼 {POINTS_MIN_CHARS}자가 넘는 글에서 주제 · 직접 한 과정 · 결론만 3~6줄로 줄입니다. 이름은 가려서 보내고, 글에 없는 내용은
                  만들지 않습니다.
                </span>
              </span>
            </label>
          )}
          <div className="row">
            <button className="btn btn-primary btn-sm" onClick={() => void apply()} disabled={!found.hits.length || shrinking}>
              {shrinking ? '요점 뽑는 중…' : `${found.hits.length}명의 관찰 기록에 넣기`}
            </button>
            <span className="small muted">이미 적힌 관찰 기록은 지우지 않고 뒤에 줄을 바꿔 붙입니다.</span>
          </div>
        </div>
      )}
    </div>
  )
}
