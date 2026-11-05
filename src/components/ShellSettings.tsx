import type { ShellId } from '../lib/theme'
import { setUiPrefs, useUiPrefs } from '../lib/theme'

const SHELLS: { id: ShellId; name: string; desc: string }[] = [
  {
    id: 'new',
    name: '새 화면 (기본)',
    desc: '위 탭 셋(오늘 · 이번 주 · 내 업무), [＋ 만들기], 아래 물어보기 바. 오늘 판은 휴대폰 홈 화면처럼 위젯을 길게 눌러 옮기고 크기를 바꿉니다.'
  },
  { id: 'classic', name: '옛 버전 화면', desc: '3.6.3 까지의 왼쪽 메뉴 화면. 홈은 위젯 판 (격자 · 자유 배치).' }
]

/**
 * 설정 → 화면 구성. 고르는 즉시 바뀐다. 자료는 그대로이고 바깥 틀만 바뀐다.
 * 테마와 같이 이 PC 에만 둔다 (인수인계 파일로 넘어가지 않는다).
 */
export default function ShellSettings(): JSX.Element {
  const ui = useUiPrefs()
  return (
    <div className="card shell-card">
      <div className="card-title">
        <span>화면 구성</span>
        <span className="muted small">언제든 다시 바꿀 수 있습니다 · 정리해 둔 자료는 그대로입니다</span>
      </div>
      <div className="theme-picks" role="radiogroup" aria-label="화면 구성">
        {SHELLS.map((s) => {
          const on = ui.shell === s.id
          return (
            <button key={s.id} role="radio" aria-checked={on} className={`theme-pick ${on ? 'on' : ''}`} onClick={() => setUiPrefs({ shell: s.id })}>
              <span className={`shell-prev ${s.id}`} aria-hidden="true">
                <i className="sp-bar" />
                <i className="sp-a" />
                <i className="sp-b" />
                <i className="sp-c" />
                <i className="sp-pill" />
              </span>
              <span className="theme-name">
                {s.name}
                {on && <span className="theme-on">쓰는 중</span>}
              </span>
              <span className="theme-desc">{s.desc}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
