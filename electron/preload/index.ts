import { contextBridge, ipcRenderer } from 'electron'
import type {
  AliasPair,
  AnalyzeResult,
  CalEvent,
  CalEventInput,
  CleanupPlan,
  CleanupResult,
  DocDraftInput,
  DocDraftResult,
  FormSketch,
  ChatReply,
  ChatFile,
  ChatTurn,
  Deadline,
  DeadlineInput,
  Doc,
  DocFull,
  DocInput,
  JournalEntry,
  JournalInput,
  DocKind,
  ExtractedDoc,
  LocalSettings,
  ModelChoice,
  Notice,
  NoticeInput,
  PickedFile,
  YearSummary,
  ScrubResult,
  SearchAnswer,
  SearchHit,
  Task,
  TaskInput,
  Template,
  TemplateInput,
  UpdateInfo
} from '../../shared/types'
import type { HelpCatalog, HelpHit, HelpMatch } from '../../shared/helpdocs'
import type { NeisDay, NeisLesson, NeisMealDay, NeisResult, NeisSchool } from '../../shared/neis'
import type { SchoolTimetable, TtRow } from '../../shared/timetable'
import type {
  ComposeResult,
  DocItem,
  FormFillResult,
  FormLayout,
  FormRef,
  FrameLayout,
  HwpForm
} from '../../shared/hwpform'
import type { Deck, DesignSource } from '../../shared/slides'

export interface ActionResult {
  ok: boolean
  message: string
  path?: string
}

