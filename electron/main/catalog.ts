/**
 * 도구 모음 · 받은 테마 목록을 저장소의 remote/catalog.json 에서 받는다 (규칙은 shared/catalog.ts).
 *
 * - GitHub(raw) 에서 먼저, 안 되면 jsDelivr 사본에서 받는다. 학교망에서 한쪽이 막힐 때를 위해서다.
 * - 받은 것은 이 PC 에 두고(catalog.json) 3시간 동안 다시 받지 않는다. 못 받으면 마지막에 받은 것을,
 *   그것도 없으면 설치파일에 들어 있는 목록을 쓴다 — 인터넷이 없어도 화면이 비지 않는다.
 * - 잘못 적힌 파일을 받으면 버리고 마지막으로 제대로 받은 것을 계속 쓴다.
 * 보내는 것은 없다(파일 하나를 받기만 한다).
 */

import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import builtin from '../../remote/catalog.json'
import type { Catalog, CatalogResult } from '../../shared/catalog'
import { sanitizeCatalog } from '../../shared/catalog'
import { httpFetch } from './http'

export const CATALOG_SOURCES = [
  'https://raw.githubusercontent.com/sced9120/work-dashboard/main/remote/catalog.json',
  'https://cdn.jsdelivr.net/gh/sced9120/work-dashboard@main/remote/catalog.json'
]
const TTL = 3 * 60 * 60 * 1000

interface Stored {
  fetchedAt: number
  catalog: Catalog
}

const file = (): string => path.join(app.getPath('userData'), 'catalog.json')

function readStored(): Stored | null {
  try {
    const v = JSON.parse(fs.readFileSync(file(), 'utf8')) as Stored
    if (typeof v?.fetchedAt !== 'number') return null
    return { fetchedAt: v.fetchedAt, catalog: sanitizeCatalog(v.catalog).catalog }
  } catch {
    return null
  }
}

async function fetchOne(url: string): Promise<Catalog> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12000)
  try {
    // 받은 쪽 캐시 대신 새것을 달라고 한다 (GitHub 은 몇 분, jsDelivr 는 몇 시간 들고 있을 수 있다)
    const res = await httpFetch(url, { signal: ctrl.signal, headers: { 'Cache-Control': 'no-cache' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new Error('목록 파일의 형식이 맞지 않습니다')
    }
    return sanitizeCatalog(raw).catalog
  } finally {
    clearTimeout(timer)
  }
}

let inflight: Promise<CatalogResult> | null = null

/** force 면 3시간이 안 지났어도 새로 받는다 */
export function getCatalog(force = false): Promise<CatalogResult> {
  const stored = readStored()
  if (!force && stored && Date.now() - stored.fetchedAt < TTL) {
    return Promise.resolve({ catalog: stored.catalog, fetchedAt: stored.fetchedAt, from: 'cache' })
  }
  if (inflight) return inflight
  inflight = (async (): Promise<CatalogResult> => {
    let error = ''
    /** 한 곳이라도 답을 했으면 인터넷은 되는 것이다 */
    let reached = false
    for (const url of CATALOG_SOURCES) {
      try {
        const catalog = await fetchOne(url)
        const fetchedAt = Date.now()
        try {
          fs.writeFileSync(file(), JSON.stringify({ fetchedAt, catalog } satisfies Stored))
        } catch {
          // 못 적어도 이번에는 받은 것을 쓴다
        }
        return { catalog, fetchedAt, from: 'net' }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
        if (/^HTTP |형식/.test(error)) reached = true
      }
    }
    const msg = reached
      ? `도구 목록을 새로 받지 못했습니다 (${error}). 잠시 뒤 [새로 받기]를 눌러 주세요.`
      : '도구 목록을 새로 받지 못했습니다. 인터넷 연결을 확인해 주세요.'
    if (stored) return { catalog: stored.catalog, fetchedAt: stored.fetchedAt, from: 'cache', error: msg }
    return { catalog: sanitizeCatalog(builtin).catalog, fetchedAt: 0, from: 'builtin', error: msg }
  })().finally(() => {
    inflight = null
  })
  return inflight
}
