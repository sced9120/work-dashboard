import { useEffect } from 'react'
import type { PageId } from '../App'
import { requestStop, setProgress, useLearnJob } from '../lib/learnJob'

interface Props {
  page: PageId
  onGo: (p: PageId) => void
}

/**
 * 학습이 도는 동안 어느 화면에 있든 위쪽에 붙어 있는 띠.
 *
 * 공문 수십 건을 학습시키면 몇 분이 걸린다. 그동안 다른 일을 보다가
 * "아직 돌고 있나?" 를 알 길이 없었고, 화면을 옮기면 찾아낸 것도 사라졌다.
 * 이 띠가 어디까지 갔는지 알려 주고, 여기서 바로 멈출 수도 있다.
 */
export default function LearnBanner({ page, onGo }: Props): JSX.Element | null {
  const job = useLearnJob()

  // 메인에서 올려 주는 잔 진행 메시지를 받아 둔다
  useEffect(() => window.api.ai.onProgress((msg) => setProgress({ message: msg })), [])

  if (!job.running) return null

  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0
  const onLearnPage = page === '학습'

  return (
    <div className="learn-bar">
      <span className="learn-spin" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="learn-bar-title">
          {job.label} <b>{job.done}</b>
          <span className="muted"> / {job.total}</span>
          {job.stopping && <span className="badge badge-warn" style={{ marginLeft: 8 }}>멈추는 중</span>}
          {job.drafts.length > 0 && (
            <span className="badge badge-accent" style={{ marginLeft: 8 }}>
              {job.drafts.length}건 찾음
            </span>
          )}
        </div>
        <div className="learn-track">
          <span className="learn-fill" style={{ width: `${pct}%` }} />
        </div>
        {(job.now || job.message) && (
          <div className="learn-bar-now">{job.message || job.now}</div>
        )}
      </div>

      {!onLearnPage && (
        <button className="btn btn-sm" onClick={() => onGo('학습')}>
          보러 가기
        </button>
      )}
      <button className="btn btn-sm btn-danger" onClick={requestStop} disabled={job.stopping}>
        멈추기
      </button>
    </div>
  )
}
