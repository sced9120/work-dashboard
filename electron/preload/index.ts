import { contextBridge, ipcRenderer } from 'electron'
import type {
  AnalyzeResult,
  DocKind,
  ExtractedDoc,
  LocalSettings,
  Notice,
  NoticeInput,
  PickedFile,
  Task,
  TaskInput
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
    export: (): Promise<ActionResult> => ipcRenderer.invoke('data:export'),
    import: (): Promise<ActionResult> => ipcRenderer.invoke('data:import'),
    clear: (): Promise<ActionResult> => ipcRenderer.invoke('data:clear'),
    openFolder: (target: string): Promise<string> => ipcRenderer.invoke('data:openFolder', target)
  },
  shell: {
    open: (url: string): Promise<string | void> => ipcRenderer.invoke('shell:open', url)
  },
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version')
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
