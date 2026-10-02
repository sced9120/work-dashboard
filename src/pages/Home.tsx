import { useCallback, useEffect, useState } from 'react'
import type { Notice, Task } from '../../shared/types'
import type { PageId } from '../App'
import Calendar from '../components/Calendar'
import type { CalView } from '../components/Calendar'
import LastYear from '../components/LastYear'
import MealCard from '../components/MealCard'
import {
  ClassTtWidget,
  DeadlinesWidget,
  HelpWidget,
  MyTtWidget,
  NoticesWidget,
  QuickWidget,
  ScheduleWidget,
  SchoolStrip,
  TasksWidget
} from '../components/HomeWidgets'
import { useToast } from '../lib/toast'

interface Props {
  jobTitle: string
  onGo: (p: PageId) => void
}

/**
 * 홈은 위젯 판이다. 위젯마다 접기 · 넓게/좁게 · 닫기를 할 수 있고, [홈 꾸미기] 에서 끌어 옮기거나 더한다.
 * [자동 정렬] 은 시간에 쫓기는 것(급식 · 시간표 · 일정)을 위로 올리고, 반쪽 위젯끼리 짝지어 빈칸 없이 놓는다.
 * 배치는 DB 설정(home_widgets)에 남는다.
 */

export type WidgetId =
  | 'school'
  | 'meal'
  | 'mytt'
  | 'classtt'
  | 'schedule'
  | 'deadlines'
  | 'calendar'
  | 'tasks'
  | 'help'
  | 'lastyear'
  | 'notices'
  | 'quick'

interface WidgetDef {
  icon: string
  title: string
  desc: string
  /** 처음 넓이 */
  wide: boolean
  /** 자동 정렬 차례 (작을수록 위) */
  rank: number
  /** 제목 옆 [열기] 로 갈 화면 */
  page?: PageId
}

export const WIDGETS: Record<WidgetId, WidgetDef> = {
  school: { icon: '🏫', title: '학교 정보', desc: '나이스에서 받은 학교 이름 · 주소 · 전화 · 누리집 (작은 띠)', wide: true, rank: 0, page: '설정' },
  meal: { icon: '🍱', title: '오늘 급식', desc: '조식 · 중식 · 석식 (나이스)', wide: true, rank: 1 },
  mytt: { icon: '🕘', title: '내 시간표', desc: '지금 몇 교시인지, 다음 수업 · 한 주 시간표 그림', wide: false, rank: 2, page: '시간표' },
  classtt: { icon: '⭐', title: '우리 반 시간표', desc: '담임 학급 시간표 (시간표 파일 또는 나이스)', wide: false, rank: 3, page: '시간표' },
  schedule: { icon: '📅', title: '다가오는 학사일정', desc: '앞으로 45일 안의 학교 행사 · 시험 · 휴업일 (나이스)', wide: false, rank: 4, page: '달력' },
  deadlines: { icon: '⏰', title: '절차 기한', desc: '다가오는 통보 · 통지 기한과 D-day', wide: false, rank: 5, page: '기한' },
  calendar: { icon: '🗓', title: '달력', desc: '한 달 · 한 주 보기, 일정 넣기 · 옮기기', wide: true, rank: 6, page: '달력' },
  tasks: { icon: '✅', title: '이 달 업무', desc: '이번 달 · 수시 업무 체크', wide: false, rank: 7, page: '로드맵' },
  help: { icon: '🧭', title: '내 업무 도움자료', desc: '고른 내 업무의 교육청 자료 폴더', wide: false, rank: 8, page: '도움자료' },
  lastyear: { icon: '🔁', title: '작년 이맘때', desc: '지난 학년도 이맘때 했던 일', wide: true, rank: 9, page: '로드맵' },
  notices: { icon: '📌', title: '메모 · 공지', desc: '다음 담당자에게 남길 메모', wide: false, rank: 10 },
  quick: { icon: '🚀', title: '빠른 이동', desc: '자주 가는 화면 버튼', wide: false, rank: 11 }
}

interface WidgetState {
  id: WidgetId
  wide: boolean
  folded: boolean
  /** 달력 위젯: 한 달 · 한 주 */
  view?: CalView
}

const HOME_KEY = 'home_widgets'
const DEFAULT_ORDER: WidgetId[] = ['school', 'meal', 'mytt', 'schedule', 'calendar', 'deadlines', 'tasks', 'lastyear', 'notices', 'quick']
const defaults = (): WidgetState[] => DEFAULT_ORDER.map((id) => ({ id, wide: WIDGETS[id].wide, folded: false }))

