import { useCallback, useEffect, useState } from 'react'
import { useConfirm } from '../lib/confirm'
import { useToast } from '../lib/toast'

/**
 * 백업 — 날마다 자동 백업(최근 7일) · 직접 백업 · 이 때로 되돌리기 (3.8.0~)
 * 세특 · 출결처럼 이 PC 에만 있는 자료를 잃지 않게. 되돌리기 전 상태도 백업으로 남아 되돌린 것을 다시 되돌릴 수 있다.
 */
interface Entry {
  file: string
  kind: string
  at: number
  sizeKb: number
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const when = (ms: number): string => {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}. ${d.getDate()}.(${WEEK[d.getDay()]}) ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function BackupCard({ folder, onRestored }: { folder: string; onRestored: () => void }): JSX.Element {
  const toast = useToast()
  const ask = useConfirm()
  const [list, setList] = useState<Entry[]>([])
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => setList(await window.api.backup.list()), [])
  useEffect(() => {
    void load()
  }, [load])

  const now = async (): Promise<void> => {
    setBusy(true)
    const r = await window.api.backup.now()
    setBusy(false)
    toast(r.message, r.ok ? 'ok' : 'err')
    await load()
  }

  const restore = async (e: Entry): Promise<void> => {
    const ok = await ask({
      title: `${when(e.at)} 상태로 되돌릴까요?`,
      body: '지금 자료가 이 백업의 내용으로 바뀝니다. 되돌리기 전 지금 상태는 백업 폴더에 따로 남겨 두니, 마음이 바뀌면 그것으로 다시 되돌리면 됩니다.',
      okText: '되돌리기',
      danger: true
    })
    if (!ok) return
    setBusy(true)
    const r = await window.api.backup.restore(e.file)
    setBusy(false)
    toast(r.message, r.ok ? 'ok' : 'err')
    if (r.ok) onRestored()
    else await load()
  }

  const daily = list.filter((x) => x.kind === '날마다')
  const shown = all ? list : list.filter((x) => x.kind === '날마다' || x.kind === '직접').slice(0, 10)

  return (
    <div className="card backup-card">
      <div className="card-title">백업</div>
      <p className="small muted">
        켤 때마다 하루 한 번 저절로 백업해 <b>최근 {daily.length ? `${daily.length}일치` : '7일치'}</b>를 둡니다. 세특 · 출결처럼 이 PC 에만 있는 자료도 함께 담깁니다. 다른 PC 로 옮기거나 따로 보관하려면 백업 폴더의 파일을 USB 등에 복사해 두세요.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button className="btn btn-sm btn-primary" onClick={() => void now()} disabled={busy}>
          지금 백업
        </button>
        <button className="btn btn-sm" onClick={() => void window.api.data.openFolder(folder)}>
          백업 폴더 열기
        </button>
        <label className="small" style={{ marginLeft: 'auto' }}>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> 불러오기 · 초기화 · 정리 전 백업도 보기
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="small muted">아직 백업이 없습니다. 잠시 뒤 첫 백업이 만들어집니다.</p>
      ) : (
        <ul className="backup-list">
          {shown.map((e) => (
            <li key={e.file}>
              <span className={`badge ${e.kind === '날마다' ? '' : 'badge-accent'}`}>{e.kind}</span>
              <span className="backup-when">{when(e.at)}</span>
              <span className="small muted">{e.sizeKb.toLocaleString()} KB</span>
              <button className="btn btn-sm btn-ghost" onClick={() => void restore(e)} disabled={busy}>
                이 때로 되돌리기
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
