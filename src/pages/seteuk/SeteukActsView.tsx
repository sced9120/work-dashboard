/* 세특 작성실 — 활동 보기(활동 고르기 · 설정 · 학생 표) (Seteuk.tsx 에서 나눔, 3.8.0) */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ModelChoice } from '../../../shared/types'
import { geminiReady } from '../../../shared/gemini'
import SeteukJobBars from '../../components/SeteukJobBars'
import {
  COLUMN_SETS,
  cleanGroup,
  groupOf,
  groupsOf,
  mergeGroup,
  GRADES,
  SETEUK_SUBJECTS,
  joinFields,
  readColumns,
  subjectOf,
  SETEUK_AMOUNTS,
  SETEUK_EXAMPLE_MAX,
  SETEUK_MODES,
  SETEUK_RECORDS,
  buildSeteukPrompt,
  usesCustomPrompt,
  byteLen,
  checkBadge,
  emptyRosters,
  emptyRow,
  defaultConfig,
  defaultOptions,
  SETEUK_PARALLEL,
  emptyStyle,
  groundLeft,
  limitOf,
  minRatioOf,
  mergeNote,
  stampNote,
  modeInfo,
  modeOfRec,
  newActivity,
  parseRoster,
  recordOf,
  setSeteukConfig,
  studentLabel,
  validateSeteuk
} from '../../../shared/seteuk'
import { pairsOf } from '../../../shared/seteukSum'
import { parseTsv, pasteClipped, planPaste } from '../../../shared/tsvpaste'
import type { PasteCell } from '../../../shared/tsvpaste'
import type { SeteukActivity, SeteukAmount, SeteukCheck, SeteukConfig, SeteukImportHit, SeteukMode, SeteukOptions, SeteukRosters, SeteukRow, SeteukRows, SeteukStyle } from '../../../shared/seteuk'
import Icon from '../../components/Icon'
import ModelPicker from '../../components/ModelPicker'
import SeteukImport from '../../components/SeteukImport'
import SeteukFormAct from '../../components/SeteukFormAct'
import SeteukRules from '../../components/SeteukRules'
import SeteukFill from '../../components/SeteukFill'
import SeteukPromptMaker from '../../components/SeteukPromptMaker'
import RelayCard from '../../components/RelayCard'
import SeteukStylePanel from '../../components/SeteukStyle'
import SeteukSumView from '../../components/SeteukSum'
import SeteukXlsx from '../../components/SeteukXlsx'
import { useConfirm } from '../../lib/confirm'
import type { PageId } from '../../App'
import Ocr from '../Ocr'
import { useToast } from '../../lib/toast'
import type { ReactNode } from 'react'
import type { SeteukState } from './core'
import Markdown from '../../components/Markdown'
import StandardPicker, { appendStandards } from '../../components/StandardPicker'
import { SAVE_DELAY, MODE_KEY, INTRO_KEY, newId, stored, remember } from './core'

/**
 * 입력 항목 칸 — 치는 동안은 글자를 그대로 두고(쉼표 · 띄어쓰기가 바로 지워지지 않게),
 * 항목 목록은 그때그때 따로 갱신한다. 칸을 벗어나면 정리된 모양으로 다시 보여준다.
 * 견본 단추 · 활동 바꾸기처럼 바깥에서 목록이 바뀌면 칸 글자도 맞춘다.
 */
function ColumnsInput({ columns, onChange }: { columns: string[]; onChange: (cols: string[]) => void }) {
  const [text, setText] = useState(columns.join(', '))
  const joined = columns.join('\u0000')
  useEffect(() => {
    setText((cur) => (readColumns(cur).join('\u0000') === joined ? cur : columns.join(', ')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined])
  return (
    <input
      type="text"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        onChange(readColumns(e.target.value))
      }}
      onBlur={() => setText(readColumns(text).join(', '))}
      placeholder="예: 탐구 주제, 탐구 과정, 알게 된 점 (쉼표로)"
      aria-label="입력 항목"
    />
  )
}

