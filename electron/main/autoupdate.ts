/**
 * 클릭 한 번으로 새 버전을 받아 설치한다.
 *
 * 이게 되는 경우는 제한적이다. 설치형(NSIS)으로 설치했고, 패키징된 앱이어야 한다.
 * Portable 로 쓰거나 개발 중이면 동작하지 않으므로, 그때는 update.ts 의
 * "받으러 가기" 방식으로 안내한다. 어느 쪽인지 화면에 정확히 알려 주는 것이 중요하다.
 */

import { app, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * 자동 설치가 가능한 환경인가.
 * PORTABLE_EXECUTABLE_DIR 은 electron-builder 의 portable 빌드에서만 채워진다.
 */
export function canAutoInstall(): boolean {
  if (!app.isPackaged) return false
  if (process.env.PORTABLE_EXECUTABLE_DIR) return false
  return process.platform === 'win32' || process.platform === 'darwin'
}

let wired = false

/** 진행 상황을 창으로 보낸다. */
export function wireAutoUpdate(getWindow: () => BrowserWindow | null): void {
  if (wired) return
  wired = true

  // 사용자가 [지금 설치]를 누를 때까지 받지 않는다.
  // 학교망에서 100MB를 몰래 내려받으면 곤란하다.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  const send = (channel: string, payload?: unknown): void => {
    getWindow()?.webContents.send(channel, payload)
  }

  autoUpdater.on('download-progress', (p) => {
    send('update:progress', Math.round(p.percent))
  })

  autoUpdater.on('update-downloaded', () => {
    send('update:downloaded')
  })

  autoUpdater.on('error', (err) => {
    send('update:error', err instanceof Error ? err.message : String(err))
  })
}

/** 새 버전을 내려받기 시작한다. 진행률은 update:progress 로 온다. */
export async function downloadUpdate(): Promise<{ ok: boolean; error?: string }> {
  if (!canAutoInstall()) {
    return { ok: false, error: '이 방식으로 설치할 수 없는 환경입니다. 받으러 가기를 눌러 주세요.' }
  }
  try {
    // 받기 전에 한 번 확인해야 electron-updater 가 대상 파일을 알게 된다.
    await autoUpdater.checkForUpdates()
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 받아 둔 새 버전을 설치하고 다시 시작한다. */
export function installUpdate(): void {
  // isSilent=false 로 두어 설치 화면을 보여 준다. 조용히 끝나면
  // 사용자가 무슨 일이 벌어졌는지 알 수 없다.
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
}
