/**
 * 학교 문서 만들기 — 화면 상태와 동작 (Committee.tsx 에서 나눔, 3.8.0).
 * 화면 조각(committee/*.tsx)은 이 훅이 돌려주는 값(CommitteeState)만 받아 그린다.
 */
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

export interface Props {
  onGo: (p: PageId) => void
}

export interface NameRow {
  name: string
  role: string
}

/**
 * 만들기: 문서를 고르고 → 모양(우리 학교 한글 양식 / 글 초안)을 고르고 → 내용을 채워 만든다.
 * 보관함: 한글 양식 파일과 글 예시를 넣어 두고 어느 문서의 것인지 묶는다.
 * 서식: {{칸}} 만 채우는 글 서식 (인터넷 안 씀).
 */
export type Mode = '만들기' | '서식' | '보관함'

export const BLANK_TEMPLATE: TemplateInput = { name: '', kind: '', content: '', added_at: '' }

/** 직접 만드는 서식을 화면에서 편집할 때 담아 두는 값 */
export interface FormEditor {
  /** 고치는 중이면 원래 id. 새로 만드는 중이면 빈 문자열 */
  originalId: string
  name: string
  group: string
  summary: string
  icon: string
  outlineText: string
  fieldText: string
  guide: string
  personal: boolean
  /** 서식을 뽑아낼 예시 원문 */
  sample: string
}

export const BLANK_FORM_EDITOR: FormEditor = {
  originalId: '',
  name: '',
  group: '직접 만든 서식',
  summary: '',
  icon: '',
  outlineText: '',
  fieldText: '',
  guide: '',
  personal: false,
  sample: ''
}

/**
 * "칸 이름" 을 한 줄에 하나씩 적은 글을 입력칸 목록으로 바꾼다.
 * 이름 뒤의 `*` 는 반드시 채울 칸, `...` 은 여러 줄을 적는 넓은 칸을 뜻한다.
 */
export function parseFieldLines(text: string): DocField[] {
  const out: DocField[] = []
  for (const raw of text.split('\n')) {
    let s = raw.trim()
    let required = false
    let long = false
    // 표시가 어느 차례로 붙어 있어도 떼어 낸다
    for (;;) {
      if (s.endsWith('*')) {
        required = true
        s = s.slice(0, -1).trim()
        continue
      }
      if (/(\.{3}|…)$/.test(s)) {
        long = true
        s = s.replace(/(\.{3}|…)$/, '').trim()
        continue
      }
      break
    }
    if (!s || out.some((f) => f.key === s)) continue
    out.push({ key: s, label: s, ...(long ? { lines: 110 } : {}), ...(required ? { required: true } : {}) })
  }
  return out
}

/** 위의 반대. 고칠 때 다시 글로 펴 준다. */
export function fieldLines(fields: DocField[]): string {
  return fields
    .map((f) => `${f.label}${f.required ? ' *' : ''}${f.lines ? ' ...' : ''}`)
    .join('\n')
}

