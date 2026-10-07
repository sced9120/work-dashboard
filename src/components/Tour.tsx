import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PageId } from '../App'
import { NAV_GROUPS, navLabel } from '../lib/nav'
import type { Tour, TourStep } from '../lib/tours'
import { TOURS, TOUR_ORDER } from '../lib/tours'
import { useToast } from '../lib/toast'
import Icon from './Icon'

/**
 * 따라 배우기.
 *  - 목록(Hub): 메뉴마다 배웠는지 보여 주고, 하나씩 또는 처음부터 차례로 시작한다.
 *  - 안내(Coach): 실제 화면 위에서 대상을 밝게 비추고 설명을 띄운다. 직접 눌러야 하는 단계는
 *    비춘 곳만 누를 수 있고, 누르면 다음으로 넘어간다.
 *  - 처음 안내(Invite): 처음 켰을 때 한 번만 오른쪽 아래에 뜬다.
 * 배운 기록은 이 PC 의 localStorage 에 둔다(인수인계 파일로 넘어가지 않는다 — 받는 사람도 처음부터 배운다).
 */

const DONE_KEY = 'wd_tour_done'
const INVITE_KEY = 'wd_tour_invited'

function readDone(): PageId[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(DONE_KEY) || '[]') as unknown
    return Array.isArray(v) ? (v.filter((x) => typeof x === 'string' && x in TOURS) as PageId[]) : []
  } catch {
    return []
  }
}

function writeDone(v: PageId[]): void {
  try {
    window.localStorage.setItem(DONE_KEY, JSON.stringify(v))
  } catch {
    // 저장이 막혀도 이번 실행 동안은 기억한다
  }
}

const shown = (el: Element): boolean => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

/** 단계가 가리키는 화면 요소를 찾는다. 없으면 null */
function locate(step: TourStep): HTMLElement | null {
  if (!step.sel) return null
  const hit = Array.from(document.querySelectorAll<HTMLElement>(step.sel)).find((el) => {
    if (!shown(el)) return false
    if (!step.text) return true
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
    return step.exact ? t === step.text : t.includes(step.text)
  })
  if (!hit) return null
  if (step.up) return hit.parentElement?.closest<HTMLElement>(step.up) ?? hit
  return hit
}

interface Hole {
  left: number
  top: number
  width: number
  height: number
}

const POP_W = 340
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi))

/* ---------- 한 화면 안내 ---------- */

