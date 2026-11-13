/* 학교 문서 만들기 — 화면 틀. 상태 · 동작은 committee/core.tsx 의 useCommittee, 화면 조각은 committee/*.tsx */
import Mono from '../components/Mono'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DocField, DocForm } from '../../shared/docforms'
import {
  CUSTOM_PREFIX,
  DOC_FORMS,
  DOC_GROUPS,
  SLOT_KIND,
  customId,
  isCustom,
  parseCustomForm
} from '../../shared/docforms'
import type { HwpForm } from '../../shared/hwpform'
import type { AliasPair, ModelChoice, Template, TemplateInput } from '../../shared/types'
import { ROLES } from '../../shared/types'
import type { PageId } from '../App'
import { useConfirm } from '../lib/confirm'
import { useToast } from '../lib/toast'
import { todayStr } from '../lib/util'
import ModelPicker from '../components/ModelPicker'
import FormFillCard from '../components/FormFillCard'
import { HwpFormMaker, HwpFormShelf, PersonalNote, pickHwpForms } from '../components/HwpForms'
import type { Method, PersonalWarn } from '../components/HwpForms'
import { takeCommitteeTab } from '../lib/chatBridge'
import { useCommittee } from './committee/core'
import CommitteePick from './committee/CommitteePick'
import CommitteeFormEditor from './committee/CommitteeFormEditor'
import CommitteeFill from './committee/CommitteeFill'
import CommitteeDirect from './committee/CommitteeDirect'
import CommitteeTemplates from './committee/CommitteeTemplates'
import CommitteeArchiveHead from './committee/CommitteeArchiveHead'
import CommitteeArchive from './committee/CommitteeArchive'

type Props = Parameters<typeof useCommittee>[0]

export default function Committee(props: Props): JSX.Element {
  const c = useCommittee(props)
  const { onGo, toast, ask, mode, setMode, templates, setTemplates, hasKey, setHasKey, model, setModel, formId, setFormId, values, setValues, offIds, setOffIds, result, setResult, busy, setBusy, hwpForms, setHwpForms, useHwp, setUseHwp, hwpId, setHwpId, composeKey, setComposeKey, composeContent, setComposeContent, pourId, setPourId, pourKey, setPourKey, personal, setPersonal, direct, setDirect, directContent, setDirectContent, names, setNames, aliases, setAliases, preview, setPreview, showPreview, setShowPreview, showNames, setShowNames, editing, setEditing, editingId, setEditingId, reading, setReading, slotTemplateId, setSlotTemplateId, slots, setSlots, customForms, setCustomForms, formEditor, setFormEditor, sketching, setSketching, allForms, form, groups, kindLabel, loadTemplates, loadHwp, loadCustomForms, myExamples, exampleIds, allText, linkedForms, otherForms, hwpForm, directForm, docName, chooseForm, backToList, openDirect, addHwp, findNames, buildPreview, missing, generate, valuesText, guideText, composeHwp, resultName, saveResult, saveAsHwp, toHwpForm, keepAsExample, openExampleEditor, pickExampleFile, saveExample, removeExample, scrubExample, openFormEditor, sketchFromSample, pickSampleFile, saveCustomForm, removeCustomForm, slotTemplate, slotNames, filledForm, exampleEditor } = c
  return (
    <>
      <div className="page-head">
        <h1>학교 문서 만들기</h1>
        <p>
          만들 문서를 고르고 내용을 채우면 됩니다. 우리 학교 한글 양식을 넣어 두면 그 양식의 글꼴·문단 모양·구성
          그대로 한글 파일이 나오고, 양식이 없으면 글로 초안을 만듭니다.
        </p>
      </div>

      <div className="tabs">
        <button className={`tab ${mode === '만들기' ? 'active' : ''}`} onClick={() => setMode('만들기')}>
          문서 만들기
        </button>
        <button className={`tab ${mode === '보관함' ? 'active' : ''}`} onClick={() => setMode('보관함')}>
          양식 · 예시 보관함
          {hwpForms.length + templates.length > 0 && (
            <span className="badge" style={{ marginLeft: 6 }}>
              {hwpForms.length + templates.length}
            </span>
          )}
        </button>
        <button className={`tab ${mode === '서식' ? 'active' : ''}`} onClick={() => setMode('서식')}>
          빈칸 채우기 (AI 안 씀)
        </button>
        <button
          className="tab tab-link"
          onClick={() => onGo('도우미')}
          title="업무 도우미에게 말로 부탁해 문서를 만듭니다. 넣어 둔 한글 양식에 맞춰 파일로도 만들어 줍니다."
        >
          도우미와 대화로 만들기
        </button>
      </div>

      {/* ══════════ 문서 만들기 ══════════ */}
      <CommitteePick c={c} />

      {/* ── 문서 종류 만들기 · 고치기 ── */}
      <CommitteeFormEditor c={c} />

      <CommitteeFill c={c} />

      {/* ══════════ 양식 하나로 바로 만들기 ══════════ */}
      <CommitteeDirect c={c} />

      {/* ══════════ 빈칸 채우기 ══════════ */}
      <CommitteeTemplates c={c} />

      {/* ══════════ 양식 · 예시 보관함 ══════════ */}
      <CommitteeArchiveHead c={c} />
      <CommitteeArchive c={c} />
    </>
  )
}
