import { useEffect, useMemo, useState } from 'react'
import type { MdTable } from '../../shared/mdtable'
import { answersToTables, plainCell, proseOf, toTsv } from '../../shared/mdtable'
import type { OcrProvider } from '../../shared/ocr'
import { OCR_DEFAULT_MODEL, OCR_MAX_TABS, OCR_OPENAI_MODEL, fmtBytes, ocrProviderOf } from '../../shared/ocr'
import { OCR_AGENT_PROMPT } from '../../shared/ocrPrompt'
import { modelsFor } from '../../shared/types'
import type { PageId } from '../App'
import Icon from '../components/Icon'
import { useCatalog } from '../lib/catalog'
import { useConfirm } from '../lib/confirm'
import type { OcrTab } from '../lib/ocrStore'
import {
  addFiles,
  cancelTab,
  closeTab,
  initOcr,
  moreTab,
  newTab,
  patchTab,
  runTab,
  setActive,
  setOcrMounted,
  tabTitle,
  unsaved,
  useOcrTabs
} from '../lib/ocrStore'
import { useToast } from '../lib/toast'

interface Props {
  onGo: (p: PageId) => void
}

const MODEL_KEY = 'wd_ocr_model'

/** 키를 넣은 서비스의 모델만 — Gemini 가 먼저, OpenAI 키만 있으면 OpenAI 의 싼 등급을 권장으로 */
export interface OcrModels {
  groups: { provider: OcrProvider; label: string; models: string[]; recommended: string }[]
  /** 아무것도 고르지 않았을 때 쓸 모델 */
  fallback: string
}

const WHO: Record<OcrProvider, { name: string; company: string }> = {
  gemini: { name: 'Gemini', company: 'Google' },
  openai: { name: 'OpenAI', company: 'OpenAI' }
}
/** 화면에 미리 보여 줄 행 수 (엑셀에는 모두 들어간다) */
const PREVIEW_ROWS = 200

