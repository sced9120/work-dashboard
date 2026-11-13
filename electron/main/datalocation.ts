/**
 * 자료 폴더 고르기 (3.7.1~) — 학교 PC 와 집 PC 에서 같은 자료를 쓰려고 자료 파일을 USB · OneDrive 같은 폴더에 둘 수 있게 한다.
 *
 *  · 어디에 두는지는 이 PC 의 앱 폴더(userData)에 data-location.json 하나로 적는다. 비어 있으면 지금처럼 이 PC 의 기본 폴더.
 *  · 옮기는 것은 자료 파일(work-dashboard.db) 하나뿐 — AI 키 · 폰 연결 · 백업 · 오류 기록은 PC 마다 따로 둔다.
 *  · 두 PC 가 동시에 같은 파일을 열면 나중에 저장한 쪽이 앞의 것을 덮는다. 그래서 자료 파일 옆에 잠금 파일(PC 이름 · 마지막 시각)을
 *    두고, 다른 PC 가 최근에 쓰고 있었으면 열기 전에 알린다. 잠금은 켜 있는 동안 2분마다 새로 쓰고, 끌 때 지운다.
 */

import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DB_NAME = 'work-dashboard.db'
const LOCK_NAME = 'work-dashboard.lock'
/** 다른 PC 의 잠금이 이보다 오래됐으면 꺼진 것으로 본다(빠르게 꺼져 잠금을 못 지운 경우) */
const LOCK_STALE_MS = 10 * 60 * 1000
const HEARTBEAT_MS = 2 * 60 * 1000

const locationFile = (): string => path.join(app.getPath('userData'), 'data-location.json')
export const defaultDir = (): string => app.getPath('userData')

/** 정해 둔 자료 폴더 (없으면 '') */
export function readLocation(): string {
  try {
    const v = JSON.parse(fs.readFileSync(locationFile(), 'utf8')) as { dir?: unknown }
    return typeof v.dir === 'string' ? v.dir : ''
  } catch {
    return ''
  }
}

export function writeLocation(dir: string): void {
  if (!dir) {
    try {
      fs.unlinkSync(locationFile())
    } catch {
      /* 없으면 그만 */
    }
    return
  }
  fs.writeFileSync(locationFile(), JSON.stringify({ dir, setAt: new Date().toISOString() }, null, 2))
}

export interface Resolved {
  /** 이번에 열 자료 폴더 */
  dir: string
  /** 기본 폴더가 아닌 곳을 쓰는지 */
  custom: boolean
  /** 정해 둔 폴더가 없다(USB 를 안 꽂음 등) — dir 은 기본 폴더 */
  missing: string
}

export function resolveLocation(): Resolved {
  const want = readLocation()
  if (!want) return { dir: defaultDir(), custom: false, missing: '' }
  try {
    if (fs.statSync(want).isDirectory()) return { dir: want, custom: true, missing: '' }
  } catch {
    /* 아래 */
  }
  return { dir: defaultDir(), custom: false, missing: want }
}

/* ---------- 잠금 ---------- */

export interface LockInfo {
  pc: string
  user: string
  at: number
}

const me = (): LockInfo => ({ pc: os.hostname(), user: os.userInfo().username, at: Date.now() })
const lockPath = (dir: string): string => path.join(dir, LOCK_NAME)

/** 다른 PC 가 최근까지 쓰고 있던 잠금 — 없거나 이 PC 것 · 오래된 것이면 null */
export function otherLock(dir: string): LockInfo | null {
  try {
    const v = JSON.parse(fs.readFileSync(lockPath(dir), 'utf8')) as Partial<LockInfo>
    const mine = me()
    if (!v || typeof v.pc !== 'string' || typeof v.at !== 'number') return null
    if (v.pc === mine.pc && v.user === mine.user) return null
    if (Date.now() - v.at > LOCK_STALE_MS) return null
    return { pc: v.pc, user: String(v.user ?? ''), at: v.at }
  } catch {
    return null
  }
}

let heartbeat: NodeJS.Timeout | null = null
let lockedDir = ''

/** 이 PC 가 쓴다고 적고 2분마다 새로 쓴다 — 기본 폴더(이 PC 에만 있는 곳)에서는 하지 않는다 */
export function takeLock(dir: string): void {
  if (dir === defaultDir()) return
  lockedDir = dir
  const write = (): void => {
    try {
      fs.writeFileSync(lockPath(dir), JSON.stringify(me()))
    } catch {
      /* 읽기 전용 · 빠진 USB — 다음 차례에 */
    }
  }
  write()
  heartbeat = setInterval(write, HEARTBEAT_MS)
  heartbeat.unref?.()
}

export function releaseLock(): void {
  if (heartbeat) clearInterval(heartbeat)
  heartbeat = null
  if (!lockedDir) return
  try {
    const v = JSON.parse(fs.readFileSync(lockPath(lockedDir), 'utf8')) as Partial<LockInfo>
    const mine = me()
    if (v.pc === mine.pc && v.user === mine.user) fs.unlinkSync(lockPath(lockedDir))
  } catch {
    /* 이미 없음 */
  }
  lockedDir = ''
}

/** 클라우드 동기화 폴더로 보이는지 — 안내 글에 쓴다 */
export const looksSynced = (dir: string): boolean => /onedrive|google drive|googledrive|dropbox|icloud|내 드라이브/i.test(dir)
