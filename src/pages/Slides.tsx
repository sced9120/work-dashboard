import { useEffect, useMemo, useState } from 'react'
import type { Deck, DesignSource, Slide, SlideKind, SlideTheme } from '../../shared/slides'
import { BUILTIN_DESIGNS, SLIDE_KINDS, bodyText, builtinSource, withBody } from '../../shared/slides'
import type { ModelChoice, ScrubHit } from '../../shared/types'
import type { PageId } from '../App'
import { useConfirm } from '../lib/confirm'
import { useToast } from '../lib/toast'
import ModelPicker from '../components/ModelPicker'

interface Props {
  onGo: (p: PageId) => void
}

/** 화면에서 고치는 동안의 슬라이드. 본문은 글상자 그대로 들고 있다가 저장·미리보기 때 풀어 쓴다. */
interface Draft {
  key: number
  kind: SlideKind
  title: string
  body: string
  notes: string
}

interface State {
  topic: string
  audience: string
  count: number
  minutes: string
  material: string
  wantNotes: boolean
  scrub: boolean
  design: DesignSource
  deckTitle: string
  slides: Draft[]
}

const AUDIENCES = ['교사', '학생', '학부모', '교직원 전체', '위원회 위원']
const COUNTS = [5, 8, 10, 12, 15, 20]

const HINTS: Record<SlideKind, string> = {
  표지: '작은 글 — 날짜 · 부서 · 발표자',
  구역: '작은 글 — 이 단락에서 다룰 것',
  목록: '한 줄에 하나씩 (6줄 이내)',
  카드: '한 줄에 카드 하나 — "제목: 내용" (2~4개)',
  표: '한 줄에 한 행 — "칸 | 칸 | 칸" (첫 줄은 머리)',
  마무리: '작은 글 — 문의처 · 질의응답 안내'
}

let seq = 1
const toDraft = (s: Slide): Draft => ({ key: seq++, kind: s.kind, title: s.title, body: bodyText(s), notes: s.notes ?? '' })
const toSlide = (d: Draft): Slide => withBody({ kind: d.kind, title: d.title, notes: d.notes.trim() || undefined }, d.body)

/** 다른 화면에 다녀와도 만들던 것이 남아 있게 한다 (프로그램을 끄면 사라진다) */
let kept: State | null = null

const INITIAL: State = {
  topic: '',
  audience: '교사',
  count: 8,
  minutes: '',
  material: '',
  wantNotes: true,
  scrub: true,
  design: builtinSource('blue'),
  deckTitle: '',
  slides: []
}