/** 탭 하나 — 파일 고르기 · 읽기 · 결과 */
function TabView({ tab, hasKey, models }: { tab: OcrTab; hasKey: boolean | null; models: OcrModels }): JSX.Element {
  const toast = useToast()
  const remote = useCatalog().catalog.ocr
  const id = tab.id
  const [seconds, setSeconds] = useState(0)
  const [drag, setDrag] = useState(0)

  // 이 탭에서 고른 것 → 이 PC 에서 마지막으로 고른 것(키가 있는 서비스일 때만) → 권장
  const usable = (m: string): boolean => models.groups.some((g) => g.models.includes(m))
  const model = useMemo(() => {
    if (tab.model && usable(tab.model)) return tab.model
    let saved = ''
    try {
      saved = window.localStorage.getItem(MODEL_KEY) || ''
    } catch {
      // 기억 못 해도 권장 모델로
    }
    return saved && usable(saved) ? saved : models.fallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.model, models])
  const who = WHO[ocrProviderOf(model) ?? 'gemini']

  useEffect(() => {
    if (!tab.busy) return
    const tick = (): void => setSeconds(Math.round((Date.now() - tab.started) / 1000))
    tick()
    const t = window.setInterval(tick, 1000)
    return () => window.clearInterval(t)
  }, [tab.busy, tab.started])

  const answers = tab.answers
  const text = answers.map((a) => a.text).join('\n\n')
  const tables = useMemo<MdTable[]>(() => answersToTables(answers), [answers])
  const lead = useMemo(() => (answers[0] ? proseOf(answers[0].text).split('\n').find((l) => l.trim()) ?? '' : ''), [answers])
  const last = answers[answers.length - 1]
  const rowCount = tables.reduce((n, t) => n + t.rows.length, 0)
  const usage = answers.reduce((u, a) => ({ input: u.input + (a.usage?.input ?? 0), output: u.output + (a.usage?.output ?? 0) }), { input: 0, output: 0 })
  const busy = tab.busy
  const files = tab.files

  const pick = async (): Promise<void> => addFiles(id, await window.api.ocr.pick())

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDrag(0)
    if (busy) return
    const paths = [...e.dataTransfer.files].map((f) => window.api.files.pathOf(f)).filter(Boolean)
    if (!paths.length) return
    const { files: got, skipped } = await window.api.ocr.add(paths)
    addFiles(id, got)
    if (skipped.length) toast(`PDF · 사진만 읽습니다. 뺀 파일: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? ` 외 ${skipped.length - 3}개` : ''}`, 'err')
  }
  const hasFiles = (e: React.DragEvent): boolean => [...e.dataTransfer.types].includes('Files')

  const run = async (): Promise<void> => {
    const a = await runTab(id, model)
    if (a?.ok && !answersToTables([a]).length) toast('표 모양으로 받지 못했습니다. 아래 [받은 글 보기] 에서 확인해 주세요.', 'err')
  }

  const save = async (): Promise<void> => {
    const title = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : tables[0]?.title || ''
    const r = await window.api.ocr.save(tables, title)
    if (r.ok) patchTab(id, { savedAt: Date.now() })
    if (r.message !== '취소했습니다.') toast(r.message, r.ok ? 'ok' : 'err')
  }

  const copy = async (): Promise<void> => {
    await window.api.clipboard.write(tables.map(toTsv).join('\n\n'))
    toast('표를 복사했습니다. 엑셀 · 한글 표에 그대로 붙여 넣을 수 있습니다.', 'ok')
  }

  const p = tab.progress
  const parts = p?.parts ? ` (${p.parts}묶음 중 ${p.part ?? 0}묶음 끝)` : ''
  const status = !p
    ? '보내는 중…'
    : p.phase === 'upload'
      ? `큰 파일을 ${who.name} 에 올리는 중… (${p.chars + 1}/${p.rows})`
      : p.phase === 'wait'
        ? `${who.name} 가 문서를 읽는 중…${parts}`
        : `받는 중 — 표 ${p.rows}줄 · ${p.chars.toLocaleString()}자${parts}`

  return (
    <div
      className="ocr-tabview"
      data-drop=""
      onDragEnter={(e) => hasFiles(e) && setDrag((n) => n + 1)}
      onDragLeave={(e) => hasFiles(e) && setDrag((n) => Math.max(0, n - 1))}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDrop={(e) => void onDrop(e)}
    >
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
              <button className="btn btn-ghost btn-sm" onClick={() => patchTab(id, { files: [] })} disabled={busy}>
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
                  <button className="btn btn-ghost btn-sm" onClick={() => patchTab(id, { files: files.filter((x) => x.id !== f.id) })} disabled={busy} aria-label={`${f.name} 빼기`}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="ocr-drop-hint">
              여기에 PDF · 사진을 <b>끌어 놓거나</b> [파일 고르기] 로 고르세요.
              <br />
              PDF · PNG · JPG · WEBP · HEIC. 여러 개면 이름 차례로 한 표에 모아 읽습니다(PDF 50MB · 사진 20MB 까지).
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">2. 어떻게 읽을까요</div>
          <div className="field">
            <label>추가 요청 (선택)</label>
            <textarea
              value={tab.note}
              onChange={(e) => patchTab(id, { note: e.target.value })}
              rows={3}
              placeholder="예: 학번 순으로 정렬해 주세요 / 영어 본문만 / 마지막 쪽 표는 빼 주세요"
              disabled={busy}
            />
          </div>
          <div className="field">
            <label>모델</label>
            <select
              value={model}
              onChange={(e) => {
                patchTab(id, { model: e.target.value })
                try {
                  window.localStorage.setItem(MODEL_KEY, e.target.value)
                } catch {
                  // 이번에만
                }
              }}
              disabled={busy}
              style={{ width: 'auto', minWidth: 220 }}
            >
              {models.groups.map((g) => (
                <optgroup key={g.provider} label={g.label}>
                  {g.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                      {m === g.recommended ? ' (권장)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="hint">
              {who.name === 'OpenAI'
                ? '사진은 높은 해상도(detail high)로, PDF 는 파일 그대로 보내고, 생각은 짧게 합니다. HEIC 사진은 OpenAI 가 읽지 못합니다.'
                : '그림을 높은 해상도로 보고(High-Res), 생각은 짧게, 검색 · 도구는 쓰지 않습니다.'}{' '}
              설정에 키를 넣은 서비스의 모델만 나옵니다.
            </div>
          </div>
          <details className="neis-howto">
            <summary>읽는 지침 보기</summary>
            <pre className="ocr-prompt">{remote.prompt || OCR_AGENT_PROMPT}</pre>
          </details>
        </div>
      </div>

      <div className="card ocr-send">
        <div className="note note-danger small" style={{ marginBottom: 10 }}>
          <b>보내는 것:</b> 고른 파일 <b>원본 그대로</b>(학생 이름 · 학번 · 글씨 모두)를 내 {who.name} 키로 {who.company} 에 보냅니다. 사진 속 글자라
          미리 가릴 수 없습니다.
          <br />
          {who.name === 'OpenAI' ? (
            <>OpenAI 는 API 로 보낸 내용을 기본으로 학습에 쓰지 않는다고 밝히지만, 남용 감시를 위해 일정 기간 보관할 수 있습니다. </>
          ) : (
            <>
              무료 등급 키로 보낸 내용은 Google 이 서비스 개선에 쓰고 사람이 볼 수도 있습니다. 학생 자료는 <b>결제를 켠(유료 등급) 키</b>를 쓰고,{' '}
            </>
          )}
          학교 · 교육청의 생성형 AI 지침을 먼저 확인하세요. 받은 결과는 이 프로그램에 저장하지 않습니다.
        </div>
        <label className="ocr-agree">
          <input type="checkbox" checked={tab.agree} onChange={(e) => patchTab(id, { agree: e.target.checked })} disabled={busy} />
          위 내용을 확인했고, 이 파일을 {who.name} 로 보내도 됩니다
        </label>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn-primary" onClick={() => void run()} disabled={busy || !files.length || !tab.agree || !hasKey}>
            {busy ? '읽는 중…' : '🔎 읽어서 표로 만들기'}
          </button>
          {busy && (
            <>
              <span className="small">
                {status} · {seconds}초
              </span>
              <button className="btn btn-sm btn-ghost" onClick={() => cancelTab(id)}>
                멈추기
              </button>
            </>
          )}
        </div>
        {busy && <p className="hint">쪽수가 많으면 몇 분 걸릴 수 있습니다. 다른 화면으로 가거나 다른 탭에서 다른 파일을 읽어도 이 탭은 계속 읽습니다.</p>}
        {tab.error && (
          <div className="note note-warn" style={{ marginTop: 10 }}>
            {tab.error}
          </div>
        )}
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
              <button className="btn btn-sm btn-primary" onClick={() => void moreTab(id)} disabled={busy}>
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
            <button className="btn btn-sm btn-ghost" onClick={() => patchTab(id, { showRaw: !tab.showRaw })}>
              {tab.showRaw ? '받은 글 닫기' : '받은 글 보기'}
            </button>
            <span className="muted small">{tab.savedAt ? '엑셀로 저장했습니다.' : '결과는 프로그램을 끄거나 이 탭을 닫으면 사라집니다 — 엑셀로 저장해 두세요.'}</span>
          </div>
          {tab.showRaw && <pre className="ocr-raw">{text}</pre>}
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
            <p className="hint">노랗게 칠한 칸은 AI 가 [불확실] · [판독 불가] 로 표시한 곳입니다. 원본과 맞춰 고쳐 주세요.</p>
          )}
        </div>
      )}

      {drag > 0 && !busy && (
        <div className="drop-cover">
          <div className="drop-cover-box">📄 여기에 놓으면 이 탭에서 읽을 파일로 넣습니다</div>
        </div>
      )}
    </div>
  )
}

