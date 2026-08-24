import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type {
  AiFeature,
  CustomModels,
  FeatureModels,
  LocalSettings,
  ModelChoice,
  Provider
} from '../../shared/types'

/**
 * API 키는 인수인계 DB가 아니라 이 PC에만 저장한다.
 * 가능하면 OS 키체인(Windows DPAPI / macOS Keychain)으로 암호화하고,
 * 그게 불가능한 환경이면 평문으로 떨어뜨리되 그 사실을 앱에서 알려 준다.
 */

const DEFAULTS: LocalSettings = {
  provider: 'gemini',
  openai_key: '',
  gemini_key: '',
  claude_key: '',
  openai_model: 'gpt-4.1',
  gemini_model: 'gemini-2.5-flash',
  claude_model: 'claude-sonnet-5',
  feature_models: {},
  custom_models: {},
  // 알림·트레이·자동실행은 기본으로 꺼 둔다.
  // 학교 PC에서 모르는 사이에 뭔가 상주하고 있으면 당황스럽기 때문이다.
  notify_deadlines: false,
  notify_days: 3,
  keep_in_tray: false,
  open_at_login: false
}

interface StoredShape {
  provider?: string
  openai_model?: string
  gemini_model?: string
  claude_model?: string
  feature_models?: Record<string, { provider?: string; model?: string }>
  custom_models?: Record<string, unknown>
  notify_deadlines?: boolean
  notify_days?: number
  keep_in_tray?: boolean
  open_at_login?: boolean
  /** base64로 인코딩된 암호문 */
  enc?: { openai_key?: string; gemini_key?: string; claude_key?: string }
  /** 암호화를 못 쓰는 환경일 때만 사용 */
  plain?: { openai_key?: string; gemini_key?: string; claude_key?: string }
}

function coerceProvider(p: string | undefined): Provider {
  return p === 'openai' || p === 'claude' ? p : 'gemini'
}

/** 저장된 값 중 형식이 맞는 것만 남긴다. 잘못된 항목은 조용히 무시. */
function coerceFeatureModels(raw: StoredShape['feature_models']): FeatureModels {
  if (!raw || typeof raw !== 'object') return {}
  const out: FeatureModels = {}
  const keys: AiFeature[] = ['analyze', 'summary', 'scenario', 'chat']
  for (const k of keys) {
    const v = raw[k]
    if (v && typeof v.model === 'string' && v.model.trim()) {
      const choice: ModelChoice = { provider: coerceProvider(v.provider), model: v.model.trim() }
      out[k] = choice
    }
  }
  return out
}

/** 서비스별 문자열 배열만 남긴다. 빈 값·중복은 버리고, 지나치게 길면 자른다. */
function coerceCustomModels(raw: StoredShape['custom_models']): CustomModels {
  if (!raw || typeof raw !== 'object') return {}
  const out: CustomModels = {}
  for (const p of ['gemini', 'openai', 'claude'] as Provider[]) {
    const list = raw[p]
    if (!Array.isArray(list)) continue
    const names: string[] = []
    for (const item of list) {
      if (typeof item !== 'string') continue
      const m = item.trim().slice(0, 100)
      if (m && !names.includes(m)) names.push(m)
    }
    if (names.length) out[p] = names.slice(0, 50)
  }
  return out
}

function filePath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function read(): StoredShape {
  try {
    return JSON.parse(fs.readFileSync(filePath(), 'utf-8')) as StoredShape
  } catch {
    return {}
  }
}

function decrypt(value: string | undefined): string {
  if (!value) return ''
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    return ''
  }
}

export function loadLocalSettings(): LocalSettings {
  const raw = read()
  const useEnc = encryptionAvailable()

  const openai_key = useEnc ? decrypt(raw.enc?.openai_key) : (raw.plain?.openai_key ?? '')
  const gemini_key = useEnc ? decrypt(raw.enc?.gemini_key) : (raw.plain?.gemini_key ?? '')
  const claude_key = useEnc ? decrypt(raw.enc?.claude_key) : (raw.plain?.claude_key ?? '')

  return {
    provider: coerceProvider(raw.provider),
    openai_key,
    gemini_key,
    claude_key,
    openai_model: raw.openai_model || DEFAULTS.openai_model,
    gemini_model: raw.gemini_model || DEFAULTS.gemini_model,
    claude_model: raw.claude_model || DEFAULTS.claude_model,
    feature_models: coerceFeatureModels(raw.feature_models),
    custom_models: coerceCustomModels(raw.custom_models),
    notify_deadlines: raw.notify_deadlines ?? DEFAULTS.notify_deadlines,
    notify_days: raw.notify_days ?? DEFAULTS.notify_days,
    keep_in_tray: raw.keep_in_tray ?? DEFAULTS.keep_in_tray,
    open_at_login: raw.open_at_login ?? DEFAULTS.open_at_login
  }
}

export function saveLocalSettings(next: LocalSettings): void {
  const useEnc = encryptionAvailable()
  const out: StoredShape = {
    provider: next.provider,
    openai_model: next.openai_model || DEFAULTS.openai_model,
    gemini_model: next.gemini_model || DEFAULTS.gemini_model,
    claude_model: next.claude_model || DEFAULTS.claude_model,
    feature_models: next.feature_models ?? {},
    custom_models: next.custom_models ?? {},
    notify_deadlines: next.notify_deadlines,
    notify_days: next.notify_days || DEFAULTS.notify_days,
    keep_in_tray: next.keep_in_tray,
    open_at_login: next.open_at_login
  }

  const enc = (v: string): string => (v ? safeStorage.encryptString(v).toString('base64') : '')

  if (useEnc) {
    out.enc = {
      openai_key: enc(next.openai_key),
      gemini_key: enc(next.gemini_key),
      claude_key: enc(next.claude_key)
    }
  } else {
    out.plain = {
      openai_key: next.openai_key,
      gemini_key: next.gemini_key,
      claude_key: next.claude_key
    }
  }

  const target = filePath()
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, target)
}