/** 미리보기 한 장. 실제 PPT 와 똑같지는 않고 대략의 모양이다. */
function Thumb({ slide, theme, deckTitle }: { slide: Slide; theme: SlideTheme; deckTitle: string }): JSX.Element {
  const c = (hex: string): string => `#${hex}`
  const cover = slide.kind === '표지' || slide.kind === '마무리'
  const bg = cover ? (theme.darkCover ? theme.deep : theme.bg) : slide.kind === '구역' ? theme.surface : theme.bg
  const dark = (() => {
    const n = parseInt(bg, 16)
    return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 128
  })()
  const titleColor = dark ? '#fff' : c(theme.deep)
  const font = `'${theme.bodyFont}', 'Malgun Gothic', sans-serif`
  return (
    <div className="slide-thumb" style={{ background: c(bg), color: dark ? '#e5e7eb' : c(theme.ink), fontFamily: font }}>
      {!cover && slide.kind !== '구역' && <div className="slide-thumb-bar" style={{ background: c(theme.accent) }} />}
      {slide.kind === '구역' && <div className="slide-thumb-side" style={{ background: c(theme.accent) }} />}
      {cover ? (
        <div className="slide-thumb-cover">
          <div className="slide-thumb-title big" style={{ color: titleColor }}>
            {slide.title || (slide.kind === '마무리' ? '감사합니다' : deckTitle)}
          </div>
          <div className="slide-thumb-rule" style={{ background: c(theme.accent) }} />
          {slide.sub && <div className="slide-thumb-sub">{slide.sub}</div>}
        </div>
      ) : slide.kind === '구역' ? (
        <div className="slide-thumb-cover" style={{ paddingLeft: '14%' }}>
          <div className="slide-thumb-title big" style={{ color: titleColor }}>
            {slide.title}
          </div>
          {slide.sub && <div className="slide-thumb-sub">{slide.sub}</div>}
        </div>
      ) : (
        <div className="slide-thumb-body">
          <div className="slide-thumb-title" style={{ color: titleColor }}>
            {slide.title}
          </div>
          {slide.kind === '카드' && (
            <div className="slide-thumb-cards">
              {(slide.cards ?? []).map((cd, i) => (
                <div key={i} className="slide-thumb-card" style={{ background: c(theme.surface) }}>
                  <b style={{ color: c(theme.accent) }}>{cd.title}</b>
                  <span>{cd.body}</span>
                </div>
              ))}
            </div>
          )}
          {slide.kind === '표' && (
            <table className="slide-thumb-table">
              <tbody>
                {(slide.table ?? []).map((r, i) => (
                  <tr key={i}>
                    {r.map((cell, j) => (
                      <td
                        key={j}
                        style={i === 0 ? { background: c(theme.deep), color: '#fff', fontWeight: 700 } : undefined}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {slide.kind === '목록' && (
            <ul className="slide-thumb-list">
              {(slide.bullets ?? []).map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default function Slides({ onGo }: Props): JSX.Element {
  const toast = useToast()
  const ask = useConfirm()
  const [st, setSt] = useState<State>(kept ?? INITIAL)
  const [hasKey, setHasKey] = useState(true)
  const [model, setModel] = useState<ModelChoice | null>(null)
  const [busy, setBusy] = useState<'' | '짜는 중' | '읽는 중' | '저장 중'>('')
  const [hits, setHits] = useState<ScrubHit[]>([])
  const [saved, setSaved] = useState<{ path: string; notes: string[] } | null>(null)

  useEffect(() => {
    kept = st
  }, [st])

  useEffect(() => {
    void (async () => {
      const s = await window.api.local.load()
      setHasKey(!!(s.openai_key || s.gemini_key || s.claude_key))
    })()
  }, [])

  const set = <K extends keyof State>(key: K, value: State[K]): void => setSt((s) => ({ ...s, [key]: value }))
  const setSlide = (i: number, patch: Partial<Draft>): void =>
    setSt((s) => ({ ...s, slides: s.slides.map((d, j) => (j === i ? { ...d, ...patch } : d)) }))

  const deck: Deck = useMemo(
    () => ({ title: st.deckTitle.trim() || st.topic.trim() || '발표자료', slides: st.slides.map(toSlide) }),
    [st.deckTitle, st.topic, st.slides]
  )

  /* ---------- 자료 ---------- */

  const addFiles = async (): Promise<void> => {
    const picked = await window.api.files.pick()
    if (!picked.length) return
    setBusy('읽는 중')
    try {
      const parts: string[] = []
      for (const p of picked) {
        const doc = await window.api.files.extract(p.path)
        if (doc.error) toast(`${p.name}: ${doc.error}`, 'err')
        else if (doc.text.trim()) parts.push(`--- ${p.name} ---\n${doc.text.trim()}`)
      }
      if (parts.length) {
        setSt((s) => ({ ...s, material: [s.material.trim(), ...parts].filter(Boolean).join('\n\n') }))
        toast(`${parts.length}개 파일의 글을 가져왔습니다.`, 'ok')
      }
    } finally {
      setBusy('')
    }
  }

  /* ---------- 디자인 ---------- */

  const pickDesign = async (): Promise<void> => {
    const res = await window.api.slides.pickDesign()
    if (res.ok && res.source) {
      set('design', res.source)
      setSaved(null)
      toast(`'${res.source.label}' 를 디자인 참고로 씁니다.`, 'ok')
    } else if (res.error) toast(res.error, 'err')
  }

  /* ---------- 만들기 ---------- */

  const draft = async (): Promise<void> => {
    if (!st.topic.trim()) {
      toast('주제를 적어 주세요.', 'err')
      return
    }
    if (st.slides.length) {
      const ok = await ask({
        title: '슬라이드를 새로 짤까요?',
        body: '지금 고쳐 둔 슬라이드는 사라집니다.',
        okText: '새로 짜기'
      })
      if (!ok) return
    }
    setBusy('짜는 중')
    setSaved(null)
    setHits([])
    try {
      let material = st.material
      if (st.scrub && material.trim()) {
        const res = await window.api.privacy.scrub(material)
        material = res.text
        setHits(res.hits)
      }
      const res = await window.api.slides.draft({
        input: {
          topic: st.topic.trim(),
          audience: st.audience.trim(),
          count: st.count,
          minutes: Number(st.minutes) || 0,
          material,
          notes: st.wantNotes
        },
        model: model ?? undefined
      })
      if (!res.ok || !res.deck) {
        toast(res.error ?? '만들지 못했습니다.', 'err')
        return
      }
      const d = res.deck
      setSt((s) => ({ ...s, deckTitle: d.title, slides: d.slides.map(toDraft) }))
      toast(`슬라이드 ${d.slides.length}장을 짰습니다. 고친 뒤 저장하세요.`, 'ok')
    } finally {
      setBusy('')
    }
  }

  const move = (i: number, by: number): void =>
    setSt((s) => {
      const j = i + by
      if (j < 0 || j >= s.slides.length) return s
      const next = [...s.slides]
      ;[next[i], next[j]] = [next[j], next[i]]
      return { ...s, slides: next }
    })

  const remove = (i: number): void => setSt((s) => ({ ...s, slides: s.slides.filter((_, j) => j !== i) }))

  const insertAfter = (i: number): void =>
    setSt((s) => {
      const next = [...s.slides]
      next.splice(i + 1, 0, { key: seq++, kind: '목록', title: '새 슬라이드', body: '', notes: '' })
      return { ...s, slides: next }
    })

  const save = async (): Promise<void> => {
    if (!deck.slides.length) return
    setBusy('저장 중')
    try {
      const res = await window.api.slides.save({ deck, design: st.design })
      if (res.ok && res.path) {
        setSaved({ path: res.path, notes: res.notes })
        toast(res.message, 'ok')
      } else toast(res.message, 'err')
      for (const n of res.notes) if (!res.ok) toast(n, 'info')
    } finally {
      setBusy('')
    }
  }

  const reset = async (): Promise<void> => {
    const ok = await ask({ title: '처음부터 다시 할까요?', body: '적어 둔 주제·자료·슬라이드가 모두 비워집니다.', okText: '비우기', danger: true })
    if (!ok) return
    setSt(INITIAL)
    setSaved(null)
    setHits([])
  }

  const theme = st.design.theme

  return (
    <>
      <div className="page-head">
        <h1>발표자료 만들기</h1>
        <p>
          주제와 자료를 주면 AI가 슬라이드 내용과 발표 메모를 짜고, 고른 디자인으로 PowerPoint 파일(.pptx)을
          만듭니다. 학교에서 쓰던 PPT를 참고로 주면 그 배경·장식·글꼴을 그대로 씁니다.
        </p>
      </div>

      <div className="card">
        <div className="card-title">
          <span>1. 무엇을 발표하나요</span>
          {(st.topic || st.slides.length > 0) && (
            <button className="btn btn-sm btn-ghost" onClick={() => void reset()}>
              처음부터
            </button>
          )}
        </div>
        <div className="field">
          <label>주제</label>
          <input
            type="text"
            value={st.topic}
            onChange={(e) => set('topic', e.target.value)}
            placeholder="예: 2학기 학교폭력 예방 교사 연수"
          />
        </div>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <label>듣는 사람</label>
            <input type="text" list="slide-audiences" value={st.audience} onChange={(e) => set('audience', e.target.value)} />
            <datalist id="slide-audiences">
              {AUDIENCES.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 110 }}>
            <label>장수</label>
            <select value={st.count} onChange={(e) => set('count', Number(e.target.value))}>
              {COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n}장 안팎
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 110 }}>
            <label>발표 시간(분)</label>
            <input
              type="text"
              inputMode="numeric"
              value={st.minutes}
              onChange={(e) => set('minutes', e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
              placeholder="예: 20"
            />
          </div>
        </div>
        <div className="field">
          <label className="row" style={{ justifyContent: 'space-between' }}>
            <span>자료 (공문 · 지침 · 메모)</span>
            <button className="btn btn-sm" onClick={() => void addFiles()} disabled={!!busy}>
              {busy === '읽는 중' ? '읽는 중…' : '📄 파일에서 가져오기'}
            </button>
          </label>
          <textarea
            value={st.material}
            onChange={(e) => set('material', e.target.value)}
            style={{ minHeight: 160 }}
            placeholder="발표에 담을 내용을 붙여 넣거나 파일에서 가져오세요. AI는 여기 있는 사실만 씁니다. 비워 두면 주제에 맞는 일반적인 구성으로 짭니다."
          />
          <div className="hint">{st.material.length.toLocaleString()}자 · 앞에서 24,000자까지 AI에 보냅니다.</div>
        </div>
        <div className="row" style={{ gap: 16 }}>
          <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={st.wantNotes} onChange={(e) => set('wantNotes', e.target.checked)} />
            발표 메모(대본)도 쓰기
          </label>
          <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={st.scrub} onChange={(e) => set('scrub', e.target.checked)} />
            자료 속 이름·연락처·학번은 ○○○ 으로 가리고 보내기
          </label>
        </div>
        {hits.length > 0 && (
          <div className="note note-info" style={{ marginTop: 10 }}>
            보내기 전에 가렸습니다: {hits.map((h) => `${h.label} ${h.n}곳`).join(', ')}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">2. 디자인</div>
        <div className="design-grid">
          {BUILTIN_DESIGNS.map((d) => {
            const on = st.design.kind === 'builtin' && st.design.builtinId === d.id
            return (
              <button
                key={d.id}
                className={`design-tile ${on ? 'active' : ''}`}
                onClick={() => {
                  set('design', builtinSource(d.id))
                  setSaved(null)
                }}
              >
                <div className="design-swatch" style={{ background: `#${d.theme.darkCover ? d.theme.deep : d.theme.bg}` }}>
                  <span style={{ background: `#${d.theme.accent}` }} />
                  <span style={{ background: `#${d.theme.surface}` }} />
                </div>
                <div className="design-name">{d.name}</div>
              </button>
            )
          })}
          <button className={`design-tile ${st.design.kind !== 'builtin' ? 'active' : ''}`} onClick={() => void pickDesign()}>
            <div className="design-swatch design-file">📎</div>
            <div className="design-name">
              {st.design.kind !== 'builtin' ? st.design.label : '참고 파일 고르기'}
            </div>
          </button>
        </div>
        {st.design.kind === 'builtin' ? (
          <p className="hint" style={{ marginBottom: 0 }}>
            학교에서 쓰던 PPT(.pptx)를 참고 파일로 고르면 그 파일의 <b>배경 · 장식 · 글꼴 · 색</b>을 그대로 쓰고
            슬라이드만 새로 넣습니다. getdesign.md 같은 곳에서 받은 <b>DESIGN.md</b> 도 고를 수 있습니다(색만 가져옵니다).
          </p>
        ) : (
          <div className="note note-info" style={{ marginTop: 4 }}>
            <b>{st.design.label}</b>
            {(st.design.notes ?? []).map((n) => (
              <div key={n} className="small" style={{ marginTop: 3 }}>
                · {n}
              </div>
            ))}
            {st.design.kind === 'pptx' && (
              <div className="small" style={{ marginTop: 3 }}>
                · 참고 파일의 원래 슬라이드 내용·그림·메모는 새 파일에 들어가지 않습니다.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">3. 슬라이드 짜기</div>
        {hasKey ? (
          <>
            <ModelPicker feature="scenario" label="발표자료에 쓸 모델" onReady={setModel} onChange={setModel} />
            <div className="row">
              <button className="btn btn-primary" onClick={() => void draft()} disabled={!!busy || !st.topic.trim()}>
                {busy === '짜는 중' ? 'AI가 슬라이드를 짜는 중…' : st.slides.length ? '✨ 새로 짜기' : '✨ 슬라이드 내용 만들기'}
              </button>
              <span className="muted small">내용은 AI가, 모양은 프로그램이 입힙니다.</span>
            </div>
          </>
        ) : (
          <div className="note note-warn">
            API 키가 필요합니다.{' '}
            <button className="link" onClick={() => onGo('설정')}>
              설정으로
            </button>
          </div>
        )}
      </div>

      {st.slides.length > 0 && (
        <div className="card">
          <div className="card-title">
            <span>4. 고치고 저장하기</span>
            <span className="badge">{st.slides.length}장</span>
          </div>
          <div className="note note-warn" style={{ marginBottom: 12 }}>
            <b>그대로 쓰지 마세요.</b> AI가 짠 초안입니다. 날짜·수치·법 조항은 반드시 확인하세요. 미리보기는 대략의
            모양이고, 실제 모양은 PowerPoint에서 확인하세요.
          </div>
          <div className="field">
            <label>발표 제목 (파일 이름)</label>
            <input type="text" value={st.deckTitle} onChange={(e) => set('deckTitle', e.target.value)} />
          </div>

          <div className="slide-list">
            {st.slides.map((d, i) => (
              <div className="slide-row" key={d.key}>
                <Thumb slide={deck.slides[i]} theme={theme} deckTitle={deck.title} />
                <div className="slide-edit">
                  <div className="row" style={{ marginBottom: 6 }}>
                    <span className="badge">{i + 1}</span>
                    <select
                      value={d.kind}
                      onChange={(e) => setSlide(i, { kind: e.target.value as SlideKind })}
                      style={{ width: 'auto' }}
                    >
                      {SLIDE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                    <div className="row" style={{ marginLeft: 'auto', gap: 2 }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => move(i, -1)} disabled={i === 0} title="위로">
                        ↑
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => move(i, 1)}
                        disabled={i === st.slides.length - 1}
                        title="아래로"
                      >
                        ↓
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => insertAfter(i)} title="아래에 새 슬라이드">
                        ＋
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => remove(i)} title="이 슬라이드 빼기">
                        ✕
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={d.title}
                    onChange={(e) => setSlide(i, { title: e.target.value })}
                    placeholder="제목"
                    style={{ marginBottom: 6 }}
                  />
                  <textarea
                    value={d.body}
                    onChange={(e) => setSlide(i, { body: e.target.value })}
                    placeholder={HINTS[d.kind]}
                    style={{ minHeight: 84 }}
                  />
                  <div className="muted small">{HINTS[d.kind]}</div>
                  <details style={{ marginTop: 4 }}>
                    <summary className="muted small" style={{ cursor: 'pointer' }}>
                      발표 메모 {d.notes.trim() ? `(${d.notes.trim().length}자)` : '(없음)'}
                    </summary>
                    <textarea
                      value={d.notes}
                      onChange={(e) => setSlide(i, { notes: e.target.value })}
                      style={{ minHeight: 70, marginTop: 4 }}
                      placeholder="이 슬라이드를 넘기며 할 말. PowerPoint의 [슬라이드 노트]에 들어갑니다."
                    />
                  </details>
                </div>
              </div>
            ))}
          </div>

          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn btn-primary" onClick={() => void save()} disabled={!!busy}>
              {busy === '저장 중' ? '만드는 중…' : '💾 PowerPoint 파일로 저장 (.pptx)'}
            </button>
            <span className="muted small">디자인: {st.design.label}</span>
          </div>

          {saved && (
            <div className="note note-ok" style={{ marginTop: 12 }}>
              저장했습니다: {saved.path}
              {saved.notes.map((n) => (
                <div key={n} className="small" style={{ marginTop: 3 }}>
                  · {n}
                </div>
              ))}
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn btn-sm btn-primary" onClick={() => void window.api.hwp.open(saved.path)}>
                  PowerPoint로 열기
                </button>
                <button className="btn btn-sm" onClick={() => void window.api.hwp.reveal(saved.path)}>
                  폴더 열기
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
