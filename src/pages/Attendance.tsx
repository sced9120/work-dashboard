import { useEffect, useMemo, useState } from 'react'
import type { AttProof, AttReason, AttRecord, AttType, Roster } from '../../shared/attendance'
import { ATT_PROOF_DAYS_KEY, ATT_REASONS, ATT_RECORDS_KEY, ATT_ROSTER_KEY, ATT_TYPES, MARK, addSchoolDays, defaultProof, parseRoster, readProofDays, readRecords, readRoster, recordsTsv, summarize, upsertRecords } from '../../shared/attendance'
import { daysLeft, ddayLabel } from './Deadlines'
import type { PageId } from '../App'
import Icon from '../components/Icon'
import RelayCard from '../components/RelayCard'
import { todayStr } from '../lib/util'
import { useToast } from '../lib/toast'

/**
 * 출결 기록 — 우리 반 명단과 결석 · 지각 · 조퇴 · 결과.
 * 나이스에 넣는 것은 선생님이 직접 하고, 여기서는 '서류를 받았는지 · 나이스에 넣었는지' 를 챙긴다.
 * 학생 이름이 들어 있어 인수인계 파일에는 넣지 않는다.
 */

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const pad = (n: number): string => String(n).padStart(2, '0')
const md = (day: string): string => {
  const d = new Date(`${day}T00:00:00`)
  return `${d.getMonth() + 1}. ${d.getDate()}.(${WEEK[d.getDay()]})`
}

interface Draft {
  id?: string
  date: string
  no: number
  type: AttType
  reason: AttReason
  note: string
  proof: AttProof
  neis: boolean
}

