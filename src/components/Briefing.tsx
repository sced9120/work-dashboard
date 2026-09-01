import { useEffect, useState } from 'react'
import type { YearSummary } from '../../shared/types'
import { currentSchoolYear, schoolYearLabel } from '../../shared/types'
import { useToast } from '../lib/toast'
import YearPicker from './YearPicker'

interface Props {
  includePersonal: boolean
}

/**
 * 인수인계 브리핑.
 *
 * 지금까지는 다음 담당자에게 .db 파일 하나를 건네는 것이 전부였다. 받은 사람은
 * 업무 수백 건과 공문 수백 건 앞에서 어디부터 봐야 할지 알 수 없다.
 * 이 화면이 **읽을 수 있는 한 편의 글**을 만들어 준다.
 *
 * AI를 쓰지 않는다. 이미 프로그램에 적어 둔 것을 차례대로 엮을 뿐이라
 * 공짜이고 즉시 나오며, 인터넷이 막힌 학교 컴퓨터에서도 된다.
 */
export default function Briefing({ includePersonal }: Props): JSX.Element {
  const toast = useToast()
  const [year, setYear] = useState(currentSchoolYear())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [years, setYears] = useState<YearSummary[]>([])

  useEffect(() => {
    void (async () => setYears(await window.api.years.summary()))()
  }, [])

  const build = async (): Promise<void> => {
    setBusy(true)
    try {
      setText(await window.api.briefing.build({ year, from, to }))
      toast('초안을 엮었습니다. 빈칸을 채워 주세요.', 'ok')
    } finally {
      setBusy(false)
    }
  }

  const savePackage = async (): Promise<void> => {
    if (!text.trim()) {
      toast('먼저 [초안 엮기] 를 눌러 주세요.', 'err')
      return
    }
    setBusy(true)
    try {
      const res = await window.api.briefing.package({ year, text, includePersonal })
      toast(res.message, res.ok ? 'ok' : 'err')
    } finally {
      setBusy(false)
    }
  }

  const blanks = (text.match(/\(   \)/g) ?? []).length

  return (
    <div className="card">
      <div className="card-title">
        <span>📦 인수인계 꾸러미 만들기</span>
        {text && <span className="badge badge-accent">{text.length.toLocaleString()}자</span>}
      </div>

      <p className="hint" style={{ marginTop: 0 }}>
        프로그램에 쌓인 것을 모아 <b>사람이 읽는 인수인계서</b>로 엮습니다. 한 해가 어떻게
        돌아가는지, 업무별로 어떤 순서로 처리하는지, 무엇을 조심해야 하는지를 차례로 담습니다.
        <br />
        <b>AI를 쓰지 않습니다.</b> 이미 적어 두신 것을 엮을 뿐이라 요금이 들지 않고 바로 나옵니다.
      </p>

      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <YearPicker
          value={year}
          onChange={setYear}
          label="어느 학년도를 담을까요?"
          allowNone
          extra={years.map((y) => y.year)}
          hint="미지정을 고르면 학년도를 매기지 않은 자료까지 모두 담습니다."
        />
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label>인계자 (나)</label>
          <input type="text" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="비워 두어도 됩니다" />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label>인수자</label>
          <input type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="비워 두어도 됩니다" />
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => void build()} disabled={busy}>
          {busy ? '엮는 중…' : '✍ 인수인계서 초안 엮기'}
        </button>
        {text && (
          <>
            <button
              className="btn"
              onClick={() =>
                void (async () => {
                  await window.api.clipboard.write(text)
                  toast('복사했습니다. 한글에 붙여넣으세요.', 'ok')
                })()
              }
            >
              📋 복사
            </button>
            <button className="btn btn-primary" onClick={() => void savePackage()} disabled={busy}>
              📦 꾸러미로 저장
            </button>
          </>
        )}
      </div>

      {text && (
        <>
          <div className="note note-warn" style={{ marginBottom: 10 }}>
            <b>빈칸 {blanks}곳을 채워 주세요.</b> <code>(   )</code> 로 남은 자리는 프로그램이 알
            수 없는 것들입니다 — 자료가 어디 있는지, 협조 부서가 어디인지, 다음 사람에게 꼭 하고
            싶은 말. <b>여기가 인수인계서에서 가장 값진 부분입니다.</b>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{
              minHeight: 460,
              fontFamily: "'D2Coding', 'Consolas', 'Malgun Gothic', monospace",
              fontSize: 12.5,
              lineHeight: 1.65,
              whiteSpace: 'pre'
            }}
          />

          <p className="hint" style={{ marginBottom: 0 }}>
            <b>[📦 꾸러미로 저장]</b> 은 폴더 하나에 세 가지를 함께 담습니다 — 인수인계서(.txt),
            인수인계 파일(.db), 그리고 받는 사람을 위한 안내문. 폴더째 넘겨주시면 됩니다.
          </p>
        </>
      )}
    </div>
  )
}
