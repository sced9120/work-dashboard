import { useRef, useState } from 'react'
import type { ModelChoice } from '../../shared/types'
import { SETEUK_STYLE_SAMPLE_MAX, byteLen } from '../../shared/seteuk'
import type { SeteukStyle } from '../../shared/seteuk'
import { useToast } from '../lib/toast'

/**
 * 세특 작성실 — 내 문체.
 * 선생님이 예전에 쓴 세특 몇 편을 넣어 두면 초안이 그 쓰는 방식(문장 길이 · 여는 방식 · 끝맺음)을 따른다.
 * 내용 · 소재는 따르지 않는다. 문체 카드는 그 글들에서 쓰는 방식만 뽑아 적은 것으로, 직접 고쳐도 된다.
 * 켜 두면 교과 · 동아리 · 담임 모든 활동에 쓰인다. 글에 든 학생 이름은 보내기 전에 가린다.
 */
interface Props {
  style: SeteukStyle
  model: ModelChoice | null
  onChange: (next: SeteukStyle) => void
  onClose: () => void
}

const SAVE_DELAY = 700

export default function SeteukStylePanel({ style, model, onChange, onClose }: Props): JSX.Element {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef(style)

  /** 바로 화면에 반영하고, 잠시 뒤 저장한다 */
  const change = (patch: Partial<SeteukStyle>, now = false): void => {
    const next = { ...latest.current, ...patch }
    latest.current = next
    onChange(next)
    window.clearTimeout(timer.current)
    const save = (): void => void window.api.seteuk.saveStyle(latest.current)
    if (now) save()
    else timer.current = window.setTimeout(save, SAVE_DELAY)
  }

  const samples = style.samples.length ? style.samples : ['']
  const setSample = (i: number, text: string): void => {
    const list = [...samples]
    list[i] = text
    change({ samples: list })
  }
  const filled = style.samples.filter((t) => t.trim()).length

  const makeCard = async (dry: boolean): Promise<void> => {
    window.clearTimeout(timer.current)
    // 빈 칸은 빼고 저장한 뒤 그 글로 만든다
    const clean = { ...latest.current, samples: latest.current.samples.map((t) => t.trim()).filter(Boolean) }
    latest.current = clean
    onChange(clean)
    await window.api.seteuk.saveStyle(clean)
    setBusy(true)
    const r = await window.api.seteuk.styleCard(model, dry)
    setBusy(false)
    if (!r.ok) return toast(r.error ?? '문체 카드를 만들지 못했습니다.', 'err')
    if (dry && r.text) {
      await window.api.clipboard.write(r.text)
      return toast('요청 글을 복사했습니다(이름은 가렸습니다). AI 앱에서 받은 답을 아래 [문체 카드] 칸에 붙이세요.', 'ok')
    }
    if (r.card) {
      change({ card: r.card, on: true }, true)
      toast('문체 카드를 만들고 켰습니다. 읽어 보고 다르면 고치세요.', 'ok')
    }
  }

  return (
    <section className="card stk-side stk-style">
      <div className="stk-import-head">
        <div className="card-title">내 문체</div>
        <label className="stk-agree small">
          <input type="checkbox" checked={style.on} onChange={(e) => change({ on: e.target.checked }, true)} />
          초안에 쓰기
        </label>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          닫기
        </button>
      </div>
      <p className="small muted">
        예전에 쓴 세특을 두세 편 넣어 두면 초안이 그 말투를 따릅니다. 내용은 따르지 않고 문장 길이 · 여는 방식 · 끝맺음만 봅니다. 모든 활동에
        쓰이고, 글에 든 학생 이름은 보내기 전에 가립니다.
      </p>

      <div className="stk-style-cols">
        <div>
          <div className="stk-style-label">
            예전에 쓴 세특 <span className="muted">{filled}편 (앞에서 {SETEUK_STYLE_SAMPLE_MAX}편까지 씁니다)</span>
          </div>
          {samples.map((t, i) => (
            <div key={i} className="stk-sample">
              <textarea value={t} onChange={(e) => setSample(i, e.target.value)} placeholder="잘 썼다고 생각하는 세특 한 편을 붙여 넣습니다" aria-label={`예전에 쓴 세특 ${i + 1}`} />
              <div className="stk-under">
                <span className="small muted">{t.trim() ? `${byteLen(t)}바이트` : ''}</span>
                {samples.length > 1 && (
                  <button className="btn btn-sm btn-ghost" onClick={() => change({ samples: samples.filter((_x, k) => k !== i) }, true)}>
                    빼기
                  </button>
                )}
              </div>
            </div>
          ))}
          {samples.length < SETEUK_STYLE_SAMPLE_MAX && (
            <button className="btn btn-sm" onClick={() => change({ samples: [...samples, ''] })}>
              한 편 더
            </button>
          )}
        </div>
        <div>
          <div className="stk-style-label">
            문체 카드 <span className="muted">쓰는 방식만 적은 메모 — 직접 고쳐도 됩니다</span>
          </div>
          <textarea className="stk-card" value={style.card} onChange={(e) => change({ card: e.target.value })} placeholder={'- 한 편은 세 문장 안팎, 문장은 길게 잇는다\n- 활동 이름으로 열고 한 일 → 고친 점 순서로 쓴다\n- "~함", "~하였고 … ~함"으로 끝맺는다'} aria-label="문체 카드" />
          <div className="row">
            <button className="btn btn-primary btn-sm" onClick={() => void makeCard(false)} disabled={busy || filled < 2}>
              {busy ? '만드는 중…' : '세특에서 문체 카드 만들기'}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => void makeCard(true)} disabled={busy || filled < 2} title="AI 키가 없을 때 — 요청 글을 복사해 AI 앱에서 받습니다">
              키 없이 — 요청 글 복사
            </button>
          </div>
          {filled < 2 && <p className="small muted">세특을 두 편 이상 넣으면 만들 수 있습니다. 카드 없이 세특만 넣어 두어도 문체 예시로 쓰입니다.</p>}
        </div>
      </div>
    </section>
  )
}
