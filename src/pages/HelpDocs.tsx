import { useCallback, useEffect, useMemo, useState } from 'react'
import type { HelpCatalog, HelpGroupId, HelpHit, HelpItem } from '../../shared/helpdocs'
import { LEVEL_KEY, MY_HELP_KEY, levelGroup, parseMine } from '../../shared/helpdocs'
import type { PageId } from '../App'
import HelpPicker from '../components/HelpPicker'
import { queueChat } from '../lib/chatBridge'
import { useToast } from '../lib/toast'

interface Props {
  onGo: (p: PageId) => void
}

/** 파일 이름 앞의 "03. " 같은 번호를 떼고, 확장자를 따로 */
function fileParts(name: string): { ext: string; label: string } {
  const m = name.match(/\.([A-Za-z0-9]+)$/)
  return { ext: m ? m[1].toLowerCase() : '', label: name.replace(/\.[A-Za-z0-9]+$/, '') }
}

const plainTitle = (t: string): string => t.replace(/^[\d-]+\.\s*/, '')

/**
 * 교육청 학교업무 도움자료. 업무마다 업무흐름도·계획 예시·서식이 든 자료 폴더로 이어진다.
 * 목록은 프로그램 안에 들어 있고(인터넷 없이 찾기), 파일은 [자료 폴더] 를 눌러 교육청 자료실에서 받는다.
 */
