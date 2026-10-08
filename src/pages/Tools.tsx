import { useEffect, useMemo, useState } from 'react'
import type { CatalogTool } from '../../shared/catalog'
import { isNewTool } from '../../shared/catalog'
import Icon from '../components/Icon'
import { loadCatalog, markToolsSeen, todayStr, useCatalog } from '../lib/catalog'
import { getNavPrefs, setNavPrefs, useNavPrefs } from '../lib/nav'
import { useToast } from '../lib/toast'

/**
 * 도구 모음 — 만든이가 저장소의 remote/catalog.json 에 올려 두는 선생님용 도구(세특 도우미 등).
 * 새 도구는 프로그램을 업데이트하지 않아도 여기 생긴다. 도구는 브라우저로 열고,
 * 이 프로그램의 자료는 도구로 보내지 않는다.
 */
export default function Tools(): JSX.Element {
  const cat = useCatalog()
  const nav = useNavPrefs()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [group, setGroup] = useState('전체')
  const tools = cat.catalog.tools
  const today = todayStr()

  // 열 때마다 3시간이 지났으면 새로 받는다
  useEffect(() => {
    void loadCatalog()
  }, [])

  // 이 화면을 봤으면 왼쪽 메뉴의 ● 는 지운다
  useEffect(() => {
    markToolsSeen(tools)
  }, [tools])

  const groups = useMemo(() => ['전체', ...Array.from(new Set(tools.map((t) => t.category)))], [tools])
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return tools.filter((t) => {
      if (group !== '전체' && t.category !== group) return false
      const hay = `${t.name} ${t.desc} ${t.category} ${t.tags.join(' ')} ${t.by}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [tools, q, group])

  const pinned = (t: CatalogTool): boolean => nav.links.some((l) => l.tool === t.id)

  const togglePin = (t: CatalogTool): void => {
    const links = getNavPrefs().links
    if (links.some((l) => l.tool === t.id)) {
      setNavPrefs({ links: links.filter((l) => l.tool !== t.id) })
      toast(`「${t.name}」을(를) 왼쪽 메뉴에서 뺐습니다.`, 'ok')
      return
    }
    setNavPrefs({ links: [...links, { id: `tool-${t.id}`, name: t.name, url: t.url, icon: t.icon, tool: t.id }] })
    toast(`「${t.name}」을(를) 왼쪽 메뉴 '바로가기'에 넣었습니다.`, 'ok')
  }

  const refresh = async (): Promise<void> => {
    const r = await loadCatalog(true)
    if (r.from === 'net') toast(`도구 목록을 새로 받았습니다. 도구 ${r.catalog.tools.length}개.`, 'ok')
    else toast(r.error ?? '새로 받지 못했습니다.', 'err')
  }

  const when = cat.fetchedAt
    ? new Date(cat.fetchedAt).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <>
      <div className="page-head">
        <h1>도구 모음</h1>
        <p>
          선생님 일을 덜어 줄 도구를 모아 둡니다(세특 도우미 같은 것). 새 도구가 올라오면 프로그램을 업데이트하지 않아도
          여기에 생기고, 왼쪽 메뉴에 ● 표시가 뜹니다.
        </p>
      </div>

      <div className="card tool-bar">
        <input
          type="text"
          className="tool-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="도구 찾기 — 예: 세특, 생기부, 수업"
        />
        {groups.length > 2 && (
          <div className="tool-groups" role="radiogroup" aria-label="묶음">
            {groups.map((g) => (
              <button key={g} role="radio" aria-checked={group === g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>
                {g}
              </button>
            ))}
          </div>
        )}
        <span className="spacer" />
        <span className="small muted">{when ? `마지막으로 받은 때 ${when}` : '아직 받지 못했습니다'}</span>
        <button className="btn btn-sm" onClick={() => void refresh()} disabled={cat.loading}>
          <Icon name="cycle" size={14} /> {cat.loading ? '받는 중…' : '새로 받기'}
        </button>
      </div>

      {cat.error && cat.from !== 'net' && <div className="note note-warn small">{cat.error}</div>}

      {tools.length === 0 ? (
        <div className="card tool-empty">
          <span className="tool-empty-ico">
            <Icon name="grid" size={28} />
          </span>
          <b>아직 올라온 도구가 없습니다</b>
          <p className="muted small">새 도구가 올라오면 여기와 왼쪽 메뉴에 ● 표시가 뜹니다. 프로그램은 3시간마다 목록을 새로 받습니다.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="card tool-empty">
          <b>「{q}」에 맞는 도구가 없습니다</b>
        </div>
      ) : (
        <div className="tool-grid">
          {shown.map((t) => (
            <div className="tool-card" key={t.id}>
              <div className="tool-top">
                <span className="tool-ico">{t.icon || <Icon name="grid" size={22} />}</span>
                <div className="tool-title">
                  <b>{t.name}</b>
                  <span className="small muted">
                    {t.category}
                    {t.by && ` · ${t.by}`}
                  </span>
                </div>
                {isNewTool(t, today) && <span className="tool-new">새로</span>}
              </div>
              {t.desc && <p className="tool-desc">{t.desc}</p>}
              {t.tags.length > 0 && (
                <div className="tool-tags">
                  {t.tags.map((g) => (
                    <span key={g}>#{g}</span>
                  ))}
                </div>
              )}
              <div className="tool-acts">
                <button className="btn btn-sm btn-primary" onClick={() => void window.api.shell.open(t.url)}>
                  열기 <Icon name="out" size={13} />
                </button>
                <button className={`btn btn-sm ${pinned(t) ? 'tool-pinned' : 'btn-ghost'}`} onClick={() => togglePin(t)}>
                  <Icon name={pinned(t) ? 'check' : 'pin'} size={14} /> {pinned(t) ? '메뉴에 있음' : '메뉴에 고정'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="hint tool-foot">
        도구는 브라우저(크롬 · 엣지)에서 열립니다. 이 프로그램에 정리해 둔 업무 · 학생 자료는 도구로 보내지 않습니다.
      </p>
    </>
  )
}
