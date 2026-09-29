import { useState } from 'react'
import type { HelpMatch } from '../../shared/helpdocs'

interface Props {
  /** 학교급 (예: 고등학교). 비어 있으면 모든 학교급에서 찾는다 */
  level: string
  /** 적어 둔 내 업무 */
  text: string
  onText: (text: string) => void
  /** 고른 도움자료 id */
  selected: string[]
  onSelected: (ids: string[]) => void
}

/** 이만큼 맞으면 처음부터 골라 둔다 */
const SURE = 0.7

/**
 * 내 업무를 적으면 교육청 학교업무 도움자료 가운데 맞는 것을 찾아 고르게 한다.
 * 처음 설정과 [학교업무 도움자료] 화면이 함께 쓴다. 인터넷 없이 이 PC 안에서 찾는다.
 */
export default function HelpPicker({ level, text, onText, selected, onSelected }: Props): JSX.Element {
  const [matches, setMatches] = useState<HelpMatch[] | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const found = await window.api.help.match(text, level)
      setMatches(found)
      // 또렷이 맞는 것은 골라 둔다. 이미 고른 것은 그대로 두고 더하기만 한다.
      const add = found.flatMap((m) => (m.hits[0] && m.hits[0].score >= SURE ? [m.hits[0].id] : []))
      const next = [...new Set([...selected, ...add])]
      if (next.length !== selected.length) onSelected(next)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string, on: boolean): void => {
    onSelected(on ? [...new Set([...selected, id])] : selected.filter((x) => x !== id))
  }

  const found = matches?.filter((m) => m.hits.length).length ?? 0

  return (
    <div className="help-picker">
      <div className="field">
        <label>내 업무</label>
        <textarea
          value={text}
          onChange={(e) => onText(e.target.value)}
          rows={6}
          placeholder={
            '맡은 일을 한 줄에 하나씩 적거나 업무분장표를 붙여넣으세요.\n\n' +
            '예)\n학교폭력 예방 및 사안처리\n학생 생활교육(선도)\n교육활동보호\n학생자치회 운영'
          }
        />
        <div className="hint">
          줄마다 교육청 <b>학교업무 도움자료</b>(업무흐름도·계획 예시·서식이 든 자료 폴더) 가운데 맞는 것을 찾아
          드립니다. "학폭 · 생기부 · 선도 · 교권" 처럼 줄여 적어도 됩니다. 이 PC 안에서만 찾습니다.
        </div>
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn btn-primary" onClick={() => void run()} disabled={busy || !text.trim()}>
          {busy ? '찾는 중…' : '🔎 맞는 도움자료 찾기'}
        </button>
        {matches && (
          <span className="muted small">
            {matches.length}줄 가운데 {found}줄에 맞는 자료가 있습니다. 또렷이 맞는 것은 골라 두었습니다.
          </span>
        )}
      </div>

      {matches && (
        <div className="help-matches">
          {matches.map((m) => (
            <div className="help-match" key={m.line}>
              <div className="help-match-line">{m.line}</div>
              {m.hits.length === 0 ? (
                <div className="muted small">맞는 자료를 찾지 못했습니다. [🧭 학교업무 도움자료] 에서 직접 고를 수 있습니다.</div>
              ) : (
                m.hits.map((h) => (
                  <label className="help-pick" key={h.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(h.id)}
                      onChange={(e) => toggle(h.id, e.target.checked)}
                    />
                    <span className="help-pick-title">{h.title.replace(/^[\d-]+\.\s*/, '')}</span>
                    <span className="muted small">
                      {h.group} · {h.section.replace(/^\d+\.\s*/, '')} · 자료 {h.fileCount}개
                    </span>
                  </label>
                ))
              )}
            </div>
          ))}
        </div>
      )}

      <div className="muted small" style={{ marginTop: 8 }}>
        고른 업무 <b>{selected.length}</b>개
      </div>
    </div>
  )
}