export function useCommittee({ onGo }: Props) {
  const toast = useToast()
  const ask = useConfirm()

  const [mode, setMode] = useState<Mode>('만들기')
  // 업무 도우미에서 [양식 넣으러 가기] 로 왔으면 보관함부터 연다
  useEffect(() => {
    if (takeCommitteeTab() === '보관함') setMode('보관함')
  }, [])
  const [templates, setTemplates] = useState<Template[]>([])
  const [hasKey, setHasKey] = useState(true)
  const [model, setModel] = useState<ModelChoice | null>(null)

  /* 만들기 */
  const [formId, setFormId] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  /**
   * 예시는 넣어 둔 것을 모두 쓰는 것이 기본이다.
   * 여기에는 사람이 일부러 **끈** 것만 담는다.
   *
   * 예전에는 켠 것을 담았는데, 그러면 예시를 새로 넣어도 목록에 들어가지
   * 않아 그대로 만들기를 누르면 예시 없이 만들어졌다.
   */
  const [offIds, setOffIds] = useState<number[]>([])
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)

  /* 우리 학교 한글 양식 */
  const [hwpForms, setHwpForms] = useState<HwpForm[]>([])
  /** 문서를 한글 양식의 모양으로 만들지(true), 글 초안으로 만들지(false) */
  const [useHwp, setUseHwp] = useState(false)
  const [hwpId, setHwpId] = useState<number | null>(null)
  /** [만들기] 를 누를 때마다 늘려서 양식 카드를 새로 그린다 */
  const [composeKey, setComposeKey] = useState(0)
  const [composeContent, setComposeContent] = useState('')
  /** 글 초안을 한글 양식에 옮겨 담기 */
  const [pourId, setPourId] = useState<number | null>(null)
  const [pourKey, setPourKey] = useState(0)
  const [personal, setPersonal] = useState<PersonalWarn[]>([])
  /** 문서 종류 없이 양식 하나로 바로 만들기 */
  const [direct, setDirect] = useState<{ id: number; method: Method } | null>(null)
  const [directContent, setDirectContent] = useState('')

  /* 가명처리 */
  const [names, setNames] = useState<NameRow[]>([])
  const [aliases, setAliases] = useState<AliasPair[]>([])
  const [preview, setPreview] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [showNames, setShowNames] = useState(true)

  /* 예시 넣기·고치기 */
  const [editing, setEditing] = useState<TemplateInput | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [reading, setReading] = useState(false)

  /* 빈칸 채우기 서식 */
  const [slotTemplateId, setSlotTemplateId] = useState<number | null>(null)
  const [slots, setSlots] = useState<Record<string, string>>({})

  /* 직접 만든 서식 */
  const [customForms, setCustomForms] = useState<DocForm[]>([])
  const [formEditor, setFormEditor] = useState<FormEditor | null>(null)
  const [sketching, setSketching] = useState(false)

  /** 미리 넣어 둔 서식과 직접 만든 서식을 함께 다룬다 */
  const allForms = useMemo(() => [...DOC_FORMS, ...customForms], [customForms])
  const form: DocForm | null = allForms.find((f) => f.id === formId) ?? null

  /** 화면에 보일 묶음. 직접 만든 서식이 새 묶음을 만들 수도 있다. */
  const groups = useMemo(() => {
    const out: string[] = [...DOC_GROUPS]
    for (const f of customForms) if (!out.includes(f.group)) out.push(f.group)
    return out
  }, [customForms])

  /** templates 표의 kind 로 문서 이름을 찾는다. 모르는 kind 면 그대로 보여 준다. */
  const kindLabel = (kind: string): string => {
    if (kind === SLOT_KIND) return '빈칸 채우기 서식'
    return allForms.find((f) => f.id === kind)?.name ?? kind
  }

  const loadTemplates = useCallback(async () => {
    const list = await window.api.templates.list()
    setTemplates(list)
    setOffIds((prev) => prev.filter((id) => list.some((t) => t.id === id)))
  }, [])

  const loadHwp = useCallback(async (): Promise<HwpForm[]> => {
    const list = await window.api.hwp.list()
    setHwpForms(list)
    return list
  }, [])

  const loadCustomForms = useCallback(async () => {
    const rows = await window.api.setting.byPrefix(CUSTOM_PREFIX)
    const parsed: DocForm[] = []
    for (const r of rows) {
      const f = parseCustomForm(r.key, r.value)
      if (f) parsed.push(f)
    }
    setCustomForms(parsed)
  }, [])

  useEffect(() => {
    void (async () => {
      await loadTemplates()
      await loadCustomForms()
      await loadHwp()
      const s = await window.api.local.load()
      setHasKey(!!(s.openai_key || s.gemini_key || s.claude_key || s.exaone_key))
    })()
  }, [loadTemplates, loadCustomForms, loadHwp])

  // 이름 목록이 바뀌면 가명을 다시 매긴다.
  useEffect(() => {
    void (async () => {
      const valid = names.filter((n) => n.name.trim())
      setAliases(valid.length ? await window.api.privacy.aliases(valid) : [])
    })()
  }, [names])

  /** 이 문서 종류로 저장해 둔 예시 */
  const myExamples = useMemo(
    () => templates.filter((t) => t.kind === formId),
    [templates, formId]
  )

  /** 이 문서 종류로 저장해 둔 예시 가운데, 끄지 않은 것 */
  const exampleIds = useMemo(
    () => myExamples.filter((t) => !offIds.includes(t.id)).map((t) => t.id),
    [myExamples, offIds]
  )

  const allText = (): string => Object.values(values).join('\n')

  /** 이 문서의 양식으로 묶어 둔 한글 양식을 앞에, 나머지를 뒤에 */
  const linkedForms = useMemo(() => hwpForms.filter((f) => f.doc_kind === formId), [hwpForms, formId])
  const otherForms = useMemo(() => hwpForms.filter((f) => f.doc_kind !== formId), [hwpForms, formId])
  const hwpForm = hwpForms.find((f) => f.id === hwpId) ?? null
  const directForm = direct ? (hwpForms.find((f) => f.id === direct.id) ?? null) : null
  const docName = (id: string): string => allForms.find((f) => f.id === id)?.name ?? ''

  /* ---------- 문서 종류 고르기 ---------- */

  const chooseForm = (f: DocForm): void => {
    setFormId(f.id)
    setValues({})
    setResult('')
    setShowPreview(false)
    setShowNames(!!f.personal)
    // 이 종류로 넣어 둔 예시는 모두 켠 채로 시작한다. 넣어 둔 이유가 쓰려는 것이기 때문이다.
    setOffIds([])
    // 이 문서의 한글 양식을 묶어 두었으면 그 모양으로 만드는 것이 먼저다
    const linked = hwpForms.find((h) => h.doc_kind === f.id)
    setUseHwp(!!linked)
    setHwpId(linked?.id ?? hwpForms[0]?.id ?? null)
    setComposeKey(0)
    setPourId(null)
    setPourKey(0)
    setPersonal([])
    setDirect(null)
  }

  const backToList = (): void => {
    setFormId('')
    setResult('')
    setFormEditor(null)
    setDirect(null)
    setComposeKey(0)
    setPourKey(0)
  }

  /** 문서 종류 없이 양식 하나로 바로 만든다 */
  const openDirect = (f: HwpForm, method: Method = 'AI'): void => {
    setFormId('')
    setFormEditor(null)
    setResult('')
    setDirect({ id: f.id, method })
    setMode('만들기')
  }

  /** 한글 양식을 넣는다. 문서를 고른 채면 그 문서의 양식으로 묶고 곧바로 고른다. */
  const addHwp = async (docKind?: string): Promise<void> => {
    const res = await pickHwpForms(toast, docKind)
    if (!res.ids.length) return
    setPersonal(res.personal)
    await loadHwp()
    if (docKind) {
      setHwpId(res.ids[0])
      setUseHwp(true)
    }
  }

  /* ---------- 가명처리 ---------- */

  const findNames = async (): Promise<void> => {
    const text = allText()
    // 학번도 함께 가린다. 이름만 가려도 학번이 남으면 누구인지 알 수 있다.
    const [found, ids] = await Promise.all([
      window.api.privacy.candidates(text),
      window.api.privacy.ids(text)
    ])
    const rows: NameRow[] = [
      ...found.map((n) => ({ name: n, role: '학생' })),
      ...ids.map((n) => ({ name: n, role: '학번' }))
    ]
    if (!rows.length) {
      toast('이름으로 보이는 것을 찾지 못했습니다. 직접 넣어 주세요.', 'err')
      return
    }
    setNames((prev) => {
      const have = new Set(prev.map((n) => n.name))
      return [...prev, ...rows.filter((r) => !have.has(r.name))]
    })
    toast(`${rows.length}개를 찾았습니다. 역할을 확인해 주세요.`, 'ok')
  }

  const buildPreview = async (): Promise<void> => {
    setPreview(await window.api.privacy.mask(allText(), aliases))
    setShowPreview(true)
  }

  /* ---------- 만들기 ---------- */

  const missing = form
    ? form.fields.filter((f) => f.required && !(values[f.key] ?? '').trim()).map((f) => f.label)
    : []

  const generate = async (): Promise<void> => {
    if (!form) return
    if (missing.length) {
      toast(`${missing.join(', ')} 을(를) 적어 주세요.`, 'err')
      return
    }
    setBusy(true)
    setResult('')
    try {
      const res = await window.api.docdraft.generate({
        form,
        values,
        exampleIds,
        aliases,
        model: model ?? undefined
      })
      if (!res.ok) {
        toast(res.error ?? '만들지 못했습니다.', 'err')
        return
      }
      setResult(res.text)
      toast('초안을 만들었습니다. 반드시 검토 후 사용하세요.', 'ok')
    } finally {
      setBusy(false)
    }
  }

  /** 채운 칸을 "이름: 내용" 으로 이어 붙인다. 양식으로 만들 때 AI 에게 넘길 글이다. */
  const valuesText = (): string => {
    if (!form) return ''
    return form.fields
      .map((f) => {
        const v = (values[f.key] ?? '').trim()
        if (!v) return ''
        return v.includes('\n') ? `${f.label}:\n${v}` : `${f.label}: ${v}`
      })
      .filter(Boolean)
      .join('\n')
  }

  /** 양식으로 만들 때 AI 에게 알려 줄 문서 종류와 쓰는 법 */
  const guideText = (): string => {
    if (!form) return ''
    return [
      `문서: ${form.name}${form.summary ? ` — ${form.summary}` : ''}`,
      `들어가는 항목(참고): ${form.outline.join(' / ')}`,
      form.guide ? `쓰는 법: ${form.guide}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  }

  /** 고른 한글 양식의 모양으로 만든다. 묶지 않은 양식이면 이 문서의 양식으로 묶어 둔다. */
  const composeHwp = async (): Promise<void> => {
    if (!form || !hwpForm) return
    if (missing.length) {
      toast(`${missing.join(', ')} 을(를) 적어 주세요.`, 'err')
      return
    }
    if (!hwpForm.doc_kind) {
      await window.api.hwp.link(hwpForm.id, form.id)
      await loadHwp()
      toast(`'${hwpForm.name}' 을(를) ${form.name} 양식으로 묶어 두었습니다. 다음부터 먼저 골라집니다.`, 'ok')
    }
    setComposeContent(valuesText())
    setComposeKey((k) => k + 1)
  }

  /** 결과에 이름을 붙일 때 쓸 대표 값 — 제목·사안명 같은 첫 한 줄짜리 칸 */
  const resultName = (): string => {
    if (!form) return '문서'
    const head = form.fields.find((f) => !f.lines && (values[f.key] ?? '').trim())
    const label = head ? values[head.key].trim().slice(0, 40) : ''
    return label ? `${form.name}_${label}` : form.name
  }

  const saveResult = async (): Promise<void> => {
    const res = await window.api.docdraft.save({ name: resultName(), text: result })
    toast(res.message, res.ok ? 'ok' : 'err')
  }

  /** 양식 없이 한글 문서(.hwpx)로 저장한다. 한글 기본 모양으로 나온다. */
  const saveAsHwp = async (): Promise<void> => {
    const res = await window.api.hwp.newDoc({ name: resultName(), text: result })
    toast(res.message, res.ok ? 'ok' : 'err')
    if (res.ok && res.path) await window.api.hwp.open(res.path)
  }

  /** 만든 초안을 학교 한글 양식에 옮겨 담는다. 이 문서의 양식이 있으면 그것부터 고른다. */
  const toHwpForm = (): void => {
    if (!hwpForms.length) {
      toast('넣어 둔 한글 양식이 없습니다. 위 [1. 어떤 모양으로 만들까요?] 의 [＋ 한글 양식 넣기] 로 넣어 주세요.', 'err')
      return
    }
    setPourId(linkedForms[0]?.id ?? hwpForms[0]?.id ?? null)
    setPourKey(0)
  }

  /** 만든 것을 다음에 쓸 예시로 남긴다. 쓸수록 다음 문서가 이 학교 형식에 가까워진다. */
  const keepAsExample = async (): Promise<void> => {
    if (!form) return
    await window.api.templates.add({
      name: `${form.name} ${todayStr()}`,
      kind: form.id,
      content: result,
      added_at: todayStr()
    })
    await loadTemplates()
    toast('예시로 넣었습니다. 실명이 들어 있으면 지워 주세요.', 'ok')
  }

  /* ---------- 예시 ---------- */

  const openExampleEditor = (kind: string): void => {
    setEditing({ ...BLANK_TEMPLATE, kind, added_at: todayStr() })
    setEditingId(null)
  }

  const pickExampleFile = async (): Promise<void> => {
    if (!editing) return
    const picked = await window.api.files.pick()
    if (!picked.length) return
    setReading(true)
    try {
      const parts: string[] = []
      for (const p of picked) {
        const doc = await window.api.files.extract(p.path)
        if (doc.error) toast(`${p.name}: ${doc.error}`, 'err')
        else if (doc.text.trim()) parts.push(doc.text)
      }
      if (parts.length) {
        setEditing((e) =>
          e
            ? {
                ...e,
                name: e.name || picked[0].name.replace(/\.[^.]+$/, ''),
                content: [e.content, ...parts].filter(Boolean).join('\n\n')
              }
            : e
        )
        toast(`${parts.length}개 문서에서 읽어 왔습니다.`, 'ok')
      }
    } finally {
      setReading(false)
    }
  }

  const saveExample = async (): Promise<void> => {
    if (!editing || !editing.name.trim() || !editing.content.trim()) {
      toast('이름과 내용을 모두 적어 주세요.', 'err')
      return
    }
    if (editingId === null) await window.api.templates.add(editing)
    else await window.api.templates.update(editingId, editing)
    setEditing(null)
    setEditingId(null)
    await loadTemplates()
    toast('예시를 저장했습니다.', 'ok')
  }

  const removeExample = async (id: number): Promise<void> => {
    await window.api.templates.remove(id)
    await loadTemplates()
  }

  /**
   * 예시에서 개인정보를 싹 가린다.
   *
   * 예시는 **형식**을 보여 주려고 넣는 것이라 이름·연락처가 필요 없다.
   * 되돌리지 않고 아예 ○○○ 으로 덮으므로, 실명이 든 문서도 안심하고
   * 넣어 둘 수 있다. (예시는 인수인계 파일에 함께 넘어간다)
   */
  const scrubExample = async (): Promise<void> => {
    if (!editing?.content.trim()) {
      toast('먼저 내용을 붙여넣어 주세요.', 'err')
      return
    }
    const res = await window.api.privacy.scrub(editing.content)
    setEditing({ ...editing, content: res.text })
    if (!res.hits.length) {
      toast('가릴 개인정보를 찾지 못했습니다. 눈으로 한 번 더 확인해 주세요.')
      return
    }
    toast(`${res.hits.map((h) => `${h.label} ${h.n}`).join(', ')} 을(를) 가렸습니다.`, 'ok')
  }

  /* ---------- 직접 만든 서식 ---------- */

  const openFormEditor = (base?: DocForm): void => {
    if (!base) {
      setFormEditor({ ...BLANK_FORM_EDITOR })
      return
    }
    setFormEditor({
      originalId: base.id,
      name: base.name,
      group: base.group,
      summary: base.summary,
      icon: base.icon,
      outlineText: base.outline.join('\n'),
      fieldText: fieldLines(base.fields),
      guide: base.guide,
      personal: !!base.personal,
      sample: ''
    })
  }

  /** 붙여넣은 예시를 AI 에 보내 항목과 칸을 뽑아낸다 */
  const sketchFromSample = async (): Promise<void> => {
    if (!formEditor) return
    if (!formEditor.sample.trim()) {
      toast('먼저 예시 문서를 붙여넣어 주세요.', 'err')
      return
    }
    setSketching(true)
    try {
      const res = await window.api.docdraft.extractForm({
        name: formEditor.name,
        sample: formEditor.sample,
        model: model ?? undefined
      })
      if (!res.ok) {
        toast(res.error ?? '서식을 뽑아내지 못했습니다.', 'err')
        return
      }
      setFormEditor((e) =>
        e
          ? {
              ...e,
              outlineText: res.outline.join('\n') || e.outlineText,
              fieldText: fieldLines(res.fields) || e.fieldText,
              guide: res.guide || e.guide
            }
          : e
      )
      toast(`항목 ${res.outline.length}개, 칸 ${res.fields.length}개를 뽑았습니다. 고쳐서 저장하세요.`, 'ok')
    } finally {
      setSketching(false)
    }
  }

  const pickSampleFile = async (): Promise<void> => {
    if (!formEditor) return
    const picked = await window.api.files.pick()
    if (!picked.length) return
    setReading(true)
    try {
      const doc = await window.api.files.extract(picked[0].path)
      if (doc.error) toast(`${picked[0].name}: ${doc.error}`, 'err')
      else
        setFormEditor((e) =>
          e
            ? {
                ...e,
                sample: doc.text,
                name: e.name || picked[0].name.replace(/\.[^.]+$/, '')
              }
            : e
        )
    } finally {
      setReading(false)
    }
  }

  const saveCustomForm = async (): Promise<void> => {
    if (!formEditor) return
    const name = formEditor.name.trim()
    if (!name) {
      toast('문서 이름을 적어 주세요.', 'err')
      return
    }
    const outline = formEditor.outlineText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const fields = parseFieldLines(formEditor.fieldText)
    if (!outline.length) {
      toast('들어갈 항목을 한 줄에 하나씩 적어 주세요.', 'err')
      return
    }
    if (!fields.length) {
      toast('물어볼 칸을 한 줄에 하나씩 적어 주세요.', 'err')
      return
    }

    const id = customId(name)
    if (DOC_FORMS.some((f) => f.id === id)) {
      toast('프로그램에 이미 있는 문서 이름입니다. 다른 이름으로 지어 주세요.', 'err')
      return
    }

    await window.api.setting.set(
      `${CUSTOM_PREFIX}${id}`,
      JSON.stringify({
        name,
        group: formEditor.group.trim() || '직접 만든 서식',
        icon: formEditor.icon || '',
        summary: formEditor.summary.trim(),
        outline,
        guide: formEditor.guide.trim(),
        fields,
        personal: formEditor.personal
      })
    )
    // 이름을 바꿔 저장했으면 예전 것은 지운다
    if (formEditor.originalId && formEditor.originalId !== id) {
      await window.api.setting.set(`${CUSTOM_PREFIX}${formEditor.originalId}`, '')
    }

    setFormEditor(null)
    await loadCustomForms()
    setFormId(id)
    setValues({})
    setResult('')
    toast('서식을 만들었습니다.', 'ok')
  }

  const removeCustomForm = async (f: DocForm): Promise<void> => {
    const ok = await ask({
      title: `'${f.name}' 서식을 지울까요?`,
      body: '이 서식으로 만들어 둔 문서 파일은 그대로 남습니다.',
      okText: '지우기',
      danger: true
    })
    if (!ok) return
    await window.api.setting.set(`${CUSTOM_PREFIX}${f.id}`, '')
    if (formId === f.id) setFormId('')
    await loadCustomForms()
    toast(`'${f.name}' 서식을 지웠습니다.`)
  }

  /* ---------- 빈칸 채우기 서식 ---------- */

  const slotTemplate = templates.find((t) => t.id === slotTemplateId) ?? null

  const slotNames = (() => {
    if (!slotTemplate) return []
    const found = [...slotTemplate.content.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1])
    return [...new Set(found.map((s) => s.trim()))]
  })()

  const filledForm = (() => {
    if (!slotTemplate) return ''
    return slotTemplate.content.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, key: string) => {
      const v = slots[key.trim()]
      return v && v.trim() ? v : `(${key.trim()})`
    })
  })()

  /* ---------- 예시 편집칸 (여러 곳에서 쓴다) ---------- */

  const exampleEditor = editing && (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <div className="row" style={{ gap: 12 }}>
        <div className="field" style={{ flex: 2, minWidth: 180 }}>
          <label>예시 이름</label>
          <input
            type="text"
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            placeholder="예: 2025학년도 우리 학교 표준 서식"
          />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 170 }}>
          <label>어떤 문서의 예시인가</label>
          <select
            value={editing.kind}
            onChange={(e) => setEditing({ ...editing, kind: e.target.value })}
          >
            <option value="">— 고르세요 —</option>
            {allForms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
            <option value={SLOT_KIND}>빈칸 채우기 서식</option>
          </select>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 6 }}>
        <button className="btn btn-sm" onClick={() => void pickExampleFile()} disabled={reading}>
          {reading ? '읽는 중…' : '파일에서 불러오기'}
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => void scrubExample()}
          disabled={!editing.content.trim()}
          title="이름·연락처·주민등록번호·학번·주소를 ○○○ 으로 덮습니다"
        >
          개인정보 가리기
        </button>
        <span className="muted small">한글·워드·PDF·엑셀에서 글을 뽑아 옵니다</span>
      </div>

      <div className="note note-info" style={{ marginBottom: 10 }}>
        예시는 <b>형식만</b> 쓰이므로 이름이 없어도 됩니다. <b>[개인정보 가리기]</b> 를 누르면
        이름 · 연락처 · 주민등록번호 · 학번 · 주소를 <code>○○○</code> 으로 덮습니다. 되돌릴 수
        없으니 덮은 뒤 눈으로 한 번 확인하세요 — 완벽하지 않습니다.
      </div>

      <div className="field">
        <label>내용</label>
        <textarea
          value={editing.content}
          onChange={(e) => setEditing({ ...editing, content: e.target.value })}
          style={{ minHeight: 200 }}
          placeholder={
            editing.kind === SLOT_KIND
              ? '바뀌는 자리를 {{학생명}} {{일시}} 처럼 두 겹 중괄호로 감싸 주세요.'
              : '한글에서 복사해 붙여넣으세요.'
          }
        />
      </div>
      <div className="row row-end">
        <button className="btn btn-ghost" onClick={() => setEditing(null)}>
          취소
        </button>
        <button className="btn btn-primary" onClick={() => void saveExample()}>
          저장
        </button>
      </div>
    </div>
  )

  /* ---------- 화면 ---------- */

  return { onGo, toast, ask, mode, setMode, templates, setTemplates, hasKey, setHasKey, model, setModel, formId, setFormId, values, setValues, offIds, setOffIds, result, setResult, busy, setBusy, hwpForms, setHwpForms, useHwp, setUseHwp, hwpId, setHwpId, composeKey, setComposeKey, composeContent, setComposeContent, pourId, setPourId, pourKey, setPourKey, personal, setPersonal, direct, setDirect, directContent, setDirectContent, names, setNames, aliases, setAliases, preview, setPreview, showPreview, setShowPreview, showNames, setShowNames, editing, setEditing, editingId, setEditingId, reading, setReading, slotTemplateId, setSlotTemplateId, slots, setSlots, customForms, setCustomForms, formEditor, setFormEditor, sketching, setSketching, allForms, form, groups, kindLabel, loadTemplates, loadHwp, loadCustomForms, myExamples, exampleIds, allText, linkedForms, otherForms, hwpForm, directForm, docName, chooseForm, backToList, openDirect, addHwp, findNames, buildPreview, missing, generate, valuesText, guideText, composeHwp, resultName, saveResult, saveAsHwp, toHwpForm, keepAsExample, openExampleEditor, pickExampleFile, saveExample, removeExample, scrubExample, openFormEditor, sketchFromSample, pickSampleFile, saveCustomForm, removeCustomForm, slotTemplate, slotNames, filledForm, exampleEditor }
}

export type CommitteeState = ReturnType<typeof useCommittee>