function Coach({ tour, onGo, onExit }: { tour: Tour; onGo: (p: PageId) => void; onExit: (finished: boolean) => void }): JSX.Element {
  const steps = tour.steps
  const [i, setI] = useState(0)
  const [hole, setHole] = useState<Hole | null>(null)
  const [missing, setMissing] = useState(false)
  const [popH, setPopH] = useState(210)
  const elRef = useRef<HTMLElement | null>(null)
  const dirRef = useRef(1)
  const popRef = useRef<HTMLDivElement>(null)
  const step = steps[i]
  const last = i === steps.length - 1
  const acting = !!step.click && !missing && !!hole

  const go = (d: number): void => {
    dirRef.current = d
    const n = i + d
    if (n >= steps.length) onExit(true)
    else if (n >= 0) setI(n)
  }

  // 먼저 그 화면으로 간다
  useEffect(() => {
    onGo(tour.page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const measure = (): void => {
    let el = elRef.current
    if (el && !el.isConnected) {
      el = locate(steps[i])
      elRef.current = el
    }
    if (!el) return
    const r = el.getBoundingClientRect()
    const pad = 6
    const left = Math.max(4, r.left - pad)
    const top = Math.max(4, r.top - pad)
    const right = Math.min(window.innerWidth - 4, r.right + pad)
    const bottom = Math.min(window.innerHeight - 4, r.bottom + pad)
    if (right - left < 4 || bottom - top < 4) {
      setHole(null)
      return
    }
    setHole((h) =>
      h && Math.abs(h.left - left) < 0.5 && Math.abs(h.top - top) < 0.5 && Math.abs(h.width - (right - left)) < 0.5 && Math.abs(h.height - (bottom - top)) < 0.5
        ? h
        : { left, top, width: right - left, height: bottom - top }
    )
  }

  // 대상을 찾는다. 화면이 자료를 불러오는 동안 잠깐 기다린다.
  useEffect(() => {
    let alive = true
    let tries = 0
    let timer = 0
    elRef.current = null
    setHole(null)
    setMissing(false)
    const find = (): void => {
      if (!alive) return
      const el = locate(steps[i])
      if (el) {
        elRef.current = el
        el.scrollIntoView({ block: 'center', inline: 'nearest' })
        measure()
        return
      }
      if (++tries < 16) {
        timer = window.setTimeout(find, 150)
        return
      }
      if (steps[i].optional) {
        const n = i + dirRef.current
        if (n >= steps.length) onExit(true)
        else setI(Math.max(0, n))
        return
      }
      setMissing(true)
    }
    timer = window.setTimeout(find, i === 0 ? 300 : 120)
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i])

  // 화면이 움직이면 따라간다 (스크롤 · 창 크기 · 늦게 그려지는 칸)
  useEffect(() => {
    const t = window.setInterval(measure, 200)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      clearInterval(t)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i])

  // 직접 눌러 보는 단계: 비춘 곳을 누르면 다음으로
  useEffect(() => {
    if (!acting) return
    const onClick = (e: MouseEvent): void => {
      const el = elRef.current
      if (el && e.target instanceof Node && el.contains(e.target)) window.setTimeout(() => go(1), 320)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, acting])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onExit(false)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        go(1)
      } else if (e.key === 'ArrowLeft' && i > 0) {
        e.preventDefault()
        go(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i])

  useLayoutEffect(() => {
    if (popRef.current) setPopH(popRef.current.offsetHeight)
  })

  // 설명 상자 자리: 아래 → 위 → 오른쪽 → 왼쪽 → 맨 아래
  const vw = window.innerWidth
  const vh = window.innerHeight
  const gap = 14
  let left = (vw - POP_W) / 2
  let top = (vh - popH) / 2
  if (hole && !missing) {
    left = hole.left + hole.width / 2 - POP_W / 2
    if (vh - (hole.top + hole.height) - gap >= popH) top = hole.top + hole.height + gap
    else if (hole.top - gap >= popH) top = hole.top - gap - popH
    else if (vw - (hole.left + hole.width) - gap >= POP_W) {
      left = hole.left + hole.width + gap
      top = hole.top + hole.height / 2 - popH / 2
    } else if (hole.left - gap >= POP_W) {
      left = hole.left - gap - POP_W
      top = hole.top + hole.height / 2 - popH / 2
    } else top = vh - popH - 16
  }
  left = clamp(left, 12, vw - POP_W - 12)
  top = clamp(top, 12, vh - popH - 12)
  const h = hole && !missing ? hole : null

  return createPortal(
    <div className="tour-root" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {h ? (
        <>
          <div className={`tour-hole ${acting ? 'act' : ''}`} style={h} />
          <div className="tour-block" style={{ left: 0, top: 0, right: 0, height: h.top }} />
          <div className="tour-block" style={{ left: 0, top: h.top + h.height, right: 0, bottom: 0 }} />
          <div className="tour-block" style={{ left: 0, top: h.top, width: h.left, height: h.height }} />
          <div className="tour-block" style={{ left: h.left + h.width, top: h.top, right: 0, height: h.height }} />
          {!acting && <div className="tour-block" style={h} />}
        </>
      ) : (
        <div className="tour-dim" />
      )}

      <div className="tour-pop" ref={popRef} style={{ left, top, width: POP_W }}>
        <div className="tour-pop-top">
          <span className="tour-where">{navLabel(tour.page)} 배우기</span>
          <span className="tour-count">
            {i + 1} / {steps.length}
          </span>
        </div>
        <div className="tour-bar">
          <i style={{ width: `${((i + 1) / steps.length) * 100}%` }} />
        </div>
        <h3 id="tour-title">{step.title}</h3>
        <p>{step.body}</p>
        {missing && <p className="tour-miss">지금 화면에는 이 부분이 보이지 않습니다. 자료가 생기면 나타납니다.</p>}
        {acting && <p className="tour-do">👆 밝게 표시된 곳을 직접 눌러 보세요</p>}
        <div className="tour-btns">
          <button className="btn btn-sm btn-ghost" onClick={() => onExit(false)}>
            그만하기
          </button>
          <span className="spacer" />
          {i > 0 && (
            <button className="btn btn-sm" onClick={() => go(-1)}>
              이전
            </button>
          )}
          <button className="btn btn-sm btn-primary" onClick={() => go(1)} autoFocus>
            {last ? '다 배웠어요' : acting ? '건너뛰기' : '다음'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ---------- 목록 ---------- */

interface HubProps {
  page: PageId
  done: PageId[]
  onClose: () => void
  onStart: (p: PageId) => void
  onStartAll: () => void
  onReset: () => void
}

function Hub({ page, done, onClose, onStart, onStartAll, onReset }: HubProps): JSX.Element {
  const total = TOUR_ORDER.length
  const n = done.length

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="tour-hub-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tour-hub" role="dialog" aria-modal="true" aria-labelledby="tour-hub-title">
        <div className="tour-hub-head">
          <div>
            <h2 id="tour-hub-title">따라 배우기</h2>
            <p>
              실제 화면 위에서 한 단계씩 짚어 드립니다. 직접 눌러 보는 단계도 화면만 바뀌고 업무 · 일정 같은 자료는 바뀌지
              않습니다.
            </p>
          </div>
          <button className="tour-x" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <div className="tour-hub-prog">
          <div className="tour-bar">
            <i style={{ width: `${(n / total) * 100}%` }} />
          </div>
          <span>
            {total}개 메뉴 중 {n}개 배움
          </span>
        </div>

        <div className="row tour-hub-acts">
          <button className="btn btn-primary btn-sm" onClick={onStartAll}>
            {n === 0 ? '▶ 처음부터 차례로' : n < total ? '▶ 안 배운 것부터 차례로' : '▶ 처음부터 다시'}
          </button>
          <button className="btn btn-sm" onClick={() => onStart(page)}>
            지금 화면 배우기 · {navLabel(page)}
          </button>
          {n > 0 && (
            <button className="btn btn-sm btn-ghost" onClick={onReset}>
              배운 기록 지우기
            </button>
          )}
        </div>

        <div className="tour-hub-list">
          {NAV_GROUPS.map((g) => (
            <div className="tour-hub-group" key={g.section}>
              <div className="tour-hub-sec">{g.section}</div>
              {g.items.map((it) => {
                const t = TOURS[it.id]
                const ok = done.includes(it.id)
                return (
                  <button key={it.id} className={`tour-item ${ok ? 'done' : ''} ${it.id === page ? 'here' : ''}`} onClick={() => onStart(it.id)}>
                    <span className="tour-item-ico">
                      <Icon name={it.icon} />
                    </span>
                    <span className="tour-item-body">
                      <b>{it.label}</b>
                      <small>
                        {t.intro} · {t.steps.length}단계
                      </small>
                    </span>
                    <span className="tour-item-state">
                      {ok ? (
                        <>
                          <Icon name="check" size={13} /> 배움
                        </>
                      ) : it.id === page ? (
                        '지금 화면'
                      ) : (
                        '배우기'
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <p className="tour-hub-tip">F1을 누르면 어느 화면에서든 그 화면을 바로 배웁니다. 배우는 중에는 Esc로 멈추고 ← → 로 넘깁니다.</p>
      </div>
    </div>,
    document.body
  )
}

/* ---------- 처음 안내 ---------- */

function Invite({ onOpen, onLater }: { onOpen: () => void; onLater: () => void }): JSX.Element {
  return (
    <div className="tour-invite" role="dialog" aria-labelledby="tour-invite-title">
      <span className="tour-invite-ico">
        <Icon name="cap" size={22} />
      </span>
      <div className="tour-invite-body">
        <b id="tour-invite-title">처음 쓰시나요?</b>
        <p>메뉴마다 실제 화면 위에서 따라 하며 배울 수 있습니다. 홈부터 차례로 하면 10분쯤 걸립니다.</p>
        <div className="row">
          <button className="btn btn-primary btn-sm" onClick={onOpen}>
            따라 배우기 열기
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onLater}>
            나중에
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- 묶음 ---------- */

interface Props {
  page: PageId
  onGo: (p: PageId) => void
  hub: boolean
  onHub: (open: boolean) => void
  running: PageId | null
  onRun: (p: PageId | null) => void
}

export default function TourHost({ page, onGo, hub, onHub, running, onRun }: Props): JSX.Element {
  const toast = useToast()
  const [done, setDone] = useState<PageId[]>(readDone)
  /** 처음부터 차례로 배우는 중인지 */
  const [seq, setSeq] = useState(false)
  const [invite, setInvite] = useState(() => {
    try {
      return !window.localStorage.getItem(INVITE_KEY)
    } catch {
      return false
    }
  })

  const closeInvite = (): void => {
    setInvite(false)
    try {
      window.localStorage.setItem(INVITE_KEY, '1')
    } catch {
      // 다음에 또 뜰 뿐이다
    }
  }

  const start = (p: PageId, all = false): void => {
    closeInvite()
    onHub(false)
    setSeq(all)
    onRun(p)
  }

  const finish = (finished: boolean): void => {
    const cur = running
    onRun(null)
    if (!cur) return
    if (!finished) {
      setSeq(false)
      return
    }
    const next = done.includes(cur) ? done : [...done, cur]
    setDone(next)
    writeDone(next)
    if (seq) {
      const after = TOUR_ORDER.slice(TOUR_ORDER.indexOf(cur) + 1).find((p) => !next.includes(p))
      if (after) {
        toast(`「${navLabel(cur)}」 배우기를 마쳤습니다. 이어서 「${navLabel(after)}」입니다.`, 'ok')
        window.setTimeout(() => onRun(after), 450)
        return
      }
      setSeq(false)
      toast('모든 메뉴를 다 배웠습니다. 언제든 F1로 다시 볼 수 있습니다.', 'ok')
      return
    }
    toast(`「${navLabel(cur)}」 배우기를 마쳤습니다.`, 'ok')
  }

  const startAll = (): void => {
    const first = TOUR_ORDER.find((p) => !done.includes(p))
    if (first) {
      start(first, true)
      return
    }
    setDone([])
    writeDone([])
    start(TOUR_ORDER[0], true)
  }

  return (
    <>
      {hub && (
        <Hub
          page={page}
          done={done}
          onClose={() => onHub(false)}
          onStart={(p) => start(p)}
          onStartAll={startAll}
          onReset={() => {
            setDone([])
            writeDone([])
          }}
        />
      )}
      {running && <Coach key={running} tour={TOURS[running]} onGo={onGo} onExit={finish} />}
      {/* 다른 화면의 단추를 가리지 않게 홈에서만 띄운다 */}
      {invite && page === '홈' && !hub && !running && (
        <Invite
          onOpen={() => {
            closeInvite()
            onHub(true)
          }}
          onLater={closeInvite}
        />
      )}
    </>
  )
}
