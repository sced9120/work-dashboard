import { useEffect, useMemo, useState } from 'react'
import type { ConvKind, ConvList, ConvMerge, SplitFile } from '../../shared/convert'
import { CONV_KIND_LABEL, planOutputs } from '../../shared/convert'
import Icon, { type IconName } from '../components/Icon'
import { addList, cancelConvert, clearFiles, removeFile, runConvert, setConvOptions, setConvertMounted, useConvert } from '../lib/convertStore'
import { useToast } from '../lib/toast'

const KIND_ICON: Record<ConvKind, IconName> = { hwp: 'doc', word: 'doc', excel: 'grid', ppt: 'screen', image: 'image', pdf: 'file' }

const MERGE: { id: ConvMerge; label: string; hint: string }[] = [
  { id: 'none', label: '파일마다 하나씩', hint: '파일 하나가 PDF 하나가 됩니다.' },
  { id: 'student', label: '학생별로 합치기', hint: '파일 이름의 학번 · 이름이 같은 것끼리 한 PDF 로. 문서를 앞에, 사진을 뒤에 넣습니다.' },
  { id: 'all', label: '모두 하나로 합치기', hint: '목록 차례대로 PDF 하나로 만듭니다.' }
]

const fmtBytes = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`)
const hasFiles = (e: React.DragEvent): boolean => [...e.dataTransfer.types].includes('Files')
const dropped = (e: React.DragEvent): string[] => [...e.dataTransfer.files].map((f) => window.api.files.pathOf(f)).filter(Boolean)

/** 끌어 놓는 칸 — 파일이 위에 있는 동안 표시한다 */
function useDrop(onPaths: (paths: string[]) => void, off: boolean): { over: boolean; props: React.HTMLAttributes<HTMLDivElement> & { 'data-drop': string } } {
  const [depth, setDepth] = useState(0)
  return {
    over: depth > 0 && !off,
    props: {
      'data-drop': '',
      onDragEnter: (e) => hasFiles(e) && setDepth((n) => n + 1),
      onDragLeave: (e) => hasFiles(e) && setDepth((n) => Math.max(0, n - 1)),
      onDragOver: (e) => hasFiles(e) && e.preventDefault(),
      onDrop: (e) => {
        e.preventDefault()
        setDepth(0)
        const paths = dropped(e)
        if (!off && paths.length) onPaths(paths)
      }
    }
  }
}

/**
 * 문서 → PDF 변환. 한글 · 오피스 문서는 이 PC 에 깔린 프로그램으로 바꾸고, 아무것도 밖으로 보내지 않는다.
 */
export default function Convert(): JSX.Element {
  const c = useConvert()
  const toast = useToast()

  useEffect(() => {
    setConvertMounted(true)
    return () => setConvertMounted(false)
  }, [])

  const take = (list: ConvList | null): void => {
    if (!list) return
    if (list.files.length) addList(list)
    if (list.error) toast(list.error, 'err')
  }
  const drop = useDrop((paths) => void window.api.convert.add(paths).then(take), c.busy)

  const planned = useMemo(() => planOutputs(c.files, c.options.merge).length, [c.files, c.options.merge])
  const has = (k: ConvKind): boolean => c.files.some((f) => f.kind === k)
  const finished = c.files.filter((f) => c.rows[f.id]?.status === 'done' || c.rows[f.id]?.status === 'error').length
  const r = c.result

  const reveal = async (key: string): Promise<void> => {
    if (!(await window.api.convert.reveal(key))) toast('폴더를 열지 못했습니다. 옮겼거나 지웠는지 확인해 주세요.', 'err')
  }

  return (
    <>
      <div className="page-head">
        <h1>PDF 변환</h1>
        <p>
          한글 · 워드 · 엑셀 · 파워포인트 · 사진을 PDF 로 한꺼번에 바꿉니다. <b>이 PC 안에서만</b> 하고(인터넷 · AI 를 쓰지 않음), 원본은 그대로 둡니다.
        </p>
      </div>

      <div className={`card conv-drop ${drop.over ? 'over' : ''}`} {...drop.props}>
        <div className="card-title">
          <span>1. 바꿀 파일</span>
          {c.files.length > 0 && <span className="badge">파일 {c.files.length}개</span>}
        </div>
        <div className="row">
          <button className="btn btn-primary btn-sm" onClick={() => void window.api.convert.pickFolder().then(take)} disabled={c.busy}>
            폴더 고르기
          </button>
          <button className="btn btn-sm" onClick={() => void window.api.convert.pickFiles().then(take)} disabled={c.busy}>
            파일 고르기
          </button>
          {c.files.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={clearFiles} disabled={c.busy}>
              목록 비우기
            </button>
          )}
        </div>
        {c.files.length === 0 ? (
          <div className="ocr-drop-hint">
            폴더나 파일을 고르거나 여기에 <b>끌어 놓으세요</b>.
            <br />
            한글(hwp · hwpx) · 워드 · 엑셀 · 파워포인트 · 사진(JPG · PNG) · PDF 를 담습니다. 폴더는 하위 폴더 3단계까지 읽습니다.
          </div>
        ) : (
          <div className="conv-list">
            <table>
              <thead>
                <tr>
                  <th>파일</th>
                  <th>종류</th>
                  <th>크기</th>
                  <th>상태</th>
                  <th>
                    <span className="conv-sr">빼기</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {c.files.map((f) => {
                  const row = c.rows[f.id]
                  return (
                    <tr key={f.id} className={row?.status === 'error' ? 'err' : ''}>
                      <td className="conv-name">
                        <Icon name={KIND_ICON[f.kind]} size={14} className="att-ico" /> {f.sub && <span className="muted">{f.sub}/</span>}
                        {f.name}
                        {row?.error && <div className="conv-why">{row.error}</div>}
                      </td>
                      <td>{CONV_KIND_LABEL[f.kind]}</td>
                      <td>{fmtBytes(f.size)}</td>
                      <td className="conv-state">
                        {row?.status === 'working' ? (
                          <>
                            <span className="stk-spin" aria-hidden="true" /> 바꾸는 중
                          </>
                        ) : row?.status === 'done' ? (
                          '✓ 완료'
                        ) : row?.status === 'error' ? (
                          '실패'
                        ) : row?.status === 'waiting' ? (
                          '대기'
                        ) : (
                          ''
                        )}
                      </td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => removeFile(f.id)} disabled={c.busy} aria-label={`${f.name} 빼기`}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {c.skipped.length > 0 && (
          <div className="small muted" style={{ marginTop: 8 }} title={c.skipped.slice(0, 40).join('\n')}>
            바꿀 수 없는 형식 {c.skipped.length}개는 뺐습니다: {c.skipped.slice(0, 3).join(', ')}
            {c.skipped.length > 3 && ' …'}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <span>2. 만들기</span>
        </div>
        <fieldset className="conv-merge" disabled={c.busy}>
          <legend className="conv-sr">PDF 를 만드는 방식</legend>
          {MERGE.map((m) => (
            <label key={m.id}>
              <input type="radio" name="conv-merge" checked={c.options.merge === m.id} onChange={() => setConvOptions({ merge: m.id })} />
              <span>
                <b>{m.label}</b>
                <small>{m.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {has('excel') && (
          <label className="conv-check">
            <input type="checkbox" checked={c.options.excelFit} onChange={(e) => setConvOptions({ excelFit: e.target.checked })} disabled={c.busy} />
            엑셀은 표의 가로를 한 쪽에 맞추기
          </label>
        )}
        {has('hwp') && (
          <div className="note note-warn small" style={{ marginTop: 10 }}>
            바꾸는 동안 한글 창이 잠깐 보일 수 있습니다. <b>[접근 허용]을 묻는 창이 뜨면 [모두 허용]</b>을 눌러 주세요. 열어 둔 한글 문서는 저장하고 닫은 뒤 시작하세요.
          </div>
        )}
        {(has('word') || has('ppt')) && <div className="small muted" style={{ marginTop: 8 }}>바꾸는 동안에는 워드 · 파워포인트 파일을 새로 열지 마세요.</div>}
        <div className="row" style={{ marginTop: 12 }}>
          {c.busy ? (
            <button className="btn btn-sm" onClick={cancelConvert}>
              그만하기
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => void runConvert()} disabled={!c.files.length}>
              {c.files.length ? `PDF ${planned}개 만들기` : 'PDF 만들기'}
            </button>
          )}
          {!c.busy && c.files.length > 0 && <span className="small muted">고른 폴더 옆(파일을 골랐으면 첫 파일 옆)에 새 폴더를 만들어 저장합니다.</span>}
        </div>
        {c.busy && (
          <div className="conv-progress" role="status" aria-live="polite">
            <div className="progress">
              <div style={{ width: `${c.files.length ? Math.round((100 * finished) / c.files.length) : 0}%` }} />
            </div>
            <span className="small">
              {finished} / {c.files.length}
            </span>
          </div>
        )}
        {r && !c.busy && (
          <div className={`note ${r.ok && !r.failed ? 'note-ok' : 'note-warn'} conv-result`} role="status">
            <b>
              {r.canceled
                ? `멈췄습니다.${r.made ? ` 그때까지 만든 ${r.made}개는 남아 있습니다.` : ' 저장한 파일은 없습니다.'}`
                : r.ok
                  ? `PDF ${r.made}개를 만들었습니다.`
                  : (r.error ?? '만들지 못했습니다.')}
            </b>
            {r.failed > 0 && <div>바꾸지 못한 파일 {r.failed}개 — 목록에 까닭이 적혀 있습니다.</div>}
            {r.notes.map((n) => (
              <div key={n}>{n}</div>
            ))}
            {r.folder && (
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn btn-sm" onClick={() => void reveal(c.job)}>
                  저장한 폴더 열기
                </button>
                <span className="small">{r.folder}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <SplitCard onReveal={reveal} />
    </>
  )
}

/** 만들던 나누기는 화면을 떠나면 비운다 — 금방 끝나는 일이라 따로 두지 않는다 */
function SplitCard({ onReveal }: { onReveal: (key: string) => Promise<void> }): JSX.Element {
  const toast = useToast()
  const [file, setFile] = useState<SplitFile | null>(null)
  const [ranges, setRanges] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  const take = (f: SplitFile | null): void => {
    if (!f) return
    if (!f.ok) return toast(f.error ?? 'PDF 를 읽지 못했습니다.', 'err')
    setFile(f)
    setDone('')
  }
  const drop = useDrop((paths) => void window.api.convert.addSplit(paths[0]).then(take), busy)

  const run = async (): Promise<void> => {
    if (!file) return
    setBusy(true)
    setDone('')
    try {
      const r = await window.api.convert.split(file.id, ranges)
      if (!r.ok) toast(r.error ?? '나누지 못했습니다.', 'err')
      else setDone(`PDF ${r.made}개로 나눠 '${r.folder}' 폴더에 저장했습니다.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`card conv-drop ${drop.over ? 'over' : ''}`} {...drop.props}>
      <div className="card-title">
        <span>PDF 나누기</span>
        {file && <span className="badge">{file.pages}쪽</span>}
      </div>
      <div className="row">
        <button className="btn btn-sm" onClick={() => void window.api.convert.pickSplit().then(take)} disabled={busy}>
          나눌 PDF 고르기
        </button>
        <span className="small muted conv-name">{file ? file.name : '또는 여기에 끌어 놓으세요.'}</span>
      </div>
      {file && (
        <>
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="conv-ranges">나눌 쪽 (비워 두면 한 쪽씩)</label>
            <input id="conv-ranges" type="text" value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="예) 1-3, 5, 8-" disabled={busy} />
            <div className="hint">쉼표마다 PDF 하나가 됩니다. '8-' 은 8쪽부터 끝까지입니다.</div>
          </div>
          <div className="row">
            <button className="btn btn-primary btn-sm" onClick={() => void run()} disabled={busy}>
              {busy ? '나누는 중…' : '나누기'}
            </button>
            {done && (
              <>
                <span className="small" role="status">
                  {done}
                </span>
                <button className="btn btn-sm" onClick={() => void onReveal(file.id)}>
                  저장한 폴더 열기
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
