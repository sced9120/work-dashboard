import type { AnalyzeResult, DocKind, LocalSettings, TaskDraft } from '../../shared/types'

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

function buildPrompt(
  jobTitle: string,
  filename: string,
  body: string,
  kind: DocKind,
  part: string
): string {
  const year = new Date().getFullYear()

  const role =
    kind === '길라잡이/매뉴얼'
      ? `이 문서는 '${jobTitle}' 담당자의 업무 길라잡이(매뉴얼)입니다. 문서에 나오는 개별 업무를 빠짐없이 모두 뽑아 주세요. 시기는 문서 내용을 근거로 "3월 1주", "학기 초", "수시" 같은 형태로 적습니다.`
      : `이 문서는 '${jobTitle}' 담당자에게 온 공문입니다. 접수일자나 제출 기한을 찾아 수행 시기를 정하세요. 시기는 "MM월 N주" 형식으로 적습니다. 기준 연도는 ${year}년입니다. 기한을 알 수 없으면 "수시"로 적습니다.`

  return `당신은 대한민국 학교 행정 업무를 잘 아는 실무자입니다. ${role}

규칙:
- 반드시 아래 JSON 형식만 출력합니다. 설명 문장이나 코드블록 표시를 붙이지 마세요.
- 문서에 없는 내용을 지어내지 마세요. 근거가 없으면 빈 문자열로 둡니다.
- "본문"에는 원문 내용을 최대한 살려 적습니다. 과하게 요약하지 마세요.
- 업무가 하나도 없으면 tasks를 빈 배열로 둡니다.

JSON 형식:
{"tasks":[{"제목":"","시기_표시":"","시기_원본":"","본문":"","절차":"","포인트":""}]}

파일명: ${filename}${part}

문서 내용:
${body}`
}

interface RawTask {
  제목?: unknown
  시기_표시?: unknown
  시기_원본?: unknown
  본문?: unknown
  절차?: unknown
  포인트?: unknown
}

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (v === null || v === undefined) return ''
  return String(v)
}

function parseTasks(raw: string, filename: string): TaskDraft[] {
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

  const list = (parsed as { tasks?: unknown }).tasks
  if (!Array.isArray(list)) throw new Error('AI 응답에 업무 목록이 없습니다.')

  return list
    .map((item): TaskDraft => {
      const t = item as RawTask
      return {
        title: str(t.제목) || '(제목 없음)',
        task_date_display: str(t.시기_표시) || '수시',
        task_date_raw: str(t.시기_원본),
        workflow: str(t.절차),
        draft_full: str(t.본문),
        key_points: str(t.포인트),
        filename,
        selected: true
      }
    })
    .filter((t) => t.title !== '(제목 없음)' || t.draft_full.length > 0)
}

async function callOpenAI(
  key: string,
  model: string,
  prompt: string,
  json = true
): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      temperature: 0.2
    })
  })

  if (!res.ok) throw new Error(await describeHttpError(res, 'OpenAI'))
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new Error('OpenAI가 빈 응답을 보냈습니다.')
  return text
}

async function callGemini(
  key: string,
  model: string,
  prompt: string,
  json = true
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
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

async function callModel(settings: LocalSettings, prompt: string, json = true): Promise<string> {
  if (settings.provider === 'openai') {
    if (!settings.openai_key) throw new Error('OpenAI API 키가 설정되지 않았습니다.')
    return callOpenAI(settings.openai_key, settings.openai_model, prompt, json)
  }
  if (!settings.gemini_key) throw new Error('Gemini API 키가 설정되지 않았습니다.')
  return callGemini(settings.gemini_key, settings.gemini_model, prompt, json)
}

export async function analyzeDocument(
  settings: LocalSettings,
  jobTitle: string,
  filename: string,
  text: string,
  kind: DocKind,
  onProgress?: (msg: string) => void
): Promise<AnalyzeResult> {
  const parts = chunk(text)
  const drafts: TaskDraft[] = []

  try {
    for (let i = 0; i < parts.length; i++) {
      const label = parts.length > 1 ? ` (${i + 1}/${parts.length}번째 부분)` : ''
      onProgress?.(`${filename}${label} 분석 중`)
      const raw = await callModel(settings, buildPrompt(jobTitle, filename, parts[i], kind, label))
      drafts.push(...parseTasks(raw, filename))
    }
  } catch (e) {
    return {
      ok: false,
      drafts,
      error: e instanceof Error ? e.message : String(e)
    }
  }

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
  sources: SourceItem[]
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
    const raw = await callModel(settings, prompt, false)
    return { ok: true, answer: raw.trim() }
  } catch (e) {
    return { ok: false, answer: '', error: e instanceof Error ? e.message : String(e) }
  }
}

export async function testConnection(
  settings: LocalSettings
): Promise<{ ok: boolean; message: string }> {
  try {
    const reply = await callModel(
      settings,
      '연결 확인용 요청입니다. {"tasks":[]} 라고만 답하세요.'
    )
    return {
      ok: true,
      message: `연결에 성공했습니다. (${settings.provider === 'openai' ? settings.openai_model : settings.gemini_model}) 응답: ${reply.trim().slice(0, 60)}`
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
