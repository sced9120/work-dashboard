import { useCallback, useEffect, useState } from 'react'
import type { FormFillResult, FormLayout, HwpForm } from '../../shared/hwpform'
import type { AliasPair, ModelChoice } from '../../shared/types'
import type { PageId } from '../App'
import { queueChat } from '../lib/chatBridge'
import { useConfirm } from '../lib/confirm'
import { useToast } from '../lib/toast'
import { todayStr } from '../lib/util'
import FormFillCard from './FormFillCard'
import ModelPicker from './ModelPicker'

/**
 * 학교에서 실제로 쓰는 한글 양식(.hwp/.hwpx).
 *
 * - HwpFormShelf: 넣어 둔 양식을 보관·정리한다. 양식마다 어느 문서(회의록·가정통신문 …)의 양식인지 묶어 둔다.
 * - HwpFormMaker: 양식 하나를 골라 새 한글 문서를 만든다(AI 로 쓰기 / 빈칸만 직접 채우기).
 * 문서 종류를 고른 뒤 양식으로 만드는 길은 학교 문서 만들기(Committee.tsx)가 FormFillCard 로 바로 한다.
 */

export type Method = '직접' | 'AI'

/** 긴 글을 적는 칸인지. 라벨로 어림한다. */
const LONG_LABEL = /내용|개요|의견|경위|사유|결과|협의|심의|요지|비고|기타/

function kb(n: number): string {
  return n < 1024 ? `${n}B` : `${Math.round(n / 1024)}KB`
}

export interface PersonalWarn {
  name: string
  found: string[]
}

/**
 * 한글 양식 파일을 골라 넣는다. docKind 를 주면 그 문서의 양식으로 묶는다.
 * 넣은 양식의 id 와, 이름·번호로 보이는 글자가 든 양식을 돌려준다.
 */
export async function pickHwpForms(
  toast: (msg: string, kind?: 'ok' | 'err') => void,
  docKind?: string
): Promise<{ ids: number[]; personal: PersonalWarn[] }> {
  const res = await window.api.hwp.add(docKind)
  for (const e of res.errors) toast(e, 'err')
  if (res.added.length) toast(`양식 ${res.added.length}개를 넣었습니다.`, 'ok')
  return {
    ids: res.added.map((a) => a.id),
    personal: res.added.filter((a) => a.personal.length).map((a) => ({ name: a.name, found: a.personal }))
  }
}

/** 넣은 양식에 지난번 이름이 남아 있을 때 알린다 */
export function PersonalNote({ list, onClose }: { list: PersonalWarn[]; onClose: () => void }): JSX.Element | null {
  if (!list.length) return null
  return (
    <div className="note note-warn" style={{ marginBottom: 10 }}>
      <b>양식에 이름·번호로 보이는 글자가 있습니다.</b> 지난번에 쓴 문서를 그대로 넣으셨다면, 한글에서 이름을
      지운 뒤 다시 넣는 것이 좋습니다. 인수인계 파일로 다음 담당자에게 넘어가기 때문입니다.
      {list.map((p) => (
        <div key={p.name} className="small" style={{ marginTop: 4 }}>
          · {p.name}: {p.found.join(', ')}
        </div>
      ))}
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn btn-sm" onClick={onClose}>
          확인했습니다
        </button>
      </div>
    </div>
  )
}

/* ══════════ 보관함 ══════════ */

interface ShelfProps {
  /** 묶을 수 있는 문서 종류 (문서 만들기의 문서 목록) */
  docs: { id: string; name: string }[]
  /** 양식을 넣거나 지우거나 묶었을 때 */
  onChanged?: () => void
  /** [이 양식으로 만들기] */
  onUse?: (f: HwpForm) => void
}

