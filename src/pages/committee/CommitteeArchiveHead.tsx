/* 학교 문서 만들기 — 보관함 — 머리 (Committee.tsx 에서 나눔, 3.8.0) */
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

export default function CommitteeArchiveHead({ c }: { c: CommitteeState }): JSX.Element {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { onGo, toast, ask, mode, setMode, templates, setTemplates, hasKey, setHasKey, model, setModel, formId, setFormId, values, setValues, offIds, setOffIds, result, setResult, busy, setBusy, hwpForms, setHwpForms, useHwp, setUseHwp, hwpId, setHwpId, composeKey, setComposeKey, composeContent, setComposeContent, pourId, setPourId, pourKey, setPourKey, personal, setPersonal, direct, setDirect, directContent, setDirectContent, names, setNames, aliases, setAliases, preview, setPreview, showPreview, setShowPreview, showNames, setShowNames, editing, setEditing, editingId, setEditingId, reading, setReading, slotTemplateId, setSlotTemplateId, slots, setSlots, customForms, setCustomForms, formEditor, setFormEditor, sketching, setSketching, allForms, form, groups, kindLabel, loadTemplates, loadHwp, loadCustomForms, myExamples, exampleIds, allText, linkedForms, otherForms, hwpForm, directForm, docName, chooseForm, backToList, openDirect, addHwp, findNames, buildPreview, missing, generate, valuesText, guideText, composeHwp, resultName, saveResult, saveAsHwp, toHwpForm, keepAsExample, openExampleEditor, pickExampleFile, saveExample, removeExample, scrubExample, openFormEditor, sketchFromSample, pickSampleFile, saveCustomForm, removeCustomForm, slotTemplate, slotNames, filledForm, exampleEditor } = c
  return (
    <>
        {mode === '보관함' && (
          <HwpFormShelf
            docs={allForms.map((f) => ({ id: f.id, name: f.name }))}
            onChanged={() => void loadHwp()}
            onUse={(f) => openDirect(f)}
          />
        )}
    </>
  )
}
