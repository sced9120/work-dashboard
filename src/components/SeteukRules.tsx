import { useMemo, useRef, useState } from 'react'
import { RULE_GROUPS, defaultConfig, wordsOf } from '../../shared/seteuk'
import type { SeteukConfig, SeteukMyWord } from '../../shared/seteuk'
import { useConfirm } from '../lib/confirm'
import { useToast } from '../lib/toast'

/**
 * 세특 작성실 — 내 규칙.
 * 정규식이나 프롬프트를 몰라도 되게, 켜고 끄기와 낱말 적기만으로 바꾼다.
 *   ① 쓰는 규칙 — 뺄 수 있는 칸(피할 표현 · 서술 흐름 · 서술 관점)을 끄고, 내 규칙을 한 줄씩 더한다
 *   ② 내 금지어 — 낱말을 쉼표로 적으면 검사에 걸리고, 쓰는 규칙에도 "쓰지 않는다"로 들어간다
 *   ③ 기본 검사 — 기재 금지 · 형식 · AI 말투를 하나씩 켜고 끈다
 * 서술 규칙 · 기재 금지사항 · 분량 · 출력 칸은 2026 기재요령의 틀이라 끌 수 없다.
 * 고친 것은 바로 저장되고, 아래 [쓰는 규칙 미리 보기]에 그대로 보인다.
 */
interface Props {
  config: SeteukConfig
  /** 지금 활동의 쓰는 규칙(설정이 반영된 것) */
  preview: string
  actName: string
  onChange: (c: SeteukConfig) => void
  onClose: () => void
}

const SAVE_DELAY = 600

const SECTIONS: { key: keyof SeteukConfig['sections']; name: string; desc: string }[] = [
  { key: 'frame', name: '서술 흐름', desc: '계기 → 직접 한 과정 → 이어간 탐구 → 결론 순서로 쓰라는 줄 (영역마다 다름)' },
  { key: 'avoid', name: '피할 표현', desc: '"이를 통해", "깊이 있는" 같은 AI 글에 흔한 말투를 쓰지 말라는 줄' },
  { key: 'view', name: '서술 관점', desc: '기록 영역마다 무엇을 중심으로 쓸지 알려 주는 줄' }
]

