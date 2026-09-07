import type { DocForm } from '../../shared/docforms'
import type {
  AiFeature,
  AliasPair,
  AnalyzeResult,
  ChatReply,
  ChatTurn,
  DocDraftResult,
  DocKind,
  FormSketch,
  LocalSettings,
  ModelChoice,
  Provider,
  TaskDraft,
  Template
} from '../../shared/types'
import { leakCheck, maskText, unmaskText } from './anonymize'

/** 한 번에 모델에 보내는 글자 수. 긴 매뉴얼은 여러 번 나눠 보낸다. */
const CHUNK_SIZE = 28000
const MAX_CHUNKS = 8

function chunk(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text]
  const out: string[] = []
  let pos = 0
  while (pos < text.length && out.length < MAX_CHUNKS) {
    let end = Math.min(pos + CHUNK_SIZE, text.length)
    if (end < text.length) {
      // 되도록 문단 경계에서 자른다.
      const br = text.lastIndexOf('\n', end)
      if (br > pos + CHUNK_SIZE * 0.6) end = br
    }
    out.push(text.slice(pos, end))
    pos = end
  }
  return out
}

/** 지시문에 실어 보내는 업무분장의 최대 길이 */
const ROSTER_BUDGET = 4000

/**
 * 공문 한 건을 업무 한 건으로 정리하라는 지시문.
 *
 * 공문은 보통 본문 하나에 붙임 몇 개로 이루어지고, 그 전체가 하나의 일이다.
 * 예전에는 길라잡이와 같은 지시문을 써서 붙임마다 업무를 하나씩 뽑았고,
 * 공문 한 건에서 수십 건이 쏟아져 로드맵이 어지러워졌다.
 */
function noticePrompt(jobTitle: string, filename: string, body: string, part: string): string {
  const year = new Date().getFullYear()

  return `당신은 대한민국 학교 행정 업무를 잘 아는 실무자입니다.
이 문서는 '${jobTitle}' 담당자에게 온 공문 한 건입니다.

**공문 한 건은 업무 한 건입니다. 업무를 하나만 적으세요.**
공문 안에 붙임이나 세부 항목이 여러 개 있어도 나누지 마세요.
그것들은 따로 떨어진 일이 아니라 이 한 업무를 하는 차례이므로 "절차" 에 넣습니다.

칸마다 이렇게 적습니다:
- 제목 — 공문의 제목을 그대로 씁니다. 제목이 없으면 무슨 일인지 한 줄로 적습니다.
- 시기_표시 — 접수일자나 제출 기한을 찾아 "MM월 N주" 로 적습니다.
  기준 연도는 ${year}년입니다. 기한을 알 수 없으면 "수시" 로 적습니다.
- 시기_원본 — 문서에 적힌 날짜 표현을 그대로 옮깁니다.
- 본문 — 원문 내용을 최대한 살려 적습니다. 과하게 요약하지 마세요.
- 절차 — 해야 할 일을 차례대로 번호를 붙여 적습니다. 붙임과 세부 항목도 여기에 넣습니다.
- 포인트 — 기한, 제출처, 놓치면 안 되는 것을 짧게 적습니다.

규칙:
- 반드시 아래 JSON 형식만 출력합니다. 설명 문장이나 코드블록 표시를 붙이지 마세요.
- 문서에 없는 내용을 지어내지 마세요. 근거가 없으면 빈 문자열로 둡니다.

JSON 형식:
{"task":{"제목":"","시기_표시":"","시기_원본":"","본문":"","절차":"","포인트":""}}

파일명: ${filename}${part}

문서 내용:
${body}`
}

/**
 * 길라잡이·매뉴얼에서 업무를 모두 뽑으라는 지시문.
 *
 * 길라잡이에는 부서 전체의 일이 실려 있어, 그대로 다 등록하면
 * 내가 맡지도 않은 일까지 로드맵에 쌓인다. 그래서 업무분장을 함께 보내
 * 내 일인지 아닌지를 함께 매기게 하고, 화면에서 그것만 골라 두게 한다.
 */
