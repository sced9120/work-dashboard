import { useMemo, useState } from 'react'
import { FORM_MAX_COLUMNS, cleanFormSheet, formQuestions, planNewActFromForm } from '../../shared/batchSend'
import type { NewActFromSheetPlan, SeteukFormMeta } from '../../shared/batchSend'
import { SETEUK_RECORDS, formToSheet, modeInfo } from '../../shared/seteuk'
import type { SeteukActivity, SeteukMode, SeteukSheet, SeteukStudent } from '../../shared/seteuk'
import { useToast } from '../lib/toast'
import RelayCard from './RelayCard'

/**
 * 구글 설문지 응답 시트로 새 활동 만들기.
 * 고른 문항이 활동의 입력 항목이 되고, 학번 · 이름으로 맞춘 학생마다 답이 들어간다. AI 로는 가지 않는다.
 * 응답은 폰 연결 스크립트(선생님 구글 계정)가 읽어 온다 — [관찰 기록 가져오기 → 구글 설문지] 와 같은 길.
 */
interface Props {
  mode: SeteukMode
  /** 이 갈래의 명단 전체 */
  students: SeteukStudent[]
  /** 지금 보던 활동 — 기록 영역 · 과목의 처음 값 */
  base: SeteukActivity | null
  onCreate: (plan: NewActFromSheetPlan, meta: SeteukFormMeta) => Promise<boolean>
  onClose: () => void
}

interface Pulled {
  url: string
  sheet: SeteukSheet
  title: string
  last: number
  count: number
}

/** '설문지 이름(응답)' → '설문지 이름' */
const actName = (title: string): string => title.replace(/\s*\((응답|Responses)\)\s*$/i, '').trim()

