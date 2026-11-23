import Icon from './Icon'
import { useEffect, useMemo, useState } from 'react'
import type { BatchStudent } from '../../shared/batch'
import { geminiReady } from '../../shared/gemini'
import { BATCH_DEFAULT_ITEMS, batchTable, lengthOk, seteukLength } from '../../shared/batch'
import type { BatchOptions, BatchRow } from '../../shared/batch'
import { planBatchSend, planNewActFromBatch } from '../../shared/batchSend'
import { SETEUK_RECORDS, byteLen, limitOf, modeInfo, modeOfRec } from '../../shared/seteuk'
import type { SeteukActivity, SeteukRosters, SeteukRows } from '../../shared/seteuk'
import { queueSeteukAct } from '../lib/seteukBridge'
import type { PageId } from '../App'
import { fmtBytes } from '../../shared/ocr'
import type { ModelChoice } from '../../shared/types'
import {
  cancelBatch,
  clearFolder,
  markSaved,
  patchResult,
  pickAll,
  resetOptions,
  resultRows,
  runBatch,
  setAgree,
  setBatchMounted,
  setFolder,
  setOptions,
  togglePick,
  useBatch
} from '../lib/batchStore'
import { useToast } from '../lib/toast'
import ModelPicker from './ModelPicker'

const KIND_ICON = { pdf: 'file', image: 'image', doc: 'file' } as const

/** 결과 표에서 미리 보여 줄 글자 수 (긴 칸은 눌러서 펼친다) */
const CLIP = 140

function Cell({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  if (text.length <= CLIP) return <>{text}</>
  return (
    <span className="batch-clip" onClick={() => setOpen(!open)} title={open ? '접기' : '눌러서 다 보기'}>
      {open ? text : `${text.slice(0, CLIP)}…`}
    </span>
  )
}

/** 세특 칸 — 눌러서 고친다. 글자 수가 목표에서 벗어나면 노랗게 */
function SeteukCell({ k, text, target }: { k: string; text: string; target: number }): JSX.Element {
  const [edit, setEdit] = useState(false)
  const [draft, setDraft] = useState(text)
  useEffect(() => setDraft(text), [text])
  const n = seteukLength(edit ? draft : text)
  if (edit) {
    return (
      <div className="batch-seteuk-edit">
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} autoFocus />
        <div className="row" style={{ gap: 6 }}>
          <span className={`small ${lengthOk(n, target) ? 'muted' : 'batch-len-warn'}`}>{n}자</span>
          <span className="spacer" />
          <button className="btn btn-sm btn-ghost" onClick={() => (setDraft(text), setEdit(false))}>
            취소
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => (patchResult(k, { seteuk: draft.trim() }), setEdit(false))}>
            고치기
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="batch-seteuk" onClick={() => setEdit(true)} title="눌러서 고치기">
      {text || <span className="muted">(없음)</span>}
      {text && <span className={`batch-len ${lengthOk(n, target) ? '' : 'batch-len-warn'}`}>{n}자 ✎</span>}
    </div>
  )
}

/**
 * 결과를 세특 작성실의 만들어 둔 활동으로 보낸다 (3.7.5~) — 활동을 고르고, 무엇을 어디로 · 덮어쓸지를 정하면
 * 학번 · 이름으로 학생을 맞춰 미리 보여 주고, [보내기] 로 칸만 합쳐 저장한다(다른 칸은 그대로).
 */