function guidePrompt(
  jobTitle: string,
  roster: string,
  filename: string,
  body: string,
  part: string
): string {
  const mineRule = roster.trim()
    ? `
아래가 이 담당자의 업무분장입니다. 뽑아낸 업무마다 이 분장에 드는지 가려 주세요.

- "내업무" — 분장에 그대로 적혀 있거나, 이름만 다를 뿐 같은 일이면 true
- 다른 부서나 다른 담당자가 맡는 일이면 false 로 하고,
  "담당" 에 문서가 적어 둔 부서나 담당을 적습니다
- 헷갈리면 true 로 두세요. 마지막에 고르는 것은 사람이 합니다.

--- 업무분장 ---
${roster.trim().slice(0, ROSTER_BUDGET)}
--- 업무분장 끝 ---
`
    : `
업무분장을 적어 두지 않았으므로 "내업무" 는 모두 true, "담당" 은 빈 문자열로 두세요.
`

  return `당신은 대한민국 학교 행정 업무를 잘 아는 실무자입니다.
이 문서는 '${jobTitle}' 담당자의 업무 길라잡이(매뉴얼)입니다.
문서에 나오는 개별 업무를 빠짐없이 모두 뽑아 주세요.
시기는 문서 내용을 근거로 "3월 1주", "학기 초", "수시" 같은 형태로 적습니다.
${mineRule}
규칙:
- 반드시 아래 JSON 형식만 출력합니다. 설명 문장이나 코드블록 표시를 붙이지 마세요.
- 문서에 없는 내용을 지어내지 마세요. 근거가 없으면 빈 문자열로 둡니다.
- "본문"에는 원문 내용을 최대한 살려 적습니다. 과하게 요약하지 마세요.
- 업무가 하나도 없으면 tasks를 빈 배열로 둡니다.

JSON 형식:
{"tasks":[{"제목":"","시기_표시":"","시기_원본":"","본문":"","절차":"","포인트":"","담당":"","내업무":true}]}

파일명: ${filename}${part}

문서 내용:
${body}`
}

function buildPrompt(
  jobTitle: string,
  roster: string,
  filename: string,
  body: string,
  kind: DocKind,
  part: string
): string {
  return kind === '개별 공문'
    ? noticePrompt(jobTitle, filename, body, part)
    : guidePrompt(jobTitle, roster, filename, body, part)
}

interface RawTask {
  제목?: unknown
  시기_표시?: unknown
  시기_원본?: unknown
  본문?: unknown
  절차?: unknown
  포인트?: unknown
  담당?: unknown
  내업무?: unknown
}

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (v === null || v === undefined) return ''
  return String(v)
}

/** 모델이 true 를 "true"·"예" 처럼 글자로 보내오기도 한다. */
function bool(v: unknown, dflt: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase()
    if (['true', 'yes', 'y', '예', '맞음', '내업무'].includes(t)) return true
    if (['false', 'no', 'n', '아니오', '아니요', '아님'].includes(t)) return false
  }
  return dflt
}

function parseTasks(raw: string, filename: string, kind: DocKind): TaskDraft[] {
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    // 앞뒤에 말을 붙여 보낸 경우 중괄호 범위만 잘라 다시 시도한다.
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('AI 응답을 해석하지 못했습니다.')
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  }

  // 길라잡이는 여럿({"tasks":[…]}), 공문은 하나({"task":{…}}) 로 받는다.
  const box = parsed as { tasks?: unknown; task?: unknown }
  const list = Array.isArray(box.tasks)
    ? box.tasks
    : box.task && typeof box.task === 'object'
      ? [box.task]
      : null
  if (!list) throw new Error('AI 응답에 업무 목록이 없습니다.')

  // 공문 한 건은 업무 한 건이므로, 제목을 못 뽑았다고 버리면 그 공문이 통째로 빠진다.
  // 그럴 때는 파일 이름을 제목으로 쓴다.
  const fallback = kind === '개별 공문' ? filename.replace(/\.[^.]+$/, '') : '(제목 없음)'

  return list
    .map((item): TaskDraft => {
      const t = item as RawTask
      // 분장을 안 적었으면 모델이 "내업무" 를 빼고 보낼 수 있다. 그때는 내 일로 본다.
      const mine = bool(t.내업무, true)
      return {
        title: str(t.제목) || fallback,
        task_date_display: str(t.시기_표시) || '수시',
        task_date_raw: str(t.시기_원본),
        workflow: str(t.절차),
        draft_full: str(t.본문),
        key_points: str(t.포인트),
        filename,
        owner: str(t.담당),
        mine,
        // 내 분장 밖의 일은 꺼 둔 채로 보여 준다. 켜는 것은 사람이 한다.
        selected: mine
      }
    })
    .filter((t) => t.title !== '(제목 없음)' || t.draft_full.length > 0)
}

