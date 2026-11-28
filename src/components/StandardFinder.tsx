/**
 * 성취기준 찾기 (3.8.0~) — 2022 개정 교육과정 초 · 중 · 고 성취기준을 학교급 · 과목 · 낱말로 찾아 고른다.
 * 성취기준 화면과, 다른 화면의 [성취기준 찾기] 창(StandardPicker)이 함께 쓴다.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CurriculumSubject, SchoolLevel, Standard } from '../../shared/curriculum'
import { CURRICULUM_CREDIT, LEVEL_NAME, SCHOOL_LEVELS } from '../../shared/curriculum'

interface Props {
  /** 고른 것으로 할 일 — 단추 글자와 함께 */
  actions: { label: string; primary?: boolean; run: (picked: Standard[]) => void }[]
  /** 처음 고를 학교급 */
  initialLevel?: SchoolLevel | ''
  /** 처음 넣을 찾는 말 */
  initialQuery?: string
  /** 창 안에서 쓸 때 — 결과 칸 높이를 줄인다 */
  compact?: boolean
}

const LEVEL_KEY = 'wd_std_level'

export function savedLevel(): SchoolLevel | '' {
  try {
    const v = window.localStorage.getItem(LEVEL_KEY)
    return v === '초' || v === '중' || v === '고' ? v : ''
  } catch {
    return ''
  }
}

export default function StandardFinder({ actions, initialLevel, initialQuery, compact }: Props): JSX.Element {
  const [subjects, setSubjects] = useState<CurriculumSubject[]>([])
  const [total, setTotal] = useState(0)
  const [level, setLevel] = useState<SchoolLevel | ''>(initialLevel ?? savedLevel())
  const [subject, setSubject] = useState('')
  const [q, setQ] = useState(initialQuery ?? '')
  const [items, setItems] = useState<Standard[]>([])
  const [found, setFound] = useState(0)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<Standard[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    void window.api.curriculum
      .subjects()
      .then((r) => {
        setSubjects(r.subjects)
        setTotal(r.total)
      })
      .catch(() => setError('성취기준 자료를 읽지 못했습니다. 프로그램을 다시 켜 보세요.'))
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(LEVEL_KEY, level)
    } catch {
      // 이번 실행 동안만
    }
  }, [level])

  // 학교급을 바꾸면 그 학교급에 없는 과목은 푼다
  useEffect(() => {
    if (subject && !subjects.some((s) => s.subject === subject && (!level || s.level === level))) setSubject('')
  }, [level, subject, subjects])

  useEffect(() => {
    const my = ++seq.current
    setBusy(true)
    const t = window.setTimeout(() => {
      void window.api.curriculum
        .search({ level, subject, q, limit: 200 })
        .then((r) => {
          if (my !== seq.current) return
          setItems(r.items)
          setFound(r.total)
          setError('')
        })
        .catch(() => my === seq.current && setError('찾지 못했습니다. 잠시 뒤 다시 해 보세요.'))
        .finally(() => my === seq.current && setBusy(false))
    }, 180)
    return () => window.clearTimeout(t)
  }, [level, subject, q])

  const groups = useMemo(() => {
    const m = new Map<string, CurriculumSubject[]>()
    for (const s of subjects) {
      if (level && s.level !== level) continue
      const k = level ? s.group : `${LEVEL_NAME[s.level]} · ${s.group}`
      m.set(k, [...(m.get(k) ?? []), s])
    }
    return [...m.entries()]
  }, [subjects, level])

  const isPicked = (s: Standard): boolean => picked.some((p) => p.key === s.key)
  const toggle = (s: Standard): void => setPicked((p) => (isPicked(s) ? p.filter((x) => x.key !== s.key) : [...p, s]))
  const allShown = items.length > 0 && items.every(isPicked)

  return (
    <div className={`std-finder${compact ? ' std-compact' : ''}`}>
      <div className="std-bar">
        <label className="std-field">
          <span>학교급</span>
          <select value={level} onChange={(e) => setLevel(e.target.value as SchoolLevel | '')}>
            <option value="">모두</option>
            {SCHOOL_LEVELS.map((l) => (
              <option key={l} value={l}>
                {LEVEL_NAME[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="std-field std-subject">
          <span>과목</span>
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">모든 과목</option>
            {groups.map(([g, list]) => (
              <optgroup key={g} label={g}>
                {list.map((s) => (
                  <option key={`${s.level}|${s.subject}`} value={s.subject}>
                    {level ? s.subject : `${s.subject} (${s.level})`} · {s.count}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="std-field std-q">
          <span>찾는 말 · 코드</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: 나머지정리 / 10공수1-01 / 토론" />
        </label>
      </div>

      <div className="std-status small muted" aria-live="polite">
        {error ? (
          <span className="std-error">{error}</span>
        ) : busy && !items.length ? (
          '찾는 중…'
        ) : (
          <>
            {total ? `${total.toLocaleString()}개 중 ` : ''}
            <b>{found.toLocaleString()}개</b>
            {found > items.length ? ` — 앞의 ${items.length}개만 보입니다. 과목이나 찾는 말로 좁혀 보세요.` : ''}
          </>
        )}
        <span className="spacer" />
        {items.length > 0 && (
          <button
            type="button"
            className="link"
            onClick={() => setPicked((p) => (allShown ? p.filter((x) => !items.some((i) => i.key === x.key)) : [...p, ...items.filter((i) => !p.some((x) => x.key === i.key))]))}
          >
            {allShown ? '보이는 것 모두 풀기' : '보이는 것 모두 고르기'}
          </button>
        )}
      </div>

      <ul className="std-list" aria-label="성취기준 목록">
        {items.map((s) => (
          <li key={s.key} className={isPicked(s) ? 'on' : ''}>
            <label className="std-item">
              <input type="checkbox" checked={isPicked(s)} onChange={() => toggle(s)} aria-label={`${s.code} 고르기`} />
              <span className="std-text">
                <span className="std-code">{s.code}</span> {s.content}
                <span className="std-meta">
                  {s.subject} · {s.area}
                  {s.gradeGroup ? ` · ${s.gradeGroup}` : ''}
                </span>
              </span>
            </label>
            {s.note && (
              <button type="button" className="btn btn-sm btn-ghost std-note-btn" aria-expanded={open === s.key} onClick={() => setOpen(open === s.key ? null : s.key)}>
                {open === s.key ? '해설 접기' : '해설'}
              </button>
            )}
            {open === s.key && s.note && <p className="std-note small">{s.note}</p>}
          </li>
        ))}
        {!busy && !error && items.length === 0 && <li className="std-none muted small">맞는 성취기준이 없습니다. 찾는 말을 줄이거나 과목을 풀어 보세요.</li>}
      </ul>

      <div className="std-foot">
        <span className="small">
          고른 것 <b>{picked.length}</b>개
          {picked.length > 0 && (
            <>
              {' '}
              <button type="button" className="link" onClick={() => setPicked([])}>
                모두 풀기
              </button>
            </>
          )}
        </span>
        <span className="spacer" />
        {actions.map((a) => (
          <button key={a.label} type="button" className={`btn btn-sm${a.primary ? ' btn-primary' : ''}`} disabled={!picked.length} onClick={() => a.run(picked)}>
            {a.label}
          </button>
        ))}
      </div>
      <p className="std-credit small muted">{CURRICULUM_CREDIT}</p>
    </div>
  )
}
