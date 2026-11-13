/* 학교 문서 만들기 — 만들기 — 우리 학교 한글 양식으로 바로 (Committee.tsx 에서 나눔, 3.8.0) */
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

export default function CommitteeDirect({ c }: { c: CommitteeState }): JSX.Element {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { onGo, toast, ask, mode, setMode, templates, setTemplates, hasKey, setHasKey, model, setModel, formId, setFormId, values, setValues, offIds, setOffIds, result, setResult, busy, setBusy, hwpForms, setHwpForms, useHwp, setUseHwp, hwpId, setHwpId, composeKey, setComposeKey, composeContent, setComposeContent, pourId, setPourId, pourKey, setPourKey, personal, setPersonal, direct, setDirect, directContent, setDirectContent, names, setNames, aliases, setAliases, preview, setPreview, showPreview, setShowPreview, showNames, setShowNames, editing, setEditing, editingId, setEditingId, reading, setReading, slotTemplateId, setSlotTemplateId, slots, setSlots, customForms, setCustomForms, formEditor, setFormEditor, sketching, setSketching, allForms, form, groups, kindLabel, loadTemplates, loadHwp, loadCustomForms, myExamples, exampleIds, allText, linkedForms, otherForms, hwpForm, directForm, docName, chooseForm, backToList, openDirect, addHwp, findNames, buildPreview, missing, generate, valuesText, guideText, composeHwp, resultName, saveResult, saveAsHwp, toHwpForm, keepAsExample, openExampleEditor, pickExampleFile, saveExample, removeExample, scrubExample, openFormEditor, sketchFromSample, pickSampleFile, saveCustomForm, removeCustomForm, slotTemplate, slotNames, filledForm, exampleEditor } = c
  return (
    <>
        {mode === '만들기' && !form && directForm && (
          <>
            <div className="card">
              <div className="card-title">
                <span>
                  {directForm.name}
                  {docName(directForm.doc_kind) && (
                    <span className="badge" style={{ marginLeft: 8 }}>
                      {docName(directForm.doc_kind)} 양식
                    </span>
                  )}
                </span>
                <button className="btn btn-sm btn-ghost" onClick={backToList}>
                  ← 다른 문서
                </button>
              </div>
              <p className="hint" style={{ margin: 0 }}>
                이 양식 하나를 틀로 새 한글 문서를 만듭니다. 문서 종류에 묶어 두려면 <b>[양식 · 예시 보관함]</b> 에서
                고르세요.
              </p>
            </div>
            <HwpFormMaker
              form={directForm}
              content={directContent}
              onContent={setDirectContent}
              aliases={aliases}
              hasKey={hasKey}
              onGo={onGo}
              method={direct?.method}
            />
          </>
        )}
    </>
  )
}
