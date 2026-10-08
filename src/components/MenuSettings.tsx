import { useEffect, useRef, useState } from 'react'
import type { PageId } from '../App'
import type { NavItem } from '../lib/nav'
import { AI_ITEM, DATA_ITEM, FIXED_PAGES, NAV, getNavPrefs, isShown, linkUrl, orderedNav, setNavPrefs, takeMenuEdit, useNavPrefs } from '../lib/nav'
import { useToast } from '../lib/toast'
import Icon from './Icon'

/**
 * 설정 → 왼쪽 메뉴. 안 쓰는 메뉴는 끄고, 묶음 안에서 차례를 바꾸고, 자주 가는 누리집을 바로가기로 더한다.
 * 이 PC 에만 저장한다(src/lib/nav.ts). 꺼 둔 메뉴도 화면은 그대로 있다.
 */
export default function MenuSettings(): JSX.Element {
  const nav = useNavPrefs()
  const toast = useToast()
  const boxRef = useRef<HTMLDivElement>(null)
  const [flash, setFlash] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')

  // 왼쪽 메뉴의 [메뉴 편집] 으로 왔으면 이 카드로 내려 준다
  useEffect(() => {
    const go = (): void => {
      if (!takeMenuEdit()) return
      window.setTimeout(() => {
        boxRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
        setFlash(true)
        window.setTimeout(() => setFlash(false), 1600)
      }, 60)
    }
    go()
    window.addEventListener('wd:menu-edit', go)
    return () => window.removeEventListener('wd:menu-edit', go)
  }, [])

  const toggle = (id: PageId, on: boolean): void => {
    const hidden = getNavPrefs().hidden.filter((h) => h !== id)
    setNavPrefs({ hidden: on ? hidden : [...hidden, id] })
  }

  const move = (section: string, items: NavItem[], i: number, d: number): void => {
    const j = i + d
    if (j < 0 || j >= items.length) return
    const ids = items.map((x) => x.id)
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    setNavPrefs({ order: { ...getNavPrefs().order, [section]: ids } })
  }

  const moveLink = (i: number, d: number): void => {
    const links = [...getNavPrefs().links]
    const j = i + d
    if (j < 0 || j >= links.length) return
    ;[links[i], links[j]] = [links[j], links[i]]
    setNavPrefs({ links })
  }

  const addLink = (): void => {
    const n = name.trim()
    const u = linkUrl(url.trim().replace(/^(?!https?:\/\/)(?=[\w-]+\.)/i, 'https://'))
    if (!n) return toast('바로가기 이름을 적어 주세요.', 'err')
    if (!u) return toast('주소는 https:// 로 시작하는 누리집 주소로 적어 주세요.', 'err')
    const links = getNavPrefs().links
    if (links.length >= 30) return toast('바로가기는 30개까지 둘 수 있습니다.', 'err')
    setNavPrefs({ links: [...links, { id: `l${Date.now().toString(36)}`, name: n.slice(0, 30), url: u, icon: '' }] })
    setName('')
    setUrl('')
    toast(`「${n}」 바로가기를 왼쪽 메뉴에 더했습니다.`, 'ok')
  }

  const row = (it: NavItem, extra?: JSX.Element): JSX.Element => {
    const fixed = FIXED_PAGES.includes(it.id)
    const on = isShown(nav, it.id)
    return (
      <div className={`menu-row ${on ? '' : 'off'}`} key={it.id}>
        <span className="menu-ico">
          <Icon name={it.icon} size={16} />
        </span>
        <span className="menu-name">{it.label}</span>
        {extra}
        <label className="menu-toggle" title={fixed ? '늘 보이는 메뉴입니다' : undefined}>
          <input type="checkbox" checked={on} disabled={fixed} onChange={(e) => toggle(it.id, e.target.checked)} />
          <span>{fixed ? '늘 보임' : on ? '보임' : '꺼짐'}</span>
        </label>
      </div>
    )
  }

  const hiddenCount = nav.hidden.length
  const changed = hiddenCount > 0 || Object.keys(nav.order).length > 0

  return (
    <div className={`card menu-card ${flash ? 'flash' : ''}`} id="menu-settings" ref={boxRef}>
      <div className="card-title">
        <span>🧭 왼쪽 메뉴</span>
        <span className="muted small">이 PC에만 저장됩니다 · 인수인계 파일로 넘어가지 않습니다</span>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        안 쓰는 메뉴는 끄고, ↑ ↓ 로 묶음 안의 차례를 바꿉니다. 꺼 둔 메뉴도 화면은 그대로 있어서 홈 위젯이나 검색에서 들어갈 수
        있고, 언제든 다시 켤 수 있습니다.
      </p>

      <div className="menu-cols">
        <div className="menu-group">
          <div className="menu-sec">맨 위 · 맨 아래</div>
          {row(AI_ITEM)}
          {row(DATA_ITEM)}
          {row({ id: '설정', icon: 'sliders', label: '설정 (내 이름 칸)' })}
        </div>

        {orderedNav(nav).map((g) => (
          <div className="menu-group" key={g.section}>
            <div className="menu-sec">{g.section}</div>
            {g.items.map((it, i) =>
              row(
                it,
                <span className="menu-move">
                  <button className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => move(g.section, g.items, i, -1)} aria-label={`${it.label} 위로`}>
                    ↑
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={i === g.items.length - 1} onClick={() => move(g.section, g.items, i, 1)} aria-label={`${it.label} 아래로`}>
                    ↓
                  </button>
                </span>
              )
            )}
          </div>
        ))}

        <div className="menu-group menu-links">
          <div className="menu-sec">바로가기</div>
          {nav.links.length === 0 && (
            <p className="small muted" style={{ margin: '2px 0 8px' }}>
              자주 가는 누리집(나이스 · 업무포털 · 에듀파인 등)을 왼쪽 메뉴에 둡니다. [도구 모음]에서 📌 메뉴에 고정한 도구도
              여기 들어옵니다.
            </p>
          )}
          {nav.links.map((l, i) => (
            <div className="menu-row" key={l.id}>
              <span className="menu-ico">{l.icon || <Icon name="link" size={16} />}</span>
              <span className="menu-name">
                {l.name}
                <small>{l.tool ? '도구 모음에서 고정' : l.url}</small>
              </span>
              <span className="menu-move">
                <button className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => moveLink(i, -1)} aria-label={`${l.name} 위로`}>
                  ↑
                </button>
                <button className="btn btn-ghost btn-sm" disabled={i === nav.links.length - 1} onClick={() => moveLink(i, 1)} aria-label={`${l.name} 아래로`}>
                  ↓
                </button>
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setNavPrefs({ links: getNavPrefs().links.filter((x) => x.id !== l.id) })
                  toast(`「${l.name}」 바로가기를 뺐습니다.`, 'ok')
                }}
              >
                빼기
              </button>
            </div>
          ))}
          <div className="menu-add">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 (예: 나이스)" maxLength={30} />
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addLink()
              }}
              placeholder="주소 (예: https://gne.neis.go.kr)"
            />
            <button className="btn btn-sm" onClick={addLink}>
              <Icon name="plus" size={14} /> 더하기
            </button>
          </div>
        </div>
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <span className="small muted">
          {hiddenCount > 0 ? `꺼 둔 메뉴 ${hiddenCount}개` : '모든 메뉴가 보입니다'} · 메뉴 {NAV.reduce((n, g) => n + g.items.length, 0) + 3}개
        </span>
        <span className="spacer" />
        {changed && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setNavPrefs({ hidden: [], order: {} })
              toast('메뉴를 처음 차례로 되돌리고 모두 켰습니다. 바로가기는 그대로 둡니다.', 'ok')
            }}
          >
            ↺ 메뉴 처음대로
          </button>
        )}
      </div>
    </div>
  )
}
