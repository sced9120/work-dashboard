import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DocFull, SearchHit } from '../../shared/types'
import type { PageId } from '../App'
import { useToast } from '../lib/toast'

interface Props {
  jobTitle: string
  onGo: (p: PageId) => void
}

type SortBy = '관련도' | '날짜'

/** AI 요약에 넘길 근거 개수. 너무 많이 넘기면 느리고 비싸다. */
const SOURCE_LIMIT = 8

export default function Search({ jobTitle, onGo }: Props): JSX.Element {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [sortBy, setSortBy] = useState<SortBy>('관련도')
  const [searching, setSearching] = useState(false)
  const [docCount, setDocCount] = useState(0)
  const [hasKey, setHasKey] = useState(true)

  const [answer, setAnswer] = useState('')
  const [answering, setAnswering] = useState(false)

  const [openDoc, setOpenDoc] = useState<DocFull | null>(null)

  const refreshCount = useCallback(async () => {
    setDocCount(await window.api.docs.count())
  }, [])

  useEffect(() => {
    void (async () => {
      await refreshCount()
      const s = await window.api.local.load()
      setHasKey(s.provider === 'openai' ? !!s.openai_key : !!s.gemini_key)
    })()
  }, [refreshCount])

  const run = async (): Promise<void> => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setAnswer('')
    setOpenDoc(null)
    try {
      setHits(await window.api.search.run(q))
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

  const summarize = async (): Promise<void> => {
    if (!hits?.length) return
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
            label: `업무: ${h.title} (${h.subtitle})`,
            text: h.snippets.join('\n')
          })
        }
      }

      const res = await window.api.ai.answer({ jobTitle, query: query.trim(), sources })
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

  return (
    <>
      <div className="page-head">
        <h1>통합 검색</h1>
        <p>
          등록된 업무와 보관해 둔 공문 원문을 한꺼번에 찾습니다. 낱말을 띄어 쓰면 그 낱말을 모두
          포함한 것만 나옵니다.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run()
            }}
            placeholder="예: 학교폭력 심의, 방과후 강사 채용, 급식 만족도"
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
                공문 {docHits}건 · 업무 {taskHits}건
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

            {hits.length > 0 && (
              <div className="row" style={{ marginTop: 12 }}>
                <button
                  className="btn btn-primary"
                  onClick={() => void summarize()}
                  disabled={answering || !hasKey}
                >
                  {answering ? 'AI가 정리하는 중…' : `🤖 상위 ${Math.min(SOURCE_LIMIT, hits.length)}건으로 내용 정리하기`}
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
              찾은 것이 없습니다. 낱말 수를 줄이거나 더 짧은 낱말로 해 보세요.
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
                        <span className={h.kind === 'document' ? 'badge' : 'badge badge-accent'}>
                          {h.kind === 'document' ? '공문 원문' : '등록된 업무'}
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
        </>
      )}
    </>
  )
}
