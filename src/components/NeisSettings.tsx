import { useEffect, useState } from 'react'
import type { NeisSchool } from '../../shared/neis'
import { NEIS_KEY_PAGE, NEIS_PORTAL, NEIS_SCHOOL_KEY } from '../../shared/neis'
import { SCHOOL_LEVELS } from '../../shared/helpdocs'
import { useToast } from '../lib/toast'

interface Props {
  /** 설정의 학교명·학교급 — 연결한 학교와 다르면 맞출지 묻는다 */
  schoolName: string
  level: string
  onApplyProfile: (name: string, level: string) => Promise<void>
}

/** 나이스 학교 종류 → 설정의 학교급 */
function levelOf(kind: string): string {
  return (SCHOOL_LEVELS as readonly string[]).includes(kind) ? kind : ''
}

/**
 * [설정] 의 나이스 연결. 우리 학교를 찾아 연결하고, 인증키를 넣는다.
 * 인증키는 AI 키처럼 이 PC 에만(암호화) 두고, 연결한 학교는 인수인계 파일로 넘어간다.
 */
export default function NeisSettings({ schoolName, level, onApplyProfile }: Props): JSX.Element {
  const toast = useToast()
  const [school, setSchool] = useState<NeisSchool | null>(null)
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<NeisSchool[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [key, setKey] = useState('')
  const [savedKey, setSavedKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    void (async () => {
      const raw = await window.api.setting.get(NEIS_SCHOOL_KEY)
      try {
        const s = JSON.parse(raw || 'null') as NeisSchool | null
        if (s?.code) setSchool(s)
      } catch {
        /* 깨진 값이면 연결하지 않은 것으로 본다 */
      }
      const local = await window.api.local.load()
      setKey(local.neis_key ?? '')
      setSavedKey(local.neis_key ?? '')
    })()
  }, [])

  useEffect(() => {
    if (!query && schoolName) setQuery(schoolName)
    // 처음 한 번, 설정의 학교명을 찾기 칸에 넣어 둔다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolName])

  const search = async (): Promise<void> => {
    setSearching(true)
    setFound(null)
    try {
      const res = await window.api.neis.schools(query)
      if (!res.ok) {
        toast(res.error ?? '찾지 못했습니다.', 'err')
        return
      }
      setFound(res.data)
    } finally {
      setSearching(false)
    }
  }

  const link = async (s: NeisSchool): Promise<void> => {
    await window.api.setting.set(NEIS_SCHOOL_KEY, JSON.stringify(s))
    await window.api.neis.clearCache()
    setSchool(s)
    setFound(null)
    setTestMsg(null)
    toast(`${s.name} 을(를) 연결했습니다. 홈에 오늘 급식이 뜹니다.`, 'ok')
  }

  const unlink = async (): Promise<void> => {
    await window.api.setting.set(NEIS_SCHOOL_KEY, '')
    await window.api.neis.clearCache()
    setSchool(null)
    setTestMsg(null)
  }

  const saveKey = async (): Promise<void> => {
    // 다른 화면이 그 사이 바꾼 값을 덮지 않게 최신값 위에 키만 얹는다
    const latest = await window.api.local.load()
    await window.api.local.save({ ...latest, neis_key: key.trim() })
    setSavedKey(key.trim())
    setTestMsg(null)
    toast(key.trim() ? '나이스 인증키를 저장했습니다.' : '나이스 인증키를 지웠습니다.', 'ok')
  }

  const test = async (): Promise<void> => {
    if (key.trim() !== savedKey) await saveKey()
    setTesting(true)
    setTestMsg(null)
    try {
      setTestMsg(await window.api.neis.test())
    } finally {
      setTesting(false)
    }
  }

  const want = school ? { name: school.name, level: levelOf(school.kind) } : null
  const profileDiffers = !!want && (want.name !== schoolName.trim() || (!!want.level && want.level !== level))

  return (
    <div className="card">
      <div className="card-title">
        <span>🏫 나이스 연결 (급식 · 학사일정)</span>
        <button className="btn btn-sm btn-ghost" onClick={() => void window.api.shell.open(NEIS_PORTAL)}>
          교육정보 개방 포털 ↗
        </button>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        나이스 교육정보 개방 포털의 <b>공개 자료</b>(학교 기본정보 · 급식 · 학사일정)를 받아 옵니다. 보내는 것은
        학교 코드와 날짜뿐이고, 학생 개인정보는 오가지 않습니다.
      </p>

      {/* 1. 학교 */}
      <div className="field">
        <label>1. 우리 학교</label>
        {school ? (
          <div className="neis-school">
            <div style={{ minWidth: 0 }}>
              <div className="item-title">{school.name}</div>
              <div className="item-meta">
                {school.atptName} · {school.kind}
                {school.address ? ` · ${school.address}` : ''}
              </div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => void unlink()}>
              연결 끊기
            </button>
          </div>
        ) : (
          <>
            <div className="row">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void search()
                }}
                placeholder="학교 이름 (예: ○○고등학교)"
                style={{ flex: 1, minWidth: 200 }}
              />
              <button className="btn" onClick={() => void search()} disabled={searching || query.trim().length < 2}>
                {searching ? '찾는 중…' : '🔎 찾기'}
              </button>
            </div>
            <div className="hint">인증키 없이도 찾을 수 있습니다(한 번에 5곳까지). 이름을 정확히 적을수록 잘 나옵니다.</div>
          </>
        )}
        {found && (
          <div className="list" style={{ marginTop: 8 }}>
            {found.length === 0 && <div className="empty">찾은 학교가 없습니다. 이름을 다시 확인해 주세요.</div>}
            {found.map((s) => (
              <div className="item" key={`${s.atpt}-${s.code}`}>
                <div className="item-head">
                  <div style={{ minWidth: 0 }}>
                    <div className="item-title">{s.name}</div>
                    <div className="item-meta">
                      {s.atptName} · {s.kind}
                      {s.address ? ` · ${s.address}` : ''}
                    </div>
                  </div>
                  <button className="btn btn-sm btn-primary" onClick={() => void link(s)}>
                    이 학교로 연결
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {want && profileDiffers && (
          <div className="note note-info" style={{ marginTop: 8 }}>
            위 [담당 업무] 의 학교명 · 학교급이 연결한 학교와 다릅니다.{' '}
            <button
              className="btn btn-sm"
              onClick={() =>
                void (async () => {
                  await onApplyProfile(want.name, want.level || level)
                  toast('학교명 · 학교급을 맞췄습니다.', 'ok')
                })()
              }
            >
              {want.name}
              {want.level ? ` · ${want.level}` : ''} 로 맞추기
            </button>
          </div>
        )}
      </div>

      {/* 2. 인증키 */}
      <div className="field">
        <label>2. 인증키 (선택)</label>
        <div className="neis-need">
          <div>
            <b>키 없이도 되는 것</b> — 학교 찾기, 홈의 오늘 급식
          </div>
          <div>
            <b>키가 있어야 되는 것</b> — 학사일정 한꺼번에 가져오기(한 번에 5건을 넘기 때문)
          </div>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input
            type={showKey ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="발급받은 인증키를 붙여넣으세요"
            autoComplete="off"
            spellCheck={false}
            style={{ flex: 1, minWidth: 220 }}
          />
          <button className="btn btn-sm btn-ghost" onClick={() => setShowKey((v) => !v)}>
            {showKey ? '가리기' : '보기'}
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => void saveKey()} disabled={key.trim() === savedKey}>
            저장
          </button>
          <button className="btn btn-sm" onClick={() => void test()} disabled={testing}>
            {testing ? '확인 중…' : '연결 확인'}
          </button>
        </div>
        {testMsg && (
          <div className={`note ${testMsg.ok ? 'note-ok' : 'note-danger'}`} style={{ marginTop: 8 }}>
            {testMsg.message}
          </div>
        )}
        <div className="hint">
          인증키는 AI 키처럼 <b>이 PC 에만 암호화해 저장</b>하고, 인수인계 파일에는 넣지 않습니다. 연결한 학교는
          인수인계 파일에 함께 넘어갑니다.
        </div>

        <details className="neis-howto">
          <summary>인증키 받는 법 (무료 · 바로 발급)</summary>
          <ol>
            <li>
              아래 <b>[인증키 신청 화면 열기]</b> 를 누릅니다. (교육정보 개방 포털 → 활용가이드 → 인증키 신청)
            </li>
            <li>
              <b>구글 · 네이버 · 카카오</b> 계정으로 로그인합니다. 따로 회원가입하지 않아도 됩니다.
            </li>
            <li>
              신청 칸에 쓰임새를 적습니다. 예) 활용 용도: <i>학교 업무용</i>, 내용: <i>학교 급식·학사일정 확인</i>
            </li>
            <li>
              신청하면 <b>바로 발급</b>됩니다. <b>마이페이지 → 인증키 발급 내역</b> 에서 키를 복사합니다.
            </li>
            <li>위 칸에 붙여넣고 [저장] → [연결 확인].</li>
          </ol>
          <button className="btn btn-sm" onClick={() => void window.api.shell.open(NEIS_KEY_PAGE)}>
            인증키 신청 화면 열기 ↗
          </button>
        </details>
      </div>
    </div>
  )
}
