import { useEffect, useState } from 'react'
import type { LocalSettings, Provider } from '../../shared/types'
import { isBuiltinModel, modelsFor, withCustomModel } from '../../shared/types'
import { useToast } from '../lib/toast'

interface Props {
  onProfileChanged: () => Promise<void>
}

const DEFAULT_LOCAL: LocalSettings = {
  provider: 'gemini',
  openai_key: '',
  gemini_key: '',
  claude_key: '',
  openai_model: 'gpt-4.1',
  gemini_model: 'gemini-2.5-flash',
  claude_model: 'claude-sonnet-5',
  feature_models: {},
  custom_models: {},
  notify_deadlines: false,
  notify_days: 3,
  keep_in_tray: false,
  open_at_login: false
}

/** 서비스별 이름·키 발급처·키 생김새 */
const PROVIDERS: Record<
  Provider,
  { label: string; keyUrl: string; keyHint: string; placeholder: string }
> = {
  gemini: {
    label: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'Google AI Studio(aistudio.google.com/apikey)에서 무료로 키를 만들 수 있습니다.',
    placeholder: 'AIza…'
  },
  openai: {
    label: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'platform.openai.com/api-keys 에서 키를 만들 수 있습니다. 사용량만큼 과금됩니다.',
    placeholder: 'sk-…'
  },
  claude: {
    label: 'Claude (Anthropic)',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint:
      'console.anthropic.com/settings/keys 에서 키를 만들 수 있습니다. 사용량만큼 과금됩니다.',
    placeholder: 'sk-ant-…'
  }
}

