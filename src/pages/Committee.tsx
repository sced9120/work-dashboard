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

interface Props {
  onGo: (p: PageId) => void
}

interface NameRow {
  name: string
  role: string
}

/**
 * 만들기: 문서를 고르고 → 모양(우리 학교 한글 양식 / 글 초안)을 고르고 → 내용을 채워 만든다.
 * 보관함: 한글 양식 파일과 글 예시를 넣어 두고 어느 문서의 것인지 묶는다.
 * 서식: {{칸}} 만 채우는 글 서식 (인터넷 안 씀).
 */
type Mode = '만들기' | '서식' | '보관함'

const BLANK_TEMPLATE: TemplateInput = { name: '', kind: '', content: '', added_at: '' }

/** 직접 만드는 서식을 화면에서 편집할 때 담아 두는 값 */
interface FormEditor {
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

const BLANK_FORM_EDITOR: FormEditor = {
  originalId: '',
  name: '',
  group: '직접 만든 서식',
  summary: '',
  icon: '📃',
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
function parseFieldLines(text: string): DocField[] {
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
function fieldLines(fields: DocField[]): string {
  return fields
    .map((f) => `${f.label}${f.required ? ' *' : ''}${f.lines ? ' ...' : ''}`)
    .join('\n')
}

export default function Committee({ onGo }: Props): JSX.Element {
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
      setHasKey(!!(s.openai_key || s.gemini_key || s.claude_key))
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
        icon: formEditor.icon || '📃',
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
          {reading ? '읽는 중…' : '📄 파일에서 불러오기'}
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => void scrubExample()}
          disabled={!editing.content.trim()}
          title="이름·연락처·주민등록번호·학번·주소를 ○○○ 으로 덮습니다"
        >
          🧹 개인정보 가리기
        </button>
        <span className="muted small">한글·워드·PDF·엑셀에서 글을 뽑아 옵니다</span>
      </div>

      <div className="note note-info" style={{ marginBottom: 10 }}>
        예시는 <b>형식만</b> 쓰이므로 이름이 없어도 됩니다. <b>[🧹 개인정보 가리기]</b> 를 누르면
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
          ✍ 문서 만들기
        </button>
        <button className={`tab ${mode === '보관함' ? 'active' : ''}`} onClick={() => setMode('보관함')}>
          🗂 양식 · 예시 보관함
          {hwpForms.length + templates.length > 0 && (
            <span className="badge" style={{ marginLeft: 6 }}>
              {hwpForms.length + templates.length}
            </span>
          )}
        </button>
        <button className={`tab ${mode === '서식' ? 'active' : ''}`} onClick={() => setMode('서식')}>
          📄 빈칸 채우기 (AI 안 씀)
        </button>
        <button
          className="tab tab-link"
          onClick={() => onGo('도우미')}
          title="업무 도우미에게 말로 부탁해 문서를 만듭니다. 넣어 둔 한글 양식에 맞춰 파일로도 만들어 줍니다."
        >
          💬 도우미와 대화로 만들기
        </button>
      </div>

      {/* ══════════ 문서 만들기 ══════════ */}
      {mode === '만들기' && !form && !directForm && (
        <>
          <div className="note note-info" style={{ marginBottom: 14 }}>
            <b>양식이 없어도 됩니다.</b> 문서마다 들어갈 항목을 프로그램이 알고 있어서, 내용만 채우면 바로
            나옵니다. 학교에서 쓰던 한글 파일이 있으면 <b>[🗂 양식 · 예시 보관함]</b> 에 넣고 어느 문서의 양식인지
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
                        <span className="pickcard-icon">{f.icon}</span>
                        <span className="pickcard-body">
                          <span className="pickcard-name">{f.name}</span>
                          <span className="pickcard-sum">{f.summary || '직접 만든 서식'}</span>
                        </span>
                        <span className="pickcard-badges">
                          {isCustom(f) && <span className="badge">내가 만든</span>}
                          {h > 0 && <span className="badge badge-accent">📑 양식 {h}</span>}
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
              <span>📑 우리 학교 한글 양식으로 바로 만들기</span>
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
                    <span className="pickcard-icon">📑</span>
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

      {/* ── 문서 종류 만들기 · 고치기 ── */}
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
            <div className="field" style={{ width: 90 }}>
              <label>아이콘</label>
              <input
                type="text"
                value={formEditor.icon}
                onChange={(e) => setFormEditor({ ...formEditor, icon: e.target.value })}
                maxLength={4}
              />
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
                {reading ? '읽는 중…' : '📄 파일에서 불러오기'}
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => void sketchFromSample()}
                disabled={sketching || !hasKey || !formEditor.sample.trim()}
              >
                {sketching ? '뽑는 중…' : '✨ 예시에서 서식 뽑기'}
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

      {mode === '만들기' && form && (
        <>
          <div className="card">
            <div className="card-title">
              <span>
                {form.icon} {form.name}
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
                      🗑 서식 지우기
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
                  <span className="look-name">📑 저장된 우리 학교 한글 양식으로</span>
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
                  <span className="look-name">📝 글로 초안 만들기</span>
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
                    🔍 이름 자동 찾기
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
                    👁 전송될 내용 확인
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
                  {composeKey ? '🤖 다시 만들기' : `📑 「${hwpForm.name}」 모양으로 만들기`}
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
                    📋 복사
                  </button>
                  <button className="btn btn-sm" onClick={() => void keepAsExample()}>
                    📚 예시로 남기기
                  </button>
                  <button className="btn btn-sm" onClick={() => void saveResult()} title="메모장에서 열리는 .txt 파일">
                    💾 텍스트로 저장
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => void saveAsHwp()}
                    title="양식 없이 한글 기본 모양(.hwpx)으로 저장합니다"
                  >
                    📄 한글 파일로
                  </button>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={toHwpForm}
                    title="넣어 둔 학교 한글 양식의 모양으로 이 글을 새 한글 문서로 만듭니다"
                  >
                    📑 학교 양식에 담기
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
                <span>📑 학교 한글 양식에 담기</span>
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
                  {pourKey ? '🤖 다시 담기' : '🤖 이 양식에 담기'}
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

      {/* ══════════ 양식 하나로 바로 만들기 ══════════ */}
      {mode === '만들기' && !form && directForm && (
        <>
          <div className="card">
            <div className="card-title">
              <span>
                📑 {directForm.name}
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
              이 양식 하나를 틀로 새 한글 문서를 만듭니다. 문서 종류에 묶어 두려면 <b>[🗂 양식 · 예시 보관함]</b> 에서
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

      {/* ══════════ 빈칸 채우기 ══════════ */}
      {mode === '서식' && (
        <>
          <div className="note note-ok" style={{ marginBottom: 14 }}>
            <b>이 기능은 인터넷을 쓰지 않습니다.</b> 서식에 <code>{'{{학생명}}'}</code> 처럼 적어
            두면 그 자리를 채워 넣기만 합니다. 입력한 내용이 이 PC 밖으로 나가지 않으므로 실명을
            그대로 쓰셔도 됩니다.
            <div style={{ marginTop: 6 }}>
              한글 양식 파일의 빈칸을 인터넷 없이 채우려면 <b>[✍ 문서 만들기]</b> 아래쪽{' '}
              <b>[📑 우리 학교 한글 양식으로 바로 만들기]</b> 에서 양식을 고른 뒤 <b>[빈칸만 직접 채우기]</b> 를
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
                      📋 복사
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
                      💾 파일로 저장
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

      {/* ══════════ 양식 · 예시 보관함 ══════════ */}
      {mode === '보관함' && (
        <HwpFormShelf
          docs={allForms.map((f) => ({ id: f.id, name: f.name }))}
          onChanged={() => void loadHwp()}
          onUse={(f) => openDirect(f)}
        />
      )}
      {mode === '보관함' && (
        <div className="card">
          <div className="card-title">
            <span>📚 글 예시</span>
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
