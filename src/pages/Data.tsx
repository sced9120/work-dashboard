import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../lib/toast'

interface Props {
  onChanged: () => Promise<void>
}

export default function Data({ onChanged }: Props): JSX.Element {
  const toast = useToast()
  const [info, setInfo] = useState<{ path: string; backups: string; sizeKb: number } | null>(null)
  const [counts, setCounts] = useState({ tasks: 0, notices: 0 })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setInfo(await window.api.data.info())
    const [tasks, notices] = await Promise.all([
      window.api.tasks.list(),
      window.api.notices.list()
    ])
    setCounts({ tasks: tasks.length, notices: notices.length })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (fn: () => Promise<{ ok: boolean; message: string }>): Promise<void> => {
    setBusy(true)
    const res = await fn()
    toast(res.message, res.ok ? 'ok' : 'err')
    await load()
    await onChanged()
    setBusy(false)
  }

  return (
    <>
      <div className="page-head">
        <h1>인수인계 · 백업</h1>
        <p>정리한 내용을 파일 하나로 넘겨주고 받는 곳입니다.</p>
      </div>

      <div className="card">
        <div className="card-title">현재 자료</div>
        <div className="row" style={{ gap: 20 }}>
          <div>
            <div className="muted small">업무</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{counts.tasks}건</div>
          </div>
          <div>
            <div className="muted small">공지 · 메모</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{counts.notices}건</div>
          </div>
          <div>
            <div className="muted small">파일 크기</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{info?.sizeKb ?? 0} KB</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">다음 담당자에게 넘겨주기</div>
        <p className="muted small" style={{ marginTop: 0 }}>
          지금까지 정리한 업무와 메모를 <b>.db</b> 파일 하나로 저장합니다. 이 파일을 받은 사람이
          같은 프로그램에서 불러오면 그대로 이어서 쓸 수 있습니다.
        </p>
        <div className="note note-ok" style={{ marginBottom: 12 }}>
          API 키는 이 파일에 들어가지 않습니다. 안심하고 전달하셔도 됩니다.
        </div>
        <div className="row">
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void run(() => window.api.data.export())}
          >
            📤 인수인계 파일 내보내기
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">전임자에게 받은 파일 불러오기</div>
        <p className="muted small" style={{ marginTop: 0 }}>
          지금 들어 있는 자료는 덮어써집니다. 덮어쓰기 직전 상태는 자동으로 백업 폴더에 보관됩니다.
        </p>
        <div className="row">
          <button
            className="btn"
            disabled={busy}
            onClick={() => void run(() => window.api.data.import())}
          >
            📥 인수인계 파일 불러오기
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">저장 위치</div>
        <div className="field">
          <label>자료 파일</label>
          <div className="mono muted">{info?.path}</div>
        </div>
        <div className="field">
          <label>자동 백업 폴더</label>
          <div className="mono muted">{info?.backups}</div>
        </div>
        <div className="row">
          <button
            className="btn btn-sm"
            onClick={() => void window.api.data.openFolder(info?.backups ?? '')}
          >
            백업 폴더 열기
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">초기화</div>
        <p className="muted small" style={{ marginTop: 0 }}>
          등록된 업무와 공지를 모두 지웁니다. 지우기 직전 상태는 백업 폴더에 남습니다.
        </p>
        <div className="row">
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={() => void run(() => window.api.data.clear())}
          >
            모든 자료 지우기
          </button>
        </div>
      </div>
    </>
  )
}
