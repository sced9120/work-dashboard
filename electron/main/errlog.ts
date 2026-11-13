/**
 * 오류 기록 — %APPDATA%\work-dashboard\logs\error.log
 *
 * 오르빗은 사용 기록을 밖으로 보내지 않으므로, 문제가 생겼을 때 원인을 찾을 길은 이 파일뿐이다.
 * 화면(렌더러)에서 난 오류는 IPC 로 받아 적고, 메인에서 잡지 못한 예외 · 화면 프로세스가 죽은 것도 적는다.
 * 파일은 이 PC 에만 있다. 500KB 를 넘으면 error.1.log 로 밀어 두고 새로 시작한다(둘까지만).
 */

import { app, type BrowserWindow, type WebContents } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const MAX_BYTES = 500_000
/** 한 건에 남기는 글자 수 — 오류 글에 긴 자료가 딸려 오는 것을 막는다 */
const MAX_ENTRY = 4000

export const logDir = (): string => path.join(app.getPath('userData'), 'logs')
const logFile = (): string => path.join(logDir(), 'error.log')

export function logError(where: string, err: unknown): void {
  try {
    const dir = logDir()
    fs.mkdirSync(dir, { recursive: true })
    const file = logFile()
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, path.join(dir, 'error.1.log'))
    const text = err instanceof Error ? err.stack || `${err.name}: ${err.message}` : typeof err === 'string' ? err : JSON.stringify(err)
    const line = `${new Date().toISOString()} [${String(where).slice(0, 60)}] v${app.getVersion()} ${String(text ?? '').slice(0, MAX_ENTRY)}`
    fs.appendFileSync(file, line.replace(/\r?\n/g, '\n    ') + '\n')
  } catch {
    // 기록을 못 남겨도 프로그램은 계속 돈다
  }
}

/** 화면에서 보낸 오류 한 건 (IPC log:error) */
export function logRendererError(p: { where?: unknown; message?: unknown; stack?: unknown }): void {
  const where = typeof p?.where === 'string' ? p.where : 'renderer'
  const msg = typeof p?.message === 'string' ? p.message : ''
  const stack = typeof p?.stack === 'string' ? p.stack : ''
  logError(`화면:${where}`, (stack || msg || '(내용 없음)').slice(0, MAX_ENTRY))
}

let installed = false

/**
 * 메인에서 잡지 못한 예외 · Promise 거절은 적고 계속 돈다(창을 닫지 않는다).
 * 화면 프로세스가 죽으면(멈춤 · 메모리 부족) 적고, 사용자가 일부러 끈 것이 아니면 한 번 다시 띄운다.
 */
export function installCrashHandlers(getWindow: () => BrowserWindow | null): void {
  if (installed) return
  installed = true
  process.on('uncaughtException', (err) => logError('메인:예외', err))
  process.on('unhandledRejection', (reason) => logError('메인:Promise', reason))
  let lastReload = 0
  app.on('render-process-gone', (_e, wc: WebContents, details) => {
    logError('화면 프로세스 멈춤', `${details.reason} (exitCode ${details.exitCode})`)
    if (details.reason === 'clean-exit' || details.reason === 'killed') return
    const win = getWindow()
    // 되풀이해 죽으면 계속 다시 띄우지 않는다(1분에 한 번까지)
    if (!win || win.isDestroyed() || win.webContents !== wc || Date.now() - lastReload < 60_000) return
    lastReload = Date.now()
    setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.reload()
    }, 500)
  })
  app.on('child-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return
    logError('보조 프로세스 멈춤', `${details.type} ${details.reason} (exitCode ${details.exitCode})`)
  })
}
