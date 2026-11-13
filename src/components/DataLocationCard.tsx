import { useEffect, useState } from 'react'
import { useToast } from '../lib/toast'

/**
 * 자료 폴더 (3.7.1~) — 자료 파일을 USB · OneDrive 같은 폴더에 두고 학교 PC 와 집 PC 에서 함께 쓴다.
 * AI 키 · 폰 연결 · 백업은 PC 마다 따로 둔다. 두 PC 에서 동시에 열면 한쪽 내용이 덮이므로 잠금으로 알린다.
 */
interface Loc {
  dir: string
  custom: boolean
  defaultDir: string
  synced: boolean
}

export default function DataLocationCard(): JSX.Element {
  const toast = useToast()
  const [loc, setLoc] = useState<Loc | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => setLoc(await window.api.dataLocation.get()))()
  }, [])

  const run = async (fn: () => Promise<{ ok: boolean; message: string }>): Promise<void> => {
    setBusy(true)
    const r = await fn()
    toast(r.message, r.ok ? 'ok' : r.message === '취소했습니다.' ? 'info' : 'err')
    // 바꾸면 프로그램이 곧 다시 시작한다
    if (!r.ok) setBusy(false)
  }

  if (!loc) return <></>
  return (
    <div className="card data-loc">
      <div className="card-title">
        자료 폴더 <span className={`badge ${loc.custom ? 'badge-accent' : ''}`}>{loc.custom ? '다른 폴더' : '이 PC 기본'}</span>
      </div>
      <div className="mono muted small data-loc-path">{loc.dir}</div>
      <p className="small">
        학교 PC 와 집 PC 에서 같은 자료를 쓰려면 자료를 <b>USB 나 OneDrive 같은 폴더</b>에 두세요. 두 PC 모두 여기서 같은 폴더를 고르면 됩니다. 옮기는 것은 업무 · 일정 · 세특 · 출결 같은
        <b> 자료 파일 하나</b>이고, AI 키 · 폰 연결 · 백업은 PC 마다 따로입니다.
      </p>
      <ul className="small data-loc-notes">
        <li>
          <b>두 PC 에서 동시에 열지 마세요.</b> 나중에 저장한 쪽이 앞의 내용을 덮어씁니다. 다른 PC 가 쓰는 중이면 켤 때 알려 드립니다. 다 쓰면 트레이의 [완전히 종료]로 끄세요.
        </li>
        {loc.synced && <li>클라우드 폴더는 동기화가 끝난 뒤에 다른 PC 에서 여세요. 동기화 중에 열면 '충돌 사본' 파일이 생길 수 있습니다.</li>}
        <li>학생 정보가 들어 있으니 학교 지침에 맞는 저장 장치를 쓰고, USB 는 잃어버리지 않게 해 주세요.</li>
      </ul>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-sm btn-primary" onClick={() => void run(() => window.api.dataLocation.choose())} disabled={busy}>
          {loc.custom ? '다른 폴더로 바꾸기…' : '다른 폴더로 옮기기…'}
        </button>
        {loc.custom && (
          <button className="btn btn-sm" onClick={() => void run(() => window.api.dataLocation.reset())} disabled={busy}>
            이 PC 기본 폴더로 되돌리기
          </button>
        )}
        <button className="btn btn-sm btn-ghost" onClick={() => void window.api.data.openFolder(loc.dir)}>
          자료 폴더 열기
        </button>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        폴더를 바꾸면 지금 자료를 먼저 백업하고 오르빗을 다시 시작합니다.
      </p>
    </div>
  )
}
