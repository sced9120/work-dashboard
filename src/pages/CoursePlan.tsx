/**
 * 교과진도 계획 (3.8.0~) — 학사일정과 주당 시수로 주별 진도표를 세고, 단원 · 성취기준 · 평가 계획을 얹어
 * 학교에 내는 교과진도평가계획을 한글 문서(.hwpx)로 만든다. AI 를 쓰지 않는다.
 *
 * 계획은 이 PC 에만 둔다(localStorage). 학생 정보가 들어가지 않는다.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CourseEval, CoursePlan as Plan, CourseUnit } from '../../shared/coursePlan'
import {
  REGULATION_MARK,
  buildPlan,
  defaultTerm,
  emptyPlan,
  mergeSpans,
  newId,
  planMarkdown,
  planTitle,
  planTsv,
  readPlan,
  scheduleToSpans,
  slotText
} from '../../shared/coursePlan'
import type { DaySpan } from '../../shared/courseCalendar'
import { periodText } from '../../shared/courseCalendar'
import type { KnownHoliday } from '../../shared/courseCalendar'
import { CURRICULUM_CREDIT } from '../../shared/curriculum'
import type { PageId } from '../App'
import StandardPicker, { appendStandards } from '../components/StandardPicker'
import { useConfirm } from '../lib/confirm'
import { holidaysOfYear, lunarKnown } from '../lib/holidays'
import { useToast } from '../lib/toast'

const KEY = 'wd_courseplan'

function loadPlan(): Plan {
  try {
    return readPlan(JSON.parse(window.localStorage.getItem(KEY) || 'null'))
  } catch {
    return emptyPlan()
  }
}

function yearsOf(p: Plan): number[] {
  const a = Number(p.start.slice(0, 4))
  const b = Number(p.end.slice(0, 4))
  if (!a || !b || b < a || b - a > 2) return []
  const out: number[] = []
  for (let y = a; y <= b; y++) out.push(y)
  return out
}

function holidaysFor(p: Plan): { list: KnownHoliday[]; known: number[] } {
  const ys = yearsOf(p)
  const list: KnownHoliday[] = []
  for (const y of ys) for (const h of holidaysOfYear(y)) list.push({ date: h.date, name: h.name })
  return { list, known: ys.filter(lunarKnown) }
}

/** 학년도 고르기 — 올해 앞뒤로, 저장해 둔 해도 넣는다 */
function yearChoices(cur: number): number[] {
  const now = new Date().getFullYear()
  const s = new Set([now - 1, now, now + 1, now + 2, cur])
  return [...s].sort((a, b) => a - b)
}

