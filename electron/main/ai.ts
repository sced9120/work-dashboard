import type {
  AliasPair,
  AnalyzeResult,
  CaseDetail,
  DocKind,
  LocalSettings,
  ScenarioResult,
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

/* ---------- 위원회 대본 · 회의록 ---------- */

/** 본보기로 보내는 대본 한 건의 길이 상한 */
const TEMPLATE_BUDGET = 6000

function caseBlock(c: CaseDetail): string {
  const lines: [string, string][] = [
    ['회의 정보', c.meetingInfo],
    ['사안명', c.caseTitle],
    ['사안 개요', c.summary],
    ['진술 요지', c.statements],
    ['위원 구성', c.members],
    ['심의 방향·예상 처분', c.expected],
    ['진행 메모', c.notes]
  ]
  return lines
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `[${k}]\n${v.trim()}`)
    .join('\n\n')
}

function scenarioPrompt(
  schoolName: string,
  c: CaseDetail,
  templates: Template[]
): string {
  const examples = templates
    .map((t, i) => `--- 본보기 ${i + 1}: ${t.name} ---\n${t.content.slice(0, TEMPLATE_BUDGET)}`)
    .join('\n\n')

  const shape =
    c.kind === '대본'
      ? `학생선도위원회를 실제로 진행할 때 사회자가 그대로 읽을 수 있는 **진행 대본**을 쓰세요.
개회 선언 → 위원 소개 → 사안 보고 → 대상 학생 진술 → 위원 질의응답 → 학생 퇴장 →
위원 심의 → 처분 의결 → 결과 고지 → 폐회 순서를 기본으로 하되, 본보기가 있으면 그 순서를 따르세요.
사회자가 읽을 말은 "위원장: " 처럼 말하는 사람을 앞에 붙여 적고,
진행상 필요한 안내는 (괄호) 로 표시하세요.`
      : `학생선도위원회 **회의록**을 쓰세요.
회의 개요(일시·장소·참석자), 안건, 논의 내용, 의결 사항, 향후 조치 순으로 정리합니다.
말한 사람을 밝혀 요약하되, 대화를 그대로 옮기지 말고 회의록 문체로 간결하게 적으세요.
본보기가 있으면 그 형식과 문체를 그대로 따르세요.`

  return `당신은 대한민국 고등학교의 학생선도 업무를 오래 맡아 온 교사입니다.
${schoolName ? `학교명은 '${schoolName}' 입니다.` : ''}

${shape}

반드시 지킬 것:
- 아래 [사안 정보] 에 있는 사실만 쓰세요. 없는 사실, 없는 진술, 없는 날짜를 지어내지 마세요.
- 정보가 비어 있는 부분은 (   ) 또는 "○○○" 처럼 담당자가 채울 빈칸으로 남기세요. 추측해서 메우지 마세요.
- 사람 이름이 '학생A', '위원B' 처럼 적혀 있으면 그대로 쓰세요. 실제 이름을 만들어 넣지 마세요.
- 처분의 수위를 단정하지 마세요. 처분은 위원회가 정하는 것이므로, 의결 부분은 빈칸이나 선택지로 두세요.
- 설명이나 머리말 없이 결과물만 출력하세요.

${examples ? `아래는 이 학교에서 쓰던 형식입니다. 말투와 구성을 최대한 따르세요.\n\n${examples}\n` : ''}
--- 사안 정보 ---
${caseBlock(c)}`
}

/**
 * 대본·회의록을 만든다.
 * 보내기 전에 실명을 가명으로 바꾸고, 받은 뒤 다시 실명으로 되돌린다.
 * 가리기에 실패한 이름이 하나라도 있으면 아예 보내지 않는다.
 */
export async function generateScenario(
  settings: LocalSettings,
  schoolName: string,
  c: CaseDetail,
  templates: Template[],
  aliases: AliasPair[]
): Promise<ScenarioResult> {
  // 사안 정보만 가린다. 본보기는 형식용이라 그대로 두되 함께 가려 준다.
  const maskedCase: CaseDetail = {
    ...c,
    meetingInfo: maskText(c.meetingInfo, aliases),
    caseTitle: maskText(c.caseTitle, aliases),
    summary: maskText(c.summary, aliases),
    statements: maskText(c.statements, aliases),
    members: maskText(c.members, aliases),
    expected: maskText(c.expected, aliases),
    notes: maskText(c.notes, aliases)
  }
  const maskedTemplates: Template[] = templates.map((t) => ({
    ...t,
    content: maskText(t.content, aliases)
  }))

  const prompt = scenarioPrompt(schoolName, maskedCase, maskedTemplates)

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
    const raw = await callModel(settings, prompt, false)
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
