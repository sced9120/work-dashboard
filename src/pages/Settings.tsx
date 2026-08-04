import { useEffect, useState } from 'react'
import type { LocalSettings } from '../../shared/types'
import { GEMINI_MODELS, OPENAI_MODELS } from '../../shared/types'
import { useToast } from '../lib/toast'

interface Props {
  onProfileChanged: () => Promise<void>
}

const DEFAULT_LOCAL: LocalSettings = {
  provider: 'gemini',
  openai_key: '',
  gemini_key: '',
  openai_model: 'gpt-4.1',
  gemini_model: 'gemini-2.5-flash'
}

export default function Settings({ onProfileChanged }: Props): JSX.Element {
  const toast = useToast()
  const [job, setJob] = useState('')
  const [school, setSchool] = useState('')
  const [local, setLocal] = useState<LocalSettings>(DEFAULT_LOCAL)
  const [encrypted, setEncrypted] = useState(true)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    void (async () => {
      setJob(await window.api.setting.get('job_title'))
      setSchool(await window.api.setting.get('school_name'))
      setLocal(await window.api.local.load())
      setEncrypted(await window.api.local.encrypted())
    })()
  }, [])

  const saveProfile = async (): Promise<void> => {
    if (!job.trim()) {
      toast('담당 업무명은 비워둘 수 없습니다.', 'err')
      return
    }
    await window.api.setting.set('job_title', job.trim())
    await window.api.setting.set('school_name', school.trim())
    await onProfileChanged()
    toast('저장했습니다.', 'ok')
  }

  const saveLocal = async (): Promise<void> => {
    await window.api.local.save(local)
    toast('저장했습니다.', 'ok')
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestMsg(null)
    await window.api.local.save(local)
    setTestMsg(await window.api.ai.test())
    setTesting(false)
  }

  const models = local.provider === 'openai' ? OPENAI_MODELS : GEMINI_MODELS
  const currentModel = local.provider === 'openai' ? local.openai_model : local.gemini_model

  const setModel = (value: string): void =>
    setLocal((l) =>
      l.provider === 'openai' ? { ...l, openai_model: value } : { ...l, gemini_model: value }
    )

  return (
    <>
      <div className="page-head">
        <h1>설정</h1>
        <p>담당 업무 정보와 AI 연결을 관리합니다.</p>
      </div>

      <div className="card">
        <div className="card-title">담당 업무</div>
        <div className="field">
          <label>담당 업무명</label>
          <input type="text" value={job} onChange={(e) => setJob(e.target.value)} />
          <div className="hint">이 값은 인수인계 파일에 함께 저장됩니다.</div>
        </div>
        <div className="field">
          <label>학교명</label>
          <input type="text" value={school} onChange={(e) => setSchool(e.target.value)} />
        </div>
        <div className="row row-end">
          <button className="btn btn-primary" onClick={() => void saveProfile()}>
            저장
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">AI 연결</div>

        <div className="note note-info" style={{ marginBottom: 14 }}>
          API 키는 <b>이 컴퓨터에만</b> 저장되며, 인수인계 파일에는 들어가지 않습니다.
          {!encrypted && (
            <div style={{ marginTop: 6 }}>
              이 환경에서는 키 암호화를 쓸 수 없어 설정 파일에 그대로 저장됩니다. 공용 PC에서는
              사용을 권하지 않습니다.
            </div>
          )}
        </div>

        <div className="field">
          <label>사용할 서비스</label>
          <div className="row">
            {(['gemini', 'openai'] as const).map((p) => (
              <button
                key={p}
                className={`btn ${local.provider === p ? 'btn-primary' : ''}`}
                onClick={() => setLocal({ ...local, provider: p })}
              >
                {p === 'gemini' ? 'Google Gemini' : 'OpenAI'}
              </button>
            ))}
          </div>
          <div className="hint">
            {local.provider === 'gemini'
              ? 'Google AI Studio(aistudio.google.com/apikey)에서 무료로 키를 만들 수 있습니다.'
              : 'platform.openai.com/api-keys 에서 키를 만들 수 있습니다. 사용량만큼 과금됩니다.'}{' '}
            <button
              className="link"
              onClick={() =>
                void window.api.shell.open(
                  local.provider === 'gemini'
                    ? 'https://aistudio.google.com/apikey'
                    : 'https://platform.openai.com/api-keys'
                )
              }
            >
              키 발급 페이지 열기
            </button>
          </div>
        </div>

        {local.provider === 'gemini' ? (
          <div className="field">
            <label>Gemini API 키</label>
            <input
              type="password"
              value={local.gemini_key}
              onChange={(e) => setLocal({ ...local, gemini_key: e.target.value })}
              placeholder="AIza…"
            />
          </div>
        ) : (
          <div className="field">
            <label>OpenAI API 키</label>
            <input
              type="password"
              value={local.openai_key}
              onChange={(e) => setLocal({ ...local, openai_key: e.target.value })}
              placeholder="sk-…"
            />
          </div>
        )}

        <div className="field">
          <label>모델</label>
          <input
            type="text"
            value={currentModel}
            onChange={(e) => setModel(e.target.value)}
            list="model-list"
          />
          <datalist id="model-list">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <div className="hint">
            목록에서 고르거나 직접 입력할 수 있습니다. 새 모델이 나오면 이름만 바꿔 넣으면 됩니다.
          </div>
        </div>

        {testMsg && (
          <div className={`note ${testMsg.ok ? 'note-ok' : 'note-danger'}`}>{testMsg.message}</div>
        )}

        <div className="row row-end" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => void test()} disabled={testing}>
            {testing ? '확인 중…' : '연결 테스트'}
          </button>
          <button className="btn btn-primary" onClick={() => void saveLocal()}>
            저장
          </button>
        </div>
      </div>
    </>
  )
}