export default function Settings({ onProfileChanged }: Props): JSX.Element {
  const toast = useToast()
  const [job, setJob] = useState('')
  const [school, setSchool] = useState('')
  const [local, setLocal] = useState<LocalSettings>(DEFAULT_LOCAL)
  const [encrypted, setEncrypted] = useState(true)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null)
  const [newModel, setNewModel] = useState('')

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
    // Settings 는 feature_models 를 다루지 않는다. 다른 화면(ModelPicker)이
    // 그 사이 저장했을 값을 덮어쓰지 않도록, 직전 값을 그대로 다시 실어 보낸다.
    const latest = await window.api.local.load()
    await window.api.local.save({ ...local, feature_models: latest.feature_models })
    toast('저장했습니다.', 'ok')
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestMsg(null)
    // Settings 는 feature_models 를 다루지 않는다. 다른 화면(ModelPicker)이
    // 그 사이 저장했을 값을 덮어쓰지 않도록, 직전 값을 그대로 다시 실어 보낸다.
    const latest = await window.api.local.load()
    await window.api.local.save({ ...local, feature_models: latest.feature_models })
    setTestMsg(await window.api.ai.test())
    setTesting(false)
  }

  const models = modelsFor(local.provider, local.custom_models)
  const currentModel =
    local.provider === 'openai'
      ? local.openai_model
      : local.provider === 'claude'
        ? local.claude_model
        : local.gemini_model

  const setModel = (value: string): void =>
    setLocal((l) =>
      l.provider === 'openai'
        ? { ...l, openai_model: value }
        : l.provider === 'claude'
          ? { ...l, claude_model: value }
          : { ...l, gemini_model: value }
    )

  const setKey = (value: string): void =>
    setLocal((l) =>
      l.provider === 'openai'
        ? { ...l, openai_key: value }
        : l.provider === 'claude'
          ? { ...l, claude_key: value }
          : { ...l, gemini_key: value }
    )

  const currentKey =
    local.provider === 'openai'
      ? local.openai_key
      : local.provider === 'claude'
        ? local.claude_key
        : local.gemini_key
  const providerInfo = PROVIDERS[local.provider]

  /** 목록에 모델 이름을 더한다. 저장까지 바로 해서 다른 화면에 즉시 반영된다. */
  const addModel = async (): Promise<void> => {
    const name = newModel.trim()
    if (!name) return
    if (models.includes(name)) {
      toast('이미 목록에 있는 모델입니다.', 'err')
      setNewModel('')
      return
    }
    const next: LocalSettings = {
      ...local,
      custom_models: withCustomModel(local.custom_models ?? {}, local.provider, name)
    }
    setLocal(next)
    setNewModel('')
    const latest = await window.api.local.load()
    await window.api.local.save({ ...next, feature_models: latest.feature_models })
    toast(`'${name}' 을(를) 목록에 넣었습니다.`, 'ok')
  }

  /** 추가했던 모델을 목록에서 뺀다. 기본 제공 모델은 지울 수 없다. */
  const removeModel = async (name: string): Promise<void> => {
    const list = (local.custom_models?.[local.provider] ?? []).filter((m) => m !== name)
    const nextCustom = { ...(local.custom_models ?? {}), [local.provider]: list }

    // 지운 모델을 쓰고 있었다면 남은 것 중 첫 번째로 되돌린다.
    const remaining = modelsFor(local.provider, nextCustom)
    const fallback = remaining[0] ?? ''
    const next: LocalSettings = { ...local, custom_models: nextCustom }
    if (currentModel === name) {
      if (local.provider === 'openai') next.openai_model = fallback
      else if (local.provider === 'claude') next.claude_model = fallback
      else next.gemini_model = fallback
    }

    setLocal(next)
    const latest = await window.api.local.load()
    await window.api.local.save({ ...next, feature_models: latest.feature_models })
    toast(`'${name}' 을(를) 목록에서 뺐습니다.`)
  }

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
            {(['gemini', 'openai', 'claude'] as const).map((p) => (
              <button
                key={p}
                className={`btn ${local.provider === p ? 'btn-primary' : ''}`}
                onClick={() => setLocal({ ...local, provider: p })}
              >
                {PROVIDERS[p].label}
              </button>
            ))}
          </div>
          <div className="hint">
            {providerInfo.keyHint}{' '}
            <button className="link" onClick={() => void window.api.shell.open(providerInfo.keyUrl)}>
              키 발급 페이지 열기
            </button>
          </div>
        </div>

        <div className="field">
          <label>{providerInfo.label} API 키</label>
          <input
            type="password"
            value={currentKey}
            onChange={(e) => setKey(e.target.value)}
            placeholder={providerInfo.placeholder}
          />
        </div>

        <div className="field">
          <label>기본 모델</label>
          <select value={currentModel} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
                {isBuiltinModel(local.provider, m) ? '' : '  (직접 추가)'}
              </option>
            ))}
            {/* 목록에 없는 값이 저장돼 있으면 그것도 보여 준다 */}
            {currentModel && !models.includes(currentModel) && (
              <option value={currentModel}>{currentModel}</option>
            )}
          </select>
          <div className="hint">
            각 AI 화면에서 따로 고르지 않았을 때 쓰는 모델입니다. 화면마다 다른 모델을 쓰고 싶으면
            그 화면 위쪽의 [모델] 고르개에서 바꾸면 됩니다.
          </div>
        </div>

        <div className="field">
          <label>모델 목록 관리 — {providerInfo.label}</label>
          <div className="row">
            <input
              type="text"
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addModel()
              }}
              placeholder="새 모델 이름 (예: gpt-5.6-luna)"
              style={{ flex: 1, minWidth: 200 }}
            />
            <button className="btn" onClick={() => void addModel()} disabled={!newModel.trim()}>
              ＋ 목록에 추가
            </button>
          </div>

          <div className="model-chips">
            {models.map((m) => {
              const builtin = isBuiltinModel(local.provider, m)
              return (
                <span key={m} className={`model-chip ${builtin ? '' : 'custom'}`}>
                  {m}
                  {!builtin && (
                    <button
                      className="model-chip-x"
                      title="목록에서 빼기"
                      onClick={() => void removeModel(m)}
                    >
                      ×
                    </button>
                  )}
                </span>
              )
            })}
          </div>

          <div className="hint">
            여기에 추가한 이름은 <b>모든 AI 화면의 모델 고르개</b>에 함께 나옵니다. 새 모델이
            나오면 이름만 넣어 두면 됩니다. 기본 제공 모델은 지울 수 없고, 직접 추가한 것만 × 로
            뺍니다.
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

      <div className="card">
        <div className="card-title">기한 알림 · 자동 실행</div>
        <p className="muted small" style={{ marginTop: 0 }}>
          이 설정은 <b>이 컴퓨터에만</b> 저장되고 인수인계 파일에 들어가지 않습니다.
        </p>

        <label className="row" style={{ gap: 8, cursor: 'pointer', marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={local.notify_deadlines}
            onChange={(e) => setLocal({ ...local, notify_deadlines: e.target.checked })}
            style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
          />
          <span className="small">
            <b>기한이 다가오면 윈도우 알림 띄우기</b>
          </span>
        </label>

        {local.notify_deadlines && (
          <div className="field" style={{ maxWidth: 220, marginLeft: 23 }}>
            <label>며칠 전부터 알릴까요</label>
            <input
              type="number"
              min={0}
              max={30}
              value={local.notify_days}
              onChange={(e) =>
                setLocal({ ...local, notify_days: Number.parseInt(e.target.value, 10) || 0 })
              }
            />
          </div>
        )}

        <label className="row" style={{ gap: 8, cursor: 'pointer', marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={local.keep_in_tray}
            onChange={(e) => setLocal({ ...local, keep_in_tray: e.target.checked })}
            style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
          />
          <span className="small">
            <b>창을 닫아도 시계 옆에 남기기</b>
            <span className="muted">
              {' '}
              — 완전히 끄려면 시계 옆 아이콘을 우클릭 → [완전히 종료]
            </span>
          </span>
        </label>

        <label className="row" style={{ gap: 8, cursor: 'pointer', marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={local.open_at_login}
            onChange={(e) => setLocal({ ...local, open_at_login: e.target.checked })}
            style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
          />
          <span className="small">
            <b>컴퓨터를 켤 때 자동으로 실행하기</b>
          </span>
        </label>

        {local.notify_deadlines && !local.keep_in_tray && (
          <div className="note note-warn">
            알림은 <b>프로그램이 켜져 있을 때만</b> 뜹니다. 창을 닫으면 알림도 멈춥니다.
            위의 <b>[창을 닫아도 시계 옆에 남기기]</b> 를 함께 켜 두시길 권합니다.
          </div>
        )}

        <div className="row row-end" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => void window.api.notify.checkNow()}>
            지금 시험해 보기
          </button>
          <button className="btn btn-primary" onClick={() => void saveLocal()}>
            저장
          </button>
        </div>
      </div>
    </>
  )
}
