/* 학교 문서 만들기 — 만들기 — 고른 문서의 칸 채우기 · 결과 (Committee.tsx 에서 나눔, 3.8.0) */
import Mono from '../../components/Mono'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DocField, DocForm } from '../../../shared/docforms'
import {
  CUSTOM_PREFIX,
  DOC_FORMS,
  DOC_GROUPS,
  SLOT_KIND,
  customId,
  isCustom,
  parseCustomForm
} from '../../../shared/docforms'
import type { HwpForm } from '../../../shared/hwpform'
import type { AliasPair, ModelChoice, Template, TemplateInput } from '../../../shared/types'
import { ROLES } from '../../../shared/types'
import type { PageId } from '../../App'
import { useConfirm } from '../../lib/confirm'
import { useToast } from '../../lib/toast'
import { todayStr } from '../../lib/util'
import ModelPicker from '../../components/ModelPicker'
import FormFillCard from '../../components/FormFillCard'
import { HwpFormMaker, HwpFormShelf, PersonalNote, pickHwpForms } from '../../components/HwpForms'
import type { Method, PersonalWarn } from '../../components/HwpForms'
import { takeCommitteeTab } from '../../lib/chatBridge'
import type { CommitteeState } from './core'
import { BLANK_FORM_EDITOR, BLANK_TEMPLATE, fieldLines, parseFieldLines } from './core'

