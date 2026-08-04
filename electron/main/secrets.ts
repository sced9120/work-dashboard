import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { LocalSettings } from '../../shared/types'

/**
 * API 키는 인수인계 DB가 아니라 이 PC에만 저장한다.
 * 가능하면 OS 키체인(Windows DPAPI / macOS Keychain)으로 암호화하고,
 * 그게 불가능한 환경이면 평문으로 떨어뜨리되 그 사실을 앱에서 알려 준다.
 */

const DEFAULTS: LocalSettings = {
  provider: 'gemini',
  openai_key: '',
  gemini_key: '',
  openai_model: 'gpt-4.1',
  gemini_model: 'gemini-2.5-flash'
}

interface StoredShape {
  provider?: string
  openai_model?: string
  gemini_model?: string
  /** base64로 인코딩된 암호문 */
  enc?: { openai_key?: string; gemini_key?: string }
  /** 암호화를 못 쓰는 환경일 때만 사용 */
  plain?: { openai_key?: string; gemini_key?: string }
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

  return {
    provider: raw.provider === 'openai' ? 'openai' : 'gemini',
    openai_key,
    gemini_key,
    openai_model: raw.openai_model || DEFAULTS.openai_model,
    gemini_model: raw.gemini_model || DEFAULTS.gemini_model
  }
}

export function saveLocalSettings(next: LocalSettings): void {
  const useEnc = encryptionAvailable()
  const out: StoredShape = {
    provider: next.provider,
    openai_model: next.openai_model || DEFAULTS.openai_model,
    gemini_model: next.gemini_model || DEFAULTS.gemini_model
  }

  if (useEnc) {
    out.enc = {
      openai_key: next.openai_key
        ? safeStorage.encryptString(next.openai_key).toString('base64')
        : '',
      gemini_key: next.gemini_key ? safeStorage.encryptString(next.gemini_key).toString('base64') : ''
    }
  } else {
    out.plain = { openai_key: next.openai_key, gemini_key: next.gemini_key }
  }

  const target = filePath()
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, target)
}
