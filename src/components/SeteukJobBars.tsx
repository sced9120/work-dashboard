import { useEffect, useState } from 'react'
import { jobPace, seteukJob } from '../lib/seteukJob'
import type { SeteukJob } from '../lib/seteukJob'

/** 줄에 선 받는 일들 — 일마다 막대 하나. 같은 서비스로 가는 일은 '대기', 다른 서비스로 가는 일은 함께 움직인다 (3.7.6~) */
export function useSeteukJobs(): SeteukJob[] {
  const [, setTick] = useState(0)
  useEffect(() => seteukJob.subscribe(() => setTick((n) => n + 1)), [])
  return seteukJob.list()
}

export default function SeteukJobBars({ kind }: { kind: SeteukJob['kind'] }): JSX.Element | null {
  const list = useSeteukJobs().filter((j) => j.kind === kind)
  if (!list.length) return null
  const verb = kind === 'write' ? '생성' : '압축'
  return (
    <div className="stk-jobs">
      {list.map((j) => {
        const run = j.status === 'run'
        return (
          <div key={j.id} className={`stk-prog${run ? '' : ' wait'}`} role="status">
            {run ? <span className="stk-spin" aria-hidden="true" /> : <span className="stk-waitdot" aria-hidden="true" />}
            <span className="small stk-prog-label">
              {j.label} {run ? `${verb} 중` : '대기'}
            </span>
            <div className="progress">
              <div style={{ width: `${j.total ? Math.round((j.done / j.total) * 100) : 0}%` }} />
            </div>
            <span className="small muted">
              {run ? `${j.done} / ${j.total}명${jobPace(j)}` : `${j.total}명 · 같은 서비스로 가는 앞 일이 끝나면 시작합니다`}
            </span>
            <button className="btn btn-sm btn-ghost" onClick={() => seteukJob.cancel(j.id)}>
              {run ? '멈추기' : '대기 취소'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
