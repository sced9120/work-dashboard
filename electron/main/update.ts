/**
 * GitHub 릴리스를 보고 새 버전이 올라왔는지 확인한다.
 *
 * 설치까지 대신하지는 않는다. 새 버전이 있으면 화면에 알려 주고,
 * 누르면 내려받는 페이지를 열어 주는 것까지만 한다.
 * 그래야 설치형과 Portable 둘 다에서 똑같이 동작하고,
 * 학교 PC에서 프로그램이 스스로 파일을 갈아끼우는 일도 없다.
 */

import { app } from 'electron'
import type { UpdateInfo } from '../../shared/types'
import { canAutoInstall } from './autoupdate'

/** 릴리스를 올리는 저장소. 저장소를 옮기면 이 줄만 고치면 된다. */
const REPO = 'sced9120/work-dashboard'

const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`
const API = `https://api.github.com/repos/${REPO}/releases/latest`

/** 학교망에서 막히면 오래 기다리지 않고 포기한다. */
const TIMEOUT_MS = 6000

/** "v1.2.0" / "1.2" 같은 표기를 숫자 셋으로 바꾼다. */
function parts(v: string): number[] {
  return v
    .trim()
    .replace(/^v/i, '')
    .split(/[.\-+]/)
    .slice(0, 3)
    .map((n) => Number.parseInt(n, 10) || 0)
}

/** latest 가 current 보다 높은 버전인가 */
export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest)
  const b = parts(current)
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion()
  const base: UpdateInfo = {
    available: false,
    current,
    latest: '',
    url: RELEASES_PAGE,
    canAutoInstall: canAutoInstall()
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal
    })
    if (!res.ok) return { ...base, error: `GitHub 응답 ${res.status}` }

    const data = (await res.json()) as { tag_name?: unknown; html_url?: unknown }
    const tag = typeof data.tag_name === 'string' ? data.tag_name : ''
    if (!tag) return { ...base, error: '릴리스 정보를 읽지 못했습니다.' }

    return {
      ...base,
      available: isNewer(tag, current),
      latest: tag.replace(/^v/i, ''),
      url: typeof data.html_url === 'string' ? data.html_url : RELEASES_PAGE
    }
  } catch (e) {
    // 인터넷이 없거나 학교망이 막은 경우. 조용히 넘긴다.
    return {
      ...base,
      error: e instanceof Error && e.name === 'AbortError' ? '확인 시간이 지났습니다.' : '확인하지 못했습니다.'
    }
  } finally {
    clearTimeout(timer)
  }
}