/**
 * 공문 하나에서 나온 조각들을 업무 한 건으로 합친다.
 *
 * 긴 공문은 여러 번 나눠 보내므로 조각마다 업무가 하나씩 돌아온다.
 * 공문 한 건은 업무 한 건이므로 뒤 조각의 내용을 앞 업무에 이어 붙인다.
 */
function mergeToOne(drafts: TaskDraft[]): TaskDraft[] {
  if (drafts.length <= 1) return drafts

  const join = (a: string, b: string): string => [a, b].filter(Boolean).join('\n\n')
  const out = { ...drafts[0] }
  for (const d of drafts.slice(1)) {
    out.draft_full = join(out.draft_full, d.draft_full)
    out.workflow = join(out.workflow, d.workflow)
    out.key_points = join(out.key_points, d.key_points)
    if (!out.task_date_raw) out.task_date_raw = d.task_date_raw
    // 앞 조각에서 기한을 못 찾았으면 뒤 조각이 찾은 것을 쓴다.
    if (out.task_date_display === '수시' && d.task_date_display !== '수시') {
      out.task_date_display = d.task_date_display
    }
  }
  return [out]
}

/** 한 번에 받을 답의 최대 토큰 수. Claude 는 이 값을 반드시 요구한다. */
const MAX_OUTPUT_TOKENS = 4096

/**
 * JSON 모드일 때 시스템 지시에 "json" 이라는 낱말이 반드시 들어가게 만든다.
 * OpenAI 는 response_format=json_object 를 쓰면서 메시지 어디에도 'json' 이
 * 없으면 400 으로 거절한다. (Gemini·Claude 는 이 제약이 없지만 지시가 있어도 무해하다.)
 */
function jsonSystem(system: string): string {
  const rule = '반드시 유효한 JSON(json) 객체 하나만 출력하세요. 설명이나 코드블록 표시를 붙이지 마세요.'
  return system ? `${system}\n\n${rule}` : rule
}

/**
 * temperature 파라미터를 거부하는 모델들. 세 부류:
 * 1) 정적 판단: o1·o3·o4 계열, gpt-5.x 등 추론 모델은 애초에 안 받는다.
 * 2) 동적 학습: 그 밖의 모델에서 400 이 나면 이 세트에 넣고 이후 요청부터 뺀다.
 * 프로세스 안에서만 기억한다(간단하고, 잘못 학습돼도 재시작이면 초기화된다).
 */
const openaiNoTemperature = new Set<string>()

function openaiSupportsTemperature(model: string): boolean {
  if (openaiNoTemperature.has(model)) return false
  const m = model.toLowerCase()
  // o1/o3/o4 는 이름이 `o1`, `o1-mini`, `o3-mini`, `o4-mini` 처럼 온다.
  if (/^o[1-9](-|$)/.test(m)) return false
  // gpt-5.x / gpt-5-* / gpt-5.6-luna 처럼 gpt-5 계열 (gpt-4·gpt-3.5 는 제외)
  if (/^gpt-5(\.|-|$)/.test(m)) return false
  return true
}

