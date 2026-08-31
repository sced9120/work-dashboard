/** 메인 프로세스와 렌더러가 함께 쓰는 타입 정의 */

export interface Task {
  id: number
  /** 업무명 */
  title: string
  /** 화면에 보이는 시기 표기. 예: "3월 1주", "수시" */
  task_date_display: string
  /** 문서에 적혀 있던 원래 날짜 표현 */
  task_date_raw: string
  /** 출처 구분. 예: "길라잡이/매뉴얼", "개별 공문", "직접 등록" */
  task_type: string
  /** 처리 절차 */
  workflow: string
  /** 상세 본문 (원문 보존) */
  draft_full: string
  /** 핵심 유의사항 */
  key_points: string
  /** 원본 파일명 */
  filename: string
  /** 완료 여부 (0/1) */
  is_completed: number
  /** 근거가 된 보관 문서의 id. 0이면 연결된 원문이 없다. */
  document_id: number
}

export type TaskInput = Omit<Task, 'id'>

export interface Notice {
  id: number
  title: string
  content: string
  date: string
  link: string
}

export type NoticeInput = Omit<Notice, 'id'>

/** DB에 저장되어 인수인계 파일과 함께 넘어가는 설정 */
export interface DbSettings {
  job_title: string
  school_name: string
}

export type Provider = 'openai' | 'gemini' | 'claude'

/**
 * AI 기능별로 어떤 서비스·모델을 쓸지.
 * 각 기능에서 개별 선택할 수 있고, 저장돼 다음에도 이어진다.
 */
export type AiFeature = 'analyze' | 'summary' | 'scenario' | 'chat'

export interface ModelChoice {
  provider: Provider
  model: string
}

export type FeatureModels = Partial<Record<AiFeature, ModelChoice>>

/** 사용자가 설정에서 직접 추가한 모델 이름들 (서비스별) */
export type CustomModels = Partial<Record<Provider, string[]>>

/**
 * 기본 제공 목록에서 사용자가 빼 버린 모델 이름들 (서비스별).
 * 기본 목록을 통째로 저장하지 않고 "뺀 것"만 기억하므로,
 * 나중에 프로그램이 새 모델을 기본으로 추가하면 그것은 그대로 나타난다.
 */
export type HiddenModels = Partial<Record<Provider, string[]>>

/** 이 PC에만 남는 설정. 인수인계 DB에 포함되지 않는다. */
export interface LocalSettings {
  /** 기능별 지정이 없을 때 쓸 기본 서비스 */
  provider: Provider
  openai_key: string
  gemini_key: string
  claude_key: string
  /** 서비스별 기본 모델. 기능별로 따로 고르지 않았을 때 이 값을 쓴다. */
  openai_model: string
  gemini_model: string
  claude_model: string
  /** 기능별 개별 선택. 비어 있으면 위의 기본값을 쓴다. */
  feature_models: FeatureModels
  /** 설정에서 추가한 모델 이름. 기본 목록과 합쳐 드롭다운에 나온다. */
  custom_models: CustomModels
  /** 기본 목록에서 빼 버린 모델 이름. */
  hidden_models: HiddenModels
  /** 기한이 다가오면 윈도우 알림을 띄운다 */
  notify_deadlines: boolean
  /** 며칠 전부터 알릴지 */
  notify_days: number
  /** 창을 닫아도 시계 옆(트레이)에 남긴다 */
  keep_in_tray: boolean
  /** 컴퓨터를 켤 때 자동으로 실행한다 */
  open_at_login: boolean
}

export interface ExtractedDoc {
  filename: string
  text: string
  chars: number
  error?: string
}

/** AI가 문서에서 뽑아낸 업무 후보. 사용자가 확인 후 등록한다. */
export interface TaskDraft {
  title: string
  task_date_display: string
  task_date_raw: string
  workflow: string
  draft_full: string
  key_points: string
  filename: string
  /** 등록 대상으로 선택되었는지 */
  selected: boolean
  /**
   * 이미 보관된 공문에서 뽑은 것이면 그 문서 id.
   * 보관함을 다시 학습시킬 때 원문을 두 번 넣지 않으려고 들고 다닌다.
   */
  document_id?: number
}

