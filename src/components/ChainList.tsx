import { useEffect, useMemo, useState } from 'react'
import { ymd } from '../../shared/neis'
import type { SchoolTimetable, TtRules } from '../../shared/timetable'
import { dayIndex, gradeOf, slotKey, weekDate } from '../../shared/timetable'
import type { ChainKind, ChainOption } from '../../shared/ttchain'
import { findChains } from '../../shared/ttchain'
import { useToast } from '../lib/toast'

interface Props {
  tt: SchoolTimetable
  rules: TtRules
  /** 수업을 비우는 선생님 */
  who: string
  /** 나 (내 시간표에 손으로 적은 칸 · 우리 반 창체를 쓰려고) */
  me: string
  manual: Record<string, string>
  myClass: string
  /** 비울 날 */
  date: string
  /** 비울 교시 (0부터) */
  period: number
  /** 블록 · 창체 수업이라 맞바꾸지 않는다 */
  locked: boolean
  notes: string[]
  cls: string
  subject: string
  /** 동교과 선생님 — 이분들과 함께 바꾸는 방법을 앞에 둔다 */
  peers: ReadonlySet<string>
}

/** 함께 바꿀 선생님이 모두 동교과면 0, 일부면 1, 없으면 2 */
function peerRank(o: ChainOption, peers: ReadonlySet<string>): number {
  const n = o.teachers.filter((t) => peers.has(t)).length
  return n && n === o.teachers.length ? 0 : n ? 1 : 2
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const md = (day: string): string => {
  const d = new Date(`${day}T00:00:00`)
  return `${d.getMonth() + 1}. ${d.getDate()}.(${WEEK[d.getDay()]})`
}

const KINDS: { kind: ChainKind; label: string; help: string }[] = [
  { kind: '맞교체', label: '1:1 맞교체', help: '같은 반의 수업 둘을 맞바꿉니다' },
  { kind: '순환 교체', label: '순환 교체', help: '한 반 안에서 수업 셋이 돌아가며 자리를 바꿉니다' },
  { kind: '2중 교체', label: '2중 교체', help: '맞바꾼 선생님이 옮겨 간 시간에 다른 반 수업이 있어, 그 반 수업도 함께 맞바꿉니다' },
  { kind: '3중 교체', label: '3중 교체', help: '그렇게 한 번 더 이어서 맞바꿉니다' }
]

/**
 * 교체 방법 — 1:1 맞교체를 먼저, 그다음 순환 교체 · 2중 교체를 보여 준다. 3중 교체는 눌러야 찾는다(오래 걸릴 수 있다).
 * 수업마다 어디서 어디로 옮기는지 날짜와 함께 보여 주고, 복사해 메신저 · 교체 신청서에 붙일 수 있다.
 */
export default function ChainList({ tt, rules, who, me, manual, myClass, date, period, locked, notes, cls, subject, peers }: Props): JSX.Element {
  const toast = useToast()
  const [deep, setDeep] = useState(false)
  /** 동교과 선생님과 함께 바꾸는 방법을 먼저 */
  const [peerFirst, setPeerFirst] = useState(true)
  const [searching, setSearching] = useState(false)
  const [kind, setKind] = useState<ChainKind | ''>('')
  const [shown, setShown] = useState(8)
  const d1 = dayIndex(date)
  const today = ymd(new Date())

  // 다른 수업을 고르면 처음부터
  useEffect(() => {
    setDeep(false)
    setKind('')
    setShown(8)
  }, [who, date, period])

  const options = useMemo<ChainOption[]>(() => {
    if (locked || d1 < 0) return []
    const myGrade = String(gradeOf(myClass))
    const meBusy =
      who === me
        ? (d: number, p: number): boolean =>
            !!manual[slotKey(d, p)]?.trim() || !!rules.cce[myGrade]?.includes(slotKey(d, p)) || !!rules.club?.[myGrade]?.includes(slotKey(d, p))
        : undefined
    // 이미 지난 날로는 옮기지 않는다
    return findChains(tt, who, d1, period, rules, { maxSteps: deep ? 3 : 2, meBusy, allowed: (d) => weekDate(date, d) >= today })
  }, [tt, rules, who, me, manual, myClass, date, period, d1, locked, deep, today])

  // 찾은 차례(간단한 것 · 가까운 날 먼저)는 그대로 두고 동교과만 앞으로
  const ranked = useMemo(
    () => (peerFirst && peers.size ? options.map((o, i) => ({ o, i, r: peerRank(o, peers) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.o) : options),
    [options, peerFirst, peers]
  )
  const peerCount = useMemo(() => options.filter((o) => peerRank(o, peers) < 2).length, [options, peers])

  useEffect(() => setSearching(false), [options])

  const counts = KINDS.map((k) => ({ ...k, n: options.filter((o) => o.kind === k.kind).length }))
  const list = kind ? ranked.filter((o) => o.kind === kind) : ranked
  const label = (t: string): string => (t === me ? '나' : `${t} 선생님`)
  const at = (d: number, p: number): string => `${md(weekDate(date, d))} ${tt.periods[p]?.label ?? `${p + 1}교시`}`

  const text = (o: ChainOption): string =>
    [
      `[${o.kind === '맞교체' ? '1:1 맞교체' : o.kind}] ${at(d1, period)} ${cls} ${subject}(${label(who)}) 비우기`,
      ...o.moves.map((m) => `- ${m.cls} ${m.subject}(${m.teachers.map(label).join(', ')}): ${at(m.from.day, m.from.period)} → ${at(m.to.day, m.to.period)}`)
    ].join('\n')

  const copy = async (o: ChainOption): Promise<void> => {
    await window.api.clipboard.write(text(o))
    toast('복사했습니다. 메신저나 교체 신청서에 붙여넣으세요.', 'ok')
  }

  const searchDeep = (): void => {
    setSearching(true)
    // 찾는 중이라고 먼저 그리고 나서 찾는다 (3중은 1초쯤 걸릴 수 있다)
    setTimeout(() => setDeep(true), 30)
  }

  return (
    <div className="card">
      <div className="card-title">
        <span>
          2. 교체 — {at(d1, period)} {cls} {subject}
        </span>
        <span className="badge">{options.length}가지</span>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        1:1 맞교체를 먼저 보여 드리고, 안 되거나 더 고를 때를 위해 순환 교체 · 2중 교체도 찾습니다. 모두 같은 주 안에서, 지난 날과 블록
        시간 · 창체 · 동아리 자리는 빼고, 옮긴 뒤 어느 선생님도 같은 시간에 두 곳에 있지 않은 것만 골랐습니다.
      </p>
      {notes.map((n) => (
        <div key={n} className="note note-warn" style={{ marginBottom: 8 }}>
          {n}
        </div>
      ))}

      {!locked && (
        <>
          <div className="tt-kinds">
            <button className={`btn btn-sm ${kind === '' ? 'btn-primary' : ''}`} onClick={() => setKind('')}>
              전체 {options.length}
            </button>
            {counts
              .filter((k) => k.kind !== '3중 교체' || deep)
              .map((k) => (
                <button
                  key={k.kind}
                  className={`btn btn-sm ${kind === k.kind ? 'btn-primary' : ''}`}
                  onClick={() => {
                    setKind(k.kind)
                    setShown(8)
                  }}
                  title={k.help}
                  disabled={!k.n}
                >
                  {k.label} {k.n}
                </button>
              ))}
          </div>
          <details className="neis-howto" style={{ marginTop: 6 }}>
            <summary>교체 방법이 무엇인가요?</summary>
            <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
              {KINDS.map((k) => (
                <li key={k.kind} className="small">
                  <b>{k.label}</b> — {k.help}
                </li>
              ))}
            </ul>
          </details>

          {list.length === 0 ? (
            <div className="empty" style={{ marginTop: 8 }}>
              {options.length === 0
                ? `이번 주에 바꿀 방법을 찾지 못했습니다.${deep ? '' : ' 3중 교체까지 더 찾아보거나'} 아래 보강을 보세요.`
                : '이 방법으로는 찾지 못했습니다.'}
            </div>
          ) : (
            <div className="list" style={{ marginTop: 8 }}>
              {list.slice(0, shown).map((o, i) => (
                <div className="item" key={i}>
                  <div className="item-head">
                    <div style={{ minWidth: 0 }}>
                      <div className="item-title">
                        <span className={`tt-kind k-${o.steps}`}>{o.kind === '맞교체' ? '1:1 맞교체' : o.kind}</span>{' '}
                        {o.teachers.map((t, k) => (
                          <span key={t}>
                            {k > 0 && ' · '}
                            {label(t)}
                            {peers.has(t) && <span className="tt-peer-tag">동교과</span>}
                          </span>
                        ))}
                        {o.teachers.length ? '과 함께' : ''}
                      </div>
                      <ul className="tt-moves">
                        {o.moves.map((m, k) => (
                          <li key={k} className={m.teachers.includes(who) ? 'mine' : ''}>
                            <span className="tt-move-what">
                              {m.cls} {m.subject} <small>({m.teachers.map(label).join(', ')})</small>
                            </span>
                            <span>
                              {at(m.from.day, m.from.period)} → <b>{at(m.to.day, m.to.period)}</b>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <button className="btn btn-sm" onClick={() => void copy(o)}>
                      📋 복사
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="row" style={{ marginTop: 8 }}>
            {list.length > shown && (
              <button className="btn btn-sm" onClick={() => setShown(shown + 8)}>
                더 보기 ({list.length - shown}가지 더)
              </button>
            )}
            {!deep && (
              <button className="btn btn-sm" onClick={searchDeep} disabled={searching}>
                {searching ? '찾는 중…' : '🔗 3중 교체까지 더 찾기'}
              </button>
            )}
            {peers.size > 0 && (
              <label className="tt-peer-first" title="동교과 선생님과 함께 바꾸는 방법을 목록 앞에 둡니다">
                <input type="checkbox" checked={peerFirst} onChange={(e) => setPeerFirst(e.target.checked)} />
                동교과 먼저 ({peerCount}가지)
              </label>
            )}
            <span className="muted small">
              {peerFirst && peers.size ? '동교과 선생님과 함께하는 방법을 맨 앞에, 그다음 ' : ''}함께 바꿀 선생님이 적은 것, 가까운 날을 앞에
              두었습니다.
            </span>
          </div>
        </>
      )}
    </div>
  )
}