export default function CommitteeFill({ c }: { c: CommitteeState }): JSX.Element {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { onGo, toast, ask, mode, setMode, templates, setTemplates, hasKey, setHasKey, model, setModel, formId, setFormId, values, setValues, offIds, setOffIds, result, setResult, busy, setBusy, hwpForms, setHwpForms, useHwp, setUseHwp, hwpId, setHwpId, composeKey, setComposeKey, composeContent, setComposeContent, pourId, setPourId, pourKey, setPourKey, personal, setPersonal, direct, setDirect, directContent, setDirectContent, names, setNames, aliases, setAliases, preview, setPreview, showPreview, setShowPreview, showNames, setShowNames, editing, setEditing, editingId, setEditingId, reading, setReading, slotTemplateId, setSlotTemplateId, slots, setSlots, customForms, setCustomForms, formEditor, setFormEditor, sketching, setSketching, allForms, form, groups, kindLabel, loadTemplates, loadHwp, loadCustomForms, myExamples, exampleIds, allText, linkedForms, otherForms, hwpForm, directForm, docName, chooseForm, backToList, openDirect, addHwp, findNames, buildPreview, missing, generate, valuesText, guideText, composeHwp, resultName, saveResult, saveAsHwp, toHwpForm, keepAsExample, openExampleEditor, pickExampleFile, saveExample, removeExample, scrubExample, openFormEditor, sketchFromSample, pickSampleFile, saveCustomForm, removeCustomForm, slotTemplate, slotNames, filledForm, exampleEditor } = c
  return (
    <>
        {mode === '만들기' && form && (
          <>
            <div className="card">
              <div className="card-title">
                <span>
                  {form.name}
                  {isCustom(form) && (
                    <span className="badge" style={{ marginLeft: 8 }}>
                      내가 만든 서식
                    </span>
                  )}
                </span>
                <div className="row">
                  {isCustom(form) && (
                    <>
                      <button className="btn btn-sm btn-ghost" onClick={() => openFormEditor(form)}>
                        ✎ 서식 고치기
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => void removeCustomForm(form)}
                      >
                        서식 지우기
                      </button>
                    </>
                  )}
                  <button className="btn btn-sm btn-ghost" onClick={backToList}>
                    ← 다른 문서
                  </button>
                </div>
              </div>
              <p className="hint" style={{ margin: 0 }}>{form.summary}</p>
              <div className="cal-tasklist" style={{ marginTop: 10 }}>
                {form.outline.map((o, i) => (
                  <span key={o} className="badge">
                    {i + 1}. {o}
                  </span>
                ))}
              </div>
              {form.basis && (
                <p className="hint" style={{ marginBottom: 0 }}>
                  항목 근거: {form.basis}
                </p>
              )}
            </div>

            <div className={`note ${form.personal ? 'note-danger' : 'note-warn'}`} style={{ margin: '14px 0' }}>
              {form.personal ? (
                <>
                  <b>개인정보 안내</b>
                  <div style={{ marginTop: 6, lineHeight: 1.6 }}>
                    적은 내용은 AI 회사 서버로 전송됩니다. 학생 실명은 아래에서 가명으로 바꾼 뒤
                    전송되고, 결과에서 다시 실명으로 돌아옵니다. 치환표는 이 PC에만 있습니다.{' '}
                    <b>전송 전에 [전송될 내용 확인] 을 꼭 눌러 보세요.</b>
                  </div>
                </>
              ) : (
                <>적은 내용은 AI 회사 서버로 전송됩니다. 학생 이름이 들어간다면 아래 가명처리를 펼쳐 가려 주세요.</>
              )}
            </div>

            {/* 1. 모양 */}
            <div className="card">
              <div className="card-title">
                <span>1. 어떤 모양으로 만들까요?</span>
                <button className="btn btn-sm" onClick={() => void addHwp(form.id)}>
                  ＋ 한글 양식 넣기
                </button>
              </div>
              <PersonalNote list={personal} onClose={() => setPersonal([])} />
              <div className="look-list">
                <label className={`look ${useHwp && hwpForm ? 'on' : ''} ${hwpForms.length ? '' : 'off'}`}>
                  <input
                    type="radio"
                    checked={useHwp && !!hwpForm}
                    disabled={!hwpForms.length}
                    onChange={() => {
                      setUseHwp(true)
                      if (!hwpForm) setHwpId(linkedForms[0]?.id ?? hwpForms[0]?.id ?? null)
                    }}
                  />
                  <span className="look-body">
                    <span className="look-name">저장된 우리 학교 한글 양식으로</span>
                    {hwpForms.length ? (
                      <>
                        <select
                          value={hwpId ?? ''}
                          onChange={(e) => {
                            setHwpId(Number(e.target.value))
                            setUseHwp(true)
                            setComposeKey(0)
                          }}
                        >
                          {linkedForms.length > 0 && (
                            <optgroup label={`${form.name} 양식`}>
                              {linkedForms.map((h) => (
                                <option key={h.id} value={h.id}>
                                  {h.name} (.{h.kind})
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {otherForms.length > 0 && (
                            <optgroup label={linkedForms.length ? '다른 양식' : '넣어 둔 양식'}>
                              {otherForms.map((h) => (
                                <option key={h.id} value={h.id}>
                                  {h.name} (.{h.kind}){docName(h.doc_kind) ? ` — ${docName(h.doc_kind)}` : ''}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        <span className="look-sum">
                          양식의 글꼴 · 문단 모양 · 구성 그대로 새 한글 파일을 만듭니다. 모르는 자리를 ( ) 로 남기지
                          않습니다.
                          {hwpForm && (
                            <>
                              {' '}
                              <button className="link" onClick={() => openDirect(hwpForm, '직접')}>
                                AI 없이 빈칸만 채우기 →
                              </button>
                            </>
                          )}
                        </span>
                      </>
                    ) : (
                      <span className="look-sum">
                        학교에서 쓰던 {form.name} 한글 파일을 <b>[＋ 한글 양식 넣기]</b> 로 넣어 두면 그 모양 그대로
                        만들어 드립니다. 다음부터는 이 문서를 고르면 그 양식이 먼저 골라집니다.
                      </span>
                    )}
                  </span>
                </label>
                <label className={`look ${!useHwp || !hwpForm ? 'on' : ''}`}>
                  <input type="radio" checked={!useHwp || !hwpForm} onChange={() => setUseHwp(false)} />
                  <span className="look-body">
                    <span className="look-name">글로 초안 만들기</span>
                    <span className="look-sum">
                      들어갈 항목에 맞춰 글로 만듭니다. 복사해 붙이거나 한글 기본 모양(.hwpx)으로 저장합니다. 우리 학교
                      글 예시를 넣어 두면 그 형식을 따릅니다.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            {/* 2. 내용 */}
            <div className="card">
              <div className="card-title">2. 내용 채우기</div>
              {form.fields.map((f) => (
                <div className="field" key={f.key}>
                  <label>
                    {f.label}
                    {f.required && <span style={{ color: 'var(--danger)' }}> *</span>}
                  </label>
                  {f.lines ? (
                    <textarea
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      style={{ minHeight: f.lines }}
                    />
                  ) : (
                    <input
                      type="text"
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                    />
                  )}
                  {f.hint && <div className="hint">{f.hint}</div>}
                </div>
              ))}
              <p className="hint" style={{ marginBottom: 0 }}>
                {useHwp && hwpForm ? (
                  <>비워 둔 칸의 내용은 문서에서 뺍니다. 프로그램이 지어내거나 ( ) 로 남기지 않습니다.</>
                ) : (
                  <>
                    비워 둔 칸은 <b>빈칸으로</b> 나옵니다. 프로그램이 지어내지 않습니다.
                  </>
                )}
              </p>
            </div>

            {/* 3. 예시 — 한글 양식으로 만들 때는 양식이 본보기라서 쓰지 않는다 */}
            {!(useHwp && hwpForm) && (
            <div className="card">
              <div className="card-title">
                <span>3. 우리 학교 글 예시 (선택)</span>
                <button className="btn btn-sm" onClick={() => openExampleEditor(form.id)}>
                  ＋ 예시 넣기
                </button>
              </div>
              <p className="hint" style={{ marginTop: 0 }}>
                예전에 쓰던 {form.name} 을 넣어 두면 <b>위의 기본 뼈대보다 예시를 앞세웁니다.</b>{' '}
                항목 이름과 차례, 번호 매김, 말투를 예시 그대로 따릅니다. 한 건이면 충분합니다.
                <br />
                <b>예시에는 학생 실명이 없는 것을 넣어 주세요.</b>
              </p>

              {myExamples.length === 0 ? (
                <div className="empty">
                  넣어 둔 예시가 없습니다. 없으면 기본 뼈대대로 만듭니다.
                </div>
              ) : (
                <div className="list">
                  {myExamples.map((t) => (
                    <div className="item" key={t.id}>
                      <div className="item-head">
                        <label className="row" style={{ gap: 8, cursor: 'pointer', minWidth: 0 }}>
                          <input
                            type="checkbox"
                            checked={exampleIds.includes(t.id)}
                            onChange={(e) =>
                              setOffIds((p) =>
                                e.target.checked ? p.filter((x) => x !== t.id) : [...p, t.id]
                              )
                            }
                            style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div className="item-title">{t.name}</div>
                            <div className="item-meta">{t.content.length.toLocaleString()}자</div>
                          </div>
                        </label>
                        <div className="row">
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => {
                              const { id: _id, ...rest } = t
                              setEditing(rest)
                              setEditingId(t.id)
                            }}
                          >
                            수정
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => void removeExample(t.id)}
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {exampleEditor}
            </div>
            )}

            {/* 가명처리 */}
            <div className="card">
              <div className="card-title">
                <span>{useHwp && hwpForm ? '3' : '4'}. 가명처리 · 전송 확인</span>
                <div className="row">
                  {showNames && (
                    <button className="btn btn-sm" onClick={() => void findNames()}>
                      이름 자동 찾기
                    </button>
                  )}
                  <button className="btn btn-sm btn-ghost" onClick={() => setShowNames((v) => !v)}>
                    {showNames ? '접기' : '펼치기'}
                  </button>
                </div>
              </div>

              {!showNames ? (
                <p className="muted small" style={{ margin: 0 }}>
                  {names.length
                    ? `${names.length}개 이름을 가리도록 해 두었습니다.`
                    : '이 문서에는 보통 학생 이름이 들어가지 않습니다. 이름을 적으셨다면 펼쳐서 가려 주세요.'}
                </p>
              ) : (
                <>
                  <p className="hint" style={{ marginTop: 0 }}>
                    여기 넣은 이름은 전송 직전에 <b>학생A</b> 같은 가명으로 바뀌고, 결과에서 다시
                    실명으로 돌아옵니다. 주민등록번호·연락처·반·번호는 자동으로 지워집니다.
                  </p>

                  {names.length === 0 ? (
                    <div className="empty">
                      아직 가릴 이름이 없습니다. [이름 자동 찾기]를 누르거나 아래로 직접 넣으세요.
                    </div>
                  ) : (
                    <div className="list">
                      {names.map((n, i) => (
                        <div className="item" key={i}>
                          <div className="row" style={{ gap: 8 }}>
                            <input
                              type="text"
                              value={n.name}
                              onChange={(e) =>
                                setNames((p) =>
                                  p.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x))
                                )
                              }
                              placeholder="실명"
                              style={{ flex: 1, minWidth: 120 }}
                            />
                            <select
                              value={n.role}
                              onChange={(e) =>
                                setNames((p) =>
                                  p.map((x, xi) => (xi === i ? { ...x, role: e.target.value } : x))
                                )
                              }
                              style={{ minWidth: 110 }}
                            >
                              {ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                            <span className="badge badge-accent">
                              → {aliases.find((a) => a.real === n.name.trim())?.alias ?? '…'}
                            </span>
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={() => setNames((p) => p.filter((_, xi) => xi !== i))}
                            >
                              제거
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="row" style={{ marginTop: 12 }}>
                    <button
                      className="btn btn-sm"
                      onClick={() => setNames((p) => [...p, { name: '', role: '학생' }])}
                    >
                      ＋ 이름 직접 추가
                    </button>
                    <span className="spacer" />
                    <button className="btn" onClick={() => void buildPreview()}>
                      전송될 내용 확인
                    </button>
                  </div>

                  {showPreview && (
                    <div style={{ marginTop: 12 }}>
                      <div className="note note-warn">
                        아래가 실제로 AI에 전송되는 내용입니다. 실명이 남아 있으면 위에 이름을
                        추가하세요.
                      </div>
                      <div className="scroll-box" style={{ marginTop: 8 }}>
                        {preview || '(비어 있음)'}
                      </div>
                      <button
                        className="btn btn-sm btn-ghost"
                        style={{ marginTop: 8 }}
                        onClick={() => setShowPreview(false)}
                      >
                        닫기
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 만들기 */}
            <div className="card">
              <div className="card-title">
                {useHwp && hwpForm ? `4. 한글 파일로 만들기` : '5. 초안 만들기'}
              </div>
              {hasKey && (
                <ModelPicker
                  feature="scenario"
                  label="문서 생성에 쓸 모델"
                  onReady={setModel}
                  onChange={setModel}
                />
              )}
              <div className="row">
                {useHwp && hwpForm ? (
                  <button
                    className="btn btn-primary"
                    onClick={() => void composeHwp()}
                    disabled={!hasKey || missing.length > 0}
                  >
                    {composeKey ? '다시 만들기' : `「${hwpForm.name}」 모양으로 만들기`}
                  </button>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={() => void generate()}
                    disabled={busy || !hasKey || missing.length > 0}
                  >
                    {busy ? '만드는 중…' : `${form.name} 만들기`}
                  </button>
                )}
                {useHwp && hwpForm ? (
                  <span className="badge badge-accent">.{hwpForm.kind} 양식의 모양을 따릅니다</span>
                ) : exampleIds.length > 0 ? (
                  <span className="badge badge-accent">예시 {exampleIds.length}건을 따릅니다</span>
                ) : myExamples.length > 0 ? (
                  <span className="badge badge-warn">예시를 모두 껐습니다 · 기본 뼈대로 만듭니다</span>
                ) : (
                  <span className="badge">기본 뼈대로 만듭니다</span>
                )}
                {!hasKey && (
                  <span className="muted small">
                    API 키가 필요합니다.{' '}
                    <button className="link" onClick={() => onGo('설정')}>
                      설정으로
                    </button>
                  </span>
                )}
                {hasKey && missing.length > 0 && (
                  <span className="muted small">{missing.join(', ')} 을(를) 적어야 합니다.</span>
                )}
              </div>
            </div>

            {useHwp && hwpForm && composeKey > 0 && (
              <FormFillCard
                key={`${hwpForm.id}-${composeKey}`}
                form={{ id: hwpForm.id }}
                formName={hwpForm.name}
                kind={hwpForm.kind}
                content={composeContent}
                fileName={resultName()}
                model={model}
                aliases={aliases}
                guide={guideText()}
              />
            )}

            {!(useHwp && hwpForm) && result && (
              <div className="card">
                <div className="card-title">
                  <span>결과</span>
                  <div className="row">
                    <button
                      className="btn btn-sm"
                      onClick={() =>
                        void (async () => {
                          await window.api.clipboard.write(result)
                          toast('복사했습니다. 한글에 붙여넣으세요.', 'ok')
                        })()
                      }
                    >
                      복사
                    </button>
                    <button className="btn btn-sm" onClick={() => void keepAsExample()}>
                      예시로 남기기
                    </button>
                    <button className="btn btn-sm" onClick={() => void saveResult()} title="메모장에서 열리는 .txt 파일">
                      텍스트로 저장
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => void saveAsHwp()}
                      title="양식 없이 한글 기본 모양(.hwpx)으로 저장합니다"
                    >
                      한글 파일로
                    </button>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={toHwpForm}
                      title="넣어 둔 학교 한글 양식의 모양으로 이 글을 새 한글 문서로 만듭니다"
                    >
                      학교 양식에 담기
                    </button>
                  </div>
                </div>

                <div className="note note-warn">
                  <b>그대로 쓰지 마세요.</b> AI가 만든 초안입니다. 사실관계·절차·수치는 반드시 직접
                  확인하고 고치신 뒤 사용하세요. 아래에서 바로 고칠 수 있습니다.
                </div>

                <textarea
                  value={result}
                  onChange={(e) => setResult(e.target.value)}
                  style={{ minHeight: 420, marginTop: 10, fontFamily: 'inherit', lineHeight: 1.7 }}
                />
              </div>
            )}

            {/* 글 초안을 한글 양식에 옮겨 담기 */}
            {!(useHwp && hwpForm) && result && pourId !== null && (
              <div className="card">
                <div className="card-title">
                  <span>학교 한글 양식에 담기</span>
                  <button className="btn btn-sm btn-ghost" onClick={() => setPourId(null)}>
                    닫기
                  </button>
                </div>
                <div className="row">
                  <select
                    value={pourId}
                    onChange={(e) => {
                      setPourId(Number(e.target.value))
                      setPourKey(0)
                    }}
                    style={{ flex: 1, minWidth: 200 }}
                  >
                    {[...linkedForms, ...otherForms].map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name} (.{h.kind}){docName(h.doc_kind) ? ` — ${docName(h.doc_kind)}` : ''}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-primary" onClick={() => setPourKey((k) => k + 1)} disabled={!hasKey}>
                    {pourKey ? '다시 담기' : '이 양식에 담기'}
                  </button>
                </div>
                <p className="hint" style={{ marginBottom: 0 }}>
                  위 초안을 양식의 구성에 맞춰 다시 써서, 양식의 글꼴 · 문단 모양 그대로 한글 파일로 만듭니다.
                </p>
                {pourKey > 0 &&
                  (() => {
                    const h = hwpForms.find((x) => x.id === pourId)
                    return h ? (
                      <div style={{ marginTop: 12 }}>
                        <FormFillCard
                          key={`${h.id}-${pourKey}`}
                          form={{ id: h.id }}
                          formName={h.name}
                          kind={h.kind}
                          content={result}
                          fileName={resultName()}
                          model={model}
                          aliases={aliases}
                          guide={guideText()}
                        />
                      </div>
                    ) : null
                  })()}
              </div>
            )}
          </>
        )}
    </>
  )
}
