import { useMemo, useState } from 'react'
import type { SchoolTimetable } from '../../shared/timetable'
import type { Peer, PeerPrefs } from '../../shared/ttpeers'
import { TT_PEERS_KEY, findPeers, peerList, peerStamp, teacherSubjects } from '../../shared/ttpeers'
import { useToast } from '../lib/toast'

interface Props {
  tt: SchoolTimetable
  me: string
  alias: Record<string, string>
  prefs: PeerPrefs
  save: (key: string, value: unknown) => Promise<void>
}

const WHY: Record<Peer['why'], string> = { same: '같은 과목', group: '같은 교과', added: '직접 더함' }

/**
 * 수업 바꾸기 → 동교과 선생님. 시간표에서 찾은 명단을 보여 주고, 빼고 더하고 확인한다.
 * 이 명단에 있는 분과 함께 바꾸는 방법 · 보강을 먼저 보여 준다.
 */
export default function PeerPanel({ tt, me, alias, prefs, save }: Props): JSX.Element {
  const toast = useToast()
  const [pick, setPick] = useState('')
  const [open, setOpen] = useState(false)
  const found = useMemo(() => findPeers(tt, me, alias), [tt, me, alias])
  const list = useMemo(() => peerList(tt, me, alias, prefs), [tt, me, alias, prefs])
  const subjects = useMemo(() => teacherSubjects(tt), [tt])
  const stamp = peerStamp(tt, me)
  const confirmed = prefs.confirmedFor === stamp
  const removedFound = found.found.filter((f) => prefs.removed.includes(f.name))
  const others = tt.teachers.filter((t) => t !== me && !list.some((p) => p.name === t))

  const put = (next: Partial<PeerPrefs>): Promise<void> => save(TT_PEERS_KEY, { ...prefs, ...next })

  const remove = async (p: Peer): Promise<void> => {
    if (p.why === 'added') await put({ added: prefs.added.filter((n) => n !== p.name) })
    else await put({ removed: [...new Set([...prefs.removed, p.name])] })
    toast(`${p.name} 선생님을 동교과 명단에서 뺐습니다.`, 'ok')
  }

  const add = async (name: string): Promise<void> => {
    if (!name) return
    // 찾은 명단에서 뺐던 분이면 되살리고, 아니면 직접 더한 분으로
    if (prefs.removed.includes(name)) await put({ removed: prefs.removed.filter((n) => n !== name) })
    else await put({ added: [...new Set([...prefs.added, name])] })
    setPick('')
    toast(`${name} 선생님을 동교과 명단에 넣었습니다.`, 'ok')
  }

  const what = (name: string): string => [...(subjects.get(name) ?? [])].slice(0, 3).join(' · ')

  return (
    <div className={`card tt-peers ${confirmed ? '' : 'unconfirmed'}`}>
      <div className="card-title">
        <span>👥 동교과 선생님 — 교체 · 보강 때 먼저 찾습니다</span>
        <span className="badge">{list.length}분</span>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(!open)}>
          {open ? '접기' : '명단 고치기'}
        </button>
      </div>

      {!confirmed && (
        <div className="note note-info tt-peer-confirm">
          시간표에서 저와 <b>같은 과목</b>, 또는 <b>비슷한 교과</b>(예: 수학 — 공통수학 · 미적분 · 확률과 통계)를 가르치는 분을 찾아
          넣었습니다. 맞는지 보고 빼거나 더한 뒤 확인을 눌러 주세요.
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="btn btn-sm btn-primary"
              onClick={() =>
                void (async () => {
                  await put({ confirmedFor: stamp })
                  toast('동교과 명단을 확인했습니다. 교체 · 보강에서 이분들을 먼저 보여 드립니다.', 'ok')
                })()
              }
            >
              확인했어요
            </button>
            {!open && (
              <button className="btn btn-sm" onClick={() => setOpen(true)}>
                명단 고치기
              </button>
            )}
          </div>
        </div>
      )}

      <div className="small muted" style={{ marginBottom: 6 }}>
        내 교과: {found.groups.length ? found.groups.join(' · ') : '시간표 과목 이름으로 알아보지 못했습니다'}
        {found.mine.length > 0 && ` (${found.mine.slice(0, 5).join(' · ')})`}
      </div>

      {list.length === 0 ? (
        <p className="small muted" style={{ margin: '4px 0' }}>
          찾은 분이 없습니다. 블록 글자만 적힌 시간표라면 [내 시간표 → 과목 이름 바꿔 보이기] 로 과목 이름을 붙이거나, 아래에서 직접 더해
          주세요.
        </p>
      ) : (
        <div className="tt-peer-list">
          {list.map((p) => (
            <span key={p.name} className={`tt-peer ${p.why}`} title={p.subjects.join(' · ')}>
              {p.name}
              <small>
                {WHY[p.why]}
                {p.subjects.length ? ` · ${p.subjects.slice(0, 2).join(' · ')}` : ''}
              </small>
              {open && (
                <button className="tt-peer-x" onClick={() => void remove(p)} aria-label={`${p.name} 빼기`}>
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="tt-peer-edit">
          <div className="row">
            <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ width: 'auto', minWidth: 220 }}>
              <option value="">— 더할 선생님 —</option>
              {others.map((t) => (
                <option key={t} value={t}>
                  {t}
                  {what(t) ? ` (${what(t)})` : ''}
                </option>
              ))}
            </select>
            <button className="btn btn-sm btn-primary" onClick={() => void add(pick)} disabled={!pick}>
              ＋ 동교과 교사 추가
            </button>
          </div>
          {removedFound.length > 0 && (
            <div className="small muted" style={{ marginTop: 8 }}>
              뺀 분:{' '}
              {removedFound.map((f) => (
                <button key={f.name} className="btn btn-sm btn-ghost" onClick={() => void add(f.name)} title="다시 넣기">
                  ↺ {f.name}
                </button>
              ))}
            </div>
          )}
          <p className="hint" style={{ marginBottom: 0 }}>
            뺀 분 · 더한 분은 시간표를 다시 불러와도 그대로 둡니다. 선생님 이름이 들어 있어 인수인계 파일로는 넘기지 않습니다.
          </p>
        </div>
      )}
    </div>
  )
}
