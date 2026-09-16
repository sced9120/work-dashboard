/**
 * 클릭 한 번으로 새 버전을 받아 설치한다.
 *
 * 이게 되는 경우는 제한적이다. 설치형(NSIS)으로 설치했고, 패키징된 앱이어야 한다.
 * Portable 로 쓰거나 개발 중이면 동작하지 않으므로, 그때는 update.ts 의
 * "받으러 가기" 방식으로 안내한다. 어느 쪽인지 화면에 정확히 알려 주는 것이 중요하다.
 */

import fs from 'node:fs'
import path from 'node:path'
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

/**
 * 업데이트가 어디서 멈췄는지 나중에 볼 수 있게 파일로 남긴다.
 *
 * 학교 PC 에서 "받다가 멈췄다" 는 말만으로는 원인을 알 수 없다. 백신이 파일을
 * 붙잡았는지, 받다 끊겼는지, 서명 확인에서 걸렸는지가 여기 남는다.
 * %APPDATA%\work-dashboard\logs\update.log
 */
function makeLogger(): {
  info: (m: unknown) => void
  warn: (m: unknown) => void
  error: (m: unknown) => void
  debug: (m: unknown) => void
} {
  const dir = path.join(app.getPath('userData'), 'logs')
  const file = path.join(dir, 'update.log')
  const write = (level: string, m: unknown): void => {
    try {
      fs.mkdirSync(dir, { recursive: true })
      // 한없이 커지지 않게 200KB 를 넘으면 새로 시작한다
      if (fs.existsSync(file) && fs.statSync(file).size > 200_000) fs.writeFileSync(file, '')
      const text = m instanceof Error ? m.stack || m.message : String(m)
      fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${text}\n`)
    } catch {
      // 기록을 못 남겨도 업데이트는 계속한다
    }
  }
  return {
    info: (m) => write('info', m),
    warn: (m) => write('warn', m),
    error: (m) => write('error', m),
    debug: () => {}
  }
}

let wired = false

/** 진행 상황을 창으로 보낸다. */
export function wireAutoUpdate(getWindow: () => BrowserWindow | null): void {
  if (wired) return
  wired = true

  autoUpdater.logger = makeLogger()

  // 사용자가 [지금 받아서 설치] 를 누를 때까지 받지 않는다.
  // 학교망에서 100MB를 몰래 내려받으면 곤란하다.
  autoUpdater.autoDownload = false

  // 받기 전에는 끌 때 설치하지 않는다. 받기를 누르면 downloadUpdate() 에서 켠다.
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

/**
 * 새 버전을 내려받는다. 진행률은 update:progress 로 온다.
 *
 * **끝까지 받은 뒤에야 돌아온다.** 그래서 이것이 ok 로 돌아오면 화면은
 * update:downloaded 를 기다리지 않고 곧장 "다 받음" 으로 바꿔도 된다.
 * 백신이 받은 파일을 붙잡으면 100% 를 채우고도 이름 바꾸기를 30초까지
 * 다시 시도하므로, 그동안 화면이 멈춘 것처럼 보일 수 있다.
 */
export async function downloadUpdate(): Promise<{ ok: boolean; error?: string }> {
  if (!canAutoInstall()) {
    return { ok: false, error: '이 방식으로 설치할 수 없는 환경입니다. 받으러 가기를 눌러 주세요.' }
  }
  try {
    // 받기를 누른 것은 설치하겠다는 뜻이다. 다 받은 뒤 [다시 시작하고 설치] 를
    // 안 누르고 프로그램을 끄더라도 그때 설치되게 한다.
    //
    // 이 값은 **받기 전에** 켜야 한다. electron-updater 는 받기가 끝나는 순간
    // 한 번만 "끌 때 설치" 를 걸어 두는데, 그때 꺼져 있으면 건너뛰고 다시는
    // 걸지 않는다. 예전에는 늘 꺼 두어서, 다 받고 꺼도 설치되지 않았고
    // 다시 켜면 처음부터 또 받으라고 했다.
    autoUpdater.autoInstallOnAppQuit = true

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
