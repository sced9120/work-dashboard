/**
 * 업무 도우미 대화 — 보관(채팅 목록)과 두 가지 모드.
 *
 *  - work(업무 도우미): 보관한 공문 · 업무 · 일지 · 시간표 · 도움자료를 근거로 답하고, 일정 · 업무 넣기와 한글 파일 만들기를 내민다.
 *  - free(일반 대화): 보관 자료를 싣지 않는 그냥 대화. 선생님이 준 지침(예: 세특 쓰기)을 대화 내내 따른다. 그림은 만들지 않는다.
 *
 * 대화는 이 PC 의 자료 폴더(chats/)에 대화마다 파일 하나로 둔다. 인수인계 파일(DB)에는 들어가지 않는다.
 */

export type ChatMode = 'work' | 'free'

export const CHAT_MODES: { id: ChatMode; label: string; icon: string; desc: string }[] = [
  { id: 'work', label: '업무 도우미', icon: '📚', desc: '보관한 공문 · 업무 · 일지 · 시간표를 근거로 답하고, 일정 넣기 · 한글 문서 만들기를 도와줍니다' },
  { id: 'free', label: '일반 대화', icon: '💬', desc: '보관 자료 없이 그냥 대화합니다. 지침을 주면 그대로 따릅니다(세특 쓰기, 글 다듬기 …)' }
]

/**
 * 올린 파일. 글자를 뽑을 수 있으면 글(text)로, 사진 · 글자 없는 PDF(스캔본)는 파일 그대로(AI 가 그림으로 본다) 보낸다.
 * 파일 그대로 보내는 것은 대화에 경로만 적어 두고 보낼 때마다 다시 읽는다(학생 파일을 프로그램 안에 복사해 두지 않는다).
 */
export interface ChatAttachment {
  kind: 'text' | 'image' | 'pdf'
  name: string
  /** text — 뽑은 글 */
  text?: string
  /** 이 PC 의 파일 경로 (image · pdf 는 보낼 때 읽고, 한글 파일은 양식으로 쓴다) */
  path?: string
  mime?: string
  size?: number
}

/** 화면 · 보관에 쓰는 한 마디. 업무 도우미의 일감 · 한글 파일 카드 같은 것은 화면 쪽이 extra 로 붙인다 */
export interface ChatMsgBase {
  role: 'user' | 'assistant'
  content: string
  attachments?: ChatAttachment[]
  /** 답을 멈춰서 중간까지만 받았으면 */
  stopped?: boolean
  error?: boolean
}

export interface ChatMeta {
  id: string
  title: string
  mode: ChatMode
  /** 일반 대화의 지침 */
  instruction: string
  created: string
  updated: string
  /** 마디 수 */
  count: number
}

export interface ChatRecord<M = ChatMsgBase> extends ChatMeta {
  messages: M[]
}

/** 저장해 두고 다시 쓰는 지침 */
export interface ChatPreset {
  id: string
  name: string
  text: string
  /** 프로그램에 들어 있는 보기 — 지울 수 없고, 고쳐 쓰면 내 지침으로 저장된다 */
  builtin?: boolean
}

/** 보낼 때 대화에서 쓰는 모양 (메인으로 넘긴다) */
export interface ChatSendTurn {
  role: 'user' | 'assistant'
  content: string
  attachments?: ChatAttachment[]
}

export interface ChatStreamRequest {
  /** 이 요청의 번호 — 받는 중인 글 · 멈추기에 쓴다 */
  reqId: string
  mode: ChatMode
  jobTitle: string
  instruction: string
  history: ChatSendTurn[]
  /** 이 대화에 올린 한글 파일 이름 (업무 도우미가 양식으로 쓸 수 있다) */
  formFiles?: string[]
  model?: { provider: 'openai' | 'gemini' | 'claude'; model: string }
}

export interface ChatStreamReply {
  ok: boolean
  answer: string
  sources: string[]
  links?: { title: string; url: string }[]
  /** 멈추기로 중간에 끊었으면 */
  stopped?: boolean
  error?: string
}

