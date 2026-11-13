/* 세특 작성실 — 활동 보기(활동 고르기 · 설정 · 학생 표) (Seteuk.tsx 에서 나눔, 3.8.0) */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ModelChoice } from '../../../shared/types'
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
  byteLen,
  checkBadge,
  emptyRosters,
  emptyRow,
  defaultConfig,
  defaultOptions,
  emptyStyle,
  groundLeft,
  limitOf,
  minRatioOf,
  mergeNote,
  modeInfo,
  modeOfRec,
  newActivity,
  parseRoster,
  recordOf,
  setSeteukConfig,
  studentLabel,
  validateSeteuk
} from '../../../shared/seteuk'
import type { SeteukActivity, SeteukAmount, SeteukCheck, SeteukConfig, SeteukImportHit, SeteukMode, SeteukOptions, SeteukRosters, SeteukRow, SeteukRows, SeteukStyle } from '../../../shared/seteuk'
import Icon from '../../components/Icon'
import ModelPicker from '../../components/ModelPicker'
import SeteukImport from '../../components/SeteukImport'
import SeteukReview from '../../components/SeteukReview'
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
import { SAVE_DELAY, MODE_KEY, INTRO_KEY, newId, stored, remember } from './core'

export default function SeteukActsView({ c, rosterPanel }: { c: SeteukState; rosterPanel: ReactNode }): JSX.Element {
  const { onGo, toast, ask, loaded, setLoaded, rosters, setRosters, acts, setActs, rows, setRows, demo, setDemo, style, setStyle, options, setOptions, config, setConfig, grounding, setGrounding, mode, setMode, actIds, setActIds, cls, setCls, sel, setSel, focus, setFocus, save, setSave, model, setModel, panel, setPanel, rosterText, setRosterText, rosterGroup, setRosterGroup, cfgOpen, setCfgOpen, makerOpen, setMakerOpen, importOpen, setImportOpen, view, setView, finalOnly, setFinalOnly, rev, setRev, intro, setIntro, job, setJob, prog, setProg, errors, setErrors, pending, timer, actsTimer, actsRef, jobRef, info, students, modeActs, act, limit, cur, reload, flush, setCell, changeActs, patchAct, resetView, switchMode, switchView, togglePanel, parsed, applyRoster, removeGroup, removeStudent, clearRoster, classes, shown, prevRosterText, closeIntro, fillDemo, clearDemo, switchAct, addAct, removeAct, addExample, importNotes, targets, ready, write, saveOptions, checkGround, copyRequest, adoptEmpty, copyFinals, actKey, checks, allOn, toggleAll, toggle, filled, rec, rules } = c
  return (
    <>
        {panel !== 'review' && view === 'acts' && (
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
              </div>

              {act && rec && (
                <div className="stk-actbar">
                  <span className="small">
                    <b>{rec.key}</b> · 한도 {limit}바이트(한글 약 {Math.floor(limit / 3)}자) · 분량 {act.fill}%{act.amount === '메모만큼' ? ' · 짧은 메모는 짧게' : ''}{act.structure.trim() ? ' · 구성 있음' : ''}
                    {act.subject ? ` · ${act.subject}` : ''}
                  </span>
                  <span className="spacer" />
                  <button
                    className={`btn btn-sm ${makerOpen ? 'btn-primary' : ''}`}
                    onClick={() => {
                      setMakerOpen((v) => !v)
                      setCfgOpen(false)
                    }}
                    aria-expanded={makerOpen}
                    title="세특 구성 · 요청사항 · 분량을 적고, AI 에게 가는 프롬프트를 기재요령 틀과 함께 봅니다"
                  >
                    프롬프트 만들기
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      setCfgOpen((v) => !v)
                      setMakerOpen(false)
                    }}
                    aria-expanded={cfgOpen}
                  >
                    {cfgOpen ? '활동 설정 닫기' : '활동 설정'}
                  </button>
                </div>
              )}

              {act && rec && makerOpen && <SeteukPromptMaker act={act} style={style} config={config} onPatch={patchAct} onClose={() => setMakerOpen(false)} />}

              {act && rec && cfgOpen && (
                <div className="stk-panel stk-cfg">
                  <label>
                    <span>활동 이름</span>
                    <input type="text" value={act.name} onChange={(e) => patchAct({ name: e.target.value })} />
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
                    <input type="text" value={act.columns.join(', ')} onChange={(e) => patchAct({ columns: readColumns(e.target.value) })} placeholder="예: 탐구 주제, 탐구 과정, 알게 된 점 (쉼표로)" aria-label="입력 항목" />
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
                  <div className="stk-wide row row-end">
                    <button className="btn btn-sm btn-danger" onClick={() => void removeAct()} disabled={!!job}>
                      <Icon name="trash" size={14} /> 이 활동 지우기
                    </button>
                  </div>
                </div>
              )}
            </section>

            {!act ? (
              <section className="card empty">
                <p>{info.name} 활동이 없습니다. [＋ 활동] 으로 하나 만들면 학생별 표가 열립니다.</p>
              </section>
            ) : !students.length ? (
              <section className="card stk-first">
                <div className="card-title">{info.name} 명단을 넣으면 바로 씁니다</div>
                <p className="small muted">
                  「{act.name}」 활동은 만들어 두었습니다. {info.who} 명단만 붙여 넣으세요.
                </p>
                {rosterPanel}
                {demo.canFill && (
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
                  <label className="stk-opt small" title="검사에서 분량 초과 · 기재 금지 · 어미 같은 '고침'이 나온 학생만 걸린 점을 짚어 한 번 더 받습니다. 나아진 경우에만 바꿉니다.">
                    <input type="checkbox" checked={options.autoRepair} onChange={(e) => saveOptions({ autoRepair: e.target.checked })} disabled={!!job} />
                    자동 고쳐쓰기
                  </label>
                  <label className="stk-opt small" title="초안을 받은 뒤 관찰 기록에 없는 활동 · 수치 · 과장된 평가가 있는지 한 번 더 묻습니다. 학생마다 AI 를 한 번 더 부릅니다.">
                    <input type="checkbox" checked={options.ground} onChange={(e) => saveOptions({ ground: e.target.checked })} disabled={!!job} />
                    근거 확인
                  </label>
                  <span className="spacer" />
                  <button className="btn btn-sm" onClick={() => setImportOpen((v) => !v)} disabled={!!job} aria-expanded={importOpen} title="스캔한 활동지 · 사진이나 엑셀 표에서 학생별 관찰 기록을 가져옵니다">
                    <Icon name="scan" size={14} /> 관찰 기록 가져오기
                  </button>
                  {job ? (
                    <button className="btn btn-sm" onClick={() => void window.api.seteuk.cancel(job)}>
                      멈추기
                    </button>
                  ) : (
                    <button className="btn btn-primary btn-sm" onClick={() => void write()} disabled={!ready.length}>
                      <Icon name="spark" size={14} /> {sel.size ? `고른 ${ready.length}명` : `${ready.length}명`} 초안 받기
                    </button>
                  )}
                  <button className={`btn btn-sm ${finalOnly ? 'btn-primary' : ''}`} onClick={() => setFinalOnly((v) => !v)} aria-pressed={finalOnly} title="표에서 학생과 최종본만 넓게 봅니다">
                    {finalOnly ? '모두 보기' : '최종본만 보기'}
                  </button>
                  <button className="btn btn-sm" onClick={adoptEmpty} disabled={!!job} title="최종본이 빈 학생만 AI 초안을 최종본에 넣습니다">
                    빈 최종본에 초안 넣기
                  </button>
                  <button className="btn btn-sm" onClick={() => void copyFinals()} title="보이는 학생 순서대로 최종본을 한 줄씩 복사합니다">
                    최종본 열 복사
                  </button>
                </div>
                {importOpen && <SeteukImport students={shown} actId={act?.id ?? ''} onApply={importNotes} onClose={() => setImportOpen(false)} />}
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
                        return (
                          <tr key={s.id} className={on ? 'on' : ''} onFocus={() => setFocus(s.id)}>
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
                                      />
                                    </label>
                                  ))}
                                </div>
                              ) : (
                                <textarea value={r.note} onChange={(e) => setCell(s.id, { note: e.target.value })} placeholder="수업 · 활동에서 본 것을 적습니다" aria-label={`${studentLabel(s)} 관찰 기록`} />
                              )}
                              {on && r.note.trim() && (
                                <div className="stk-under">
                                  <span />
                                  <button
                                    className="btn btn-sm btn-ghost"
                                    onClick={() => void copyRequest(s.id)}
                                    title="AI 키가 없을 때 — 규칙과 이름을 가린 관찰 기록을 복사합니다. Gemini · ChatGPT · Claude 앱에 붙여 넣으세요."
                                  >
                                    키 없이 — 요청 글 복사
                                  </button>
                                </div>
                              )}
                            </td>
                            <td>
                              <textarea className="stk-ai" value={r.ai} onChange={(e) => setCell(s.id, { ai: e.target.value })} placeholder="초안이 여기에 옵니다" aria-label={`${studentLabel(s)} AI 초안`} />
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
                              <textarea value={r.final} onChange={(e) => setCell(s.id, { final: e.target.value })} placeholder="초안을 옮겨 다듬거나 바로 적습니다" aria-label={`${studentLabel(s)} 최종본`} />
                              <div className="stk-under">
                                <span className={`small ${fb > limit ? 'stk-over' : 'muted'}`}>
                                  {fb} / {limit}바이트
                                </span>
                                {on && r.note.trim() && shownText.trim() && (
                                  <button
                                    className="btn btn-sm btn-ghost"
                                    onClick={() => void checkGround(s.id)}
                                    disabled={!!grounding || !!job}
                                    title="최종본(없으면 초안)에 관찰 기록에 없는 내용이 있는지 AI 에게 묻습니다. 이름은 가려 보냅니다."
                                  >
                                    {grounding === s.id ? '확인 중…' : '근거 확인'}
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
                                      <b>확인</b> 관찰 기록에 없는 내용<span className="hit"> — {g.quote}</span>
                                      {g.why && <span className="why">{g.why}</span>}
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {on && r.ground && r.ground.length === 0 && <p className="small muted stk-ground-ok">근거 확인 — 관찰 기록에 없는 내용을 찾지 못했습니다.</p>}
                              {on && c && c.issues.length > 0 && (
                                <ul className="stk-issues">
                                  {c.issues.map((x, i) => (
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
            )}
          </>
        )}
    </>
  )
}
