import { useEffect, useMemo, useState } from 'react'
import type { NeisLesson } from '../../shared/neis'
import { ymd } from '../../shared/neis'
import type { ChangePlan, SchoolTimetable } from '../../shared/timetable'
import {
  MY_CLASS_KEY,
  TT_MANUAL_KEY,
  TT_ME_KEY,
  TT_TIMES_KEY,
  dayIndex,
  hoursOf,
  isFree,
  myTimetable,
  planChange,
  slotText,
  weekDate
} from '../../shared/timetable'
import type { PageId } from '../App'
import TimetableBoard, { drawTimetable } from '../components/TimetableBoard'
import { useToast } from '../lib/toast'
import { TT_ALIAS_KEY, nowInfo, useTimetable } from '../lib/timetable'

interface Props {
  onGo: (p: PageId) => void
}

type Tab = '내 시간표' | '학급별' | '수업 바꾸기' | '파일 · 설정'

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const md = (day: string): string => {
  const d = new Date(`${day}T00:00:00`)
  return `${d.getMonth() + 1}. ${d.getDate()}.(${WEEK[d.getDay()]})`
}

/** 다음 수업일 (주말이면 월요일) */
function nextSchoolDay(): string {
  const d = new Date()
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  return ymd(d)
}

/**
 * 시간표 — 학교 시간표 엑셀을 불러와 내 시간표를 뽑고, 학급별로 보고, 수업을 바꿀 짝을 찾는다.
 * 파일이 없으면 내 시간표를 직접 적을 수 있다.
 */
export default function Timetable({ onGo }: Props): JSX.Element {
  const toast = useToast()
  const T = useTimetable()
  const [tab, setTab] = useState<Tab>('내 시간표')
  const [busy, setBusy] = useState(false)

  const importFile = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.api.tt.import()
      if (!r.ok) {
        if (r.error) toast(r.error, 'err')
        return
      }
      await T.reload()
      toast(`시간표를 읽었습니다: 반 ${r.tt!.classes.length}개, 선생님 ${r.tt!.teachers.length}분.`, 'ok')
      if (!T.me) setTab('내 시간표')
    } finally {
      setBusy(false)
    }
  }

  if (!T.loaded) return <div className="muted">불러오는 중…</div>

  return (
    <>
      <div className="page-head page-head-row">
        <div>
          <h1>시간표</h1>
          <p>
            학교 시간표 엑셀을 불러오면 내 시간표를 뽑아 그림처럼 보여 주고, 학급별 시간표와 수업 바꿀 짝(맞교체 ·
            보강)을 찾아 드립니다. 파일이 없으면 내 시간표를 직접 적어도 됩니다.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => void importFile()} disabled={busy}>
          {busy ? '읽는 중…' : T.tt ? '📂 시간표 파일 다시 불러오기' : '📂 학교 시간표 엑셀 불러오기'}
        </button>
      </div>

      <div className="tabs">
        {(['내 시간표', '학급별', '수업 바꾸기', '파일 · 설정'] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === '내 시간표' && <MyTab T={T} onImport={() => void importFile()} />}
      {tab === '학급별' && <ClassTab T={T} onGo={onGo} />}
      {tab === '수업 바꾸기' && <ChangeTab T={T} onImport={() => void importFile()} />}
      {tab === '파일 · 설정' && <SettingsTab T={T} onImport={() => void importFile()} />}
    </>
  )
}

type TT = ReturnType<typeof useTimetable>

/* ══════════ 내 시간표 ══════════ */

