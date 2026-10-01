import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray
} from 'electron'
import path from 'node:path'
import * as db from './db'
import { encryptionAvailable, loadLocalSettings, saveLocalSettings } from './secrets'
import { extractFile } from './extract'
import {
  analyzeDocument,
  answerFromSources,
  chatAnswer,
  composeFromForm,
  draftSlides,
  extractDocForm,
  generateDocDraft,
  testConnection,
  type SlideDraftInput
} from './ai'
import { fillSlots, kindOf, readLayout, textToHwpx } from './hwpdoc'
import { buildFromFrame, readFrame } from './hwpgen'
import { helpCatalog, helpForChat, helpMatch, helpSearch, myHelpLine } from './helpdocs'
import { classTimetable, clearNeisCache, mealsOn, nextMealDay, scheduleCached, schoolInfoForDocs, searchSchools, testNeis } from './neis'
import { importTimetable, loadTimetable, rereadWithSheet } from './timetable'
import { schoolContext } from './context'
import { ymd } from '../../shared/neis'
import { buildFromTemplate, buildWithTheme, readDesignMd, readPptxDesign } from './slides'
import type {
  ComposeResult,
  DocItem,
  FormEdit,
  FormFillResult,
  FormRef,
  FrameLayout,
  HwpKind
} from '../../shared/hwpform'
import type { Deck, DesignSource } from '../../shared/slides'
import {
  buildAliases,
  findIdNumbers,
  findNameCandidates,
  maskText,
  scrubPersonal
} from './anonymize'
import { buildBriefing } from './briefing'
import { checkForUpdate } from './update'
import { downloadUpdate, installUpdate, wireAutoUpdate } from './autoupdate'
import { applyLocalSettings, checkDeadlinesNow, stopDeadlineWatch } from './notify'
import fs from 'node:fs'
import type {
  AliasPair,
  CalEventInput,
  ChatFile,
  ChatTurn,
  CleanupPlan,
  DocDraftInput,
  DeadlineInput,
  DocInput,
  DocKind,
  JournalInput,
  LocalSettings,
  ModelChoice,
  NoticeInput,
  TaskInput,
  TemplateInput
} from '../../shared/types'
import { SUPPORTED_EXTENSIONS } from '../../shared/types'

let mainWindow: BrowserWindow | null = null

/**
 * [파일 고르기] 창에서 사람이 고른 파일. 업무 도우미 대화에 올린 한글 파일을 양식으로
 * 쓸 때, 화면이 넘긴 경로가 정말 사람이 고른 것인지 이것으로 확인한다.
 */
const pickedPaths = new Set<string>()
let tray: Tray | null = null

/** 진짜 종료하려는 중인지. 트레이로 숨기기와 구분하기 위한 것. */
let quitting = false

function trayIconPath(): string {
  return path.join(app.getAppPath(), 'build', 'icon.png')
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** 시계 옆에 아이콘을 올린다. 아이콘 파일이 없으면 조용히 넘어간다. */
function createTray(): void {
  if (tray) return
  try {
    const img = nativeImage.createFromPath(trayIconPath())
    if (img.isEmpty()) return

    tray = new Tray(img.resize({ width: 16, height: 16 }))
    tray.setToolTip('업무 인수인계 대시보드')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '창 열기', click: () => showWindow() },
        { label: '기한 지금 확인', click: () => checkDeadlinesNow() },
        { type: 'separator' },
        {
          label: '완전히 종료',
          click: () => {
            quitting = true
            app.quit()
          }
        }
      ])
    )
    tray.on('double-click', () => showWindow())
  } catch {
    // 트레이를 못 만드는 환경이면 없이 동작한다.
    tray = null
  }
}

function destroyTray(): void {
  tray?.destroy()
  tray = null
}

/** 설정에 맞춰 트레이를 올리거나 내린다. */
function syncTray(): void {
  if (loadLocalSettings().keep_in_tray) createTray()
  else destroyTray()
}

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

  // 자동 실행으로 켜진 경우에는 창을 띄우지 않고 트레이에만 올린다.
  const startHidden = process.argv.includes('--hidden') && loadLocalSettings().keep_in_tray
  mainWindow.on('ready-to-show', () => {
    if (!startHidden) mainWindow?.show()
  })

  // [트레이에 남기기]가 켜져 있으면 창을 닫아도 프로그램은 살아 있게 한다.
  // 그래야 기한 알림이 뜬다. 완전히 끄려면 트레이 메뉴의 [완전히 종료].
  mainWindow.on('close', (e) => {
    if (quitting || !loadLocalSettings().keep_in_tray) return
    e.preventDefault()
    mainWindow?.hide()
  })

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

