import { useEffect, useMemo, useState } from 'react'
import type { NeisLesson } from '../../shared/neis'
import { ymd } from '../../shared/neis'
import type { ChangePlan, SchoolTimetable } from '../../shared/timetable'
import {
  MY_CLASS_KEY,
  TT_MANUAL_KEY,
  TT_ME_KEY,
  TT_RULES_KEY,
  TT_TIMES_KEY,
  dayIndex,
  gradeOf,
  hoursOf,
  isFree,
  lockAt,
  myTimetable,
  planChange,
  rulesReady,
  slotKey,
  slotText,
  stampOf,
  weekDate
} from '../../shared/timetable'
import type { PageId } from '../App'
import TimetableSetup, { rulesSummary } from '../components/TimetableSetup'
import ChainList from '../components/ChainList'
import TimetableBoard, { drawTimetable } from '../components/TimetableBoard'
import { useConfirm } from '../lib/confirm'
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
  const ask = useConfirm()
  const T = useTimetable()
  /** 모양을 못 알아본 파일이 있다 — AI 로 읽기를 권한다 */
  const [aiOffer, setAiOffer] = useState('')
  /** AI 로 읽는 중이면 진행 글 */
  const [aiBusy, setAiBusy] = useState('')
  const [tab, setTab] = useState<Tab>('내 시간표')
  const [busy, setBusy] = useState(false)
  /** 블록 · 창체 확인 화면을 (이미 정했어도) 다시 여는 중 */
  const [rulesEdit, setRulesEdit] = useState(false)

  const importFile = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.api.tt.import()
      if (!r.ok) {
        if (r.canAi) setAiOffer(r.error || '시간표 모양을 찾지 못했습니다.')
        else if (r.error) toast(r.error, 'err')
        return
      }
      setAiOffer('')
      await T.reload()
      const one = r.tt!.versions ? ` 시트마다 수업이 달라 「${r.tt!.versions.used.join('」 「')}」 만 읽었습니다([파일 · 설정] 에서 바꿀 수 있음).` : ''
      toast(
        `시간표를 읽었습니다: 반 ${r.tt!.classes.length}개, 선생님 ${r.tt!.teachers.length}분.${one} ` +
          '수업 바꾸기는 [수업 바꾸기] 에서 시간표 정리(읽은 자료 · 블록 · 창체 · 동아리)를 마친 뒤 쓸 수 있습니다.',
        'ok'
      )
      setRulesEdit(false)
      if (!T.me) setTab('내 시간표')
    } finally {
      setBusy(false)
    }
  }

  /** 빈 표준 양식 — 읽지 못하는 모양이면 이 양식에 적어 불러온다 */
  const blankForm = async (): Promise<void> => {
    const r = await window.api.tt.exportStandard([])
    if (r.message !== '취소했습니다.') toast(r.ok ? `${r.message} 보기 줄을 지우고 적은 뒤 [시간표 파일 다시 불러오기] 로 고르세요.` : r.message, r.ok ? 'ok' : 'err')
  }

  /** AI 로 읽기 — 무엇을 보내는지 먼저 알리고 묻는다 */
  const aiRead = async (which: 'failed' | 'current'): Promise<void> => {
    const ok = await ask({
      title: '🤖 AI로 시간표를 읽을까요?',
      body: (
        <>
          학교마다 다른 시간표 모양을 AI 가 알아보고 표준 자료(교사 · 요일 · 교시 · 반 · 과목 · 블록 · 구분)로 바꿉니다.
          <ul style={{ margin: '8px 0', paddingLeft: 18 }}>
            <li>
              보내는 것: 선생님 이름 · 과목 · 학교 이름 같은 한글 낱말을 이 PC 에서 <b>W1, W2 …</b> 로 바꾼 표. 요일 · 교시 · 반 번호는 그대로
              보냅니다.
            </li>
            <li>받은 답의 W1, W2 … 는 이 PC 에서 원래 낱말로 되돌립니다. 칸 색깔은 보내지 않습니다.</li>
            <li>설정한 AI 서비스로 표 크기에 따라 여러 번 묻습니다. 사용료가 조금 들고 1~2분 걸릴 수 있습니다.</li>
          </ul>
          다 읽으면 <b>[① 읽은 자료]</b> 에서 맞는지 확인해 주세요.
        </>
      ),
      okText: 'AI로 읽기'
    })
    if (!ok) return
    setAiBusy('AI 에게 보내는 중…')
    const off = window.api.tt.onAiProgress((m) => setAiBusy(m))
    try {
      const r = await window.api.tt.aiRead(which)
      if (!r.ok) {
        toast(r.error || 'AI 로 읽지 못했습니다.', 'err')
        return
      }
      setAiOffer('')
      setRulesEdit(false)
      await T.reload()
      toast(`AI 로 읽었습니다: 반 ${r.tt!.classes.length}개, 선생님 ${r.tt!.teachers.length}분. [① 읽은 자료] 에서 확인해 주세요.`, 'ok')
      setTab('수업 바꾸기')
    } finally {
      off()
      setAiBusy('')
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
            보강)을 찾아 드립니다. 수업 바꾸기는 시간표 정리(읽은 자료 · 블록 · 창체 · 동아리)를 한 번 마친 뒤 쓸 수 있습니다. 파일이
            없으면 내 시간표를 직접 적어도 됩니다.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => void importFile()} disabled={busy}>
          {busy ? '읽는 중…' : T.tt ? '📂 시간표 파일 다시 불러오기' : '📂 학교 시간표 엑셀 불러오기'}
        </button>
      </div>

      {aiBusy && <div className="note note-info" style={{ marginBottom: 10 }}>🤖 {aiBusy}</div>}
      {aiOffer && !aiBusy && (
        <div className="note note-warn" style={{ marginBottom: 10 }}>
          {aiOffer}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-sm btn-primary" onClick={() => void aiRead('failed')}>
              🤖 AI로 읽기
            </button>
            <button className="btn btn-sm" onClick={() => void blankForm()}>
              📄 빈 표준 양식 받기
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setAiOffer('')}>
              닫기
            </button>
            <span className="muted small">
              이름 · 과목 같은 글자는 이 PC 에서 가려 보내고, 받은 뒤 되돌립니다. AI 키가 없으면 빈 표준 양식에 적어 불러오세요.
            </span>
          </div>
        </div>
      )}

      <div className="tabs">
        {(['내 시간표', '학급별', '수업 바꾸기', '파일 · 설정'] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === '내 시간표' && <MyTab T={T} onImport={() => void importFile()} />}
      {tab === '학급별' && <ClassTab T={T} onGo={onGo} />}
      {tab === '수업 바꾸기' && (
        <ChangeTab
          T={T}
          onImport={() => void importFile()}
          editRules={rulesEdit}
          setEditRules={setRulesEdit}
          onAiRead={aiBusy ? undefined : () => void aiRead('current')}
        />
      )}
      {tab === '파일 · 설정' && (
        <SettingsTab
          T={T}
          onImport={() => void importFile()}
          onRules={() => {
            setRulesEdit(true)
            setTab('수업 바꾸기')
          }}
        />
      )}
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
            <select
              value={T.me}
              onChange={(e) =>
                void (async () => {
                  const name = e.target.value
                  // 담임 칸이 있는 시간표면 우리 반도 채운다 (이미 정해 둔 것은 그대로)
                  const home = name ? T.tt?.homerooms?.[name] : ''
                  if (home && !T.myClass) {
                    await window.api.setting.set(MY_CLASS_KEY, home)
                    toast(`담임 반 ${home} 을(를) 우리 반으로 정했습니다.`, 'ok')
                  }
                  await T.save(TT_ME_KEY, name)
                })()
              }
              style={{ width: 'auto', minWidth: 160 }}
            >
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
            시간표 파일의 과목 이름이 짧게 줄어 있으면(예: 수학 → 공통수학) 보이는 이름만 바꿉니다. 블록으로만 적힌
            칸(예: C블록)에도 과목 이름을 붙일 수 있습니다.
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

function ChangeTab({
  T,
  onImport,
  editRules,
  setEditRules,
  onAiRead
}: {
  T: TT
  onImport: () => void
  editRules: boolean
  setEditRules: (v: boolean) => void
  onAiRead?: () => void
}): JSX.Element {
  const toast = useToast()
  const [who, setWho] = useState(T.me)
  const [date, setDate] = useState(nextSchoolDay())
  const [slot, setSlot] = useState<number | null>(null)
  /** 방금 블록 · 창체를 정했다 — 이제 쓸 수 있다고 알린다 */
  const [justReady, setJustReady] = useState(false)
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
  const ready = rulesReady(tt, T.rules)
  if (!ready || editRules) {
    return (
      <TimetableSetup
        key={stampOf(tt)}
        tt={tt}
        rules={T.rules}
        onAiRead={onAiRead}
        onCancel={ready ? () => setEditRules(false) : undefined}
        onSave={async (r) => {
          await T.save(TT_RULES_KEY, { ...r, confirmedFor: stampOf(tt), confirmedAt: new Date().toISOString() })
          setEditRules(false)
          setJustReady(true)
          toast('시간표 정리를 마쳤습니다. 이제 수업 바꾸기를 쓸 수 있습니다.', 'ok')
        }}
      />
    )
  }
  const rules = T.rules!
  const d1 = dayIndex(date)
  const theirs = who ? myTimetable(tt, who, {}) : null
  const lessons = d1 >= 0 && theirs ? theirs.grid[d1].map((s, p) => ({ s, p })).filter((x) => x.s && !isFree(x.s)) : []
  // 내 수업이면: 손으로 적은 칸(창체 · 동아리 등)과 우리 반 창체 시간에는 내가 비지 않았다
  const myGrade = String(gradeOf(T.myClass))
  const meBusy =
    who && who === T.me
      ? (d: number, p: number): boolean =>
          !!T.manual[slotKey(d, p)]?.trim() || !!rules.cce[myGrade]?.includes(slotKey(d, p)) || !!rules.club?.[myGrade]?.includes(slotKey(d, p))
      : undefined
  // 교체 방법은 ChainList 가 찾고, 여기서는 막힌 까닭(블록 · 창체)과 보강만 쓴다
  const plan: ChangePlan | null = slot !== null && who && d1 >= 0 ? planChange(tt, who, d1, slot, rules, meBusy) : null
  const mine = who === T.me

  return (
    <>
      {justReady && (
        <div className="note note-ok" style={{ marginBottom: 10 }}>
          ✅ 시간표 정리(읽은 자료 · 블록 · 창체 · 동아리)를 마쳤습니다. <b>이제 수업 바꾸기를 쓸 수 있습니다.</b> 아래에서 날짜와 비울
          수업을 고르세요.
        </div>
      )}
      <div className="row tt-rules-line">
        <span className="muted small">
          🧱 {rulesSummary(rules)} 기준으로 찾습니다. 블록 시간의 수업은 한 반만 바꾸지 않고, 블록 시간 · 창체 · 동아리 자리로는 옮기지
          않습니다.
        </span>
        <button className="btn btn-sm btn-ghost" onClick={() => setEditRules(true)}>
          시간표 정리 고치기
        </button>
      </div>
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
            {lessons.map(({ s, p }) => {
              const lock = s!.cls ? lockAt(rules, s!.cls.split('·')[0], d1, p) : null
              return (
                <button
                  key={p}
                  className={`btn btn-sm ${slot === p ? 'btn-primary' : ''}`}
                  onClick={() => setSlot(p)}
                  title={lock ? (lock.kind === 'fixed' ? `${lock.fixed} 시간` : '블록 수업 — 한 반만 바꿀 수 없음') : undefined}
                >
                  {lock ? (lock.kind === 'fixed' ? '🎒 ' : '🧱 ') : ''}
                  {tt.periods[p].label} {slotText(s)}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {plan && slot !== null && (
        <>
          <ChainList
            tt={tt}
            rules={rules}
            who={who}
            me={T.me}
            manual={T.manual}
            myClass={T.myClass}
            date={date}
            period={slot}
            locked={plan.locked}
            notes={plan.notes}
            cls={plan.cls}
            subject={plan.subject}
          />

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

function SettingsTab({ T, onImport, onRules }: { T: TT; onImport: () => void; onRules: () => void }): JSX.Element {
  const toast = useToast()
  const [rereading, setRereading] = useState(false)

  const blankForm = async (): Promise<void> => {
    const r = await window.api.tt.exportStandard([])
    if (r.message !== '취소했습니다.') toast(r.ok ? `${r.message} 보기 줄을 지우고 적은 뒤 [다시 불러오기] 로 고르세요.` : r.message, r.ok ? 'ok' : 'err')
  }

  const pickSheet = async (name: string): Promise<void> => {
    setRereading(true)
    try {
      const r = await window.api.tt.useSheet(name)
      if (!r.ok) {
        toast(r.error || '다시 읽지 못했습니다.', 'err')
        return
      }
      await T.reload()
      toast(`「${name}」 시트로 다시 읽었습니다. 수업 바꾸기 전에 시간표 정리를 한 번 더 해 주세요.`, 'ok')
    } finally {
      setRereading(false)
    }
  }
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
            {T.tt.versions && (
              <div className="row" style={{ marginTop: 8 }}>
                <span className="small">
                  <b>읽을 시트</b>
                </span>
                <select
                  value={T.tt.versions.used[0]}
                  disabled={rereading}
                  onChange={(e) => void pickSheet(e.target.value)}
                  style={{ width: 'auto', minWidth: 160 }}
                >
                  {T.tt.versions.sheets.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <span className="muted small">{rereading ? '다시 읽는 중…' : '지금 쓰는 시간표가 든 시트를 고르세요.'}</span>
              </div>
            )}
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
            <li>
              <b>표준 양식</b> — 머리 줄에 교사 · 요일 · 교시 · 반 · 과목 · 블록 · 구분, 한 줄에 수업 하나.{' '}
              <button className="link" onClick={() => void blankForm()}>
                빈 표준 양식 받기
              </button>
            </li>
          </ol>
          <p className="small" style={{ margin: '0 0 6px' }}>
            이 모양이 아니면 불러올 때 <b>[🤖 AI로 읽기]</b> 를 권해 드립니다(이름 · 과목 같은 글자는 가려 보냄).
          </p>
          <p className="small" style={{ margin: '0 0 6px' }}>
            여러 파일을 한꺼번에 골라도 됩니다(예: 시각이 없는 주간 시간표 + 시각이 있는 교사 시간표). 같은 수업은 한 번만 셉니다.
            시트마다 수업이 조금씩 다르면(교체를 반영한 판을 시트마다 둔 경우) 합치지 않고 한 시트만 읽습니다.{' '}
            <code>A_사문</code> 처럼 글자가 붙은 과목과 칸 색깔은 블록(여러 반이 함께 움직이는 선택 수업)을 짐작하는 데 씁니다.
            시간표는 선생님 이름이 있어 이 PC 에만 두고 인수인계 파일에는 넣지 않습니다.
          </p>
        </details>
      </div>

      {T.tt && (
        <div className="card">
          <div className="card-title">
            <span>🧱 시간표 정리 (읽은 자료 · 블록 · 창체 · 동아리)</span>
            <button className="btn btn-sm" onClick={onRules}>
              {rulesReady(T.tt, T.rules) ? '확인 · 고치기' : '확인하기'}
            </button>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            {rulesReady(T.tt, T.rules)
              ? `${rulesSummary(T.rules!)}으로 정해 두었습니다. 블록 시간의 수업은 한 반만 바꾸지 않고, 블록 시간 · 창체 · 동아리 자리로는 수업을 옮기지 않습니다. 표준 자료(엑셀) 저장도 여기서 합니다.`
              : '아직 이 시간표를 정리하지 않았습니다. 읽은 자료 · 블록 · 창체 · 동아리를 확인해야 수업 바꾸기를 쓸 수 있습니다.'}
          </p>
        </div>
      )}

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
