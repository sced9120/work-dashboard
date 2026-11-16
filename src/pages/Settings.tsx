import { useEffect, useState } from 'react'
import type { LocalSettings, Provider } from '../../shared/types'
import {
  addModel as addToLists,
  isBuiltinModel,
  modelsFor,
  removeModel as removeFromLists,
  resetModels
} from '../../shared/types'
import { LEVEL_KEY, SCHOOL_LEVELS } from '../../shared/helpdocs'
import { geminiModeOf, geminiReady } from '../../shared/gemini'
import { diffModels } from '../../shared/modelList'
import NeisSettings from '../components/NeisSettings'
import ThemeSettings from '../components/ThemeSettings'
import ShellSettings from '../components/ShellSettings'
import MenuSettings from '../components/MenuSettings'
import FeedbackCard from '../components/FeedbackCard'
import { useToast } from '../lib/toast'

interface Props {
  onProfileChanged: () => Promise<void>
}

const DEFAULT_LOCAL: LocalSettings = {
  provider: 'gemini',
  openai_key: '',
  gemini_key: '',
  gemini_mode: 'key',
  vertex_project: '',
  vertex_location: 'global',
  claude_key: '',
  exaone_key: '',
  openai_model: 'gpt-6-sol',
  gemini_model: 'gemini-3.6-flash',
  claude_model: 'claude-sonnet-5-5',
  exaone_model: 'k-exaone_v2.5',
  feature_models: {},
  custom_models: {},
  hidden_models: {},
  notify_deadlines: false,
  notify_days: 3,
  keep_in_tray: false,
  open_at_login: false,
  start_hidden: false,
  neis_key: '',
  gcal_url: '',
  relay_url: '',
  relay_key: ''
}

/** 서비스별 이름·키 발급처·키 생김새 · 모델 목록 · 가격 문서 */
const PROVIDERS: Record<
  Provider,
  { label: string; keyUrl: string; keyHint: string; placeholder: string; modelsUrl: string; pricingUrl: string }
> = {
  gemini: {
    label: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'Google AI Studio(aistudio.google.com/apikey)에서 무료로 키를 만들 수 있습니다.',
    placeholder: 'AIza…',
    modelsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    pricingUrl: 'https://ai.google.dev/gemini-api/docs/pricing'
  },
  openai: {
    label: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'platform.openai.com/api-keys 에서 키를 만들 수 있습니다. 사용량만큼 과금됩니다.',
    placeholder: 'sk-…',
    modelsUrl: 'https://developers.openai.com/api/docs/models',
    pricingUrl: 'https://developers.openai.com/api/docs/pricing'
  },
  claude: {
    label: 'Claude (Anthropic)',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint:
      'console.anthropic.com/settings/keys 에서 키를 만들 수 있습니다. 사용량만큼 과금됩니다.',
    placeholder: 'sk-ant-…',
    modelsUrl: 'https://platform.claude.com/docs/en/models/overview',
    pricingUrl: 'https://platform.claude.com/docs/en/about-claude/pricing'
  },
  exaone: {
    label: 'K-EXAONE (LG)',
    keyUrl: 'https://docs.exaone.ai/',
    keyHint:
      'LG AI연구원 EXAONE API Platform(docs.exaone.ai)에서 [API Key 발급하기] 로 무료로 키를 만들 수 있습니다. 글만 읽습니다 — 사진 · 스캔 PDF 를 읽는 기능(문서 스캔 · 폴더째 정리)은 Gemini · OpenAI 로 합니다. 1초에 한 번 · 1분에 60번까지 부를 수 있습니다.',
    placeholder: 'EXAONE API 키',
    modelsUrl: 'https://docs.exaone.ai/ko/docs/models',
    pricingUrl: 'https://docs.exaone.ai/ko/docs/rate-limits'
  }
}

const keyOf = (l: LocalSettings, p: Provider): string =>
  p === 'openai' ? l.openai_key : p === 'claude' ? l.claude_key : p === 'exaone' ? l.exaone_key ?? '' : geminiReady(l) ? 'ok' : ''