export default function CoursePlan({ onGo }: { onGo: (p: PageId) => void }): JSX.Element {
  const toast = useToast()
  const ask = useConfirm()
  const [plan, setPlan] = useState<Plan>(loadPlan)
  const [picker, setPicker] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const saveTimer = useRef<number | undefined>(undefined)

  // 고칠 때마다 0.4초 뒤 이 PC 에 저장
  useEffect(() => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(plan))
      } catch {
        // 저장 공간이 없으면 이번 실행 동안만
      }
    }, 400)
    return () => window.clearTimeout(saveTimer.current)
  }, [plan])

  const patch = (p: Partial<Plan>): void => setPlan((v) => ({ ...v, ...p }))
  const hol = useMemo(() => holidaysFor(plan), [plan.start, plan.end]) // eslint-disable-line react-hooks/exhaustive-deps
  const built = useMemo(() => buildPlan(plan, hol.list, hol.known), [plan, hol])

  const setUnit = (id: string, p: Partial<CourseUnit>): void => patch({ units: plan.units.map((u) => (u.id === id ? { ...u, ...p } : u)) })
  const moveUnit = (i: number, d: -1 | 1): void => {
    const j = i + d
    if (j < 0 || j >= plan.units.length) return
    const u = [...plan.units]
    ;[u[i], u[j]] = [u[j], u[i]]
    patch({ units: u })
  }
  const setEval = (id: string, p: Partial<CourseEval>): void => patch({ evals: plan.evals.map((e) => (e.id === id ? { ...e, ...p } : e)) })
  const setSpan = (i: number, p: Partial<DaySpan>): void => patch({ noClass: plan.noClass.map((s, k) => (k === i ? { ...s, ...p } : s)) })

  const addHolidays = (): void => {
    const start = plan.start
    const end = plan.end
    const add = hol.list
      .filter((h) => h.date >= start && h.date <= end)
      .filter((h) => {
        const d = new Date(`${h.date}T00:00:00Z`).getUTCDay()
        return d !== 0 && d !== 6
      })
      .map((h) => ({ from: h.date, to: h.date, label: h.name }))
    const r = mergeSpans(plan.noClass, add)
    patch({ noClass: r.list })
    toast(r.added ? `공휴일 ${r.added}개를 넣었습니다.` : '학기 안 평일 공휴일은 이미 모두 들어 있습니다.', r.added ? 'ok' : undefined)
  }

  const addNeis = async (): Promise<void> => {
    setBusy('neis')
    try {
      const r = await window.api.neis.schedule(plan.start, plan.end)
      if (!r.ok) {
        toast(r.error || '나이스 학사일정을 받지 못했습니다. [설정]에서 학교를 연결했는지 확인해 주세요.', 'err')
        return
      }
      const m = mergeSpans(plan.noClass, scheduleToSpans(r.data))
      patch({ noClass: m.list })
      toast(m.added ? `나이스 학사일정에서 휴업일 · 공휴일 · 정기시험 ${m.added}건을 넣었습니다. 맞는지 꼭 확인해 주세요.` : '더 넣을 휴업일 · 정기시험이 없습니다.', m.added ? 'ok' : undefined)
    } catch {
      toast('나이스 학사일정을 받지 못했습니다.', 'err')
    } finally {
      setBusy('')
    }
  }

  const fitLast = (): void => {
    if (!plan.units.length) return
    const others = plan.units.slice(0, -1).reduce((n, u) => n + u.hours, 0)
    const last = plan.units[plan.units.length - 1]
    const h = built.total - others
    if (h < 1) {
      toast('앞 단원 시수만으로 학기 시간을 넘습니다. 앞 단원 시수를 줄여 주세요.', 'err')
      return
    }
    setUnit(last.id, { hours: h })
    toast(`마지막 단원을 ${h}시간으로 맞췄습니다.`, 'ok')
  }

  const saveHwp = async (): Promise<void> => {
    if (built.error) {
      toast(built.error, 'err')
      return
    }
    setBusy('hwp')
    try {
      const r = await window.api.hwp.answerDoc({ name: planTitle(plan), markdown: planMarkdown(plan, built) })
      toast(r.message, r.ok ? 'ok' : r.message.includes('취소') ? undefined : 'err')
    } finally {
      setBusy('')
    }
  }

  const copyTsv = async (): Promise<void> => {
    if (built.error) return
    await window.api.clipboard.write(planTsv(built))
    toast('진도표를 복사했습니다. 엑셀이나 한글 표에 붙여 넣으세요.', 'ok')
  }

  const reset = async (): Promise<void> => {
    const yes = await ask({ title: '계획을 처음부터 다시 쓸까요?', body: '적어 둔 단원 · 수업 없는 날 · 평가 계획이 모두 지워집니다.', okText: '모두 지우기', danger: true })
    if (yes) setPlan(emptyPlan())
  }

  const pickTerm = (year: number, term: 1 | 2): void => patch({ year, term, ...defaultTerm(year, term) })

  return (
    <>
      <div className="page-head">
        <h1>교과진도 계획</h1>
        <p>
          학사일정과 주당 시수로 <b>주별 진도표</b>(기간 · 수업일 · 공제일 · 시간 · 누계)를 세고, 단원과 성취기준, 평가 계획을 얹어{' '}
          <b>교과진도평가계획</b>을 한글 파일로 만듭니다. AI 를 쓰지 않으며, 적은 내용은 이 컴퓨터에만 남습니다.
        </p>
      </div>

      <div className="note note-warn small">
        만든 계획은 <b>초안</b>입니다. 반영 비율 · 기본점수 · 결시 처리는 학교 학업성적관리규정을 따르세요. 문서의 {REGULATION_MARK} 표시를 고친 뒤 지우고
        제출하세요.
      </div>

      {/* 1. 기본 */}
      <section className="card cp-card">
        <div className="card-title">
          <span>1. 과목과 학기</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void reset()}>
            처음부터 다시
          </button>
        </div>
        <div className="cp-grid">
          <label className="field">
            <span className="cp-lbl">학년도</span>
            <select value={plan.year} onChange={(e) => pickTerm(Number(e.target.value), plan.term)}>
              {yearChoices(plan.year).map((y) => (
                <option key={y} value={y}>
                  {y}학년도
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="cp-lbl">학기</span>
            <select value={plan.term} onChange={(e) => pickTerm(plan.year, e.target.value === '2' ? 2 : 1)}>
              <option value={1}>1학기</option>
              <option value={2}>2학기</option>
            </select>
          </label>
          <label className="field">
            <span className="cp-lbl">과목</span>
            <input type="text" value={plan.subject} onChange={(e) => patch({ subject: e.target.value })} placeholder="예: 공통수학1" />
          </label>
          <label className="field">
            <span className="cp-lbl">대상</span>
            <input type="text" value={plan.grade} onChange={(e) => patch({ grade: e.target.value })} placeholder="예: 1학년 1~6반" />
          </label>
          <label className="field">
            <span className="cp-lbl">담당</span>
            <input type="text" value={plan.teacher} onChange={(e) => patch({ teacher: e.target.value })} placeholder="예: 교사01" />
          </label>
          <label className="field">
            <span className="cp-lbl">주당 시수</span>
            <input type="number" min={1} max={35} value={plan.weeklyHours} onChange={(e) => patch({ weeklyHours: Math.max(1, Math.min(35, Math.floor(Number(e.target.value) || 1))) })} />
          </label>
          <label className="field">
            <span className="cp-lbl">개학일 (첫 수업일)</span>
            <input type="date" value={plan.start} onChange={(e) => patch({ start: e.target.value })} />
          </label>
          <label className="field">
            <span className="cp-lbl">마지막 수업일</span>
            <input type="date" value={plan.end} onChange={(e) => patch({ end: e.target.value })} />
          </label>
          <label className="field">
            <span className="cp-lbl">진도표 한 줄</span>
            <select value={plan.group} onChange={(e) => patch({ group: e.target.value === '2' ? 2 : 1 })}>
              <option value={1}>1주씩</option>
              <option value={2}>2주씩 묶기</option>
            </select>
          </label>
        </div>
      </section>

      {/* 2. 수업 없는 날 */}
      <section className="card cp-card">
        <div className="card-title">
          <span>2. 수업 없는 날 (공휴일 · 재량휴업일 · 정기시험)</span>
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={addHolidays}>
              공휴일 넣기
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void addNeis()} disabled={busy === 'neis'}>
              {busy === 'neis' ? '받는 중…' : '나이스 학사일정에서 넣기'}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => patch({ noClass: [...plan.noClass, { from: plan.start, to: plan.start, label: '' }] })}>
              ＋ 직접 넣기
            </button>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          평일 가운데 이 과목 수업이 없는 날만 넣으세요. 정기시험 기간처럼 며칠이 이어지면 시작일과 끝날을 적습니다. 공휴일은 프로그램이 계산하고, 선거일 · 임시공휴일은
          나이스 학사일정이나 직접 넣기로 넣습니다.
        </p>
        {plan.noClass.length === 0 ? (
          <div className="empty small">아직 없습니다. [공휴일 넣기]부터 눌러 보세요.</div>
        ) : (
          <div className="cp-spans">
            {plan.noClass.map((s, i) => (
              <div key={i} className="cp-span">
                <input type="date" value={s.from} onChange={(e) => setSpan(i, { from: e.target.value, to: s.to && s.to >= e.target.value ? s.to : e.target.value })} aria-label={`${i + 1}번째 시작일`} />
                <span className="muted">~</span>
                <input type="date" value={s.to} min={s.from} onChange={(e) => setSpan(i, { to: e.target.value })} aria-label={`${i + 1}번째 끝날`} />
                <input type="text" value={s.label} onChange={(e) => setSpan(i, { label: e.target.value })} placeholder="이름 (예: 1회 정기고사)" aria-label={`${i + 1}번째 이름`} />
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => patch({ noClass: plan.noClass.filter((_x, k) => k !== i) })} aria-label={`${s.label || i + 1 + '번째'} 빼기`}>
                  빼기
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 3. 단원 */}
      <section className="card cp-card">
        <div className="card-title">
          <span>
            3. 단원과 시수{' '}
            <span className={`badge ${built.unitHours === built.total && built.total > 0 ? '' : 'badge-warn'}`}>
              단원 {built.unitHours}시간 / 학기 {built.total}시간
            </span>
          </span>
          <div className="row">
            {plan.units.length > 0 && built.unitHours !== built.total && (
              <button type="button" className="btn btn-sm" onClick={fitLast}>
                마지막 단원으로 맞추기
              </button>
            )}
            <button type="button" className="btn btn-sm btn-primary" onClick={() => patch({ units: [...plan.units, { id: newId('u'), name: '', hours: 0, standards: '' }] })}>
              ＋ 단원
            </button>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          가르칠 차례대로 단원을 넣고 시수를 적으면 주마다 차례로 나눕니다. 성취기준은 [성취기준 찾기]로 고르면 진도표에 코드가 들어갑니다.
        </p>
        {plan.units.length === 0 ? (
          <div className="empty small">아직 단원이 없습니다. [＋ 단원]을 눌러 넣으세요.</div>
        ) : (
          <div className="cp-units">
            {plan.units.map((u, i) => (
              <div key={u.id} className="cp-unit">
                <div className="cp-unit-head">
                  <b className="cp-no">{i + 1}</b>
                  <input type="text" value={u.name} onChange={(e) => setUnit(u.id, { name: e.target.value })} placeholder="단원 이름 (예: Ⅰ. 다항식)" aria-label={`${i + 1}번째 단원 이름`} />
                  <label className="cp-hours">
                    <input type="number" min={0} max={500} value={u.hours || ''} onChange={(e) => setUnit(u.id, { hours: Math.max(0, Math.min(500, Math.floor(Number(e.target.value) || 0))) })} aria-label={`${i + 1}번째 단원 시수`} />
                    <span>시간</span>
                  </label>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => moveUnit(i, -1)} disabled={i === 0} aria-label={`${i + 1}번째 단원 위로`}>
                    ↑
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => moveUnit(i, 1)} disabled={i === plan.units.length - 1} aria-label={`${i + 1}번째 단원 아래로`}>
                    ↓
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => patch({ units: plan.units.filter((x) => x.id !== u.id) })} aria-label={`${i + 1}번째 단원 빼기`}>
                    빼기
                  </button>
                </div>
                <div className="cp-std">
                  <textarea value={u.standards} onChange={(e) => setUnit(u.id, { standards: e.target.value })} placeholder="관련 성취기준 — 한 줄에 하나 (예: [10공수1-01-01] 다항식의 사칙연산의 …)" aria-label={`${i + 1}번째 단원 성취기준`} />
                  <button type="button" className="btn btn-sm" onClick={() => setPicker(u.id)}>
                    성취기준 찾기
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. 평가 */}
      <section className="card cp-card">
        <div className="card-title">
          <span>
            4. 평가 계획{' '}
            <span className={`badge ${plan.evals.reduce((n, e) => n + e.ratio, 0) === 100 ? '' : 'badge-warn'}`}>반영 비율 합 {plan.evals.reduce((n, e) => n + e.ratio, 0)}%</span>
          </span>
          <button type="button" className="btn btn-sm" onClick={() => patch({ evals: [...plan.evals, { id: newId('e'), kind: '수행', name: '', ratio: 0, when: '', detail: '' }] })}>
            ＋ 평가
          </button>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          처음 값(지필 30 · 30, 수행 40)은 흔한 예시입니다. 학교 학업성적관리규정대로 고쳐 주세요.
        </p>
        <div className="cp-evals">
          {plan.evals.map((e, i) => (
            <div key={e.id} className="cp-eval">
              <select value={e.kind} onChange={(x) => setEval(e.id, { kind: x.target.value === '수행' ? '수행' : '지필' })} aria-label={`${i + 1}번째 평가 구분`}>
                <option value="지필">지필</option>
                <option value="수행">수행</option>
              </select>
              <input type="text" value={e.name} onChange={(x) => setEval(e.id, { name: x.target.value })} placeholder="평가 이름" aria-label={`${i + 1}번째 평가 이름`} />
              <label className="cp-hours">
                <input type="number" min={0} max={100} value={e.ratio} onChange={(x) => setEval(e.id, { ratio: Math.max(0, Math.min(100, Math.floor(Number(x.target.value) || 0))) })} aria-label={`${i + 1}번째 반영 비율`} />
                <span>%</span>
              </label>
              <input type="text" value={e.when} onChange={(x) => setEval(e.id, { when: x.target.value })} placeholder="시기 (예: 4월 4주)" aria-label={`${i + 1}번째 시기`} />
              <input type="text" className="cp-detail" value={e.detail} onChange={(x) => setEval(e.id, { detail: x.target.value })} placeholder="영역 · 방법 · 내용" aria-label={`${i + 1}번째 내용`} />
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => patch({ evals: plan.evals.filter((x) => x.id !== e.id) })} aria-label={`${i + 1}번째 평가 빼기`}>
                빼기
              </button>
            </div>
          ))}
        </div>
        <label className="field" style={{ marginTop: 12 }}>
          <span className="cp-lbl">그 밖의 사항 (한 줄에 하나)</span>
          <textarea value={plan.extra} onChange={(e) => patch({ extra: e.target.value })} placeholder="예: 결시생은 학업성적관리규정 제00조에 따라 인정점을 준다" style={{ minHeight: 70 }} />
        </label>
      </section>

      {/* 5. 진도표 */}
      <section className="card cp-card">
        <div className="card-title">
          <span>5. 주별 진도표 미리 보기</span>
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={() => void copyTsv()} disabled={!!built.error}>
              표 복사 (엑셀용)
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void saveHwp()} disabled={!!built.error || busy === 'hwp'}>
              {busy === 'hwp' ? '만드는 중…' : '한글 파일로 저장'}
            </button>
          </div>
        </div>
        {built.error ? (
          <div className="note note-warn small">{built.error}</div>
        ) : (
          <>
            {built.warnings.length > 0 && (
              <div className="note note-info small cp-warn">
                <b>확인해 주세요</b>
                <ul>
                  {built.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="cp-table-wrap">
              <table className="cp-table">
                <thead>
                  <tr>
                    <th>주</th>
                    <th>기간</th>
                    <th>수업일</th>
                    <th>공제</th>
                    <th>시간</th>
                    <th>누계</th>
                    <th>단원 (차시)</th>
                    <th>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {built.rows.map((r, i) => (
                    <tr key={r.week} className={r.hours === 0 ? 'cp-zero' : ''}>
                      <td>{r.week}</td>
                      <td>{periodText(r.start, r.end)}</td>
                      <td>{r.classDays}</td>
                      <td>{r.deducted || ''}</td>
                      <td>{r.hours}</td>
                      <td>{r.cumulative}</td>
                      <td>{(built.slots[i] ?? []).map(slotText).join(', ')}</td>
                      <td className="small">{r.notes.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>
          시간은 한 반 기준 「주당 시수 × 수업일 ÷ 5」를 누계에서 반올림해 나눈 값입니다. {CURRICULUM_CREDIT}{' '}
          <button type="button" className="link" onClick={() => onGo('성취기준')}>
            성취기준 찾기 화면
          </button>
        </p>
      </section>

      {picker && (
        <StandardPicker
          title={`성취기준 찾기 — ${plan.units.find((u) => u.id === picker)?.name || '단원'}`}
          onClose={() => setPicker(null)}
          onPick={(_lines, picked) => {
            const u = plan.units.find((x) => x.id === picker)
            if (u) setUnit(u.id, { standards: appendStandards(u.standards, picked) })
          }}
        />
      )}
    </>
  )
}