async function openaiChat(
  key: string,
  model: string,
  system: string,
  turns: ChatTurn[],
  json: boolean
): Promise<string> {
  const messages: { role: string; content: string }[] = []
  const sys = json ? jsonSystem(system) : system
  if (sys) messages.push({ role: 'system', content: sys })
  for (const t of turns) messages.push({ role: t.role, content: t.content })

  const body = (withTemperature: boolean): string =>
    JSON.stringify({
      model,
      messages,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      ...(withTemperature ? { temperature: 0.2 } : {})
    })

  const url = 'https://api.openai.com/v1/chat/completions'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`
  }

  let useTemperature = openaiSupportsTemperature(model)
  let res = await fetch(url, { method: 'POST', headers, body: body(useTemperature) })

  // temperature 를 못 받는 걸 미처 몰랐던 모델은 한 번만 재시도한다.
  if (!res.ok && useTemperature && res.status === 400) {
    const txt = await res.text().catch(() => '')
    if (/temperature/i.test(txt) && /unsupported|does not support|not.*supported/i.test(txt)) {
      openaiNoTemperature.add(model)
      useTemperature = false
      res = await fetch(url, { method: 'POST', headers, body: body(false) })
    } else {
      // 재시도 없음. 아래 공통 처리로 넘긴다.
      throw new Error(await describeHttpError(new Response(txt, { status: res.status }), 'OpenAI'))
    }
  }

  if (!res.ok) throw new Error(await describeHttpError(res, 'OpenAI'))
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new Error('OpenAI가 빈 응답을 보냈습니다.')
  return text
}

async function geminiChat(
  key: string,
  model: string,
  system: string,
  turns: ChatTurn[],
  json: boolean
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      // Gemini 는 도우미 차례를 'model' 로 부른다.
      contents: turns.map((t) => ({
        role: t.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: t.content }]
      })),
      generationConfig: {
        ...(json ? { responseMimeType: 'application/json' } : {}),
        temperature: 0.2
      }
    })
  })

  if (!res.ok) throw new Error(await describeHttpError(res, 'Gemini'))
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
  if (!text) throw new Error('Gemini가 빈 응답을 보냈습니다.')
  return text
}

async function claudeChat(
  key: string,
  model: string,
  system: string,
  turns: ChatTurn[],
  json: boolean
): Promise<string> {
  const sys = json ? jsonSystem(system) : system
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      ...(sys ? { system: sys } : {}),
      messages: turns.map((t) => ({ role: t.role, content: t.content })),
      temperature: 0.2
    })
  })

  if (!res.ok) throw new Error(await describeHttpError(res, 'Claude'))
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  if (!text) throw new Error('Claude가 빈 응답을 보냈습니다.')
  return text
}

async function describeHttpError(res: Response, who: string): Promise<string> {
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 300)
  } catch {
    /* 본문을 못 읽어도 상태 코드만으로 안내한다. */
  }

  switch (res.status) {
    case 401:
    case 403:
      return `${who} API 키가 올바르지 않거나 권한이 없습니다. 설정에서 키를 다시 확인해 주세요.`
    case 404:
      return `${who}에 해당 모델이 없습니다. 설정에서 다른 모델을 골라 주세요. (${detail})`
    case 429:
      return `${who} 사용량 한도에 걸렸습니다. 잠시 뒤 다시 시도하거나 결제 설정을 확인해 주세요.`
    default:
      return `${who} 오류 (${res.status}) ${detail}`
  }
}

/** 서비스별 기본 모델. */
function defaultModelFor(settings: LocalSettings, p: Provider): string {
  if (p === 'openai') return settings.openai_model
  if (p === 'claude') return settings.claude_model
  return settings.gemini_model
}

/**
 * 기능별로 어떤 (서비스·모델) 을 쓸지 최종 결정한다.
 * 우선순위: 함수 호출 시 넘긴 override → 기능별 저장값 → 서비스 기본값.
 * override 에 provider 만 있고 model 이 비면 그 서비스의 기본 모델을 쓴다.
 */
function resolveChoice(
  settings: LocalSettings,
  feature: AiFeature,
  override?: ModelChoice | null
): ModelChoice {
  const from = override ?? settings.feature_models?.[feature]
  if (from && from.model) return { provider: from.provider, model: from.model }
  if (from?.provider) return { provider: from.provider, model: defaultModelFor(settings, from.provider) }
  return { provider: settings.provider, model: defaultModelFor(settings, settings.provider) }
}

function keyFor(settings: LocalSettings, p: Provider): string {
  if (p === 'openai') return settings.openai_key
  if (p === 'claude') return settings.claude_key
  return settings.gemini_key
}

const PROVIDER_LABEL: Record<Provider, string> = {
  openai: 'OpenAI',
  claude: 'Claude',
  gemini: 'Gemini'
}

/**
 * 고른 서비스로 여러 차례의 대화를 보낸다. 단발 요청은 turns 를 한 개만 넣으면 된다.
 * feature 는 기본 모델 결정에, override 는 그 화면에서 사용자가 고른 값에 쓴다.
 */
async function chatModel(
  settings: LocalSettings,
  feature: AiFeature,
  override: ModelChoice | undefined | null,
  system: string,
  turns: ChatTurn[],
  json: boolean
): Promise<string> {
  const choice = resolveChoice(settings, feature, override)
  const key = keyFor(settings, choice.provider)
  if (!key) throw new Error(`${PROVIDER_LABEL[choice.provider]} API 키가 설정되지 않았습니다.`)
  if (choice.provider === 'openai') return openaiChat(key, choice.model, system, turns, json)
  if (choice.provider === 'claude') return claudeChat(key, choice.model, system, turns, json)
  return geminiChat(key, choice.model, system, turns, json)
}

async function callModel(
  settings: LocalSettings,
  feature: AiFeature,
  override: ModelChoice | undefined | null,
  prompt: string,
  json = true
): Promise<string> {
  return chatModel(settings, feature, override, '', [{ role: 'user', content: prompt }], json)
}

export async function analyzeDocument(
  settings: LocalSettings,
  jobTitle: string,
  filename: string,
  text: string,
  kind: DocKind,
  roster: string,
  onProgress?: (msg: string) => void,
  override?: ModelChoice
): Promise<AnalyzeResult> {
  const parts = chunk(text)
  const drafts: TaskDraft[] = []

  try {
    for (let i = 0; i < parts.length; i++) {
      const label = parts.length > 1 ? ` (${i + 1}/${parts.length}번째 부분)` : ''
      onProgress?.(`${filename}${label} 분석 중`)
      const raw = await callModel(
        settings,
        'analyze',
        override,
        buildPrompt(jobTitle, roster, filename, parts[i], kind, label)
      )
      drafts.push(...parseTasks(raw, filename, kind))
    }
  } catch (e) {
    return {
      ok: false,
      drafts: kind === '개별 공문' ? mergeToOne(drafts) : drafts,
      error: e instanceof Error ? e.message : String(e)
    }
  }

  // 공문은 몇 조각으로 나눠 보냈든 업무 한 건으로 돌려준다.
  if (kind === '개별 공문') return { ok: true, drafts: mergeToOne(drafts) }

  // 같은 업무가 여러 조각에서 중복으로 나오는 경우를 정리한다.
  const seen = new Set<string>()
  const unique = drafts.filter((d) => {
    const key = `${d.title}|${d.task_date_display}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return { ok: true, drafts: unique }
}

