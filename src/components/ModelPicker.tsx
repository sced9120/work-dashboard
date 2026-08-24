import { useEffect, useMemo, useState } from 'react'
import type {
  AiFeature,
  LocalSettings,
  ModelChoice,
  Provider
} from '../../shared/types'
import { modelsFor, withCustomModel } from '../../shared/types'

interface Props {
  feature: AiFeature
  /** 짧은 라벨. 없으면 "이 기능에 쓸 모델" */
  label?: string
  /** 값이 바뀔 때 호출. 화면에서 곧바로 반영하고 싶을 때 쓴다. */
  onChange?: (choice: ModelChoice) => void
  /** 지금 이 기능에 쓸 모델(호출 시 그대로 넘기면 된다). 준비 전엔 null. */
  onReady?: (choice: ModelChoice | null) => void
}

const PROVIDER_LABEL: Record<Provider, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  claude: 'Claude (Anthropic)'
}

/** 서비스에 키가 있는지 */
function hasKey(s: LocalSettings, p: Provider): boolean {
  if (p === 'openai') return !!s.openai_key
  if (p === 'claude') return !!s.claude_key
  return !!s.gemini_key
}

/** 서비스별 저장된 기본 모델 */
function defaultModel(s: LocalSettings, p: Provider): string {
  if (p === 'openai') return s.openai_model
  if (p === 'claude') return s.claude_model
  return s.gemini_model
}

/** 이 기능에 쓸 (서비스·모델). 저장된 선택이 있으면 그것, 없으면 전역 기본. */
function initialChoice(s: LocalSettings, feature: AiFeature): ModelChoice {
  const saved = s.feature_models?.[feature]
  if (saved?.model) return saved
  const p = saved?.provider ?? s.provider
  return { provider: p, model: defaultModel(s, p) }
}

const OPT_SEP = '⦙' // 사용자가 모델 이름에 안 쓸 만한 구분자

/**
 * AI 기능별 서비스·모델 고르개.
 * 저장된 API 키가 있는 서비스만 활성화된다.
 * 선택은 이 PC 설정에 저장돼 다음에도 이어진다.
 */
export default function ModelPicker({
  feature,
  label = '이 기능에 쓸 모델',
  onChange,
  onReady
}: Props): JSX.Element {
  const [settings, setSettings] = useState<LocalSettings | null>(null)
  const [choice, setChoice] = useState<ModelChoice | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [custom, setCustom] = useState('')

  useEffect(() => {
    void (async () => {
      const s = await window.api.local.load()
      setSettings(s)
      const c = initialChoice(s, feature)
      setChoice(c)
      onReady?.(c)
    })()
    // feature 은 마운트당 한 번만 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature])

  const availableProviders = useMemo<Provider[]>(() => {
    if (!settings) return []
    return (['gemini', 'openai', 'claude'] as Provider[]).filter((p) => hasKey(settings, p))
  }, [settings])

  const applyChoice = async (
    next: ModelChoice,
    customModels?: LocalSettings['custom_models']
  ): Promise<void> => {
    if (!settings) return
    setChoice(next)
    onChange?.(next)
    onReady?.(next)
    // 다른 화면에서 그 사이 바뀌었을 수 있으니, 저장 직전 최신값 위에 얹는다.
    const latest = await window.api.local.load()
    const merged: LocalSettings = {
      ...latest,
      custom_models: customModels ?? latest.custom_models,
      feature_models: { ...(latest.feature_models ?? {}), [feature]: next }
    }
    setSettings(merged)
    await window.api.local.save(merged)
  }

  const onSelectChange = (raw: string): void => {
    if (!settings) return
    if (raw === '__custom__') {
      setCustomOpen(true)
      setCustom(choice?.model ?? '')
      return
    }
    const [provider, model] = raw.split(OPT_SEP) as [Provider, string]
    if (!provider || !model) return
    setCustomOpen(false)
    void applyChoice({ provider, model })
  }

  /** 직접 입력한 모델은 목록에도 넣어 둔다. 다음부터는 드롭다운에서 바로 고른다. */
  const commitCustom = (): void => {
    const m = custom.trim()
    if (!m || !choice || !settings) return
    const nextCustom = withCustomModel(settings.custom_models ?? {}, choice.provider, m)
    setSettings({ ...settings, custom_models: nextCustom })
    void applyChoice({ provider: choice.provider, model: m }, nextCustom)
    setCustomOpen(false)
  }

  if (!settings || !choice) return <div className="model-picker muted small">모델 정보 불러오는 중…</div>

  if (availableProviders.length === 0) {
    return (
      <div className="note note-warn model-picker">
        설정에 등록된 API 키가 없습니다. 먼저 [설정]에서 서비스 하나의 키를 넣어 주세요.
      </div>
    )
  }

  const selectValue = `${choice.provider}${OPT_SEP}${choice.model}`
  // 현재 모델이 목록에 없으면 select 에 표시할 임시 옵션을 넣어 준다.
  const extraOption = !modelsFor(choice.provider, settings.custom_models).includes(choice.model)
    ? choice.model
    : null

  return (
    <div className="model-picker">
      <label className="model-picker-label">{label}</label>
      <div className="model-picker-row">
        <select
          className="model-picker-select"
          value={customOpen ? '__custom__' : selectValue}
          onChange={(e) => onSelectChange(e.target.value)}
        >
          {(['gemini', 'openai', 'claude'] as Provider[]).map((p) => {
            const enabled = availableProviders.includes(p)
            return (
              <optgroup key={p} label={`${PROVIDER_LABEL[p]}${enabled ? '' : ' (키 없음)'}`}>
                {modelsFor(p, settings.custom_models).map((m) => (
                  <option key={m} value={`${p}${OPT_SEP}${m}`} disabled={!enabled}>
                    {m}
                  </option>
                ))}
                {extraOption && p === choice.provider && (
                  <option value={`${p}${OPT_SEP}${extraOption}`}>{extraOption} (직접 입력)</option>
                )}
              </optgroup>
            )
          })}
          <option value="__custom__">✏️ 다른 모델 이름 직접 입력…</option>
        </select>
      </div>

      {customOpen && (
        <div className="model-picker-row" style={{ marginTop: 6 }}>
          <select
            className="model-picker-provider"
            value={choice.provider}
            onChange={(e) => setChoice({ ...choice, provider: e.target.value as Provider })}
          >
            {(['gemini', 'openai', 'claude'] as Provider[]).map((p) => (
              <option key={p} value={p} disabled={!availableProviders.includes(p)}>
                {PROVIDER_LABEL[p]}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCustom()
            }}
            placeholder="예: gpt-4.1-mini · claude-opus-5 · gemini-2.5-pro"
            className="model-picker-input"
          />
          <button className="btn btn-sm btn-primary" onClick={commitCustom} disabled={!custom.trim()}>
            적용
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setCustomOpen(false)}>
            취소
          </button>
        </div>
      )}
    </div>
  )
}
