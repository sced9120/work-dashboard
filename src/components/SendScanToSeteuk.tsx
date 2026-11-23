import { useEffect, useMemo, useState } from 'react'
import type { MdTable } from '../../shared/mdtable'
import { planNewActFromSheets, planSheetSend } from '../../shared/batchSend'
import type { SheetSendMode } from '../../shared/batchSend'
import { SETEUK_RECORDS, modeInfo, modeOfRec } from '../../shared/seteuk'
import type { SeteukActivity, SeteukRosters, SeteukRows } from '../../shared/seteuk'
import { queueSeteukAct } from '../lib/seteukBridge'
import { useToast } from '../lib/toast'
import type { PageId } from '../App'

/**
 * 스캔한 표(파일을 표로 옮기기)를 만들어 둔 세특 활동의 관찰 기록으로 보낸다 (3.7.7~).
 * 학번 · 이름으로 학생을 맞추고(관찰 기록 가져오기와 같은 규칙), 맞춘 결과를 먼저 보여 준 뒤 넣는다.
 * 표에 학번 · 번호 · 이름 칸이 있어야 학생을 맞출 수 있다.
 */
export default function SendScanToSeteuk({ tables, onGo, onClose }: { tables: MdTable[]; onGo?: (p: PageId) => void; onClose: () => void }): JSX.Element {
  const toast = useToast()
  const [data, setData] = useState<{ acts: SeteukActivity[]; rosters: SeteukRosters; rows: Record<string, SeteukRows> } | null>(null)
  const [actId, setActId] = useState('')
  const [mode, setMode] = useState<SheetSendMode>('empty')
  const [busy, setBusy] = useState(false)
  // 보낼 곳 — 만들어 둔 활동 · 새 활동으로 만들기 (표의 내용 칸이 활동의 입력 항목이 된다)
  const [target, setTarget] = useState<'exist' | 'new'>('exist')
  const [newName, setNewName] = useState(() => tables.find((t) => t.title?.trim())?.title.trim() || '스캔한 내용')
  const [newRec, setNewRec] = useState('과세특')
  const [newSubject, setNewSubject] = useState('')
  const [newId] = useState(() => `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`)
  const [sent, setSent] = useState<{ actId: string; name: string; n: number } | null>(null)

  const load = async (): Promise<void> => {
    const all = await window.api.seteuk.load()
    setData({ acts: all.acts, rosters: all.rosters, rows: all.rows })
    setActId((cur) => (all.acts.some((a) => a.id === cur) ? cur : (all.acts[0]?.id ?? '')))
  }
  useEffect(() => {
    void load()
  }, [])

  const act = data?.acts.find((a) => a.id === actId) ?? null
  const students = data && act ? data.rosters[modeOfRec(act.rec)] : []
  const sheets = useMemo(() => tables.map((t) => ({ header: t.header, rows: t.rows })), [tables])
  const plan = useMemo(() => (target === 'exist' && data && act ? planSheetSend(sheets, students, act, data.rows[act.id] ?? {}, mode) : null), [target, data, act, sheets, mode, students])
  const newStudents = data ? data.rosters[modeOfRec(newRec)] : []
  const newPlan = useMemo(
    () => (target === 'new' && data ? planNewActFromSheets(sheets, newStudents, { id: newId, name: newName, rec: newRec, subject: newSubject }) : null),
    [target, data, sheets, newStudents, newId, newName, newRec, newSubject]
  )
  const n = target === 'new' ? (newPlan ? Object.keys(newPlan.patch).length : 0) : plan ? Object.keys(plan.patch).length : 0

  const send = async (): Promise<void> => {
    if (target === 'new') {
      if (!data || !newPlan || !n || busy) return
      setBusy(true)
      try {
        // 활동을 먼저 만들어야 그 활동에 글을 넣을 수 있다
        await window.api.seteuk.saveActs([...data.acts, newPlan.act])
        await window.api.seteuk.saveRows(newPlan.act.id, newPlan.patch)
        setSent({ actId: newPlan.act.id, name: newPlan.act.name, n })
        toast(`새 활동 「${newPlan.act.name}」을 만들고 ${n}명을 넣었습니다`, 'ok')
        await load()
      } catch {
        toast('새 활동을 만들지 못했습니다.', 'err')
      }
      setBusy(false)
      return
    }
    if (!act || !plan || !n || busy) return
    setBusy(true)
    try {
      await window.api.seteuk.saveRows(act.id, plan.patch)
      setSent({ actId: act.id, name: act.name, n })
      toast(`「${act.name}」에 ${n}명의 관찰 기록을 넣었습니다`, 'ok')
      await load()
    } catch {
      toast('활동에 넣지 못했습니다.', 'err')
    }
    setBusy(false)
  }

  const go = (id: string): void => {
    queueSeteukAct(id)
    onGo?.('세특')
  }

  return (
    <div className="stk-panel" style={{ marginBottom: 10 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <b>세특 활동으로 보내기</b>
        <span className="small muted">스캔한 표의 글을 학번 · 이름으로 학생을 맞춰 그 활동의 관찰 기록으로 넣습니다. AI 로는 가지 않습니다.</span>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          닫기
        </button>
      </div>
      {!data ? (
        <p className="small muted">활동을 불러오는 중…</p>
      ) : data.acts.length === 0 ? (
        <>
          <p className="small">세특 작성실에서 활동을 먼저 만들어 주세요.</p>
          <button className="btn btn-sm btn-primary" onClick={() => onGo?.('세특')} disabled={!onGo}>
            세특 작성실로
          </button>
        </>
      ) : (
        <>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap', marginBottom: 6 }} role="radiogroup" aria-label="보낼 곳">
            <label className="batch-radio">
              <input type="radio" checked={target === 'exist'} onChange={() => (setTarget('exist'), setSent(null))} /> 만들어 둔 활동에 넣기
            </label>
            <label className="batch-radio">
              <input type="radio" checked={target === 'new'} onChange={() => (setTarget('new'), setSent(null))} /> 새 활동으로 만들기
              <span className="muted small"> — 표의 내용 칸이 활동의 입력 항목(칸별)이 됩니다</span>
            </label>
          </div>
          {target === 'new' ? (
            <>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                <label className="small" htmlFor="scan-new-name">
                  활동 이름
                </label>
                <input id="scan-new-name" type="text" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ minWidth: 180 }} />
                <label className="small" htmlFor="scan-new-rec">
                  기록 영역
                </label>
                <select id="scan-new-rec" value={newRec} onChange={(e) => setNewRec(e.target.value)}>
                  {SETEUK_RECORDS.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name} ({modeInfo(modeOfRec(r.key)).name})
                    </option>
                  ))}
                </select>
                <label className="small" htmlFor="scan-new-subject">
                  과목
                </label>
                <input id="scan-new-subject" type="text" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="(선택)" style={{ width: 110 }} />
              </div>
              {newPlan && (
                <div className="small" style={{ marginTop: 8 }} role="status">
                  {newPlan.act.columns.length ? (
                    <div>
                      입력 항목 {newPlan.act.columns.length}칸: <b>{newPlan.act.columns.join(' · ')}</b>
                    </div>
                  ) : (
                    <div className="muted">내용 칸이 하나뿐이라 관찰 기록 한 칸에 넣습니다.</div>
                  )}
                  {newStudents.length === 0 ? (
                    <div className="note note-warn" style={{ marginTop: 6 }}>
                      {modeInfo(modeOfRec(newRec)).name} 명단이 비어 있어 학생을 맞출 수 없습니다. 세특 작성실에서 명단을 먼저 넣거나 다른 기록 영역을 고르세요.
                    </div>
                  ) : (
                    <>
                      <b>{newPlan.matched}명 맞춤</b> · {newPlan.missed.length}명 못 찾음
                      {newPlan.missed.length > 0 && <div className="muted">못 찾은 줄: {newPlan.missed.join(', ')}</div>}
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
          <>
          <div className="field">
            <label htmlFor="scan-send-act">보낼 활동</label>
            <select id="scan-send-act" value={actId} onChange={(e) => (setActId(e.target.value), setSent(null))}>
              {data.acts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.rec}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            <label className="batch-radio">
              <input type="radio" checked={mode === 'empty'} onChange={() => setMode('empty')} /> 빈 칸에만 넣기
            </label>
            <label className="batch-radio">
              <input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} /> 적힌 글 뒤에 이어 붙이기
            </label>
            <label className="batch-radio">
              <input type="radio" checked={mode === 'overwrite'} onChange={() => setMode('overwrite')} /> 덮어쓰기
            </label>
          </div>
          {act && students.length === 0 ? (
            <p className="note note-warn small" style={{ marginTop: 8 }}>
              「{act.name}」 활동의 {modeInfo(modeOfRec(act.rec)).name} 명단이 비어 있습니다. 세특 작성실에서 명단을 먼저 넣어 주세요.
            </p>
          ) : (
            plan && (
              <div className="small" style={{ marginTop: 8 }} role="status">
                <b>{plan.matched}명 맞춤</b> · {plan.missed.length}명 못 찾음
                {plan.kept > 0 && <span className="muted"> · 이미 적혀 있어 그대로 두는 학생 {plan.kept}명</span>}
                {plan.missed.length > 0 && <div className="muted">못 찾은 줄: {plan.missed.join(', ')}</div>}
                {plan.matched === 0 && <div className="muted">맞춘 학생이 없습니다. 표에 학번(또는 반 · 번호)이나 이름 칸이 있는지, 명단과 같은지 확인하세요.</div>}
              </div>
            )
          )}
          </>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={() => void send()} disabled={!n || busy}>
              {target === 'new' ? (n ? `새 활동 만들고 ${n}명 보내기` : '새 활동 만들기') : n ? `${n}명 보내기` : '보내기'}
            </button>
            {sent && (
              <>
                <span className="small">
                  「{sent.name}」에 {sent.n}명을 넣었습니다.
                </span>
                <button className="btn btn-sm" onClick={() => go(sent.actId)}>
                  그 활동 열기
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