/** 검색 결과 요약에 넘길 근거 한 건 */
export interface SourceItem {
  label: string
  text: string
}

/** 근거로 넘기는 글의 총량 상한. 넘으면 앞쪽부터 잘라 담는다. */
const ANSWER_BUDGET = 24000

/**
 * 검색으로 찾은 문서·업무를 근거로, 질문에 대한 요약 답변을 만든다.
 * 근거에 없는 내용을 지어내지 않도록 못을 박고, 출처 번호를 달게 한다.
 */
export async function answerFromSources(
  settings: LocalSettings,
  jobTitle: string,
  query: string,
  sources: SourceItem[],
  override?: ModelChoice
): Promise<{ ok: boolean; answer: string; error?: string }> {
  if (!sources.length) {
    return { ok: false, answer: '', error: '요약할 근거 문서가 없습니다.' }
  }

  let used = 0
  const blocks: string[] = []
  for (let i = 0; i < sources.length; i++) {
    if (used >= ANSWER_BUDGET) break
    const room = ANSWER_BUDGET - used
    const body = sources[i].text.slice(0, Math.min(room, 6000))
    blocks.push(`[${i + 1}] ${sources[i].label}\n${body}`)
    used += body.length
  }

  const prompt = `당신은 대한민국 학교 행정 업무를 잘 아는 '${jobTitle}' 담당자입니다.
아래는 이 담당자가 보관해 둔 공문과 업무 기록 중 "${query}" 로 검색해 나온 것들입니다.

이 자료만 근거로 삼아, 담당자가 한눈에 파악할 수 있게 정리해 주세요.

작성 규칙:
- 자료에 없는 내용은 절대 지어내지 마세요. 모르면 "자료에서 확인되지 않습니다" 라고 적으세요.
- 시간 순서가 드러나면 오래된 것부터 차례로 정리하세요.
- 문장 끝에 근거 번호를 [1] [3] 처럼 답니다.
- 아래 형식을 지키되, 해당 내용이 없는 항목은 통째로 생략하세요.

## 한 줄 요약
(2~3문장)

## 경과
- (날짜나 순서가 드러나게, 항목마다 한 줄)

## 담당자가 할 일
- (자료에서 확인되는 처리 절차나 제출물만)

## 주의할 점
- (기한, 놓치기 쉬운 조건 등)

검색어: ${query}

--- 자료 ---
${blocks.join('\n\n')}`

  try {
    const raw = await callModel(settings, 'summary', override, prompt, false)
    return { ok: true, answer: raw.trim() }
  } catch (e) {
    return { ok: false, answer: '', error: e instanceof Error ? e.message : String(e) }
  }
}

/* ---------- 학교 문서 만들기 ---------- */

/** 본보기로 보내는 예시 한 건의 길이 상한 */
const TEMPLATE_BUDGET = 6000
/** 예시를 다 합쳐 이 길이를 넘기지 않는다. 넘기면 요청이 비싸고 느려진다. */
const EXAMPLE_TOTAL = 18000