export default function HelpDocs({ onGo }: Props): JSX.Element {
  const toast = useToast()
  const [catalog, setCatalog] = useState<HelpCatalog | null>(null)
  const [level, setLevel] = useState('')
  const [mine, setMine] = useState<string[]>([])
  const [tab, setTab] = useState<HelpGroupId>('secondary')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<HelpHit[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [pickText, setPickText] = useState('')
  const [pickIds, setPickIds] = useState<string[]>([])

  useEffect(() => {
    void (async () => {
      const [c, lv, raw, roster] = await Promise.all([
        window.api.help.catalog(),
        window.api.setting.get(LEVEL_KEY),
        window.api.setting.get(MY_HELP_KEY, '[]'),
        window.api.setting.get('duty_roster')
      ])
      setCatalog(c)
      setLevel(lv)
      setMine(parseMine(raw))
      setTab(levelGroup(lv) ?? 'secondary')
      setPickText(roster)
    })()
  }, [])

  /** id → 항목 */
  const byId = useMemo(() => {
    const m = new Map<string, { item: HelpItem; group: string; section: string }>()
    for (const g of catalog?.groups ?? [])
      for (const s of g.sections) for (const it of s.items) m.set(it.id, { item: it, group: g.label, section: s.title })
    return m
  }, [catalog])

  const saveMine = useCallback(async (ids: string[]) => {
    setMine(ids)
    await window.api.setting.set(MY_HELP_KEY, JSON.stringify(ids))
  }, [])

  const toggleMine = (id: string): void => {
    const on = !mine.includes(id)
    void saveMine(on ? [...mine, id] : mine.filter((x) => x !== id))
    toast(on ? '내 업무에 넣었습니다.' : '내 업무에서 뺐습니다.', 'ok')
  }

  const search = async (): Promise<void> => {
    const q = query.trim()
    if (!q) {
      setHits(null)
      return
    }
    setHits(await window.api.help.search(q, 60))
  }

  const ask = (item: HelpItem): void => {
    queueChat(`「${plainTitle(item.title)}」 업무는 어떤 순서로 처리하면 되나요? 도움자료에서 먼저 볼 파일도 알려 주세요.`)
    onGo('도우미')
  }

  const openPicker = (): void => {
    setPickIds(mine)
    setPicking(true)
  }

  const savePicker = async (): Promise<void> => {
    await saveMine(pickIds)
    setPicking(false)
    toast(`내 업무 ${pickIds.length}개를 저장했습니다.`, 'ok')
  }

  if (!catalog) return <div className="muted">불러오는 중…</div>

  const total = catalog.groups.reduce((s, g) => s + g.sections.reduce((a, x) => a + x.items.length, 0), 0)
  const fileTotal = catalog.groups.reduce(
    (s, g) => s + g.sections.reduce((a, x) => a + x.items.reduce((b, i) => b + i.files.length, 0), 0),
    0
  )
  const group = catalog.groups.find((g) => g.id === tab) ?? catalog.groups[0]

  const row = (item: HelpItem, extra?: { where?: string; matched?: string[] }): JSX.Element => {
    const isOpen = open === item.id
    const flow = item.files.some((f) => f.includes('업무흐름도'))
    const on = mine.includes(item.id)
    return (
      <div className={`help-item ${on ? 'mine' : ''}`} key={item.id}>
        <div className="help-item-head">
          <button
            className={`help-star ${on ? 'on' : ''}`}
            onClick={() => toggleMine(item.id)}
            title={on ? '내 업무에서 빼기' : '내 업무에 넣기'}
          >
            {on ? '★' : '☆'}
          </button>
          <button className="help-item-main" onClick={() => setOpen(isOpen ? null : item.id)}>
            <span className="help-item-title">{item.title}</span>
            <span className="help-item-meta">
              {extra?.where ? `${extra.where} · ` : ''}자료 {item.files.length}개{flow ? ' · 업무흐름도 있음' : ''}
            </span>
          </button>
          <div className="row help-item-acts">
            <button
              className="btn btn-sm"
              onClick={() => void window.api.shell.open(item.url)}
              title="교육청 자료실의 자료 폴더를 브라우저로 엽니다"
            >
              📂 자료 폴더 ↗
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setOpen(isOpen ? null : item.id)}>
              {isOpen ? '접기' : '파일 보기'}
            </button>
          </div>
        </div>
        {!isOpen && extra?.matched && extra.matched.length > 0 && (
          <div className="help-matched">
            {extra.matched.slice(0, 4).map((f) => (
              <span key={f} className="help-chip">
                {fileParts(f).label}
              </span>
            ))}
            {extra.matched.length > 4 && <span className="muted small">외 {extra.matched.length - 4}개</span>}
          </div>
        )}
        {isOpen && (
          <div className="help-files">
            {item.files.map((f) => {
              const { ext, label } = fileParts(f)
              return (
                <div className={`help-file ${extra?.matched?.includes(f) ? 'hit' : ''}`} key={f}>
                  <span className={`help-ext ext-${ext}`}>{ext || '파일'}</span>
                  <span>{label}</span>
                </div>
              )
            })}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn btn-sm" onClick={() => ask(item)}>
                💬 이 업무를 도우미에게 묻기
              </button>
              <span className="muted small">파일은 [📂 자료 폴더] 에서 내려받습니다.</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  const mineRows = mine.flatMap((id) => {
    const f = byId.get(id)
    return f ? [row(f.item, { where: `${f.group} › ${f.section.replace(/^\d+\.\s*/, '')}` })] : []
  })

  return (
    <>
      <div className="page-head">
        <h1>학교업무 도움자료</h1>
        <p>
          교육청이 업무마다 엮어 둔 자료 폴더(업무흐름도 · 계획 예시 · 서식)의 목록입니다. 학교급 {catalog.groups.length}
          갈래, 업무 {total}개, 자료 {fileTotal.toLocaleString()}개가 들어 있습니다. 업무 도우미와 통합 검색도 이 목록에서
          맞는 자료를 함께 찾아 줍니다.
        </p>
      </div>

      <div className="card">
        <div className="card-title">
          <span>⭐ 내 업무</span>
          {!picking && (
            <button className="btn btn-sm btn-primary" onClick={openPicker}>
              {mine.length ? '내 업무 다시 고르기' : '내 업무 고르기'}
            </button>
          )}
        </div>
        {picking ? (
          <>
            <HelpPicker level={level} text={pickText} onText={setPickText} selected={pickIds} onSelected={setPickIds} />
            <div className="row row-end" style={{ marginTop: 10 }}>
              <button className="btn btn-ghost" onClick={() => setPicking(false)}>
                취소
              </button>
              <button className="btn btn-primary" onClick={() => void savePicker()}>
                저장
              </button>
            </div>
          </>
        ) : mine.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            맡은 일을 적으면 맞는 도움자료를 골라 드립니다. 목록에서 ☆ 을 눌러 넣어도 됩니다. 고른 업무는 업무 도우미가
            먼저 살피고, 인수인계 파일에 함께 넘어갑니다.
            {!level && (
              <>
                {' '}
                <button className="link" onClick={() => onGo('설정')}>
                  [설정]에서 학교급을 고르면
                </button>{' '}
                그 학교급의 자료부터 보여 드립니다.
              </>
            )}
          </p>
        ) : (
          <div className="help-list">{mineRows}</div>
        )}
      </div>

      <div className="card">
        <div className="row">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (!e.target.value.trim()) setHits(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void search()
            }}
            placeholder="업무 이름이나 자료 이름으로 찾기 (예: 학교폭력, 생기부 정정, 체험학습 서식)"
            style={{ flex: 1, minWidth: 220 }}
          />
          <button className="btn btn-primary" onClick={() => void search()} disabled={!query.trim()}>
            찾기
          </button>
        </div>
      </div>

      {hits !== null ? (
        <div className="card">
          <div className="card-title">
            <span>
              「{query.trim()}」 찾은 업무 {hits.length}개
            </span>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setHits(null)
                setQuery('')
              }}
            >
              지우기
            </button>
          </div>
          {hits.length === 0 ? (
            <div className="empty">찾은 것이 없습니다. 낱말을 줄이거나 다른 이름으로 찾아 보세요.</div>
          ) : (
            <div className="help-list">
              {hits.map((h) => {
                const f = byId.get(h.id)
                return f
                  ? row(f.item, { where: `${h.group} › ${h.section.replace(/^\d+\.\s*/, '')}`, matched: h.matched })
                  : null
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="tabs">
            {catalog.groups.map((g) => (
              <button key={g.id} className={`tab ${tab === g.id ? 'active' : ''}`} onClick={() => setTab(g.id)}>
                {g.label}
                <span className="badge" style={{ marginLeft: 6 }}>
                  {g.sections.reduce((a, x) => a + x.items.length, 0)}
                </span>
              </button>
            ))}
          </div>
          {group.sections.map((sec) => (
            <div className="card" key={sec.title}>
              <div className="card-title">{sec.title}</div>
              <div className="help-list">{sec.items.map((it) => row(it))}</div>
            </div>
          ))}
        </>
      )}

      <p className="muted small">
        출처: {catalog.source.title} ({catalog.source.edition}) ·{' '}
        <button className="link" onClick={() => void window.api.shell.open(catalog.source.url)}>
          원래 누리집 열기 ↗
        </button>
        <br />
        자료 파일은 교육청 자료실에 있어 인터넷이 되어야 열립니다. 폴더가 열리지 않거나 더 새 자료가 필요하면 원래
        누리집에서 찾아 주세요. 목록은 프로그램을 업데이트할 때 함께 새로워집니다.
      </p>
    </>
  )
}