export default function Attendance({ onGo }: { onGo: (p: PageId) => void }): JSX.Element {
  const toast = useToast()
  const today = todayStr()
  const [roster, setRoster] = useState<Roster | null>(null)
  const [records, setRecords] = useState<AttRecord[]>([])
  const [month, setMonth] = useState(today.slice(0, 7))
  const [editRoster, setEditRoster] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [proofDays, setProofDays] = useState(5)

  useEffect(() => {
    void (async () => {
      const r = readRoster(await window.api.setting.get(ATT_ROSTER_KEY))
      if (!r.cls) r.cls = (await window.api.setting.get('my_class')) || ''
      setRoster(r)
      setRecords(readRecords(await window.api.setting.get(ATT_RECORDS_KEY, '[]')))
      setProofDays(readProofDays(await window.api.setting.get(ATT_PROOF_DAYS_KEY, '')))
      if (!r.students.length) setEditRoster(true)
    })()
  }, [])

  // 폰 · 업무 도우미가 출결을 넣으면 다시 읽는다
  useEffect(() => {
    const again = (): void => void (async () => setRecords(readRecords(await window.api.setting.get(ATT_RECORDS_KEY, '[]'))))()
    const off = window.api.relay.onRouted((r) => {
      if (r.att) again()
    })
    window.addEventListener('att:changed', again)
    return () => {
      off()
      window.removeEventListener('att:changed', again)
    }
  }, [])

  const saveRecords = (next: AttRecord[]): void => {
    setRecords(next)
    void window.api.setting.set(ATT_RECORDS_KEY, JSON.stringify(next))
  }

  const days = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const n = new Date(y, m, 0).getDate()
    return Array.from({ length: n }, (_, i) => `${month}-${pad(i + 1)}`).filter((d) => {
      const w = new Date(`${d}T00:00:00`).getDay()
      return w !== 0 && w !== 6
    })
  }, [month])

  if (!roster) return <div className="muted">불러오는 중…</div>

  const name = (no: number): string => roster.students.find((s) => s.no === no)?.name ?? `${no}번`
  const inMonth = records.filter((r) => r.date.startsWith(month))
  const sums = summarize(records, `${month}-01`, `${month}-31`)
  const todo = records.filter((r) => r.proof === '필요' || !r.neis)
  const shift = (d: number): void => {
    const [y, m] = month.split('-').map(Number)
    const x = new Date(y, m - 1 + d, 1)
    setMonth(`${x.getFullYear()}-${pad(x.getMonth() + 1)}`)
  }

  const save = (): void => {
    if (!draft || !draft.no || !draft.date) return toast('학생과 날짜를 골라 주세요.', 'err')
    const rec: AttRecord = { id: draft.id ?? `${Date.now()}`, date: draft.date, no: draft.no, type: draft.type, reason: draft.reason, note: draft.note.trim(), proof: draft.proof, neis: draft.neis }
    const base = draft.id ? records.filter((r) => r.id !== draft.id) : records
    saveRecords(upsertRecords(base, [rec]))
    setDraft(null)
    toast('저장했습니다.', 'ok')
  }

  const patch = (id: string, p: Partial<AttRecord>): void => saveRecords(records.map((r) => (r.id === id ? { ...r, ...p } : r)))

  const open = (date: string, no: number): void => {
    const r = records.find((x) => x.date === date && x.no === no)
    setDraft(r ? { ...r } : { date, no, type: '결석', reason: '질병', note: '', proof: '필요', neis: false })
  }

  return (
    <div className="att-page">
      <div className="page-head page-head-row">
        <div>
          <h1>출결 기록</h1>
          <p>
            {roster.cls ? `${roster.cls} · ` : ''}명단 {roster.students.length}명 · 나이스에 넣기 전에 모아 두고, 서류 · 나이스 입력을 챙깁니다.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-sm" onClick={() => onGo('메신저')}>
            메신저 글에서 뽑기
          </button>
          <button className="btn btn-sm" onClick={() => setEditRoster((v) => !v)}>
            명단
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => setDraft({ date: today, no: 0, type: '결석', reason: '질병', note: '', proof: '필요', neis: false })} disabled={!roster.students.length}>
            ＋ 기록
          </button>
        </div>
      </div>

      {roster.students.length > 0 && (
        <RelayCard
          tab="att"
          title="폰으로 출결 체크"
          desc="조회 시간에 폰으로 번호만 누르면 오늘 날짜로 여기에 들어옵니다"
          howTo={
            <ol className="small relay-how">
              <li>폰 화면의 <b>[출결]</b> 탭에서 결석 · 지각 · 조퇴 · 결과인 학생 번호만 누릅니다.</li>
              <li>폰에는 번호와 이름이 함께 보이지만 구글에는 이 PC 에서 잠근 글만 갑니다. 구분 · 사유를 고르고 메모를 적어 [보내기]. 잘못 보냈으면 그 번호를 다시 눌러 고치거나 [지우기].</li>
              <li>3분 안에 이 표에 들어오고, 서류 · 나이스 입력을 챙길 목록에도 잡힙니다. 업무 도우미에게 &quot;오늘 출결 정리해 줘&quot; 처럼 물어도 됩니다.</li>
            </ol>
          }
        />
      )}

      {editRoster && (
        <RosterCard
          roster={roster}
          onSave={(r) => {
            setRoster(r)
            void window.api.setting.set(ATT_ROSTER_KEY, JSON.stringify(r))
            setEditRoster(false)
            toast(`명단 ${r.students.length}명을 저장했습니다.`, 'ok')
          }}
          onClose={roster.students.length ? () => setEditRoster(false) : undefined}
        />
      )}

      {draft && (
        <section className="card att-form">
          <b>{draft.id ? '기록 고치기' : '새 기록'}</b>
          <div className="att-form-row">
            <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} aria-label="날짜" />
            <select value={draft.no} onChange={(e) => setDraft({ ...draft, no: Number(e.target.value) })} aria-label="학생">
              <option value={0}>학생 고르기</option>
              {roster.students.map((s) => (
                <option key={s.no} value={s.no}>
                  {s.no}. {s.name}
                </option>
              ))}
            </select>
            <div className="tb-seg" role="group" aria-label="구분">
              {ATT_TYPES.map((t) => (
                <button key={t} className={draft.type === t ? 'on' : ''} onClick={() => setDraft({ ...draft, type: t })}>
                  {t}
                </button>
              ))}
            </div>
            <div className="tb-seg" role="group" aria-label="사유">
              {ATT_REASONS.map((r) => (
                <button key={r} className={draft.reason === r ? 'on' : ''} onClick={() => setDraft({ ...draft, reason: r, proof: defaultProof(r) })}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <input type="text" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="내용 (예: 장염, 병원 들렀다 등교)" aria-label="내용" />
          <div className="att-form-row">
            <label className="check-row">
              서류
              <select value={draft.proof} onChange={(e) => setDraft({ ...draft, proof: e.target.value as AttProof })}>
                <option value="필요">받아야 함</option>
                <option value="냄">받음</option>
                <option value="없음">필요 없음</option>
              </select>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={draft.neis} onChange={(e) => setDraft({ ...draft, neis: e.target.checked })} />
              나이스에 넣음
            </label>
            <span className="spacer" />
            {draft.id && (
              <button
                className="btn btn-sm btn-ghost danger"
                onClick={() => {
                  saveRecords(records.filter((r) => r.id !== draft.id))
                  setDraft(null)
                }}
              >
                지우기
              </button>
            )}
            <button className="btn btn-sm btn-ghost" onClick={() => setDraft(null)}>
              취소
            </button>
            <button className="btn btn-sm btn-primary" onClick={save}>
              저장
            </button>
          </div>
        </section>
      )}

      {roster.students.length > 0 && (
        <section className="card att-month">
          <div className="att-month-head">
            <button className="btn btn-sm btn-ghost" onClick={() => shift(-1)} aria-label="이전 달">
              ‹
            </button>
            <b>{Number(month.slice(5))}월</b>
            <button className="btn btn-sm btn-ghost" onClick={() => shift(1)} aria-label="다음 달">
              ›
            </button>
            <span className="spacer" />
            <span className="att-legend small muted">
              {ATT_TYPES.map((t) => `${MARK[t]} ${t}`).join('  ')} · 미인정은 주황
            </span>
            <button
              className="btn btn-sm"
              onClick={() =>
                void (async () => {
                  await window.api.clipboard.write(recordsTsv(inMonth, roster))
                  toast('이 달 기록을 표로 복사했습니다. 엑셀에 붙여 넣으세요.', 'ok')
                })()
              }
              disabled={!inMonth.length}
            >
              표 복사
            </button>
          </div>
          <div className="att-table-wrap">
            <table className="att-table">
              <thead>
                <tr>
                  <th className="att-name">번호 · 이름</th>
                  {days.map((d) => (
                    <th key={d} className={d === today ? 'today' : ''}>
                      {Number(d.slice(8))}
                    </th>
                  ))}
                  <th>결석</th>
                  <th>지각</th>
                  <th>조퇴</th>
                  <th>결과</th>
                </tr>
              </thead>
              <tbody>
                {roster.students.map((s) => {
                  const sum = sums.get(s.no)
                  const n = (t: AttType): number => Object.values(sum?.counts[t] ?? {}).reduce((a, b) => a + (b ?? 0), 0)
                  return (
                    <tr key={s.no}>
                      <td className="att-name">
                        {s.no}. {s.name}
                      </td>
                      {days.map((d) => {
                        const rs = inMonth.filter((r) => r.date === d && r.no === s.no)
                        return (
                          <td key={d} className={d === today ? 'today' : ''}>
                            <button className={`att-cell ${rs.length ? 'has' : ''} ${rs.some((r) => r.reason === '미인정') ? 'bad' : ''}`} onClick={() => open(d, s.no)} title={rs.map((r) => `${r.type}(${r.reason}) ${r.note}`).join('\n') || `${md(d)} ${s.name} 기록 넣기`}>
                              {rs.map((r) => MARK[r.type]).join('')}
                            </button>
                          </td>
                        )
                      })}
                      {ATT_TYPES.map((t) => (
                        <td key={t} className="att-sum">
                          {n(t) || ''}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {todo.length > 0 && (
        <section className="card att-todo">
          <div className="att-todo-head">
            <span>
              <b>챙길 것 {todo.length}</b>
              <span className="muted small"> — 서류를 아직 안 받았거나 나이스에 넣지 않은 기록</span>
            </span>
            <label className="small att-proof-days" title="서류를 받을 기한. 학교 규정에 맞춰 정하세요. 절차 기한 화면 · 기한 알림에도 같은 날짜로 나옵니다">
              서류 기한: 출결 뒤 평일
              <input
                type="number"
                min={1}
                max={30}
                value={proofDays}
                onChange={(e) => {
                  const v = readProofDays(e.target.value)
                  setProofDays(v)
                  void window.api.setting.set(ATT_PROOF_DAYS_KEY, String(v))
                }}
                aria-label="서류 기한 (평일 며칠)"
              />
              일
            </label>
          </div>
          <div className="att-todo-list">
            {todo.map((r) => (
              <div key={r.id} className="att-todo-row">
                <span className="att-todo-date">{md(r.date)}</span>
                <span className="att-todo-who">
                  {r.no}. {name(r.no)}
                </span>
                <span className={`att-chip ${r.reason === '미인정' ? 'bad' : ''}`}>
                  {r.type} · {r.reason}
                </span>
                <span className="att-todo-note muted small">{r.note}</span>
                <span className="spacer" />
                {r.proof === '필요' &&
                  (() => {
                    const due = addSchoolDays(r.date, proofDays)
                    const left = daysLeft(due) ?? 0
                    return (
                      <span className={`badge ${left < 0 ? 'badge-danger' : left <= 2 ? 'badge-warn' : ''}`} title={`서류 기한 ${due}`}>
                        서류 {md(due)}까지 · {ddayLabel(due)}
                      </span>
                    )
                  })()}
                {r.proof === '필요' && (
                  <button className="btn btn-sm" onClick={() => patch(r.id, { proof: '냄' })}>
                    서류 받음
                  </button>
                )}
                {!r.neis && (
                  <button className="btn btn-sm" onClick={() => patch(r.id, { neis: true })}>
                    나이스 넣음
                  </button>
                )}
                <button className="btn btn-sm btn-ghost" onClick={() => setDraft({ ...r })} aria-label="고치기" title="고치기">
                  <Icon name="edit" size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function RosterCard({ roster, onSave, onClose }: { roster: Roster; onSave: (r: Roster) => void; onClose?: () => void }): JSX.Element {
  const [cls, setCls] = useState(roster.cls)
  const [text, setText] = useState(roster.students.map((s) => `${s.no} ${s.name}`).join('\n'))
  const parsed = parseRoster(text)
  return (
    <section className="card att-roster">
      <b>우리 반 명단</b>
      <p className="muted small">
        한 줄에 한 명 — '1 홍길동' · '20401 홍길동'(학번) · 엑셀에서 번호 · 이름 두 칸을 복사해 붙여 넣어도 됩니다.
        명단은 이 PC 에만 두고 인수인계 파일에는 넣지 않습니다. 메신저 정리에서 이 이름은 '학생7' 처럼 번호로 바꿔 AI 에 보냅니다.
      </p>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <label className="check-row">
          반
          <input type="text" value={cls} onChange={(e) => setCls(e.target.value)} placeholder="예: 2-4" style={{ width: 80 }} />
        </label>
        <span className="muted small">읽은 학생 {parsed.length}명</span>
      </div>
      <textarea className="att-roster-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={'1 강하늘\n2 김민준\n3 박서연'} />
      <div className="row row-end" style={{ gap: 8, marginTop: 8 }}>
        {onClose && (
          <button className="btn btn-ghost" onClick={onClose}>
            닫기
          </button>
        )}
        <button className="btn btn-primary" onClick={() => onSave({ cls: cls.trim(), students: parsed })} disabled={!parsed.length}>
          저장
        </button>
      </div>
    </section>
  )
}
