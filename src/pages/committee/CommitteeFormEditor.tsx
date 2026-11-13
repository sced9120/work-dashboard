/* 학교 문서 만들기 — 만들기 — 문서 종류 직접 만들기(편집기) (Committee.tsx 에서 나눔, 3.8.0) */
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

export default function CommitteeFormEditor({ c }: { c: CommitteeState }): JSX.Element {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { onGo, toast, ask, mode, setMode, templates, setTemplates, hasKey, setHasKey, model, setModel, formId, setFormId, values, setValues, offIds, setOffIds, result, setResult, busy, setBusy, hwpForms, setHwpForms, useHwp, setUseHwp, hwpId, setHwpId, composeKey, setComposeKey, composeContent, setComposeContent, pourId, setPourId, pourKey, setPourKey, personal, setPersonal, direct, setDirect, directContent, setDirectContent, names, setNames, aliases, setAliases, preview, setPreview, showPreview, setShowPreview, showNames, setShowNames, editing, setEditing, editingId, setEditingId, reading, setReading, slotTemplateId, setSlotTemplateId, slots, setSlots, customForms, setCustomForms, formEditor, setFormEditor, sketching, setSketching, allForms, form, groups, kindLabel, loadTemplates, loadHwp, loadCustomForms, myExamples, exampleIds, allText, linkedForms, otherForms, hwpForm, directForm, docName, chooseForm, backToList, openDirect, addHwp, findNames, buildPreview, missing, generate, valuesText, guideText, composeHwp, resultName, saveResult, saveAsHwp, toHwpForm, keepAsExample, openExampleEditor, pickExampleFile, saveExample, removeExample, scrubExample, openFormEditor, sketchFromSample, pickSampleFile, saveCustomForm, removeCustomForm, slotTemplate, slotNames, filledForm, exampleEditor } = c
  return (
    <>
        {mode === '만들기' && formEditor && (
          <div className="card">
            <div className="card-title">
              <span>{formEditor.originalId ? '문서 서식 고치기' : '문서 종류 직접 만들기'}</span>
              <button className="btn btn-sm btn-ghost" onClick={() => setFormEditor(null)}>
                닫기
              </button>
            </div>

            <div className="row" style={{ gap: 12 }}>
              <div className="field" style={{ flex: 2, minWidth: 200 }}>
                <label>
                  문서 이름 <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="text"
                  value={formEditor.name}
                  onChange={(e) => setFormEditor({ ...formEditor, name: e.target.value })}
                  placeholder="예: 방과후학교 강사 위촉 계획"
                />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 150 }}>
                <label>묶음</label>
                <input
                  type="text"
                  list="docform-groups"
                  value={formEditor.group}
                  onChange={(e) => setFormEditor({ ...formEditor, group: e.target.value })}
                />
                <datalist id="docform-groups">
                  {groups.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="field">
              <label>한 줄 설명</label>
              <input
                type="text"
                value={formEditor.summary}
                onChange={(e) => setFormEditor({ ...formEditor, summary: e.target.value })}
                placeholder="예: 방과후 강사를 새로 뽑을 때 올리는 계획 기안"
              />
            </div>

            <div className="note note-ok" style={{ margin: '4px 0 12px' }}>
              <b>쓰시던 문서가 있으면 여기 붙여넣으세요.</b> 항목과 물어볼 칸을 뽑아 아래를 채워
              드립니다. 붙여넣은 글은 서식을 뽑는 데만 쓰이고 저장되지 않습니다.
            </div>

            <div className="field">
              <label>예시 문서 (선택)</label>
              <div className="row" style={{ marginBottom: 6 }}>
                <button className="btn btn-sm" onClick={() => void pickSampleFile()} disabled={reading}>
                  {reading ? '읽는 중…' : '파일에서 불러오기'}
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => void sketchFromSample()}
                  disabled={sketching || !hasKey || !formEditor.sample.trim()}
                >
                  {sketching ? '뽑는 중…' : '예시에서 서식 뽑기'}
                </button>
                {!hasKey && <span className="muted small">API 키가 있어야 뽑아낼 수 있습니다</span>}
              </div>
              <textarea
                value={formEditor.sample}
                onChange={(e) => setFormEditor({ ...formEditor, sample: e.target.value })}
                style={{ minHeight: 110 }}
                placeholder="한글에서 복사해 붙여넣으세요. 없으면 아래를 직접 적으셔도 됩니다."
              />
            </div>

            <div className="field">
              <label>
                들어갈 항목 <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <textarea
                value={formEditor.outlineText}
                onChange={(e) => setFormEditor({ ...formEditor, outlineText: e.target.value })}
                style={{ minHeight: 130 }}
                placeholder={'한 줄에 하나씩 적으세요.\n예)\n목적\n근거\n선발 방법\n소요 예산\n행정 사항'}
              />
              <div className="hint">문서를 이 차례로 씁니다.</div>
            </div>

            <div className="field">
              <label>
                물어볼 칸 <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <textarea
                value={formEditor.fieldText}
                onChange={(e) => setFormEditor({ ...formEditor, fieldText: e.target.value })}
                style={{ minHeight: 130 }}
                placeholder={'한 줄에 하나씩 적으세요.\n예)\n사업명 *\n선발 방법 *...\n예산 ...\n담당자'}
              />
              <div className="hint">
                이름 뒤에 <code>*</code> 를 붙이면 <b>반드시 채워야 하는 칸</b>, <code>...</code> 을
                붙이면 <b>여러 줄을 적는 넓은 칸</b>이 됩니다. 둘 다 붙여도 됩니다.
              </div>
            </div>

            <div className="field">
              <label>문체 · 주의사항 (선택)</label>
              <textarea
                value={formEditor.guide}
                onChange={(e) => setFormEditor({ ...formEditor, guide: e.target.value })}
                style={{ minHeight: 90 }}
                placeholder={'예: 공문 기안 문체(개조식)로 쓰세요.\n금액은 산출 내역이 드러나게 적으세요.'}
              />
            </div>

            <label className="sheet-check" style={{ marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={formEditor.personal}
                onChange={(e) => setFormEditor({ ...formEditor, personal: e.target.checked })}
                style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
              />
              <span>
                <b>학생·보호자 이름이 들어가는 문서</b>
                <span className="muted"> — 켜 두면 가명처리 칸이 펼쳐진 채로 나옵니다</span>
              </span>
            </label>

            <div className="row row-end">
              <button className="btn btn-ghost" onClick={() => setFormEditor(null)}>
                취소
              </button>
              <button className="btn btn-primary" onClick={() => void saveCustomForm()}>
                서식 저장
              </button>
            </div>
          </div>
        )}
    </>
  )
}
