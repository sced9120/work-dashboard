import { useEffect, useState } from 'react'
import { schoolYearRange, ymd, addDays } from '../../shared/neis'
import { useToast } from '../lib/toast'

interface Props {
  onClose: () => void
  /** 주소를 바꿨을 때 — 달력을 다시 그린다 */
  onChanged: () => void
}

type Range = '앞으로' | '학년도' | '3개월'

const SETTINGS = 'https://calendar.google.com/calendar/r/settings'
const IMPORT = 'https://calendar.google.com/calendar/r/settings/export'

/**
 * 구글 캘린더 연동 (원하는 사람만).
 * ① 받아 보기: "iCal 형식의 비공개 주소"를 넣으면 달력에 구글 일정이 겹쳐 보인다(읽기만).
 * ② 보내기: 이 프로그램의 일정을 .ics 파일로 저장해 구글 캘린더에서 가져오기 한다.
 */
export default function GcalPanel({ onClose, onChanged }: Props): JSX.Element {
  const toast = useToast()
  const [url, setUrl] = useState('')
  const [saved, setSaved] = useState('')
  const [show, setShow] = useState(false)
  const [testing, setTesting] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null)
  const [range, setRange] = useState<Range>('앞으로')
  const [withDeadlines, setWithDeadlines] = useState(false)
  const [withMemo, setWithMemo] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const s = await window.api.local.load()
      setUrl(s.gcal_url ?? '')
      setSaved(s.gcal_url ?? '')
    })()
  }, [])

  const save = async (value: string): Promise<boolean> => {
    const v = value.trim()
    if (v && !/^(https?|webcals?):\/\/\S+$/i.test(v)) {
      toast('https:// 로 시작하는 주소를 넣어 주세요.', 'err')
      return false
    }
    if (v && /calendar\.google\.com\/calendar\/(embed|u\/|r)/i.test(v)) {
      toast('이 주소는 화면용 주소입니다. "iCal 형식의 비공개 주소"(…/basic.ics)를 넣어 주세요.', 'err')
      return false
    }
    // 다른 화면이 그 사이 바꾼 값을 덮지 않게 최신값 위에 주소만 얹는다
    const latest = await window.api.local.load()
    await window.api.local.save({ ...latest, gcal_url: v })
    await window.api.gcal.clearCache()
    setSaved(v)
    setMsg(null)
    onChanged()
    return true
  }

  const test = async (): Promise<void> => {
    if (url.trim() !== saved && !(await save(url))) return
    setTesting(true)
    try {
      setMsg(await window.api.gcal.test())
    } finally {
      setTesting(false)
    }
  }

  const exportIcs = async (): Promise<void> => {
    const today = ymd(new Date())
    const year = schoolYearRange(today)
    const [from, to] = range === '학년도' ? [year.from, year.to] : range === '3개월' ? [today, addDays(today, 92)] : [today, year.to]
    setBusy(true)
    try {
      const r = await window.api.gcal.exportIcs({ from, to, deadlines: withDeadlines, memo: withMemo })
      if (r.message !== '취소했습니다.') toast(r.message, r.ok ? 'ok' : 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="card-title">
        <span>🔗 구글 캘린더 (원할 때만)</span>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          닫기
        </button>
      </div>

      <div className="gcal-cols">
        <section>
          <h4>① 구글 일정을 이 달력에 함께 보기</h4>
          <p className="hint" style={{ marginTop: 0 }}>
            구글 캘린더의 일정을 점선 막대로 겹쳐 보여 줍니다. <b>받아 보기만</b> 하고 구글 쪽은 바꾸지 않습니다. 15분마다
            새로 받습니다.
          </p>
          <ol className="gcal-steps">
            <li>
              <button className="link" onClick={() => void window.api.shell.open(SETTINGS)}>
                구글 캘린더 설정 ↗
              </button>{' '}
              을 엽니다 (웹에서, 볼 계정으로 로그인)
            </li>
            <li>왼쪽 [내 캘린더의 설정] 에서 캘린더 이름 → [캘린더 통합]</li>
            <li>
              <b>iCal 형식의 비공개 주소</b> 를 복사해 아래에 붙여넣습니다 (…/basic.ics 로 끝남)
            </li>
          </ol>
          <div className="row">
            <input
              type={show ? 'text' : 'password'}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
              autoComplete="off"
              spellCheck={false}
              style={{ flex: 1, minWidth: 220 }}
            />
            <button className="btn btn-sm btn-ghost" onClick={() => setShow((v) => !v)}>
              {show ? '가리기' : '보기'}
            </button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={url.trim() === saved}
              onClick={() =>
                void (async () => {
                  if (await save(url)) toast(url.trim() ? '저장했습니다. 달력에 구글 일정이 함께 보입니다.' : '구글 일정 보기를 껐습니다.', 'ok')
                })()
              }
            >
              저장
            </button>
            <button className="btn btn-sm" onClick={() => void test()} disabled={testing || !url.trim()}>
              {testing ? '확인 중…' : '연결 확인'}
            </button>
            {saved && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() =>
                  void (async () => {
                    setUrl('')
                    await save('')
                    toast('구글 일정 보기를 껐습니다.', 'ok')
                  })()
                }
              >
                끄기 (주소 지우기)
              </button>
            )}
          </div>
          {msg && (
            <div className={`note ${msg.ok ? 'note-ok' : 'note-danger'}`} style={{ marginTop: 8 }}>
              {msg.message}
            </div>
          )}
          <div className="note note-warn" style={{ marginTop: 8 }}>
            이 주소를 아는 사람은 누구나 그 캘린더를 볼 수 있습니다. 메신저 · 메일로 보내지 마세요. 프로그램은 이 PC 에만
            암호화해 두고 인수인계 파일에는 넣지 않습니다. 학교 구글 계정은 관리자가 이 주소를 막아 두었을 수 있습니다.
          </div>
        </section>

        <section>
          <h4>② 이 달력의 일정을 구글로 보내기</h4>
          <p className="hint" style={{ marginTop: 0 }}>
            일정을 <b>.ics 파일</b>로 저장해 구글 캘린더에서 가져오기 합니다. 한 번 보내는 것이라, 보낸 뒤에 고친 일정은 따라가지
            않습니다.
          </p>
          <div className="row">
            <select value={range} onChange={(e) => setRange(e.target.value as Range)} style={{ width: 'auto' }}>
              <option value="앞으로">오늘부터 학년도 끝까지</option>
              <option value="3개월">오늘부터 3개월</option>
              <option value="학년도">이번 학년도 전체</option>
            </select>
          </div>
          <label className="neis-opt" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={withMemo} onChange={(e) => setWithMemo(e.target.checked)} />
            <span>일정의 메모도 함께</span>
          </label>
          <label className="neis-opt" style={{ marginTop: 6 }}>
            <input type="checkbox" checked={withDeadlines} onChange={(e) => setWithDeadlines(e.target.checked)} />
            <span>절차 기한도 함께 (제목만)</span>
          </label>
          {(withMemo || withDeadlines) && (
            <div className="note note-warn" style={{ marginTop: 8 }}>
              메모 · 기한에 학생 이름이 들어 있으면 구글로 넘어갑니다. 보내기 전에 확인하세요.
            </div>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn btn-sm btn-primary" onClick={() => void exportIcs()} disabled={busy}>
              {busy ? '만드는 중…' : '📤 .ics 파일로 저장'}
            </button>
          </div>
          <ol className="gcal-steps">
            <li>
              <button className="link" onClick={() => void window.api.shell.open(IMPORT)}>
                구글 캘린더 [가져오기/내보내기] ↗
              </button>{' '}
              를 엽니다
            </li>
            <li>[컴퓨터에서 파일 선택] 으로 저장한 .ics 파일을 고르고, 넣을 캘린더를 골라 [가져오기]</li>
          </ol>
        </section>
      </div>
    </div>
  )
}