function MyTab({ T, onImport }: { T: TT; onImport: () => void }): JSX.Element {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [cell, setCell] = useState<{ d: number; p: number; text: string } | null>(null)
  const [aliasFrom, setAliasFrom] = useState('')
  const [aliasTo, setAliasTo] = useState('')
  const now = nowInfo()
  const my = T.my ?? myTimetable(T.tt, '', {})

  const subjects = useMemo(() => {
    if (!T.tt || !T.me) return []
    return [...new Set(myTimetable(T.tt, T.me, {}).grid.flat().filter(Boolean).map((s) => s!.subject))]
  }, [T.tt, T.me])

  const saveCell = async (): Promise<void> => {
    if (!cell) return
    const next = { ...T.manual, [`${cell.d}-${cell.p}`]: cell.text.trim() }
    // 학교 시간표와 같은 글로 되돌렸으면 고친 칸에서 뺀다
    const base = T.tt && T.me ? myTimetable(T.tt, T.me, {}).grid[cell.d][cell.p] : null
    if (cell.text.trim() === slotText(base)) delete next[`${cell.d}-${cell.p}`]
    await T.save(TT_MANUAL_KEY, next)
    setCell(null)
  }

  const savePng = async (): Promise<void> => {
    if (!T.my) return
    const data = drawTimetable(T.my, T.times.length, T.me ? `${T.me} 선생님 시간표` : '내 시간표')
    const r = await window.api.image.savePng({ name: `${T.me || '내'} 시간표`, dataUrl: data })
    if (r.message !== '취소했습니다.') toast(r.message, r.ok ? 'ok' : 'err')
  }

  return (
    <>
      <div className="card">
        <div className="card-title">
          <span>👤 나는</span>
          {T.my && <span className="badge badge-accent">한 주 {hoursOf(T.my)}시간</span>}
        </div>
        {T.tt ? (
          <div className="row">
            <select value={T.me} onChange={(e) => void T.save(TT_ME_KEY, e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
              <option value="">— 제 이름을 고르세요 —</option>
              {T.tt.teachers.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span className="muted small">
              불러온 시간표에서 이 이름의 수업을 모읍니다. 이름 · 시간표는 이 PC 에만 두고 인수인계 파일에는 넣지 않습니다.
            </span>
          </div>
        ) : (
          <div className="note note-info">
            학교 시간표 엑셀을 불러오면 이름만 골라 내 시간표가 바로 만들어집니다.{' '}
            <button className="btn btn-sm btn-primary" onClick={onImport}>
              📂 불러오기
            </button>{' '}
            파일이 없으면 아래 <b>[✏️ 칸 고치기]</b> 로 직접 적으세요.
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <span>🕘 내 시간표</span>
          <div className="row">
            <button className={`btn btn-sm ${editing ? 'btn-primary' : ''}`} onClick={() => setEditing((v) => !v)}>
              {editing ? '✓ 고치기 끝' : '✏️ 칸 고치기'}
            </button>
            <button className="btn btn-sm" onClick={() => void savePng()} disabled={!T.my}>
              🖼 그림으로 저장
            </button>
          </div>
        </div>
        {editing && (
          <div className="note note-info" style={{ marginBottom: 10 }}>
            칸을 누르고 <code>1-5 공통수학</code> · <code>창체</code> · <code>동아리</code> 처럼 적으세요. 비우면 그 칸을 지웁니다.
            학교 시간표에 없는 창체 · 동아리 · 보충 수업을 더하거나, 바뀐 수업을 고칠 때 씁니다.
          </div>
        )}
        <TimetableBoard
          my={my}
          length={T.times.length}
          today={now.day}
          now={now.hhmm}
          onCell={editing ? (d, p) => setCell({ d, p, text: slotText(my.grid[d][p]) }) : undefined}
        />
        {cell && (
          <div className="row" style={{ marginTop: 10 }}>
            <span className="small">
              <b>
                {my.days[cell.d]} {my.periods[cell.p].label}
              </b>
            </span>
            <input
              type="text"
              autoFocus
              value={cell.text}
              onChange={(e) => setCell({ ...cell, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveCell()
                if (e.key === 'Escape') setCell(null)
              }}
              placeholder="예: 1-5 공통수학 · 창체 · 동아리 (비우면 지움)"
              style={{ flex: 1, minWidth: 200 }}
            />
            <button className="btn btn-sm btn-primary" onClick={() => void saveCell()}>
              저장
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setCell(null)}>
              취소
            </button>
          </div>
        )}
        {Object.keys(T.manual).length > 0 && (
          <div className="row" style={{ marginTop: 10 }}>
            <span className="muted small">손으로 고친 칸 {Object.keys(T.manual).length}개</span>
            <button className="btn btn-sm btn-ghost" onClick={() => void T.save(TT_MANUAL_KEY, {})}>
              고친 칸 모두 되돌리기
            </button>
          </div>
        )}
      </div>

      {subjects.length > 0 && (
        <div className="card">
          <div className="card-title">과목 이름 바꿔 보이기</div>
          <p className="hint" style={{ marginTop: 0 }}>
            시간표 파일의 과목 이름이 짧게 줄어 있으면(예: 수학 → 공통수학) 보이는 이름만 바꿉니다.
          </p>
          <div className="row">
            <select value={aliasFrom} onChange={(e) => setAliasFrom(e.target.value)} style={{ width: 'auto' }}>
              <option value="">— 과목 —</option>
              {subjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span>→</span>
            <input type="text" value={aliasTo} onChange={(e) => setAliasTo(e.target.value)} placeholder="보일 이름" style={{ width: 160 }} />
            <button
              className="btn btn-sm"
              disabled={!aliasFrom}
              onClick={() =>
                void (async () => {
                  const next = { ...T.alias }
                  if (aliasTo.trim()) next[aliasFrom] = aliasTo.trim()
                  else delete next[aliasFrom]
                  await T.save(TT_ALIAS_KEY, next)
                  setAliasTo('')
                })()
              }
            >
              바꾸기
            </button>
            {Object.entries(T.alias).map(([a, b]) => (
              <span key={a} className="badge">
                {a} → {b}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

/* ══════════ 학급별 ══════════ */

function ClassTab({ T, onGo }: { T: TT; onGo: (p: PageId) => void }): JSX.Element {
  const [pick, setPick] = useState(T.myClass || T.tt?.classes[0]?.id || '')
  const [neis, setNeis] = useState<{ rows: NeisLesson[]; error?: string } | null>(null)
  const [grade, setGrade] = useState(Number(T.myClass.split('-')[0]) || 1)
  const [num, setNum] = useState(Number(T.myClass.split('-')[1]) || 1)
  const cls = T.tt?.classes.find((c) => c.id === pick) ?? null
  const monday = weekDate(nextSchoolDay(), 0)

  const loadNeis = async (): Promise<void> => {
    const r = await window.api.neis.classTimetable(grade, num, monday, weekDate(monday, 4))
    setNeis({ rows: r.data, error: r.ok ? undefined : r.error })
  }

  return (
    <>
      {T.tt ? (
        <div className="card">
          <div className="card-title">
            <span>학급 고르기</span>
            {pick && pick !== T.myClass && (
              <button className="btn btn-sm" onClick={() => void T.save(MY_CLASS_KEY, pick)}>
                ⭐ 우리 반으로 정하기
              </button>
            )}
            {pick && pick === T.myClass && <span className="badge badge-accent">⭐ 우리 반</span>}
          </div>
          <div className="tt-classpick">
            {T.tt.classes.map((c) => (
              <button key={c.id} className={`btn btn-sm ${c.id === pick ? 'btn-primary' : ''}`} onClick={() => setPick(c.id)}>
                {c.id}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-title">나이스 학급 시간표</div>
          <p className="hint" style={{ marginTop: 0 }}>
            학교 시간표 파일이 없으면 나이스에서 학급 시간표(과목만)를 받아 봅니다. 한 주가 5건을 넘어 나이스 인증키가
            있어야 합니다.{' '}
            <button className="link" onClick={() => onGo('설정')}>
              설정 → 나이스 연결
            </button>
          </p>
          <div className="row">
            <select value={grade} onChange={(e) => setGrade(Number(e.target.value))} style={{ width: 'auto' }}>
              {[1, 2, 3, 4, 5, 6].map((g) => (
                <option key={g} value={g}>
                  {g}학년
                </option>
              ))}
            </select>
            <input type="number" min={1} max={30} value={num} onChange={(e) => setNum(Number(e.target.value))} style={{ width: 80 }} />
            <span>반</span>
            <button className="btn btn-primary btn-sm" onClick={() => void loadNeis()}>
              이번 주 시간표 받기
            </button>
            <button className="btn btn-sm" onClick={() => void T.save(MY_CLASS_KEY, `${grade}-${num}`)}>
              ⭐ 우리 반으로 정하기
            </button>
          </div>
          {neis?.error && <div className="note note-warn" style={{ marginTop: 10 }}>{neis.error}</div>}
          {neis && !neis.error && <NeisWeek rows={neis.rows} monday={monday} />}
        </div>
      )}

      {cls && T.tt && (
        <div className="card">
          <div className="card-title">{cls.id} 시간표</div>
          <ClassTable tt={T.tt} id={cls.id} />
        </div>
      )}
    </>
  )
}

/** 학교 시간표의 한 반 (과목 + 선생님) */
export function ClassTable({ tt, id, compact }: { tt: SchoolTimetable; id: string; compact?: boolean }): JSX.Element | null {
  const cls = tt.classes.find((c) => c.id === id)
  const today = nowInfo().day
  if (!cls) return null
  return (
    <div className="tt-table-wrap">
      <table className={`tt-table ${compact ? 'compact' : ''}`}>
        <thead>
          <tr>
            <th />
            {tt.days.map((d, i) => (
              <th key={d} className={i === today ? 'today' : ''}>
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tt.periods.map((p, pi) => (
            <tr key={p.no}>
              <th>
                {p.no}
                {!compact && p.start && <span className="muted small"> {p.start}</span>}
              </th>
              {tt.days.map((_, d) => {
                const c = cls.grid[d][pi]
                return (
                  <td key={d} className={`${d === today ? 'today' : ''} ${pi + 1 > tt.dayPeriods[d] ? 'off' : ''} ${c?.group ? 'group' : ''}`}>
                    {c && (
                      <>
                        <span className="tt-subj">
                          {c.group && <span className="tt-group">{c.group}</span>}
                          {c.subject}
                        </span>
                        {!compact && c.teachers.length > 0 && <span className="tt-teacher">{c.teachers.join(', ')}</span>}
                      </>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 나이스에서 받은 한 주 학급 시간표 */
export function NeisWeek({ rows, monday }: { rows: NeisLesson[]; monday: string }): JSX.Element {
  const days = [0, 1, 2, 3, 4].map((k) => weekDate(monday, k))
  const maxP = Math.max(0, ...rows.map((r) => r.period))
  if (!rows.length) return <div className="muted small" style={{ marginTop: 8 }}>이번 주 시간표가 나이스에 없습니다.</div>
  return (
    <div className="tt-table-wrap" style={{ marginTop: 10 }}>
      <table className="tt-table">
        <thead>
          <tr>
            <th />
            {days.map((d) => (
              <th key={d}>{md(d)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: maxP }, (_, i) => i + 1).map((p) => (
            <tr key={p}>
              <th>{p}</th>
              {days.map((d) => (
                <td key={d}>
                  <span className="tt-subj">{rows.find((r) => r.date === d && r.period === p)?.subject ?? ''}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ══════════ 수업 바꾸기 ══════════ */

function ChangeTab({ T, onImport }: { T: TT; onImport: () => void }): JSX.Element {
  const toast = useToast()
  const [who, setWho] = useState(T.me)
  const [date, setDate] = useState(nextSchoolDay())
  const [slot, setSlot] = useState<number | null>(null)
  useEffect(() => setWho((w) => w || T.me), [T.me])

  if (!T.tt) {
    return (
      <div className="note note-info">
        수업 바꿀 짝을 찾으려면 학교 전체 시간표가 있어야 합니다.{' '}
        <button className="btn btn-sm btn-primary" onClick={onImport}>
          📂 학교 시간표 엑셀 불러오기
        </button>
      </div>
    )
  }
  const tt = T.tt
  const d1 = dayIndex(date)
  const theirs = who ? myTimetable(tt, who, {}) : null
  const lessons = d1 >= 0 && theirs ? theirs.grid[d1].map((s, p) => ({ s, p })).filter((x) => x.s && !isFree(x.s)) : []
  const plan: ChangePlan | null = slot !== null && who && d1 >= 0 ? planChange(tt, who, d1, slot) : null
  // 이미 지난 날과는 맞바꿀 수 없다
  const today = ymd(new Date())
  const swaps = plan ? plan.swaps.filter((s) => weekDate(date, s.day) >= today) : []
  const past = plan ? plan.swaps.length - swaps.length : 0
  const mine = who === T.me
  const label = (t: string): string => `${t}${t === T.me ? '(나)' : ' 선생님'}`

  const copy = async (text: string): Promise<void> => {
    await window.api.clipboard.write(text)
    toast('복사했습니다. 메신저나 교체 신청서에 붙여넣으세요.', 'ok')
  }

  return (
    <>
      <div className="card">
        <div className="card-title">1. 언제, 누구의 수업을 비우나요?</div>
        <div className="row">
          <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSlot(null) }} style={{ width: 'auto' }} />
          <select value={who} onChange={(e) => { setWho(e.target.value); setSlot(null) }} style={{ width: 'auto', minWidth: 150 }}>
            <option value="">— 선생님 —</option>
            {tt.teachers.map((t) => (
              <option key={t} value={t}>
                {t}
                {t === T.me ? ' (나)' : ''}
              </option>
            ))}
          </select>
          {!T.me && <span className="muted small">[내 시간표] 에서 제 이름을 골라 두면 처음부터 골라져 있습니다.</span>}
        </div>
        {d1 < 0 ? (
          <div className="muted small" style={{ marginTop: 8 }}>주말은 수업이 없습니다.</div>
        ) : !who ? null : lessons.length === 0 ? (
          <div className="muted small" style={{ marginTop: 8 }}>{md(date)} 에는 수업이 없습니다.</div>
        ) : (
          <div className="row" style={{ marginTop: 10 }}>
            {lessons.map(({ s, p }) => (
              <button key={p} className={`btn btn-sm ${slot === p ? 'btn-primary' : ''}`} onClick={() => setSlot(p)}>
                {tt.periods[p].label} {slotText(s)}
              </button>
            ))}
          </div>
        )}
      </div>

      {plan && slot !== null && (
        <>
          <div className="card">
            <div className="card-title">
              <span>
                2. 맞교체 — {md(date)} {tt.periods[slot].label} {plan.cls} {plan.subject}
              </span>
              <span className="badge">{swaps.length}가지</span>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              같은 반을 같은 주에 가르치는 선생님과 시간을 맞바꿉니다. 두 분 모두 그 시간에 비어 있는 것만 골랐습니다.
            </p>
            {plan.notes.map((n) => (
              <div key={n} className="note note-warn" style={{ marginBottom: 8 }}>
                {n}
              </div>
            ))}
            {past > 0 && <p className="muted small" style={{ marginTop: 0 }}>이미 지난 날의 {past}가지는 뺐습니다.</p>}
            {swaps.length === 0 ? (
              !plan.group && <div className="empty">이번 주에 맞바꿀 수 있는 시간이 없습니다. 아래 보강을 보세요.</div>
            ) : (
              <div className="list">
                {swaps.map((s) => {
                  const other = weekDate(date, s.day)
                  const text = `${md(date)} ${tt.periods[slot].label} ${plan.cls} ${plan.subject}(${label(who)}) ↔ ${md(other)} ${tt.periods[s.period].label} ${plan.cls} ${s.subject}(${label(s.teacher)})`
                  return (
                    <div className="item" key={`${s.day}-${s.period}-${s.teacher}`}>
                      <div className="item-head">
                        <div style={{ minWidth: 0 }}>
                          <div className="item-title">
                            {md(other)} {tt.periods[s.period].label} · {s.subject} · {label(s.teacher)}
                          </div>
                          <div className="item-meta">{text}</div>
                        </div>
                        <button className="btn btn-sm" onClick={() => void copy(text)}>
                          📋 복사
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title">
              <span>3. 보강 — 그 시간에 비어 있는 선생님</span>
              <span className="badge">{plan.covers.length}분</span>
            </div>
            <div className="tt-covers">
              {plan.covers.map((c) => (
                <span key={c.teacher} className={`tt-cover ${c.sameSubject ? 'same' : ''}`} title={`그날 수업 ${c.load}시간`}>
                  {c.teacher}
                  <small>
                    {c.sameSubject ? '같은 과목 · ' : ''}그날 {c.load}시간
                  </small>
                </span>
              ))}
            </div>
            <p className="hint" style={{ marginBottom: 0 }}>
              같은 과목을 가르치는 분, 그날 수업이 적은 분을 앞에 두었습니다.
            </p>
          </div>

          <div className="note note-info">
            {mine ? '' : `${who} 선생님의 수업을 보고 있습니다. `}불러온 시간표 파일({tt.file}) 기준입니다. 이미 바뀐 수업 · 출장 · 행사는
            모르니, 실제로 바꾸기 전에 시간표 담당 선생님과 확인하세요.
          </div>
        </>
      )}
    </>
  )
}

/* ══════════ 파일 · 설정 ══════════ */

function SettingsTab({ T, onImport }: { T: TT; onImport: () => void }): JSX.Element {
  const toast = useToast()
  const periods = T.tt?.periods ?? T.my?.periods ?? []
  const count = Math.max(periods.length, 7)
  const [starts, setStarts] = useState<string[]>(() =>
    Array.from({ length: count }, (_, i) => T.times.starts[i] || T.tt?.periods[i]?.start || '')
  )
  const [length, setLength] = useState(T.times.length)

  const saveTimes = async (): Promise<void> => {
    const bad = starts.find((s) => s && !/^\d{2}:\d{2}$/.test(s))
    if (bad) {
      toast(`시각은 08:40 처럼 적어 주세요: ${bad}`, 'err')
      return
    }
    await T.save(TT_TIMES_KEY, { starts, length: Math.max(30, Math.min(90, length || 50)) })
    toast('교시 시각을 저장했습니다.', 'ok')
  }

  return (
    <>
      <div className="card">
        <div className="card-title">
          <span>📂 학교 시간표 파일</span>
          <div className="row">
            <button className="btn btn-sm btn-primary" onClick={onImport}>
              {T.tt ? '다시 불러오기' : '불러오기'}
            </button>
            {T.tt && (
              <button
                className="btn btn-sm btn-danger"
                onClick={() =>
                  void (async () => {
                    await window.api.tt.clear()
                    await T.reload()
                  })()
                }
              >
                지우기
              </button>
            )}
          </div>
        </div>
        {T.tt ? (
          <>
            <div className="tt-info">
              <div>
                <b>{T.tt.file}</b> · {T.tt.loadedAt} 에 불러옴
              </div>
              <div className="muted small">
                {T.tt.layouts.join(' + ')} 모양 · 반 {T.tt.classes.length}개 · 선생님 {T.tt.teachers.length}분 · {T.tt.days.join('')} · 요일별{' '}
                {T.tt.days.map((d, i) => `${d}${T.tt!.dayPeriods[i]}`).join(' ')}교시
              </div>
            </div>
            {T.tt.warnings.map((w) => (
              <div key={w} className="note note-warn" style={{ marginTop: 8 }}>
                {w}
              </div>
            ))}
          </>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>아직 불러온 시간표가 없습니다.</p>
        )}
        <details className="neis-howto">
          <summary>읽을 수 있는 시간표 모양</summary>
          <ol>
            <li>
              <b>학급 시간표</b> — "1학년 1반"(또는 1-1) 칸 오른쪽에 월~금, 아래로 1교시~. 칸에 <code>과목⏎선생님</code>
            </li>
            <li>
              <b>교사 시간표</b> — 선생님 이름 칸 오른쪽에 월~금, 아래로 1교시~. 칸에 <code>103⏎국어</code> 처럼 반 번호와 과목
            </li>
            <li>
              <b>주간 시간표</b> — 위에 요일 줄(월월월…)과 교시 줄(1 2 3…), 줄마다 선생님. 칸에 <code>103⏎국어</code>
            </li>
          </ol>
          <p className="small" style={{ margin: '0 0 6px' }}>
            여러 파일을 한꺼번에 골라도 됩니다(예: 시각이 없는 주간 시간표 + 시각이 있는 교사 시간표). 같은 수업은 한 번만 셉니다.
            <code>A_사문</code> 처럼 글자가 붙은 과목은 여러 반이 함께 움직이는 이동수업으로 봅니다. 시간표는 선생님 이름이 있어
            이 PC 에만 두고 인수인계 파일에는 넣지 않습니다.
          </p>
        </details>
      </div>

      <div className="card">
        <div className="card-title">⏰ 교시 시각</div>
        <p className="hint" style={{ marginTop: 0 }}>
          시각을 알면 홈에서 <b>지금 몇 교시인지</b>, 점심시간이 언제인지 보여 드립니다. 파일에 있으면 처음부터 채워져 있습니다.
        </p>
        <div className="tt-times">
          {starts.map((s, i) => (
            <label key={i}>
              <span>{i + 1}교시</span>
              <input
                type="text"
                value={s}
                placeholder="08:40"
                onChange={(e) => setStarts(starts.map((x, k) => (k === i ? e.target.value.trim() : x)))}
              />
            </label>
          ))}
          <label>
            <span>수업 길이</span>
            <input type="number" min={30} max={90} value={length} onChange={(e) => setLength(Number(e.target.value))} />
          </label>
        </div>
        <div className="row row-end" style={{ marginTop: 10 }}>
          <button className="btn btn-primary btn-sm" onClick={() => void saveTimes()}>
            저장
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">⭐ 우리 반 (담임 학급)</div>
        <p className="hint" style={{ marginTop: 0 }}>
          정해 두면 홈에 <b>우리 반 시간표</b> 위젯을 얹을 수 있고, 업무 도우미가 우리 반 수업을 알고 답합니다.
        </p>
        <div className="row">
          <input
            type="text"
            defaultValue={T.myClass}
            placeholder="예: 2-4"
            style={{ width: 100 }}
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v === T.myClass) return
              if (v && !/^\d-\d{1,2}$/.test(v)) {
                toast('2-4 처럼 학년-반으로 적어 주세요.', 'err')
                return
              }
              void T.save(MY_CLASS_KEY, v)
            }}
          />
          <span className="muted small">{T.myClass ? `지금: ${T.myClass}` : '담임이 아니면 비워 두세요'}</span>
        </div>
      </div>
    </>
  )
}
