import { useCallback, useEffect, useState } from 'react'
import type { DocKind, ExtractedDoc, TaskDraft } from '../../shared/types'
import type { PageId } from '../App'
import { useToast } from '../lib/toast'

interface Props {
  jobTitle: string
  onGo: (p: PageId) => void
}

interface FileRow {
  path: string
  name: string
  state: '대기' | '읽는 중' | '읽음' | '실패'
  doc?: ExtractedDoc
}

export default function Learn({ jobTitle, onGo }: Props): JSX.Element {
  const toast = useToast()
  const [kind, setKind] = useState<DocKind>('길라잡이/매뉴얼')
  const [files, setFiles] = useState<FileRow[]>([])
  const [drafts, setDrafts] = useState<TaskDraft[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [done, setDone] = useState(0)
  const [hasKey, setHasKey] = useState(true)
  const [preview, setPreview] = useState<string | null>(null)
  const [keepOriginal, setKeepOriginal] = useState(true)

  useEffect(() => {
    void (async () => {
      const s = await window.api.local.load()
      setHasKey(s.provider === 'openai' ? !!s.openai_key : !!s.gemini_key)
    })()
  }, [])

  useEffect(() => window.api.ai.onProgress((msg) => setProgress(msg)), [])

  const pick = useCallback(async () => {
    const picked = await window.api.files.pick()
    if (!picked.length) return

    const rows: FileRow[] = picked.map((p) => ({ ...p, state: '대기' }))
    setFiles((prev) => [...prev, ...rows])

    for (const row of rows) {
      setFiles((prev) => prev.map((f) => (f.path === row.path ? { ...f, state: '읽는 중' } : f)))
      const doc = await window.api.files.extract(row.path)
      setFiles((prev) =>
        prev.map((f) =>
          f.path === row.path ? { ...f, doc, state: doc.error ? '실패' : '읽음' } : f
        )
      )
    }
  }, [])

  const analyze = async (): Promise<void> => {
    const ready = files.filter((f) => f.state === '읽음' && f.doc)
    if (!ready.length) {
      toast('먼저 읽을 수 있는 문서를 올려 주세요.', 'err')
      return
    }

    setBusy(true)
    setDone(0)
    const collected: TaskDraft[] = []

    for (let i = 0; i < ready.length; i++) {
      const f = ready[i]
      setProgress(`${f.name} 분석 중`)
      const res = await window.api.ai.analyze({
        filename: f.name,
        text: f.doc!.text,
        kind,
        jobTitle
      })
      if (!res.ok) {
        toast(`${f.name}: ${res.error}`, 'err')
      } else if (res.drafts.length === 0) {
        toast(`${f.name}: 업무로 뽑을 내용을 찾지 못했습니다.`, 'err')
      }
      collected.push(...res.drafts)
      setDone(i + 1)
    }

    setDrafts((prev) => [...prev, ...collected])
    setProgress('')
    setBusy(false)
    if (collected.length) toast(`${collected.length}건을 찾았습니다. 확인 후 등록해 주세요.`, 'ok')
  }

  /**
   * 읽어 둔 원문을 보관함에 넣고, 파일명 → 문서 id 를 돌려준다.
   * 나중에 [통합 검색]에서 공문 자체를 찾을 수 있게 하려는 것이다.
   */
  const storeOriginals = async (): Promise<Map<string, number>> => {
    const map = new Map<string, number>()
    if (!keepOriginal) return map

    for (const f of files) {
      if (f.state !== '읽음' || !f.doc?.text) continue
      const id = await window.api.docs.add({
        filename: f.name,
        doc_kind: kind,
        doc_date: await window.api.docs.guessDate(f.doc.text),
        added_at: '',
        content: f.doc.text
      })
      map.set(f.name, id)
    }
    return map
  }

  const registerSelected = async (): Promise<void> => {
    const chosen = drafts.filter((d) => d.selected)
    if (!chosen.length) {
      toast('등록할 항목을 선택해 주세요.', 'err')
      return
    }
    const docIds = await storeOriginals()

    for (const d of chosen) {
      await window.api.tasks.add({
        title: d.title,
        task_date_display: d.task_date_display,
        task_date_raw: d.task_date_raw,
        task_type: kind,
        workflow: d.workflow,
        draft_full: d.draft_full,
        key_points: d.key_points,
        filename: d.filename,
        is_completed: 0,
        document_id: docIds.get(d.filename) ?? 0
      })
    }
    setDrafts([])
    setFiles([])
    toast(
      docIds.size
        ? `${chosen.length}건을 등록하고, 공문 원문 ${docIds.size}건을 보관했습니다.`
        : `${chosen.length}건을 등록했습니다.`,
      'ok'
    )
    onGo('로드맵')
  }

  const saveRawAsTask = async (f: FileRow): Promise<void> => {
    if (!f.doc) return

    let docId = 0
    if (keepOriginal && f.doc.text) {
      docId = await window.api.docs.add({
        filename: f.name,
        doc_kind: kind,
        doc_date: await window.api.docs.guessDate(f.doc.text),
        added_at: '',
        content: f.doc.text
      })
    }

    await window.api.tasks.add({
      title: f.name.replace(/\.[^.]+$/, ''),
      task_date_display: '수시',
      task_date_raw: '',
      task_type: 'AI 없이 등록',
      workflow: '',
      draft_full: f.doc.text,
      key_points: '',
      filename: f.name,
      is_completed: 0,
      document_id: docId
    })
    toast('문서 내용을 그대로 등록했습니다.', 'ok')
  }

  /** AI 분석 없이 원문만 검색용으로 보관한다. */
  const archiveOnly = async (): Promise<void> => {
    const ready = files.filter((f) => f.state === '읽음' && f.doc?.text)
    if (!ready.length) {
      toast('먼저 읽을 수 있는 문서를 올려 주세요.', 'err')
      return
    }
    for (const f of ready) {
      await window.api.docs.add({
        filename: f.name,
        doc_kind: kind,
        doc_date: await window.api.docs.guessDate(f.doc!.text),
        added_at: '',
        content: f.doc!.text
      })
    }
    setFiles([])
    toast(`${ready.length}건을 보관했습니다. [통합 검색]에서 찾을 수 있습니다.`, 'ok')
    onGo('검색')
  }

  const readyCount = files.filter((f) => f.state === '읽음').length

  return (
    <>
      <div className="page-head">
        <h1>문서로 업무 만들기</h1>
        <p>
          업무 길라잡이나 공문을 올리면 AI가 업무 목록으로 정리합니다. 등록 전에 직접 확인하고 고칠
          수 있습니다.
        </p>
      </div>

      {!hasKey && (
        <div className="note note-warn" style={{ marginBottom: 14 }}>
          API 키가 없어 AI 분석은 쓸 수 없습니다. 문서를 올려 내용을 확인하고 그대로 등록하는 것은
          가능합니다.{' '}
          <button className="link" onClick={() => onGo('설정')}>
            설정에서 키 넣기
          </button>
        </div>
      )}

      <div className="card">
        <div className="card-title">1. 문서 종류 고르기</div>
        <div className="row">
          {(['길라잡이/매뉴얼', '개별 공문'] as DocKind[]).map((k) => (
            <button
              key={k}
              className={`btn ${kind === k ? 'btn-primary' : ''}`}
              onClick={() => setKind(k)}
            >
              {k === '길라잡이/매뉴얼' ? '📚 길라잡이 · 매뉴얼' : '📃 개별 공문'}
            </button>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          {kind === '길라잡이/매뉴얼'
            ? '문서 안의 모든 업무를 뽑아 연간 로드맵을 만듭니다.'
            : '접수일자와 제출 기한을 찾아 “○월 ○주”로 시기를 잡습니다.'}
        </p>
      </div>

      <div className="card">
        <div className="card-title">
          <span>2. 파일 올리기</span>
          <button className="btn btn-sm" onClick={() => void pick()} disabled={busy}>
            ＋ 파일 선택
          </button>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          PDF · 한글(hwp, hwpx) · 엑셀(xlsx) · 워드(docx) · 텍스트를 지원합니다. PDF가 가장
          정확합니다.
        </p>

        <label className="row" style={{ gap: 6, cursor: 'pointer', marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={keepOriginal}
            onChange={(e) => setKeepOriginal(e.target.checked)}
            style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
          />
          <span className="small">
            공문 원문도 함께 보관하기 <span className="muted">— [통합 검색]에서 찾을 수 있습니다</span>
          </span>
        </label>

        {files.length === 0 ? (
          <div className="empty">아직 올린 파일이 없습니다.</div>
        ) : (
          <div className="list">
            {files.map((f) => (
              <div className="item" key={f.path}>
                <div className="item-head">
                  <div>
                    <div className="item-title">{f.name}</div>
                    <div className="item-meta">
                      {f.state === '읽음' && `${f.doc?.chars.toLocaleString()}자 읽음`}
                      {f.state === '읽는 중' && '읽는 중…'}
                      {f.state === '대기' && '대기 중'}
                      {f.state === '실패' && '읽기 실패'}
                    </div>
                  </div>
                  <div className="row">
                    {f.doc?.text && (
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => setPreview(preview === f.path ? null : f.path)}
                      >
                        {preview === f.path ? '내용 닫기' : '내용 보기'}
                      </button>
                    )}
                    {f.state === '읽음' && (
                      <button className="btn btn-sm btn-ghost" onClick={() => void saveRawAsTask(f)}>
                        그대로 등록
                      </button>
                    )}
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => setFiles((prev) => prev.filter((x) => x.path !== f.path))}
                      disabled={busy}
                    >
                      제거
                    </button>
                  </div>
                </div>
                {f.doc?.error && (
                  <div className="note note-danger" style={{ marginTop: 8 }}>
                    {f.doc.error}
                  </div>
                )}
                {preview === f.path && f.doc?.text && (
                  <div className="scroll-box" style={{ marginTop: 8 }}>
                    {f.doc.text.slice(0, 4000)}
                    {f.doc.text.length > 4000 ? '\n\n… (이하 생략)' : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">3. AI로 정리하기</div>
        <div className="row">
          <button
            className="btn btn-primary"
            onClick={() => void analyze()}
            disabled={busy || !hasKey || readyCount === 0}
          >
            {busy ? '분석 중…' : `${readyCount}개 문서 분석 시작`}
          </button>
          <button
            className="btn"
            onClick={() => void archiveOnly()}
            disabled={busy || readyCount === 0}
          >
            📁 AI 없이 원문만 보관
          </button>
          {busy && <span className="muted small">{progress}</span>}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          지난 공문을 검색용으로 쌓아두기만 할 때는 “원문만 보관”을 쓰세요. AI 사용료가 들지 않고
          훨씬 빠릅니다.
        </p>
        {busy && (
          <div className="progress" style={{ marginTop: 12 }}>
            <div style={{ width: `${readyCount ? (done / readyCount) * 100 : 0}%` }} />
          </div>
        )}
      </div>

      {drafts.length > 0 && (
        <div className="card">
          <div className="card-title">
            <span>4. 확인하고 등록하기</span>
            <span className="badge badge-accent">
              {drafts.filter((d) => d.selected).length} / {drafts.length} 선택
            </span>
          </div>

          <div className="row" style={{ marginBottom: 12 }}>
            <button
              className="btn btn-sm"
              onClick={() => setDrafts((p) => p.map((d) => ({ ...d, selected: true })))}
            >
              전체 선택
            </button>
            <button
              className="btn btn-sm"
              onClick={() => setDrafts((p) => p.map((d) => ({ ...d, selected: false })))}
            >
              전체 해제
            </button>
            <span className="spacer" />
            <button className="btn btn-primary" onClick={() => void registerSelected()}>
              선택한 항목 등록
            </button>
          </div>

          <div className="list">
            {drafts.map((d, i) => (
              <div className="item" key={`${d.filename}-${i}`}>
                <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={d.selected}
                    onChange={(e) =>
                      setDrafts((p) =>
                        p.map((x, xi) => (xi === i ? { ...x, selected: e.target.checked } : x))
                      )
                    }
                    style={{ marginTop: 9, width: 15, height: 15, accentColor: 'var(--accent)' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <input
                        type="text"
                        value={d.title}
                        onChange={(e) =>
                          setDrafts((p) =>
                            p.map((x, xi) => (xi === i ? { ...x, title: e.target.value } : x))
                          )
                        }
                        style={{ flex: 2, minWidth: 180 }}
                      />
                      <input
                        type="text"
                        value={d.task_date_display}
                        onChange={(e) =>
                          setDrafts((p) =>
                            p.map((x, xi) =>
                              xi === i ? { ...x, task_date_display: e.target.value } : x
                            )
                          )
                        }
                        placeholder="시기"
                        style={{ flex: 1, minWidth: 110 }}
                      />
                    </div>
                    <div className="item-meta" style={{ marginTop: 6 }}>
                      출처: {d.filename}
                      {d.task_date_raw ? ` · 문서상 시기: ${d.task_date_raw}` : ''}
                    </div>
                    {d.key_points && (
                      <div className="note note-warn" style={{ marginTop: 8 }}>
                        {d.key_points}
                      </div>
                    )}
                    {d.draft_full && (
                      <div className="scroll-box" style={{ marginTop: 8, maxHeight: 150 }}>
                        {d.draft_full}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
