import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron'
import path from 'node:path'
import * as db from './db'
import { encryptionAvailable, loadLocalSettings, saveLocalSettings } from './secrets'
import { extractFile } from './extract'
import { analyzeDocument, answerFromSources, generateScenario, testConnection } from './ai'
import { buildAliases, findNameCandidates, maskText } from './anonymize'
import { checkForUpdate } from './update'
import fs from 'node:fs'
import type {
  AliasPair,
  CaseDetail,
  DeadlineInput,
  DocInput,
  DocKind,
  LocalSettings,
  NoticeInput,
  TaskInput,
  TemplateInput
} from '../../shared/types'
import { SUPPORTED_EXTENSIONS } from '../../shared/types'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: '업무 인수인계 대시보드',
    autoHideMenuBar: true,
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // 앱 안에서 외부 링크를 열면 기본 브라우저로 보낸다.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

function registerIpc(): void {
  /* ---------- 업무 ---------- */
  ipcMain.handle('tasks:list', () => db.listTasks())
  ipcMain.handle('tasks:add', (_e, t: TaskInput) => db.addTask(t))
  ipcMain.handle('tasks:update', (_e, id: number, patch: Partial<TaskInput>) =>
    db.updateTask(id, patch)
  )
  ipcMain.handle('tasks:delete', (_e, id: number) => db.deleteTask(id))

  /* ---------- 보관 문서 (공문 원문) ---------- */
  ipcMain.handle('docs:list', () => db.listDocs())
  ipcMain.handle('docs:get', (_e, id: number) => db.getDoc(id))
  ipcMain.handle('docs:add', (_e, d: DocInput) => db.addDoc(d))
  ipcMain.handle('docs:delete', (_e, id: number) => db.deleteDoc(id))
  ipcMain.handle('docs:count', () => db.docCount())
  ipcMain.handle('docs:guessDate', (_e, text: string) => db.guessDocDate(text))

  /* ---------- 절차 기한 ---------- */
  ipcMain.handle('deadlines:list', () => db.listDeadlines())
  ipcMain.handle('deadlines:add', (_e, d: DeadlineInput) => db.addDeadline(d))
  ipcMain.handle('deadlines:update', (_e, id: number, patch: Partial<DeadlineInput>) =>
    db.updateDeadline(id, patch)
  )
  ipcMain.handle('deadlines:delete', (_e, id: number) => db.deleteDeadline(id))

  /* ---------- 통합 검색 ---------- */
  ipcMain.handle('search:run', (_e, query: string) => db.searchAll(query))

  /* ---------- 대본 · 회의록 본보기 ---------- */
  ipcMain.handle('templates:list', () => db.listTemplates())
  ipcMain.handle('templates:add', (_e, t: TemplateInput) => db.addTemplate(t))
  ipcMain.handle('templates:update', (_e, id: number, t: TemplateInput) => db.updateTemplate(id, t))
  ipcMain.handle('templates:delete', (_e, id: number) => db.deleteTemplate(id))

  /* ---------- 가명처리 ---------- */
  ipcMain.handle('privacy:candidates', (_e, text: string) => findNameCandidates(text))
  ipcMain.handle('privacy:aliases', (_e, entries: { name: string; role: string }[]) =>
    buildAliases(entries)
  )
  ipcMain.handle('privacy:mask', (_e, text: string, pairs: AliasPair[]) => maskText(text, pairs))

  /* ---------- 위원회 자료 생성 ---------- */
  ipcMain.handle(
    'scenario:generate',
    async (_e, args: { detail: CaseDetail; templateIds: number[]; aliases: AliasPair[] }) => {
      const picked = db.listTemplates().filter((t) => args.templateIds.includes(t.id))
      return generateScenario(
        loadLocalSettings(),
        db.getSetting('school_name', ''),
        args.detail,
        picked,
        args.aliases
      )
    }
  )

  ipcMain.handle('scenario:save', async (_e, args: { name: string; text: string }) => {
    if (!mainWindow) return { ok: false, message: '창을 찾을 수 없습니다.' }
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '문서로 저장',
      defaultPath: `${args.name}.txt`,
      filters: [{ name: '텍스트 문서', extensions: ['txt'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, message: '취소했습니다.' }
    try {
      // 한글(HWP)에서 바로 열리도록 BOM 을 붙여 UTF-8 로 저장한다.
      fs.writeFileSync(res.filePath, `﻿${args.text}`, 'utf8')
      return { ok: true, message: `저장했습니다: ${res.filePath}`, path: res.filePath }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  /* ---------- 공지 ---------- */
  ipcMain.handle('notices:list', () => db.listNotices())
  ipcMain.handle('notices:add', (_e, n: NoticeInput) => db.addNotice(n))
  ipcMain.handle('notices:update', (_e, id: number, n: NoticeInput) => db.updateNotice(id, n))
  ipcMain.handle('notices:delete', (_e, id: number) => db.deleteNotice(id))

  /* ---------- DB에 저장되는 설정 ---------- */
  ipcMain.handle('setting:get', (_e, key: string, fallback: string) => db.getSetting(key, fallback))
  ipcMain.handle('setting:set', (_e, key: string, value: string) => db.setSetting(key, value))

  /* ---------- 이 PC에만 저장되는 설정 ---------- */
  ipcMain.handle('local:load', () => loadLocalSettings())
  ipcMain.handle('local:save', (_e, s: LocalSettings) => saveLocalSettings(s))
  ipcMain.handle('local:encrypted', () => encryptionAvailable())

  /* ---------- 파일 ---------- */
  ipcMain.handle('files:pick', async () => {
    if (!mainWindow) return []
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '학습할 문서 고르기',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '업무 문서', extensions: SUPPORTED_EXTENSIONS },
        { name: '모든 파일', extensions: ['*'] }
      ]
    })
    return res.canceled ? [] : res.filePaths.map((p) => ({ path: p, name: path.basename(p) }))
  })

  ipcMain.handle('files:extract', async (_e, filePath: string) => extractFile(filePath))

  /* ---------- AI ---------- */
  ipcMain.handle(
    'ai:analyze',
    async (_e, args: { filename: string; text: string; kind: DocKind; jobTitle: string }) =>
      analyzeDocument(
        loadLocalSettings(),
        args.jobTitle,
        args.filename,
        args.text,
        args.kind,
        (msg) => send('ai:progress', msg)
      )
  )
  ipcMain.handle(
    'ai:answer',
    async (
      _e,
      args: { jobTitle: string; query: string; sources: { label: string; text: string }[] }
    ) => answerFromSources(loadLocalSettings(), args.jobTitle, args.query, args.sources)
  )
  ipcMain.handle('ai:test', () => testConnection(loadLocalSettings()))

  /* ---------- 백업 / 복구 ---------- */
  ipcMain.handle('data:info', () => db.dbInfo())

  ipcMain.handle('data:export', async (_e, includePersonal = false) => {
    if (!mainWindow) return { ok: false, message: '창을 찾을 수 없습니다.' }
    const stamp = new Date().toISOString().slice(0, 10)
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '인수인계 파일 내보내기',
      defaultPath: `인수인계_${db.getSetting('job_title', '업무')}_${stamp}.db`,
      filters: [{ name: '인수인계 파일', extensions: ['db'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, message: '취소했습니다.' }
    try {
      await db.exportTo(res.filePath, includePersonal)
      return {
        ok: true,
        message: `저장했습니다${includePersonal ? '' : ' (기한·사안 정보는 빼고)'}: ${res.filePath}`,
        path: res.filePath
      }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('data:import', async () => {
    if (!mainWindow) return { ok: false, message: '창을 찾을 수 없습니다.' }
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '인수인계 파일 불러오기',
      properties: ['openFile'],
      filters: [{ name: '인수인계 파일', extensions: ['db'] }]
    })
    if (res.canceled || !res.filePaths[0]) return { ok: false, message: '취소했습니다.' }

    const confirm = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['불러오기', '취소'],
      defaultId: 1,
      cancelId: 1,
      title: '확인',
      message: '지금 들어 있는 자료를 모두 덮어씁니다.',
      detail: '현재 자료는 자동으로 백업 폴더에 보관됩니다. 계속할까요?'
    })
    if (confirm.response !== 0) return { ok: false, message: '취소했습니다.' }

    try {
      const counts = await db.importFrom(res.filePaths[0])
      return {
        ok: true,
        message: `불러왔습니다. 업무 ${counts.tasks}건, 공지 ${counts.notices}건, 보관 문서 ${counts.documents}건.`
      }
    } catch {
      return { ok: false, message: '이 파일은 인수인계 파일이 아니거나 손상되었습니다.' }
    }
  })

  ipcMain.handle('data:clear', async () => {
    if (!mainWindow) return { ok: false, message: '창을 찾을 수 없습니다.' }
    const confirm = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['모두 삭제', '취소'],
      defaultId: 1,
      cancelId: 1,
      title: '확인',
      message: '등록된 업무와 공지를 모두 지웁니다.',
      detail: '지우기 직전 상태가 백업 폴더에 보관됩니다. 계속할까요?'
    })
    if (confirm.response !== 0) return { ok: false, message: '취소했습니다.' }
    db.clearAll()
    return { ok: true, message: '모두 지웠습니다.' }
  })

  ipcMain.handle('data:openFolder', (_e, target: string) => shell.openPath(target))
  ipcMain.handle('shell:open', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
    return Promise.resolve('')
  })
  // file:// 로 띄운 창에서는 navigator.clipboard 가 막히므로 메인에서 처리한다.
  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('update:check', () => checkForUpdate())
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)

  try {
    await db.openDb()
  } catch (e) {
    // 조용히 죽으면 사용자가 원인을 알 수 없으니 창을 띄워 알려 준다.
    dialog.showErrorBox(
      '자료를 여는 중 문제가 생겼습니다',
      `${e instanceof Error ? e.message : String(e)}\n\n프로그램을 다시 설치하거나 담당자에게 이 메시지를 알려 주세요.`
    )
    app.quit()
    return
  }

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
