import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ModelChoice } from '../../shared/types'
import { byteLen, checkBadge, groupOf, groupsOf, studentLabel, validateSeteuk } from '../../shared/seteuk'
import type { SeteukActivity, SeteukRows, SeteukStudent } from '../../shared/seteuk'
import { areasOf, checkEquity, mergedOf, partsOf, sumFinal, sumState } from '../../shared/seteukSum'
import type { EquityReport, SeteukSum, SeteukSumPatch, SeteukSums, SumState } from '../../shared/seteukSum'
import type { NeisPreviewReply } from '../../shared/seteukNeis'
import Icon from './Icon'
import ModelPicker from './ModelPicker'
import { useConfirm } from '../lib/confirm'
import { useToast } from '../lib/toast'

/**
 * 세특 작성실 — [취합 · 나이스] 보기.
 * 활동별 글을 기록 영역마다 하나로 모아 보여 주고(합본), 한도를 넘는 학생만 AI 로 줄이고,
 * 학생 사이를 견주어 보고, 나이스에서 내려받은 양식에 최종본을 채운 파일을 만든다.
 * 합본이 한도 안이면 그대로 최종본이다. 선생님이 다듬은 최종본은 압축이 덮지 않는다.
 */

const SAVE_DELAY = 900
const STATE_TEXT: Record<SumState, string> = { none: '', same: '합본 그대로', over: '한도 넘음', ai: '압축본', edit: '다듬음' }
const newId = (): string => 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36)

interface Props {
  students: SeteukStudent[]
  acts: SeteukActivity[]
  rows: Record<string, SeteukRows>
}