export default function Settings({ onProfileChanged }: Props): JSX.Element {
  const toast = useToast()
  const [job, setJob] = useState('')
  const [school, setSchool] = useState('')
  const [level, setLevel] = useState('')
  const [local, setLocal] = useState<LocalSettings>(DEFAULT_LOCAL)
  const [encrypted, setEncrypted] = useState(true)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null)
  const [newModel, setNewModel] = useState('')
  /** [최신 목록 불러오기] 결과 — added: 새로 쓸 수 있는 것 · missing: 기본 목록에는 있는데 서비스 목록에 없는 것 */
  const [fetchedList, setFetchedList] = useState<{ provider: Provider; added: string[]; missing: string[] } | null>(null)
  const [fetchingList, setFetchingList] = useState(false)
  const [pickedNew, setPickedNew] = useState<string[]>([])
  const [roster, setRoster] = useState('')
  const [reading, setReading] = useState(false)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    void (async () => {
      setJob(await window.api.setting.get('job_title'))
      setSchool(await window.api.setting.get('school_name'))
      setLevel(await window.api.setting.get(LEVEL_KEY))
      setRoster(await window.api.setting.get('duty_roster'))
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
    await window.api.setting.set(LEVEL_KEY, level)
    await window.api.setting.set('duty_roster', roster.trim())
    await onProfileChanged()
    toast('저장했습니다.', 'ok')
  }

  /** 업무분장표 파일에서 글을 뽑아 칸에 채운다. */
  const pickRoster = async (): Promise<void> => {
    const picked = await window.api.files.pick()
    if (!picked.length) return
    setReading(true)
    try {
      const parts: string[] = []
      for (const p of picked) {
        const doc = await window.api.files.extract(p.path)
        if (doc.error) toast(`${p.name}: ${doc.error}`, 'err')
        else if (doc.text.trim()) parts.push(doc.text)
      }
      if (parts.length) {
        setRoster((prev) => [prev, ...parts].filter(Boolean).join('\n\n'))
        toast(`${parts.length}개 문서에서 읽어 왔습니다.`, 'ok')
      }
    } finally {
      setReading(false)
    }
  }

  const saveLocal = async (): Promise<void> => {
    // Settings 는 feature_models 를 다루지 않는다. 다른 화면(ModelPicker)이
    // 그 사이 저장했을 값을 덮어쓰지 않도록, 직전 값을 그대로 다시 실어 보낸다.
    const latest = await window.api.local.load()
    await window.api.local.save({ ...local, feature_models: latest.feature_models, neis_key: latest.neis_key, gcal_url: latest.gcal_url, relay_url: latest.relay_url, relay_key: latest.relay_key })
    const now = await window.api.local.load()
    setLocal((l) => ({ ...l, vertex_express_key: undefined, vertex_express_key_set: now.vertex_express_key_set, vertex_sa_set: now.vertex_sa_set }))
    toast('저장했습니다.', 'ok')
  }

  /** 서비스 계정 JSON 고르기 — 파일은 프로그램(메인)이 읽어 암호화해 두고, 여기에는 이메일 · 프로젝트만 온다 */
  const pickSa = async (): Promise<void> => {
    setPicking(true)
    try {
      const r = await window.api.vertex.pickSa()
      if (r.canceled) return
      if (!r.ok) {
        toast(r.error ?? '서비스 계정 JSON 을 읽지 못했습니다.', 'err')
        return
      }
      setLocal((l) => ({
        ...l,
        vertex_sa_set: true,
        vertex_email: r.email ?? '',
        vertex_project: (l.vertex_project ?? '').trim() ? l.vertex_project : (r.project ?? '')
      }))
      toast('서비스 계정을 연결했습니다. 프로젝트 ID · 위치를 확인하고 [저장] 을 눌러 주세요.', 'ok')
    } finally {
      setPicking(false)
    }
  }

  const clearSa = async (): Promise<void> => {
    await window.api.vertex.clearSa()
    setLocal((l) => ({ ...l, vertex_sa_set: false, vertex_email: '' }))
    toast('서비스 계정을 뺐습니다.')
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestMsg(null)
    // Settings 는 feature_models 를 다루지 않는다. 다른 화면(ModelPicker)이
    // 그 사이 저장했을 값을 덮어쓰지 않도록, 직전 값을 그대로 다시 실어 보낸다.
    const latest = await window.api.local.load()
    await window.api.local.save({ ...local, feature_models: latest.feature_models, neis_key: latest.neis_key, gcal_url: latest.gcal_url, relay_url: latest.relay_url, relay_key: latest.relay_key })
    const now = await window.api.local.load()
    setLocal((l) => ({ ...l, vertex_express_key: undefined, vertex_express_key_set: now.vertex_express_key_set, vertex_sa_set: now.vertex_sa_set }))
    setTestMsg(await window.api.ai.test())
    setTesting(false)
  }

  const models = modelsFor(local.provider, local.custom_models, local.hidden_models)
  const currentModel =
    local.provider === 'openai'
      ? local.openai_model
      : local.provider === 'claude'
        ? local.claude_model
        : local.provider === 'exaone'
          ? local.exaone_model
          : local.gemini_model

  const setModel = (value: string): void =>
    setLocal((l) =>
      l.provider === 'openai'
        ? { ...l, openai_model: value }
        : l.provider === 'claude'
          ? { ...l, claude_model: value }
          : l.provider === 'exaone'
            ? { ...l, exaone_model: value }
            : { ...l, gemini_model: value }
    )

  const setKey = (value: string): void =>
    setLocal((l) =>
      l.provider === 'openai'
        ? { ...l, openai_key: value }
        : l.provider === 'claude'
          ? { ...l, claude_key: value }
          : l.provider === 'exaone'
            ? { ...l, exaone_key: value }
            : { ...l, gemini_key: value }
    )

  const currentKey =
    local.provider === 'openai'
      ? local.openai_key
      : local.provider === 'claude'
        ? local.claude_key
        : local.provider === 'exaone'
          ? local.exaone_key
          : local.gemini_key
  const providerInfo = PROVIDERS[local.provider]
  const gMode = geminiModeOf(local)
  const cloudGemini = local.provider === 'gemini' && gMode !== 'key'

  /** 목록 변경을 화면과 파일에 함께 반영한다. */
  const applyLists = async (
    lists: { custom: LocalSettings['custom_models']; hidden: LocalSettings['hidden_models'] }
  ): Promise<void> => {
    const next: LocalSettings = { ...local, custom_models: lists.custom, hidden_models: lists.hidden }

    // 쓰고 있던 모델이 목록에서 사라졌다면 남은 것 중 첫 번째로 되돌린다.
    const remaining = modelsFor(local.provider, lists.custom, lists.hidden)
    if (currentModel && !remaining.includes(currentModel)) {
      const fallback = remaining[0] ?? ''
      if (local.provider === 'openai') next.openai_model = fallback
      else if (local.provider === 'claude') next.claude_model = fallback
      else if (local.provider === 'exaone') next.exaone_model = fallback
      else next.gemini_model = fallback
    }

    setLocal(next)
    const latest = await window.api.local.load()
    await window.api.local.save({ ...next, feature_models: latest.feature_models, neis_key: latest.neis_key, gcal_url: latest.gcal_url, relay_url: latest.relay_url, relay_key: latest.relay_key })
  }

  const lists = { custom: local.custom_models ?? {}, hidden: local.hidden_models ?? {} }
  const hiddenCount = (local.hidden_models?.[local.provider] ?? []).length

  /** 목록에 모델 이름을 더한다. 저장까지 바로 해서 다른 화면에 즉시 반영된다. */
  const addModel = async (): Promise<void> => {
    const name = newModel.trim()
    if (!name) return
    if (models.includes(name)) {
      toast('이미 목록에 있는 모델입니다.', 'err')
      setNewModel('')
      return
    }
    setNewModel('')
    await applyLists(addToLists(lists, local.provider, name))
    toast(`'${name}' 을(를) 목록에 넣었습니다.`, 'ok')
  }

  /** 서비스에 이 키로 쓸 수 있는 모델을 물어 보고, 아직 목록에 없는 것을 보여 준다 */
  const fetchLatest = async (): Promise<void> => {
    const p = local.provider
    setFetchingList(true)
    setFetchedList(null)
    setPickedNew([])
    try {
      const r = await window.api.ai.listModels(p)
      if (!r.ok || !r.models) {
        toast(r.error ?? '목록을 불러오지 못했습니다.', 'err')
        return
      }
      const d = diffModels(r.models, models)
      setFetchedList({ provider: p, added: d.added, missing: d.missing.filter((m) => isBuiltinModel(p, m)) })
    } finally {
      setFetchingList(false)
    }
  }

  /** 고른 새 모델을 직접 추가와 같은 방법으로 목록에 넣는다 */
  const addPicked = async (): Promise<void> => {
    if (pickedNew.length === 0) return
    let next = lists
    for (const m of pickedNew) next = addToLists(next, local.provider, m)
    await applyLists(next)
    toast(`${pickedNew.length}개를 목록에 넣었습니다.`, 'ok')
    setFetchedList((f) => (f ? { ...f, added: f.added.filter((m) => !pickedNew.includes(m)) } : f))
    setPickedNew([])
  }

  /** 목록에서 모델을 뺀다. 기본 제공 모델도 뺄 수 있다(되돌리기로 복구). */
  const removeModel = async (name: string): Promise<void> => {
    if (models.length <= 1) {
      toast('마지막 하나는 남겨 두세요. 먼저 다른 모델을 추가한 뒤 빼면 됩니다.', 'err')
      return
    }
    await applyLists(removeFromLists(lists, local.provider, name))
    toast(`'${name}' 을(를) 목록에서 뺐습니다.`)
  }

  /** 이 서비스의 목록을 처음 상태로 되돌린다. */
  const restoreModels = async (): Promise<void> => {
    await applyLists(resetModels(lists, local.provider))
    toast('기본 목록으로 되돌렸습니다.', 'ok')
  }

  return (
    <>
      <div className="page-head">
        <h1>설정</h1>
        <p>화면 구성 · 테마 · 메뉴, 담당 업무 정보, AI 연결을 관리합니다.</p>
      </div>

      <ShellSettings />
      <ThemeSettings />
      <MenuSettings />
      <FeedbackCard />

      <div className="card">
        <div className="card-title">담당 업무</div>
        <div className="field">
          <label>담당 업무명</label>
          <input type="text" value={job} onChange={(e) => setJob(e.target.value)} />
          <div className="hint">이 값은 인수인계 파일에 함께 저장됩니다.</div>
        </div>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <label>학교명</label>
            <input type="text" value={school} onChange={(e) => setSchool(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 150 }}>
            <label>학교급</label>
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">— 고르지 않음 —</option>
              {SCHOOL_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <div className="hint">학교업무 도움자료를 이 학교급 것부터 보여 줍니다.</div>
          </div>
        </div>

        <div className="field">
          <label>업무분장표</label>
          <div className="row" style={{ marginBottom: 6 }}>
            <button className="btn btn-sm" onClick={() => void pickRoster()} disabled={reading}>
              {reading ? '읽는 중…' : '파일에서 불러오기'}
            </button>
            <span className="muted small">한글·엑셀·PDF 에서 글을 뽑아 옵니다</span>
            {roster && (
              <>
                <span className="spacer" />
                <button className="btn btn-sm btn-ghost" onClick={() => setRoster('')}>
                  비우기
                </button>
              </>
            )}
          </div>
          <textarea
            value={roster}
            onChange={(e) => setRoster(e.target.value)}
            placeholder={'맡은 일을 줄바꿈으로 적거나, 분장표를 그대로 붙여넣으세요.'}
            rows={6}
          />
          <div className="hint">
            [로드맵] → [업무별] 에서 <b>내 분장에 있는 일</b> 과 <b>전임자가 남긴 그 밖의 자료</b> 를
            갈라 보여 주는 데 씁니다. 비워 두면 가르지 않습니다.
          </div>
        </div>

        <div className="row row-end">
          <button className="btn btn-primary" onClick={() => void saveProfile()}>
            저장
          </button>
        </div>
      </div>

      <NeisSettings
        schoolName={school}
        level={level}
        onApplyProfile={async (name, lv) => {
          setSchool(name)
          setLevel(lv)
          await window.api.setting.set('school_name', name)
          await window.api.setting.set(LEVEL_KEY, lv)
          await onProfileChanged()
        }}
      />

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
            {(['gemini', 'openai', 'claude', 'exaone'] as const).map((p) => (
              <button
                key={p}
                className={`btn ${local.provider === p ? 'btn-primary' : ''}`}
                onClick={() => setLocal({ ...local, provider: p })}
                title={keyOf(local, p)?.trim() ? '키를 넣었습니다' : '키를 아직 넣지 않았습니다'}
              >
                {PROVIDERS[p].label}
                {keyOf(local, p)?.trim() ? ' ✓' : ''}
              </button>
            ))}
          </div>
          {!cloudGemini && (
            <div className="hint">
              {providerInfo.keyHint}{' '}
              <button className="link" onClick={() => void window.api.shell.open(providerInfo.keyUrl)}>
                키 발급 페이지 열기
              </button>
            </div>
          )}
        </div>

        {local.provider === 'gemini' && (
          <div className="field">
            <label>연결 방식</label>
            <div className="row">
              {(
                [
                  ['key', 'API 키', 'API 키 (Google AI Studio)'],
                  ['vertex', 'Vertex AI (서비스 계정)', 'Vertex AI — 서비스 계정 JSON'],
                  ['express', 'Vertex AI Express', 'Vertex AI Express 키']
                ] as const
              ).map(([m, label, title]) => (
                <button
                  key={m}
                  className={`btn ${gMode === m ? 'btn-primary' : ''}`}
                  title={title}
                  onClick={() => setLocal({ ...local, gemini_mode: m })}
                >
                  {label}
                </button>
              ))}
            </div>
            {gMode === 'key' && <div className="hint">Google AI Studio 에서 만든 API 키로 연결합니다(처음 설정과 같습니다).</div>}
          </div>
        )}

        {local.provider === 'gemini' && gMode === 'vertex' && (
          <div className="field">
            <label>서비스 계정 (Google Cloud)</label>
            <div className="row" style={{ marginBottom: 8 }}>
              <button className="btn" onClick={() => void pickSa()} disabled={picking}>
                {picking ? '읽는 중…' : local.vertex_sa_set ? '서비스 계정 JSON 다시 고르기' : '서비스 계정 JSON 고르기'}
              </button>
              {local.vertex_sa_set && (
                <>
                  <span className="small">
                    <b>연결됨:</b> {local.vertex_email || '서비스 계정'} · 프로젝트 {local.vertex_project || '—'}
                  </span>
                  <button className="btn btn-sm btn-ghost" onClick={() => void clearSa()}>
                    빼기
                  </button>
                </>
              )}
            </div>
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div className="field" style={{ flex: 2, minWidth: 200 }}>
                <label>프로젝트 ID</label>
                <input
                  type="text"
                  value={local.vertex_project ?? ''}
                  onChange={(e) => setLocal({ ...local, vertex_project: e.target.value })}
                  placeholder="my-project-123456"
                />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label>위치</label>
                <input
                  type="text"
                  list="vertex-locations"
                  value={local.vertex_location ?? 'global'}
                  onChange={(e) => setLocal({ ...local, vertex_location: e.target.value })}
                  placeholder="global"
                />
                <datalist id="vertex-locations">
                  {['global', 'us-central1', 'asia-northeast3', 'asia-northeast1', 'europe-west4'].map((loc) => (
                    <option key={loc} value={loc} />
                  ))}
                </datalist>
              </div>
            </div>
            <details style={{ marginTop: 6 }}>
              <summary className="small" style={{ cursor: 'pointer' }}>
                처음 설정하는 방법
              </summary>
              <ol className="small" style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                <li>Google Cloud 콘솔에서 프로젝트를 고르고 <b>Vertex AI API</b> 를 사용 설정합니다.</li>
                <li>서비스 계정을 만들고 <b>‘Vertex AI 사용자’</b> 역할(roles/aiplatform.user)을 줍니다.</li>
                <li>그 서비스 계정의 [키] → [키 추가] → <b>JSON</b> 으로 만든 파일을 위 [서비스 계정 JSON 고르기] 로 고릅니다.</li>
              </ol>
              <div className="hint">
                ‘서비스 계정 키 생성 사용 중지됨’ 이 뜨면 조직 정책(iam.disableServiceAccountKeyCreation) 관리자에게 이 프로젝트만 예외를 요청하세요.
              </div>
            </details>
            <div className="note note-warn" style={{ marginTop: 8 }}>
              서비스 계정 JSON 은 비밀 키입니다. 채팅 · 메신저 · 공유 폴더에 올리지 마세요. 이 PC 안에 암호화해 둡니다.
            </div>
            <div className="hint">
              사용량은 고른 Cloud 프로젝트의 결제 계정에 청구됩니다. 결제 → 크레딧에서 잔액 · 만료일을 확인하세요.{' '}
              <button className="link" onClick={() => void window.api.shell.open('https://console.cloud.google.com/billing')}>
                Cloud 결제 열기
              </button>
            </div>
          </div>
        )}

        {local.provider === 'gemini' && gMode === 'express' && (
          <div className="field">
            <label>Vertex AI Express 키</label>
            <div className="row">
              <input
                type="password"
                style={{ flex: 1, minWidth: 200 }}
                value={local.vertex_express_key ?? ''}
                onChange={(e) => setLocal({ ...local, vertex_express_key: e.target.value })}
                placeholder={local.vertex_express_key_set && local.vertex_express_key === undefined ? '저장돼 있습니다 — 바꾸려면 새 키를 넣으세요' : 'Express 모드 API 키'}
              />
              {local.vertex_express_key_set && local.vertex_express_key === undefined && (
                <button className="btn btn-sm btn-ghost" onClick={() => setLocal({ ...local, vertex_express_key: '', vertex_express_key_set: false })}>
                  지우기
                </button>
              )}
            </div>
            <div className="hint">Express 모드는 조건이 맞는 새 사용자에게 따로 제공되는 무료 체험 프로그램입니다. 키는 이 PC 안에 암호화해 둡니다.</div>
          </div>
        )}

        {(local.provider !== 'gemini' || gMode === 'key') && (
          <div className="field">
            <label>{providerInfo.label} API 키</label>
            <input
              type="password"
              value={currentKey}
              onChange={(e) => setKey(e.target.value)}
              placeholder={providerInfo.placeholder}
            />
          </div>
        )}

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
          <label>모델 안내 문서</label>
          <div className="model-docs">
            {(['gemini', 'openai', 'claude', 'exaone'] as const).map((p) => (
              <div key={p} className="model-docs-row">
                <span className="model-docs-name">
                  {PROVIDERS[p].label}
                  {keyOf(local, p)?.trim() ? <span className="badge badge-accent">키 있음</span> : null}
                </span>
                <button className="link" onClick={() => void window.api.shell.open(PROVIDERS[p].modelsUrl)}>
                  모델 목록 ↗
                </button>
                <button className="link" onClick={() => void window.api.shell.open(PROVIDERS[p].pricingUrl)}>
                  가격 ↗
                </button>
              </div>
            ))}
          </div>
          <div className="hint">
            서비스마다 어떤 모델이 있고 얼마인지 보는 공식 문서입니다(브라우저로 엽니다). 새 모델 이름을 찾아 아래 [목록에 추가] 에 넣으면 됩니다.
            스캔 문서 → 엑셀은 Gemini 키가 있으면 Gemini 로, OpenAI 키만 있으면 OpenAI 의 싼 등급(gpt-6-luna)으로 읽습니다.
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
              placeholder="새 모델 이름 (예: gpt-6-luna)"
              style={{ flex: 1, minWidth: 200 }}
            />
            <button className="btn" onClick={() => void addModel()} disabled={!newModel.trim()}>
              ＋ 목록에 추가
            </button>
          </div>

          <div className="model-chips">
            {models.map((m) => (
              <span
                key={m}
                className={`model-chip ${isBuiltinModel(local.provider, m) ? '' : 'custom'}`}
              >
                {m}
                <button
                  className="model-chip-x"
                  title="목록에서 빼기"
                  onClick={() => void removeModel(m)}
                >
                  ×
                </button>
              </span>
            ))}
            {models.length === 0 && <span className="muted small">목록이 비었습니다.</span>}
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn btn-sm" onClick={() => void fetchLatest()} disabled={fetchingList || !keyOf(local, local.provider)?.trim()} title={keyOf(local, local.provider)?.trim() ? '' : '키를 먼저 넣고 저장해 주세요'}>
              {fetchingList ? '불러오는 중…' : '최신 목록 불러오기'}
            </button>
            <span className="muted small">내 키로 쓸 수 있는 모델을 서비스에 물어 봅니다(키는 먼저 저장해 두세요).</span>
          </div>
          {fetchedList && fetchedList.provider === local.provider && (
            <div className="model-fetched">
              {fetchedList.added.length === 0 ? (
                <div className="muted small">새로 넣을 모델이 없습니다. 목록이 최신입니다.</div>
              ) : (
                <>
                  <div className="muted small">공식 목록에 있는 모델입니다. 가격 · 지원 기능은 각 회사 안내를 확인하세요.</div>
                  {fetchedList.added.map((m) => (
                    <label key={m} className="model-fetched-row">
                      <input type="checkbox" checked={pickedNew.includes(m)} onChange={(e) => setPickedNew((a) => (e.target.checked ? [...a, m] : a.filter((x) => x !== m)))} />
                      <span>{m}</span>
                    </label>
                  ))}
                  <button className="btn btn-sm" onClick={() => void addPicked()} disabled={pickedNew.length === 0}>
                    고른 모델 넣기
                  </button>
                </>
              )}
              {fetchedList.missing.length > 0 && (
                <div className="muted small" style={{ marginTop: 8 }}>
                  목록에 없음 (중단되었을 수 있음): {fetchedList.missing.join(' · ')}
                </div>
              )}
            </div>
          )}

          {hiddenCount > 0 && (
            <div className="row" style={{ marginTop: 10 }}>
              <span className="muted small">기본 모델 {hiddenCount}개를 빼 두었습니다.</span>
              <button className="btn btn-sm" onClick={() => void restoreModels()}>
                ↺ 기본 목록으로 되돌리기
              </button>
            </div>
          )}

          <div className="hint">
            여기 있는 이름이 <b>모든 AI 화면의 모델 고르개</b>에 그대로 나옵니다(키를 넣은 서비스만). 새 모델이 나오면
            이름만 넣어 두면 되고, 안 쓰는 모델은 × 로 빼면 됩니다.{' '}
            <b>기본 제공 모델도 뺄 수 있습니다</b> — 실수로 뺐다면 [기본 목록으로 되돌리기]로
            복구됩니다. 파란 딱지는 직접 추가한 것입니다.
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
            <span className="muted"> — 켜지면 창이 화면에 뜹니다</span>
          </span>
        </label>

        {local.open_at_login && local.keep_in_tray && (
          <label className="row" style={{ gap: 8, cursor: 'pointer', marginBottom: 10, marginLeft: 23 }}>
            <input
              type="checkbox"
              checked={local.start_hidden}
              onChange={(e) => setLocal({ ...local, start_hidden: e.target.checked })}
              style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
            />
            <span className="small">
              <b>켤 때는 창을 띄우지 않고 시계 옆에만 두기</b>
              <span className="muted"> — 시계 옆 아이콘을 두 번 눌러 엽니다</span>
            </span>
          </label>
        )}

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