export type DocKind = '길라잡이/매뉴얼' | '개별 공문'

/* ---------- 보관 문서 (공문 원문) ---------- */

/** 목록용. 본문(content)은 무거워서 빼고 보낸다. */
export interface Doc {
  id: number
  /** 원본 파일명 */
  filename: string
  /** 길라잡이/매뉴얼 · 개별 공문 */
  doc_kind: string
  /** 문서에서 찾아낸 접수·시행 일자. 못 찾으면 빈 문자열 */
  doc_date: string
  /** 프로그램에 보관한 날짜 */
  added_at: string
  /** 본문 글자 수 */
  chars: number
}

/** 본문까지 포함한 문서 */
export interface DocFull extends Doc {
  content: string
}

export type DocInput = Omit<Doc, 'id' | 'chars'> & { content: string }

/* ---------- 통합 검색 ---------- */

export interface SearchHit {
  /** 등록된 업무인지, 보관된 공문 원문인지, 업무 일지인지 */
  kind: 'task' | 'document' | 'journal'
  id: number
  title: string
  /** 업무면 시기, 문서면 접수일자 */
  subtitle: string
  filename: string
  /** 정렬용 날짜 (YYYY-MM-DD). 없으면 빈 문자열 */
  date: string
  /** 관련도 점수. 높을수록 먼저 */
  score: number
  /** 검색어 주변을 잘라낸 미리보기 */
  snippets: string[]
}

export interface SearchAnswer {
  ok: boolean
  answer: string
  error?: string
}

/* ---------- 위원회 대본 · 회의록 ---------- */

/** 실명과 가명의 짝. 이 PC 밖으로 나가지 않는다. */
export interface AliasPair {
  real: string
  alias: string
}

/**
 * 예전에 쓰던 문서. AI 에 "이 학교는 이렇게 쓴다" 는 본보기로 함께 보낸다.
 *
 * kind 에는 문서 서식의 id(shared/docforms.ts) 가 들어간다.
 * '서식' 만 예외로, 빈칸 채우기용 서식을 뜻한다.
 */
export interface Template {
  id: number
  name: string
  kind: string
  content: string
  added_at: string
}

export type TemplateInput = Omit<Template, 'id'>

/** 화면에서 채운 문서 입력. 실명이 들어 있을 수 있다. */
export interface DocDraftInput {
  /** 문서 서식의 id */
  formId: string
  /** 칸 이름 → 적은 내용 */
  values: Record<string, string>
  /** 본보기로 함께 보낼 예시의 id */
  exampleIds: number[]
}

export interface DocDraftResult {
  ok: boolean
  /** 실명으로 되돌린 결과 */
  text: string
  /** 실제로 AI에 보낸 글. 무엇이 나갔는지 확인용 */
  sentToAi: string
  error?: string
}

export const ROLES = ['학생', '보호자', '교사', '위원', '관계자'] as const

/* ---------- 업무 일지 ---------- */

/** 그날 무슨 일을 했는지 짧게 남기는 기록. 인수인계 파일에 함께 넘어간다. */
export interface JournalEntry {
  id: number
  /** YYYY-MM-DD */
  entry_date: string
  content: string
}

export type JournalInput = Omit<JournalEntry, 'id'>

/* ---------- 달력 일정 ---------- */

/**
 * 달력에 직접 넣는 일정·할 일.
 * 업무(tasks)가 "3월 1주" 같은 뭉뚱그린 시기라면, 이쪽은 실제 날짜를 가진다.
 */