/** 인수인계 꾸러미 폴더에 함께 넣는 안내문 */
function readmeText(job: string): string {
  return `${job} 업무 인수인계 꾸러미

이 폴더에 세 가지가 들어 있습니다.

1. 인수인계서 (.txt)
   먼저 이것부터 읽으세요. 한 해가 어떻게 돌아가는지, 업무별로 어떤 순서로
   처리하는지, 무엇을 조심해야 하는지가 적혀 있습니다.
   한글에서 열어 인쇄하셔도 됩니다.

2. 인수인계 파일 (.db)
   업무 대시보드 프로그램에서 여는 파일입니다.
   공문 원문, 업무 목록, 워크플로우, 서식이 모두 들어 있어
   검색하고 이어서 쓸 수 있습니다.

3. 이 안내문

프로그램은 아래에서 받으실 수 있습니다.
https://github.com/sced9120/work-dashboard/releases/latest

설치한 뒤 처음 실행하면 [인수인계 파일 불러오기] 를 고르고
위 .db 파일을 열면 됩니다.
`
}

function registerIpc(): void {
  /* ---------- 업무 ---------- */
  ipcMain.handle('tasks:list', () => db.listTasks())
  ipcMain.handle('tasks:add', (_e, t: TaskInput) => db.addTask(t))
  ipcMain.handle('tasks:update', (_e, id: number, patch: Partial<TaskInput>) =>
    db.updateTask(id, patch)
  )
  ipcMain.handle('tasks:delete', (_e, id: number) => db.deleteTask(id))
  // 여러 건을 한 번에. 건마다 DB 전체를 다시 쓰지 않도록 묶어서 저장한다.
  ipcMain.handle('tasks:addMany', (_e, list: TaskInput[]) =>
    db.batched(() => list.map((t) => db.addTask(t)))
  )

  /* ---------- 보관 문서 (공문 원문) ---------- */
  ipcMain.handle('docs:list', () => db.listDocs())
  ipcMain.handle('docs:get', (_e, id: number) => db.getDoc(id))
  ipcMain.handle('docs:add', (_e, d: DocInput) => db.addDoc(d))
  ipcMain.handle('docs:delete', (_e, id: number) => db.deleteDoc(id))
  ipcMain.handle('docs:count', () => db.docCount())
  ipcMain.handle('docs:addMany', (_e, list: DocInput[]) =>
    db.batched(() => list.map((d) => db.addDoc(d)))
  )
  ipcMain.handle('docs:guessDate', (_e, text: string) => db.guessDocDate(text))
  ipcMain.handle('docs:setDate', (_e, id: number, date: string) => db.setDocDate(id, date))

  /* ---------- 업무 일지 ---------- */
  ipcMain.handle('journal:list', () => db.listJournal())
  ipcMain.handle('journal:add', (_e, j: JournalInput) => db.addJournal(j))
  ipcMain.handle('journal:update', (_e, id: number, j: JournalInput) => db.updateJournal(id, j))
  ipcMain.handle('journal:delete', (_e, id: number) => db.deleteJournal(id))

  /* ---------- 달력 일정 ---------- */
  ipcMain.handle('events:list', () => db.listEvents())
  ipcMain.handle('events:between', (_e, from: string, to: string) =>
    db.listEventsBetween(from, to)
  )
  ipcMain.handle('events:add', (_e, v: CalEventInput) => db.addEvent(v))
  ipcMain.handle('events:update', (_e, id: number, patch: Partial<CalEventInput>) =>
    db.updateEvent(id, patch)
  )
  ipcMain.handle('events:delete', (_e, id: number) => db.deleteEvent(id))
  ipcMain.handle('events:addMany', (_e, list: CalEventInput[]) =>
    db.addEventsMany(Array.isArray(list) ? list.slice(0, 1000) : [])
  )

  /* ---------- 알림 ---------- */
  ipcMain.handle('notify:checkNow', () => checkDeadlinesNow())

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
  ipcMain.handle('privacy:ids', (_e, text: string) => findIdNumbers(text))
  ipcMain.handle('privacy:aliases', (_e, entries: { name: string; role: string }[]) =>
    buildAliases(entries)
  )
  ipcMain.handle('privacy:mask', (_e, text: string, pairs: AliasPair[]) => maskText(text, pairs))
  // 되돌릴 수 없게 싹 가린다. 예시나 학습용 원문처럼 누가 누구인지가
  // 필요 없는 글에 쓴다.
  ipcMain.handle('privacy:scrub', (_e, text: string) => scrubPersonal(text))

  /* ---------- 학교 문서 만들기 ---------- */
  ipcMain.handle(
    'docdraft:generate',
    async (_e, args: DocDraftInput & { aliases: AliasPair[]; model?: ModelChoice }) => {
      if (!args.form?.name) {
        return { ok: false, text: '', sentToAi: '', error: '문서 종류를 고르지 않았습니다.' }
      }
      const picked = db.listTemplates().filter((t) => args.exampleIds.includes(t.id))
      return generateDocDraft(
        loadLocalSettings(),
        db.getSetting('school_name', ''),
        db.getSetting('job_title', ''),
        args.form,
        args.values,
        picked,
        args.aliases,
        args.model,
        schoolInfoForDocs()
      )
    }
  )

  // 예시 문서 하나를 뜯어 "직접 만든 서식" 의 얼개를 뽑아 준다
  ipcMain.handle(
    'docform:extract',
    (_e, args: { name: string; sample: string; model?: ModelChoice }) =>
      extractDocForm(loadLocalSettings(), args.name, args.sample, args.model)
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

  /* ---------- 학교 한글 양식 ---------- */

  /** 이번에 이 프로그램이 저장한 파일. [열기] 는 이 목록에 있는 것만 연다. */
  const savedPaths = new Set<string>()

  /** 파일로 저장하는 창을 띄운다. 취소하면 빈 문자열. */
  const saveAs = async (title: string, name: string, ext: string, label: string): Promise<string> => {
    if (!mainWindow) return ''
    const safe = name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '문서'
    const res = await dialog.showSaveDialog(mainWindow, {
      title,
      defaultPath: `${safe}.${ext}`,
      filters: [{ name: label, extensions: [ext] }]
    })
    return res.canceled || !res.filePath ? '' : res.filePath
  }

  const writeOut = (target: string, data: Uint8Array): void => {
    fs.writeFileSync(target, data)
    savedPaths.add(path.resolve(target))
  }

  ipcMain.handle('hwpforms:list', () => db.listHwpForms())

  // 양식 파일을 골라 보관한다. 이름·번호가 보이면 화면에서 알려 줄 수 있게 함께 돌려준다.
  // 문서 만들기에서 어떤 문서를 고른 채로 넣으면 그 문서의 양식으로 묶어 둔다.
  ipcMain.handle('hwpforms:add', async (_e, docKind?: string) => {
    if (!mainWindow) return { added: [], errors: [] }
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '학교 한글 양식 고르기',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '한글 문서', extensions: ['hwp', 'hwpx'] }]
    })
    if (res.canceled) return { added: [], errors: [] }
    const added: { id: number; name: string; personal: string[] }[] = []
    const errors: string[] = []
    for (const p of res.filePaths) {
      const name = path.basename(p)
      try {
        const data = new Uint8Array(fs.readFileSync(p))
        const kind = kindOf(data)
        if (!kind) throw new Error('한글 파일이 아닙니다.')
        if (data.length > 20 * 1024 * 1024) throw new Error('20MB 가 넘는 파일은 양식으로 쓸 수 없습니다.')
        const layout = await readLayout(data)
        if (!layout.ok) throw new Error(layout.error || '읽지 못했습니다.')
        const personal = [...findNameCandidates(layout.plain), ...findIdNumbers(layout.plain)].slice(0, 8)
        const id = db.addHwpForm(name.replace(/\.(hwpx?)$/i, ''), name, kind, data)
        if (typeof docKind === 'string' && docKind) db.linkHwpForm(id, docKind)
        added.push({ id, name, personal })
      } catch (e) {
        errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return { added, errors }
  })

  ipcMain.handle('hwpforms:rename', (_e, id: number, name: string) => db.renameHwpForm(id, name))
  ipcMain.handle('hwpforms:link', (_e, id: number, docKind: string) => db.linkHwpForm(id, String(docKind ?? '')))
  ipcMain.handle('hwpforms:delete', (_e, id: number) => db.deleteHwpForm(id))

  /** 넣어 둔 양식(id) 또는 대화에 올린 한글 파일(경로)을 읽는다 */
  const loadForm = (ref: FormRef): { data: Uint8Array; name: string; kind: HwpKind } | null => {
    if ('id' in ref) {
      const data = db.getHwpFormData(ref.id)
      const form = db.listHwpForms().find((f) => f.id === ref.id)
      return data && form ? { data, name: form.name, kind: form.kind } : null
    }
    const full = path.resolve(ref.path)
    if (!pickedPaths.has(full) || !fs.existsSync(full)) return null
    const data = new Uint8Array(fs.readFileSync(full))
    const kind = kindOf(data)
    return kind ? { data, name: ref.name.replace(/\.(hwpx?)$/i, ''), kind } : null
  }

  ipcMain.handle('hwpforms:layout', async (_e, ref: FormRef) => {
    const form = loadForm(ref)
    if (!form) return { ok: false, kind: 'hwp', spots: [], slots: [], blanks: [], plain: '', error: '양식을 찾지 못했습니다.' }
    return readLayout(form.data)
  })

  // 양식의 모양(문단·표·글상자). 새 문서를 만들 때 본뜰 틀이다.
  ipcMain.handle('hwpforms:frame', (_e, ref: FormRef): FrameLayout => {
    const form = loadForm(ref)
    if (!form) return { ok: false, kind: 'hwp', blocks: [], tables: [], boxes: [], notes: [], error: '양식을 찾지 못했습니다.' }
    return readFrame(form.data)
  })

  // 양식을 틀로 AI 가 새 문서의 글을 쓴다. 파일은 보내지 않고 양식의 모습만 보낸다.
  ipcMain.handle(
    'hwpforms:compose',
    (_e, args: { ref: FormRef; content: string; aliases: AliasPair[]; guide?: string; model?: ModelChoice }): Promise<ComposeResult> | ComposeResult => {
      const form = loadForm(args.ref)
      if (!form) return { ok: false, items: [], note: '', sentToAi: '', error: '양식을 찾지 못했습니다.' }
      return composeFromForm(loadLocalSettings(), {
        formName: form.name,
        data: form.data,
        content: args.content,
        aliases: args.aliases,
        schoolName: db.getSetting('school_name', ''),
        guide: typeof args.guide === 'string' ? args.guide : '',
        schoolInfo: schoolInfoForDocs(),
        override: args.model
      })
    }
  )

  // 쓴 글을 양식의 모양으로 한글 파일로 만든다
  ipcMain.handle('hwpforms:build', async (_e, args: { ref: FormRef; items: DocItem[]; name: string }) => {
    const form = loadForm(args.ref)
    if (!form) return { ok: false, message: '양식을 찾지 못했습니다.', notes: [] }
    try {
      const { data, notes } = buildFromFrame(form.data, args.items)
      const target = await saveAs('한글 문서로 저장', args.name || form.name, form.kind, form.kind === 'hwp' ? '한글 문서' : '한글 표준 문서')
      if (!target) return { ok: false, message: '저장을 취소했습니다.', notes }
      writeOut(target, data)
      return { ok: true, path: target, message: `저장했습니다: ${target}`, notes }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e), notes: [] }
    }
  })

  const finishFill = async (
    ref: FormRef,
    name: string,
    run: (data: Uint8Array) => Promise<{ data: Uint8Array; applied: number; missed: FormEdit[] }>
  ): Promise<FormFillResult> => {
    const form = loadForm(ref)
    if (!form) return { ok: false, applied: 0, missed: [], message: '양식을 찾지 못했습니다.' }
    const data = form.data
    try {
      const out = await run(data)
      const labels = new Map((await readLayout(data)).spots.map((sp) => [sp.id, sp.label || sp.text.slice(0, 20)]))
      const missed = out.missed.map((m) => ({ ...m, label: labels.get(m.id) ?? m.id }))
      if (!out.applied) {
        return { ok: false, applied: 0, missed, message: '바뀐 곳이 없어 저장하지 않았습니다.' }
      }
      const target = await saveAs('한글 문서로 저장', name || form.name, form.kind, form.kind === 'hwp' ? '한글 문서' : '한글 표준 문서')
      if (!target) return { ok: false, applied: out.applied, missed, message: '저장을 취소했습니다.' }
      writeOut(target, out.data)
      return { ok: true, applied: out.applied, missed, path: target, message: `저장했습니다: ${target}` }
    } catch (e) {
      return { ok: false, applied: 0, missed: [], message: e instanceof Error ? e.message : String(e) }
    }
  }

  ipcMain.handle(
    'hwpforms:fillSlots',
    (_e, args: { ref: FormRef; values: Record<string, string>; blanks: Record<string, string>; name: string }) =>
      finishFill(args.ref, args.name, (data) => fillSlots(data, args.values, args.blanks))
  )

  // 양식 없이 글만으로 한글 문서를 만든다
  ipcMain.handle('hwp:newDoc', async (_e, args: { name: string; text: string }) => {
    try {
      const data = await textToHwpx(args.text)
      const target = await saveAs('한글 문서로 저장', args.name, 'hwpx', '한글 표준 문서')
      if (!target) return { ok: false, message: '저장을 취소했습니다.' }
      writeOut(target, data)
      return { ok: true, message: `저장했습니다: ${target}`, path: target }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  // 방금 저장한 파일을 한글·PowerPoint 로 연다
  ipcMain.handle('files:openSaved', async (_e, target: string) => {
    const full = path.resolve(target)
    if (!savedPaths.has(full)) return '이 프로그램이 저장한 파일만 열 수 있습니다.'
    return shell.openPath(full)
  })
  ipcMain.handle('files:revealSaved', (_e, target: string) => {
    const full = path.resolve(target)
    if (savedPaths.has(full)) shell.showItemInFolder(full)
  })

  /* ---------- 발표자료(PPT) ---------- */

  /** 디자인 참고로 고른 파일. 저장할 때 이 목록에 있는 파일만 다시 읽는다. */
  const designPaths = new Set<string>()

  ipcMain.handle('slides:pickDesign', async () => {
    if (!mainWindow) return { ok: false }
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '디자인을 참고할 파일 고르기',
      properties: ['openFile'],
      filters: [
        { name: 'PowerPoint · DESIGN.md', extensions: ['pptx', 'md'] },
        { name: 'PowerPoint', extensions: ['pptx'] },
        { name: 'DESIGN.md', extensions: ['md'] }
      ]
    })
    if (res.canceled || !res.filePaths.length) return { ok: false }
    const p = res.filePaths[0]
    const label = path.basename(p)
    try {
      const buf = fs.readFileSync(p)
      if (buf.length > 60 * 1024 * 1024) throw new Error('60MB 가 넘는 파일은 참고할 수 없습니다.')
      const source: DesignSource = /\.md$/i.test(p)
        ? readDesignMd(buf.toString('utf8'), label)
        : readPptxDesign(new Uint8Array(buf), label)
      source.path = p
      designPaths.add(path.resolve(p))
      return { ok: true, source }
    } catch (e) {
      return { ok: false, error: `${label}: ${e instanceof Error ? e.message : String(e)}` }
    }
  })

  ipcMain.handle('slides:draft', (_e, args: { input: SlideDraftInput; model?: ModelChoice }) =>
    draftSlides(loadLocalSettings(), args.input, db.getSetting('school_name', ''), args.model)
  )

  ipcMain.handle('slides:save', async (_e, args: { deck: Deck; design: DesignSource }) => {
    try {
      let data: Uint8Array
      let notes: string[] = []
      if (args.design.kind === 'pptx') {
        const p = path.resolve(args.design.path ?? '')
        if (!designPaths.has(p)) throw new Error('참고 파일을 다시 골라 주세요.')
        if (!fs.existsSync(p)) throw new Error(`참고 파일이 옮겨졌거나 지워졌습니다: ${p}`)
        const built = await buildFromTemplate(args.deck, new Uint8Array(fs.readFileSync(p)))
        data = built.data
        notes = built.notes
      } else {
        data = await buildWithTheme(args.deck, args.design.theme)
      }
      const target = await saveAs('발표자료로 저장', args.deck.title || '발표자료', 'pptx', 'PowerPoint 프레젠테이션')
      if (!target) return { ok: false, message: '저장을 취소했습니다.', notes }
      writeOut(target, data)
      return { ok: true, message: `저장했습니다: ${target}`, path: target, notes }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e), notes: [] }
    }
  })

  /* ---------- 학년도 · 새 학년도 정리 ---------- */
  ipcMain.handle('years:summary', () => db.yearSummary())
  ipcMain.handle('years:setDocs', (_e, ids: number[], year: number) => db.setDocYear(ids, year))
  ipcMain.handle('years:setTasks', (_e, ids: number[], year: number) => db.setTaskYear(ids, year))
  ipcMain.handle('years:auto', () => db.autoAssignYears())
  ipcMain.handle('years:cleanup', (_e, plan: CleanupPlan) => db.cleanupYear(plan))

  /* ---------- 인수인계 브리핑 ---------- */
  ipcMain.handle('briefing:build', (_e, args: { year: number; from: string; to: string }) =>
    buildBriefing(args)
  )

  /**
   * 인수인계 꾸러미 — 폴더 하나에 .db 파일과 인수인계서를 함께 담는다.
   * 받는 사람이 "무엇부터 봐야 하나" 를 알 수 있게 하려는 것이다.
   */
  ipcMain.handle(
    'briefing:package',
    async (_e, args: { year: number; text: string; includePersonal: boolean }) => {
      if (!mainWindow) return { ok: false, message: '창을 찾을 수 없습니다.' }
      const res = await dialog.showOpenDialog(mainWindow, {
        title: '인수인계 꾸러미를 만들 폴더를 고르세요',
        properties: ['openDirectory', 'createDirectory']
      })
      if (res.canceled || !res.filePaths.length) return { ok: false, message: '취소했습니다.' }

      const job = db.getSetting('job_title', '업무')
      const stamp = new Date().toISOString().slice(0, 10)
      const label = args.year ? `${args.year}학년도_` : ''
      const dir = path.join(res.filePaths[0], `인수인계_${label}${job}_${stamp}`)

      try {
        fs.mkdirSync(dir, { recursive: true })
        await db.exportTo(path.join(dir, `인수인계_${job}_${stamp}.db`), args.includePersonal)
        // 한글(HWP)에서 바로 열리도록 BOM 을 붙여 UTF-8 로 저장한다.
        fs.writeFileSync(path.join(dir, `인수인계서_${job}_${stamp}.txt`), `﻿${args.text}`, 'utf8')
        fs.writeFileSync(
          path.join(dir, '먼저 읽어 주세요.txt'),
          `﻿${readmeText(job)}`,
          'utf8'
        )
        return { ok: true, message: `꾸러미를 만들었습니다: ${dir}`, path: dir }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  /* ---------- 공지 ---------- */
  ipcMain.handle('notices:list', () => db.listNotices())
  ipcMain.handle('notices:add', (_e, n: NoticeInput) => db.addNotice(n))
  ipcMain.handle('notices:update', (_e, id: number, n: NoticeInput) => db.updateNotice(id, n))
  ipcMain.handle('notices:delete', (_e, id: number) => db.deleteNotice(id))

  /* ---------- DB에 저장되는 설정 ---------- */
  ipcMain.handle('setting:get', (_e, key: string, fallback: string) => db.getSetting(key, fallback))
  ipcMain.handle('setting:set', (_e, key: string, value: string) => db.setSetting(key, value))
  ipcMain.handle('setting:byPrefix', (_e, prefix: string) => db.settingsByPrefix(prefix))

  /* ---------- 이 PC에만 저장되는 설정 ---------- */
  ipcMain.handle('local:load', () => loadLocalSettings())
  ipcMain.handle('local:save', (_e, s: LocalSettings) => {
    const before = loadLocalSettings()
    // 알림·트레이·자동실행에 얽힌 값이 실제로 바뀌었을 때만 OS 쪽을 다시 건드린다.
    // 이 셋은 각각 레지스트리 쓰기·트레이 재생성·기한 재조회를 부르기 때문에,
    // 모델을 고를 때마다 함께 돌면 드롭다운 하나 바꾸는 데도 눈에 띄게 느려진다.
    const osChanged =
      before.open_at_login !== s.open_at_login ||
      before.keep_in_tray !== s.keep_in_tray ||
      before.notify_deadlines !== s.notify_deadlines ||
      before.notify_days !== s.notify_days

    saveLocalSettings(s)

    // 저장만 하고 반영하지 않으면 켰는데 동작하지 않는다.
    if (osChanged) {
      applyLocalSettings()
      syncTray()
    }
  })
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
    if (res.canceled) return []
    for (const p of res.filePaths) pickedPaths.add(path.resolve(p))
    return res.filePaths.map((p) => ({ path: p, name: path.basename(p) }))
  })

  ipcMain.handle('files:extract', async (_e, filePath: string) => extractFile(filePath))

  /* ---------- AI ---------- */
  ipcMain.handle(
    'ai:analyze',
    async (
      _e,
      args: {
        filename: string
        text: string
        kind: DocKind
        jobTitle: string
        model?: ModelChoice
      }
    ) =>
      analyzeDocument(
        loadLocalSettings(),
        args.jobTitle,
        args.filename,
        args.text,
        args.kind,
        // 여러 기관에 함께 온 공문에서 우리 학교 몫만 가려내는 데 쓴다
        db.getSetting('school_name', ''),
        // 길라잡이에서 뽑은 업무가 내 분장에 드는지 AI가 가려 준다
        db.getSetting('duty_roster', ''),
        (msg: string) => send('ai:progress', msg),
        args.model
      )
  )
  ipcMain.handle(
    'ai:answer',
    async (
      _e,
      args: {
        jobTitle: string
        query: string
        sources: { label: string; text: string }[]
        model?: ModelChoice
      }
    ) =>
      answerFromSources(loadLocalSettings(), args.jobTitle, args.query, args.sources, args.model)
  )
  ipcMain.handle('ai:test', () => testConnection(loadLocalSettings()))
  ipcMain.handle(
    'ai:chat',
    async (_e, args: {
      jobTitle: string
      history: ChatTurn[]
      files?: ChatFile[]
      /** 이 대화에 올린 한글 파일 이름. 양식으로 쓸 수 있다고 도우미에게 알려 준다. */
      formFiles?: string[]
      model?: ModelChoice
    }) => {
      // 가장 최근 질문을 근거로 관련 자료를 골라 함께 넘긴다.
      const lastUser = [...args.history].reverse().find((t) => t.role === 'user')
      const found = lastUser ? db.retrieveForChat(lastUser.content) : []

      // 방금 올린 파일이 지금 이야기의 알맹이다. 맨 앞에 넉넉히 싣는다.
      const attached = (args.files ?? [])
        .filter((f) => f.text.trim())
        .map((f) => ({ label: `올린 파일: ${f.name}`, text: f.text, room: 12000 }))

      // 교육청 학교업무 도움자료 가운데 질문에 맞는 자료 폴더. 파일 이름만 있어서 짧게 싣는다.
      const helps = lastUser ? helpForChat(lastUser.content) : []

      const today = new Date()
      const p = (n: number): string => String(n).padStart(2, '0')
      const todayStr = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`

      // 도우미가 "이 양식에 맞춰" 부탁을 받을 수 있게 쓸 수 있는 양식 이름을 알려 준다
      const forms = [
        ...db.listHwpForms().map((f) => f.name),
        ...(args.formFiles ?? []).map((n) => `${n} (이 대화에 올린 파일)`)
      ]

      // 이 학교의 급식 · 학사일정 · 내 시간표 — 질문에 맞을 때만
      const school = lastUser ? await schoolContext(lastUser.content, todayStr).catch(() => []) : []

      const res = await chatAnswer(
        loadLocalSettings(),
        args.jobTitle,
        args.history,
        [...attached, ...school, ...found, ...helps.map((h) => ({ label: h.label, text: h.text, room: 2500 }))],
        todayStr,
        forms,
        args.model,
        myHelpLine()
      )
      // 실제로 실린 도움자료만 버튼으로 내준다
      const links = helps.filter((h) => res.sources.includes(h.label)).map((h) => ({ title: h.title, url: h.url }))
      return links.length ? { ...res, links } : res
    }
  )

  /* ---------- 나이스 교육정보 개방 포털 ---------- */
  const dayOk = (v: unknown): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '')
  ipcMain.handle('neis:schools', (_e, name: string) => searchSchools(String(name ?? '')))
  ipcMain.handle('neis:meals', (_e, day: string) => mealsOn(dayOk(day) || ymd(new Date())))
  ipcMain.handle('neis:nextMeals', (_e, day: string, dir: number) => nextMealDay(dayOk(day), dir === -1 ? -1 : 1))
  ipcMain.handle('neis:schedule', (_e, from: string, to: string) => scheduleCached(dayOk(from), dayOk(to)))
  ipcMain.handle('neis:classTimetable', (_e, grade: number, cls: number, from: string, to: string) =>
    classTimetable(Number(grade) || 0, Number(cls) || 0, dayOk(from), dayOk(to))
  )

  /* ---------- 시간표 ---------- */
  ipcMain.handle('tt:get', () => loadTimetable())
  ipcMain.handle('tt:import', async () => {
    if (!mainWindow) return { ok: false, error: '창을 찾을 수 없습니다.' }
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '학교 시간표 엑셀 고르기 (여러 개를 함께 골라도 됩니다)',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '엑셀', extensions: ['xlsx'] }]
    })
    if (res.canceled || !res.filePaths.length) return { ok: false, error: '' }
    return importTimetable(res.filePaths)
  })
  ipcMain.handle('tt:useSheet', (_e, name: string) => rereadWithSheet(String(name ?? '')))
  ipcMain.handle('tt:clear', () => db.setSetting('timetable_school', ''))

  /** 화면에서 그린 그림(시간표 등)을 PNG 로 저장 */
  ipcMain.handle('image:savePng', async (_e, args: { name: string; dataUrl: string }) => {
    if (!mainWindow) return { ok: false, message: '창을 찾을 수 없습니다.' }
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(args?.dataUrl ?? ''))
    if (!m) return { ok: false, message: '그림을 만들지 못했습니다.' }
    const safe = String(args.name ?? '그림').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '그림'
    const res = await dialog.showSaveDialog(mainWindow, {
      title: '그림으로 저장',
      defaultPath: path.join(app.getPath('documents'), `${safe}.png`),
      filters: [{ name: 'PNG 그림', extensions: ['png'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, message: '취소했습니다.' }
    fs.writeFileSync(res.filePath, Buffer.from(m[1], 'base64'))
    savedPaths.add(path.resolve(res.filePath))
    return { ok: true, message: `저장했습니다: ${res.filePath}`, path: res.filePath }
  })
  ipcMain.handle('neis:test', () => testNeis())
  ipcMain.handle('neis:clearCache', () => clearNeisCache())

  /* ---------- 학교업무 도움자료 ---------- */
  ipcMain.handle('help:catalog', () => helpCatalog())
  ipcMain.handle('help:match', (_e, text: string, level: string) => helpMatch(String(text ?? ''), String(level ?? '')))
  ipcMain.handle('help:search', (_e, query: string, limit?: number) =>
    helpSearch(String(query ?? ''), typeof limit === 'number' ? limit : 15)
  )

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
  ipcMain.handle('update:download', () => downloadUpdate())
  ipcMain.handle('update:install', () => {
    // 설치 프로그램이 실행되는 동안 트레이에 남아 있으면 교체가 막힌다.
    quitting = true
    destroyTray()
    installUpdate()
  })
}

// 트레이에 숨어 있는데 아이콘을 또 눌러 두 개가 뜨는 일을 막는다.
// 같은 자료 파일을 두 프로세스가 동시에 쓰면 저장이 서로를 덮어쓴다.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
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
  wireAutoUpdate(() => mainWindow)
  createWindow()

  // 자료를 열고 난 뒤에 알림·트레이·자동실행을 설정에 맞춘다.
  syncTray()
  applyLocalSettings()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  quitting = true
  stopDeadlineWatch()
})

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return
  // 트레이에 남기기가 켜져 있으면 창이 없어도 계속 살아 있는다.
  if (loadLocalSettings().keep_in_tray && !quitting) return
  app.quit()
})