function parseLayout(raw: string): WidgetState[] {
  try {
    const v = JSON.parse(raw || 'null') as WidgetState[] | null
    if (!Array.isArray(v)) return defaults()
    const seen = new Set<string>()
    return v.filter((w) => w && w.id in WIDGETS && !seen.has(w.id) && seen.add(w.id)).map((w) => ({ id: w.id, wide: !!w.wide, folded: !!w.folded, view: w.view }))
  } catch {
    return defaults()
  }
}

/**
 * 자동 정렬 — 차례(rank)대로 놓되, 반쪽 위젯 다음에 넓은 위젯이 오면 뒤에서 반쪽 짝을 끌어와 빈칸을 메운다.
 * 학교 정보 띠는 늘 맨 위.
 */
export function autoArrange(list: WidgetState[]): WidgetState[] {
  const rest = [...list].sort((a, b) => WIDGETS[a.id].rank - WIDGETS[b.id].rank)
  const out: WidgetState[] = []
  while (rest.length) {
    const w = rest.shift()!
    out.push(w)
    if (w.wide || w.folded) continue
    const j = rest.findIndex((x) => !x.wide && !x.folded)
    if (j >= 0) out.push(...rest.splice(j, 1))
  }
  return out
}

export default function Home({ jobTitle, onGo }: Props): JSX.Element {
  const toast = useToast()
  const [tasks, setTasks] = useState<Task[]>([])
  const [notices, setNotices] = useState<Notice[]>([])
  const [layout, setLayout] = useState<WidgetState[] | null>(null)
  const [editing, setEditing] = useState(false)
  const [dragId, setDragId] = useState<WidgetId | null>(null)
  const [noticeAdding, setNoticeAdding] = useState(false)

  const load = useCallback(async () => {
    setTasks(await window.api.tasks.list())
    setNotices(await window.api.notices.list())
  }, [])

  useEffect(() => {
    void load()
    void (async () => setLayout(parseLayout(await window.api.setting.get(HOME_KEY))))()
  }, [load])

  const commit = (next: WidgetState[]): void => {
    setLayout(next)
    void window.api.setting.set(HOME_KEY, JSON.stringify(next))
  }

  if (!layout) return <div className="muted">불러오는 중…</div>

  const patch = (id: WidgetId, p: Partial<WidgetState>): void => commit(layout.map((w) => (w.id === id ? { ...w, ...p } : w)))
  const remove = (id: WidgetId): void => {
    commit(layout.filter((w) => w.id !== id))
    toast(`'${WIDGETS[id].title}' 위젯을 닫았습니다. [✏️ 홈 꾸미기] 에서 다시 더할 수 있습니다.`)
  }
  const move = (id: WidgetId, delta: number): void => {
    const i = layout.findIndex((w) => w.id === id)
    const j = i + delta
    if (j < 0 || j >= layout.length) return
    const next = [...layout]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }
  const dropOn = (target: WidgetId): void => {
    if (!dragId || dragId === target) return
    const from = layout.find((w) => w.id === dragId)!
    const rest = layout.filter((w) => w.id !== dragId)
    const at = rest.findIndex((w) => w.id === target)
    rest.splice(at, 0, from)
    commit(rest)
    setDragId(null)
  }
  const hidden = (Object.keys(WIDGETS) as WidgetId[]).filter((id) => !layout.some((w) => w.id === id))
  const doneCount = tasks.filter((t) => t.is_completed === 1).length

  const body = (w: WidgetState): JSX.Element | null => {
    switch (w.id) {
      case 'school':
        return <SchoolStrip onGo={onGo} />
      case 'meal':
        return <MealCard onGo={onGo} />
      case 'mytt':
        return <MyTtWidget onGo={onGo} wide={w.wide} />
      case 'classtt':
        return <ClassTtWidget onGo={onGo} />
      case 'schedule':
        return <ScheduleWidget onGo={onGo} />
      case 'deadlines':
        return <DeadlinesWidget onGo={onGo} />
      case 'calendar':
        return (
          <Calendar
            tasks={tasks}
            compact
            monthLanes={w.wide ? 3 : 2}
            onOpenFull={() => onGo('달력')}
            view={w.view ?? 'month'}
            onView={(v) => patch('calendar', { view: v })}
          />
        )
      case 'tasks':
        return <TasksWidget tasks={tasks} onChanged={() => void load()} onGo={onGo} />
      case 'help':
        return <HelpWidget onGo={onGo} />
      case 'lastyear':
        return <LastYear tasks={tasks} onGo={onGo} bare />
      case 'notices':
        return <NoticesWidget adding={noticeAdding} onAdding={setNoticeAdding} />
      case 'quick':
        return <QuickWidget onGo={onGo} />
    }
  }

  const extra = (w: WidgetState): JSX.Element | null => {
    if (w.id === 'notices')
      return (
        <button className="btn btn-sm" onClick={() => setNoticeAdding((v) => !v)}>
          {noticeAdding ? '닫기' : '＋ 새 글'}
        </button>
      )
    if (w.id === 'tasks') {
      const m = new Date().getMonth() + 1
      return <span className="muted small">{m}월 · 완료 {doneCount}/{tasks.length}</span>
    }
    return null
  }

  return (
    <>
      <div className="page-head page-head-row">
        <div>
          <h1>{jobTitle} 업무 대시보드</h1>
          <p>
            등록된 업무 {tasks.length}건 · 완료 {doneCount}건 · 공지 {notices.length}건
          </p>
        </div>
        <div className="row">
          {editing && (
            <>
              <button className="btn btn-sm" onClick={() => commit(autoArrange(layout))} title="급한 것부터 위로, 반쪽 위젯끼리 짝지어 빈칸 없이">
                🧲 자동 정렬
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => commit(defaults())}>
                ↺ 처음 모양
              </button>
            </>
          )}
          <button className={`btn btn-sm ${editing ? 'btn-primary' : ''}`} onClick={() => setEditing((v) => !v)}>
            {editing ? '✓ 꾸미기 끝' : '✏️ 홈 꾸미기'}
          </button>
        </div>
      </div>

      {editing && (
        <div className="card hw-add">
          <div className="card-title">
            <span>＋ 위젯 더하기</span>
            <span className="muted small">위젯을 끌어 옮기거나 ↑ ↓ 로 차례를 바꾸세요. ↔ 는 넓게 · 좁게, ✕ 는 닫기입니다.</span>
          </div>
          {hidden.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>모든 위젯이 홈에 있습니다.</p>
          ) : (
            <div className="hw-add-list">
              {hidden.map((id) => (
                <button
                  key={id}
                  className="pickcard"
                  onClick={() => commit([...layout, { id, wide: WIDGETS[id].wide, folded: false }])}
                >
                  <span className="pickcard-icon">{WIDGETS[id].icon}</span>
                  <span className="pickcard-body">
                    <span className="pickcard-name">{WIDGETS[id].title}</span>
                    <span className="pickcard-sum">{WIDGETS[id].desc}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {layout.length === 0 && (
        <div className="empty">
          홈에 위젯이 없습니다. <button className="link" onClick={() => setEditing(true)}>[✏️ 홈 꾸미기]</button> 에서 더해 주세요.
        </div>
      )}

      <div className={`hw-grid ${editing ? 'editing' : ''}`}>
        {layout.map((w, i) => {
          const def = WIDGETS[w.id]
          const strip = w.id === 'school'
          return (
            <section
              key={w.id}
              className={`hw ${w.wide || strip ? 'wide' : ''} ${w.folded ? 'folded' : ''} ${strip ? 'strip' : ''} ${dragId === w.id ? 'dragging' : ''}`}
              draggable={editing}
              onDragStart={(e) => {
                setDragId(w.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', w.id)
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                if (dragId && dragId !== w.id) e.preventDefault()
              }}
              onDrop={(e) => {
                e.preventDefault()
                dropOn(w.id)
              }}
            >
              <header className="hw-head">
                {editing && <span className="hw-grip" title="끌어서 옮기기">⠿</span>}
                <span className="hw-title">
                  {def.icon} {strip && !w.folded ? '' : def.title}
                </span>
                {strip && !w.folded ? <span className="hw-strip-body">{body(w)}</span> : <span className="spacer" />}
                {!w.folded && !strip && extra(w)}
                <span className="hw-tools">
                  {editing && (
                    <>
                      <button className="hw-btn" onClick={() => move(w.id, -1)} disabled={i === 0} title="앞으로">
                        ↑
                      </button>
                      <button className="hw-btn" onClick={() => move(w.id, 1)} disabled={i === layout.length - 1} title="뒤로">
                        ↓
                      </button>
                    </>
                  )}
                  {def.page && !editing && (
                    <button className="hw-btn" onClick={() => onGo(def.page!)} title={`${def.title} 화면으로`}>
                      ↗
                    </button>
                  )}
                  <button className="hw-btn" onClick={() => patch(w.id, { folded: !w.folded })} title={w.folded ? '펼치기' : '접기'}>
                    {w.folded ? '▸' : '▾'}
                  </button>
                  {!strip && (
                    <button className="hw-btn" onClick={() => patch(w.id, { wide: !w.wide })} title={w.wide ? '좁게 (반쪽)' : '넓게 (한 줄)'}>
                      ↔
                    </button>
                  )}
                  <button className="hw-btn" onClick={() => remove(w.id)} title="닫기 (홈 꾸미기에서 다시 더할 수 있음)">
                    ✕
                  </button>
                </span>
              </header>
              {!w.folded && !strip && <div className="hw-body">{body(w)}</div>}
            </section>
          )
        })}
      </div>
    </>
  )
}