const api = {
  tasks: {
    list: (): Promise<Task[]> => ipcRenderer.invoke('tasks:list'),
    add: (t: TaskInput): Promise<number> => ipcRenderer.invoke('tasks:add', t),
    addMany: (list: TaskInput[]): Promise<number[]> => ipcRenderer.invoke('tasks:addMany', list),
    update: (id: number, patch: Partial<TaskInput>): Promise<void> =>
      ipcRenderer.invoke('tasks:update', id, patch),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('tasks:delete', id)
  },
  docs: {
    list: (): Promise<Doc[]> => ipcRenderer.invoke('docs:list'),
    get: (id: number): Promise<DocFull | null> => ipcRenderer.invoke('docs:get', id),
    add: (d: DocInput): Promise<number> => ipcRenderer.invoke('docs:add', d),
    addMany: (list: DocInput[]): Promise<number[]> => ipcRenderer.invoke('docs:addMany', list),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('docs:delete', id),
    count: (): Promise<number> => ipcRenderer.invoke('docs:count'),
    guessDate: (text: string): Promise<string> => ipcRenderer.invoke('docs:guessDate', text),
    setDate: (id: number, date: string): Promise<void> =>
      ipcRenderer.invoke('docs:setDate', id, date)
  },
  search: {
    run: (query: string): Promise<SearchHit[]> => ipcRenderer.invoke('search:run', query)
  },
  events: {
    list: (): Promise<CalEvent[]> => ipcRenderer.invoke('events:list'),
    between: (from: string, to: string): Promise<CalEvent[]> =>
      ipcRenderer.invoke('events:between', from, to),
    add: (v: CalEventInput): Promise<number> => ipcRenderer.invoke('events:add', v),
    update: (id: number, patch: Partial<CalEventInput>): Promise<void> =>
      ipcRenderer.invoke('events:update', id, patch),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('events:delete', id),
    /** 한꺼번에 넣기. 같은 날 같은 제목이 이미 있으면 건너뛴다 */
    addMany: (list: CalEventInput[]): Promise<{ added: number; skipped: number }> =>
      ipcRenderer.invoke('events:addMany', list)
  },
  journal: {
    list: (): Promise<JournalEntry[]> => ipcRenderer.invoke('journal:list'),
    add: (j: JournalInput): Promise<number> => ipcRenderer.invoke('journal:add', j),
    update: (id: number, j: JournalInput): Promise<void> =>
      ipcRenderer.invoke('journal:update', id, j),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('journal:delete', id)
  },
  notify: {
    checkNow: (): Promise<void> => ipcRenderer.invoke('notify:checkNow')
  },
  deadlines: {
    list: (): Promise<Deadline[]> => ipcRenderer.invoke('deadlines:list'),
    add: (d: DeadlineInput): Promise<number> => ipcRenderer.invoke('deadlines:add', d),
    update: (id: number, patch: Partial<DeadlineInput>): Promise<void> =>
      ipcRenderer.invoke('deadlines:update', id, patch),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('deadlines:delete', id)
  },
  templates: {
    list: (): Promise<Template[]> => ipcRenderer.invoke('templates:list'),
    add: (t: TemplateInput): Promise<number> => ipcRenderer.invoke('templates:add', t),
    update: (id: number, t: TemplateInput): Promise<void> =>
      ipcRenderer.invoke('templates:update', id, t),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('templates:delete', id)
  },
  privacy: {
    candidates: (text: string): Promise<string[]> => ipcRenderer.invoke('privacy:candidates', text),
    ids: (text: string): Promise<string[]> => ipcRenderer.invoke('privacy:ids', text),
    aliases: (entries: { name: string; role: string }[]): Promise<AliasPair[]> =>
      ipcRenderer.invoke('privacy:aliases', entries),
    mask: (text: string, pairs: AliasPair[]): Promise<string> =>
      ipcRenderer.invoke('privacy:mask', text, pairs),
    scrub: (text: string): Promise<ScrubResult> => ipcRenderer.invoke('privacy:scrub', text)
  },
  docdraft: {
    generate: (
      args: DocDraftInput & { aliases: AliasPair[]; model?: ModelChoice }
    ): Promise<DocDraftResult> => ipcRenderer.invoke('docdraft:generate', args),
    save: (args: { name: string; text: string }): Promise<ActionResult> =>
      ipcRenderer.invoke('scenario:save', args),
    extractForm: (args: {
      name: string
      sample: string
      model?: ModelChoice
    }): Promise<FormSketch> => ipcRenderer.invoke('docform:extract', args)
  },
  notices: {
    list: (): Promise<Notice[]> => ipcRenderer.invoke('notices:list'),
    add: (n: NoticeInput): Promise<number> => ipcRenderer.invoke('notices:add', n),
    update: (id: number, n: NoticeInput): Promise<void> =>
      ipcRenderer.invoke('notices:update', id, n),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('notices:delete', id)
  },
  setting: {
    get: (key: string, fallback = ''): Promise<string> =>
      ipcRenderer.invoke('setting:get', key, fallback),
    set: (key: string, value: string): Promise<void> =>
      ipcRenderer.invoke('setting:set', key, value),
    byPrefix: (prefix: string): Promise<{ key: string; value: string }[]> =>
      ipcRenderer.invoke('setting:byPrefix', prefix)
  },
  local: {
    load: (): Promise<LocalSettings> => ipcRenderer.invoke('local:load'),
    save: (s: LocalSettings): Promise<void> => ipcRenderer.invoke('local:save', s),
    encrypted: (): Promise<boolean> => ipcRenderer.invoke('local:encrypted')
  },
  files: {
    pick: (): Promise<PickedFile[]> => ipcRenderer.invoke('files:pick'),
    extract: (filePath: string): Promise<ExtractedDoc> =>
      ipcRenderer.invoke('files:extract', filePath)
  },
  ai: {
    analyze: (args: {
      filename: string
      text: string
      kind: DocKind
      jobTitle: string
      model?: ModelChoice
    }): Promise<AnalyzeResult> => ipcRenderer.invoke('ai:analyze', args),
    answer: (args: {
      jobTitle: string
      query: string
      sources: { label: string; text: string }[]
      model?: ModelChoice
    }): Promise<SearchAnswer> => ipcRenderer.invoke('ai:answer', args),
    chat: (args: {
      jobTitle: string
      history: ChatTurn[]
      files?: ChatFile[]
      formFiles?: string[]
      model?: ModelChoice
    }): Promise<ChatReply> => ipcRenderer.invoke('ai:chat', args),
    test: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('ai:test'),
    onProgress: (cb: (msg: string) => void): (() => void) => {
      const handler = (_e: unknown, msg: string): void => cb(msg)
      ipcRenderer.on('ai:progress', handler)
      return () => ipcRenderer.removeListener('ai:progress', handler)
    }
  },
  /** 나이스 교육정보 개방 포털 (학교 공개 자료) */
  neis: {
    schools: (name: string): Promise<NeisResult<NeisSchool[]>> => ipcRenderer.invoke('neis:schools', name),
    meals: (day: string): Promise<NeisMealDay> => ipcRenderer.invoke('neis:meals', day),
    /** day 다음(dir=1) 또는 앞(dir=-1)으로 급식이 있는 날 */
    nextMeals: (day: string, dir: 1 | -1): Promise<NeisMealDay> => ipcRenderer.invoke('neis:nextMeals', day, dir),
    schedule: (from: string, to: string): Promise<NeisResult<NeisDay[]>> => ipcRenderer.invoke('neis:schedule', from, to),
    test: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('neis:test'),
    clearCache: (): Promise<void> => ipcRenderer.invoke('neis:clearCache'),
    /** 학급 시간표 (키 필요) */
    classTimetable: (grade: number, cls: number, from: string, to: string): Promise<NeisResult<NeisLesson[]>> =>
      ipcRenderer.invoke('neis:classTimetable', grade, cls, from, to)
  },
  /** 학교 시간표 (엑셀에서 읽은 것) */
  tt: {
    get: (): Promise<SchoolTimetable | null> => ipcRenderer.invoke('tt:get'),
    /** 파일을 골라 읽는다. 고르지 않으면 { ok: false, error: '' } */
    import: (): Promise<{ ok: boolean; tt?: SchoolTimetable; error?: string }> => ipcRenderer.invoke('tt:import'),
    /** 시트마다 수업이 다른 판일 때, 같은 파일을 이 시트 기준으로 다시 읽는다 */
    useSheet: (name: string): Promise<{ ok: boolean; tt?: SchoolTimetable; error?: string }> => ipcRenderer.invoke('tt:useSheet', name),
    clear: (): Promise<void> => ipcRenderer.invoke('tt:clear'),
    /** 표준 자료(교사 · 요일 · 교시 · 반 · 과목 · 블록 · 구분)를 엑셀로 저장 */
    exportStandard: (rows: TtRow[]): Promise<ActionResult> => ipcRenderer.invoke('tt:exportStandard', rows)
  },
  image: {
    savePng: (args: { name: string; dataUrl: string }): Promise<ActionResult> => ipcRenderer.invoke('image:savePng', args)
  },
  /** 학교업무 도움자료 목록 */
  help: {
    catalog: (): Promise<HelpCatalog> => ipcRenderer.invoke('help:catalog'),
    /** 적은 내 업무(여러 줄)에 맞는 것 */
    match: (text: string, level: string): Promise<HelpMatch[]> => ipcRenderer.invoke('help:match', text, level),
    search: (query: string, limit?: number): Promise<HelpHit[]> => ipcRenderer.invoke('help:search', query, limit)
  },
  years: {
    summary: (): Promise<YearSummary[]> => ipcRenderer.invoke('years:summary'),
    setDocs: (ids: number[], year: number): Promise<number> =>
      ipcRenderer.invoke('years:setDocs', ids, year),
    setTasks: (ids: number[], year: number): Promise<number> =>
      ipcRenderer.invoke('years:setTasks', ids, year),
    auto: (): Promise<{ docs: number; tasks: number }> => ipcRenderer.invoke('years:auto'),
    cleanup: (plan: CleanupPlan): Promise<CleanupResult> =>
      ipcRenderer.invoke('years:cleanup', plan)
  },
  briefing: {
    build: (args: { year: number; from: string; to: string }): Promise<string> =>
      ipcRenderer.invoke('briefing:build', args),
    package: (args: {
      year: number
      text: string
      includePersonal: boolean
    }): Promise<ActionResult> => ipcRenderer.invoke('briefing:package', args)
  },
  data: {
    info: (): Promise<{ path: string; backups: string; sizeKb: number }> =>
      ipcRenderer.invoke('data:info'),
    export: (includePersonal = false): Promise<ActionResult> =>
      ipcRenderer.invoke('data:export', includePersonal),
    import: (): Promise<ActionResult> => ipcRenderer.invoke('data:import'),
    clear: (): Promise<ActionResult> => ipcRenderer.invoke('data:clear'),
    openFolder: (target: string): Promise<string> => ipcRenderer.invoke('data:openFolder', target)
  },
  shell: {
    open: (url: string): Promise<string | void> => ipcRenderer.invoke('shell:open', url)
  },
  clipboard: {
    write: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text)
  },
  /** 학교 한글 양식 */
  hwp: {
    list: (): Promise<HwpForm[]> => ipcRenderer.invoke('hwpforms:list'),
    add: (docKind?: string): Promise<{ added: { id: number; name: string; personal: string[] }[]; errors: string[] }> =>
      ipcRenderer.invoke('hwpforms:add', docKind),
    rename: (id: number, name: string): Promise<void> => ipcRenderer.invoke('hwpforms:rename', id, name),
    /** 이 양식이 어느 문서(문서 만들기의 문서 종류 id)의 양식인지. 빈 문자열이면 묶지 않음 */
    link: (id: number, docKind: string): Promise<void> => ipcRenderer.invoke('hwpforms:link', id, docKind),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('hwpforms:delete', id),
    layout: (ref: FormRef): Promise<FormLayout> => ipcRenderer.invoke('hwpforms:layout', ref),
    /** 양식의 모양(문단·표·글상자) */
    frame: (ref: FormRef): Promise<FrameLayout> => ipcRenderer.invoke('hwpforms:frame', ref),
    /** 양식을 틀로 AI 가 새 문서의 글을 쓴다 */
    compose: (args: {
      ref: FormRef
      content: string
      aliases: AliasPair[]
      /** 문서 종류와 쓰는 법 */
      guide?: string
      model?: ModelChoice
    }): Promise<ComposeResult> =>
      ipcRenderer.invoke('hwpforms:compose', args),
    /** 쓴 글을 양식의 모양으로 한글 파일로 만든다 */
    build: (args: { ref: FormRef; items: DocItem[]; name: string }): Promise<ActionResult & { notes: string[] }> =>
      ipcRenderer.invoke('hwpforms:build', args),
    fillSlots: (args: {
      ref: FormRef
      values: Record<string, string>
      blanks: Record<string, string>
      name: string
    }): Promise<FormFillResult> => ipcRenderer.invoke('hwpforms:fillSlots', args),
    newDoc: (args: { name: string; text: string }): Promise<ActionResult> => ipcRenderer.invoke('hwp:newDoc', args),
    /** 이 프로그램이 방금 저장한 파일만 열 수 있다 */
    open: (target: string): Promise<string> => ipcRenderer.invoke('files:openSaved', target),
    reveal: (target: string): Promise<void> => ipcRenderer.invoke('files:revealSaved', target)
  },
  /** 발표자료(PPT) */
  slides: {
    pickDesign: (): Promise<{ ok: boolean; source?: DesignSource; error?: string }> =>
      ipcRenderer.invoke('slides:pickDesign'),
    draft: (args: {
      input: { topic: string; audience: string; count: number; minutes: number; material: string; notes: boolean }
      model?: ModelChoice
    }): Promise<{ ok: boolean; deck?: Deck; error?: string }> => ipcRenderer.invoke('slides:draft', args),
    save: (args: { deck: Deck; design: DesignSource }): Promise<ActionResult & { notes: string[] }> =>
      ipcRenderer.invoke('slides:save', args)
  },
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  update: {
    check: (): Promise<UpdateInfo> => ipcRenderer.invoke('update:check'),
    download: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('update:download'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    onProgress: (cb: (percent: number) => void): (() => void) => {
      const handler = (_e: unknown, percent: number): void => cb(percent)
      ipcRenderer.on('update:progress', handler)
      return () => ipcRenderer.removeListener('update:progress', handler)
    },
    onDownloaded: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('update:downloaded', handler)
      return () => ipcRenderer.removeListener('update:downloaded', handler)
    },
    onError: (cb: (msg: string) => void): (() => void) => {
      const handler = (_e: unknown, msg: string): void => cb(msg)
      ipcRenderer.on('update:error', handler)
      return () => ipcRenderer.removeListener('update:error', handler)
    }
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
