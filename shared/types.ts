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

/** 이 PC에만 남는 설정. 인수인계 DB에 포함되지 않는다. */
export interface LocalSettings {
  provider: 'openai' | 'gemini'
  openai_key: string
  gemini_key: string
  openai_model: string
  gemini_model: string
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
  /** 등록된 업무인지, 보관된 공문 원문인지 */
  kind: 'task' | 'document'
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

export type ScenarioKind = '대본' | '회의록'

/** 기존에 쓰던 대본·회의록. AI에 형식 본보기로 함께 보낸다. */
export interface Template {
  id: number
  name: string
  kind: string
  content: string
  added_at: string
}

export type TemplateInput = Omit<Template, 'id'>

/** 화면에서 입력받는 사안 정보. 실명이 들어 있을 수 있다. */
export interface CaseDetail {
  kind: ScenarioKind
  /** 회차·일시·장소 */
  meetingInfo: string
  /** 사안명 */
  caseTitle: string
  /** 사안 개요 */
  summary: string
  /** 학생 진술 요지 */
  statements: string
  /** 위원 구성 */
  members: string
  /** 심의 방향이나 예상 처분 */
  expected: string
  /** 회의록을 쓸 때 넣는 진행 메모 */
  notes: string
}

export const BLANK_CASE: CaseDetail = {
  kind: '대본',
  meetingInfo: '',
  caseTitle: '',
  summary: '',
  statements: '',
  members: '',
  expected: '',
  notes: ''
}

export interface ScenarioResult {
  ok: boolean
  /** 실명으로 되돌린 결과 */
  text: string
  /** 실제로 AI에 보낸 글. 무엇이 나갔는지 확인용 */
  sentToAi: string
  error?: string
}

export const ROLES = ['학생', '보호자', '교사', '위원', '관계자'] as const

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

export const OPENAI_MODELS = ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'] as const
export const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'] as const

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
