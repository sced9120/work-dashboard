/* 학교 문서 만들기 — 서식 · 예시 보관 (Committee.tsx 에서 나눔, 3.8.0) */
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

export default function CommitteeTemplates({ c }: { c: CommitteeState }): JSX.Element {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { onGo, toast, ask, mode, setMode, templates, setTemplates, hasKey, setHasKey, model, setModel, formId, setFormId, values, setValues, offIds, setOffIds, result, setResult, busy, setBusy, hwpForms, setHwpForms, useHwp, setUseHwp, hwpId, setHwpId, composeKey, setComposeKey, composeContent, setComposeContent, pourId, setPourId, pourKey, setPourKey, personal, setPersonal, direct, setDirect, directContent, setDirectContent, names, setNames, aliases, setAliases, preview, setPreview, showPreview, setShowPreview, showNames, setShowNames, editing, setEditing, editingId, setEditingId, reading, setReading, slotTemplateId, setSlotTemplateId, slots, setSlots, customForms, setCustomForms, formEditor, setFormEditor, sketching, setSketching, allForms, form, groups, kindLabel, loadTemplates, loadHwp, loadCustomForms, myExamples, exampleIds, allText, linkedForms, otherForms, hwpForm, directForm, docName, chooseForm, backToList, openDirect, addHwp, findNames, buildPreview, missing, generate, valuesText, guideText, composeHwp, resultName, saveResult, saveAsHwp, toHwpForm, keepAsExample, openExampleEditor, pickExampleFile, saveExample, removeExample, scrubExample, openFormEditor, sketchFromSample, pickSampleFile, saveCustomForm, removeCustomForm, slotTemplate, slotNames, filledForm, exampleEditor } = c
  return (
    <>
        {mode === '서식' && (
          <>
            <div className="note note-ok" style={{ marginBottom: 14 }}>
              <b>이 기능은 인터넷을 쓰지 않습니다.</b> 서식에 <code>{'{{학생명}}'}</code> 처럼 적어
              두면 그 자리를 채워 넣기만 합니다. 입력한 내용이 이 PC 밖으로 나가지 않으므로 실명을
              그대로 쓰셔도 됩니다.
              <div style={{ marginTop: 6 }}>
                한글 양식 파일의 빈칸을 인터넷 없이 채우려면 <b>[문서 만들기]</b> 아래쪽{' '}
                <b>[우리 학교 한글 양식으로 바로 만들기]</b> 에서 양식을 고른 뒤 <b>[빈칸만 직접 채우기]</b> 를
                쓰세요.
              </div>
            </div>

            <div className="card">
              <div className="card-title">
                <span>1. 서식 고르기</span>
                <button className="btn btn-sm" onClick={() => openExampleEditor(SLOT_KIND)}>
                  ＋ 서식 등록하기
                </button>
              </div>

              {templates.filter((t) => t.kind === SLOT_KIND).length === 0 ? (
                <div className="empty">
                  등록된 서식이 없습니다. 출석통지서·처분통지서처럼 자주 쓰는 서식을 한글에서 복사해
                  등록하고, 바뀌는 자리에 {'{{학생명}}'} {'{{일시}}'} 처럼 적어 두세요.
                </div>
              ) : (
                <div className="list">
                  {templates
                    .filter((t) => t.kind === SLOT_KIND)
                    .map((t) => (
                      <div className="item" key={t.id}>
                        <div className="item-head">
                          <label className="row" style={{ gap: 8, cursor: 'pointer', minWidth: 0 }}>
                            <input
                              type="radio"
                              checked={slotTemplateId === t.id}
                              onChange={() => {
                                setSlotTemplateId(t.id)
                                setSlots({})
                              }}
                              style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
                            />
                            <div style={{ minWidth: 0 }}>
                              <div className="item-title">{t.name}</div>
                              <div className="item-meta">{t.content.length.toLocaleString()}자</div>
                            </div>
                          </label>
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
                        </div>
                      </div>
                    ))}
                </div>
              )}
              {exampleEditor}
            </div>

            {slotTemplate && (
              <>
                <div className="card">
                  <div className="card-title">2. 내용 채우기</div>
                  {slotNames.length === 0 ? (
                    <div className="note note-warn">
                      이 서식에 채울 자리가 없습니다. 서식을 수정해서 바뀌는 부분을{' '}
                      <code>{'{{학생명}}'}</code> 처럼 두 겹 중괄호로 감싸 주세요.
                    </div>
                  ) : (
                    slotNames.map((name) => (
                      <div className="field" key={name}>
                        <label>{name}</label>
                        <input
                          type="text"
                          value={slots[name] ?? ''}
                          onChange={(e) => setSlots((s) => ({ ...s, [name]: e.target.value }))}
                          placeholder={`${name} 을(를) 입력하세요`}
                        />
                      </div>
                    ))
                  )}
                </div>

                <div className="card">
                  <div className="card-title">
                    <span>3. 결과</span>
                    <div className="row">
                      <button
                        className="btn btn-sm"
                        onClick={() =>
                          void (async () => {
                            await window.api.clipboard.write(filledForm)
                            toast('복사했습니다. 한글에 붙여넣으세요.', 'ok')
                          })()
                        }
                      >
                        복사
                      </button>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() =>
                          void (async () => {
                            const res = await window.api.docdraft.save({
                              name: slotTemplate.name,
                              text: filledForm
                            })
                            toast(res.message, res.ok ? 'ok' : 'err')
                          })()
                        }
                      >
                        파일로 저장
                      </button>
                    </div>
                  </div>
                  <div className="scroll-box" style={{ whiteSpace: 'pre-wrap' }}>
                    {filledForm}
                  </div>
                </div>
              </>
            )}
          </>
        )}
    </>
  )
}