export function HwpFormShelf({ docs, onChanged, onUse }: ShelfProps): JSX.Element {
  const toast = useToast()
  const ask = useConfirm()
  const [forms, setForms] = useState<HwpForm[]>([])
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null)
  const [personal, setPersonal] = useState<PersonalWarn[]>([])

  const load = useCallback(async () => {
    setForms(await window.api.hwp.list())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const changed = async (): Promise<void> => {
    await load()
    onChanged?.()
  }

  const add = async (): Promise<void> => {
    const res = await pickHwpForms(toast)
    if (!res.ids.length) return
    setPersonal(res.personal)
    await changed()
  }

  const remove = async (f: HwpForm): Promise<void> => {
    const ok = await ask({
      title: `'${f.name}' 양식을 지울까요?`,
      body: '이 프로그램에 넣어 둔 사본만 지워집니다. 원래 파일은 그대로 있습니다.',
      okText: '지우기',
      danger: true
    })
    if (!ok) return
    await window.api.hwp.remove(f.id)
    await changed()
  }

  const saveName = async (): Promise<void> => {
    if (!renaming) return
    const name = renaming.name.trim()
    if (name) await window.api.hwp.rename(renaming.id, name)
    setRenaming(null)
    await changed()
  }

  const link = async (f: HwpForm, docKind: string): Promise<void> => {
    await window.api.hwp.link(f.id, docKind)
    await changed()
    const doc = docs.find((d) => d.id === docKind)
    toast(doc ? `'${f.name}' 을(를) ${doc.name} 양식으로 묶었습니다.` : `'${f.name}' 을(를) 묶지 않은 양식으로 두었습니다.`, 'ok')
  }

  return (
    <div className="card">
      <div className="card-title">
        <span>📑 한글 양식 파일</span>
        <button className="btn btn-sm btn-primary" onClick={() => void add()}>
          ＋ 한글 양식 넣기
        </button>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        학교에서 쓰는 한글 파일(.hwp · .hwpx)을 넣고 <b>어느 문서의 양식인지</b> 골라 두세요. 그 문서를 만들 때 이 양식의{' '}
        <b>글꼴·문단 모양·구성 그대로</b> 새 한글 파일이 나옵니다. 넣어 둔 양식은 바뀌지 않고, 인수인계 파일에 함께
        넘어갑니다.
      </p>

      <PersonalNote list={personal} onClose={() => setPersonal([])} />

      {forms.length === 0 ? (
        <div className="empty">
          아직 넣어 둔 양식이 없습니다. 가정통신문·회의록·의견서처럼 자주 쓰는 한글 파일을 넣어 보세요.
        </div>
      ) : (
        <div className="list">
          {forms.map((f) => (
            <div className="item" key={f.id}>
              <div className="item-head">
                {renaming?.id === f.id ? (
                  <input
                    type="text"
                    value={renaming.name}
                    autoFocus
                    onChange={(e) => setRenaming({ id: f.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveName()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    onBlur={() => void saveName()}
                  />
                ) : (
                  <div style={{ minWidth: 0 }}>
                    <div className="item-title">{f.name}</div>
                    <div className="item-meta">
                      .{f.kind} · {kb(f.size)} · {f.added_at}
                    </div>
                  </div>
                )}
                <div className="row">
                  <select
                    className="shelf-link"
                    value={docs.some((d) => d.id === f.doc_kind) ? f.doc_kind : ''}
                    onChange={(e) => void link(f, e.target.value)}
                    title="이 양식으로 만드는 문서"
                  >
                    <option value="">— 어느 문서의 양식인가 —</option>
                    {docs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  {onUse && (
                    <button className="btn btn-sm" onClick={() => onUse(f)}>
                      이 양식으로 만들기
                    </button>
                  )}
                  <button className="btn btn-sm btn-ghost" onClick={() => setRenaming({ id: f.id, name: f.name })}>
                    이름 바꾸기
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => void remove(f)}>
                    삭제
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ══════════ 양식 하나로 만들기 ══════════ */

interface MakerProps {
  form: HwpForm
  /** AI 로 쓸 때 담을 내용 */
  content: string
  onContent: (text: string) => void
  /** 같은 사람은 같은 가명으로 보낸다 */
  aliases: AliasPair[]
  hasKey: boolean
  onGo: (p: PageId) => void
  /** 처음 열 방법 */
  method?: Method
}

/**
 * 양식 하나를 틀로 새 한글 문서를 만든다.
 * AI 로 쓰기(양식의 글꼴·문단 모양·구성을 틀로) 와, 인터넷 없이 {{칸}}·빈 표 칸만 채우기 두 가지.
 */
export function HwpFormMaker({ form, content, onContent, aliases, hasKey, onGo, method: first }: MakerProps): JSX.Element {
  const toast = useToast()
  const [layout, setLayout] = useState<FormLayout | null>(null)
  const [method, setMethod] = useState<Method>(first ?? 'AI')

  const [slotValues, setSlotValues] = useState<Record<string, string>>({})
  const [blankValues, setBlankValues] = useState<Record<string, string>>({})

  const [model, setModel] = useState<ModelChoice | null>(null)
  /** [AI로 새 문서 쓰기] 를 누를 때마다 늘려서 확인 카드를 새로 그린다 */
  const [runKey, setRunKey] = useState(0)
  const [runContent, setRunContent] = useState('')

  const [fileName, setFileName] = useState(`${form.name}_${todayStr()}`)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<FormFillResult | null>(null)

  useEffect(() => {
    let alive = true
    setLayout(null)
    setRunKey(0)
    setResult(null)
    setSlotValues({})
    setBlankValues({})
    setFileName(`${form.name}_${todayStr()}`)
    void (async () => {
      const l = await window.api.hwp.layout({ id: form.id })
      if (!alive) return
      setLayout(l)
      if (!l.ok) toast(l.error ?? '양식을 읽지 못했습니다.', 'err')
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.id])

  useEffect(() => {
    if (first) setMethod(first)
  }, [first])

  /** 업무 도우미로 가서 말로 부탁한다. 입력칸에 첫 마디를 적어 둔다. */
  const toChat = (): void => {
    queueChat(`「${form.name}」 양식에 맞춰 한글 파일을 만들어 줘.\n`)
    onGo('도우미')
  }

  const blanks = layout?.blanks ?? []
  const slots = layout?.slots ?? []

  const saveDirect = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await window.api.hwp.fillSlots({
        ref: { id: form.id },
        values: slotValues,
        blanks: blankValues,
        name: fileName
      })
      setResult(res)
      toast(res.message, res.ok ? 'ok' : 'err')
    } finally {
      setBusy(false)
    }
  }

  const runAi = (): void => {
    if (!content.trim()) {
      toast('새 문서에 담을 내용을 적어 주세요.', 'err')
      return
    }
    setRunContent(content)
    setRunKey((k) => k + 1)
  }

  const multiLineHwp = form.kind === 'hwp' && Object.values(blankValues).some((v) => v.includes('\n'))

  if (!layout) return <div className="card muted small">양식을 읽는 중…</div>
  if (!layout.ok) return <div className="note note-danger">{layout.error ?? '양식을 읽지 못했습니다.'}</div>

  return (
    <>
      <div className="card">
        <div className="card-title">
          <span>만들기</span>
          <div className="row">
            {method === '직접' && (
              <span className="badge">
                {'{{칸}}'} {slots.length}개 · 빈칸 {blanks.length}개
              </span>
            )}
            {hasKey && (
              <button className="btn btn-sm" onClick={toChat} title="업무 도우미로 가서 말로 부탁합니다">
                💬 도우미와 대화로 만들기
              </button>
            )}
          </div>
        </div>

        <div className="tabs" style={{ marginBottom: 12 }}>
          <button className={`tab ${method === 'AI' ? 'active' : ''}`} onClick={() => setMethod('AI')}>
            AI와 새 문서 만들기
          </button>
          <button className={`tab ${method === '직접' ? 'active' : ''}`} onClick={() => setMethod('직접')}>
            빈칸만 직접 채우기 (인터넷 안 씀)
          </button>
        </div>

        {method === '직접' && (
          <>
            <div className="note note-ok" style={{ marginBottom: 12 }}>
              <b>이 PC 안에서만 채웁니다.</b> 실명을 그대로 적으셔도 됩니다. 양식에 <code>{'{{학생명}}'}</code> 처럼
              적어 둔 자리와, 라벨 옆의 빈 표 칸을 채울 수 있습니다.
            </div>

            {slots.length === 0 && blanks.length === 0 && (
              <div className="note note-warn" style={{ marginBottom: 12 }}>
                이 양식에는 채울 자리가 보이지 않습니다. 한글에서 양식을 열어 바뀌는 곳에 <code>{'{{학생명}}'}</code>{' '}
                <code>{'{{일시}}'}</code> 처럼 적어 저장한 뒤 다시 넣거나, <b>[AI와 새 문서 만들기]</b> 를 써 보세요.
              </div>
            )}

            {slots.map((name) => (
              <div className="field" key={`s-${name}`}>
                <label>{`{{${name}}}`}</label>
                <input
                  type="text"
                  value={slotValues[name] ?? ''}
                  onChange={(e) => setSlotValues((v) => ({ ...v, [name]: e.target.value }))}
                  placeholder={`${name} 을(를) 입력하세요`}
                />
              </div>
            ))}

            {blanks.length > 0 && (
              <div className="muted small" style={{ margin: '4px 0 8px' }}>
                빈칸 — 비워 두면 양식 그대로 둡니다
              </div>
            )}
            {blanks.map((b) => (
              <div className="field" key={b.id}>
                <label>
                  {b.label} <span className="muted small">({b.id})</span>
                </label>
                {LONG_LABEL.test(b.label ?? '') ? (
                  <textarea
                    value={blankValues[b.id] ?? ''}
                    onChange={(e) => setBlankValues((v) => ({ ...v, [b.id]: e.target.value }))}
                    style={{ minHeight: 120 }}
                  />
                ) : (
                  <input
                    type="text"
                    value={blankValues[b.id] ?? ''}
                    onChange={(e) => setBlankValues((v) => ({ ...v, [b.id]: e.target.value }))}
                  />
                )}
              </div>
            ))}

            {multiLineHwp && (
              <div className="note note-warn" style={{ marginTop: 12 }}>
                .hwp 양식의 한 칸에 여러 줄을 넣으면 줄 끝까지 글자 사이가 벌어져 보일 수 있습니다. 그럴 땐 한글에서 그
                칸을 고른 뒤 <b>[왼쪽 정렬]</b> 을 누르세요. 양식을 한글에서 <b>[다른 이름으로 저장 → HWPX]</b> 로 한 번
                바꿔 넣어 두면 줄마다 문단이 나뉘어 이런 일이 없습니다.
              </div>
            )}

            {slots.length + blanks.length > 0 && (
              <div className="row" style={{ marginTop: 14 }}>
                <div className="field" style={{ flex: 1, minWidth: 220, marginBottom: 0 }}>
                  <label>저장할 파일 이름</label>
                  <input type="text" value={fileName} onChange={(e) => setFileName(e.target.value)} />
                </div>
                <button
                  className="btn btn-primary"
                  style={{ alignSelf: 'flex-end' }}
                  onClick={() => void saveDirect()}
                  disabled={busy}
                >
                  {busy ? '만드는 중…' : `💾 한글 파일로 저장 (.${form.kind})`}
                </button>
              </div>
            )}
          </>
        )}

        {method === 'AI' && (
          <>
            <div className="field">
              <label>새 문서에 담을 내용</label>
              <textarea
                value={content}
                onChange={(e) => onContent(e.target.value)}
                style={{ minHeight: 200 }}
                placeholder={
                  '예) 제10회 학생선도위원회 / 2026. 10. 7.(수) 16:30 / 학교운영위원회실\n' +
                  '사안: 수업 중 휴대전화 사용 3회\n' +
                  '글로 만든 초안을 그대로 붙여넣어도 됩니다.'
                }
              />
              <div className="hint">
                내용만 적으면 AI 가 양식의 구성(제목·항목·표)을 따라 새 문서를 쓰고, 글꼴·문단 모양은 양식 그대로 입힙니다.
                항목 수가 양식과 달라도 되고, 모르는 자리를 ( ) 로 비워 두지 않습니다. 인사말·안내 문구처럼 늘 같은 글은
                양식 그대로 살립니다.
                <br />
                AI 에게는 파일이 아니라 <b>양식의 문단·표 모습</b>만 보냅니다. 보내기 전에 이름·학번은 가명으로 바꾸고,
                양식에 남아 있던 이름은 ○○○ 으로 가립니다. 받아서 다시 실명으로 되돌립니다.
              </div>
            </div>

            {hasKey ? (
              <>
                <ModelPicker feature="scenario" label="새 문서 쓰기에 쓸 모델" onReady={setModel} onChange={setModel} />
                <div className="row" style={{ marginBottom: 12 }}>
                  <button className="btn btn-primary" onClick={runAi} disabled={!content.trim()}>
                    {runKey ? '🤖 다시 쓰기' : '🤖 AI로 새 문서 쓰기'}
                  </button>
                </div>
              </>
            ) : (
              <div className="note note-warn" style={{ marginBottom: 12 }}>
                API 키가 필요합니다.{' '}
                <button className="link" onClick={() => onGo('설정')}>
                  설정으로
                </button>
              </div>
            )}

            {runKey > 0 && (
              <FormFillCard
                key={runKey}
                form={{ id: form.id }}
                formName={form.name}
                kind={form.kind}
                content={runContent}
                fileName={fileName}
                model={model}
                aliases={aliases}
              />
            )}
          </>
        )}
      </div>

      {method === '직접' && result && (
        <div className="card">
          <div className="card-title">
            <span>결과</span>
            {result.path && (
              <div className="row">
                <button className="btn btn-sm btn-primary" onClick={() => void window.api.hwp.open(result.path ?? '')}>
                  한글로 열기
                </button>
                <button className="btn btn-sm" onClick={() => void window.api.hwp.reveal(result.path ?? '')}>
                  폴더 열기
                </button>
              </div>
            )}
          </div>
          <div className={`note ${result.ok ? 'note-ok' : 'note-warn'}`}>
            {result.ok ? `${result.applied}곳을 바꿔 저장했습니다.` : result.message}
            {result.path && <div className="small" style={{ marginTop: 4 }}>{result.path}</div>}
          </div>
          {result.missed.length > 0 && (
            <div className="note note-warn">
              <b>이 자리는 바꾸지 못했습니다. 한글에서 직접 고쳐 주세요.</b> 글상자·머리말 안의 글이나 특수한 칸은
              서식을 지키려고 건드리지 않습니다.
              {result.missed.map((m) => (
                <div key={m.id} className="small" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
                  · {m.label}: {m.text.length > 80 ? `${m.text.slice(0, 80)}…` : m.text}
                </div>
              ))}
            </div>
          )}
          <div className="note note-info">
            <b>반드시 한글에서 열어 확인하세요.</b> 글자가 칸을 넘치거나 쪽이 늘어나는 것은 한글에서만 보입니다.
          </div>
        </div>
      )}
    </>
  )
}
