/* 학교 문서 만들기 — 만들기 — 문서 종류 고르기 (Committee.tsx 에서 나눔, 3.8.0) */
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

export default function CommitteePick({ c }: { c: CommitteeState }): JSX.Element {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { onGo, toast, ask, mode, setMode, templates, setTemplates, hasKey, setHasKey, model, setModel, formId, setFormId, values, setValues, offIds, setOffIds, result, setResult, busy, setBusy, hwpForms, setHwpForms, useHwp, setUseHwp, hwpId, setHwpId, composeKey, setComposeKey, composeContent, setComposeContent, pourId, setPourId, pourKey, setPourKey, personal, setPersonal, direct, setDirect, directContent, setDirectContent, names, setNames, aliases, setAliases, preview, setPreview, showPreview, setShowPreview, showNames, setShowNames, editing, setEditing, editingId, setEditingId, reading, setReading, slotTemplateId, setSlotTemplateId, slots, setSlots, customForms, setCustomForms, formEditor, setFormEditor, sketching, setSketching, allForms, form, groups, kindLabel, loadTemplates, loadHwp, loadCustomForms, myExamples, exampleIds, allText, linkedForms, otherForms, hwpForm, directForm, docName, chooseForm, backToList, openDirect, addHwp, findNames, buildPreview, missing, generate, valuesText, guideText, composeHwp, resultName, saveResult, saveAsHwp, toHwpForm, keepAsExample, openExampleEditor, pickExampleFile, saveExample, removeExample, scrubExample, openFormEditor, sketchFromSample, pickSampleFile, saveCustomForm, removeCustomForm, slotTemplate, slotNames, filledForm, exampleEditor } = c
  return (
    <>
        {mode === '만들기' && !form && !directForm && (
          <>
            <div className="note note-info" style={{ marginBottom: 14 }}>
              <b>양식이 없어도 됩니다.</b> 문서마다 들어갈 항목을 프로그램이 알고 있어서, 내용만 채우면 바로
              나옵니다. 학교에서 쓰던 한글 파일이 있으면 <b>[양식 · 예시 보관함]</b> 에 넣고 어느 문서의 양식인지
              골라 두세요. 그 문서를 고르면 <b>저장된 양식을 먼저 골라</b> 그 모양 그대로 한글 파일로 만들어 드립니다.
              <div style={{ marginTop: 6 }}>
                맡으신 업무에 필요한 문서가 없다면 맨 아래 <b>[＋ 문서 종류 직접 만들기]</b> 로 만들어 쓰실 수
                있습니다.
              </div>
            </div>

            {groups.map((g) => {
              const list = allForms.filter((f) => f.group === g)
              if (!list.length) return null
              return (
                <div className="card" key={g}>
                  <div className="card-title">{g}</div>
                  <div className="pickgrid">
                    {list.map((f) => {
                      const n = templates.filter((t) => t.kind === f.id).length
                      const h = hwpForms.filter((x) => x.doc_kind === f.id).length
                      return (
                        <button key={f.id} className="pickcard" onClick={() => chooseForm(f)}>
                          <Mono name={f.name} size={34} className="pickcard-icon" />
                          <span className="pickcard-body">
                            <span className="pickcard-name">{f.name}</span>
                            <span className="pickcard-sum">{f.summary || '직접 만든 서식'}</span>
                          </span>
                          <span className="pickcard-badges">
                            {isCustom(f) && <span className="badge">내가 만든</span>}
                            {h > 0 && <span className="badge badge-accent">양식 {h}</span>}
                            {n > 0 && <span className="badge">예시 {n}</span>}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            <div className="card">
              <div className="card-title">
                <span>우리 학교 한글 양식으로 바로 만들기</span>
                <button className="btn btn-sm" onClick={() => void addHwp()}>
                  ＋ 한글 양식 넣기
                </button>
              </div>
              <PersonalNote list={personal} onClose={() => setPersonal([])} />
              {hwpForms.length === 0 ? (
                <p className="hint" style={{ margin: 0 }}>
                  위에 맞는 문서가 없어도, 학교에서 쓰던 한글 파일(.hwp · .hwpx)을 넣으면 그 양식으로 바로 새 문서를
                  만들 수 있습니다.
                </p>
              ) : (
                <div className="pickgrid">
                  {hwpForms.map((h) => (
                    <button key={h.id} className="pickcard" onClick={() => openDirect(h)}>
                      <Mono name="양식" size={34} className="pickcard-icon" />
                      <span className="pickcard-body">
                        <span className="pickcard-name">{h.name}</span>
                        <span className="pickcard-sum">
                          .{h.kind}
                          {docName(h.doc_kind) ? ` · ${docName(h.doc_kind)} 양식` : ' · 문서 종류 없이 이 양식으로 만들기'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-title">
                <span>맡으신 업무에 필요한 문서가 없나요?</span>
                <button className="btn btn-sm btn-primary" onClick={() => openFormEditor()}>
                  ＋ 문서 종류 직접 만들기
                </button>
              </div>
              <p className="hint" style={{ margin: 0 }}>
                학교 업무는 부서마다, 학교마다 다릅니다. 위에 없는 문서는 <b>쓰시던 문서를
                붙여넣으면 항목을 뽑아</b> 서식으로 만들어 드립니다. 만든 서식은{' '}
                <b>인수인계 파일에 함께 넘어가</b> 다음 담당자도 그대로 씁니다.
              </p>
            </div>
          </>
        )}
    </>
  )
}
