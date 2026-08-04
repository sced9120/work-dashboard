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
