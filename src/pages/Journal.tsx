import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JournalEntry } from '../../shared/types'
import { useToast } from '../lib/toast'

function today(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** "2026-09-03" → "9월 3일 (목)" */
function pretty(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  if (Number.isNaN(d.getTime())) return date
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`
}

export default function Journal(): JSX.Element {
  const toast = useToast()
  const [items, setItems] = useState<JournalEntry[]>([])
  const [date, setDate] = useState(today())
  const [content, setContent] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    setItems(await window.api.journal.list())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((j) => j.content.toLowerCase().includes(q))
  }, [items, query])

  /** 같은 날짜끼리 묶어 보여 준다. */
  const grouped = useMemo(() => {
    const map = new Map<string, JournalEntry[]>()
    for (const j of visible) {
      const list = map.get(j.entry_date) ?? []
      list.push(j)
      map.set(j.entry_date, list)
    }
    return [...map.entries()]
  }, [visible])

  const add = async (): Promise<void> => {
    if (!content.trim()) {
      toast('내용을 적어 주세요.', 'err')
      return
    }
    await window.api.journal.add({ entry_date: date, content: content.trim() })
    setContent('')
    await load()
    toast('기록했습니다.', 'ok')
  }

  const saveEdit = async (j: JournalEntry): Promise<void> => {
    await window.api.journal.update(j.id, { entry_date: j.entry_date, content: editText })
    setEditingId(null)
    await load()
    toast('고쳤습니다.', 'ok')
  }

  const remove = async (j: JournalEntry): Promise<void> => {
    await window.api.journal.remove(j.id)
    await load()
    toast('지웠습니다.')
  }

  return (
    <>
      <div className="page-head">
        <h1>업무 일지</h1>
        <p>
          그날 무슨 일을 했는지 한두 줄씩 남겨 두면, 나중에 “작년 이맘때 뭘 했더라”에 답이 됩니다.
        </p>
      </div>

      <div className="note note-warn" style={{ marginBottom: 14 }}>
        일지는 <b>인수인계 파일에 함께 넘어갑니다.</b> 다음 담당자가 볼 것을 생각해서,
        학생 실명이나 민감한 사안 내용은 적지 마세요. “2학년 흡연 건 선도위 개최” 처럼
        업무 흐름만 남기시면 충분합니다.
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">오늘 기록하기</div>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div className="field" style={{ flex: 'none', minWidth: 150 }}>
            <label>날짜</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>한 일</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                // Ctrl+Enter 로 바로 저장. 매일 쓰는 화면이라 손이 덜 가게.
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void add()
              }}
              placeholder={'예: 제3회 선도위 개최, 보호자 통지 발송\n급식 만족도 조사 취합 시작'}
              style={{ minHeight: 80 }}
            />
            <div className="hint">Ctrl + Enter 로 바로 저장됩니다.</div>
          </div>
        </div>
        <div className="row row-end">
          <button className="btn btn-primary" onClick={() => void add()} disabled={!content.trim()}>
            기록
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="일지 안에서 찾기"
        />
        <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
          업무·공문까지 함께 찾으려면 [통합 검색]을 쓰세요. 일지도 같이 나옵니다.
        </p>
      </div>

      {grouped.length === 0 ? (
        <div className="empty">
          {items.length === 0
            ? '아직 기록이 없습니다. 위에 오늘 한 일을 한 줄만 남겨 보세요.'
            : '찾는 내용이 없습니다.'}
        </div>
      ) : (
        grouped.map(([day, entries]) => (
          <div className="card" key={day} style={{ marginBottom: 12 }}>
            <div className="card-title">
              <span>{pretty(day)}</span>
              <span className="badge">{day}</span>
            </div>
            <div className="list">
              {entries.map((j) => (
                <div className="item" key={j.id}>
                  {editingId === j.id ? (
                    <>
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        style={{ minHeight: 80 }}
                      />
                      <div className="row row-end" style={{ marginTop: 8 }}>
                        <button className="btn btn-sm btn-ghost" onClick={() => setEditingId(null)}>
                          취소
                        </button>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => void saveEdit(j)}
                        >
                          저장
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="item-head">
                      <div style={{ whiteSpace: 'pre-wrap', minWidth: 0, lineHeight: 1.6 }}>
                        {j.content}
                      </div>
                      <div className="row">
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => {
                            setEditingId(j.id)
                            setEditText(j.content)
                          }}
                        >
                          수정
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => void remove(j)}>
                          삭제
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </>
  )
}