/**
 * 스캔 문서 → 엑셀 (OCR). 스캔한 PDF · 사진을 사용자의 Gemini 키(없으면 OpenAI 키)로 보내 원문 그대로 표로 받고 엑셀로 저장한다.
 * 탭(최대 5개)마다 따로 읽고, 다른 화면으로 가도 계속 읽는다(src/lib/ocrStore.ts). 실제 일은 electron/main/ocr.ts.
 * 받은 결과는 파일로 저장하지 않는다(프로그램을 끄거나 탭을 닫으면 사라진다).
 */
export default function Ocr({ onGo }: Props): JSX.Element {
  const toast = useToast()
  const ask = useConfirm()
  const { tabs, active } = useOcrTabs()
  const remote = useCatalog().catalog.ocr
  const [keys, setKeys] = useState<{ gemini: boolean; openai: boolean } | null>(null)
  const [lists, setLists] = useState<{ gemini: string[]; openai: string[] }>({ gemini: [], openai: [] })
  const tab = tabs.find((t) => t.id === active) ?? tabs[0]
  const hasKey = keys ? keys.gemini || keys.openai : null

  // 키를 넣은 서비스의 모델만. 권장: Gemini 는 만든이가 정한 것(없으면 3.8 Flash), OpenAI 는 싼 등급(gpt-6-luna)
  const models = useMemo<OcrModels>(() => {
    const groups: OcrModels['groups'] = []
    const gRec = remote.model || OCR_DEFAULT_MODEL
    const oRec = remote.openaiModel || OCR_OPENAI_MODEL
    if (keys?.gemini) groups.push({ provider: 'gemini', label: 'Google Gemini', models: [...new Set([gRec, ...lists.gemini])], recommended: gRec })
    if (keys?.openai) groups.push({ provider: 'openai', label: 'OpenAI', models: [...new Set([oRec, ...lists.openai])], recommended: oRec })
    return { groups, fallback: groups[0]?.recommended ?? gRec }
  }, [keys, lists, remote.model, remote.openaiModel])

  useEffect(() => {
    initOcr()
    setOcrMounted(true)
    void (async () => {
      const s = await window.api.local.load()
      setKeys({ gemini: !!s.gemini_key?.trim(), openai: !!s.openai_key?.trim() })
      setLists({ gemini: modelsFor('gemini', s.custom_models, s.hidden_models), openai: modelsFor('openai', s.custom_models, s.hidden_models) })
    })()
    // 화면을 떠나도 읽던 것은 계속 읽는다 — 올려 둔 파일은 탭을 닫거나 프로그램을 끌 때 지운다
    return () => setOcrMounted(false)
  }, [])

  const close = async (t: OcrTab, i: number): Promise<void> => {
    if (t.busy || unsaved(t)) {
      const ok = await ask({
        title: `「${tabTitle(t, i)}」 탭을 닫을까요?`,
        body: t.busy ? '아직 읽는 중입니다. 닫으면 멈추고, 받던 결과는 사라집니다.' : '엑셀로 저장하지 않은 결과가 있습니다. 닫으면 사라집니다.',
        okText: '닫기',
        danger: true
      })
      if (!ok) return
    }
    closeTab(t.id)
  }

  return (
    <>
      <div className="page-head">
        <h1>스캔 문서 → 엑셀</h1>
        <p>
          스캔한 PDF · 사진을 AI 가 <b>글자 그대로</b> 읽어 표로 만들고, 엑셀 파일로 저장합니다. 요약하지 않고, 취소선으로 지운 글은
          빼고, 헷갈리는 글자는 [불확실: …] 로 남깁니다. 설정에 넣어 둔 <b>내 Gemini 키</b>(없으면 <b>OpenAI 키</b>)를 씁니다. 탭을 열어 여러 문서를 함께 읽을
          수 있습니다.
        </p>
      </div>

      {hasKey === false && (
        <div className="note note-warn ocr-nokey">
          Gemini · OpenAI API 키가 없습니다. [설정 → AI 연결] 에서 둘 가운데 하나의 키를 넣으면 쓸 수 있습니다(이 기능은 Gemini 설정에 맞춰 만들고
          시험했습니다).{' '}
          <button className="btn btn-sm" onClick={() => onGo('설정')}>
            설정으로
          </button>
        </div>
      )}

      <div className="ocr-tabs" role="tablist" aria-label="읽기 탭">
        {tabs.map((t, i) => (
          <div key={t.id} className={`ocr-tab ${t.id === tab.id ? 'active' : ''}`}>
            <button role="tab" aria-selected={t.id === tab.id} className="ocr-tab-open" onClick={() => setActive(t.id)} title={tabTitle(t, i)}>
              {t.busy ? <span className="ocr-tab-busy" aria-label="읽는 중" /> : t.error ? <span className="ocr-tab-dot err" /> : t.answers.length ? <span className={`ocr-tab-dot ${t.answers[t.answers.length - 1].truncated ? 'warn' : 'ok'}`} /> : null}
              <span className="ocr-tab-name">{tabTitle(t, i)}</span>
            </button>
            <button className="ocr-tab-x" onClick={() => void close(t, i)} aria-label={`${tabTitle(t, i)} 탭 닫기`} title="탭 닫기">
              ✕
            </button>
          </div>
        ))}
        <button
          className="ocr-tab-new"
          onClick={() => {
            if (!newTab()) toast(`탭은 ${OCR_MAX_TABS}개까지 열 수 있습니다. 다 쓴 탭을 닫아 주세요.`, 'err')
          }}
          disabled={tabs.length >= OCR_MAX_TABS}
          title={tabs.length >= OCR_MAX_TABS ? `탭은 ${OCR_MAX_TABS}개까지` : '새 탭에서 다른 문서 읽기'}
        >
          ＋ 새 탭
        </button>
        <span className="muted small ocr-tab-count">
          {tabs.length}/{OCR_MAX_TABS}
        </span>
      </div>

      <TabView key={tab.id} tab={tab} hasKey={hasKey} models={models} />
    </>
  )
}
