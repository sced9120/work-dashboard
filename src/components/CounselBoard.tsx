import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PageId } from '../App'
import { ATT_ROSTER_KEY, readRoster } from '../../shared/attendance'
import type { Student } from '../../shared/attendance'
import {
  COUNSEL_HOW,
  COUNSEL_TOPICS,
  COUNSEL_WHO,
  SCHOOL_MONTHS,
  filterRecords,
  firstLine,
  hasRecordInSemester,
  koDate,
  monthCells,
  monthKey,
  monthTotals,
  newestFirst,
  parentMessage,
  recordsTable,
  schoolYearOf
} from '../../shared/counsel'
import type { CounselMeta, CounselPlan, CounselRecord } from '../../shared/counsel'
import { useConfirm } from '../lib/confirm'
import { COUNSEL_STUDENT_EVENT, gotoHomeroomTab, takeCounselStudent } from '../lib/counselNav'
import { todayStr } from '../lib/util'
import { useToast } from '../lib/toast'

/**
 * 상담 기록 — 학생 × 학년도 달(3월~2월) 칸에 상담 횟수를 보고, 칸을 눌러 기록한다.
 * 상담 예정은 달력 일정으로도 들어간다(제목은 이름 없이 '상담 — 3번').
 * 학부모에게 보낼 글은 초안만 만들어 복사한다 — AI 를 부르지 않는다.
 * TODO(서버 필요): 호스팅 링크로 학부모에게 보내는 방식은 이번 판에 넣지 않았다.
 * 상담 내용은 이 PC 에만 두고 인수인계 파일에는 넣지 않는다(백업에는 들어간다).
 */

interface Draft {
  id?: string
  date: string
  who: string
  how: string
  topics: string[]
  text: string
  follow: string
  /** 상담 예정을 '했음' 으로 기록하는 중이면 그 예정 */
  planId?: string
}

interface PlanDraft {
  id?: string
  date: string
  time: string
  who: string
  memo: string
}

const newDraft = (date: string): Draft => ({ date, who: '학생', how: '대면', topics: [], text: '', follow: '' })

