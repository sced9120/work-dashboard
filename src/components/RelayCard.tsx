import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import QRCode from 'qrcode'
import type { RelayInfoShape } from '../../electron/preload/index'
import { useToast } from '../lib/toast'

/**
 * 폰 연결 — 선생님 구글 계정의 Apps Script 우편함 하나로 폰과 이 PC 를 잇는다.
 * [메신저 정리] · [세특 작성실] · [출결 기록] 이 같이 쓴다. tab 을 주면 QR 이 폰 화면의 그 탭으로 열린다.
 *   obs  — 수업 관찰 (세특 관찰 기록으로)
 *   att  — 출결 (출결 기록으로)
 *   text — 메신저 · 카톡 글 (받은 글함으로)
 */
interface Props {
  tab: 'obs' | 'att' | 'text'
  title: string
  /** 머리줄 옆에 붙는 한 줄 */
  desc: ReactNode
  /** 이어진 뒤 QR 옆에 보일 안내 */
  howTo: ReactNode
  /** 처음부터 펼쳐 둘지 */
  startOpen?: boolean
  className?: string
}

export default function RelayCard({ tab, title, desc, howTo, startOpen = false, className = '' }: Props): JSX.Element {
  const toast = useToast()
  const [info, setInfo] = useState<RelayInfoShape | null>(null)
  const [open, setOpen] = useState(startOpen)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [qr, setQr] = useState('')

  // 탭은 ? 뒤, 이름표 열쇠는 # 뒤(구글로 가지 않는 자리) — 순서가 바뀌면 열쇠가 서버로 간다
  const phone = info?.phone ? `${info.phone}&tab=${tab}${info.nkey ? `#n=${info.nkey}` : ''}` : ''

  useEffect(() => {
    void (async () => setInfo(await window.api.relay.info()))()
  }, [])
  useEffect(() => {
    if (!phone) return setQr('')
    void QRCode.toDataURL(phone, { margin: 1, width: 220, color: { dark: '#353532', light: '#ffffff' } }).then(setQr)
  }, [phone])

  if (!info) return <></>

  const outdated = info.connected && info.ver > 0 && info.ver < info.latest
  const unknown = info.connected && info.ver === 0

  const copy = async (v: string, what: string): Promise<void> => {
    await window.api.clipboard.write(v)
    toast(`${what}을 복사했습니다.`, 'ok')
  }
  const connect = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const r = await window.api.relay.connect(url)
    setBusy(false)
    if (!r.ok || !r.info) return setError(r.error ?? '잇지 못했습니다.')
    setInfo(r.info)
    toast('폰과 이었습니다.', 'ok')
  }
  const pull = async (): Promise<void> => {
    setBusy(true)
    window.dispatchEvent(new Event('relay:manual-pull'))
    const r = await window.api.relay.pull()
    setBusy(false)
    setInfo(await window.api.relay.info())
    if (!r.ok) return toast(r.error ?? '가져오지 못했습니다.', 'err')
    const parts = [r.obs ? `수업 관찰 ${r.obs}건` : '', r.att ? `출결 ${r.att}건` : '', r.added ? `글 ${r.added}개` : ''].filter(Boolean)
    toast(parts.length ? `폰에서 ${parts.join(' · ')}을 가져왔습니다.` : '새로 온 것이 없습니다.', parts.length ? 'ok' : 'info')
  }

  return (
    <section className={`card relay-card ${className}`}>
      <div className="relay-head">
        <span>
          <b>{title}</b>
          <span className="muted small"> — {desc}</span>
        </span>
        <span className="spacer" />
        {info.connected ? (
          <>
            <span className={`badge ${outdated ? '' : 'badge-accent'}`}>{outdated ? '새 판 필요' : '이어짐'}</span>
            <button className="btn btn-sm" onClick={() => void pull()} disabled={busy}>
              {busy ? '가져오는 중…' : '지금 가져오기'}
            </button>
          </>
        ) : null}
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? '닫기' : info.connected ? '폰 화면 · 설정' : '설정하기'}
        </button>
      </div>

      {open && (
        <div className="relay-body">
          {info.connected && (outdated || unknown) && tab !== 'text' && (
            <div className="note note-warn small relay-upgrade">
              <b>{outdated ? `폰 화면이 예전 판(v${info.ver})입니다.` : '폰 화면의 판을 아직 모릅니다.'}</b>{' '}
              {outdated ? '수업 관찰 · 출결을 쓰려면 코드를 한 번 바꿔 주세요. 주소와 QR 은 그대로입니다.' : '[지금 가져오기] 를 한 번 누르면 확인합니다. v1 이면 아래처럼 코드를 바꿔 주세요.'}
              <ol>
                <li>
                  <button className="btn btn-sm btn-primary" onClick={() => void copy(info.script, '새 코드')}>
                    새 코드 복사
                  </button>
                </li>
                <li>
                  <button className="link" onClick={() => void window.api.shell.open('https://script.google.com/home')}>
                    script.google.com ↗
                  </button>{' '}
                  에서 예전에 만든 프로젝트를 열고, 글을 모두 지운 뒤 붙여 넣고 저장합니다.
                </li>
                <li>
                  <b>[배포 → 배포 관리]</b> → 연필(수정) → 버전: <b>새 버전</b> → [배포]. (새 배포를 만들면 주소가 바뀌니 「배포 관리」에서 하세요.)
                </li>
                <li>
                  여기서 <b>[지금 가져오기]</b> 를 누르면 끝입니다.
                </li>
              </ol>
            </div>
          )}
          {info.connected && info.rescan && (
            <div className="note note-warn small">
              <b>폰 주소가 바뀌었습니다.</b> 폰에 학번 · 이름이 보이도록 아래 QR 을 폰으로 한 번 다시 찍어 열고, 홈 화면에 다시 추가해 주세요(예전 주소도 번호로는 계속 됩니다).{' '}
              <button className="btn btn-sm" onClick={() => void (async () => setInfo(await window.api.relay.seenQr()))()}>
                다시 찍었습니다
              </button>
            </div>
          )}
          {info.connected ? (
            <div className="relay-phone">
              {qr && <img src={qr} width={180} height={180} alt="폰 카메라로 찍을 QR 코드" />}
              <div>
                {howTo}
                <p className="small muted">
                  폰 카메라로 QR 을 찍어 열고, 브라우저 메뉴의 <b>[홈 화면에 추가]</b> 로 두면 앱처럼 씁니다. 이 주소를 아는 사람은 보낼 수 있으니 남에게 알려 주지 마세요. PC 의 오르빗이 켜져 있으면 3분마다 가져가고, 가져간
                  것은 구글 계정에서도 지워집니다(안 가져가면 14일 뒤).
                </p>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-sm" onClick={() => void copy(phone, '폰 주소')}>
                    폰 주소 복사
                  </button>
                  {!outdated && (
                    <button className="btn btn-sm btn-ghost" onClick={() => void copy(info.script, '코드')} title="스크립트를 다시 붙여 넣어야 할 때">
                      코드 다시 복사
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() =>
                      void (async () => {
                        if (!window.confirm('폰과 끊을까요? 다시 쓰려면 코드를 새로 만들어 붙여 넣어야 합니다.')) return
                        setInfo(await window.api.relay.disconnect())
                      })()
                    }
                  >
                    끊기
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <ol className="relay-steps small">
              <li>
                <b>코드 만들기</b> — 이 PC 만 아는 열쇠가 든 코드를 만듭니다.{' '}
                <button
                  className="btn btn-sm"
                  onClick={() =>
                    void (async () => {
                      if (info.hasKey && !window.confirm('새 열쇠로 코드를 다시 만들까요? 예전에 배포한 주소는 더 쓰지 못합니다.')) return
                      setInfo(await window.api.relay.newKey())
                    })()
                  }
                >
                  {info.hasKey ? '다시 만들기' : '코드 만들기'}
                </button>
                {info.hasKey && (
                  <button className="btn btn-sm btn-primary" style={{ marginLeft: 6 }} onClick={() => void copy(info.script, '코드')}>
                    코드 복사
                  </button>
                )}
              </li>
              <li>
                <button className="link" onClick={() => void window.api.shell.open('https://script.google.com/home/projects/create')}>
                  script.google.com ↗
                </button>{' '}
                에서 선생님 구글 계정으로 새 프로젝트를 만들고, 들어 있는 글을 지운 뒤 복사한 코드를 붙여 넣고 저장합니다.
              </li>
              <li>
                오른쪽 위 <b>[배포 → 새 배포]</b> → 유형 <b>웹 앱</b> → 실행: <b>나</b>, 액세스 권한: <b>모든 사용자</b> → [배포]. 처음에는 구글이 권한을 물어봅니다(선생님 계정의
                스크립트 저장소만 씁니다).
              </li>
              <li>
                나온 <b>웹 앱 URL</b> 을 붙여 넣고 잇기:
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" aria-label="웹 앱 URL" style={{ flex: 1 }} />
                  <button className="btn btn-primary btn-sm" onClick={() => void connect()} disabled={busy || !url.trim() || !info.hasKey}>
                    {busy ? '확인 중…' : '잇기'}
                  </button>
                </div>
                {error && <p className="note note-danger small">{error}</p>}
              </li>
            </ol>
          )}
          <p className="muted small">
            한 번 이어 두면 [메신저 정리] · [세특 작성실] · [출결 기록] 이 같은 폰 화면을 씁니다. 폰에는 학번 · 이름이 보이지만 구글에는 이 PC 에서 잠근 글만 갑니다(여는 열쇠는 QR 주소에만 있음). 학교 구글 계정(Workspace)은 관리자가 &apos;모든
            사용자&apos; 배포를 막아 두었을 수 있어 개인 계정을 권합니다.
          </p>
        </div>
      )}
    </section>
  )
}