function valueBlock(form: DocForm, values: Record<string, string>): string {
  return form.fields
    .map((f) => [f.label, (values[f.key] ?? '').trim()] as const)
    .filter(([, v]) => v)
    .map(([k, v]) => `[${k}]\n${v}`)
    .join('\n\n')
}

/**
 * 문서를 만들라는 지시문을 짠다.
 *
 * 예시가 없으면 서식에 적어 둔 뼈대(outline)와 문체 안내(guide)대로 쓴다.
 *
 * 예시가 있으면 **뼈대와 문체 안내를 아예 보내지 않는다.** 둘 다 보내면
 * 서로 부딪쳐, 실제로 쓰던 예시를 두고도 미리 넣어 둔 뼈대대로 써 버린다.
 * 학교마다 서식이 다르므로, 담당자가 쓰던 문서가 있으면 그것이 언제나 옳다.
 */
function docDraftPrompt(
  schoolName: string,
  jobTitle: string,
  form: DocForm,
  values: Record<string, string>,
  examples: Template[]
): string {
  let budget = EXAMPLE_TOTAL
  const shown: string[] = []
  for (const [i, t] of examples.entries()) {
    if (budget <= 0) break
    const body = t.content.slice(0, Math.min(TEMPLATE_BUDGET, budget))
    budget -= body.length
    shown.push(`--- 예시 ${i + 1}: ${t.name} ---\n${body}`)
  }

  const outline = form.outline.map((s, i) => `${i + 1}. ${s}`).join('\n')

  const shape = shown.length
    ? `아래에 이 학교에서 실제로 쓰던 **${form.name}** 예시가 있습니다.
**이 예시가 곧 서식입니다. 새로 짜지 말고 예시를 옮겨 적으세요.**

- 예시의 제목, 항목 이름과 차례, 번호 매김, 들여쓰기, 말하는 사람 표시, 말투를 **글자 그대로** 따르세요.
- 예시에 이미 문장이 채워져 있는 곳(인사말, 절차 설명, 주의 사항, 성원 보고, 맺음말)은 **그대로 옮겨 적으세요.** 빈칸으로 바꾸지 마세요.
- **[입력 내용] 에 해당하는 자리만 이번 것으로 갈아 끼우세요.** 차수, 날짜, 대상, 사안 내용처럼 회마다 달라지는 곳입니다.
- 예시에 없는 항목을 새로 만들지 말고, 예시에 있는 항목을 빼지도 마세요.
- 예시가 여러 건이면 가장 온전한 것 하나를 골라 그것만 따르세요.`
    : `**${form.name}** 을 쓰세요. 다음 차례를 뼈대로 삼습니다.
${outline}

${form.guide}

넣을 자료가 없는 항목도 **제목은 남기고** 빈칸으로 두세요. 담당자가 채울 수 있어야 합니다.`

  const blankRule = shown.length
    ? '- 예시에도 없고 [입력 내용] 에도 없는 것만 (   ) 로 비워 두세요. 예시에 문장이 있는 자리는 절대 비우지 마세요.'
    : '- 비어 있는 부분은 (   ) 또는 ○○○ 처럼 담당자가 채울 빈칸으로 남기세요. 추측해서 메우지 마세요.'

  return `당신은 대한민국 학교에서 행정 문서를 오래 다뤄 온 교사입니다.
${schoolName ? `학교명은 '${schoolName}' 입니다.` : ''}${jobTitle ? `
지금 이 문서를 쓰는 사람이 맡은 업무는 '${jobTitle}' 입니다.` : ''}

${shape}

반드시 지킬 것:
- 아래 [입력 내용] 에 있는 사실만 쓰세요. 없는 사실·진술·날짜·숫자를 지어내지 마세요.
${blankRule}
- 사람 이름이 '학생A', '위원B' 처럼 적혀 있으면 그대로 쓰세요. 실제 이름을 만들어 넣지 마세요.
- 한글(HWP)에 그대로 붙여 넣어 쓸 수 있게, 설명이나 머리말 없이 **문서 본문만** 출력하세요.
- 마크다운 표시(**, ##, \`\`\`)를 쓰지 마세요. 학교 문서에서 쓰는 번호와 기호로만 단을 나누세요.

${shown.length ? `${shown.join('\n\n')}\n` : ''}
--- 입력 내용 ---
${valueBlock(form, values) || '(적어 넣은 것이 없습니다. 빈 서식으로 만드세요.)'}`
}

/**
 * 학교 문서 초안을 만든다.
 * 보내기 전에 실명을 가명으로 바꾸고, 받은 뒤 다시 실명으로 되돌린다.
 * 가리기에 실패한 이름이 하나라도 있으면 아예 보내지 않는다.
 */
