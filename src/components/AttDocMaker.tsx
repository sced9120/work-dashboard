import { useEffect, useMemo, useState } from 'react'
import type { AttRecord, Roster } from '../../shared/attendance'
import { ATT_DOC_FIELDS, autoMap, docFileName, fillArgs, fillCellLines, fmtDay, groupAbsences, isLineSpot, itemValues, lineSpotKind, onlyTable, pickVariant, slotKey, tableOf } from '../../shared/attdoc'
import type { AttDocMap } from '../../shared/attdoc'
import type { FormLayout, HwpForm } from '../../shared/hwpform'
import { todayStr } from '../lib/util'
import { useToast } from '../lib/toast'

const MAP_KEY = (id: number): string => `attdoc_map_${id}`
const FORM_KEY = 'attdoc_form'

/**
 * 출결 기록 → 결석계 (3.7.8~). 학교가 올려 둔 한글 양식(.hwp · .hwpx)의 칸에 건마다 값을 넣어 파일 하나씩 만든다.
 * 칸은 {{성명}} 처럼 적힌 자리와 '라벨 옆 빈 칸'을 찾아 라벨(성명 · 기간 · 사유 …)로 짝을 짐작하고, 선생님이 확인해 저장한다.
 * 이름이 든 자료는 이 PC 안에서만 쓰이고 AI · 인터넷으로 가지 않는다.
 */