export interface CalEvent {
  id: number
  /** 시작일 YYYY-MM-DD */
  event_date: string
  /** 종료일 YYYY-MM-DD. 하루짜리면 시작일과 같다. */
  end_date: string
  /** 시작 시각 HH:MM. 하루 종일이면 빈 문자열 */
  start_time: string
  title: string
  content: string
  /** 색 이름. EVENT_COLORS 중 하나 */
  color: string
  /** 기한으로 챙길지. 켜면 D-day 가 붙고 윈도우 알림 대상이 된다 */
  remind: number
  /** 완료 여부 (0/1) */
  done: number
}

export type CalEventInput = Omit<CalEvent, 'id'>

/** 달력에서 고를 수 있는 색. 갤럭시 달력처럼 일정 성격을 색으로 구분한다. */
export const EVENT_COLORS = [
  { id: 'blue', label: '파랑' },
  { id: 'green', label: '초록' },
  { id: 'orange', label: '주황' },
  { id: 'red', label: '빨강' },
  { id: 'purple', label: '보라' },
  { id: 'gray', label: '회색' }
] as const

export const BLANK_EVENT: CalEventInput = {
  event_date: '',
  end_date: '',
  start_time: '',
  title: '',
  content: '',
  color: 'blue',
  remind: 0,
  done: 0
}

/* ---------- 업무 워크플로우 (그림으로 그리는 흐름도) ---------- */

/** 흐름도의 상자 하나 */
export interface WfNode {
  id: string
  /** 판 위의 자리 */
  x: number
  y: number
  /** 상자 너비. 높이는 글자 수에 따라 늘어난다 */
  w: number
  text: string
  /** 시작·일반 단계·판단(마름모)·끝 */
  kind: 'start' | 'step' | 'decision' | 'end'
}

/** 상자와 상자를 잇는 화살표 */
export interface WfEdge {
  id: string
  from: string
  to: string
  /** 화살표에 붙는 말. 판단 뒤의 "예 / 아니오" 같은 것 */
  label: string
}

export interface Workflow {
  nodes: WfNode[]
  edges: WfEdge[]
}

export const BLANK_WORKFLOW: Workflow = { nodes: [], edges: [] }

/** 상자 종류별 이름과 기본 크기 */
export const WF_KINDS: { id: WfNode['kind']; label: string }[] = [
  { id: 'start', label: '시작' },
  { id: 'step', label: '단계' },
  { id: 'decision', label: '판단' },
  { id: 'end', label: '끝' }
]

/* ---------- 업데이트 확인 ---------- */

export interface UpdateInfo {
  /** 새 버전이 있는지 */
  available: boolean
  /** 지금 쓰고 있는 버전 */
  current: string
  /** 올라와 있는 최신 버전. 확인 못 했으면 빈 문자열 */
  latest: string
  /** 내려받을 페이지 주소 */
  url: string
  /** 프로그램 안에서 바로 받아 설치할 수 있는 환경인지. Portable·개발 중이면 false */
  canAutoInstall: boolean
  /** 확인에 실패한 이유. 학교망에서 막히는 경우가 있어 조용히 넘긴다. */
  error?: string
}

/* ---------- 절차 기한 ---------- */

/**
 * 놓치면 절차에 하자가 생기는 날짜를 챙기기 위한 것.
 * 사안명에 개인정보가 들어갈 수 있어, 인수인계 파일에서는 기본으로 빠진다.
 */
export interface Deadline {
  id: number
  /** 무엇을 해야 하는지 */
  title: string
  /** 관련 사안이나 대상 (선택) */
  case_ref: string
  /** 기한 YYYY-MM-DD */
  due_date: string
  note: string
  /** 처리 완료 여부 (0/1) */
  done: number
}

export type DeadlineInput = Omit<Deadline, 'id'>

export const BLANK_DEADLINE: DeadlineInput = {
  title: '',
  case_ref: '',
  due_date: '',
  note: '',
  done: 0
}

/** 자주 쓰는 기한 항목. 날짜만 채우면 되도록 이름을 미리 준비해 둔다. */
export const DEADLINE_PRESETS = [
  '선도위원회 개최 통보',
  '보호자 출석 통지',
  '심의 결과 통지',
  '재심 청구 기간 만료',
  '처분 이행 시작',
  '처분 이행 완료',
  '조치 결과 보고'
] as const