function SendToSeteuk({ rows, o, onGo, onClose }: { rows: BatchRow[]; o: BatchOptions; onGo?: (p: PageId) => void; onClose: () => void }): JSX.Element {
  const toast = useToast()
  const [data, setData] = useState<{ acts: SeteukActivity[]; rosters: SeteukRosters; rows: Record<string, SeteukRows> } | null>(null)
  const [actId, setActId] = useState('')
  const [putNote, setPutNote] = useState(true)
  const [putAi, setPutAi] = useState(true)
  const [overwrite, setOverwrite] = useState(false)
  const [busy, setBusy] = useState(false)
  // 보낼 곳 — 만들어 둔 활동 · 새 활동으로 만들기 (정리한 항목이 활동의 입력 항목이 된다)
  const [target, setTarget] = useState<'exist' | 'new'>('exist')
  const [newName, setNewName] = useState('스캔한 내용')
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

  const items = o.items.map((x) => x.trim()).filter(Boolean)
  const hasSeteuk = rows.some((r) => r.result?.seteuk)
  const act = data?.acts.find((a) => a.id === actId) ?? null
  const students = data && act ? data.rosters[modeOfRec(act.rec)] : []
  const plan = useMemo(
    () => (data && act ? planBatchSend(rows, students, act, data.rows[act.id] ?? {}, items, { note: putNote, ai: putAi && hasSeteuk, overwrite }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, act, rows, putNote, putAi, overwrite, hasSeteuk, o.items]
  )
  const newStudents = data ? data.rosters[modeOfRec(newRec)] : []
  const newPlan = useMemo(
    () => (target === 'new' && data ? planNewActFromBatch(rows, newStudents, items, { id: newId, name: newName, rec: newRec, subject: newSubject }, { note: putNote, ai: putAi && hasSeteuk }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target, data, rows, newStudents, newId, newName, newRec, newSubject, putNote, putAi, hasSeteuk, o.items]
  )
  const n = target === 'new' ? (newPlan ? Object.keys(newPlan.patch).length : 0) : plan ? Object.keys(plan.patch).length : 0
  // 세특 작성실은 바이트로 센다 — 받는 활동의 한도보다 긴 초안이 몇 명인지 (3.7.6~)
  const limit = act ? limitOf(act) : 0
  const tooLong = putAi && hasSeteuk && limit ? rows.filter((r) => r.result?.seteuk && byteLen(r.result.seteuk) > limit).length : 0

  const go = (id: string): void => {
    queueSeteukAct(id)
    onGo?.('세특')
  }

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
      toast(`「${act.name}」에 ${n}명을 넣었습니다`, 'ok')
      await load()
    } catch {
      toast('활동에 넣지 못했습니다.', 'err')
    }
    setBusy(false)
  }

  return (
    <div className="stk-panel" style={{ marginBottom: 10 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <b>세특 활동으로 보내기</b>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          닫기
        </button>
      </div>
      {!data ? (
        <p className="small muted">활동을 불러오는 중…</p>
      ) : (
        <>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap', marginBottom: 6 }} role="radiogroup" aria-label="보낼 곳">
            <label className="batch-radio">
              <input type="radio" checked={target === 'exist'} onChange={() => (setTarget('exist'), setSent(null))} /> 만들어 둔 활동에 넣기
            </label>
            <label className="batch-radio">
              <input type="radio" checked={target === 'new'} onChange={() => (setTarget('new'), setSent(null))} /> 새 활동으로 만들기
              <span className="muted small"> — 정리한 항목이 활동의 입력 항목(칸별)이 됩니다</span>
            </label>
          </div>
          {target === 'new' ? (
            <>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                <label className="small" htmlFor="fb-new-name">
                  활동 이름
                </label>
                <input id="fb-new-name" type="text" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ minWidth: 180 }} />
                <label className="small" htmlFor="fb-new-rec">
                  기록 영역
                </label>
                <select id="fb-new-rec" value={newRec} onChange={(e) => setNewRec(e.target.value)}>
                  {SETEUK_RECORDS.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name} ({modeInfo(modeOfRec(r.key)).name})
                    </option>
                  ))}
                </select>
                <label className="small" htmlFor="fb-new-subject">
                  과목
                </label>
                <input id="fb-new-subject" type="text" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="(선택)" style={{ width: 110 }} />
              </div>
              <div className="row" style={{ gap: 14, flexWrap: 'wrap', marginTop: 6 }}>
                <label className="batch-check">
                  <input type="checkbox" checked={putNote} onChange={(e) => setPutNote(e.target.checked)} /> 정리한 내용 → 관찰 기록
                </label>
                <label className="batch-check" title={hasSeteuk ? '' : '이번 분석에는 세특 초안이 없습니다'}>
                  <input type="checkbox" checked={putAi && hasSeteuk} onChange={(e) => setPutAi(e.target.checked)} disabled={!hasSeteuk} /> 세특 초안 → AI 초안
                </label>
              </div>
              {newPlan && (
                <div className="small" style={{ marginTop: 8 }} role="status">
                  {newPlan.act.columns.length ? (
                    <div>
                      입력 항목 {newPlan.act.columns.length}칸: <b>{newPlan.act.columns.join(' · ')}</b>
                    </div>
                  ) : (
                    <div className="muted">정리한 항목이 하나뿐이라 관찰 기록 한 칸에 넣습니다.</div>
                  )}
                  {newStudents.length === 0 ? (
                    <div className="note note-warn" style={{ marginTop: 6 }}>
                      {modeInfo(modeOfRec(newRec)).name} 명단이 비어 있어 학생을 맞출 수 없습니다. 세특 작성실에서 명단을 먼저 넣거나 다른 기록 영역을 고르세요.
                    </div>
                  ) : (
                    <>
                      <b>{newPlan.matched}명 맞춤</b> · {newPlan.missed.length}명 못 찾음
                      {newPlan.missed.length > 0 && <div className="muted">못 찾은 학생: {newPlan.missed.join(', ')}</div>}
                    </>
                  )}
                </div>
              )}
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={() => void send()} disabled={!n || busy}>
                  {n ? `새 활동 만들고 ${n}명 보내기` : '새 활동 만들기'}
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
          ) : data.acts.length === 0 ? (
        <>
          <p className="small">세특 작성실에서 활동을 먼저 만들어 주세요.</p>
          <button className="btn btn-sm btn-primary" onClick={() => onGo?.('세특')} disabled={!onGo}>
            세특 작성실로
          </button>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="fb-send-act">보낼 활동</label>
            <select id="fb-send-act" value={actId} onChange={(e) => (setActId(e.target.value), setSent(null))}>
              {data.acts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.rec}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            <label className="batch-check">
              <input type="checkbox" checked={putNote} onChange={(e) => setPutNote(e.target.checked)} /> 정리한 내용 → 관찰 기록
            </label>
            <label className="batch-check" title={hasSeteuk ? '' : '이번 분석에는 세특 초안이 없습니다'}>
              <input type="checkbox" checked={putAi && hasSeteuk} onChange={(e) => setPutAi(e.target.checked)} disabled={!hasSeteuk} /> 세특 초안 → AI 초안
            </label>
          </div>
          <div className="row" style={{ gap: 14, marginTop: 6 }}>
            <label className="batch-radio">
              <input type="radio" checked={!overwrite} onChange={() => setOverwrite(false)} /> 빈 칸에만 넣기
            </label>
            <label className="batch-radio">
              <input type="radio" checked={overwrite} onChange={() => setOverwrite(true)} /> 덮어쓰기
            </label>
          </div>
          {tooLong > 0 && (
            <p className="note note-warn small" style={{ marginTop: 8 }}>
              세특 초안 {tooLong}명이 「{act?.name}」의 한도({limit}바이트)보다 깁니다. 보낸 뒤 표에서 줄여 주세요.
            </p>
          )}
          {act && students.length === 0 ? (
            <p className="note note-warn small" style={{ marginTop: 8 }}>
              「{act.name}」 활동의 {modeInfo(modeOfRec(act.rec)).name} 명단이 비어 있습니다. 세특 작성실에서 명단을 먼저 넣어 주세요.
            </p>
          ) : (
            plan && (
              <div className="small" style={{ marginTop: 8 }} role="status">
                <b>{plan.matched}명 맞춤</b> · {plan.missed.length}명 못 찾음
                {plan.kept > 0 && <span className="muted"> · 이미 적혀 있어 그대로 두는 학생 {plan.kept}명</span>}
                {plan.missed.length > 0 && <div className="muted">못 찾은 학생: {plan.missed.join(', ')}</div>}
                {n === 0 && plan.matched === 0 && <div className="muted">보낼 학생이 없습니다(칸을 고르고 분석이 끝난 학생이 있는지 확인하세요).</div>}
              </div>
            )
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={() => void send()} disabled={!n || busy}>
              {n ? `${n}명 보내기` : '보내기'}
            </button>
            {sent && (
              <>
                <span className="small">「{sent.name}」에 {sent.n}명을 넣었습니다.</span>
                <button className="btn btn-sm" onClick={() => go(sent.actId)}>
                  그 활동 열기
                </button>
              </>
            )}
          </div>
        </>
          )}
        </>
      )}
    </div>
  )
}