export default function SeteukActsView({ c, rosterPanel }: { c: SeteukState; rosterPanel: ReactNode }): JSX.Element {
  const { onGo, toast, ask, loaded, setLoaded, rosters, setRosters, acts, setActs, rows, setRows, demo, setDemo, style, setStyle, options, setOptions, config, setConfig, grounding, setGrounding, advising, advice, setAdvice, adviseOne, mode, setMode, actIds, setActIds, cls, setCls, sel, setSel, focus, setFocus, save, setSave, model, setModel, panel, setPanel, rosterText, setRosterText, rosterGroup, setRosterGroup, cfgOpen, setCfgOpen, makerOpen, setMakerOpen, importOpen, setImportOpen, view, setView, finalOnly, setFinalOnly, rev, setRev, intro, setIntro, job, prog, errors, pending, timer, actsTimer, actsRef, info, students, modeActs, act, limit, cur, reload, flush, setCell, changeActs, patchAct, resetView, switchMode, switchView, togglePanel, parsed, applyRoster, removeGroup, removeStudent, clearRoster, classes, shown, prevRosterText, closeIntro, fillDemo, clearDemo, switchAct, addAct, removeAct, addExample, importNotes, targets, ready, write, saveOptions, checkGround, copyRequest, adoptEmpty, copyFinals, actKey, checks, allOn, toggleAll, toggle, filled, rec, rules, equity, setEquity, compareStudents } = c

  /* 키가 있는지 — 없으면 [초안 받기] 등은 잠그고 대신 길을 안내한다 (3.7.6~). null 은 아직 읽는 중 */
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  useEffect(() => {
    void window.api.local.load().then((s) => setHasKey(!!(geminiReady(s) || s.openai_key?.trim() || s.claude_key?.trim() || s.exaone_key?.trim())))
  }, [])
  const noKey = hasKey === false
  /** '설문지로 만들기' 를 연 갈래 (다른 갈래로 옮기면 닫힌 것처럼 보인다) */
  const [formMaker, setFormMaker] = useState('')
  const [stdPick, setStdPick] = useState(false)
  const openDlg = (): void => (setMakerOpen(true), setCfgOpen(false))
  const closeDlg = (): void => (setMakerOpen(false), setCfgOpen(false))
  const NO_KEY_TIP = 'AI 키가 없어 쓸 수 없습니다. [설정]에서 키를 넣으면 쓸 수 있습니다.'

  /* ---------- 엑셀에서 복사해 붙여 넣기 — 줄은 아래 학생으로, 탭은 오른쪽 칸으로 ---------- */
  const rowIds = shown.map((s) => s.id)
  /** 보이는 칸 순서 — 관찰 기록(또는 입력 항목 칸들) → AI 초안 → 최종본. 최종본만 보기면 최종본 하나 */
  const colKeys = finalOnly ? ['final'] : [...(act && act.columns.length >= 2 ? act.columns.map((c) => `f:${c}`) : ['note']), 'ai', 'final']
  const cellVal = (id: string, key: string): string => {
    const r = cur[id]
    if (!r) return ''
    if (key.startsWith('f:')) return r.fields?.[key.slice(2)] ?? ''
    return key === 'note' ? r.note : key === 'ai' ? r.ai : r.final
  }
  const applyCells = (cells: PasteCell[]): void => {
    if (!act) return
    const byRow = new Map<string, PasteCell[]>()
    for (const x of cells) byRow.set(x.rowId, [...(byRow.get(x.rowId) ?? []), x])
    for (const [id, list] of byRow) {
      const patch: Partial<SeteukRow> = {}
      const fields = { ...(cur[id]?.fields ?? {}) }
      let fieldsChanged = false
      for (const x of list) {
        if (x.colKey.startsWith('f:')) {
          fields[x.colKey.slice(2)] = x.value
          fieldsChanged = true
        } else if (x.colKey === 'note' || x.colKey === 'ai' || x.colKey === 'final') patch[x.colKey] = x.value
      }
      if (fieldsChanged) {
        patch.fields = fields
        patch.note = joinFields(act.columns, fields)
      }
      setCell(id, patch)
    }
  }
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>, rowId: string, colKey: string): void => {
    const text = e.clipboardData.getData('text/plain')
    // 한 줄 · 탭 없는 글은 보통 붙여 넣기
    if (!act || (!text.includes('\t') && !/[\r\n]/.test(text))) return
    const grid = parseTsv(text)
    if (!grid.length) return
    if (grid.length === 1 && grid[0].length === 1) {
      // 한 칸짜리(따옴표로 싼 칸 · 끝 줄바꿈) — 따옴표 · 끝 줄바꿈만 걷어 커서 자리에 넣는다
      const t = grid[0][0]
      if (t === text) return
      e.preventDefault()
      const old = cellVal(rowId, colKey)
      const a = e.currentTarget.selectionStart
      const b = e.currentTarget.selectionEnd
      applyCells([{ rowId, colKey, value: old.slice(0, a) + t + old.slice(b) }])
      return
    }
    const r0 = rowIds.indexOf(rowId)
    const c0 = colKeys.indexOf(colKey)
    if (r0 < 0 || c0 < 0) return
    e.preventDefault()
    const plan = planPaste(grid, r0, c0, rowIds, colKeys)
    const clip = pasteClipped(grid, r0, c0, rowIds.length, colKeys.length)
    void (async () => {
      const had = plan.filter((x) => cellVal(x.rowId, x.colKey).trim()).length
      if (plan.length > 1 && had > 0) {
        const ok = await ask({ title: `${plan.length}칸에 붙여 넣습니다. 이미 글이 있는 ${had}칸은 바뀝니다.`, okText: '붙여 넣기' })
        if (!ok) return
      }
      applyCells(plan)
      const tail = (clip.rows ? ` 학생 수보다 많은 ${clip.rows}줄은 넣지 않았습니다.` : '') + (clip.cells ? ` 칸이 모자라 ${clip.cells}칸은 넣지 않았습니다.` : '')
      toast(`${plan.length}칸에 붙여 넣었습니다.${tail}`, 'ok')
    })()
  }

  return (
    <>
        {view === 'acts' && (
          <>
            <section className="card stk-top">
              <div className="stk-acts" role="tablist" aria-label="활동">
                {modeActs.map((a) => (
                  <button key={a.id} role="tab" aria-selected={a.id === act?.id} className={`tab${a.id === act?.id ? ' active' : ''}`} onClick={() => void switchAct(a.id)}>
                    {a.name}
                  </button>
                ))}
                <button className="btn btn-sm" onClick={() => void addAct()} disabled={!!job}>
                  <Icon name="plus" size={14} /> 활동
                </button>
                <button className="btn btn-sm" onClick={() => setFormMaker((v) => (v === mode ? '' : mode))} disabled={!!job} aria-expanded={formMaker === mode} title="구글 설문지 응답 시트로 새 활동을 만들고 학생별 답을 넣습니다">
                  <Icon name="plus" size={14} /> 설문지로 만들기
                </button>
                {act && rec && (
                  <button className="btn btn-sm stk-cfgbtn" onClick={openDlg} title="이 활동의 프롬프트 만들기 · 활동 규정(이름 · 기록 영역 · 분량 · 개요)을 창으로 엽니다">
                    <Icon name="sliders" size={14} /> 활동 설정
                  </button>
                )}
                {act && rec && (
                  <button className="btn btn-sm stk-delbtn" onClick={() => void removeAct()} disabled={!!job} title={`「${act.name}」 활동을 지웁니다. 확인 창이 한 번 뜹니다`}>
                    <Icon name="trash" size={14} /> 활동 지우기
                  </button>
                )}
              </div>

              {act && rec && (
                <div className="stk-actbar">
                  <span className="small">
                    <b>{rec.key}</b> · 한도 {limit}바이트(한글 약 {Math.floor(limit / 3)}자) · 분량 {act.fill}%{act.amount === '메모만큼' ? ' · 짧은 메모는 짧게' : ''}{act.structure.trim() ? ' · 구성 있음' : ''}{usesCustomPrompt(act) ? ' · 직접 쓴 프롬프트' : ''}
                    {act.subject ? ` · ${act.subject}` : ''}
                  </span>
                  <span className="spacer" />
                </div>
              )}

              {formMaker === mode && <SeteukFormAct key={mode} mode={mode} students={students} base={act} onCreate={c.addFormAct} onClose={() => setFormMaker('')} />}

              {act && rec && (makerOpen || cfgOpen) && (
                <div className="stk-modal-back" onMouseDown={(e) => e.target === e.currentTarget && closeDlg()}>
                  <div className="stk-modal" role="dialog" aria-modal="true" aria-label="활동 설정">
                    <div className="stk-modal-head">
                      <b>활동 설정 — 「{act.name}」</b>
                      <div className="stk-modal-tabs" role="tablist" aria-label="활동 설정 탭">
                        <button role="tab" aria-selected={makerOpen} className={makerOpen ? 'on' : ''} onClick={() => (setMakerOpen(true), setCfgOpen(false))}>
                          프롬프트 만들기
                        </button>
                        <button role="tab" aria-selected={cfgOpen} className={cfgOpen ? 'on' : ''} onClick={() => (setCfgOpen(true), setMakerOpen(false))}>
                          활동 규정
                        </button>
                      </div>
                      <span className="spacer" />
                      <button className="btn btn-sm" onClick={closeDlg}>
                        닫기
                      </button>
                    </div>
                    <div className="stk-modal-body">
                      {makerOpen && <SeteukPromptMaker act={act} style={style} config={config} onPatch={patchAct} onClose={closeDlg} />}
                      {cfgOpen && (
                <div className="stk-panel stk-cfg">
                  <label>
                    <span>활동 이름</span>
                    <input type="text" value={act.name} onChange={(e) => patchAct({ name: e.target.value })} />
                  </label>
                  <label className="stk-namein stk-wide">
                    <input type="checkbox" checked={act.nameInText !== false} onChange={(e) => patchAct({ nameInText: e.target.checked })} />
                    <span>글에 활동 이름 넣기 — 예: 「{act.name.trim() || '통계 포스터 발표'} 활동에서 …」 (끄면 이름 없이 씁니다. 받은 뒤에 지워도 됩니다)</span>
                  </label>
                  <label>
                    <span>기록 영역</span>
                    <select value={act.rec} onChange={(e) => patchAct({ rec: e.target.value, bytes: 0 })} disabled={info.recs.length < 2}>
                      {SETEUK_RECORDS.filter((r) => info.recs.includes(r.key)).map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.key} — {r.name} ({r.chars * 3}바이트)
                        </option>
                      ))}
                    </select>
                  </label>
                  {act.rec === '과세특' && (
                    <label>
                      <span>과목</span>
                      <input type="text" value={act.subject} onChange={(e) => patchAct({ subject: e.target.value })} placeholder="예: 공통수학2" />
                    </label>
                  )}
                  <label>
                    <span>교과 역량 문구</span>
                    <select value={act.area} onChange={(e) => patchAct({ area: e.target.value })}>
                      <option value="">넣지 않음</option>
                      {SETEUK_SUBJECTS.map((x) => (
                        <option key={x.key} value={x.key}>
                          {x.kind === '공통' ? '공통 핵심역량 (창체 · 행발)' : `${x.name} 교과 역량`}
                        </option>
                      ))}
                    </select>
                  </label>
                  {act.area && subjectOf(act.area)?.comp && <p className="small muted stk-wide stk-comp">{subjectOf(act.area)?.comp}</p>}
                  <div className="stk-wide stk-cols">
                    <span className="stk-style-label">
                      입력 항목 <span className="muted">둘 이상이면 관찰 기록을 항목별 칸으로 나눠 적습니다. 비우면 한 칸</span>
                    </span>
                    <div className="stk-templates">
                      {COLUMN_SETS.map((c) => (
                        <button key={c.name} type="button" className="btn btn-sm" onClick={() => patchAct({ columns: c.cols })}>
                          {c.name}
                        </button>
                      ))}
                      {act.columns.length > 0 && (
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => patchAct({ columns: [] })}>
                          한 칸으로
                        </button>
                      )}
                    </div>
                    <ColumnsInput columns={act.columns} onChange={(cols) => patchAct({ columns: cols })} />
                  </div>
                  <label>
                    <span>이 활동의 분량(바이트)</span>
                    <input
                      type="number"
                      min={0}
                      max={rec.chars * 3}
                      step={30}
                      value={act.bytes || ''}
                      onChange={(e) => patchAct({ bytes: Math.max(0, Math.min(rec.chars * 3, Math.floor(Number(e.target.value) || 0))) })}
                      placeholder={`비우면 ${rec.chars * 3}`}
                    />
                  </label>
                  <div className="stk-wide">
                    <SeteukFill fill={act.fill} limit={limit} short={act.amount === '메모만큼'} onFill={(v) => patchAct({ fill: v })} onShort={(v) => patchAct({ amount: v ? '메모만큼' : '보통' })} />
                  </div>
                  <label className="stk-wide">
                    <span>활동 개요 — 무엇을 한 수업 · 활동인지</span>
                    <textarea value={act.desc} onChange={(e) => patchAct({ desc: e.target.value })} placeholder="예: 실생활 자료로 함수의 그래프를 그리고 변화율을 설명하는 모둠 탐구 3차시" />
                  </label>
                  <div className="stk-wide stk-std">
                    <span className="stk-std-label">
                      관련 성취기준 (선택) <span className="muted">초안이 성취수준을 가늠하는 기준으로만 씁니다. 성취기준 문장 · 코드는 글에 옮겨 적지 않습니다.</span>
                    </span>
                    <div className="stk-std-row">
                      <textarea
                        value={act.standards ?? ''}
                        onChange={(e) => patchAct({ standards: e.target.value })}
                        placeholder="한 줄에 하나 — [성취기준 찾기]로 고르거나 직접 적습니다"
                        aria-label="관련 성취기준"
                      />
                      <button type="button" className="btn btn-sm" onClick={() => setStdPick(true)}>
                        성취기준 찾기
                      </button>
                    </div>
                  </div>
                  <p className="small muted stk-wide">{rec.note} 한 영역에 활동이 여럿이면 활동마다 분량을 나눠 적어 두세요.</p>
                  <div className="stk-wide stk-examples">
                    <span className="stk-style-label">
                      예시 {act.examples.length}개{' '}
                      <span className="muted">
                        잘 쓴 최종본을 예시로 두면 초안이 그 표현 방식을 따릅니다. 표에서 학생 줄을 누르고 [예시로 등록]. 초안에는 앞의 {SETEUK_EXAMPLE_MAX}개가
                        쓰입니다.
                      </span>
                    </span>
                    {act.examples.map((e, i) => (
                      <div key={i} className="stk-example">
                        <p className="small">
                          <b>{i + 1}</b> {e.result}
                        </p>
                        <button className="btn btn-sm btn-ghost" onClick={() => patchAct({ examples: act.examples.filter((_x, k) => k !== i) })} aria-label={`예시 ${i + 1} 빼기`}>
                          빼기
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>

            {!act ? (
              <section className="card empty">
                <p>{info.name} 활동이 없습니다. [＋ 활동] 이나 [＋ 설문지로 만들기] 로 하나 만들면 학생별 표가 열립니다.</p>
              </section>
            ) : !students.length ? (
              <section className="card stk-first">
                <div className="card-title">{info.name} 명단을 넣으면 바로 씁니다</div>
                <p className="small muted">
                  「{act.name}」 활동은 만들어 두었습니다. {info.who} 명단만 붙여 넣으세요.
                </p>
                {rosterPanel}
                {demo.canFill && !c.demoOff && (
                  <p className="small muted stk-first-demo">
                    어떻게 생겼는지 먼저 보려면{' '}
                    <button className="link" onClick={() => void fillDemo()}>
                      체험 자료로 먼저 보기
                    </button>
                  </p>
                )}
              </section>
            ) : (
              <section className="card stk-main">
                {classes.length > 1 && (
                  <div className="stk-group-tabs" role="tablist" aria-label="반별로 보기">
                    {[{ name: '', count: students.length }, ...classes].map((c) => (
                      <button
                        key={c.name || '_all'}
                        role="tab"
                        aria-selected={cls === c.name}
                        className={cls === c.name ? 'on' : ''}
                        onClick={() => {
                          setCls(c.name)
                          setSel(new Set())
                        }}
                      >
                        {c.name || '모든 반'} <span className="muted">{c.count}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="stk-tools">
                  <ModelPicker feature="seteuk" label="모델" onReady={setModel} onChange={setModel} />
                  <label className="stk-opt small" title="검사에서 분량 초과 · 기재 금지 · 어미 같은 '고칠 곳'이 나온 학생만 걸린 점을 짚어 한 번 더 받습니다. 나아진 경우에만 바꿉니다.">
                    <input type="checkbox" checked={options.autoRepair && !noKey} onChange={(e) => saveOptions({ autoRepair: e.target.checked })} disabled={!!job || noKey} />
                    자동 고쳐쓰기
                  </label>
                  <label className="stk-opt small" title="초안을 받은 뒤 관찰 기록에 없는 활동 · 수치 · 과장된 평가가 있는지 한 번 더 묻습니다. 학생마다 AI 를 한 번 더 부릅니다.">
                    <input type="checkbox" checked={options.ground && !noKey} onChange={(e) => saveOptions({ ground: e.target.checked })} disabled={!!job || noKey} />
                    근거 확인
                  </label>
                  <label
                    className="stk-opt small"
                    title="몇 명의 초안을 동시에 받을지 정합니다. '할당량 초과' 오류가 자주 나면 1명씩으로 바꾸세요(느려지지만 한도에 덜 걸립니다). 자동은 Gemini 2명 · 그 밖 3명입니다."
                  >
                    동시 요청
                    <select value={options.parallel} onChange={(e) => saveOptions({ parallel: Number(e.target.value) })} disabled={!!job || noKey} aria-label="동시 요청 수">
                      {SETEUK_PARALLEL.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="spacer" />
                  <button className="btn btn-sm" onClick={() => setImportOpen((v) => !v)} disabled={!!job} aria-expanded={importOpen} title="스캔한 활동지 · 사진이나 엑셀 표에서 학생별 관찰 기록을 가져옵니다">
                    <Icon name="scan" size={14} /> 관찰 기록 가져오기
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => void write()} disabled={!ready.length || noKey} title={noKey ? NO_KEY_TIP : undefined}>
                    <Icon name="spark" size={14} /> {sel.size ? `고른 ${ready.length}명` : `${ready.length}명`} 초안 받기
                  </button>
                  <button className={`btn btn-sm ${finalOnly ? 'btn-primary' : ''}`} onClick={() => setFinalOnly((v) => !v)} aria-pressed={finalOnly} title="표에서 학생과 최종본만 넓게 봅니다">
                    {finalOnly ? '모두 보기' : '최종본만 보기'}
                  </button>
                  <button className="btn btn-sm" onClick={adoptEmpty} disabled={!!job} title="최종본이 빈 학생만 AI 초안을 최종본에 넣습니다">
                    빈 최종본에 초안 넣기
                  </button>
                  <button className="btn btn-sm" onClick={() => void copyFinals()} title="보이는 학생 순서대로 최종본을 한 줄씩 복사합니다">
                    최종본 열 복사
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={compareStudents}
                    disabled={!shown.length}
                    title="이 활동에서 학생들의 최종본(없으면 초안)을 서로 견줘 같은 문장이 많은 학생, 분량이 크게 다른 학생, 빈 학생을 찾습니다. 어디로도 보내지 않습니다."
                  >
                    학생끼리 견주기
                  </button>
                </div>
                {noKey && (
                  <p className="small stk-nokey" role="note">
                    키가 없으면 학생 줄을 눌러 [키 없이 — 요청 글 복사]로 AI 앱에서 받으세요 ·{' '}
                    <button className="link" onClick={() => onGo('설정')}>
                      설정에서 키 넣기
                    </button>
                  </p>
                )}
                {/* 줄을 누를 때 이 줄을 없애면 표가 올라가 첫 누름이 빗나간다 — 자리는 두고 감추기만 한다 */}
                <p className="small muted stk-copyhint" style={shown.some((s) => s.id === focus) ? { visibility: 'hidden' } : undefined}>
                  학생 줄을 누르면 요청 글을 복사할 수 있습니다
                </p>
                {equity && (
                  <div className="stk-panel">
                    <div className="stk-import-head">
                      <b>학생끼리 견주기</b>
                      <span className="small muted">
                        학생 {equity.n}명 가운데 글이 있는 학생 {equity.filled}명 · 중앙값 {equity.median}바이트
                      </span>
                      <span className="spacer" />
                      <button className="btn btn-sm btn-ghost" onClick={() => setEquity(null)}>
                        닫기
                      </button>
                    </div>
                    {!equity.similar.length && !equity.gaps.length && !equity.empty.length ? (
                      <p className="note note-ok small">모두 괜찮습니다. 같은 문장 · 분량 차이 · 빈 칸이 없습니다.</p>
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
                            <b>글이 빈 학생 {equity.empty.length}명</b>: {equity.empty.slice(0, 12).join(', ')}
                            {equity.empty.length > 12 ? ` 외 ${equity.empty.length - 12}명` : ''}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
                {importOpen && <SeteukImport key={act?.id} students={shown} actId={act?.id ?? ''} columns={act?.columns} onApply={importNotes} onClose={() => setImportOpen(false)} />}
                <SeteukJobBars kind="write" />
                <p className="small muted stk-count">
                  최종본 {filled} / {shown.length}명
                </p>

                <div className="stk-scroll">
                  <table className={`stk-table ${finalOnly ? 'final-only' : ''}`}>
                    <thead>
                      <tr>
                        <th className="c-chk">
                          <input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="모두 고르기" />
                        </th>
                        <th className="c-who">학생</th>
                        {!finalOnly && <th>관찰 기록</th>}
                        {!finalOnly && <th>AI 초안</th>}
                        <th>최종본</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((s) => {
                        const r = cur[s.id] ?? emptyRow()
                        const c = checks[s.id]
                        const badge = c ? checkBadge(c) : null
                        const fb = byteLen(r.final)
                        const on = focus === s.id
                        const shownText = r.final.trim() ? r.final : r.ai
                        const left = groundLeft(r.ground, shownText)
                        const same = pairsOf(equity, `${studentLabel(s)} ${s.name}`)
                        return (
                          <tr
                            key={s.id}
                            className={on ? 'on' : ''}
                            // 글 칸에 들어갈 때만 줄을 펼친다 — 체크 · 단추를 누를 때 펼치면 표가 밀려 그 누름이 먹히지 않는다
                            onFocus={(e) => (e.target as HTMLElement).tagName === 'TEXTAREA' && setFocus(s.id)}
                          >
                            <td className="c-chk">
                              <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggle(s.id)} aria-label={`${studentLabel(s)} 고르기`} />
                            </td>
                            <td className="c-who">
                              <b>{s.name}</b>
                              <span className="small muted">{studentLabel(s)}</span>
                              {rec?.useGrade && (
                                <select className="stk-grade" value={r.grade ?? ''} onChange={(e) => setCell(s.id, { grade: e.target.value })} aria-label={`${studentLabel(s)} 성취수준`} title="성취수준 — 글에는 쓰지 않고 서술의 깊이만 맞춥니다">
                                  <option value="">성취수준</option>
                                  {GRADES.map((g) => (
                                    <option key={g} value={g}>
                                      {g}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {badge && badge.kind !== 'none' && <span className={`stk-badge ${badge.kind}`}>{badge.text}</span>}
                              {left.length > 0 && <span className="stk-badge check">근거 확인 {left.length}</span>}
                              {same.length > 0 && (
                                <span className="stk-badge stk-badge-same" title={`같은 문장이 많은 학생: ${same.map((p) => `${p.other} ${Math.round(p.ratio * 100)}%`).join(', ')}`}>
                                  같은 문장
                                </span>
                              )}
                            </td>
                            {!finalOnly && (
                              <>
                            <td>
                              {act.columns.length >= 2 ? (
                                <div className="stk-fields">
                                  {act.columns.map((c) => (
                                    <label key={c}>
                                      <span>{c}</span>
                                      <textarea
                                        value={r.fields?.[c] ?? ''}
                                        onChange={(e) => {
                                          const fields = { ...(r.fields ?? {}), [c]: e.target.value }
                                          setCell(s.id, { fields, note: joinFields(act.columns, fields) })
                                        }}
                                        aria-label={`${studentLabel(s)} ${c}`}
                                        onPaste={(e) => onPaste(e, s.id, `f:${c}`)}
                                      />
                                    </label>
                                  ))}
                                </div>
                              ) : (
                                <textarea id={`stk-note-${s.id}`} value={r.note} onChange={(e) => setCell(s.id, { note: e.target.value })} placeholder="수업 · 활동에서 본 것을 적습니다" onPaste={(e) => onPaste(e, s.id, 'note')} aria-label={`${studentLabel(s)} 관찰 기록`} />
                              )}
                              {on && (
                                <div className="stk-under">
                                  {act.columns.length < 2 ? (
                                    <button
                                      className="btn btn-sm btn-ghost"
                                      onClick={() => {
                                        const next = stampNote(r.note, new Date())
                                        setCell(s.id, { note: next })
                                        window.setTimeout(() => {
                                          const el = document.getElementById(`stk-note-${s.id}`) as HTMLTextAreaElement | null
                                          if (!el) return
                                          el.focus()
                                          el.setSelectionRange(next.length, next.length)
                                        }, 0)
                                      }}
                                      title="오늘 날짜를 붙여 새 관찰을 적습니다. 날짜가 있으면 AI 가 변화와 성장을 시간 순서로 읽습니다."
                                    >
                                      + 오늘
                                    </button>
                                  ) : (
                                    <span />
                                  )}
                                  {r.note.trim() && (
                                  <button
                                    className="btn btn-sm btn-ghost"
                                    onClick={() => void copyRequest(s.id)}
                                    title="AI 키가 없을 때 — 규칙과 이름을 가린 관찰 기록을 복사합니다. Gemini · ChatGPT · Claude 앱에 붙여 넣으세요."
                                  >
                                    키 없이 — 요청 글 복사
                                  </button>
                                  )}
                                </div>
                              )}
                            </td>
                            <td>
                              <textarea className="stk-ai" value={r.ai} onChange={(e) => setCell(s.id, { ai: e.target.value })} placeholder="초안이 여기에 옵니다" onPaste={(e) => onPaste(e, s.id, 'ai')} aria-label={`${studentLabel(s)} AI 초안`} />
                              {errors[s.id] && <p className="small stk-err">{errors[s.id]}</p>}
                              {r.ai.trim() && (
                                <div className="stk-under">
                                  <span className="small muted">
                                    {byteLen(r.ai)}바이트{r.repaired ? ' · 걸린 곳을 한 번 고쳐 받음' : ''}
                                  </span>
                                  <button className="btn btn-sm btn-ghost" onClick={() => setCell(s.id, { final: r.ai })} disabled={r.final === r.ai}>
                                    최종본으로 →
                                  </button>
                                </div>
                              )}
                            </td>
                              </>
                            )}
                            <td>
                              <textarea value={r.final} onChange={(e) => setCell(s.id, { final: e.target.value })} placeholder="초안을 옮겨 다듬거나 바로 적습니다" onPaste={(e) => onPaste(e, s.id, 'final')} aria-label={`${studentLabel(s)} 최종본`} />
                              <div className="stk-under">
                                <span className={`small ${fb > limit ? 'stk-over' : 'muted'}`}>
                                  {fb} / {limit}바이트
                                </span>
                                {on && r.note.trim() && shownText.trim() && (
                                  <button
                                    className="btn btn-sm btn-ghost"
                                    onClick={() => void checkGround(s.id)}
                                    disabled={!!grounding || !!job || noKey}
                                    title={noKey ? NO_KEY_TIP : "최종본(없으면 초안)에 관찰 기록에 없는 내용이 있는지 AI 에게 묻습니다. 이름은 가려 보냅니다."}
                                  >
                                    {grounding === s.id ? <><span className="stk-spin" aria-hidden="true" /> 확인 중…</> : '근거 확인'}
                                  </button>
                                )}
                                {on && shownText.trim() && (
                                  <button
                                    className="btn btn-sm btn-ghost"
                                    onClick={() => void adviseOne(s.id)}
                                    disabled={!!advising || !!job || noKey}
                                    title={noKey ? NO_KEY_TIP : "이 글을 동료 교사의 눈으로 읽은 의견을 받습니다 — 흐름, 더 구체적으로 쓸 곳, 확인할 질문. 글을 대신 고쳐 주지는 않습니다. 이름은 가려 보냅니다."}
                                  >
                                    {advising === s.id ? <><span className="stk-spin" aria-hidden="true" /> 읽는 중…</> : '이 글 조언'}
                                  </button>
                                )}
                                {on && r.final.trim() && (
                                  <button className="btn btn-sm btn-ghost" onClick={() => addExample(s.id)} title="이 글을 이 활동의 예시로 둡니다. 다음 초안부터 이 표현 방식과 흐름을 따릅니다.">
                                    예시로 등록
                                  </button>
                                )}
                              </div>
                              {left.length > 0 && (
                                <ul className="stk-issues stk-ground">
                                  {left.map((g, i) => (
                                    <li key={i} className="check">
                                      <b>살펴볼 곳</b> 관찰 기록에 없는 내용<span className="hit"> — {g.quote}</span>
                                      {g.why && <span className="why">{g.why}</span>}
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {on && act && advice[`${act.id}:${s.id}`] && (
                                <div className="stk-advice">
                                  <div className="stk-advice-head">
                                    <b>이 글 조언</b>
                                    <span className="small muted">동료 교사의 눈으로 읽은 의견입니다. 관찰한 사실이 있을 때만 고쳐 쓰세요.</span>
                                    <span className="spacer" />
                                    <button className="btn btn-sm btn-ghost" onClick={() => void window.api.clipboard.write(advice[`${act.id}:${s.id}`])}>
                                      복사
                                    </button>
                                    <button
                                      className="btn btn-sm btn-ghost"
                                      onClick={() =>
                                        setAdvice((prev) => {
                                          const n = { ...prev }
                                          delete n[`${act.id}:${s.id}`]
                                          return n
                                        })
                                      }
                                    >
                                      닫기
                                    </button>
                                  </div>
                                  <Markdown text={advice[`${act.id}:${s.id}`]} />
                                </div>
                              )}
                              {on && r.ground && r.ground.length === 0 && <p className="small muted stk-ground-ok">근거 확인 — 관찰 기록에 없는 내용을 찾지 못했습니다.</p>}
                              {on && c && c.issues.length > 0 && (
                                <ul className="stk-issues">
                                  {c.issues.map((x, i) => (
                                    <li key={i} className={x.level}>
                                      <b>{x.level === 'block' ? '고칠 곳' : '살펴볼 곳'}</b> {x.label}
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
            )}
          </>
        )}
      {stdPick && act && (
        <StandardPicker
          title={`성취기준 찾기 — ${act.name}`}
          onClose={() => setStdPick(false)}
          onPick={(_l, picked) => patchAct({ standards: appendStandards(act.standards ?? '', picked) })}
        />
      )}
    </>
  )
}