export async function generateDocDraft(
  settings: LocalSettings,
  schoolName: string,
  jobTitle: string,
  form: DocForm,
  values: Record<string, string>,
  examples: Template[],
  aliases: AliasPair[],
  override?: ModelChoice
): Promise<DocDraftResult> {
  const maskedValues: Record<string, string> = {}
  for (const [k, v] of Object.entries(values)) maskedValues[k] = maskText(v, aliases)

  // 예시는 형식을 보여 주려는 것이지만, 실명이 남아 있을 수 있어 함께 가린다.
  const maskedExamples: Template[] = examples.map((t) => ({
    ...t,
    content: maskText(t.content, aliases)
  }))

  const prompt = docDraftPrompt(schoolName, jobTitle, form, maskedValues, maskedExamples)

  // 마지막 방어선: 가렸는데도 실명이 남아 있으면 전송을 멈춘다.
  const leaked = leakCheck(prompt, aliases)
  if (leaked.length) {
    return {
      ok: false,
      text: '',
      sentToAi: '',
      error: `가명처리가 끝나지 않아 보내지 않았습니다. 남아 있는 이름: ${leaked.join(', ')}`
    }
  }

  try {
    const raw = await callModel(settings, 'scenario', override, prompt, false)
    return { ok: true, text: unmaskText(raw.trim(), aliases), sentToAi: prompt }
  } catch (e) {
    return {
      ok: false,
      text: '',
      sentToAi: prompt,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

/**
 * 예시 문서 하나를 읽고 "이 문서는 어떤 항목으로 이루어져 있는지" 를 뽑아낸다.
 *
 * 학교 업무는 부서마다 달라서 서식을 미리 다 넣어 둘 수 없다. 쓰는 사람이
 * 자기 문서를 하나 붙여넣으면 그것을 뜯어 자기만의 서식을 만들어 주는 것이다.
 */
export async function extractDocForm(
  settings: LocalSettings,
  docName: string,
  sample: string,
  override?: ModelChoice
): Promise<FormSketch> {
  const prompt = `당신은 대한민국 학교의 행정 문서를 잘 아는 교사입니다.
아래는 어느 학교에서 실제로 쓰는 '${docName || '문서'}' 입니다.
이 문서를 앞으로도 같은 얼개로 만들 수 있도록, 문서를 뜯어 **서식**으로 정리하세요.

- "항목" 은 이 문서에 실제로 있는 큰 단락의 이름입니다. 문서에 있는 차례 그대로, 있는 것만 적으세요.
- "칸" 은 다음에 이 문서를 만들 때 담당자에게 **물어봐야 할 것** 입니다.
  문서마다 달라지는 내용(일시, 대상, 금액, 경위 같은 것)을 칸으로 만드세요.
  틀에 박혀 늘 같은 문장(인사말, 근거 조항 안내)은 칸으로 만들지 마세요.
- "여러줄" 은 그 칸에 긴 글을 적어야 하면 true, 한 줄이면 false 입니다.
- "필수" 는 그것이 없으면 문서를 쓸 수 없는 칸에만 true 로 하세요. 한두 개면 충분합니다.
- "문체" 는 이 문서를 쓸 때 지켜야 할 말투와 주의사항을 두세 줄로 적으세요.
- 칸은 4개에서 8개 사이로 하세요. 사람 이름이나 사건 내용은 옮겨 적지 마세요.

JSON 형식:
{"항목":["",""],"칸":[{"이름":"","여러줄":false,"필수":false}],"문체":""}

--- 문서 ---
${sample.slice(0, 12000)}`

  try {
    const raw = await callModel(settings, 'analyze', override, prompt, true)
    const cleaned = raw
      .replace(/^\s*```(?:json)?/i, '')
      .replace(/```\s*$/, '')
      .trim()
    const parsed = JSON.parse(cleaned) as {
      항목?: unknown
      칸?: unknown
      문체?: unknown
    }

    const outline = Array.isArray(parsed.항목)
      ? parsed.항목.map((v) => str(v)).filter(Boolean)
      : []
    const fields = Array.isArray(parsed.칸)
      ? parsed.칸
          .map((v) => {
            const f = v as { 이름?: unknown; 여러줄?: unknown; 필수?: unknown }
            const label = str(f.이름)
            return {
              key: label,
              label,
              ...(f.여러줄 ? { lines: 110 } : {}),
              ...(f.필수 ? { required: true } : {})
            }
          })
          .filter((f) => f.label)
      : []

    if (!outline.length && !fields.length) {
      return { ok: false, outline: [], fields: [], guide: '', error: '서식을 알아보지 못했습니다.' }
    }
    return { ok: true, outline, fields, guide: str(parsed.문체) }
  } catch (e) {
    return {
      ok: false,
      outline: [],
      fields: [],
      guide: '',
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

/* ---------- 업무 도우미 (보관 문서 기반 챗봇) ---------- */

/** 대화에 함께 실어 보내는 근거 글의 총량 상한 */
const CHAT_BUDGET = 20000
/** 도우미가 기억하는 최근 대화 수. 너무 길면 느리고 비싸다. */
const CHAT_HISTORY = 12

/**
 * 보관해 둔 공문·업무·일지를 근거로, 담당자의 질문에 대화식으로 답한다.
 * 근거(sources)는 메인 쪽에서 질문과 관련 있는 것만 골라 넘겨준다.
 */
export async function chatAnswer(
  settings: LocalSettings,
  jobTitle: string,
  history: ChatTurn[],
  sources: SourceItem[],
  override?: ModelChoice
): Promise<ChatReply> {
  const turns = history.slice(-CHAT_HISTORY).filter((t) => t.content.trim())
  // Claude·Gemini 는 첫 메시지가 반드시 user 여야 한다. 잘려서 assistant 로 시작하면 앞을 버린다.
  while (turns.length && turns[0].role !== 'user') turns.shift()
  if (!turns.length || turns[turns.length - 1].role !== 'user') {
    return { ok: false, answer: '', sources: [], error: '보낼 질문이 없습니다.' }
  }

  // 근거를 예산 안에서 담고, 실제로 담긴 것만 출처로 남긴다.
  let used = 0
  const blocks: string[] = []
  const usedLabels: string[] = []
  for (let i = 0; i < sources.length; i++) {
    if (used >= CHAT_BUDGET) break
    const room = Math.min(CHAT_BUDGET - used, 5000)
    const body = sources[i].text.slice(0, room)
    blocks.push(`[${usedLabels.length + 1}] ${sources[i].label}\n${body}`)
    usedLabels.push(sources[i].label)
    used += body.length
  }

  const refs = blocks.length
    ? `--- 참고 자료 ---\n${blocks.join('\n\n')}`
    : '(이번 질문과 맞아떨어지는 보관 자료를 찾지 못했습니다. 일반적인 안내로 돕되, 보관 자료에는 없다는 점을 밝히세요.)'

  const system = `당신은 대한민국 학교의 '${jobTitle}' 업무를 돕는 성실한 도우미입니다.
아래 [참고 자료]는 이 담당자가 프로그램에 보관해 둔 공문·업무·일지 중 지금 질문과 관련 있어 보이는 것들입니다.

답변 규칙:
- 참고 자료에 근거가 있으면 그 내용을 우선으로 삼고, 문장 끝에 [1] [2] 처럼 근거 번호를 답니다.
- 참고 자료에 없는 내용이면 일반적인 학교 행정 상식으로 도울 수 있습니다. 단, 그때는 "보관된 자료에는 없고 일반적인 안내입니다"라고 밝히세요.
- 확실하지 않으면 모른다고 말하고, 어디를 확인하면 되는지 알려 주세요.
- 학생 실명·주민번호·연락처 같은 개인정보를 새로 지어내지 마세요.
- 한국어로, 담당자가 바로 활용할 수 있도록 간결하고 실무적으로 답하세요.

${refs}`

  try {
    const raw = await chatModel(settings, 'chat', override, system, turns, false)
    return { ok: true, answer: raw.trim(), sources: usedLabels }
  } catch (e) {
    return { ok: false, answer: '', sources: [], error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 연결 테스트는 설정에서 지금 고른 (서비스·모델) 로 보낸다.
 * 기능별 override 는 각 화면의 관심사이므로 여기선 굳이 안 쓴다.
 */
export async function testConnection(
  settings: LocalSettings
): Promise<{ ok: boolean; message: string }> {
  const choice: ModelChoice = {
    provider: settings.provider,
    model: defaultModelFor(settings, settings.provider)
  }
  try {
    const reply = await callModel(
      settings,
      'chat',
      choice,
      '연결 확인용 요청입니다. {"tasks":[]} 라고만 답하세요.'
    )
    return {
      ok: true,
      message: `연결에 성공했습니다. (${choice.model}) 응답: ${reply.trim().slice(0, 60)}`
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
