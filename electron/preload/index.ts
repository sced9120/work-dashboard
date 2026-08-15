import { contextBridge, ipcRenderer } from 'electron'
import type {
  AliasPair,
  AnalyzeResult,
  CaseDetail,
  Deadline,
  DeadlineInput,
  Doc,
  DocFull,
  DocInput,
  DocKind,
  ExtractedDoc,
  LocalSettings,
  Notice,
  NoticeInput,
  PickedFile,
  ScenarioResult,
  SearchAnswer,
  SearchHit,
  Task,
  TaskInput,
  Template,
  TemplateInput
} from '../../shared/types'

export interface ActionResult {
  ok: boolean
  message: string
  path?: string
}

const api = {
  tasks: {
    list: (): Promise<Task[]> => ipcRenderer.invoke('tasks:list'),
    add: (t: TaskInput): Promise<number> => ipcRenderer.invoke('tasks:add', t),
    update: (id: number, patch: Partial<TaskInput>): Promise<void> =>
      ipcRenderer.invoke('tasks:update', id, patch),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('tasks:delete', id)
  },
  docs: {
    list: (): Promise<Doc[]> => ipcRenderer.invoke('docs:list'),
    get: (id: number): Promise<DocFull | null> => ipcRenderer.invoke('docs:get', id),
    add: (d: DocInput): Promise<number> => ipcRenderer.invoke('docs:add', d),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('docs:delete', id),
    count: (): Promise<number> => ipcRenderer.invoke('docs:count'),
    guessDate: (text: string): Promise<string> => ipcRenderer.invoke('docs:guessDate', text)
  },
  search: {
    run: (query: string): Promise<SearchHit[]> => ipcRenderer.invoke('search:run', query)
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
    aliases: (entries: { name: string; role: string }[]): Promise<AliasPair[]> =>
      ipcRenderer.invoke('privacy:aliases', entries),
    mask: (text: string, pairs: AliasPair[]): Promise<string> =>
      ipcRenderer.invoke('privacy:mask', text, pairs)
  },
  scenario: {
    generate: (args: {
      detail: CaseDetail
      templateIds: number[]
      aliases: AliasPair[]
    }): Promise<ScenarioResult> => ipcRenderer.invoke('scenario:generate', args),
    save: (args: { name: string; text: string }): Promise<ActionResult> =>
      ipcRenderer.invoke('scenario:save', args)
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
      ipcRenderer.invoke('setting:set', key, value)
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
    }): Promise<AnalyzeResult> => ipcRenderer.invoke('ai:analyze', args),
    answer: (args: {
      jobTitle: string
      query: string
      sources: { label: string; text: string }[]
    }): Promise<SearchAnswer> => ipcRenderer.invoke('ai:answer', args),
    test: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('ai:test'),
    onProgress: (cb: (msg: string) => void): (() => void) => {
      const handler = (_e: unknown, msg: string): void => cb(msg)
      ipcRenderer.on('ai:progress', handler)
      return () => ipcRenderer.removeListener('ai:progress', handler)
    }
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
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version')
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