export default function SeteukFormAct({ mode, students, base, onCreate, onClose }: Props): JSX.Element {
  const toast = useToast()
  const info = modeInfo(mode)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needVer, setNeedVer] = useState(0)
  const [data, setData] = useState<Pulled | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [name, setName] = useState('')
  const [rec, setRec] = useState(() => (base && info.recs.includes(base.rec) ? base.rec : info.recs[0]))
  const [subject, setSubject] = useState(base?.subject ?? '')
  const [desc, setDesc] = useState('')
  const [id] = useState(() => `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`)

  const read = async (): Promise<void> => {
    const at = url.trim()
    if (busy || !at) return
    setBusy(true)
    setError('')
    setNeedVer(0)
    setData(null)
    let r: Awaited<ReturnType<typeof window.api.relay.form>>
    try {
      r = await window.api.relay.form(at, 0)
    } catch {
      return setError('응답 시트를 읽지 못했습니다. 잠시 뒤 다시 해 주세요.')
    } finally {
      setBusy(false)
    }
    if (!r.ok || !r.data) {
      if (r.needVer) setNeedVer(r.needVer)
      return setError(r.error ?? '응답 시트를 읽지 못했습니다.')
    }
    const d = r.data
    if (!d.rows.length) return setError('응답이 아직 없습니다. 응답이 한 건 이상 들어온 뒤에 만들어 주세요.')
    const sheet = cleanFormSheet(formToSheet(d.head, d.rows))
    setData({ url: at, sheet, title: d.title, last: d.last, count: d.rows.length })
    setPicked(formQuestions(sheet).slice(0, FORM_MAX_COLUMNS).map((q) => q.index))
    setName(actName(d.title) || '설문지 응답')
  }

  const questions = useMemo(() => (data ? formQuestions(data.sheet) : []), [data])
  const plan = useMemo(() => {
    if (!data) return null
    const today = new Date()
    return planNewActFromForm(data.sheet, students, picked, { id, name, rec, subject: rec === '과세특' ? subject : '', desc }, `[설문 ${today.getMonth() + 1}/${today.getDate()}]`)
  }, [data, students, picked, id, name, rec, subject, desc])

  const toggle = (index: number): void => setPicked((p) => (p.includes(index) ? p.filter((i) => i !== index) : [...p, index].sort((a, b) => a - b)))

  const create = async (): Promise<void> => {
    if (!data || !plan?.matched || busy) return
    setBusy(true)
    const cols = questions.filter((q) => picked.includes(q.index)).map((q) => q.name)
    const ok = await onCreate(plan, { sheet: data.url, last: data.last, title: data.title, cols })
    setBusy(false)
    if (ok) onClose()
    else toast('다시 해 주세요.', 'err')
  }

  return (
    <div className="stk-panel stk-import stk-formact">
      <div className="stk-import-head">
        <b>설문지로 새 활동 만들기</b>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          닫기
        </button>
      </div>
      <p className="small">
        <b>구글 설문지 응답</b>으로 {info.name} 활동을 새로 만듭니다. 고른 문항이 활동의 칸(입력 항목)이 되고, 학생마다 답이 들어갑니다. 설문지에 <b>학번(또는 반 · 번호)</b>이나 <b>이름</b> 문항이 있어야 학생을 맞출 수 있습니다. 응답은
        선생님 구글 계정의 폰 연결 스크립트가 읽어 오고, 이 PC 의 명단은 구글로 가지 않으며 AI 로도 보내지 않습니다.
      </p>
      <label className="stk-form-url">
        <span>응답 시트 주소</span>
        <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" disabled={busy} />
      </label>
      <p className="small muted">설문지 편집 화면 [응답] 탭 → 초록 스프레드시트 아이콘(Sheets 에 연결) → 열린 시트의 주소를 복사해 붙여 넣으세요.</p>
      <div className="row">
        <button className="btn btn-sm btn-primary" onClick={() => void read()} disabled={busy || !url.trim()}>
          {busy ? '읽는 중…' : '응답 읽기'}
        </button>
      </div>
      {needVer > 0 && (
        <RelayCard
          tab="text"
          needs={needVer}
          startOpen
          title="폰 연결 — 설문지 읽기"
          desc="설문지 응답 시트를 읽으려면 폰 연결 코드가 새 판이어야 합니다"
          howTo={<p className="small">폰 관찰 · 출결 · 글 보내기는 지금처럼 그대로 쓰고, 같은 주소에서 설문지 응답도 읽을 수 있게 됩니다.</p>}
        />
      )}
      {error && <p className="note note-danger small">{error}</p>}

      {data && plan && (
        <>
          <p className="small" role="status">
            「{data.title}」 응답 <b>{data.count}건</b>을 읽었습니다.
          </p>
          <div className="stk-formact-grid">
            <label>
              <span>활동 이름</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              <span>기록 영역</span>
              <select value={rec} onChange={(e) => setRec(e.target.value)} disabled={info.recs.length < 2}>
                {SETEUK_RECORDS.filter((r) => info.recs.includes(r.key)).map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.key} — {r.name}
                  </option>
                ))}
              </select>
            </label>
            {rec === '과세특' && (
              <label>
                <span>과목</span>
                <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="예: 공통수학2" />
              </label>
            )}
            <label className="stk-formact-wide">
              <span>활동 개요 (나중에 [활동 설정]에서 적어도 됩니다)</span>
              <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="무엇을 한 수업 · 활동인지" />
            </label>
          </div>
          <fieldset className="stk-formact-q">
            <legend>
              가져올 문항 {picked.length}개 <span className="muted">— {FORM_MAX_COLUMNS}개까지. 동의 확인처럼 필요 없는 문항은 빼세요</span>
            </legend>
            {questions.map((q) => (
              <label key={q.index}>
                <input type="checkbox" checked={picked.includes(q.index)} onChange={() => toggle(q.index)} disabled={busy || (!picked.includes(q.index) && picked.length >= FORM_MAX_COLUMNS)} />
                <span>{q.name}</span>
              </label>
            ))}
            {!questions.length && <p className="small muted">학번 · 이름 말고는 가져올 문항이 없습니다.</p>}
          </fieldset>
          {!students.length ? (
            <p className="note note-warn small">{info.name} 명단이 비어 있어 학생을 맞출 수 없습니다. 명단을 먼저 넣어 주세요.</p>
          ) : (
            <div className="small" role="status">
              <b>{plan.matched}명 맞춤</b> · 맞추지 못한 줄 {plan.missed.length}
              {picked.length === 1 && <span className="muted"> · 문항이 하나라 관찰 기록 한 칸에 넣습니다</span>}
              {plan.missed.length > 0 && <div className="muted">못 찾은 줄: {plan.missed.join(', ')}</div>}
              {picked.length > 0 && !plan.matched && <div className="muted">맞춘 학생이 없습니다. 설문지에 학번(또는 반 · 번호)이나 이름 문항이 있는지, 명단과 같은지 확인하세요.</div>}
            </div>
          )}
          <div className="row">
            <button className="btn btn-sm btn-primary" onClick={() => void create()} disabled={busy || !plan.matched || !name.trim()}>
              {plan.matched ? `활동 만들고 ${plan.matched}명 넣기` : '활동 만들기'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