export default function SeteukSumView({ students, acts, rows }: Props): JSX.Element {
  const toast = useToast()
  const ask = useConfirm()
  const areas = useMemo(() => areasOf(acts), [acts])
  const [recKey, setRecKey] = useState('')
  const [sums, setSums] = useState<Record<string, SeteukSums> | null>(null)
  const [cls, setCls] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [focus, setFocus] = useState('')
  const [save, setSave] = useState<'saved' | 'dirty' | 'saving'>('saved')
  const [model, setModel] = useState<ModelChoice | null>(null)
  const [job, setJob] = useState('')
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [equity, setEquity] = useState<EquityReport | null>(null)
  const [neis, setNeis] = useState<NeisPreviewReply | null>(null)
  const [neisOpt, setNeisOpt] = useState({ overwrite: false, includeFlagged: false })

  const pending = useRef<{ rec: string; patch: SeteukSumPatch } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const jobRef = useRef({ id: '', rec: '' })

  const area = areas.find((a) => a.rec.key === recKey) ?? areas[0] ?? null
  const rec = area?.rec.key ?? ''
  const cur: SeteukSums = (sums && rec && sums[rec]) || {}

  useEffect(() => {
    void (async () => setSums(await window.api.seteuk.sums()))()
  }, [])

  const flush = useCallback(async (): Promise<void> => {
    window.clearTimeout(timer.current)
    const p = pending.current
    if (!p) return
    pending.current = null
    setSave('saving')
    await window.api.seteuk.saveSum(p.rec, p.patch)
    setSave(pending.current ? 'dirty' : 'saved')
  }, [])
  useEffect(() => () => void flush(), [flush])

  useEffect(() => {
    return window.api.seteuk.onSumProgress((p) => {
      if (p.job !== jobRef.current.id) return
      setProg({ done: p.done, total: p.total })
      const id = p.id
      if (!id) return
      if (p.error) setErrors((e) => ({ ...e, [id]: p.error as string }))
      const got = p.sum
      if (got) {
        const r = jobRef.current.rec
        setSums((prev) => ({ ...(prev ?? {}), [r]: { ...(prev?.[r] ?? {}), [id]: got } }))
      }
    })
  }, [])

  /** 최종본을 고친다 — null 이면 손댄 것을 지우고 합본을 따르게 되돌린다 */
  const setFinal = (sid: string, final: string | null): void => {
    if (!rec) return
    setSums((prev) => {
      const old: SeteukSum = { ...(prev?.[rec]?.[sid] ?? {}) }
      if (final === null) delete old.final
      else old.final = final
      return { ...(prev ?? {}), [rec]: { ...(prev?.[rec] ?? {}), [sid]: old } }
    })
    if (pending.current && pending.current.rec !== rec) void flush()
    const before = pending.current?.rec === rec ? pending.current.patch : {}
    pending.current = { rec, patch: { ...before, [sid]: { ...(before[sid] ?? {}), final } } }
    setSave('dirty')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY)
  }

  const classes = useMemo(() => groupsOf(students).map((g) => g.name), [students])
  const shown = useMemo(() => (cls ? students.filter((s) => groupOf(s) === cls) : students), [students, cls])

  /** 학생마다: 활동별 글 · 합본 · 최종본 · 상태 · 검사 */
  const lines = useMemo(() => {
    if (!area) return []
    return shown.map((s) => {
      const parts = partsOf(area, rows, s.id)
      const merged = mergedOf(parts)
      const sum = cur[s.id]
      const final = sumFinal(sum, merged, area.limit)
      return { s, parts, merged, sum, final, state: sumState(sum, merged, area.limit), check: final.trim() ? validateSeteuk(final, area.limit) : null }
    })
    // cur 는 sums 가 바뀔 때만 바뀐다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area, shown, rows, sums, rec])

  const switchArea = async (key: string): Promise<void> => {
    if (key === rec) return
    await flush()
    setRecKey(key)
    setSel(new Set())
    setFocus('')
    setErrors({})
    setEquity(null)
    setNeis(null)
  }

  /* ---------- 압축 ---------- */

  // 아직 줄여야 하는 학생 — 합본이 한도를 넘는데 한도 안의 최종본이 없다 (이미 줄였거나 다듬은 학생은 빼고)
  const over = lines.filter((l) => l.state === 'over')
  const targets = sel.size ? lines.filter((l) => sel.has(l.s.id) && l.merged) : over

  const compress = async (): Promise<void> => {
    if (!area || !targets.length || job) return
    const edited = targets.filter((l) => l.state === 'edit').length
    const ok = await ask({
      title: `${targets.length}명의 합본을 ${area.limit}바이트 안으로 줄일까요?`,
      body:
        '합본 글만 AI 로 보냅니다(이름은 가립니다). 받은 압축본은 최종본이 비었거나 합본 그대로이거나 한도를 넘을 때만 최종본에 넣습니다.' +
        (edited ? `\n선생님이 다듬은 ${edited}명의 최종본은 바꾸지 않고 압축본만 옆에 둡니다.` : ''),
      okText: '줄이기'
    })
    if (!ok) return
    await flush()
    const id = newId()
    jobRef.current = { id, rec }
    setJob(id)
    setErrors({})
    setProg({ done: 0, total: targets.length })
    const r = await window.api.seteuk.compress({ job: id, rec, ids: targets.map((l) => l.s.id), model: model ?? undefined })
    jobRef.current = { id: '', rec: '' }
    setJob('')
    setProg(null)
    if (!r.ok) return toast(r.error ?? '줄이지 못했습니다.', 'err')
    toast(`${r.written}명의 압축본을 받았습니다${r.failed ? ` · 받지 못한 학생 ${r.failed}명` : ''}${r.canceled ? ' · 멈춤' : ''}. 읽고 다듬어 주세요.`, r.failed ? 'err' : 'ok')
  }

  /* ---------- 학생 간 점검 · 복사 · 나이스 ---------- */

  const runEquity = (): void => {
    setNeis(null)
    setEquity(checkEquity(lines.map((l) => ({ label: `${studentLabel(l.s)} ${l.s.name}`, text: l.final }))))
  }

  const copyFinals = async (): Promise<void> => {
    await window.api.clipboard.write(lines.map((l) => l.final.replace(/\s*\r?\n+\s*/g, ' ')).join('\n'))
    toast(`최종본 ${lines.length}줄을 복사했습니다. 엑셀 · 나이스 표의 첫 칸에 붙여 넣으세요.`, 'ok')
  }

  const pickNeis = async (): Promise<void> => {
    await flush()
    const r = await window.api.seteuk.neisPick(rec, neisOpt)
    if (!r) return
    setEquity(null)
    setNeis(r)
  }
  const reNeis = async (opt: typeof neisOpt): Promise<void> => {
    setNeisOpt(opt)
    if (neis?.id) setNeis(await window.api.seteuk.neisPreview(neis.id, rec, opt))
  }
  const saveNeis = async (): Promise<void> => {
    if (!neis?.id) return
    await flush()
    const r = await window.api.seteuk.neisSave(neis.id, rec, neisOpt)
    if (r.message !== '취소했습니다.') toast(r.message, r.ok ? 'ok' : 'err')
  }
  const copyNeisColumn = async (): Promise<void> => {
    if (!neis?.column) return
    await window.api.clipboard.write(neis.column.join('\n'))
    toast('양식 순서대로 최종본 열을 복사했습니다. 양식의 특기사항 열 첫 학생 칸에 붙여 넣으세요.', 'ok')
  }

  const allOn = shown.length > 0 && shown.every((s) => sel.has(s.id))
  const toggle = (id: string): void =>
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (!sums) return <></>
  if (!area) {
    return (
      <section className="card empty">
        <p>모을 활동이 없습니다. [활동별 작성] 에서 활동을 만들고 학생별 글을 먼저 쓰세요.</p>
      </section>
    )
  }

  const filled = lines.filter((l) => l.final.trim()).length
  const skipped = neis?.plan?.filter((x) => !x.ok) ?? []

  return (
    <section className="card stk-main">
      <div className="stk-acts" role="tablist" aria-label="기록 영역">
        {areas.map((a) => (
          <button key={a.rec.key} role="tab" aria-selected={a.rec.key === rec} className={`tab${a.rec.key === rec ? ' active' : ''}`} onClick={() => void switchArea(a.rec.key)}>
            {a.rec.key} <span className="small muted">활동 {a.acts.length}</span>
          </button>
        ))}
        <span className="spacer" />
        <span className="small muted stk-save" aria-live="polite">
          {save === 'saved' ? '저장됨' : save === 'saving' ? '저장 중…' : '적는 중…'}
        </span>
      </div>
      <p className="small muted stk-count">
        {area.rec.name} · 한도 {area.limit}바이트(한글 약 {area.rec.chars}자) · 모으는 활동: {area.acts.map((a) => a.name).join(', ')}
      </p>

      <div className="stk-tools">
        {classes.length > 1 && (
          <select
            value={cls}
            onChange={(e) => {
              setCls(e.target.value)
              setSel(new Set())
              setEquity(null)
            }}
            aria-label="반 고르기"
          >
            <option value="">모든 반</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <ModelPicker feature="seteuk" label="모델" onReady={setModel} onChange={setModel} />
        <span className="spacer" />
        {job ? (
          <button className="btn btn-sm" onClick={() => void window.api.seteuk.compressCancel(job)}>
            멈추기
          </button>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={() => void compress()} disabled={!targets.length} title="합본을 한도 안으로 줄입니다. 학생을 체크하면 그 학생만, 아니면 한도를 넘는 학생 모두">
            <Icon name="spark" size={14} /> {sel.size ? `고른 ${targets.length}명` : `한도 넘는 ${targets.length}명`} 압축
          </button>
        )}
        <button className="btn btn-sm" onClick={runEquity} title="같은 문장 · 분량 차이 · 빈 학생을 이 화면 안에서 견줍니다(AI 로 보내지 않음)">
          학생 간 점검
        </button>
        <button className="btn btn-sm" onClick={() => void pickNeis()} disabled={!!job} title="나이스에서 내려받은 엑셀 양식에 최종본을 채운 파일을 만듭니다">
          <Icon name="file" size={14} /> 나이스 입력 파일
        </button>
        <button className="btn btn-sm" onClick={() => void copyFinals()} title="보이는 학생 순서대로 최종본을 한 줄씩 복사합니다">
          최종본 열 복사
        </button>
      </div>

      {prog && (
        <div className="stk-prog" role="status">
          <div className="progress">
            <div style={{ width: `${prog.total ? Math.round((prog.done / prog.total) * 100) : 0}%` }} />
          </div>
          <span className="small muted">
            {prog.done} / {prog.total}명
          </span>
        </div>
      )}

      {equity && (
        <div className="stk-panel">
          <div className="stk-import-head">
            <b>학생 간 점검</b>
            <span className="small muted">
              학생 {equity.n}명 가운데 최종본이 있는 학생 {equity.filled}명 · 중앙값 {equity.median}바이트
            </span>
            <span className="spacer" />
            <button className="btn btn-sm btn-ghost" onClick={() => setEquity(null)}>
              닫기
            </button>
          </div>
          {!equity.similar.length && !equity.gaps.length && !equity.empty.length ? (
            <p className="note note-ok small">같은 문장 · 분량 차이 · 빈 칸이 없습니다.</p>
          ) : (
            <>
              {equity.similar.length > 0 && (
                <>
                  <p className="small">
                    <b>같은 문장이 많은 학생 {equity.similar.length}쌍</b> <span className="muted">— 학생마다 그 학생이 한 일로 고쳐 쓰세요</span>
                  </p>
                  <ul className="stk-found-list small">
                    {equity.similar.slice(0, 30).map((p, i) => (
                      <li key={i}>
                        {p.a} ↔ {p.b} <span className="stk-over">{Math.round(p.ratio * 100)}%</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {equity.gaps.length > 0 && (
                <>
                  <p className="small">
                    <b>분량 차이가 큰 학생 {equity.gaps.length}명</b> <span className="muted">— 중앙값의 절반 미만이거나 1.6배 초과</span>
                  </p>
                  <ul className="stk-found-list small">
                    {equity.gaps.map((g, i) => (
                      <li key={i}>
                        {g.label} — {g.bytes}바이트 ({g.kind})
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {equity.empty.length > 0 && (
                <p className="small">
                  <b>최종본이 빈 학생 {equity.empty.length}명</b>: {equity.empty.slice(0, 12).join(', ')}
                  {equity.empty.length > 12 ? ` 외 ${equity.empty.length - 12}명` : ''}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {neis && (
        <div className="stk-panel">
          <div className="stk-import-head">
            <b>나이스 입력 파일</b>
            {neis.file && <span className="small muted">{neis.file}</span>}
            <span className="spacer" />
            <button className="btn btn-sm btn-ghost" onClick={() => setNeis(null)}>
              닫기
            </button>
          </div>
          {!neis.ok || !neis.form ? (
            <p className="note note-danger small">{neis.error ?? '양식을 읽지 못했습니다.'}</p>
          ) : (
            <>
              <p className="small">
                양식: <b>{neis.form.kind || '종류 모름'}</b>
                {neis.form.subject ? ` · ${neis.form.subject}` : ''}
                {neis.form.year ? ` · ${neis.form.year}학년도` : ''}
                {neis.form.term ? ` ${neis.form.term}학기` : ''} · 학생 {neis.form.students}명 · 넣는 칸 [{neis.form.contentHead}]
              </p>
              {neis.form.kind && neis.form.kind !== rec && (
                <p className="note note-warn small">
                  이 양식은 {neis.form.kind} 양식인데 지금 보는 영역은 {rec} 입니다. 맞는 영역 탭에서 다시 고르세요.
                </p>
              )}
              <p className="small">
                <b>채우는 학생 {neis.fill}명</b>
                {skipped.length > 0 && <span className="stk-over"> · 빠지는 학생 {skipped.length}명</span>}
                <span className="muted"> — 반 · 번호 · 성명이 모두 맞는 학생에게만 넣습니다.</span>
              </p>
              {skipped.length > 0 && (
                <ul className="stk-found-list small">
                  {skipped.map((x, i) => (
                    <li key={i}>
                      <b>{x.label}</b> {x.why}
                    </li>
                  ))}
                </ul>
              )}
              <label className="stk-agree small">
                <input type="checkbox" checked={neisOpt.overwrite} onChange={(e) => void reNeis({ ...neisOpt, overwrite: e.target.checked })} />
                양식에 이미 든 글도 바꾸기
              </label>
              <label className="stk-agree small">
                <input type="checkbox" checked={neisOpt.includeFlagged} onChange={(e) => void reNeis({ ...neisOpt, includeFlagged: e.target.checked })} />
                검사에서 고칠 곳이 남은 글도 넣기
              </label>
              <div className="row">
                <button className="btn btn-primary btn-sm" onClick={() => void saveNeis()} disabled={!neis.fill}>
                  채운 파일 저장
                </button>
                <button className="btn btn-sm" onClick={() => void copyNeisColumn()} disabled={!neis.fill}>
                  양식 순서대로 열 복사
                </button>
                <span className="small muted">원래 양식은 그대로 두고 특기사항 칸만 채운 새 파일을 만듭니다.</span>
              </div>
            </>
          )}
        </div>
      )}

      <p className="small muted stk-count">
        최종본 {filled} / {lines.length}명 · 합본이 한도 안이면 그대로 최종본입니다. 아직 줄여야 하는 학생 {over.length}명.
      </p>

      <div className="stk-scroll">
        <table className="stk-table stk-sum">
          <thead>
            <tr>
              <th className="c-chk">
                <input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(shown.map((s) => s.id)))} aria-label="모두 고르기" />
              </th>
              <th className="c-who">학생</th>
              <th>활동별 글 · 합본</th>
              <th>압축본</th>
              <th>최종본</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const id = l.s.id
              const on = focus === id
              const badge = l.check ? checkBadge(l.check) : null
              const mb = byteLen(l.merged)
              const fb = byteLen(l.final)
              const ai = l.sum?.ai ?? ''
              return (
                <tr key={id} className={on ? 'on' : ''} onFocus={() => setFocus(id)}>
                  <td className="c-chk">
                    <input type="checkbox" checked={sel.has(id)} onChange={() => toggle(id)} aria-label={`${studentLabel(l.s)} 고르기`} />
                  </td>
                  <td className="c-who">
                    <b>{l.s.name}</b>
                    <span className="small muted">{studentLabel(l.s)}</span>
                    {l.state !== 'none' && <span className={`stk-badge st-${l.state}`}>{STATE_TEXT[l.state]}</span>}
                    {badge && badge.kind !== 'none' && badge.kind !== 'ok' && <span className={`stk-badge ${badge.kind}`}>{badge.text}</span>}
                  </td>
                  <td>
                    <div className="stk-ai stk-parts" tabIndex={0} aria-label={`${studentLabel(l.s)} 활동별 글`}>
                      {l.merged ? (
                        area.acts.map((a, i) =>
                          l.parts[i] ? (
                            <p key={a.id}>
                              <b>{a.name}</b> {l.parts[i]}
                            </p>
                          ) : null
                        )
                      ) : (
                        <span className="muted">활동별 글이 아직 없습니다</span>
                      )}
                    </div>
                    <div className="stk-under">
                      <span className={`small ${mb > area.limit ? 'stk-over' : 'muted'}`}>
                        합본 {mb} / {area.limit}바이트
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className={`stk-ai${ai ? '' : ' none'}`} tabIndex={0} aria-label={`${studentLabel(l.s)} 압축본`}>
                      {ai || (errors[id] ? '' : mb > area.limit ? '줄여야 합니다' : l.merged ? '필요 없음' : '')}
                    </div>
                    {errors[id] && <p className="small stk-err">{errors[id]}</p>}
                    {ai && (
                      <div className="stk-under">
                        <span className="small muted">{byteLen(ai)}바이트</span>
                        <button className="btn btn-sm btn-ghost" onClick={() => setFinal(id, ai)} disabled={l.final === ai}>
                          최종본으로 →
                        </button>
                      </div>
                    )}
                  </td>
                  <td>
                    <textarea value={l.final} onChange={(e) => setFinal(id, e.target.value)} placeholder={mb > area.limit ? '합본이 한도를 넘습니다 — 압축하거나 직접 줄여 적기' : '활동별 글을 쓰면 여기에 모입니다'} aria-label={`${studentLabel(l.s)} 최종본`} />
                    <div className="stk-under">
                      <span className={`small ${fb > area.limit ? 'stk-over' : 'muted'}`}>
                        {fb} / {area.limit}바이트
                      </span>
                      {typeof l.sum?.final === 'string' && l.state !== 'same' && (
                        <button className="btn btn-sm btn-ghost" onClick={() => setFinal(id, null)} title="다듬은 것을 버리고 합본을 다시 따릅니다">
                          ↺ 합본
                        </button>
                      )}
                    </div>
                    {on && l.check && l.check.issues.length > 0 && (
                      <ul className="stk-issues">
                        {l.check.issues.map((x, i) => (
                          <li key={i} className={x.level}>
                            <b>{x.level === 'block' ? '고침' : '확인'}</b> {x.label}
                            {x.hit && <span className="hit"> — {x.hit}</span>}
                            {x.fix && <span className="fix"> → {x.fix}</span>}
                            {x.why && <span className="why">{x.why}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