export default function AttDocMaker({ records, roster, month }: { records: AttRecord[]; roster: Roster; month: string }): JSX.Element {
  const toast = useToast()
  const [forms, setForms] = useState<HwpForm[]>([])
  const [formId, setFormId] = useState(0)
  const [layout, setLayout] = useState<FormLayout | null>(null)
  const [map, setMap] = useState<AttDocMap>({})
  const [savedMap, setSavedMap] = useState(false)
  const [allTime, setAllTime] = useState(false)
  const [title, setTitle] = useState('결석계')
  const [pick, setPick] = useState<Set<string>>(new Set())
  const [days, setDays] = useState<Record<string, number>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [proofNames, setProofNames] = useState<Record<string, string>>({})
  const [variantSel, setVariantSel] = useState<Record<string, string>>({})
  const [lineFill, setLineFill] = useState(true)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ first: string; folder: string; written: number } | null>(null)

  const loadForms = async (want?: number): Promise<void> => {
    const list = await window.api.hwp.list()
    setForms(list)
    const saved = Number(await window.api.setting.get(FORM_KEY, '0')) || 0
    const next = want ?? (list.some((f) => f.id === formId) ? formId : list.some((f) => f.id === saved) ? saved : (list.find((f) => /결석|출결/.test(f.name))?.id ?? list[0]?.id ?? 0))
    setFormId(next)
  }
  useEffect(() => {
    void loadForms()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 양식을 고르면 칸을 읽고, 저장해 둔 연결이 있으면 그것을 앞세운다
  useEffect(() => {
    setLayout(null)
    setDone(null)
    if (!formId) return
    let alive = true
    void (async () => {
      const l = await window.api.hwp.layout({ id: formId })
      if (!alive) return
      setLayout(l)
      const auto = autoMap(l.slots, l.blanks, l.spots)
      let stored: AttDocMap = {}
      try {
        stored = JSON.parse(await window.api.setting.get(MAP_KEY(formId), '{}')) as AttDocMap
      } catch {
        stored = {}
      }
      const merged: AttDocMap = {}
      for (const k of Object.keys(auto)) merged[k] = k in stored ? stored[k] : auto[k]
      setMap(merged)
      setSavedMap(Object.keys(stored).length > 0)
      void window.api.setting.set(FORM_KEY, String(formId))
    })()
    return () => {
      alive = false
    }
  }, [formId])

  // 한 칸 안에 '○ 사유 : …' 줄이 든 칸 — 한 파일에 병결 · 인정결 같은 양식이 여럿이면 표마다 하나씩 나온다
  const lineSpots = useMemo(
    () => (layout?.ok ? layout.spots.filter((x) => isLineSpot(x.text)).map((x) => ({ id: x.id, text: x.text, table: tableOf(x.id), kind: lineSpotKind(x.text) })) : []),
    [layout]
  )
  const firstTable = lineSpots.length > 1 ? lineSpots[0].table : ''

  const items = useMemo(() => {
    const all = groupAbsences(records, roster.students, roster.cls)
    return allTime ? all : all.filter((g) => g.start.startsWith(month))
  }, [records, roster, month, allTime])

  const toggle = (key: string): void =>
    setPick((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const addForm = async (): Promise<void> => {
    const r = await window.api.hwp.add('')
    if (r.errors.length) toast(r.errors.join('\n'), 'err')
    if (r.added.length) {
      await loadForms(r.added[0].id)
      toast('양식을 넣었습니다. 아래에서 칸 연결을 확인하세요.', 'ok')
    }
  }

  const saveMap = async (): Promise<void> => {
    await window.api.setting.set(MAP_KEY(formId), JSON.stringify(map))
    setSavedMap(true)
    toast('칸 연결을 저장했습니다. 다음부터 이 양식은 그대로 씁니다.', 'ok')
  }

  const chosen = items.filter((g) => pick.has(g.key))
  const mapped = Object.values(map).some(Boolean) || (lineFill && lineSpots.length > 0)
  const today = todayStr()

  const make = async (): Promise<void> => {
    if (!chosen.length || !formId || busy) return
    setBusy(true)
    setDone(null)
    try {
      const out = chosen.map((g) => {
        const opt = { days: days[g.key], reasonText: reasons[g.key], proofName: proofNames[g.key] }
        const vals = itemValues(g, today, opt)
        // 표가 여럿(병결 · 인정결 …)이면 이 건이 쓸 표만 채운다
        const table = lineSpots.length > 1 ? (variantSel[g.key] ?? pickVariant(lineSpots, g)) : ''
        const { values, blanks } = fillArgs(onlyTable(map, table), vals)
        if (lineFill) {
          const ls = lineSpots.length > 1 ? lineSpots.find((x) => x.table === table) : lineSpots[0]
          if (ls) blanks[ls.id] = fillCellLines(ls.text, g, opt)
        }
        return { fileName: docFileName(g, title), values, blanks }
      })
      const r = await window.api.hwp.makeAttDocs({ ref: { id: formId }, items: out })
      if (r.failed.length) toast(`만들지 못한 건 ${r.failed.length}건: ${r.failed.map((f) => `${f.name}(${f.message})`).join(', ')}`, 'err')
      if (r.written) {
        setDone({ first: r.first, folder: r.folder, written: r.written })
        toast(r.message, 'ok')
      } else if (!r.failed.length) toast(r.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  // 표가 여럿인 양식은 첫 표에서 고른 연결을 같은 자리 · 같은 라벨의 다른 표 칸에도 적용한다
  const propagate = (m: AttDocMap, l: FormLayout | null, key: string, value: string): AttDocMap => {
    const next = { ...m, [key]: value }
    const tb = tableOf(key)
    if (!l || !tb) return next
    const suffix = key.slice(tb.length)
    const label = l.blanks.find((b) => b.id === key)?.label
    for (const b of l.blanks) if (tableOf(b.id) && tableOf(b.id) !== tb && b.id.slice(tableOf(b.id).length) === suffix && b.label === label) next[b.id] = value
    return next
  }

  const targets: { key: string; text: string }[] = layout
    ? [
        ...layout.slots.map((s) => ({ key: slotKey(s), text: `{{${s}}}` })),
        ...layout.blanks
          .filter((b) => !firstTable || !tableOf(b.id) || tableOf(b.id) === firstTable)
          .map((b) => ({ key: b.id, text: `${b.label ?? '?'} 옆 빈 칸${tableOf(b.id) ? ` (${tableOf(b.id)})` : ''}` }))
      ]
    : []

  return (
    <div className="att-doc card">
      <div className="card-title">결석계 만들기</div>
      <p className="small muted" style={{ marginTop: 0 }}>
        출결 기록에서 결석을 골라, 우리 학교 결석계 한글 양식에 이름 · 기간 · 일수 · 사유를 넣어 파일로 만듭니다. 이 PC 안에서만 하고 AI · 인터넷으로 보내지 않습니다.
      </p>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="small" htmlFor="attdoc-form">
          양식
        </label>
        <select id="attdoc-form" value={formId} onChange={(e) => setFormId(Number(e.target.value))} disabled={!forms.length}>
          {!forms.length && <option value={0}>올려 둔 양식이 없습니다</option>}
          {forms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} ({f.kind})
            </option>
          ))}
        </select>
        <button className="btn btn-sm" onClick={() => void addForm()}>
          양식 올리기
        </button>
        <label className="small" htmlFor="attdoc-title">
          파일 이름
        </label>
        <input id="attdoc-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: 110 }} />
      </div>
      {!forms.length && (
        <p className="small muted">
          학교 결석계 한글 파일(.hwp · .hwpx)을 [양식 올리기]로 넣으세요. 양식에 <code>{'{{성명}}'}</code> 처럼 적어 두거나, '성명 · 기간 · 사유' 같은 라벨 옆 칸을 비워 두면 자동으로 짝을 짐작합니다.
        </p>
      )}

      {layout && !layout.ok && <p className="note note-warn small">{layout.error || '양식을 읽지 못했습니다.'}</p>}
      {layout?.ok && (
        <div className="att-doc-map">
          <div className="row" style={{ marginBottom: 4 }}>
            <b className="small">칸 연결</b>
            <span className="small muted">{savedMap ? '저장해 둔 연결입니다.' : '라벨을 보고 짐작한 것입니다. 틀린 칸을 고치고 저장하세요.'}</span>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={() => void saveMap()} disabled={!targets.length}>
              연결 저장
            </button>
          </div>
          {lineSpots.length > 0 && (
            <label className="small att-doc-lines">
              <input type="checkbox" checked={lineFill} onChange={(e) => setLineFill(e.target.checked)} /> 칸 안의 줄 채우기 — '○ 사유 :' · '○ 기 간 : 년 월 일 ~ … ( )일간' · '○ 증빙서류 :' 줄과 날짜 줄(서명일)을 자동으로 채웁니다
              {lineSpots.length > 1 && <span className="muted"> · 양식 {lineSpots.length}종({lineSpots.map((x) => x.kind || x.table).join(' / ')}) — 건마다 맞는 것을 고릅니다</span>}
            </label>
          )}
          {!targets.length && !lineSpots.length ? (
            <p className={`note ${lineSpots.length ? 'note-info' : 'note-warn'} small`}>
              {lineSpots.length ? '라벨 옆 빈 칸은 없습니다(위의 줄 채우기만 씁니다). ' : ''}채울 칸을 찾지 못했습니다. 양식에 <code>{'{{성명}}'}</code> 처럼 적거나, 라벨 옆 칸을 비워 둔 양식인지 확인하세요.
            </p>
          ) : (
            <table className="att-doc-table">
              <tbody>
                {targets.map((t) => (
                  <tr key={t.key}>
                    <th scope="row">{t.text}</th>
                    <td>
                      <select value={map[t.key] ?? ''} onChange={(e) => setMap((m) => propagate(m, layout, t.key, e.target.value))} aria-label={`${t.text} 에 넣을 것`}>
                        <option value="">(비워 둠)</option>
                        {ATT_DOC_FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="att-doc-items">
        <div className="row" style={{ margin: '10px 0 4px' }}>
          <b className="small">만들 결석 ({allTime ? '전체 기간' : month.replace('-', '. ') + '.'})</b>
          <label className="small">
            <input type="checkbox" checked={allTime} onChange={(e) => setAllTime(e.target.checked)} /> 전체 기간
          </label>
          <span className="spacer" />
          <button className="btn btn-sm btn-ghost" onClick={() => setPick(new Set(items.map((g) => g.key)))} disabled={!items.length}>
            모두 고르기
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setPick(new Set(items.filter((g) => g.proof === '필요').map((g) => g.key)))} disabled={!items.length}>
            서류 아직인 건만
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setPick(new Set())} disabled={!pick.size}>
            해제
          </button>
        </div>
        {!items.length ? (
          <p className="small muted">이 기간에 만들 결석이 없습니다. 연속한 평일의 결석은 한 건으로 묶어 보여 줍니다.</p>
        ) : (
          <table className="att-doc-table att-doc-pick">
            <thead>
              <tr>
                <th></th>
                <th>학생</th>
                <th>기간</th>
                <th>일수</th>
                <th>사유</th>
                {lineSpots.length > 0 && lineFill && <th>증빙서류</th>}
                {lineSpots.length > 1 && lineFill && <th>양식</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((g) => (
                <tr key={g.key} className={pick.has(g.key) ? 'on' : ''}>
                  <td>
                    <input type="checkbox" checked={pick.has(g.key)} onChange={() => toggle(g.key)} aria-label={`${g.name} ${fmtDay(g.start)} 고르기`} />
                  </td>
                  <td>
                    {g.no}번 {g.name}
                  </td>
                  <td>{g.start === g.end ? fmtDay(g.start, true) : `${fmtDay(g.start, true)} ~ ${fmtDay(g.end, true)}`}</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      value={days[g.key] ?? g.days}
                      onChange={(e) => setDays((d) => ({ ...d, [g.key]: Math.max(1, Number(e.target.value) || 1) }))}
                      style={{ width: 54 }}
                      aria-label="결석 일수 (공휴일이 끼면 고치세요)"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={reasons[g.key] ?? g.reasonText}
                      placeholder={g.reason}
                      onChange={(e) => setReasons((r) => ({ ...r, [g.key]: e.target.value }))}
                      aria-label="사유 내용"
                    />
                  </td>
                  {lineSpots.length > 0 && lineFill && (
                    <td>
                      <input
                        type="text"
                        value={proofNames[g.key] ?? ''}
                        placeholder="예: 진료확인서"
                        onChange={(e) => setProofNames((r) => ({ ...r, [g.key]: e.target.value }))}
                        aria-label="증빙서류 이름"
                      />
                    </td>
                  )}
                  {lineSpots.length > 1 && lineFill && (
                    <td>
                      <select value={variantSel[g.key] ?? pickVariant(lineSpots, g)} onChange={(e) => setVariantSel((v) => ({ ...v, [g.key]: e.target.value }))} aria-label="쓸 양식">
                        {lineSpots.map((x) => (
                          <option key={x.table} value={x.table}>
                            {x.kind || x.table}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn btn-primary btn-sm" onClick={() => void make()} disabled={!chosen.length || !formId || !mapped || busy}>
          {busy ? '만드는 중…' : chosen.length ? `${chosen.length}건 결석계 만들기` : '결석계 만들기'}
        </button>
        {done && (
          <>
            <span className="small">{done.written}건을 저장했습니다.</span>
            <button className="btn btn-sm" onClick={() => void window.api.hwp.reveal(done.first)}>
              폴더 열기
            </button>
          </>
        )}
        {!mapped && formId > 0 && layout?.ok && <span className="small muted">칸 연결이 모두 비어 있습니다.</span>}
      </div>
    </div>
  )
}
