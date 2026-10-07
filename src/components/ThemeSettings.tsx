import { MODES, THEMES, resolvedMode, setUiPrefs, useUiPrefs } from '../lib/theme'

/**
 * 설정 → 화면 테마. 고르는 즉시 바뀐다.
 * 이 PC(이 창)에만 저장하고 인수인계 파일로는 넘기지 않는다 — 받는 사람은 자기 취향대로 고른다.
 */
export default function ThemeSettings(): JSX.Element {
  const ui = useUiPrefs()
  const shown = resolvedMode(ui)

  return (
    <div className="card theme-card">
      <div className="card-title">
        <span>🎨 화면 테마</span>
        <span className="muted small">이 PC에만 저장됩니다 · 인수인계 파일로 넘어가지 않습니다</span>
      </div>

      <div className="theme-picks" role="radiogroup" aria-label="테마">
        {THEMES.map((t) => {
          const on = ui.theme === t.id
          return (
            <button
              key={t.id}
              role="radio"
              aria-checked={on}
              className={`theme-pick ${on ? 'on' : ''}`}
              onClick={() => setUiPrefs({ theme: t.id })}
            >
              <span className="theme-prev" data-prev={t.id} data-prev-mode={shown} aria-hidden="true">
                <i className="tp-side" />
                <i className="tp-a" />
                <i className="tp-b" />
                <i className="tp-c" />
                <i className="tp-d" />
              </span>
              <span className="theme-name">
                {t.name}
                {on && <span className="theme-on">쓰는 중</span>}
              </span>
              <span className="theme-desc">{t.desc}</span>
            </button>
          )
        })}
      </div>

      <div className="field theme-field">
        <label>밝기</label>
        <div className="theme-seg" role="radiogroup" aria-label="밝기">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={ui.mode === m.id}
              className={ui.mode === m.id ? 'on' : ''}
              onClick={() => setUiPrefs({ mode: m.id })}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="hint">
          {ui.mode === 'system'
            ? `지금 윈도우가 ${shown === 'dark' ? '어두운' : '밝은'} 모드라 ${shown === 'dark' ? '어둡게' : '밝게'} 보입니다.`
            : '윈도우 설정과 상관없이 고른 밝기로 보입니다.'}{' '}
          내 시간표 그림과 발표자료 미리보기는 출력물 모양을 그대로 보여 주려고 늘 원래 색으로 둡니다.
        </div>
      </div>

      <label className="theme-check">
        <input type="checkbox" checked={ui.navCollapsed} onChange={(e) => setUiPrefs({ navCollapsed: e.target.checked })} />
        <span>
          왼쪽 메뉴를 아이콘만 남기고 접어 두기
          <small>메뉴 옆 동그라미 단추로도 접고 펼 수 있습니다.</small>
        </span>
      </label>
    </div>
  )
}
