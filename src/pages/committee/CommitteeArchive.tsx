/* 학교 문서 만들기 — 보관함 — 목록 (Committee.tsx 에서 나눔, 3.8.0) */
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

export default function CommitteeArchive({ c }: { c: CommitteeState }): JSX.Element {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { onGo, toast, ask, mode, setMode, templates, setTemplates, hasKey, setHasKey, model, setModel, formId, setFormId, values, setValues, offIds, setOffIds, result, setResult, busy, setBusy, hwpForms, setHwpForms, useHwp, setUseHwp, hwpId, setHwpId, composeKey, setComposeKey, composeContent, setComposeContent, pourId, setPourId, pourKey, setPourKey, personal, setPersonal, direct, setDirect, directContent, setDirectContent, names, setNames, aliases, setAliases, preview, setPreview, showPreview, setShowPreview, showNames, setShowNames, editing, setEditing, editingId, setEditingId, reading, setReading, slotTemplateId, setSlotTemplateId, slots, setSlots, customForms, setCustomForms, formEditor, setFormEditor, sketching, setSketching, allForms, form, groups, kindLabel, loadTemplates, loadHwp, loadCustomForms, myExamples, exampleIds, allText, linkedForms, otherForms, hwpForm, directForm, docName, chooseForm, backToList, openDirect, addHwp, findNames, buildPreview, missing, generate, valuesText, guideText, composeHwp, resultName, saveResult, saveAsHwp, toHwpForm, keepAsExample, openExampleEditor, pickExampleFile, saveExample, removeExample, scrubExample, openFormEditor, sketchFromSample, pickSampleFile, saveCustomForm, removeCustomForm, slotTemplate, slotNames, filledForm, exampleEditor } = c
  return (
    <>
        {mode === '보관함' && (
          <div className="card">
            <div className="card-title">
              <span>글 예시</span>
              <button className="btn btn-sm btn-primary" onClick={() => openExampleEditor('')}>
                ＋ 예시 넣기
              </button>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              한글 파일이 없는 문서는 쓰던 글을 붙여넣어 두세요. <b>글로 초안을 만들 때 형식의 본보기</b>로 쓰입니다.
              한 번 넣어 두면 그 뒤로 계속 그 형식으로 나옵니다.
              <br />
              예시는 <b>인수인계 파일에 함께 넘어갑니다.</b> 학생 실명이 든 문서는 넣지 마세요.
            </p>

            {templates.length === 0 ? (
              <div className="empty">
                아직 넣어 둔 예시가 없습니다. 없어도 문서는 만들어집니다.
              </div>
            ) : (
              <div className="list">
                {templates.map((t) => (
                  <div className="item" key={t.id}>
                    <div className="item-head">
                      <div style={{ minWidth: 0 }}>
                        <div className="item-title">{t.name}</div>
                        <div className="item-meta">
                          {kindLabel(t.kind) || '종류 없음'} · {t.content.length.toLocaleString()}자
                          {t.added_at ? ` · ${t.added_at}` : ''}
                        </div>
                      </div>
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
    </>
  )
}