/**
 * 폴더 일괄 분석 — 학생 결과물 폴더를 통째로 골라, 학생마다 항목별 정리 · 세특 · 채점을 받아 엑셀 · CSV 로 저장한다.
 * 파일 이름의 학번 · 이름으로 학생을 묶는다(사진 여러 장도 한 학생). 실제 일은 electron/main/batch.ts.
 */
export default function FolderBatch({ onSettings, onGo }: { onSettings: () => void; onGo?: (p: PageId) => void }): JSX.Element {
  const toast = useToast()
  const [sendOpen, setSendOpen] = useState(false)
  const b = useBatch()
  const [model, setModel] = useState<ModelChoice | null>(null)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [drag, setDrag] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [itemsText, setItemsText] = useState(b.options.items.join(', '))
  const o = b.options

  useEffect(() => {
    setBatchMounted(true)
    void window.api.local.load().then((s) => setHasKey(!!(geminiReady(s) || s.openai_key?.trim() || s.claude_key?.trim())))
    return () => setBatchMounted(false)
  }, [])

  useEffect(() => {
    if (!b.busy) return
    const tick = (): void => setSeconds(Math.round((Date.now() - b.started) / 1000))
    tick()
    const t = window.setInterval(tick, 1000)
    return () => window.clearInterval(t)
  }, [b.busy, b.started])

  const students: BatchStudent[] = b.folder?.students ?? []
  const pickedList = students.filter((s) => b.picked[s.key])
  const done = students.filter((s) => b.rows[s.key]?.status === 'done').length
  const failed = students.filter((s) => b.rows[s.key]?.status === 'error')
  const queued = students.filter((s) => b.rows[s.key]).length
  const rows = useMemo(() => resultRows(students, b.rows), [students, b.rows])
  const table = useMemo(() => batchTable(rows, o), [rows, o])
  const multi = students.filter((s) => s.files.length > 1).length
  const noName = students.filter((s) => !s.sid).length
  const usage = students.reduce((u, s) => ({ input: u.input + (b.rows[s.key]?.result?.usage?.input ?? 0), output: u.output + (b.rows[s.key]?.result?.usage?.output ?? 0) }), { input: 0, output: 0 })

  const pick = async (): Promise<void> => {
    const f = await window.api.batch.pick()
    if (f) {
      setFolder(f)
      if (!f.ok) toast(f.error ?? '폴더를 읽지 못했습니다.', 'err')
    }
  }

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDrag(0)
    if (b.busy) return
    const p = [...e.dataTransfer.files].map((f) => window.api.files.pathOf(f)).find(Boolean)
    if (!p) return
    const f = await window.api.batch.add(p)
    setFolder(f)
    if (!f.ok) toast(f.error ?? '폴더를 읽지 못했습니다.', 'err')
  }
  const hasFiles = (e: React.DragEvent): boolean => [...e.dataTransfer.types].includes('Files')

  const commitItems = (raw: string): void => {
    const items = [...new Set(raw.split(/[,\n]/).map((x) => x.trim()).filter(Boolean))].slice(0, 20)
    setOptions({ items })
    setItemsText(items.join(', '))
  }

  const save = async (format: 'xlsx' | 'csv'): Promise<void> => {
    const r = await window.api.batch.save(rows, o, b.folder?.folder ?? '', format)
    if (r.ok) markSaved()
    if (r.message !== '취소했습니다.') toast(r.message, r.ok ? 'ok' : 'err')
  }

  const copy = async (): Promise<void> => {
    const tsv = [table.header, ...table.rows].map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n')
    await window.api.clipboard.write(tsv)
    toast('표를 복사했습니다. 엑셀에 그대로 붙여 넣을 수 있습니다.', 'ok')
  }

  const copySeteuk = async (): Promise<void> => {
    const lines = rows.filter((r) => r.result?.seteuk).map((r) => `${r.sid} ${r.name}\t${r.result!.seteuk}`)
    await window.api.clipboard.write(lines.join('\n'))
    toast(`세특 ${lines.length}명분을 복사했습니다.`, 'ok')
  }

  const status = (s: BatchStudent): JSX.Element | null => {
    const r = b.rows[s.key]
    if (!r) return null
    if (r.status === 'reading') return <span className="batch-st reading">읽는 중</span>
    if (r.status === 'done') return <span className="batch-st done">완료</span>
    if (r.status === 'error') return <span className="batch-st err" title={r.error}>실패</span>
    return b.busy ? <span className="batch-st">기다림</span> : null
  }

  const items = o.items
  const cols = table.header

  return (
    <div
      className="batch"
      data-drop=""
      onDragEnter={(e) => hasFiles(e) && setDrag((n) => n + 1)}
      onDragLeave={(e) => hasFiles(e) && setDrag((n) => Math.max(0, n - 1))}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDrop={(e) => void onDrop(e)}
    >
      {hasKey === false && (
        <div className="note note-warn" style={{ marginBottom: 12 }}>
          AI API 키가 없습니다. [설정 → AI 연결] 에서 Gemini · OpenAI · Claude 가운데 하나의 키를 넣어 주세요.{' '}
          <button className="btn btn-sm" onClick={onSettings}>
            설정으로
          </button>
        </div>
      )}

      <div className="ocr-grid">
        <div className="card">
          <div className="card-title">
            <span>1. 학생 결과물 폴더</span>
            {b.folder?.ok && (
              <span className="badge">
                {students.length}명 · 파일 {students.reduce((n, s) => n + s.files.length, 0)}개
              </span>
            )}
          </div>
          <div className="row">
            <button className="btn btn-primary btn-sm" onClick={() => void pick()} disabled={b.busy}>
              폴더 고르기
            </button>
            {b.folder && (
              <>
                <span className="batch-folder" title={b.folder.folder}>
                  {b.folder.folder}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={clearFolder} disabled={b.busy}>
                  비우기
                </button>
              </>
            )}
          </div>
          {!b.folder?.ok ? (
            <div className="ocr-drop-hint">
              학생들이 낸 파일이 모인 <b>폴더</b>를 고르거나 여기에 <b>끌어 놓으세요</b>.
              <br />
              PDF · 한글(hwp · hwpx) · 워드 · 사진 · 엑셀을 읽습니다. 파일 이름의 <b>학번 · 이름</b>으로 학생을 묶어서, 한 학생이 사진을 여러 장 냈어도 한 사람으로
              읽습니다. 예) <code>10107(홍길동)_사진1.jpg</code> · <code>10121 홍길동.pdf</code> · 학생별 하위 폴더
            </div>
          ) : (
            <>
              <div className="batch-summary small muted">
                {multi > 0 && <>파일이 여러 개인 학생 {multi}명은 묶어서 읽습니다. </>}
                {noName > 0 && <>학번을 찾지 못한 {noName}개는 파일 하나를 한 사람으로 봅니다. </>}
                {b.folder.skipped.length > 0 && <>읽지 않는 형식 {b.folder.skipped.length}개는 뺐습니다. </>}
              </div>
              <div className="batch-students">
                <table className="batch-list">
                  <thead>
                    <tr>
                      <th style={{ width: 28 }}>
                        <input
                          type="checkbox"
                          checked={pickedList.length === students.length}
                          onChange={(e) => pickAll(e.target.checked)}
                          disabled={b.busy}
                          aria-label="모두 고르기"
                        />
                      </th>
                      <th>학번</th>
                      <th>이름</th>
                      <th>파일</th>
                      <th style={{ width: 64 }}>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.key} className={b.picked[s.key] ? '' : 'off'}>
                        <td>
                          <input type="checkbox" checked={!!b.picked[s.key]} onChange={() => togglePick(s.key)} disabled={b.busy} aria-label={`${s.sid} ${s.name}`} />
                        </td>
                        <td>{s.sid || '—'}</td>
                        <td>{s.name}</td>
                        <td>
                          {s.files.map((f) => (
                            <span key={f.id} className="batch-file" title={`${f.name} · ${fmtBytes(f.size)}`}>
                              <Icon name={KIND_ICON[f.kind]} size={14} className="att-ico" /> {f.name}
                            </span>
                          ))}
                        </td>
                        <td>{status(s)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <div className="card-title">
            <span>2. 무엇을 정리할까요</span>
            <button className="btn btn-ghost btn-sm" onClick={() => (resetOptions(), setItemsText(BATCH_DEFAULT_ITEMS.join(', ')))} disabled={b.busy}>
              기본값으로
            </button>
          </div>
          <div className="field">
            <label>정리할 항목 (엑셀의 열 · 쉼표로 나눔)</label>
            <textarea value={itemsText} onChange={(e) => setItemsText(e.target.value)} onBlur={(e) => commitItems(e.target.value)} rows={2} disabled={b.busy} />
            <div className="row" style={{ gap: 14, marginTop: 6 }}>
              <label className="batch-radio">
                <input type="radio" checked={o.style === 'summary'} onChange={() => setOptions({ style: 'summary' })} disabled={b.busy} /> 짧게 요약
              </label>
              <label className="batch-radio">
                <input type="radio" checked={o.style === 'verbatim'} onChange={() => setOptions({ style: 'verbatim' })} disabled={b.busy} /> 학생 글 그대로
              </label>
            </div>
          </div>

          <div className="batch-opt">
            <label className="batch-check">
              <input type="checkbox" checked={o.seteuk} onChange={(e) => setOptions({ seteuk: e.target.checked })} disabled={b.busy} />
              <b>세특 쓰기</b>
              <input
                type="number"
                min={50}
                max={1500}
                step={10}
                value={o.seteukLength}
                onChange={(e) => setOptions({ seteukLength: Number(e.target.value) || 200 })}
                disabled={b.busy || !o.seteuk}
                style={{ width: 80 }}
                aria-label="세특 글자 수"
              />
              자 안팎 (공백 포함)
              <span className="small muted batch-bytes" title="한글 한 글자는 3바이트, 공백은 1바이트로 세므로 실제는 이보다 조금 적습니다. 세특 작성실은 바이트로 셉니다.">
                {' '}
                ≈ {o.seteukLength * 3}바이트(나이스 기준)
              </span>
            </label>
            {o.seteuk && (
              <textarea
                value={o.seteukGuide}
                onChange={(e) => setOptions({ seteukGuide: e.target.value })}
                rows={4}
                disabled={b.busy}
                placeholder="세특 지침 — 말투 · 과목 · 꼭 넣을 것"
              />
            )}
          </div>

          <div className="batch-opt">
            <label className="batch-check">
              <input type="checkbox" checked={o.grade} onChange={(e) => setOptions({ grade: e.target.checked })} disabled={b.busy} />
              <b>채점하기</b> <span className="muted small">(점수 · 채점 근거 열이 붙습니다)</span>
            </label>
            {o.grade && (
              <textarea
                value={o.rubric}
                onChange={(e) => setOptions({ rubric: e.target.value })}
                rows={4}
                disabled={b.busy}
                placeholder={'채점 기준. 예)\n- 형식(주제 · 동기 · 내용 · 결론을 모두 갖춤) 4점\n- 공통수학2 개념을 정확히 활용 4점\n- 분량 A4 2쪽 이상 2점 (10점 만점)'}
              />
            )}
          </div>

          <div className="field">
            <label>그 밖에 바라는 것 (선택)</label>
            <input type="text" value={o.note} onChange={(e) => setOptions({ note: e.target.value })} disabled={b.busy} placeholder="예: 수식은 글로 풀어서 / 탐구 유형(심화 · 진로 · 주변)도 적어 주세요" />
          </div>
          {hasKey && <ModelPicker feature="batch" label="쓸 모델" onReady={setModel} onChange={setModel} />}
        </div>
      </div>

      <div className="card ocr-send">
        <div className="note note-danger small" style={{ marginBottom: 10 }}>
          <b>보내는 것:</b> 고른 학생들의 파일 <b>내용</b>(글 · PDF · 사진)을 학생마다 한 번씩 내 API 키로 고른 AI 서비스에 보냅니다. 파일 이름(학생 이름)은 보내지 않지만
          결과물 안에 쓴 이름은 그대로 갑니다. 학교 · 교육청의 생성형 AI 지침을 먼저 확인하세요. 결과는 이 프로그램에 저장하지 않습니다.
        </div>
        <label className="ocr-agree">
          <input type="checkbox" checked={b.agree} onChange={(e) => setAgree(e.target.checked)} disabled={b.busy} />위 내용을 확인했고, 이 결과물들을 AI 로 보내도 됩니다
        </label>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn-primary" onClick={() => void runBatch(model)} disabled={b.busy || !pickedList.length || !b.agree || !hasKey}>
            {b.busy ? '읽는 중…' : `▶ ${pickedList.length}명 분석 시작`}
          </button>
          {b.busy && (
            <>
              <span className="small">
                {done + failed.length}/{queued}명 · {seconds}초
              </span>
              <button className="btn btn-sm btn-ghost" onClick={cancelBatch}>
                멈추기
              </button>
            </>
          )}
          {!b.busy && failed.length > 0 && (
            <button className="btn btn-sm" onClick={() => void runBatch(model, failed.map((s) => s.key))} disabled={!b.agree}>
              실패한 {failed.length}명 다시
            </button>
          )}
        </div>
        {b.busy && queued > 0 && (
          <div className="batch-progress" aria-label="진행">
            <i style={{ width: `${Math.round(((done + failed.length) / queued) * 100)}%` }} />
          </div>
        )}
        {b.busy && <p className="hint">한 학생에 10~40초쯤 걸리고, 3명씩 함께 읽습니다. 다른 화면으로 가도 계속 읽습니다.</p>}
        {b.error && (
          <div className="note note-warn" style={{ marginTop: 10 }}>
            {b.error}
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="card ocr-result">
          <div className="card-title">
            <span>3. 학생별 결과</span>
            <span className="badge">
              {done}명 완료{failed.length ? ` · 실패 ${failed.length}` : ''}
            </span>
            {usage.output > 0 && <span className="muted small">사용량 · 보냄 {usage.input.toLocaleString()} · 받음 {usage.output.toLocaleString()} 토큰</span>}
          </div>
          <div className="row" style={{ marginBottom: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={() => void save('xlsx')} disabled={b.busy}>
              엑셀로 저장
            </button>
            <button className="btn btn-sm" onClick={() => void save('csv')} disabled={b.busy}>
              CSV 로 저장
            </button>
            <button className="btn btn-sm" onClick={() => void copy()}>
              표 복사
            </button>
            {o.seteuk && (
              <button className="btn btn-sm" onClick={() => void copySeteuk()}>
                세특만 복사
              </button>
            )}
            <button className={`btn btn-sm ${sendOpen ? 'btn-primary' : ''}`} onClick={() => setSendOpen((v) => !v)} disabled={b.busy || done === 0} aria-expanded={sendOpen}>
              세특 활동으로 보내기
            </button>
            <span className="muted small">{b.savedAt ? '저장했습니다.' : '결과는 프로그램을 끄면 사라집니다 — 저장해 두세요.'}</span>
          </div>
          {sendOpen && <SendToSeteuk rows={rows} o={o} onGo={onGo} onClose={() => setSendOpen(false)} />}
          <div className="ocr-scroll">
            <table className="ocr-table batch-table">
              <thead>
                <tr>
                  {cols.map((h) => (h === '세특 글자 수' ? null : <th key={h}>{h}</th>))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => {
                  return (
                    <tr key={r.key} className={r.error ? 'batch-row-err' : ''}>
                      {table.rows[ri].map((c, ci) =>
                        cols[ci] === '세특' && r.result ? (
                          <td key={ci} className="batch-seteuk-td">
                            <SeteukCell k={r.key} text={r.result.seteuk} target={o.seteukLength} />
                          </td>
                        ) : cols[ci] === '세특 글자 수' ? null : (
                          <td key={ci} className={/\[(불확실|판독 불가)/.test(c) ? 'ocr-doubt' : ''}>
                            <Cell text={c} />
                          </td>
                        )
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="hint">
            세특 칸을 누르면 고칠 수 있습니다. 글자 수가 노랗게 보이면 목표({o.seteukLength}자)에서 벗어난 것입니다. 항목 · 세특은 AI 초안이니 원본과 맞춰 확인해 주세요.
            {items.length === 0 && ' 정리할 항목이 비어 있습니다.'}
          </p>
        </div>
      )}

      {drag > 0 && !b.busy && (
        <div className="drop-cover">
          <div className="drop-cover-box">여기에 폴더를 놓으면 학생별로 묶어 읽을 준비를 합니다</div>
        </div>
      )}
    </div>
  )
}
