import { useCallback, useEffect, useState } from 'react'
import type { Task, Workflow } from '../../shared/types'
import type { PageId } from '../App'
import WorkflowEditor from '../components/WorkflowEditor'
import { useToast } from '../lib/toast'
import { groupByTopic } from '../lib/topics'

interface Props {
  onGo: (p: PageId) => void
}

const WF_PREFIX = 'wf:'

interface Item {
  topic: string
  wf: Workflow
}

function parseWorkflow(raw: string): Workflow | null {
  try {
    const v = JSON.parse(raw) as Workflow
    if (!v || !Array.isArray(v.nodes) || !Array.isArray(v.edges) || !v.nodes.length) return null
    return v
  } catch {
    return null
  }
}

/**
 * 그려 둔 워크플로우를 한자리에 모아 보는 화면.
 *
 * 전에는 [로드맵] → [업무별] → 주제를 고른 뒤에야 볼 수 있어서, 정작 인수인계
 * 받은 사람이 "무엇이 그려져 있는지" 를 알 길이 없었다.
 */
export default function Workflows({ onGo }: Props): JSX.Element {
  const toast = useToast()
  const [items, setItems] = useState<Item[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [draft, setDraft] = useState<Workflow | null>(null)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rows, list] = await Promise.all([
        window.api.setting.byPrefix(WF_PREFIX),
        window.api.tasks.list()
      ])
      const parsed: Item[] = []
      for (const r of rows) {
        const wf = parseWorkflow(r.value)
        if (wf) parsed.push({ topic: r.key.slice(WF_PREFIX.length), wf })
      }
      parsed.sort((a, b) => a.topic.localeCompare(b.topic, 'ko'))
      setItems(parsed)
      setTasks(list)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const current = items.find((i) => i.topic === open) ?? null

  const save = async (): Promise<void> => {
    if (!open || !draft) return
    await window.api.setting.set(WF_PREFIX + open, draft.nodes.length ? JSON.stringify(draft) : '')
    setDirty(false)
    await load()
    toast('저장했습니다. 인수인계 파일에 함께 넘어갑니다.', 'ok')
  }

  const tasksOf = (topic: string): Task[] => {
    const g = groupByTopic(tasks, {}).find((t) => t.name === topic)
    return g?.tasks ?? []
  }

  return (
    <>
      <div className="page-head">
        <h1>업무 워크플로우</h1>
        <p>
          업무마다 그려 둔 흐름을 한자리에서 봅니다. 인수인계 파일에 함께 넘어가므로, 받는 분이
          여기부터 열어 보면 됩니다.
        </p>
      </div>

      {loading ? (
        <div className="empty">불러오는 중…</div>
      ) : items.length === 0 ? (
        <div className="empty">
          아직 그려 둔 워크플로우가 없습니다.
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-sm btn-primary" onClick={() => onGo('로드맵')}>
              [로드맵] → [업무별] 에서 그리러 가기
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="wfcards">
            {items.map((i) => (
              <button
                key={i.topic}
                className={`wfcard ${open === i.topic ? 'on' : ''}`}
                onClick={() => {
                  if (open === i.topic) {
                    setOpen(null)
                    setDraft(null)
                    return
                  }
                  setOpen(i.topic)
                  setDraft(i.wf)
                  setDirty(false)
                }}
              >
                <span className="wfcard-name">{i.topic}</span>
                <span className="wfcard-n">
                  상자 {i.wf.nodes.length} · 화살표 {i.wf.edges.length}
                </span>
              </button>
            ))}
          </div>

          {current && draft && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="card-title">
                <span>{current.topic}</span>
                <span className="spacer" />
                {dirty && <span className="badge badge-warn">저장 안 됨</span>}
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setDraft(current.wf)
                    setDirty(false)
                  }}
                  disabled={!dirty}
                >
                  되돌리기
                </button>
                <button className="btn btn-sm btn-primary" onClick={() => void save()}>
                  저장
                </button>
              </div>

              <WorkflowEditor
                topic={current.topic}
                value={draft}
                onChange={(next) => {
                  setDraft(next)
                  setDirty(true)
                }}
                tasks={tasksOf(current.topic)}
              />
            </div>
          )}
        </>
      )}
    </>
  )
}