export interface AnalyzeResult {
  ok: boolean
  drafts: TaskDraft[]
  error?: string
}

export interface PickedFile {
  path: string
  name: string
}

export const OPENAI_MODELS = ['gpt-5.6-terra', 'gpt-5.6-luna'] as const
export const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite'] as const
export const CLAUDE_MODELS = ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5'] as const

/** 프로그램이 기본으로 아는 모델 목록. 여기 있는 것은 지울 수 없다. */
export const BUILTIN_MODELS: Record<Provider, readonly string[]> = {
  gemini: GEMINI_MODELS,
  openai: OPENAI_MODELS,
  claude: CLAUDE_MODELS
}

/** 모델 목록을 이루는 두 조각. 함께 저장되고 함께 바뀐다. */
export interface ModelLists {
  custom: CustomModels
  hidden: HiddenModels
}

/** 화면에 보여 줄 최종 목록 = (기본 목록 − 뺀 것) + 추가한 것 */
export function modelsFor(p: Provider, custom?: CustomModels, hidden?: HiddenModels): string[] {
  const hide = new Set(hidden?.[p] ?? [])
  const out = BUILTIN_MODELS[p].filter((m) => !hide.has(m))
  for (const m of custom?.[p] ?? []) {
    if (m && !out.includes(m)) out.push(m)
  }
  return out
}

/** 프로그램이 기본으로 아는 이름인지 (되돌리기 가능 여부 표시에 쓴다) */
export function isBuiltinModel(p: Provider, model: string): boolean {
  return (BUILTIN_MODELS[p] as readonly string[]).includes(model)
}

/**
 * 목록에 모델 하나를 넣는다.
 * 기본 제공 이름을 다시 넣는 경우라면 "뺀 것" 목록에서 빼 주면 된다.
 */
export function addModel(lists: ModelLists, p: Provider, model: string): ModelLists {
  const m = model.trim()
  if (!m) return lists

  if (isBuiltinModel(p, m)) {
    const hiddenList = (lists.hidden[p] ?? []).filter((x) => x !== m)
    return { custom: lists.custom, hidden: { ...lists.hidden, [p]: hiddenList } }
  }

  const list = lists.custom[p] ?? []
  if (list.includes(m)) return lists
  return { custom: { ...lists.custom, [p]: [...list, m] }, hidden: lists.hidden }
}

/**
 * 목록에서 모델 하나를 뺀다.
 * 직접 추가한 것은 지우고, 기본 제공 이름은 "뺀 것" 목록에 넣어 감춘다.
 */
export function removeModel(lists: ModelLists, p: Provider, model: string): ModelLists {
  if (isBuiltinModel(p, model)) {
    const hiddenList = lists.hidden[p] ?? []
    if (hiddenList.includes(model)) return lists
    return { custom: lists.custom, hidden: { ...lists.hidden, [p]: [...hiddenList, model] } }
  }

  const list = (lists.custom[p] ?? []).filter((x) => x !== model)
  return { custom: { ...lists.custom, [p]: list }, hidden: lists.hidden }
}

/** 그 서비스의 목록을 기본 상태로 되돌린다(추가한 것도 함께 사라진다). */
export function resetModels(lists: ModelLists, p: Provider): ModelLists {
  return {
    custom: { ...lists.custom, [p]: [] },
    hidden: { ...lists.hidden, [p]: [] }
  }
}

/* ---------- 업무 도우미 (문서 기반 챗봇) ---------- */

/** 도우미와 주고받은 한 마디. user=사용자, assistant=도우미 */
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatReply {
  ok: boolean
  answer: string
  /** 답을 만들 때 근거로 삼은 자료의 이름들 */
  sources: string[]
  error?: string
}

export const SUPPORTED_EXTENSIONS = [
  'hwp',
  'hwpx',
  'pdf',
  'xlsx',
  'xls',
  'docx',
  'txt',
  'md',
  'csv'
]
