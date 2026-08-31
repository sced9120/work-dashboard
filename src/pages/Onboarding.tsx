import { useState } from 'react'
import { useToast } from '../lib/toast'

interface Props {
  onDone: () => Promise<void>
}

export default function Onboarding({ onDone }: Props): JSX.Element {
  const toast = useToast()
  const [job, setJob] = useState('')
  const [school, setSchool] = useState('')
  const [roster, setRoster] = useState('')
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)

  const start = async (): Promise<void> => {
    if (!job.trim()) {
      toast('담당 업무명을 입력해 주세요.', 'err')
      return
    }
    setBusy(true)
    await window.api.setting.set('job_title', job.trim())
    await window.api.setting.set('school_name', school.trim())
    await window.api.setting.set('duty_roster', roster.trim())
    await onDone()
  }

  /** 업무분장표 파일에서 글을 뽑아 칸에 채운다. */
  const pickRoster = async (): Promise<void> => {
    const picked = await window.api.files.pick()
    if (!picked.length) return
    setReading(true)
    try {
      const parts: string[] = []
      for (const p of picked) {
        const doc = await window.api.files.extract(p.path)
        if (doc.error) toast(`${p.name}: ${doc.error}`, 'err')
        else if (doc.text.trim()) parts.push(doc.text)
      }
      if (parts.length) {
        setRoster((prev) => [prev, ...parts].filter(Boolean).join('\n\n'))
        toast(`${parts.length}개 문서에서 읽어 왔습니다.`, 'ok')
      }
    } finally {
      setReading(false)
    }
  }

  const restore = async (): Promise<void> => {
    setBusy(true)
    const res = await window.api.data.import()
    toast(res.message, res.ok ? 'ok' : 'err')
    if (res.ok) {
      // 인수인계 파일에 업무명이 없으면 기본값을 넣어 화면이 잠기지 않게 한다.
      const job = await window.api.setting.get('job_title')
      if (!job) await window.api.setting.set('job_title', '인수인계 업무')
      await onDone()
      return
    }
    setBusy(false)
  }

  return (
    <div className="onboard">
      <div className="onboard-inner">
        <h1>업무 인수인계 대시보드</h1>
        <p className="lead">
          담당 업무를 정리해 두고, 다음 담당자에게 파일 하나로 넘겨주기 위한 프로그램입니다.
        </p>

        <div className="card">
          <div className="card-title">처음 시작하기</div>
          <div className="field">
            <label htmlFor="job">담당 업무명</label>
            <input
              id="job"
              type="text"
              value={job}
              onChange={(e) => setJob(e.target.value)}
              placeholder="예: 정보부장, 학년부장, 방과후 담당"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void start()
              }}
            />
            <div className="hint">AI가 문서를 읽을 때 이 업무를 기준으로 정리합니다.</div>
          </div>
          <div className="field">
            <label htmlFor="school">학교명 (선택)</label>
            <input
              id="school"
              type="text"
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              placeholder="예: ○○고등학교"
            />
          </div>
          <div className="field">
            <label htmlFor="roster">
              업무분장표 (선택) <span className="muted">— 나중에 [설정]에서 넣어도 됩니다</span>
            </label>
            <div className="row" style={{ marginBottom: 6 }}>
              <button className="btn btn-sm" onClick={() => void pickRoster()} disabled={reading}>
                {reading ? '읽는 중…' : '📄 파일에서 불러오기'}
              </button>
              <span className="muted small">한글·엑셀·PDF 에서 글을 뽑아 옵니다</span>
              {roster && (
                <>
                  <span className="spacer" />
                  <button className="btn btn-sm btn-ghost" onClick={() => setRoster('')}>
                    비우기
                  </button>
                </>
              )}
            </div>
            <textarea
              id="roster"
              value={roster}
              onChange={(e) => setRoster(e.target.value)}
              placeholder={
                '맡은 일을 줄바꿈으로 적거나, 분장표를 그대로 붙여넣으세요.\n\n' +
                '예)\n방과후학교 운영\n교육과정 편성·운영\n학교폭력 예방 및 사안처리\n과학실 안전 관리'
              }
              rows={6}
            />
            <div className="hint">
              적어 두면 전임자가 남긴 자료 중 <b>내 분장에 없는 것을 갈라서</b> 보여 줍니다. 부서가
              바뀌었거나 전임자가 겸했던 일이 섞여 있을 때 구분이 됩니다.
            </div>
          </div>

          <div className="row row-end">
            <button className="btn btn-primary" onClick={() => void start()} disabled={busy}>
              시작하기
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-title">인수인계 받은 파일이 있나요?</div>
          <p className="muted small" style={{ marginTop: 0 }}>
            전임자에게 받은 <b>.db</b> 파일을 불러오면 정리된 업무를 그대로 이어받습니다. API 키
            없이도 내용을 볼 수 있습니다.
          </p>
          <div className="row row-end">
            <button className="btn" onClick={() => void restore()} disabled={busy}>
              📂 인수인계 파일 불러오기
            </button>
          </div>
        </div>

        <p className="muted small">
          AI 문서 분석 기능은 나중에 [설정]에서 API 키를 넣으면 켜집니다. 키가 없어도 업무를 직접
          등록하고 열람하는 기능은 모두 씁니다.
        </p>
      </div>
    </div>
  )
}
