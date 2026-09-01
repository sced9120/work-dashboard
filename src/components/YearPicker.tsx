import { currentSchoolYear, schoolYearLabel } from '../../shared/types'

interface Props {
  value: number
  onChange: (year: number) => void
  label?: string
  hint?: string
  /** "학년도 미지정" 을 고를 수 있게 할지 */
  allowNone?: boolean
  /** 목록에 반드시 넣을 학년도들 (자료가 남아 있는 해) */
  extra?: number[]
}

/**
 * 학년도 고르개.
 *
 * 올해를 가운데 두고 앞뒤로 몇 해씩 보여 준다.
 * 전임자에게 받은 묵은 공문을 학습시킬 때 지난 해로 바꿀 수 있어야 하고,
 * 미리 만들어 두는 자료는 다음 해로 매길 수 있어야 한다.
 */
export default function YearPicker({
  value,
  onChange,
  label = '학년도',
  hint,
  allowNone,
  extra = []
}: Props): JSX.Element {
  const now = currentSchoolYear()
  const years = new Set<number>([now + 1, now, now - 1, now - 2, now - 3])
  for (const y of extra) if (y) years.add(y)
  if (value) years.add(value)
  const list = [...years].sort((a, b) => b - a)

  return (
    <div className="field" style={{ maxWidth: 340 }}>
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {allowNone && <option value={0}>{schoolYearLabel(0)}</option>}
        {list.map((y) => (
          <option key={y} value={y}>
            {schoolYearLabel(y)}
            {y === now ? ' · 올해' : ''}
          </option>
        ))}
      </select>
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}
