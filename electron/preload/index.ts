import { contextBridge, ipcRenderer, webUtils } from 'electron'
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
  Deadline,
  DeadlineInput,
  Doc,
  DocFull,
  DocInput,
  JournalEntry,
  JournalInput,
  Memo,
  MemoPatch,
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
import type { IcsEvent } from '../../shared/ics'
import type { WeatherPlace, WeatherResult } from '../../shared/weather'
import type { InboxItem, MsgResult } from '../../shared/messenger'

export interface RelayInfoShape {
  hasKey: boolean
  connected: boolean
  url: string
  phone: string
  /** 이름표 열쇠 — 폰 주소 맨 뒤 #n= 에 붙인다 */
  nkey: string
  /** 이름표 열쇠를 새로 만들어 폰 주소가 바뀜 — QR 을 다시 찍어야 함 */
  rescan: boolean
  script: string
  /** 우편함 스크립트 판 (모르면 0) · 이 앱이 아는 최신 판 */
  ver: number
  latest: number
}
/** 폰에서 온 수업 관찰 · 출결을 넣었을 때 */
export interface PhoneRouted {
  obs: number
  att: number
  acts: string[]
}
import type { CatalogResult } from '../../shared/catalog'
import type { ChatAttachment, ChatDelta, ChatMeta, ChatPreset, ChatRecord, ChatStreamReply, ChatStreamRequest } from '../../shared/chat'
import type { OcrAnswer, OcrFile, OcrProgress, OcrRequest } from '../../shared/ocr'
import type { MdTable } from '../../shared/mdtable'
import type { BatchFolder, BatchOptions, BatchProgress, BatchRequest, BatchRow } from '../../shared/batch'
import type { SeteukConfig, SeteukActivity, SeteukMode, SeteukProgress, SeteukOptions, SeteukRosters, SeteukRow, SeteukRows, SeteukStudent, SeteukStyle, SeteukWriteReply, SeteukWriteRequest } from '../../shared/seteuk'
import type { SeteukCompressReply, SeteukCompressRequest, SeteukSumPatch, SeteukSumProgress, SeteukSums } from '../../shared/seteukSum'
import type { NeisOptions, NeisPreviewReply } from '../../shared/seteukNeis'
import type { XlsxPreview } from '../../shared/seteukXlsx'
import type { SeteukReviewReply, SeteukReviewRequest } from '../../shared/seteukReview'
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
  /** 구글 캘린더 — 비공개 iCal 주소로 받아 보기 · .ics 로 보내기 */
  gcal: {
    events: (from: string, to: string): Promise<{ ok: boolean; events: IcsEvent[]; error?: string }> =>
      ipcRenderer.invoke('gcal:events', from, to),
    test: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('gcal:test'),
    clearCache: (): Promise<void> => ipcRenderer.invoke('gcal:clearCache'),
    exportIcs: (args: { from: string; to: string; deadlines: boolean; memo: boolean }): Promise<{ ok: boolean; message: string; count?: number; path?: string }> =>
      ipcRenderer.invoke('gcal:export', args)
  },
  /** 도구 모음 · 받은 테마. force 면 새로 받는다 */
  catalog: {
    get: (force?: boolean): Promise<CatalogResult> => ipcRenderer.invoke('catalog:get', force === true)
  },
  /** 스캔 문서 → 엑셀 (OCR) — 사용자의 Gemini 키로 */
  ocr: {
    pick: (): Promise<OcrFile[]> => ipcRenderer.invoke('ocr:pick'),
    /** 끌어 놓은 파일 — PDF · 사진만 받고 나머지는 이름을 돌려준다 */
    add: (paths: string[]): Promise<{ files: OcrFile[]; skipped: string[] }> => ipcRenderer.invoke('ocr:add', paths),
    run: (req: OcrRequest): Promise<OcrAnswer> => ipcRenderer.invoke('ocr:run', req),
    continue: (tab: string): Promise<OcrAnswer> => ipcRenderer.invoke('ocr:continue', tab),
    cancel: (tab: string): Promise<void> => ipcRenderer.invoke('ocr:cancel', tab),
    /** 탭을 닫을 때 — Gemini 에 올려 둔 파일을 지운다 */
    clear: (tab: string): Promise<void> => ipcRenderer.invoke('ocr:clear', tab),
    save: (tables: MdTable[], title: string): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('ocr:save', tables, title),
    onProgress: (cb: (p: OcrProgress & { tab: string }) => void): (() => void) => {
      const handler = (_e: unknown, p: OcrProgress & { tab: string }): void => cb(p)
      ipcRenderer.on('ocr:progress', handler)
      return () => ipcRenderer.removeListener('ocr:progress', handler)
    }
  },
  /** 폴더 일괄 분석 — 학생 결과물 폴더를 학생별로 묶어 정리 · 세특 · 채점 */
  batch: {
    pick: (): Promise<BatchFolder | null> => ipcRenderer.invoke('batch:pick'),
    /** 끌어 놓은 폴더 */
    add: (folderPath: string): Promise<BatchFolder> => ipcRenderer.invoke('batch:add', folderPath),
    run: (req: BatchRequest): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('batch:run', req),
    cancel: (job: string): Promise<void> => ipcRenderer.invoke('batch:cancel', job),
    save: (rows: BatchRow[], options: BatchOptions, title: string, format: 'xlsx' | 'csv'): Promise<{ ok: boolean; message: string }> =>
      ipcRenderer.invoke('batch:save', rows, options, title, format),
    onProgress: (cb: (p: BatchProgress) => void): (() => void) => {
      const handler = (_e: unknown, p: BatchProgress): void => cb(p)
      ipcRenderer.on('batch:progress', handler)
      return () => ipcRenderer.removeListener('batch:progress', handler)
    }
  },
  journal: {
    list: (): Promise<JournalEntry[]> => ipcRenderer.invoke('journal:list'),
    add: (j: JournalInput): Promise<number> => ipcRenderer.invoke('journal:add', j),
    update: (id: number, j: JournalInput): Promise<void> =>
      ipcRenderer.invoke('journal:update', id, j),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('journal:delete', id)
  },
  /** 세특 작성실 — 명단 · 활동 · 학생별 글은 이 PC 에만 둔다 */
  seteuk: {
    load: (): Promise<{ rosters: SeteukRosters; acts: SeteukActivity[]; rows: Record<string, SeteukRows>; style: SeteukStyle; options: SeteukOptions; config: SeteukConfig; demo: { filled: boolean; canFill: boolean } }> => ipcRenderer.invoke('seteuk:load'),
    saveRoster: (mode: SeteukMode, list: SeteukStudent[]): Promise<SeteukStudent[]> => ipcRenderer.invoke('seteuk:roster', mode, list),
    /** 키 없이 쓸 때 — AI 앱에 붙여 넣을 요청 글(규칙 + 이름을 가린 관찰 기록) */
    request: (actId: string, sid: string): Promise<{ ok: boolean; text?: string; error?: string }> => ipcRenderer.invoke('seteuk:request', actId, sid),
    /** 내 문체 — 예전에 쓴 세특과 문체 카드 */
    saveStyle: (style: SeteukStyle): Promise<SeteukStyle> => ipcRenderer.invoke('seteuk:style', style),
    /** 자동 고쳐쓰기 · 근거 확인 켜고 끄기 */
    saveOptions: (o: SeteukOptions): Promise<SeteukOptions> => ipcRenderer.invoke('seteuk:options', o),
    /** 내 규칙 — 끈 검사 · 내 금지어 · 더할 규칙 · 뺄 칸 */
    saveConfig: (c: SeteukConfig): Promise<SeteukConfig> => ipcRenderer.invoke('seteuk:config', c),
    /** AI 앱용 지침 — Gem · GPT · 프로젝트에 붙여 넣을 글 / Claude 스킬 zip 저장 */
    gemText: (actId: string): Promise<{ ok: boolean; text?: string; error?: string }> => ipcRenderer.invoke('seteuk:gem', actId),
    skillSave: (actId: string): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('seteuk:skill', actId),
    /** 긴 학생 글에서 세특 요점만 뽑기 (짧은 글은 그대로) */
    points: (items: { id: string; text: string }[], model: ModelChoice | null): Promise<{ ok: boolean; out: { id: string; text: string; error?: string }[] }> => ipcRenderer.invoke('seteuk:points', items, model),
    /** 학생부 살펴보기 — 1 · 2학년은 이어 갈 탐구, 3학년은 짜임과 보완할 곳 */
    review: (req: SeteukReviewRequest): Promise<SeteukReviewReply> => ipcRenderer.invoke('seteuk:review', req),
    ground: (actId: string, sid: string, model: ModelChoice | null): Promise<{ ok: boolean; row?: SeteukRow; error?: string }> => ipcRenderer.invoke('seteuk:ground', actId, sid, model),
    styleCard: (model: ModelChoice | null, dry: boolean): Promise<{ ok: boolean; card?: string; text?: string; error?: string }> => ipcRenderer.invoke('seteuk:styleCard', model, dry),
    demoFill: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('seteuk:demoFill'),
    demoClear: (): Promise<void> => ipcRenderer.invoke('seteuk:demoClear'),
    saveActs: (list: SeteukActivity[]): Promise<SeteukActivity[]> => ipcRenderer.invoke('seteuk:acts', list),
    saveRows: (actId: string, patch: Record<string, Partial<SeteukRow>>): Promise<void> => ipcRenderer.invoke('seteuk:rows', actId, patch),
    write: (req: SeteukWriteRequest): Promise<SeteukWriteReply> => ipcRenderer.invoke('seteuk:write', req),
    cancel: (job: string): Promise<void> => ipcRenderer.invoke('seteuk:cancel', job),
    onProgress: (cb: (p: SeteukProgress) => void): (() => void) => {
      const handler = (_e: unknown, p: SeteukProgress): void => cb(p)
      ipcRenderer.on('seteuk:progress', handler)
      return () => ipcRenderer.removeListener('seteuk:progress', handler)
    },
    /** 엑셀로 주고받기 — 고른 파일의 경로는 화면에 넘기지 않는다 */
    xlsxExport: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('seteuk:xlsxExport'),
    xlsxPick: (): Promise<XlsxPreview | null> => ipcRenderer.invoke('seteuk:xlsxPick'),
    xlsxPreview: (id: string, overwrite: boolean): Promise<XlsxPreview> => ipcRenderer.invoke('seteuk:xlsxPreview', id, overwrite),
    xlsxApply: (id: string, overwrite: boolean): Promise<XlsxPreview> => ipcRenderer.invoke('seteuk:xlsxApply', id, overwrite),
    /** 취합 — 기록 영역마다 저장된 압축본 · 최종본 */
    sums: (): Promise<Record<string, SeteukSums>> => ipcRenderer.invoke('seteuk:sums'),
    saveSum: (rec: string, patch: SeteukSumPatch): Promise<void> => ipcRenderer.invoke('seteuk:sum', rec, patch),
    compress: (req: SeteukCompressRequest): Promise<SeteukCompressReply> => ipcRenderer.invoke('seteuk:compress', req),
    compressCancel: (job: string): Promise<void> => ipcRenderer.invoke('seteuk:compressCancel', job),
    onSumProgress: (cb: (p: SeteukSumProgress) => void): (() => void) => {
      const handler = (_e: unknown, p: SeteukSumProgress): void => cb(p)
      ipcRenderer.on('seteuk:sumProgress', handler)
      return () => ipcRenderer.removeListener('seteuk:sumProgress', handler)
    },
    /** 나이스 입력 양식 — 고른 파일의 경로는 화면에 넘기지 않는다 */
    neisPick: (rec: string, opt: NeisOptions): Promise<NeisPreviewReply | null> => ipcRenderer.invoke('seteuk:neisPick', rec, opt),
    neisPreview: (id: string, rec: string, opt: NeisOptions): Promise<NeisPreviewReply> => ipcRenderer.invoke('seteuk:neisPreview', id, rec, opt),
    neisSave: (id: string, rec: string, opt: NeisOptions): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('seteuk:neisSave', id, rec, opt)
  },
  /** 자유 메모장 — 글 메모 · 자유 워크플로우 */
  memos: {
    list: (): Promise<Memo[]> => ipcRenderer.invoke('memos:list'),
    add: (kind: 'memo' | 'flow', title: string, content: string): Promise<number> =>
      ipcRenderer.invoke('memos:add', kind, title, content),
    update: (id: number, patch: MemoPatch): Promise<void> => ipcRenderer.invoke('memos:update', id, patch),
    remove: (id: number): Promise<void> => ipcRenderer.invoke('memos:delete', id)
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
      ipcRenderer.invoke('files:extract', filePath),
    /** 끌어 놓은 파일의 경로 (일렉트론 32 부터 File.path 가 없어졌다) */
    pathOf: (file: File): string => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  },
  /** 업무 도우미 대화 보관 · 파일 올리기 · 지침 모음 */
  chats: {
    list: (): Promise<ChatMeta[]> => ipcRenderer.invoke('chats:list'),
    get: (id: string): Promise<ChatRecord<Record<string, unknown>> | null> => ipcRenderer.invoke('chats:get', id),
    save: (rec: ChatRecord<unknown>): Promise<{ ok: boolean; meta?: ChatMeta; error?: string }> => ipcRenderer.invoke('chats:save', rec),
    rename: (id: string, title: string): Promise<ChatMeta | null> => ipcRenderer.invoke('chats:rename', id, title),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('chats:delete', id),
    presets: (): Promise<ChatPreset[]> => ipcRenderer.invoke('chats:presets'),
    savePresets: (list: ChatPreset[]): Promise<ChatPreset[]> => ipcRenderer.invoke('chats:savePresets', list),
    pick: (): Promise<string[]> => ipcRenderer.invoke('chat:pick'),
    attach: (paths: string[]): Promise<{ attachments: ChatAttachment[]; errors: string[] }> => ipcRenderer.invoke('chat:attach', paths)
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
    /** 업무 도우미 · 일반 대화 — 받는 중인 글은 onChatDelta 로 */
    chatStream: (req: ChatStreamRequest): Promise<ChatStreamReply> => ipcRenderer.invoke('ai:chatStream', req),
    chatStop: (reqId: string): Promise<void> => ipcRenderer.invoke('ai:chatStop', reqId),
    onChatDelta: (cb: (d: ChatDelta) => void): (() => void) => {
      const handler = (_e: unknown, d: ChatDelta): void => cb(d)
      ipcRenderer.on('ai:chatDelta', handler)
      return () => ipcRenderer.removeListener('ai:chatDelta', handler)
    },
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
  /** 메신저 정리 — 붙여 넣은 글에서 할 일 · 출결 뽑기 (이름은 가려 보냄) */
  msg: {
    /** AI 에 보낼 글(가린 것) 미리 보기 */
    mask: (text: string): Promise<string> => ipcRenderer.invoke('msg:mask', text),
    extract: (text: string, model?: ModelChoice): Promise<{ ok: boolean; error?: string; result?: MsgResult; masked?: string }> =>
      ipcRenderer.invoke('msg:extract', text, model)
  },
  /** 폰에서 온 글 */
  inbox: {
    list: (): Promise<InboxItem[]> => ipcRenderer.invoke('inbox:list'),
    remove: (ids: string[]): Promise<void> => ipcRenderer.invoke('inbox:remove', ids),
    onChanged: (cb: (n: number) => void): (() => void) => {
      const handler = (_e: unknown, n: number): void => cb(n)
      ipcRenderer.on('inbox:changed', handler)
      return () => ipcRenderer.removeListener('inbox:changed', handler)
    }
  },
  /** 폰에서 보내기 — 선생님 구글 계정의 Apps Script 우편함 */
  relay: {
    info: (): Promise<RelayInfoShape> => ipcRenderer.invoke('relay:info'),
    newKey: (): Promise<RelayInfoShape> => ipcRenderer.invoke('relay:newKey'),
    connect: (url: string): Promise<{ ok: boolean; error?: string; info?: RelayInfoShape }> => ipcRenderer.invoke('relay:connect', url),
    disconnect: (): Promise<RelayInfoShape> => ipcRenderer.invoke('relay:disconnect'),
    /** QR 을 다시 찍었음 — '주소가 바뀜' 안내를 닫는다 */
    seenQr: (): Promise<RelayInfoShape> => ipcRenderer.invoke('relay:seenQr'),
    pull: (): Promise<{ ok: boolean; added: number; obs?: number; att?: number; error?: string }> => ipcRenderer.invoke('relay:pull'),
    /** 폰에서 온 수업 관찰 · 출결을 제자리에 넣었을 때 */
    onRouted: (cb: (r: PhoneRouted) => void): (() => void) => {
      const handler = (_e: unknown, r: PhoneRouted): void => cb(r)
      ipcRenderer.on('phone:routed', handler)
      return () => ipcRenderer.removeListener('phone:routed', handler)
    }
  },
  /** 날씨 위젯 (Open-Meteo, 키 없음) */
  weather: {
    at: (lat: number, lon: number, force = false): Promise<WeatherResult> => ipcRenderer.invoke('weather:at', lat, lon, force),
    search: (q: string): Promise<{ ok: boolean; places: WeatherPlace[]; error?: string }> => ipcRenderer.invoke('weather:search', q),
    /** 나이스에 연결한 학교 주소의 시 · 군 · 구 */
    schoolPlace: (): Promise<WeatherPlace | null> => ipcRenderer.invoke('weather:schoolPlace')
  },
  /** 학교 시간표 (엑셀에서 읽은 것) */
  tt: {
    get: (): Promise<SchoolTimetable | null> => ipcRenderer.invoke('tt:get'),
    /** 파일을 골라 읽는다. 고르지 않으면 { ok: false, error: '' } */
    /** canAi: 모양을 못 알아봤다 — [AI로 읽기] 를 보일 수 있다 */
    import: (): Promise<{ ok: boolean; tt?: SchoolTimetable; error?: string; canAi?: boolean }> => ipcRenderer.invoke('tt:import'),
    /** 시트마다 수업이 다른 판일 때, 같은 파일을 이 시트 기준으로 다시 읽는다 */
    useSheet: (name: string): Promise<{ ok: boolean; tt?: SchoolTimetable; error?: string }> => ipcRenderer.invoke('tt:useSheet', name),
    /** AI 로 읽기 — 'failed' 방금 못 읽은 파일, 'current' 지금 불러온 파일. 한글 낱말은 가려 보낸다 */
    aiRead: (which: 'failed' | 'current'): Promise<{ ok: boolean; tt?: SchoolTimetable; error?: string }> =>
      ipcRenderer.invoke('tt:aiRead', which),
    onAiProgress: (cb: (msg: string) => void): (() => void) => {
      const handler = (_e: unknown, msg: string): void => cb(msg)
      ipcRenderer.on('tt:aiProgress', handler)
      return () => ipcRenderer.removeListener('tt:aiProgress', handler)
    },
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
  /** 백업 — 날마다 자동 · 지금 백업 · 이 때로 되돌리기 */
  backup: {
    list: (): Promise<{ file: string; kind: string; at: number; sizeKb: number }[]> => ipcRenderer.invoke('backup:list'),
    now: (): Promise<ActionResult> => ipcRenderer.invoke('backup:now'),
    restore: (file: string): Promise<ActionResult> => ipcRenderer.invoke('backup:restore', file)
  },
  shell: {
    open: (url: string): Promise<string | void> => ipcRenderer.invoke('shell:open', url)
  },
  /** 오류 기록 — %APPDATA%\work-dashboard\logs\error.log (이 PC 에만) */
  log: {
    error: (where: string, message: string, stack = ''): Promise<void> => ipcRenderer.invoke('log:error', { where, message, stack }),
    openFolder: (): Promise<string> => ipcRenderer.invoke('log:open')
  },
  ui: {
    /** 창 제목 줄 · 스크롤바 밝기. 'system' | 'light' | 'dark' */
    setNativeTheme: (mode: string): Promise<void> => ipcRenderer.invoke('ui:nativeTheme', mode),
    /** 글자 크기 — 창 전체 배율 (0.9 ~ 1.25) */
    setZoom: (factor: number): Promise<void> => ipcRenderer.invoke('ui:zoom', factor)
  },
  clipboard: {
    read: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),
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
  /** 의견 보내기에 채울 운영체제 이름 · 버전 */
  appOs: (): Promise<string> => ipcRenderer.invoke('app:os'),
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
