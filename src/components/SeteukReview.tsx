import { useMemo, useState } from 'react'
import type { ModelChoice } from '../../shared/types'
import { SETEUK_BANNED } from '../../shared/seteukRules'
import { SETEUK_MODES, modeOfRec, studentLabel, validateSeteuk } from '../../shared/seteuk'
import type { SeteukActivity, SeteukRosters, SeteukRows, SeteukStudent } from '../../shared/seteuk'
import { REVIEW_MIN_CHARS } from '../../shared/seteukReview'
import type { ReviewGrade } from '../../shared/seteukReview'
import Markdown from './Markdown'
import { useToast } from '../lib/toast'

/**
 * 세특 작성실 — 학생부 살펴보기.
 * 한 학생의 학생부를 붙여 넣거나 작성실에 쓴 최종본을 모아, 1 · 2학년은 이어 갈 탐구를, 3학년은 짜임과 보완할 곳을 받는다.
 * 대필이 아니라 교사가 다음 기록을 쓰기 위한 의견이다. 기재요령 금지어는 보내기 전에 이 PC 에서 먼저 짚는다.
 */
interface Props {
  students: SeteukStudent[]
  rosters: SeteukRosters
  acts: SeteukActivity[]
  rows: Record<string, SeteukRows>
  model: ModelChoice | null
  onClose: () => void
}

/** 그 학생(이름이 같은 학생)의 모든 영역 최종본(없으면 초안)을 '[영역 · 활동]' 머리를 붙여 모은다 */
function collect(s: SeteukStudent, rosters: SeteukRosters, acts: SeteukActivity[], rows: Record<string, SeteukRows>): string {
  const out: string[] = []
  for (const a of acts) {
    const list = rosters[modeOfRec(a.rec)]
    const same = list.filter((x) => x.name === s.name)
    if (same.length !== 1) continue
    const r = rows[a.id]?.[same[0].id]
    const text = (r?.final.trim() || r?.ai.trim() || '').replace(/\s*\n+\s*/g, ' ')
    if (text) out.push(`[${a.rec} · ${a.name}]\n${text}`)
  }
  return out.join('\n\n')
}

export default function SeteukReview({ students, rosters, acts, rows, model, onClose }: Props): JSX.Element {
  const toast = useToast()
  const [sid, setSid] = useState('')
  const [text, setText] = useState('')
  const [grade, setGrade] = useState<ReviewGrade | ''>('')
  const [career, setCareer] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState('')

  const pick = (id: string): void => {
    setSid(id)
    const s = students.find((x) => x.id === id)
    if (!s) return
    const t = collect(s, rosters, acts, rows)
    if (!t) return toast('이 학생은 작성실에 쓴 글이 아직 없습니다. 학생부를 직접 붙여 넣어 주세요.')
    setText(t)
    setReport('')
  }

  // 기재요령 금지어 — 이 PC 에서만 본다
  const banned = useMemo(() => {
    if (!text.trim()) return []
    return validateSeteuk(text, 0, SETEUK_BANNED).issues.filter((x) => x.label !== '결과 없음')
  }, [text])

  const send = async (dry: boolean): Promise<void> => {
    if (!grade || busy) return
    setBusy(true)
    const r = await window.api.seteuk.review({ text, grade, career, model: model ?? undefined, dry })
    setBusy(false)
    if (!r.ok) return toast(r.error ?? '살펴보지 못했습니다.', 'err')
    if (dry && r.text) {
      await window.api.clipboard.write(r.text)
      return toast('요청 글을 복사했습니다(이름은 가렸습니다). AI 앱에 붙여 넣으세요.', 'ok')
    }
    setReport(r.report ?? '')
  }

  const ready = !!grade && text.trim().length >= REVIEW_MIN_CHARS

  return (
    <section className="card stk-side stk-review">
      <div className="stk-import-head">
        <div className="card-title">학생부 살펴보기</div>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          닫기
        </button>
      </div>
      <p className="small muted">
        한 학생의 학생부를 동료 교사의 눈으로 읽습니다. 1 · 2학년은 앞으로 이어 갈 탐구를, 3학년은 짜임과 보완할 곳을 짚습니다. 글을 대신 써 주지
        않고, 대회 · 논문 · 사교육처럼 기재요령에 걸리는 것은 제안하지 않습니다.
      </p>

      <div className="stk-review-form">
        <label>
          <span>작성실에서 모으기</span>
          <select value={sid} onChange={(e) => pick(e.target.value)}>
            <option value="">학생 고르기 (직접 붙여 넣어도 됩니다)</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {studentLabel(s)} {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>학년</span>
          <select value={grade} onChange={(e) => setGrade(e.target.value as ReviewGrade)}>
            <option value="">고르기</option>
            <option value="1">1학년 — 이어 갈 탐구</option>
            <option value="2">2학년 — 이어 갈 탐구</option>
            <option value="3">3학년 — 짜임과 보완할 곳</option>
          </select>
        </label>
        <label>
          <span>진로 희망 (있으면)</span>
          <input type="text" value={career} onChange={(e) => setCareer(e.target.value)} placeholder="예: 통계 · 데이터 분야" />
        </label>
      </div>
      <textarea
        className="stk-review-text"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setReport('')
        }}
        placeholder={'나이스에서 복사한 세특 · 창체 · 행발을 붙여 넣습니다. 영역 이름을 함께 붙이면 더 잘 읽습니다.\n예) [수학] 교과서에 제시된 공식 대신 …'}
        aria-label="학생부 글"
      />
      <p className="small muted">
        {SETEUK_MODES.length}개 명단에 있는 학생 이름은 가려 보냅니다. 명단에 없는 이름(다른 학년 · 다른 반 학생)이 글에 있으면 지우고 보내 주세요.
      </p>
      {banned.length > 0 && (
        <ul className="stk-issues stk-review-banned">
          {banned.map((x, i) => (
            <li key={i} className={x.level}>
              <b>{x.level === 'block' ? '고침' : '확인'}</b> {x.label}
              {x.hit && <span className="hit"> — {x.hit}</span>}
              {x.why && <span className="why">{x.why}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button className="btn btn-primary btn-sm" onClick={() => void send(false)} disabled={!ready || busy}>
          {busy ? '읽는 중…' : '살펴보기'}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => void send(true)} disabled={!ready || busy} title="AI 키가 없을 때 — 요청 글을 복사해 AI 앱에서 받습니다">
          키 없이 — 요청 글 복사
        </button>
        {!grade && <span className="small muted">학년을 고르면 시작할 수 있습니다.</span>}
      </div>

      {report && (
        <div className="stk-review-out">
          <div className="stk-import-head">
            <span className="stk-style-label">의견</span>
            <span className="spacer" />
            <button
              className="btn btn-sm"
              onClick={() =>
                void (async () => {
                  await window.api.clipboard.write(report)
                  toast('의견을 복사했습니다.', 'ok')
                })()
              }
            >
              복사
            </button>
          </div>
          <div className="stk-review-md">
            <Markdown text={report} />
          </div>
          <p className="small muted">AI 의견입니다. 학생부에 옮기기 전에 학생 · 수업 기록으로 확인해 주세요.</p>
        </div>
      )}
    </section>
  )
}
