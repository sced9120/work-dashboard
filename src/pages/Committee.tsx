import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DocForm } from '../../shared/docforms'
import { DOC_FORMS, DOC_GROUPS, SLOT_KIND, formById } from '../../shared/docforms'
import type { AliasPair, ModelChoice, Template, TemplateInput } from '../../shared/types'
import { ROLES } from '../../shared/types'
import type { PageId } from '../App'
import { useToast } from '../lib/toast'
import { todayStr } from '../lib/util'
import ModelPicker from '../components/ModelPicker'

interface Props {
  onGo: (p: PageId) => void
}

interface NameRow {
  name: string
  role: string
}

type Mode = '만들기' | '서식' | '예시'

const BLANK_TEMPLATE: TemplateInput = { name: '', kind: '', content: '', added_at: '' }

/** templates 표의 kind 로 문서 이름을 찾는다. 모르는 kind 면 kind 를 그대로 보여 준다. */
function kindLabel(kind: string): string {
  if (kind === SLOT_KIND) return '빈칸 채우기 서식'
  return formById(kind)?.name ?? kind
}

export default function Committee({ onGo }: Props): JSX.Element {
  const toast = useToast()

  const [mode, setMode] = useState<Mode>('만들기')
  const [templates, setTemplates] = useState<Template[]>([])
  const [hasKey, setHasKey] = useState(true)
  const [model, setModel] = useState<ModelChoice | null>(null)

  /* 만들기 */
  const [formId, setFormId] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [exampleIds, setExampleIds] = useState<number[]>([])
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)

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

  const form: DocForm | null = formById(formId)

  const loadTemplates = useCallback(async () => {
    const list = await window.api.templates.list()
    setTemplates(list)
    setExampleIds((prev) => prev.filter((id) => list.some((t) => t.id === id)))
  }, [])

  useEffect(() => {
    void (async () => {
      await loadTemplates()
      const s = await window.api.local.load()
      setHasKey(!!(s.openai_key || s.gemini_key || s.claude_key))
    })()
  }, [loadTemplates])

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

  const allText = (): string => Object.values(values).join('\n')

  /* ---------- 문서 종류 고르기 ---------- */

  const chooseForm = (f: DocForm): void => {
    setFormId(f.id)
    setValues({})
    setResult('')
    setShowPreview(false)
    setShowNames(!!f.personal)
    // 이 종류로 넣어 둔 예시는 처음부터 켜 둔다. 넣어 둔 이유가 쓰려는 것이기 때문이다.
    setExampleIds(templates.filter((t) => t.kind === f.id).map((t) => t.id))
  }

  /* ---------- 가명처리 ---------- */

  const findNames = async (): Promise<void> => {
    const found = await window.api.privacy.candidates(allText())
    if (!found.length) {
      toast('이름으로 보이는 것을 찾지 못했습니다. 직접 넣어 주세요.', 'err')
      return
    }
    setNames((prev) => {
      const have = new Set(prev.map((n) => n.name))
      return [...prev, ...found.filter((n) => !have.has(n)).map((n) => ({ name: n, role: '학생' }))]
    })
    toast(`${found.length}개를 찾았습니다. 역할을 확인해 주세요.`, 'ok')
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
        formId: form.id,
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
    const kind = editing.kind
    setEditing(null)
    setEditingId(null)
    await loadTemplates()
    // 지금 만들고 있는 문서의 예시를 새로 넣었으면 바로 켜 준다.
    if (kind === formId) {
      const list = await window.api.templates.list()
      setExampleIds(list.filter((t) => t.kind === kind).map((t) => t.id))
    }
    toast('예시를 저장했습니다.', 'ok')
  }

  const removeExample = async (id: number): Promise<void> => {
    await window.api.templates.remove(id)
    await loadTemplates()
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
            placeholder="예: 2025학년도 선도위 표준 대본"
          />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 170 }}>
          <label>어떤 문서의 예시인가</label>
          <select
            value={editing.kind}
            onChange={(e) => setEditing({ ...editing, kind: e.target.value })}
          >
            <option value="">— 고르세요 —</option>
            {DOC_FORMS.map((f) => (
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
        <span className="muted small">한글·워드·PDF·엑셀에서 글을 뽑아 옵니다</span>
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
          회의록 · 진술서 · 계획서 · 가정통신문을 서식에 맞춰 만듭니다. 예전에 쓰던 문서를 예시로
          넣어 두면 그 형식을 그대로 따릅니다.
        </p>
      </div>

      <div className="tabs">
        <button className={`tab ${mode === '만들기' ? 'active' : ''}`} onClick={() => setMode('만들기')}>
          ✍ 문서 만들기 (AI)
        </button>
        <button className={`tab ${mode === '서식' ? 'active' : ''}`} onClick={() => setMode('서식')}>
          📄 빈칸 채우기 (AI 안 씀)
        </button>
        <button className={`tab ${mode === '예시' ? 'active' : ''}`} onClick={() => setMode('예시')}>
          📚 예시 보관함
          {templates.length > 0 && (
            <span className="badge" style={{ marginLeft: 6 }}>
              {templates.length}
            </span>
          )}
        </button>
      </div>

      {/* ══════════ 문서 만들기 ══════════ */}
      {mode === '만들기' && !form && (
        <>
          <div className="note note-info" style={{ marginBottom: 14 }}>
            <b>예시가 없어도 됩니다.</b> 문서마다 들어갈 항목을 프로그램이 알고 있어서, 내용만
            채우면 바로 나옵니다. 우리 학교 서식이 따로 있으면 <b>[📚 예시 보관함]</b> 에 한 번
            넣어 두세요. 그 뒤로는 그 형식을 그대로 따릅니다.
          </div>

          {DOC_GROUPS.map((g) => (
            <div className="card" key={g}>
              <div className="card-title">{g}</div>
              <div className="pickgrid">
                {DOC_FORMS.filter((f) => f.group === g).map((f) => {
                  const n = templates.filter((t) => t.kind === f.id).length
                  return (
                    <button key={f.id} className="pickcard" onClick={() => chooseForm(f)}>
                      <span className="pickcard-icon">{f.icon}</span>
                      <span className="pickcard-body">
                        <span className="pickcard-name">{f.name}</span>
                        <span className="pickcard-sum">{f.summary}</span>
                      </span>
                      {n > 0 && <span className="badge badge-accent">예시 {n}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </>
      )}

      {mode === '만들기' && form && (
        <>
          <div className="card">
            <div className="card-title">
              <span>
                {form.icon} {form.name}
              </span>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setFormId('')
                  setResult('')
                }}
              >
                ← 다른 문서
              </button>
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

          {/* 1. 내용 */}
          <div className="card">
            <div className="card-title">1. 내용 채우기</div>
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
              비워 둔 칸은 <b>빈칸으로</b> 나옵니다. 프로그램이 지어내지 않습니다.
            </p>
          </div>

          {/* 2. 예시 */}
          <div className="card">
            <div className="card-title">
              <span>2. 우리 학교 예시 (선택)</span>
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
                            setExampleIds((p) =>
                              e.target.checked ? [...p, t.id] : p.filter((x) => x !== t.id)
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

          {/* 3. 가명처리 */}
          <div className="card">
            <div className="card-title">
              <span>3. 가명처리 · 전송 확인</span>
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

          {/* 4. 만들기 */}
          <div className="card">
            <div className="card-title">4. 초안 만들기</div>
            {hasKey && (
              <ModelPicker
                feature="scenario"
                label="문서 생성에 쓸 모델"
                onReady={setModel}
                onChange={setModel}
              />
            )}
            <div className="row">
              <button
                className="btn btn-primary"
                onClick={() => void generate()}
                disabled={busy || !hasKey || missing.length > 0}
              >
                {busy ? '만드는 중…' : `${form.name} 만들기`}
              </button>
              {exampleIds.length > 0 && (
                <span className="badge badge-accent">예시 {exampleIds.length}건을 따릅니다</span>
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

          {result && (
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
                  <button className="btn btn-sm btn-primary" onClick={() => void saveResult()}>
                    💾 파일로 저장
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
        </>
      )}

      {/* ══════════ 빈칸 채우기 ══════════ */}
      {mode === '서식' && (
        <>
          <div className="note note-ok" style={{ marginBottom: 14 }}>
            <b>이 기능은 인터넷을 쓰지 않습니다.</b> 서식에 <code>{'{{학생명}}'}</code> 처럼 적어
            두면 그 자리를 채워 넣기만 합니다. 입력한 내용이 이 PC 밖으로 나가지 않으므로 실명을
            그대로 쓰셔도 됩니다.
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

      {/* ══════════ 예시 보관함 ══════════ */}
      {mode === '예시' && (
        <div className="card">
          <div className="card-title">
            <span>예시 보관함</span>
            <button className="btn btn-sm btn-primary" onClick={() => openExampleEditor('')}>
              ＋ 예시 넣기
            </button>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>
            여기 넣어 둔 문서는 <b>같은 종류의 문서를 만들 때 형식의 본보기</b>로 쓰입니다. 우리
            학교 서식을 한 번 넣어 두면 그 뒤로 계속 그 형식으로 나옵니다.
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
