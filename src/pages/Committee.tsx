import { useCallback, useEffect, useState } from 'react'
import type {
  AliasPair,
  CaseDetail,
  ScenarioKind,
  Template,
  TemplateInput
} from '../../shared/types'
import { BLANK_CASE, ROLES } from '../../shared/types'
import type { PageId } from '../App'
import { useToast } from '../lib/toast'

interface Props {
  onGo: (p: PageId) => void
}

interface NameRow {
  name: string
  role: string
}

const BLANK_TEMPLATE: TemplateInput = { name: '', kind: '대본', content: '', added_at: '' }

export default function Committee({ onGo }: Props): JSX.Element {
  const toast = useToast()

  const [templates, setTemplates] = useState<Template[]>([])
  const [picked, setPicked] = useState<number[]>([])
  const [editing, setEditing] = useState<TemplateInput | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)

  const [detail, setDetail] = useState<CaseDetail>(BLANK_CASE)
  const [names, setNames] = useState<NameRow[]>([])
  const [aliases, setAliases] = useState<AliasPair[]>([])
  const [preview, setPreview] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const [hasKey, setHasKey] = useState(true)

  const loadTemplates = useCallback(async () => {
    const list = await window.api.templates.list()
    setTemplates(list)
    setPicked((prev) => prev.filter((id) => list.some((t) => t.id === id)))
  }, [])

  useEffect(() => {
    void (async () => {
      await loadTemplates()
      const s = await window.api.local.load()
      setHasKey(s.provider === 'openai' ? !!s.openai_key : !!s.gemini_key)
    })()
  }, [loadTemplates])

  // 이름 목록이 바뀌면 가명을 다시 매긴다.
  useEffect(() => {
    void (async () => {
      const valid = names.filter((n) => n.name.trim())
      setAliases(valid.length ? await window.api.privacy.aliases(valid) : [])
    })()
  }, [names])

  const set = (patch: Partial<CaseDetail>): void => setDetail((d) => ({ ...d, ...patch }))

  const allCaseText = (d: CaseDetail): string =>
    [d.meetingInfo, d.caseTitle, d.summary, d.statements, d.members, d.expected, d.notes].join('\n')

  const findNames = async (): Promise<void> => {
    const found = await window.api.privacy.candidates(allCaseText(detail))
    if (!found.length) {
      toast('이름으로 보이는 것을 찾지 못했습니다. 직접 넣어 주세요.', 'err')
      return
    }
    setNames((prev) => {
      const have = new Set(prev.map((n) => n.name))
      const added = found.filter((n) => !have.has(n)).map((n) => ({ name: n, role: '학생' }))
      return [...prev, ...added]
    })
    toast(`${found.length}개를 찾았습니다. 역할을 확인해 주세요.`, 'ok')
  }

  const buildPreview = async (): Promise<void> => {
    const masked = await window.api.privacy.mask(allCaseText(detail), aliases)
    setPreview(masked)
    setShowPreview(true)
  }

  const generate = async (): Promise<void> => {
    if (!detail.summary.trim()) {
      toast('사안 개요는 반드시 적어 주세요.', 'err')
      return
    }
    setBusy(true)
    setResult('')
    try {
      const res = await window.api.scenario.generate({
        detail,
        templateIds: picked,
        aliases
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

  const saveTemplate = async (): Promise<void> => {
    if (!editing || !editing.name.trim() || !editing.content.trim()) {
      toast('이름과 내용을 모두 적어 주세요.', 'err')
      return
    }
    if (editingId === null) await window.api.templates.add(editing)
    else await window.api.templates.update(editingId, editing)
    setEditing(null)
    setEditingId(null)
    await loadTemplates()
    toast('본보기를 저장했습니다.', 'ok')
  }

  const saveResult = async (): Promise<void> => {
    const name = `${detail.caseTitle || '선도위원회'}_${detail.kind}`
    const res = await window.api.scenario.save({ name, text: result })
    toast(res.message, res.ok ? 'ok' : 'err')
  }

  return (
    <>
      <div className="page-head">
        <h1>선도위원회 자료 만들기</h1>
        <p>기존 대본·회의록의 형식을 본떠, 새 사안에 맞는 초안을 만듭니다.</p>
      </div>

      <div className="note note-danger" style={{ marginBottom: 14 }}>
        <b>개인정보 안내</b>
        <div style={{ marginTop: 6, lineHeight: 1.6 }}>
          입력한 내용은 AI 회사 서버(OpenAI 또는 구글)로 전송됩니다. 학생 실명은 아래 2번에서
          가명으로 바꾼 뒤 전송되고, 결과에서 다시 실명으로 되돌아옵니다. 치환표는 이 PC에만 있고
          전송되지 않습니다. <b>전송 전에 3번에서 무엇이 나가는지 꼭 확인하세요.</b>
        </div>
      </div>

      {/* 1. 본보기 */}
      <div className="card">
        <div className="card-title">
          <span>1. 형식 본보기 (선택)</span>
          <button
            className="btn btn-sm"
            onClick={() => {
              setEditing({ ...BLANK_TEMPLATE })
              setEditingId(null)
            }}
          >
            ＋ 기존 대본 넣기
          </button>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          예전에 쓰던 대본이나 회의록을 넣어 두면 그 말투와 순서를 그대로 따라갑니다. 두세 건이면
          충분합니다. <b>본보기에는 학생 실명이 없는 것을 넣어 주세요.</b>
        </p>

        {templates.length === 0 ? (
          <div className="empty">아직 등록한 본보기가 없습니다. 없어도 만들 수는 있습니다.</div>
        ) : (
          <div className="list">
            {templates.map((t) => (
              <div className="item" key={t.id}>
                <div className="item-head">
                  <label className="row" style={{ gap: 8, cursor: 'pointer', minWidth: 0 }}>
                    <input
                      type="checkbox"
                      checked={picked.includes(t.id)}
                      onChange={(e) =>
                        setPicked((p) =>
                          e.target.checked ? [...p, t.id] : p.filter((x) => x !== t.id)
                        )
                      }
                      style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div className="item-title">{t.name}</div>
                      <div className="item-meta">
                        {t.kind} · {t.content.length.toLocaleString()}자
                      </div>
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
                      onClick={() =>
                        void (async () => {
                          await window.api.templates.remove(t.id)
                          await loadTemplates()
                        })()
                      }
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {editing && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div className="row" style={{ gap: 12 }}>
              <div className="field" style={{ flex: 2, minWidth: 180 }}>
                <label>본보기 이름</label>
                <input
                  type="text"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="예: 2025학년도 선도위 표준 대본"
                />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 130 }}>
                <label>종류</label>
                <select
                  value={editing.kind}
                  onChange={(e) => setEditing({ ...editing, kind: e.target.value })}
                >
                  <option value="대본">대본</option>
                  <option value="회의록">회의록</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>내용 (한글에서 복사해 붙여넣으세요)</label>
              <textarea
                value={editing.content}
                onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                style={{ minHeight: 200 }}
              />
            </div>
            <div className="row row-end">
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>
                취소
              </button>
              <button className="btn btn-primary" onClick={() => void saveTemplate()}>
                저장
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. 사안 입력 */}
      <div className="card">
        <div className="card-title">2. 사안 정보</div>

        <div className="row" style={{ gap: 12, marginBottom: 4 }}>
          {(['대본', '회의록'] as ScenarioKind[]).map((k) => (
            <button
              key={k}
              className={`btn ${detail.kind === k ? 'btn-primary' : ''}`}
              onClick={() => set({ kind: k })}
            >
              {k === '대본' ? '🎤 진행 대본' : '📝 회의록'}
            </button>
          ))}
        </div>
        <p className="hint">
          {detail.kind === '대본'
            ? '회의 전에 사회자가 읽을 진행 대본을 만듭니다.'
            : '회의가 끝난 뒤 회의록 초안을 만듭니다. 아래 “진행 메모”를 채우면 정확해집니다.'}
        </p>

        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label>회의 정보</label>
            <input
              type="text"
              value={detail.meetingInfo}
              onChange={(e) => set({ meetingInfo: e.target.value })}
              placeholder="예: 제3회 학생선도위원회 / 2026-09-03 15:00 / 본관 회의실"
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label>사안명</label>
            <input
              type="text"
              value={detail.caseTitle}
              onChange={(e) => set({ caseTitle: e.target.value })}
              placeholder="예: 교내 흡연 적발 건"
            />
          </div>
        </div>

        <div className="field">
          <label>사안 개요 *</label>
          <textarea
            value={detail.summary}
            onChange={(e) => set({ summary: e.target.value })}
            placeholder={'언제, 어디서, 무슨 일이 있었는지 사실만 적으세요.\n실명으로 편하게 적으셔도 됩니다. 전송 전에 가명으로 바뀝니다.'}
            style={{ minHeight: 110 }}
          />
        </div>

        <div className="field">
          <label>학생 진술 요지</label>
          <textarea
            value={detail.statements}
            onChange={(e) => set({ statements: e.target.value })}
            placeholder="대상 학생이 확인서나 면담에서 진술한 내용의 요지"
            style={{ minHeight: 90 }}
          />
        </div>

        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label>위원 구성</label>
            <textarea
              value={detail.members}
              onChange={(e) => set({ members: e.target.value })}
              placeholder={'예: 위원장 교감\n생활안전부장\n담임교사\n학부모위원'}
              style={{ minHeight: 90 }}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label>심의 방향 (선택)</label>
            <textarea
              value={detail.expected}
              onChange={(e) => set({ expected: e.target.value })}
              placeholder="참고할 규정 조항, 유사 사례 등. 처분은 위원회가 정하므로 빈칸으로 나옵니다."
              style={{ minHeight: 90 }}
            />
          </div>
        </div>

        {detail.kind === '회의록' && (
          <div className="field">
            <label>진행 메모</label>
            <textarea
              value={detail.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder={'회의 중 적어 둔 메모를 그대로 붙여넣으세요.\n예: 학부모위원 - 재발 방지 서약 필요하다는 의견\n의결: 교내봉사 3일'}
              style={{ minHeight: 110 }}
            />
          </div>
        )}
      </div>

      {/* 3. 가명처리 */}
      <div className="card">
        <div className="card-title">
          <span>3. 가명처리 · 전송 확인</span>
          <button className="btn btn-sm" onClick={() => void findNames()}>
            🔍 이름 자동 찾기
          </button>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          여기 넣은 이름은 전송 직전에 <b>학생A</b> 같은 가명으로 바뀌고, 결과에서 다시 실명으로
          돌아옵니다. 주민등록번호·연락처·반·번호는 자동으로 지워집니다.
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
              아래가 실제로 AI에 전송되는 내용입니다. 실명이 남아 있으면 위에 이름을 추가하세요.
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
      </div>

      {/* 4. 생성 */}
      <div className="card">
        <div className="card-title">4. 초안 만들기</div>
        <div className="row">
          <button
            className="btn btn-primary"
            onClick={() => void generate()}
            disabled={busy || !hasKey || !detail.summary.trim()}
          >
            {busy ? '만드는 중…' : `${detail.kind} 초안 만들기`}
          </button>
          {!hasKey && (
            <span className="muted small">
              API 키가 필요합니다.{' '}
              <button className="link" onClick={() => onGo('설정')}>
                설정으로
              </button>
            </span>
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
              <button className="btn btn-sm btn-primary" onClick={() => void saveResult()}>
                💾 파일로 저장
              </button>
            </div>
          </div>

          <div className="note note-warn">
            <b>그대로 쓰지 마세요.</b> AI가 만든 초안입니다. 사실관계·절차·처분 문구는 반드시 직접
            확인하고 고치신 뒤 사용하세요. 처분 수위는 위원회가 정하는 것이라 빈칸으로 둡니다.
          </div>

          <textarea
            value={result}
            onChange={(e) => setResult(e.target.value)}
            style={{ minHeight: 420, marginTop: 10, fontFamily: 'inherit', lineHeight: 1.7 }}
          />
        </div>
      )}
    </>
  )
}