export default function CounselBoard({ onGo }: { onGo: (p: PageId) => void }): JSX.Element {
  void onGo
  const toast = useToast()
  const ask = useConfirm()
  const today = todayStr()
  const thisYear = schoolYearOf(today)
  const [year, setYear] = useState(thisYear)
  const [years, setYears] = useState<number[]>([thisYear])
  const [students, setStudents] = useState<Student[]>([])
  const [records, setRecords] = useState<CounselRecord[]>([])
  const [plans, setPlans] = useState<CounselPlan[]>([])
  const [meta, setMeta] = useState<CounselMeta>({ teacher: '', students: {} })
  const [loaded, setLoaded] = useState(false)
  const [q, setQ] = useState('')
  const [topic, setTopic] = useState('')
  const [sel, setSel] = useState(0)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null)
  const [history, setHistory] = useState(true)
  const [msgFor, setMsgFor] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const reload = useCallback(async (y: number): Promise<void> => {
    const l = await window.api.counsel.load(y)
    setYear(l.year)
    setYears(l.years)
    setRecords(l.records)
    setPlans(l.plans)
    setMeta(l.meta)
  }, [])

  useEffect(() => {
    void (async () => {
      const r = readRoster(await window.api.setting.get(ATT_ROSTER_KEY, ''))
      setStudents(r.students)
      await reload(thisYear)
      setLoaded(true)
      const queued = takeCounselStudent()
      if (queued) pickStudent(queued)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 명단에서 [상담 기록] 을 눌러 이미 열린 판으로 오는 경우
  useEffect(() => {
    const h = (e: Event): void => {
      const n = Number((e as CustomEvent<number>).detail)
      takeCounselStudent()
      if (n) pickStudent(n)
    }
    window.addEventListener(COUNSEL_STUDENT_EVENT, h)
    return () => window.removeEventListener(COUNSEL_STUDENT_EVENT, h)
  }, [])

  const pickStudent = (no: number): void => {
    setSel(no)
    setDraft(null)
    setPlanDraft(null)
    setMsgFor(null)
    setHistory(true)
  }

  // 명단에 없지만 기록이 있는 번호(명단에서 뺀 학생)도 줄을 둔다
  const rows = useMemo<Student[]>(() => {
    const known = new Set(students.map((s) => s.no))
    const extra = new Map<number, string>()
    for (const r of records) if (!known.has(r.no)) extra.set(r.no, r.name)
    for (const p of plans) if (!known.has(p.no)) extra.set(p.no, p.name)
    return [...students, ...[...extra].map(([no, name]) => ({ no, name }))].sort((a, b) => a.no - b.no)
  }, [students, records, plans])

  const shownRecords = useMemo(() => filterRecords(records, { topic }), [records, topic])
  const cells = useMemo(() => monthCells(shownRecords, plans, year), [shownRecords, plans, year])
  const totals = useMemo(() => monthTotals(cells), [cells])
  const visible = rows.filter((s) => {
    const k = q.trim()
    if (k && !(s.name.includes(k) || String(s.no) === k.replace(/번$/, ''))) return false
    return !topic || (cells[s.no]?.some((c) => c.count > 0) ?? false)
  })

  if (!loaded) return <p className="muted small">불러오는 중…</p>
  if (!rows.length) {
    return (
      <section className="card">
        <p>
          우리 반 명단이 아직 없습니다. <b>학생 명단</b> 칸에서 먼저 명단을 만들어 주세요.
        </p>
        <button className="btn btn-primary btn-sm" onClick={() => gotoHomeroomTab('학생 명단')}>
          학생 명단으로
        </button>
      </section>
    )
  }

  const student = rows.find((s) => s.no === sel)
  const mine = newestFirst(records.filter((r) => r.no === sel))
  const myPlans = plans.filter((p) => p.no === sel).sort((a, b) => a.date.localeCompare(b.date))
  const checkSemester = year === thisYear

  const openCell = (no: number, m: number): void => {
    const key = monthKey(year, m)
    pickStudent(no)
    setDraft(newDraft(today.startsWith(key) ? today : `${key}-01`))
  }

  const save = async (): Promise<void> => {
    if (!draft || !student) return
    const r = await window.api.counsel.save({ id: draft.id, no: student.no, name: student.name, date: draft.date, who: draft.who, how: draft.how, topics: draft.topics, text: draft.text, follow: draft.follow }, draft.planId)
    if (!r.ok) return toast(r.message, 'err')
    // 날짜를 다른 학년도로 옮겼으면 그 학년도로 따라간다
    await reload(schoolYearOf(r.record.date))
    setDraft(null)
    toast('상담 기록을 저장했습니다.', 'ok')
  }

  const removeRecord = async (r: CounselRecord): Promise<void> => {
    const ok = await ask({ title: `${koDate(r.date)} 상담 기록을 지울까요?`, body: '지운 기록은 되돌릴 수 없습니다.', okText: '지우기', danger: true })
    if (!ok) return
    await window.api.counsel.remove(r.id)
    if (draft?.id === r.id) setDraft(null)
    if (msgFor === r.id) setMsgFor(null)
    await reload(year)
  }

  const editRecord = (r: CounselRecord): void => {
    setDraft({ id: r.id, date: r.date, who: r.who, how: r.how, topics: r.topics, text: r.text, follow: r.follow })
    setPlanDraft(null)
  }

  const savePlan = async (): Promise<void> => {
    if (!planDraft || !student) return
    const r = await window.api.counsel.plan({ id: planDraft.id, no: student.no, name: student.name, date: planDraft.date, time: planDraft.time, who: planDraft.who, memo: planDraft.memo })
    if (!r.ok) return toast(r.message, 'err')
    await reload(schoolYearOf(r.plan.date))
    setPlanDraft(null)
    toast('상담 예정을 넣고 달력에도 올렸습니다.', 'ok')
  }

  const cancelPlan = async (p: CounselPlan): Promise<void> => {
    const ok = await ask({ title: `${koDate(p.date)} 상담 예정을 취소할까요?`, body: '달력의 일정도 함께 지웁니다.', okText: '예정 취소', danger: true })
    if (!ok) return
    await window.api.counsel.planCancel(p.id)
    await reload(year)
  }

  const donePlan = (p: CounselPlan): void => {
    setDraft({ ...newDraft(p.date), who: p.who, text: p.memo, planId: p.id })
    setPlanDraft(null)
  }

  const openMessage = (r: CounselRecord): void => {
    setMsgFor(r.id)
    setMsg(parentMessage(r, meta.teacher))
  }

  const copyMessage = async (): Promise<void> => {
    await window.api.clipboard.write(msg)
    toast('복사했습니다. 문자 · 학교 알림 앱에 붙여 넣으세요.', 'ok')
  }

  const exportXlsx = async (): Promise<void> => {
    const list = filterRecords(records, { q, topic })
    if (!list.length) return toast('저장할 상담 기록이 없습니다.', 'err')
    const r = await window.api.ocr.save([recordsTable(list, year)], `${year}학년도 상담 기록`)
    if (r.message) toast(r.message, r.ok ? 'ok' : 'err')
  }

  const msgRec = msgFor ? records.find((r) => r.id === msgFor) : undefined

  return (
    <div className="cb-wrap">
      <div className="cb-main">
        <section className="card">
          <div className="cb-tools">
            <select value={year} onChange={(e) => { setSel(0); setDraft(null); void reload(Number(e.target.value)) }} aria-label="학년도">
              {Array.from(new Set([...years, thisYear])).sort((a, b) => b - a).map((y) => (
                <option key={y} value={y}>
                  {y}학년도
                </option>
              ))}
            </select>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 · 번호 찾기" aria-label="이름으로 찾기" style={{ width: 150 }} />
            <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="주제로 거르기">
              <option value="">주제 전체</option>
              {COUNSEL_TOPICS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span className="spacer" />
            <span className="muted small">기록 {shownRecords.length}건</span>
            <button className="btn btn-sm" onClick={() => void exportXlsx()}>
              엑셀로 저장
            </button>
          </div>
          <div className="cb-grid-wrap">
            <table className="cb-grid">
              <thead>
                <tr>
                  <th className="cb-name">학생</th>
                  {SCHOOL_MONTHS.map((m, i) => (
                    <th key={m} title={`${totals[i]}건`}>
                      {m}월
                    </th>
                  ))}
                  <th>합계</th>
                </tr>
                <tr className="cb-sumrow">
                  <th className="cb-name muted">달별</th>
                  {totals.map((t, i) => (
                    <th key={i} className="muted">
                      {t || ''}
                    </th>
                  ))}
                  <th>{totals.reduce((a, b) => a + b, 0)}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => {
                  const row = cells[s.no]
                  const total = row ? row.reduce((a, c) => a + c.count, 0) : 0
                  const none = checkSemester && !hasRecordInSemester(records, s.no, today)
                  return (
                    <tr key={s.no} className={`${sel === s.no ? 'cb-sel' : ''}${none ? ' cb-none' : ''}`}>
                      <td className="cb-name">
                        <button className="cb-who" onClick={() => pickStudent(s.no)} title={none ? '이번 학기 상담 기록이 아직 없습니다' : undefined}>
                          <span className="muted">{s.no}</span> {s.name}
                        </button>
                      </td>
                      {SCHOOL_MONTHS.map((m, i) => {
                        const c = row?.[i]
                        const label = `${s.no}번 ${s.name} ${m}월 ${c?.count ? `상담 ${c.count}건` : '기록 없음'}${c?.planned ? ' · 예정 있음' : ''}`
                        return (
                          <td key={m}>
                            <button className={`cb-cell${c?.count ? ' has' : ''}${c?.planned ? ' plan' : ''}`} onClick={() => openCell(s.no, m)} aria-label={label} title={label}>
                              {c?.count ? <>✓{c.count > 1 && <sub>{c.count}</sub>}</> : null}
                            </button>
                          </td>
                        )
                      })}
                      <td className="cb-total">{total || ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            칸을 누르면 그 달에 새 기록을 적습니다. ✓ = 상담 기록, 점선 테두리 = 상담 예정{checkSemester ? ', 옅게 표시된 이름 = 이번 학기 기록 없음' : ''}.
          </p>
        </section>
      </div>

      {student && (
        <aside className="card cb-panel" aria-label={`${student.no}번 ${student.name} 상담`}>
          <div className="cb-panel-head">
            <b>
              {student.no}번 {student.name}
            </b>
            <button className="btn btn-sm btn-ghost" onClick={() => setSel(0)}>
              닫기
            </button>
          </div>
          {(meta.students[String(student.no)]?.contact || meta.students[String(student.no)]?.memo) && (
            <p className="muted small">
              {meta.students[String(student.no)]?.contact}
              {meta.students[String(student.no)]?.contact && meta.students[String(student.no)]?.memo ? ' · ' : ''}
              {meta.students[String(student.no)]?.memo}
            </p>
          )}

          {draft ? (
            <div className="cb-form">
              <b className="small">{draft.id ? '기록 고치기' : draft.planId ? '예정한 상담 기록하기' : '새 상담 기록'}</b>
              <div className="cb-row">
                <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} aria-label="날짜" />
              </div>
              <div className="cb-row">
                <span className="cb-lab">대상</span>
                <div className="tb-seg" role="group" aria-label="대상">
                  {COUNSEL_WHO.map((w) => (
                    <button key={w} className={draft.who === w ? 'on' : ''} onClick={() => setDraft({ ...draft, who: w })}>
                      {w}
                    </button>
                  ))}
                </div>
              </div>
              <div className="cb-row">
                <span className="cb-lab">방법</span>
                <div className="tb-seg" role="group" aria-label="방법">
                  {COUNSEL_HOW.map((h) => (
                    <button key={h} className={draft.how === h ? 'on' : ''} onClick={() => setDraft({ ...draft, how: h })}>
                      {h}
                    </button>
                  ))}
                </div>
              </div>
              <div className="cb-row">
                <span className="cb-lab">주제</span>
                <div className="cb-chips" role="group" aria-label="주제">
                  {COUNSEL_TOPICS.map((t) => {
                    const on = draft.topics.includes(t)
                    return (
                      <button key={t} className={`cb-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setDraft({ ...draft, topics: on ? draft.topics.filter((x) => x !== t) : [...draft.topics, t] })}>
                        {t}
                      </button>
                    )
                  })}
                </div>
              </div>
              <textarea rows={5} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="상담 내용" aria-label="상담 내용" />
              <textarea rows={3} value={draft.follow} onChange={(e) => setDraft({ ...draft, follow: e.target.value })} placeholder="후속 조치" aria-label="후속 조치" />
              <div className="cb-row">
                {draft.id && records.some((r) => r.id === draft.id) && (
                  <button className="btn btn-sm" onClick={() => openMessage(records.find((r) => r.id === draft.id)!)}>
                    학부모에게 보낼 글
                  </button>
                )}
                <span className="spacer" />
                <button className="btn btn-sm btn-ghost" onClick={() => setDraft(null)}>
                  닫기
                </button>
                <button className="btn btn-sm btn-primary" onClick={() => void save()}>
                  저장
                </button>
              </div>
            </div>
          ) : (
            <div className="cb-row">
              <button className="btn btn-sm btn-primary" onClick={() => setDraft(newDraft(today))}>
                ＋ 새 기록
              </button>
              <button className="btn btn-sm" onClick={() => setPlanDraft({ date: today, time: '', who: '학부모', memo: '' })}>
                상담 예정 넣기
              </button>
            </div>
          )}

          {planDraft && (
            <div className="cb-form">
              <b className="small">상담 예정</b>
              <div className="cb-row">
                <input type="date" value={planDraft.date} onChange={(e) => setPlanDraft({ ...planDraft, date: e.target.value })} aria-label="예정 날짜" />
                <input type="time" value={planDraft.time} onChange={(e) => setPlanDraft({ ...planDraft, time: e.target.value })} aria-label="예정 시각" />
              </div>
              <div className="tb-seg" role="group" aria-label="예정 대상">
                {COUNSEL_WHO.map((w) => (
                  <button key={w} className={planDraft.who === w ? 'on' : ''} onClick={() => setPlanDraft({ ...planDraft, who: w })}>
                    {w}
                  </button>
                ))}
              </div>
              <input type="text" value={planDraft.memo} onChange={(e) => setPlanDraft({ ...planDraft, memo: e.target.value })} placeholder="메모 (예: 진로 고민)" aria-label="예정 메모" />
              <p className="muted small">달력에 &lsquo;상담 — {student.no}번&rsquo; 으로 올라갑니다(일정을 내보내도 이름이 나가지 않게 번호만 씁니다).</p>
              <div className="cb-row">
                <span className="spacer" />
                <button className="btn btn-sm btn-ghost" onClick={() => setPlanDraft(null)}>
                  닫기
                </button>
                <button className="btn btn-sm btn-primary" onClick={() => void savePlan()}>
                  예정 저장
                </button>
              </div>
            </div>
          )}

          {myPlans.length > 0 && (
            <div className="cb-list">
              <b className="small">예정</b>
              {myPlans.map((p) => (
                <div key={p.id} className="cb-item">
                  <span className="cb-date">
                    {koDate(p.date)}
                    {p.time ? ` ${p.time}` : ''}
                  </span>
                  <span className="cb-first">
                    {p.who}
                    {p.memo ? ` · ${p.memo}` : ''}
                  </span>
                  <button className="btn btn-sm" onClick={() => donePlan(p)}>
                    완료로 기록
                  </button>
                  <button className="btn btn-sm btn-ghost danger" onClick={() => void cancelPlan(p)}>
                    취소
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="cb-list">
            <button className="cb-toggle" onClick={() => setHistory((v) => !v)} aria-expanded={history}>
              이전 상담 보기 ({mine.length}) {history ? '▾' : '▸'}
            </button>
            {history && !mine.length && <p className="muted small">아직 {year}학년도 상담 기록이 없습니다.</p>}
            {history &&
              mine.map((r) => (
                <div key={r.id} className={`cb-item${draft?.id === r.id ? ' on' : ''}`}>
                  <button className="cb-open" onClick={() => editRecord(r)} title="눌러서 고치기">
                    <span className="cb-date">{r.date.slice(2).replace(/-/g, '.')}</span>
                    <span className="cb-meta">
                      {r.who} · {r.topics.join('·') || r.how}
                    </span>
                    <span className="cb-first">{firstLine(r.text) || firstLine(r.follow)}</span>
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => openMessage(r)}>
                    학부모 글
                  </button>
                  <button className="btn btn-sm btn-ghost danger" onClick={() => void removeRecord(r)} aria-label={`${r.date} 기록 지우기`}>
                    지우기
                  </button>
                </div>
              ))}
          </div>

          {msgRec && (
            <div className="cb-form">
              <b className="small">학부모에게 보낼 글 — {koDate(msgRec.date)} 상담</b>
              <label className="check-row small">
                담임 이름
                <input type="text" value={meta.teacher} onChange={(e) => setMeta({ ...meta, teacher: e.target.value })} onBlur={() => void window.api.counsel.meta({ teacher: meta.teacher })} placeholder="○○○" style={{ width: 110 }} />
                <button className="btn btn-sm btn-ghost" onClick={() => setMsg(parentMessage(msgRec, meta.teacher))}>
                  다시 만들기
                </button>
              </label>
              <textarea rows={9} value={msg} onChange={(e) => setMsg(e.target.value)} aria-label="학부모에게 보낼 글" />
              <p className="muted small">문자 · 학교 알림 앱에 붙여 넣어 보내세요. 보내기 전에 내용을 꼭 읽어 보고 고치세요.</p>
              <div className="cb-row">
                <span className="spacer" />
                <button className="btn btn-sm btn-ghost" onClick={() => setMsgFor(null)}>
                  닫기
                </button>
                <button className="btn btn-sm btn-primary" onClick={() => void copyMessage()}>
                  복사
                </button>
              </div>
            </div>
          )}
        </aside>
      )}
    </div>
  )
}
