import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DocFull, ModelChoice, SearchHit } from '../../shared/types'
import type { HelpHit } from '../../shared/helpdocs'
import type { PageId } from '../App'
import { useToast } from '../lib/toast'
import ModelPicker from '../components/ModelPicker'
import { requestMemo } from '../lib/memos'

interface Props {
  jobTitle: string
  onGo: (p: PageId) => void
}

type SortBy = '관련도' | '날짜'

/** AI 요약에 넘길 근거 개수. 너무 많이 넘기면 느리고 비싸다. */
const SOURCE_LIMIT = 8
/** 그 가운데 학교업무 도움자료에 내줄 수 있는 자리. 내 자료가 적을 때만 채운다. */
const HELP_LIMIT = 3

/** Ctrl+K — 검색 화면이 이미 열려 있어도 찾을 낱말 칸으로 커서를 옮긴다 */
export function focusSearch(): void {
  window.dispatchEvent(new Event('wd:focus-search'))
}

export default function Search({ jobTitle, onGo }: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  /** 교육청 학교업무 도움자료에서 찾은 것 */
  const [helpHits, setHelpHits] = useState<HelpHit[]>([])
  const [sortBy, setSortBy] = useState<SortBy>('관련도')
  const [searching, setSearching] = useState(false)
  const [docCount, setDocCount] = useState(0)
  const [hasKey, setHasKey] = useState(true)

  const [answer, setAnswer] = useState('')
  const [answering, setAnswering] = useState(false)
  const [model, setModel] = useState<ModelChoice | null>(null)

  const [openDoc, setOpenDoc] = useState<DocFull | null>(null)

  const refreshCount = useCallback(async () => {
    setDocCount(await window.api.docs.count())
  }, [])

  // 화면을 열면 바로 칠 수 있게. 적어 둔 낱말이 있으면 통째로 골라 두어 새로 치면 바뀐다
  useEffect(() => {
    const focus = (): void => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    focus()
    window.addEventListener('wd:focus-search', focus)
    return () => window.removeEventListener('wd:focus-search', focus)
  }, [])

  useEffect(() => {
    void (async () => {
      await refreshCount()
      const s = await window.api.local.load()
      setHasKey(!!(s.openai_key || s.gemini_key || s.claude_key))
    })()
  }, [refreshCount])

  const run = async (): Promise<void> => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setAnswer('')
    setOpenDoc(null)
    try {
      const [found, help] = await Promise.all([window.api.search.run(q), window.api.help.search(q)])
      setHits(found)
      setHelpHits(help)
    } finally {
      setSearching(false)
    }
  }

  const sorted = useMemo(() => {
    if (!hits) return []
    if (sortBy === '관련도') return hits
    // 날짜순: 날짜를 아는 것부터 오래된 순으로, 모르는 것은 뒤로 보낸다.
    return [...hits].sort((a, b) => {
      if (!a.date && !b.date) return b.score - a.score
      if (!a.date) return 1
      if (!b.date) return -1
      return a.date.localeCompare(b.date)
    })
  }, [hits, sortBy])

  /** 요약에 함께 실을 도움자료 수. 번호는 내 자료 뒤에 잇는다. */
  const helpRoom = Math.min(HELP_LIMIT, helpHits.length, SOURCE_LIMIT - Math.min(SOURCE_LIMIT, hits?.length ?? 0))
  const helpBase = Math.min(SOURCE_LIMIT, hits?.length ?? 0)

  const summarize = async (): Promise<void> => {
    if (!hits || hits.length + helpHits.length === 0) return
    setAnswering(true)
    setAnswer('')
    try {
      const top = sorted.slice(0, SOURCE_LIMIT)
      const sources: { label: string; text: string }[] = []

      for (const h of top) {
        if (h.kind === 'document') {
          const full = await window.api.docs.get(h.id)
          sources.push({
            label: `${h.title}${h.date ? ` (${h.date})` : ''}`,
            text: full?.content ?? h.snippets.join('\n')
          })
        } else {
          sources.push({
            label: `${h.kind === 'journal' ? '업무 일지' : h.kind === 'memo' ? '자유 메모' : '업무'}: ${h.title} (${h.subtitle})`,
            text: h.snippets.join('\n')
          })
        }
      }
      for (const h of helpHits.slice(0, helpRoom)) {
        sources.push({
          label: `도움자료: ${h.group} › ${h.title}`,
          text:
            `교육청 학교업무 도움자료의 자료 폴더입니다(${h.group} › ${h.section}). 파일 ${h.fileCount}개가 들어 있고, 내용은 없고 이름만 있습니다.\n` +
            (h.matched.length ? `검색어가 걸린 파일:\n${h.matched.map((f) => `- ${f}`).join('\n')}` : '업무 이름에 검색어가 걸렸습니다.')
        })
      }

      const res = await window.api.ai.answer({
        jobTitle,
        query: query.trim(),
        sources,
        model: model ?? undefined
      })
      if (!res.ok) {
        toast(res.error ?? '요약에 실패했습니다.', 'err')
        return
      }
      setAnswer(res.answer)
    } finally {
      setAnswering(false)
    }
  }

  const showDoc = async (id: number): Promise<void> => {
    if (openDoc?.id === id) {
      setOpenDoc(null)
      return
    }
    setOpenDoc(await window.api.docs.get(id))
  }

  const removeDoc = async (id: number, name: string): Promise<void> => {
    await window.api.docs.remove(id)
    setOpenDoc(null)
    await refreshCount()
    await run()
    toast(`'${name}' 을(를) 보관함에서 지웠습니다.`)
  }

  const docHits = sorted.filter((h) => h.kind === 'document').length
  const taskHits = sorted.filter((h) => h.kind === 'task').length
  const journalHits = sorted.filter((h) => h.kind === 'journal').length

  return (
    <>
      <div className="page-head">
        <h1>통합 검색</h1>
        <p>
          등록된 업무와 보관해 둔 공문 원문, 교육청 학교업무 도움자료를 한꺼번에 찾습니다. 낱말을 띄어 쓰면 그
          낱말을 모두 포함한 것만 나옵니다.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run()
            }}
            placeholder="예: 방과후 강사 채용, 예산 집행, 만족도 조사"
            style={{ flex: 1, minWidth: 220 }}
          />
          <button
            className="btn btn-primary"
            onClick={() => void run()}
            disabled={searching || !query.trim()}
          >
            {searching ? '찾는 중…' : '검색'}
          </button>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          현재 보관된 공문 원문 {docCount.toLocaleString()}건.{' '}
          {docCount === 0 && (
            <button className="link" onClick={() => onGo('학습')}>
              [문서로 업무 만들기]에서 공문을 올리면 원문이 함께 보관됩니다.
            </button>
          )}
        </p>
      </div>

      {hits !== null && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="row">
              <span className="badge badge-accent">{hits.length}건</span>
              <span className="muted small">
                공문 {docHits}건 · 업무 {taskHits}건 · 일지 {journalHits}건
                {helpHits.length > 0 && ` · 학교업무 도움자료 ${helpHits.length}건`}
              </span>
              <span className="spacer" />
              <span className="muted small">정렬</span>
              {(['관련도', '날짜'] as SortBy[]).map((s) => (
                <button
                  key={s}
                  className={`btn btn-sm ${sortBy === s ? 'btn-primary' : ''}`}
                  onClick={() => setSortBy(s)}
                >
                  {s === '날짜' ? '날짜순 (오래된 것부터)' : '관련도순'}
                </button>
              ))}
            </div>

            {hits.length + helpHits.length > 0 && hasKey && (
              <div style={{ marginTop: 12 }}>
                <ModelPicker feature="summary" label="요약에 쓸 모델" onReady={setModel} onChange={setModel} />
              </div>
            )}

            {hits.length + helpHits.length > 0 && (
              <div className="row" style={{ marginTop: 12 }}>
                <button
                  className="btn btn-primary"
                  onClick={() => void summarize()}
                  disabled={answering || !hasKey}
                >
                  {answering ? 'AI가 정리하는 중…' : `🤖 상위 ${helpBase + helpRoom}건으로 내용 정리하기`}
                </button>
                {!hasKey && (
                  <span className="muted small">
                    AI 정리는 API 키가 있어야 씁니다.{' '}
                    <button className="link" onClick={() => onGo('설정')}>
                      설정
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>

          {answer && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-title">
                <span>AI가 정리한 내용</span>
                <button className="btn btn-sm btn-ghost" onClick={() => setAnswer('')}>
                  닫기
                </button>
              </div>
              <div className="note note-info">
                AI가 위 검색 결과만 보고 쓴 요약입니다. 번호는 아래 결과 순서를 가리킵니다. 중요한
                건은 원문을 직접 확인하세요.
              </div>
              <div style={{ whiteSpace: 'pre-wrap', marginTop: 10, lineHeight: 1.7 }}>{answer}</div>
            </div>
          )}

          {sorted.length === 0 ? (
            <div className="empty">
              {helpHits.length
                ? '보관한 공문·업무·일지에서는 찾은 것이 없습니다. 아래 학교업무 도움자료를 보세요.'
                : '찾은 것이 없습니다. 낱말 수를 줄이거나 더 짧은 낱말로 해 보세요.'}
            </div>
          ) : (
            <div className="list">
              {sorted.map((h, i) => (
                <div className="item" key={`${h.kind}-${h.id}`}>
                  <div className="item-head">
                    <div style={{ minWidth: 0 }}>
                      <div className="item-title">
                        <span className="muted small" style={{ marginRight: 6 }}>
                          [{i + 1}]
                        </span>
                        <span className={h.kind === 'task' ? 'badge badge-accent' : 'badge'}>
                          {h.kind === 'document'
                            ? '공문 원문'
                            : h.kind === 'journal'
                              ? '업무 일지'
                              : h.kind === 'memo'
                                ? '자유 메모'
                                : '등록된 업무'}
                        </span>{' '}
                        {h.title}
                      </div>
                      <div className="item-meta">{h.subtitle}</div>
                    </div>
                    <div className="row">
                      {h.kind === 'document' && (
                        <>
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => void showDoc(h.id)}
                          >
                            {openDoc?.id === h.id ? '원문 닫기' : '원문 보기'}
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => void removeDoc(h.id, h.title)}
                          >
                            삭제
                          </button>
                        </>
                      )}
                      {h.kind === 'task' && (
                        <button className="btn btn-sm btn-ghost" onClick={() => onGo('로드맵')}>
                          로드맵에서 보기
                        </button>
                      )}
                      {h.kind === 'journal' && (
                        <button className="btn btn-sm btn-ghost" onClick={() => onGo('일지')}>
                          일지에서 보기
                        </button>
                      )}
                      {h.kind === 'memo' && (
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => {
                            requestMemo({ open: h.id })
                            onGo('메모장')
                          }}
                        >
                          메모장에서 보기
                        </button>
                      )}
                    </div>
                  </div>

                  {h.snippets.map((s, si) => (
                    <div className="note" key={si} style={{ marginTop: 6 }}>
                      {s}
                    </div>
                  ))}

                  {openDoc?.id === h.id && h.kind === 'document' && (
                    <div className="scroll-box" style={{ marginTop: 10 }}>
                      {openDoc.content}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {helpHits.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="card-title">
                <span>🧭 학교업무 도움자료 {helpHits.length}건</span>
                <button className="btn btn-sm btn-ghost" onClick={() => onGo('도움자료')}>
                  도움자료에서 보기
                </button>
              </div>
              <p className="hint" style={{ marginTop: 0 }}>
                교육청이 업무마다 엮어 둔 자료 폴더입니다. 파일은 [📂 자료 폴더] 에서 내려받습니다.
              </p>
              <div className="list">
                {helpHits.map((h, j) => (
                  <div className="item" key={h.id}>
                    <div className="item-head">
                      <div style={{ minWidth: 0 }}>
                        <div className="item-title">
                          {j < helpRoom && (
                            <span className="muted small" style={{ marginRight: 6 }}>
                              [{helpBase + j + 1}]
                            </span>
                          )}
                          <span className="badge">도움자료</span> {h.title}
                        </div>
                        <div className="item-meta">
                          {h.group} › {h.section.replace(/^\d+\.\s*/, '')} · 자료 {h.fileCount}개
                        </div>
                      </div>
                      <button className="btn btn-sm" onClick={() => void window.api.shell.open(h.url)}>
                        📂 자료 폴더 ↗
                      </button>
                    </div>
                    {h.matched.length > 0 && (
                      <div className="help-matched">
                        {h.matched.slice(0, 4).map((f) => (
                          <span key={f} className="help-chip">
                            {f.replace(/\.[A-Za-z0-9]+$/, '')}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
