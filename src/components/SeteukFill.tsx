import { FILL_MAX, FILL_MIN, FILL_STEP } from '../../shared/seteuk'

/**
 * 분량 수직선 — 한도의 50~100%를 5% 단위로. 눈금 위 숫자와 지금 바이트를 함께 보인다.
 * '메모가 짧으면 짧게' 를 켜면 그 비율을 넘지 않는 선에서 메모 양을 따른다.
 */
interface Props {
  fill: number
  limit: number
  short: boolean
  onFill: (v: number) => void
  onShort: (v: boolean) => void
}

const TICKS = [50, 60, 70, 80, 90, 100]

export default function SeteukFill({ fill, limit, short, onFill, onShort }: Props): JSX.Element {
  const target = Math.round((limit * fill) / 100)
  return (
    <div className="stk-fill">
      <div className="stk-fill-head">
        <span>분량</span>
        <b>
          한도의 {fill}% · {target}바이트
        </b>
        <span className="muted">(한글 약 {Math.floor(target / 3)}자)</span>
      </div>
      <input
        type="range"
        min={FILL_MIN}
        max={FILL_MAX}
        step={FILL_STEP}
        value={fill}
        onChange={(e) => onFill(Number(e.target.value))}
        aria-label="분량 — 한도의 몇 퍼센트"
        aria-valuetext={`한도의 ${fill}퍼센트, ${target}바이트`}
        style={{ ['--fill' as string]: `${((fill - FILL_MIN) / (FILL_MAX - FILL_MIN)) * 100}%` }}
      />
      <div className="stk-fill-ticks" aria-hidden="true">
        {TICKS.map((t) => (
          <button key={t} type="button" className={t === fill ? 'on' : ''} onClick={() => onFill(t)} tabIndex={-1}>
            {t}%
          </button>
        ))}
      </div>
      <label className="stk-agree small">
        <input type="checkbox" checked={short} onChange={(e) => onShort(e.target.checked)} />
        메모가 짧으면 짧게 쓰기 <span className="muted">— 이 분량을 넘지 않는 선에서 메모 양을 따릅니다</span>
      </label>
    </div>
  )
}