/** 받는 중인 글 (메인 → 화면) */
export interface ChatDelta {
  reqId: string
  text: string
}

/** 사진 · PDF 를 파일 그대로 보낼 때 한 파일 · 한 번에 보내는 합의 상한 */
export const CHAT_MAX_FILE = 15 * 1024 * 1024
export const CHAT_MAX_BINARY = 18 * 1024 * 1024
/** 글로 뽑은 파일을 한 마디에 싣는 상한 (글자) */
export const CHAT_MAX_TEXT = 60000

export const CHAT_IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif'
}

/** 대화 번호 — 파일 이름으로 쓰므로 모양을 좁혀 둔다 */
export const isChatId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{7,40}$/.test(id)

/** 첫 질문으로 대화 제목 */
export function chatTitle(text: string, files: string[] = []): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t) return t.length > 40 ? `${t.slice(0, 40)}…` : t
  if (files.length) return files[0]
  return '새 대화'
}

/** 목록을 날짜로 묶는 이름 */
export function chatGroup(updated: string, now = new Date()): string {
  const d = new Date(updated)
  if (Number.isNaN(d.getTime())) return '이전'
  const day = (x: Date): number => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86400000)
  const diff = day(now) - day(d)
  if (diff <= 0) return '오늘'
  if (diff === 1) return '어제'
  if (diff < 7) return '지난 7일'
  if (diff < 30) return '지난 30일'
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`
}

/** 프로그램에 들어 있는 지침 보기 — 그대로 쓰거나 고쳐서 내 지침으로 저장한다 */
export const BUILTIN_PRESETS: ChatPreset[] = [
  {
    id: 'builtin-setuk',
    name: '교과 세특 초안 쓰기',
    builtin: true,
    text: [
      '선생님이 올린 학생 결과물(보고서 · 활동지 · 사진 등)과 선생님이 적어 준 관찰 내용을 바탕으로 교과 세부능력 및 특기사항(세특) 초안을 씁니다.',
      '- 결과물과 선생님 말에 실제로 있는 것만 근거로 씁니다. 없는 활동 · 성취 · 태도를 지어내지 않습니다.',
      '- 무엇을 주제로 삼았고, 어떤 과정(자료 조사 · 계산 · 실험 · 토의 등)을 거쳐 무엇을 알게 되었는지가 드러나게 구체적으로 쓰고, 그 과정에서 보인 역량을 근거와 함께 씁니다.',
      "- 문장은 '~함.', '~임.', '~보임.' 처럼 끝내고, 학생 이름이나 '학생은' 같은 주어는 쓰지 않습니다.",
      '- 학교생활기록부 기재요령에서 막는 것(교외 대회 · 수상, 논문 · 도서 출간, 어학 시험 점수, 특정 대학 · 기관 · 상호 · 강사 이름, 부모의 직업 · 사회경제적 지위 등)은 넣지 않습니다.',
      '- 따로 말하지 않으면 공백 포함 500자 안팎으로 쓰고, 끝에 글자 수를 적습니다.',
      "- 결과물만으로 판단하기 어려운 것은 초안 아래 '확인할 점'으로 따로 적습니다.",
      '(보기입니다. 우리 학교 · 올해 기재요령에 맞게 고쳐 쓰세요.)'
    ].join('\n')
  },
  {
    id: 'builtin-polish',
    name: '공문 · 안내문 말투로 다듬기',
    builtin: true,
    text: [
      '선생님이 준 글을 학교 공문 · 가정통신문에 맞는 말투로 다듬습니다.',
      '- 뜻과 사실(날짜 · 시간 · 장소 · 대상 · 금액)은 바꾸지 않고, 빠진 것이 있으면 따로 묻습니다.',
      '- 쉬운 낱말로 짧게 쓰고, 고친 글을 먼저 보여 준 뒤 무엇을 왜 고쳤는지 짧게 덧붙입니다.'
    ].join('\n')
  }
]