export default function SeteukRules({ config, preview, actName, onChange, onClose }: Props): JSX.Element {
  const toast = useToast()
  const ask = useConfirm()
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'write' | 'words' | 'checks'>('write')
  const [showPrompt, setShowPrompt] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef(config)
  latest.current = config

  const change = (patch: Partial<SeteukConfig>, now = false): void => {
    const next = { ...latest.current, ...patch }
    latest.current = next
    onChange(next)
    window.clearTimeout(timer.current)
    const save = (): void => void window.api.seteuk.saveConfig(latest.current)
    if (now) save()
    else timer.current = window.setTimeout(save, SAVE_DELAY)
  }

  const off = useMemo(() => new Set(config.off), [config.off])
  const toggleRule = (re: string): void => {
    const next = new Set(off)
    if (next.has(re)) next.delete(re)
    else next.add(re)
    change({ off: [...next] }, true)
  }

  const setMine = (i: number, patch: Partial<SeteukMyWord>): void => change({ mine: config.mine.map((m, k) => (k === i ? { ...m, ...patch } : m)) })
  const addMine = (): void => change({ mine: [...config.mine, { words: '', level: 'check', why: '' }] })

  const reset = async (): Promise<void> => {
    const okk = await ask({ title: '규칙을 처음 설정으로 되돌릴까요?', body: '끈 검사는 모두 다시 켜고, 내 금지어 · 더한 규칙은 지웁니다.', okText: '되돌리기', danger: true })
    if (!okk) return
    change(defaultConfig(), true)
    toast('처음 설정으로 되돌렸습니다.', 'ok')
  }

  const offCount = config.off.length
  const myCount = config.mine.reduce((n, m) => n + wordsOf(m.words).length, 0)
  const ql = q.trim()

  return (
    <section className="card stk-side stk-rules-set">
      <div className="stk-import-head">
        <div className="card-title">내 규칙</div>
        <span className="small muted">
          {offCount ? `끈 검사 ${offCount}개 · ` : ''}
          {myCount ? `내 금지어 ${myCount}개 · ` : ''}
          고치면 바로 저장되고 다음 초안부터 쓰입니다
        </span>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={() => void reset()}>
          처음 설정으로
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          닫기
        </button>
      </div>

      <div className="memo-filter stk-rules-tabs" role="tablist" aria-label="규칙 종류">
        <button role="tab" aria-selected={tab === 'write'} className={tab === 'write' ? 'on' : ''} onClick={() => setTab('write')}>
          쓰는 규칙
        </button>
        <button role="tab" aria-selected={tab === 'words'} className={tab === 'words' ? 'on' : ''} onClick={() => setTab('words')}>
          내 금지어{myCount ? ` ${myCount}` : ''}
        </button>
        <button role="tab" aria-selected={tab === 'checks'} className={tab === 'checks' ? 'on' : ''} onClick={() => setTab('checks')}>
          기본 검사{offCount ? ` · 끔 ${offCount}` : ''}
        </button>
      </div>

      {tab === 'write' && (
        <div className="stk-rules-body">
          <p className="small muted">초안을 쓸 때 AI 에게 주는 규칙입니다. 서술 규칙 · 기재 금지사항 · 분량은 2026 기재요령의 틀이라 늘 들어갑니다.</p>
          {SECTIONS.map((s) => (
            <label key={s.key} className="stk-switch">
              <input type="checkbox" checked={config.sections[s.key]} onChange={(e) => change({ sections: { ...config.sections, [s.key]: e.target.checked } }, true)} />
              <span>
                <b>{s.name}</b>
                <small>{s.desc}</small>
              </span>
            </label>
          ))}
          <div className="stk-style-label">
            내가 더할 규칙 <span className="muted">한 줄에 하나 — 서술 규칙 끝에 붙습니다</span>
          </div>
          <textarea
            className="stk-extra"
            value={config.extra}
            onChange={(e) => change({ extra: e.target.value })}
            placeholder={'예) 한 문장은 80자를 넘기지 않는다\n예) 수업 차시를 밝히지 않는다'}
            aria-label="내가 더할 규칙"
          />
        </div>
      )}

      {tab === 'words' && (
        <div className="stk-rules-body">
          <p className="small muted">
            쓰지 않을 낱말을 쉼표로 적습니다. 검사에서 걸리고, 쓰는 규칙에도 "선생님이 정한 금지어"로 들어가 AI 가 피합니다. 학교마다 다른 행사 이름 ·
            상투어를 막을 때 씁니다.
          </p>
          {config.mine.map((m, i) => (
            <div key={i} className="stk-myword">
              <input type="text" value={m.words} onChange={(e) => setMine(i, { words: e.target.value })} placeholder="예: 리더십을 발휘함, 열정적, 솔선수범" aria-label={`내 금지어 ${i + 1}`} />
              <select value={m.level} onChange={(e) => setMine(i, { level: e.target.value as 'block' | 'check' })} aria-label="수준">
                <option value="check">확인 — 알리기만</option>
                <option value="block">고침 — 꼭 고치기</option>
              </select>
              <input type="text" value={m.why} onChange={(e) => setMine(i, { why: e.target.value })} placeholder="이유 (보이기만 함)" aria-label="이유" />
              <button className="btn btn-sm btn-ghost" onClick={() => change({ mine: config.mine.filter((_x, k) => k !== i) }, true)} aria-label={`내 금지어 ${i + 1} 빼기`}>
                빼기
              </button>
            </div>
          ))}
          <button className="btn btn-sm" onClick={addMine}>
            ＋ 금지어 줄 더하기
          </button>
          <p className="small muted">"고침"은 나이스 파일을 만들 때 빠지고 자동 고쳐쓰기가 고칩니다. "확인"은 표에 알리기만 합니다.</p>
        </div>
      )}

      {tab === 'checks' && (
        <div className="stk-rules-body">
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="찾기 — 예: 대회, 쉼표, 이를 통해" aria-label="검사 찾기" />
          {RULE_GROUPS.map((g) => {
            const rules = g.rules.filter((r) => !ql || r.label.includes(ql) || (r.why ?? '').includes(ql) || r.re.includes(ql) || (r.fix ?? '').includes(ql))
            if (!rules.length) return null
            const allOn = rules.every((r) => !off.has(r.re))
            return (
              <div key={g.key} className="stk-rule-group">
                <div className="stk-import-head">
                  <b>{g.name}</b>
                  <span className="small muted">{g.desc}</span>
                  <span className="spacer" />
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      const next = new Set(off)
                      for (const r of rules) (allOn ? next.add(r.re) : next.delete(r.re))
                      change({ off: [...next] }, true)
                    }}
                  >
                    {allOn ? '모두 끄기' : '모두 켜기'}
                  </button>
                </div>
                <ul className="stk-rule-list">
                  {rules.map((r) => (
                    <li key={r.re} className={off.has(r.re) ? 'off' : ''}>
                      <label className="stk-switch">
                        <input type="checkbox" checked={!off.has(r.re)} onChange={() => toggleRule(r.re)} />
                        <span>
                          <b>
                            {r.label} <span className={`stk-badge ${r.level === 'block' ? 'block' : 'check'}`}>{r.level === 'block' ? '고침' : '확인'}</span>
                          </b>
                          <small>
                            {r.why}
                            {r.fix ? ` → ${r.fix}` : ''}
                          </small>
                          <small className="stk-rule-words">찾는 말: {r.re.replace(/\\[sb]|\(\?[=!<][^)]*\)|[\\^$()[\]?*+{}]/g, '').split('|').slice(0, 8).join(', ')}</small>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}

      <div className="stk-rules-preview">
        <button className="link small" onClick={() => setShowPrompt((v) => !v)} aria-expanded={showPrompt}>
          {showPrompt ? '쓰는 규칙 미리 보기 닫기' : `「${actName}」 쓰는 규칙 미리 보기`}
        </button>
        {showPrompt && (
          <>
            <pre className="stk-rules">{preview}</pre>
            <button
              className="btn btn-sm"
              onClick={() =>
                void (async () => {
                  await window.api.clipboard.write(preview)
                  toast('규칙을 복사했습니다.', 'ok')
                })()
              }
            >
              복사
            </button>
          </>
        )}
      </div>
    </section>
  )
}
