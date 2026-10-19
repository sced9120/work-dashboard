/**
 * 스캔 문서 → 엑셀 (OCR). 사용자가 넣어 둔 자기 Gemini 키로 PDF · 사진 원본을 Gemini 에 보내
 * 원문 그대로 마크다운 표를 받고, 그 표를 엑셀 파일로 저장한다.
 * OpenAI 키만 있으면 OpenAI 의 싼 등급(OCR_OPENAI_MODEL)으로 같은 지침 · 같은 흐름으로 읽는다
 * (사진은 detail high, PDF 는 파일 그대로 — 30MB 가 넘으면 OpenAI 파일 저장소에 올렸다가 지운다).
 * 다만 OpenAI 는 쪽이 많으면 몇 사람만 읽고 줄이는 버릇이 있어, 4쪽이 넘으면 PDF 를 4쪽씩 잘라(pdf-lib)
 * 묶음마다 따로 읽고(동시에 3개까지) 표를 하나로 합친다. 지침에는 OpenAI 용 규칙(OCR_OPENAI_RULES)을 덧붙인다.
 *
 * 만든이의 Open WebUI 설정(Gemini 3.8 Flash OCR · Korean High-Res)을 그대로 따른다.
 *  - PDF 에서 글자를 뽑아 보내지 않고 원본 파일을 보낸다(스캔본은 글자가 없고, 뽑은 글은 표 · 취소선을 잃는다).
 *    14MB 까지는 요청에 바로 싣고, 넘으면 Gemini 파일 저장소에 올려 쓰고 끝나면 지운다(이름은 'document' 로만).
 *  - 그림 해상도 high, 생각 low(생각 글은 받지 않음), 검색 · 도구 없음, 3.6 이후 모델에는 temperature 를 보내지 않는다.
 *  - 지침: OCR 규칙 + 'OCR 데이터 스캔 에이전트' 프롬프트(shared/ocrPrompt.ts). 만든이가 catalog.json 의 "ocr" 로 바꿀 수 있다.
 *  - 받는 대로 보여 주고(stream), 답이 길어 끊기면 마지막 행 다음부터 이어 받는다.
 * 받은 결과는 저장하지 않는다(엑셀로 저장하지 않으면 사라진다).
 */

import { dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ExcelJS from 'exceljs'
import { PDFDocument } from 'pdf-lib'
import type { MdTable } from '../../shared/mdtable'
import { answersToTables, dropPartialTail, extractTables, mergeChunkTables, plainCell, proseOf, tableToMd } from '../../shared/mdtable'
import type { OcrAnswer, OcrFile, OcrProgress, OcrProvider, OcrRequest } from '../../shared/ocr'
import {
  OCR_DEFAULT_MODEL,
  OCR_MAX_IMAGE,
  OCR_MAX_PDF,
  OCR_CONTINUED,
  OCR_MAX_TABS,
  OCR_OPENAI_IMAGES,
  OCR_OPENAI_MODEL,
  OCR_TYPES,
  fmtBytes,
  isGeminiModel,
  isModernGemini,
  isOpenaiModel,
  ocrChunkText,
  ocrContinueText,
  ocrProviderOf,
  ocrUserText,
  saysStoppedEarly
} from '../../shared/ocr'
import { OCR_AGENT_PROMPT, OCR_OPENAI_RULES, OCR_RULES } from '../../shared/ocrPrompt'
import { peekCatalog } from './catalog'
import { httpFetch } from './http'
import { readSse } from './sse'
import { loadLocalSettings } from './secrets'

const API = 'https://generativelanguage.googleapis.com'
const OA = 'https://api.openai.com/v1'
/** 요청 하나에 바로 싣는 파일 크기 합 (base64 로 늘어나도 요청 20MB 안쪽) */
const INLINE_LIMIT = 14 * 1024 * 1024
/** OpenAI: 요청 하나에 바로 싣는 합 · 한 번에 읽는 파일 합 (OpenAI 가 받는 것은 요청당 50MB) */
const OA_INLINE_LIMIT = 30 * 1024 * 1024
const OA_TOTAL_LIMIT = 50 * 1024 * 1024
/** 한 번 읽는 데 기다리는 최대 시간 */
const READ_TIMEOUT = 15 * 60 * 1000
/** OpenAI: 이 쪽 수가 넘으면 이만큼씩 나눠 읽는다 · 동시에 읽는 묶음 수 · 묶음이 끊기면 이어 받는 횟수 · 오류 때 다시 해 보는 횟수 */
const OA_CHUNK_PAGES = 4
const OA_PARALLEL = 3
const OA_CHUNK_CONTINUE = 3
const OA_CHUNK_RETRY = 2

type Part = { text: string } | { inlineData: { mimeType: string; data: string } } | { fileData: { mimeType: string; fileUri: string } }
interface Turn {
  role: 'user' | 'model'
  parts: Part[]
}

interface Picked {
  path: string
  name: string
  size: number
  mime: string
}

/** 이번 실행에서 사용자가 고른 파일 (화면은 번호로만 가리킨다) */
const picked = new Map<string, Picked>()

/** OpenAI Chat Completions 의 한 마디 */
type OaPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'high' } }
  | { type: 'file'; file: { filename: string; file_data: string } | { file_id: string } }
interface OaMsg {
  role: 'system' | 'user' | 'assistant'
  content: string | OaPart[]
}

interface Session {
  provider: OcrProvider
  key: string
  model: string
  system: string
  /** Gemini 대화 */
  turns: Turn[]
  /** OpenAI 대화 */
  messages: OaMsg[]
  /** 파일 저장소에 올린 것(Gemini: files/… · OpenAI: file-…) — 끝나면 지운다 */
  uploaded: string[]
  /** 마지막으로 받은 답 */
  last: string
  /** 쪽을 나눠 읽어 합친 답 — 이어 받을 것이 없다 */
  chunked?: boolean
}

/** 탭마다 따로 읽는다 (최대 OCR_MAX_TABS 개). 화면을 떠나도 계속 읽고, 탭을 닫거나 프로그램을 끌 때 지운다 */
const sessions = new Map<string, Session>()
const aborts = new Map<string, AbortController>()

const tabOk = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{1,64}$/.test(id)

/* ---------- 파일 고르기 ---------- */

export async function pickFiles(win: BrowserWindow | null): Promise<OcrFile[]> {
  if (!win) return []
  const res = await dialog.showOpenDialog(win, {
    title: '읽을 스캔 문서 고르기',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF · 사진', extensions: Object.keys(OCR_TYPES) }]
  })
  if (res.canceled) return []
  return addPaths(res.filePaths).files
}

/** 고르거나 끌어 놓은 파일을 받아 둔다 (PDF · 사진만). 화면에는 번호로만 알려 준다 */
export function addPaths(paths: unknown): { files: OcrFile[]; skipped: string[] } {
  const out: OcrFile[] = []
  const skipped: string[] = []
  for (const raw of (Array.isArray(paths) ? paths : []).slice(0, 100)) {
    if (typeof raw !== 'string' || !raw) continue
    const p = path.resolve(raw)
    const name = path.basename(p)
    const mime = OCR_TYPES[path.extname(p).slice(1).toLowerCase()]
    let size = 0
    try {
      const st = fs.statSync(p)
      size = st.isFile() ? st.size : -1
    } catch {
      size = -1
    }
    if (!mime || size < 0) {
      skipped.push(name)
      continue
    }
    const id = crypto.randomUUID()
    picked.set(id, { path: p, name, size, mime })
    out.push({ id, name, size, mime })
  }
  // 스캔 파일은 번호를 붙여 나오는 일이 많아 이름 차례로 (2 가 10 보다 먼저)
  return { files: out.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true })), skipped }
}

/* ---------- Gemini 파일 저장소 (큰 파일) ---------- */

async function uploadFile(key: string, f: Picked, signal: AbortSignal): Promise<{ uri: string; name: string }> {
  const data = fs.readFileSync(f.path)
  const start = await httpFetch(`${API}/upload/v1beta/files`, {
    method: 'POST',
    signal,
    headers: {
      'x-goog-api-key': key,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(data.length),
      'X-Goog-Upload-Header-Content-Type': f.mime,
      'Content-Type': 'application/json'
    },
    // 파일 이름에 학생 이름이 들어 있을 수 있어 보내지 않는다
    body: JSON.stringify({ file: { display_name: 'document' } })
  })
  if (!start.ok) throw new Error(await describe(start))
  const url = start.headers.get('x-goog-upload-url')
  if (!url) throw new Error('Gemini 파일 저장소가 올릴 주소를 주지 않았습니다.')
  const up = await httpFetch(url, {
    method: 'POST',
    signal,
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: data
  })
  if (!up.ok) throw new Error(await describe(up))
  let file = ((await up.json()) as { file?: { name?: string; uri?: string; state?: string } }).file
  if (!file?.name || !file.uri) throw new Error('Gemini 파일 저장소에 올리지 못했습니다.')
  // 다 받아 들일 때까지 (PDF 는 몇 초 걸린다)
  for (let i = 0; i < 60 && file?.state !== 'ACTIVE'; i++) {
    if (file?.state === 'FAILED') throw new Error('Gemini 가 파일을 처리하지 못했습니다. 다른 파일로 해 보세요.')
    await new Promise((r) => setTimeout(r, 2000))
    const g = await httpFetch(`${API}/v1beta/${file!.name}`, { headers: { 'x-goog-api-key': key }, signal })
    if (g.ok) file = (await g.json()) as typeof file
  }
  if (file?.state !== 'ACTIVE') throw new Error('Gemini 가 파일을 받아 들이는 데 너무 오래 걸립니다. 잠시 뒤 다시 해 보세요.')
  return { uri: file.uri!, name: file.name! }
}

async function deleteUploaded(s: Session): Promise<void> {
  await Promise.all(
    s.uploaded.map((n) =>
      (s.provider === 'openai'
        ? httpFetch(`${OA}/files/${encodeURIComponent(n)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${s.key}` } })
        : httpFetch(`${API}/v1beta/${n}`, { method: 'DELETE', headers: { 'x-goog-api-key': s.key } })
      ).catch(() => undefined)
    )
  )
}

/** OpenAI 파일 저장소에 올린다 (큰 PDF) — 이름은 document.pdf 로만, 끝나면 지운다 */
async function uploadOpenai(key: string, f: { mime: string; data: Buffer }, signal: AbortSignal): Promise<string> {
  const boundary = `----wd${crypto.randomBytes(12).toString('hex')}`
  const head = (name: string, extra = ''): string => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"${extra}\r\n`
  const body = Buffer.concat([
    Buffer.from(`${head('purpose')}\r\nuser_data\r\n`),
    Buffer.from(`${head('file', '; filename="document.pdf"')}Content-Type: ${f.mime}\r\n\r\n`),
    f.data,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ])
  const res = await httpFetch(`${OA}/files`, {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body
  })
  if (!res.ok) throw new Error(await describeOpenai(res))
  const id = ((await res.json()) as { id?: string }).id
  if (!id) throw new Error('OpenAI 파일 저장소에 올리지 못했습니다.')
  return id
}

/** 그 탭에서 읽던 것을 끝낸다 — Gemini · OpenAI 에 올려 둔 파일도 지운다. 탭을 주지 않으면 모두 (프로그램을 끌 때) */
export async function clearOcr(tab?: string): Promise<void> {
  const ids = tab === undefined ? [...new Set([...sessions.keys(), ...aborts.keys()])] : tabOk(tab) ? [tab] : []
  await Promise.all(
    ids.map(async (id) => {
      aborts.get(id)?.abort()
      const s = sessions.get(id)
      sessions.delete(id)
      if (s?.uploaded.length) await deleteUploaded(s)
    })
  )
}

export function cancelOcr(tab: string): void {
  if (tabOk(tab)) aborts.get(tab)?.abort()
}

/* ---------- 읽기 ---------- */

async function describe(res: Response): Promise<string> {
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 400)
  } catch {
    /* 상태 코드만으로 안내한다 */
  }
  switch (res.status) {
    case 400:
      return /API key not valid/i.test(detail)
        ? 'Gemini API 키가 올바르지 않습니다. [설정 → AI 연결] 에서 키를 다시 확인해 주세요.'
        : `Gemini 가 요청을 받지 않았습니다. (${detail})`
    case 401:
    case 403:
      return 'Gemini API 키가 올바르지 않거나 권한이 없습니다. [설정 → AI 연결] 에서 키를 다시 확인해 주세요.'
    case 404:
      return `Gemini 에 그 모델이 없습니다. 다른 모델을 골라 주세요. (${detail})`
    case 413:
      return '파일이 너무 큽니다. 나눠서 읽어 주세요.'
    case 429:
      return 'Gemini 사용량 한도에 걸렸습니다. 잠시 뒤 다시 하거나, Google AI Studio 에서 결제 · 한도를 확인해 주세요.'
    default:
      return `Gemini 오류 (${res.status}) ${detail}`
  }
}

async function describeOpenai(res: Response): Promise<string> {
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 400)
  } catch {
    /* 상태 코드만으로 안내한다 */
  }
  switch (res.status) {
    case 401:
    case 403:
      return 'OpenAI API 키가 올바르지 않거나 권한이 없습니다. [설정 → AI 연결] 에서 키를 다시 확인해 주세요.'
    case 404:
      return `OpenAI 에 그 모델이 없습니다(또는 이 키로 쓸 수 없습니다). 다른 모델을 골라 주세요. (${detail})`
    case 413:
      return '파일이 너무 큽니다. 나눠서 읽어 주세요.'
    case 429:
      return /insufficient_quota/.test(detail)
        ? 'OpenAI 크레딧이 없습니다. platform.openai.com 의 결제(Billing)를 확인해 주세요.'
        : 'OpenAI 사용량 한도에 걸렸습니다. 잠시 뒤 다시 해 주세요.'
    default:
      return `OpenAI 오류 (${res.status}) ${detail}`
  }
}

interface GenOptions {
  thinking: boolean
  media: boolean
}

/** 받는 동안 표 줄 수 · 글자 수를 0.3초마다 알린다 */
function reporter(onProgress: (p: OcrProgress) => void): (text: string, force?: boolean) => void {
  let lastSent = 0
  return (text, force = false) => {
    const now = Date.now()
    if (!force && now - lastSent < 300) return
    lastSent = now
    const rows = text.split('\n').filter((l) => l.trim().startsWith('|')).length
    onProgress({ phase: 'read', chars: text.length, rows: Math.max(0, rows - 2) })
  }
}

/** 표 뒤에 "몇 페이지까지 처리했다" 고 적고 멈춘 경우도 끊긴 것으로 본다 */
const stoppedEarly = (text: string): boolean => saysStoppedEarly(text.slice(text.lastIndexOf('|') + 1))

/** OpenAI 로 한 번 묻고 받는 대로 쌓는다 (Chat Completions · 받는 대로) */
async function generateOpenai(s: Session, onProgress: (p: OcrProgress) => void, signal: AbortSignal, reasoning = true): Promise<OcrAnswer> {
  const res = await httpFetch(`${OA}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.key}` },
    body: JSON.stringify({
      model: s.model,
      messages: [{ role: 'system', content: s.system }, ...s.messages],
      stream: true,
      stream_options: { include_usage: true },
      // 생각 medium — low 로는 이름 · 긴 글을 줄여 쓰는 일이 잦았다. 모르는 모델이면 빼고 한 번만 다시
      ...(reasoning ? { reasoning_effort: 'medium' } : {})
    })
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    if (res.status === 400 && reasoning && /reasoning/i.test(txt)) return generateOpenai(s, onProgress, signal, false)
    throw new Error(await describeOpenai(new Response(txt, { status: res.status })))
  }
  let text = ''
  let finish = ''
  let refusal = ''
  let usage: OcrAnswer['usage']
  const report = reporter(onProgress)
  await readSse(res, (data) => {
    if (data === '[DONE]') return
    let d: {
      choices?: { delta?: { content?: string; refusal?: string }; finish_reason?: string | null }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
      error?: { message?: string }
    }
    try {
      d = JSON.parse(data)
    } catch {
      return
    }
    if (d.error) throw new Error(`OpenAI 오류: ${d.error.message ?? ''}`)
    const c = d.choices?.[0]
    if (c?.delta?.content) text += c.delta.content
    if (c?.delta?.refusal) refusal += c.delta.refusal
    if (c?.finish_reason) finish = c.finish_reason
    if (d.usage) usage = { input: d.usage.prompt_tokens ?? 0, output: d.usage.completion_tokens ?? 0 }
    report(text)
  })
  report(text, true)
  if (!text.trim()) {
    if (refusal) throw new Error(`OpenAI 가 이 문서를 읽기를 거절했습니다: ${refusal.slice(0, 200)}`)
    if (finish === 'content_filter') throw new Error('OpenAI 가 안전 기준에 걸린다며 멈췄습니다(content_filter).')
    throw new Error('OpenAI 가 빈 답을 보냈습니다. 다시 해 보거나 다른 모델을 골라 주세요.')
  }
  return { ok: true, text, finish, truncated: finish === 'length' || stoppedEarly(text), usage }
}

/** 한 번 묻고 받는 대로 쌓는다 */
function generate(s: Session, onProgress: (p: OcrProgress) => void, signal: AbortSignal): Promise<OcrAnswer> {
  return s.provider === 'openai' ? generateOpenai(s, onProgress, signal) : generateGemini(s, onProgress, signal)
}

/** Gemini 로 한 번 묻고 받는 대로 쌓는다 */
async function generateGemini(s: Session, onProgress: (p: OcrProgress) => void, signal: AbortSignal, opts: GenOptions = { thinking: true, media: true }): Promise<OcrAnswer> {
  const body = {
    systemInstruction: { parts: [{ text: s.system }] },
    contents: s.turns,
    generationConfig: {
      ...(opts.media ? { mediaResolution: 'MEDIA_RESOLUTION_HIGH' } : {}),
      ...(opts.thinking ? { thinkingConfig: { thinkingLevel: 'LOW', includeThoughts: false } } : {}),
      // 3.6 이전 모델만 — 이후 모델은 temperature 를 받지 않는다
      ...(isModernGemini(s.model) ? {} : { temperature: 0 })
    }
  }
  const res = await httpFetch(`${API}/v1beta/models/${encodeURIComponent(s.model)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.key },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    // 그 모델이 생각 단계 · 그림 해상도 설정을 모르면 빼고 한 번만 다시
    if (res.status === 400 && opts.thinking && /thinking/i.test(txt)) return generateGemini(s, onProgress, signal, { ...opts, thinking: false })
    if (res.status === 400 && opts.media && /media_?resolution/i.test(txt)) return generateGemini(s, onProgress, signal, { ...opts, media: false })
    throw new Error(await describe(new Response(txt, { status: res.status })))
  }
  if (!res.body) throw new Error('Gemini 가 빈 응답을 보냈습니다.')

  let text = ''
  let finish = ''
  let blocked = ''
  let usage: OcrAnswer['usage']
  const progress = reporter(onProgress)
  const report = (force = false): void => progress(text, force)
  const take = (json: string): void => {
    let d: {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
      promptFeedback?: { blockReason?: string }
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
    }
    try {
      d = JSON.parse(json)
    } catch {
      return
    }
    const c = d.candidates?.[0]
    for (const p of c?.content?.parts ?? []) if (!p.thought && p.text) text += p.text
    if (c?.finishReason) finish = c.finishReason
    if (d.promptFeedback?.blockReason) blocked = d.promptFeedback.blockReason
    if (d.usageMetadata) usage = { input: d.usageMetadata.promptTokenCount ?? 0, output: d.usageMetadata.candidatesTokenCount ?? 0 }
    report()
  }
  await readSse(res, take)
  report(true)

  if (blocked) throw new Error(`Gemini 가 이 문서를 읽기를 거절했습니다 (${blocked}).`)
  if (!text.trim()) {
    if (finish === 'RECITATION') throw new Error('Gemini 가 저작권이 있는 글로 판단해 멈췄습니다(RECITATION). 교과서 · 책 본문은 읽지 못할 수 있습니다.')
    if (finish === 'SAFETY') throw new Error('Gemini 가 안전 기준에 걸린다며 멈췄습니다(SAFETY).')
    throw new Error('Gemini 가 빈 답을 보냈습니다. 다시 해 보거나 다른 모델을 골라 주세요.')
  }
  return { ok: true, text, finish, truncated: finish === 'MAX_TOKENS' || stoppedEarly(text), usage }
}

/** 고른 파일을 읽는다 (그 탭에서 새로 시작) */
export async function runOcr(req: OcrRequest, onProgress: (p: OcrProgress) => void): Promise<OcrAnswer> {
  const fail = (error: string): OcrAnswer => ({ ok: false, text: '', finish: '', truncated: false, error })
  const tab = req?.tab
  if (!tabOk(tab)) return fail('탭을 찾지 못했습니다. 탭을 새로 열어 주세요.')
  if (!sessions.has(tab) && !aborts.has(tab) && new Set([...sessions.keys(), ...aborts.keys()]).size >= OCR_MAX_TABS) {
    return fail(`한 번에 ${OCR_MAX_TABS}개까지 읽습니다. 다 쓴 탭을 닫고 다시 해 주세요.`)
  }
  if (aborts.has(tab)) return fail('이 탭은 아직 읽는 중입니다.')
  // 고른 모델로 어느 서비스로 읽을지 — 모델을 고르지 않았으면 Gemini 키가 있으면 Gemini, 없고 OpenAI 키만 있으면 OpenAI
  const settings = loadLocalSettings()
  const geminiKey = (settings.gemini_key ?? '').trim()
  const openaiKey = (settings.openai_key ?? '').trim()
  const asked = String(req.model ?? '')
  const provider: OcrProvider = ocrProviderOf(asked) ?? (geminiKey || !openaiKey ? 'gemini' : 'openai')
  const key = provider === 'openai' ? openaiKey : geminiKey
  if (!key) {
    return fail(
      provider === 'openai'
        ? 'OpenAI API 키가 없습니다. [설정 → AI 연결] 에서 OpenAI 키를 넣거나 Gemini 모델을 골라 주세요.'
        : openaiKey
          ? 'Gemini API 키가 없습니다. OpenAI 모델을 골라 읽거나, [설정 → AI 연결] 에서 Gemini 키를 넣어 주세요.'
          : 'Gemini 또는 OpenAI API 키가 없습니다. [설정 → AI 연결] 에서 키를 넣어 주세요.'
    )
  }
  const files = (Array.isArray(req?.ids) ? req.ids : []).map((id) => picked.get(String(id))).filter((f): f is Picked => !!f)
  if (!files.length) return fail('읽을 파일을 먼저 골라 주세요.')
  for (const f of files) {
    const max = f.mime === 'application/pdf' ? OCR_MAX_PDF : OCR_MAX_IMAGE
    if (f.size > max) return fail(`「${f.name}」 이(가) 너무 큽니다(${fmtBytes(f.size)}). ${f.mime === 'application/pdf' ? 'PDF 는 50MB' : '사진은 20MB'} 까지 읽습니다. 나눠서 읽어 주세요.`)
    if (!fs.existsSync(f.path)) return fail(`「${f.name}」 을(를) 찾을 수 없습니다. 다시 골라 주세요.`)
    if (provider === 'openai' && f.mime !== 'application/pdf' && !OCR_OPENAI_IMAGES.has(f.mime)) {
      return fail(`「${f.name}」: OpenAI 는 HEIC 사진을 읽지 못합니다. JPG · PNG 로 바꾸거나 Gemini 모델로 읽어 주세요.`)
    }
  }
  const total = files.reduce((n, f) => n + f.size, 0)
  if (provider === 'openai' && total > OA_TOTAL_LIMIT) return fail(`OpenAI 는 한 번에 50MB 까지 읽습니다(지금 ${fmtBytes(total)}). 나눠서 읽어 주세요.`)
  if (provider === 'openai' && files.filter((f) => f.mime !== 'application/pdf').reduce((n, f) => n + f.size, 0) > OA_INLINE_LIMIT) {
    return fail('사진이 너무 많습니다(합 30MB 까지). 나눠서 읽어 주세요.')
  }

  await clearOcr(tab)
  const ctrl = new AbortController()
  aborts.set(tab, ctrl)
  const timer = setTimeout(() => ctrl.abort(), READ_TIMEOUT)
  // 만든이가 지침 · 기본 모델을 바꿔 두었으면 그것을 (catalog.json 의 "ocr" — 받으러 가지 않고 이 PC 에 둔 것)
  const remote = peekCatalog().ocr
  const model =
    provider === 'openai'
      ? isOpenaiModel(asked)
        ? asked
        : remote?.openaiModel || OCR_OPENAI_MODEL
      : isGeminiModel(asked)
        ? asked
        : remote?.model || OCR_DEFAULT_MODEL
  const system = `${OCR_RULES}\n\n${remote?.prompt || OCR_AGENT_PROMPT}${provider === 'openai' ? `\n\n${OCR_OPENAI_RULES}` : ''}`
  const s: Session = { provider, key, model, system, turns: [], messages: [], uploaded: [], last: '' }
  sessions.set(tab, s)
  try {
    if (provider === 'openai') {
      // 쪽이 많으면 나눠 읽는다 (PDF 를 읽지 못하면 예전처럼 한 번에)
      const chunks = await splitPages(files)
      if (chunks && chunks.length > 1) {
        const a = await readChunked(s, chunks, String(req.note ?? ''), onProgress, ctrl.signal)
        s.last = a.text
        s.chunked = true
        return a
      }
      // 사진은 높은 해상도로, PDF 는 파일 그대로(OpenAI 가 쪽 그림과 글자를 함께 본다). 크면 PDF 는 파일 저장소로
      const content: OaPart[] = []
      const big = total > OA_INLINE_LIMIT
      const pdfs = files.filter((f) => f.mime === 'application/pdf')
      for (const f of files) {
        if (f.mime !== 'application/pdf') {
          content.push({ type: 'image_url', image_url: { url: `data:${f.mime};base64,${fs.readFileSync(f.path).toString('base64')}`, detail: 'high' } })
        } else if (big) {
          onProgress({ phase: 'upload', chars: pdfs.indexOf(f), rows: pdfs.length })
          const id = await uploadOpenai(key, { mime: f.mime, data: fs.readFileSync(f.path) }, ctrl.signal)
          s.uploaded.push(id)
          content.push({ type: 'file', file: { file_id: id } })
        } else {
          // 파일 이름에 학생 이름이 들어 있을 수 있어 보내지 않는다
          content.push({ type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${fs.readFileSync(f.path).toString('base64')}` } })
        }
      }
      onProgress({ phase: 'wait', chars: 0, rows: 0 })
      s.messages = [{ role: 'user', content: [...content, { type: 'text', text: ocrUserText(String(req.note ?? '')) }] }]
      const a = await generate(s, onProgress, ctrl.signal)
      s.last = a.text
      return a
    }
    const parts: Part[] = []
    if (total <= INLINE_LIMIT) {
      for (const f of files) parts.push({ inlineData: { mimeType: f.mime, data: fs.readFileSync(f.path).toString('base64') } })
    } else {
      for (const [i, f] of files.entries()) {
        onProgress({ phase: 'upload', chars: i, rows: files.length })
        const up = await uploadFile(key, f, ctrl.signal)
        s.uploaded.push(up.name)
        parts.push({ fileData: { mimeType: f.mime, fileUri: up.uri } })
      }
    }
    onProgress({ phase: 'wait', chars: 0, rows: 0 })
    s.turns = [{ role: 'user', parts: [...parts, { text: ocrUserText(String(req.note ?? '')) }] }]
    const a = await generate(s, onProgress, ctrl.signal)
    s.last = a.text
    return a
  } catch (e) {
    if (ctrl.signal.aborted) return fail('멈췄습니다.')
    return fail(e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
    if (aborts.get(tab) === ctrl) aborts.delete(tab)
  }
}

/* ---------- OpenAI: 쪽을 나눠 읽기 ---------- */

/** 쪽 묶음 하나 — 전체 문서 기준 from~to 쪽과, 그 쪽들만 담은 PDF 조각 · 사진 */
interface PageChunk {
  from: number
  to: number
  items: { mime: string; data: Buffer }[]
}

/**
 * 고른 파일들을 차례로 이어 OA_CHUNK_PAGES 쪽씩 묶는다 (PDF 는 그 쪽들만 새 PDF 로, 사진은 한 장이 한 쪽).
 * PDF 를 열지 못하면(암호 · 깨진 파일) null — 나누지 않고 예전처럼 한 번에 읽는다.
 */
async function splitPages(files: Picked[]): Promise<PageChunk[] | null> {
  const pages: { mime: string; data?: Buffer; doc?: PDFDocument; index?: number }[] = []
  for (const f of files) {
    const data = fs.readFileSync(f.path)
    if (f.mime !== 'application/pdf') {
      pages.push({ mime: f.mime, data })
      continue
    }
    try {
      const doc = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false })
      const n = doc.getPageCount()
      if (!n) return null
      for (let i = 0; i < n; i++) pages.push({ mime: f.mime, doc, index: i })
    } catch {
      return null
    }
  }
  if (pages.length <= OA_CHUNK_PAGES) return null
  const chunks: PageChunk[] = []
  for (let start = 0; start < pages.length; start += OA_CHUNK_PAGES) {
    const group = pages.slice(start, start + OA_CHUNK_PAGES)
    const items: PageChunk['items'] = []
    // 같은 PDF 에서 이어지는 쪽은 한 조각으로
    for (let i = 0; i < group.length; ) {
      const p = group[i]
      if (!p.doc) {
        items.push({ mime: p.mime, data: p.data! })
        i++
        continue
      }
      const idx: number[] = []
      while (i < group.length && group[i].doc === p.doc) idx.push(group[i++].index!)
      const out = await PDFDocument.create()
      for (const page of await out.copyPages(p.doc, idx)) out.addPage(page)
      items.push({ mime: 'application/pdf', data: Buffer.from(await out.save()) })
    }
    chunks.push({ from: start + 1, to: start + group.length, items })
  }
  return chunks
}

/** 묶음 하나를 읽는다 — 끊기면 마지막 행 다음부터 이어 받고, 오류면 잠시 뒤 다시 해 본다 */
async function readChunk(
  s: Session,
  c: PageChunk,
  total: number,
  note: string,
  header: string,
  onProgress: (p: OcrProgress) => void,
  signal: AbortSignal
): Promise<{ answers: OcrAnswer[]; usage: { input: number; output: number } }> {
  const content: OaPart[] = []
  const big = c.items.reduce((n, it) => n + it.data.length, 0) > OA_INLINE_LIMIT
  for (const it of c.items) {
    if (it.mime !== 'application/pdf') {
      content.push({ type: 'image_url', image_url: { url: `data:${it.mime};base64,${it.data.toString('base64')}`, detail: 'high' } })
    } else if (big) {
      const id = await uploadOpenai(s.key, it, signal)
      s.uploaded.push(id)
      content.push({ type: 'file', file: { file_id: id } })
    } else {
      content.push({ type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${it.data.toString('base64')}` } })
    }
  }
  const sub: Session = { ...s, messages: [{ role: 'user', content: [...content, { type: 'text', text: ocrChunkText(note, c.from, c.to, total, header) }] }] }
  const answers: OcrAnswer[] = []
  const usage = { input: 0, output: 0 }
  for (let round = 0; ; round++) {
    let a: OcrAnswer | null = null
    for (let attempt = 0; !a; attempt++) {
      try {
        a = await generateOpenai(sub, onProgress, signal)
      } catch (e) {
        if (signal.aborted || attempt >= OA_CHUNK_RETRY || /API 키|크레딧|모델이 없습니다/.test(e instanceof Error ? e.message : '')) throw e
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)))
      }
    }
    answers.push(a)
    usage.input += a.usage?.input ?? 0
    usage.output += a.usage?.output ?? 0
    if (!a.truncated || round >= OA_CHUNK_CONTINUE) return { answers, usage }
    const kept = dropPartialTail(a.text)
    const t = extractTables(kept)
    const last = t[t.length - 1]
    const lastRow = last?.rows.length ? `| ${last.rows[last.rows.length - 1].map((x) => x.replace(/\|/g, '\\|')).join(' | ')} |` : ''
    sub.messages.push({ role: 'assistant', content: kept }, { role: 'user', content: ocrContinueText(lastRow) })
  }
}

/**
 * 묶음들을 읽어 표 하나로 합친다. 첫 묶음을 먼저 읽어 열 머리글을 정하고, 나머지는 그 머리글로 동시에 OA_PARALLEL 개씩.
 * 첫 묶음이 실패하면(키 · 크레딧 등) 그대로 실패, 뒤 묶음이 실패하면 받은 것만 두고 빠진 쪽을 알린다.
 */
async function readChunked(s: Session, chunks: PageChunk[], note: string, onProgress: (p: OcrProgress) => void, signal: AbortSignal): Promise<OcrAnswer> {
  const total = chunks[chunks.length - 1].to
  const live = new Map<number, OcrProgress>()
  let done = 0
  const report = (i: number) => (p: OcrProgress): void => {
    live.set(i, p)
    let chars = 0
    let rows = 0
    for (const v of live.values()) {
      chars += v.chars
      rows += v.rows
    }
    onProgress({ phase: p.phase === 'upload' ? 'wait' : p.phase, chars, rows, part: done, parts: chunks.length })
  }
  onProgress({ phase: 'wait', chars: 0, rows: 0, part: 0, parts: chunks.length })
  const results: ({ answers: OcrAnswer[]; usage: { input: number; output: number } } | null)[] = new Array(chunks.length).fill(null)
  const failed: string[] = []

  results[0] = await readChunk(s, chunks[0], total, note, '', report(0), signal)
  done = 1
  const firstTables = answersToTables(results[0].answers)
  const main = firstTables.reduce<(typeof firstTables)[number] | undefined>((m, t) => (!m || t.rows.length > m.rows.length ? t : m), undefined)
  const header = main ? tableToMd({ title: '', header: main.header, rows: [] }) : ''

  let next = 1
  const worker = async (): Promise<void> => {
    while (next < chunks.length) {
      const i = next++
      try {
        results[i] = await readChunk(s, chunks[i], total, note, header, report(i), signal)
      } catch (e) {
        if (signal.aborted) throw e
        failed.push(`${chunks[i].from}~${chunks[i].to}쪽 (${e instanceof Error ? e.message : String(e)})`)
      }
      done++
      report(i)(live.get(i) ?? { phase: 'read', chars: 0, rows: 0 })
    }
  }
  await Promise.all(Array.from({ length: Math.min(OA_PARALLEL, chunks.length - 1) }, worker))

  const tables = mergeChunkTables(
    results.map((r) => (r ? answersToTables(r.answers) : [])),
    OCR_CONTINUED
  )
  const intro = proseOf(results[0].answers[0].text).split('\n').find((l) => l.trim()) ?? ''
  const missing = failed.length ? `\n\n> ⚠ 다음 쪽은 읽지 못했습니다. 그 쪽만 따로 다시 읽어 주세요: ${failed.join(' · ')}` : ''
  const text = `${intro}${missing}\n\n${tables.map(tableToMd).join('\n\n')}`
  const usage = results.reduce((u, r) => ({ input: u.input + (r?.usage.input ?? 0), output: u.output + (r?.usage.output ?? 0) }), { input: 0, output: 0 })
  return { ok: true, text, finish: 'stop', truncated: false, usage }
}

/** 그 탭에서 끊긴 답의 나머지를 받는다 */
export async function continueOcr(tab: string, onProgress: (p: OcrProgress) => void): Promise<OcrAnswer> {
  const fail = (error: string): OcrAnswer => ({ ok: false, text: '', finish: '', truncated: false, error })
  const s = tabOk(tab) ? sessions.get(tab) : undefined
  if (!s || !s.last) return fail('이어 받을 결과가 없습니다. 처음부터 다시 읽어 주세요.')
  if (s.chunked) return fail('쪽을 나눠 모두 받았습니다. 빠진 것이 있으면 처음부터 다시 읽어 주세요.')
  if (aborts.has(tab)) return fail('이 탭은 아직 읽는 중입니다.')
  const ctrl = new AbortController()
  aborts.set(tab, ctrl)
  const timer = setTimeout(() => ctrl.abort(), READ_TIMEOUT)
  try {
    const kept = dropPartialTail(s.last)
    const t = extractTables(kept)
    const lastTable = t[t.length - 1]
    const lastRow = lastTable?.rows.length ? `| ${lastTable.rows[lastTable.rows.length - 1].map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |` : ''
    if (s.provider === 'openai') s.messages.push({ role: 'assistant', content: kept }, { role: 'user', content: ocrContinueText(lastRow) })
    else s.turns.push({ role: 'model', parts: [{ text: kept }] }, { role: 'user', parts: [{ text: ocrContinueText(lastRow) }] })
    onProgress({ phase: 'wait', chars: 0, rows: 0 })
    const a = await generate(s, onProgress, ctrl.signal)
    s.last = a.text
    return a
  } catch (e) {
    if (ctrl.signal.aborted) return fail('멈췄습니다.')
    return fail(e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
    if (aborts.get(tab) === ctrl) aborts.delete(tab)
  }
}

/* ---------- 엑셀로 ---------- */

/** 화면에서 보이는 너비 — 한글 · 한자는 두 칸 */
function widthOf(s: string): number {
  let w = 0
  for (const ch of s) w += /[ᄀ-ᇿ　-〿㄰-㆏一-鿿가-힣＀-￯]/.test(ch) ? 2 : 1
  return w
}

/** 엑셀 줄 높이 한도(409pt) · 10pt 글 한 줄 높이 */
const ROW_MAX = 409
const LINE = 15
/** 줄바꿈이 낱말 단위라 생기는 빈자리만큼 넉넉히 */
const WRAP_SLACK = 1.15
/** 엑셀 칸 하나에 들어가는 글자 수(32,767) — 넘으면 엑셀이 파일을 '복구' 하려 든다 */
const CELL_MAX = 32000

/** 칸 글이 엑셀 한도를 넘으면 자르고 표시한다(전체는 화면의 [받은 글 보기] 에 있다) */
function fitCell(v: string): string {
  return v.length > CELL_MAX ? `${v.slice(0, CELL_MAX)} …(엑셀 칸 한도로 여기서 잘림 — 프로그램의 [받은 글 보기]에 전체가 있습니다)` : v
}

/** 이 너비들로 한 행이 몇 줄로 보일지 */
function linesOf(values: string[], cols: number[]): number {
  let lines = 1
  values.forEach((v, j) => {
    const w = cols[j] ?? 8
    const n = v.split('\n').reduce((sum, l) => sum + (Math.ceil((widthOf(l) * WRAP_SLACK) / w) || 1), 0)
    lines = Math.max(lines, n)
  })
  return lines
}

/**
 * 열 너비: 내용에 맞추되 60 을 넘으면 줄을 바꿔 보이게 한다.
 * 그래도 줄 높이 한도(409pt)를 넘는 긴 글(탐구 보고서 본문 같은)은 다 보이도록 그 열만 더 넓힌다(최대 150).
 */
export function columnWidths(header: string[], body: string[][]): number[] {
  const longest = header.map((h, j) => Math.max(widthOf(h), ...body.map((r) => Math.max(0, ...(r[j] ?? '').split('\n').map(widthOf)))))
  const cols = longest.map((w) => Math.max(8, Math.min(60, w + 2)))
  const fit = Math.floor(ROW_MAX / LINE)
  for (const r of body) {
    if (linesOf(r, cols) <= fit) continue
    r.forEach((v, j) => {
      const need = Math.ceil((v.split('\n').reduce((sum, l) => sum + widthOf(l), 0) * WRAP_SLACK) / (fit - v.split('\n').length + 1)) + 2
      if (need > cols[j]) cols[j] = Math.min(150, need)
    })
  }
  return cols
}

function sheetName(raw: string, used: Set<string>, i: number): string {
  const base = (raw.replace(/[\\/*?[\]:\x00-\x1f]/g, '').trim().replace(/^'+|'+$/g, '') || `표${i + 1}`).slice(0, 31)
  let name = base.toLowerCase() === 'history' ? 'History_' : base
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - ` (${n})`.length)} (${n})`
  used.add(name.toLowerCase())
  return name
}

const cleanFile = (s: string): string => s.replace(/[\\/*?:"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 50)

/** 표들을 엑셀 통합 문서로 — 표마다 시트 하나, 모든 칸은 글자 그대로(학번 앞의 0 · 날짜 · 수식 모양을 지킨다) */
export async function tablesToXlsx(tables: MdTable[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = '업무 인수인계 대시보드'
  const used = new Set<string>()
  const line = { style: 'thin' as const, color: { argb: 'FFE5E7EB' } }
  const border = { top: line, left: line, bottom: line, right: line }
  tables.forEach((t, i) => {
    const ws = wb.addWorksheet(sheetName(t.title, used, i))
    const width = Math.max(t.header.length, ...t.rows.map((r) => r.length))
    const header = Array.from({ length: width }, (_, j) => plainCell(t.header[j] ?? '').trim() || `열${j + 1}`)
    const head = ws.addRow(header)
    head.height = 30
    head.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: '맑은 고딕', size: 11 }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      c.border = border
    })
    const body = t.rows.map((r) => Array.from({ length: width }, (_, j) => fitCell(plainCell(r[j] ?? ''))))
    body.forEach((values, ri) => {
      const row = ws.addRow(values)
      row.eachCell({ includeEmpty: true }, (c) => {
        c.font = { name: '맑은 고딕', size: 10 }
        c.alignment = { vertical: 'top', wrapText: true }
        c.border = border
        if (ri % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }
      })
    })
    const cols = columnWidths(header, body)
    ws.columns.forEach((c, j) => (c.width = cols[j] ?? 8))
    body.forEach((values, ri) => (ws.getRow(ri + 2).height = Math.min(ROW_MAX, Math.max(18, linesOf(values, cols) * LINE))))
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    if (t.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: width } }
  })
  return Buffer.from(await wb.xlsx.writeBuffer())
}

export async function saveXlsx(win: BrowserWindow | null, tables: MdTable[], title: string): Promise<{ ok: boolean; message: string }> {
  if (!win) return { ok: false, message: '창을 찾을 수 없습니다.' }
  const list = (Array.isArray(tables) ? tables : []).filter((t) => t && Array.isArray(t.header) && Array.isArray(t.rows))
  if (!list.length) return { ok: false, message: '저장할 표가 없습니다.' }
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
  const res = await dialog.showSaveDialog(win, {
    title: '엑셀로 저장',
    defaultPath: `${cleanFile(title) || 'OCR_결과'}_${stamp}.xlsx`,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  })
  if (res.canceled || !res.filePath) return { ok: false, message: '취소했습니다.' }
  try {
    fs.writeFileSync(res.filePath, await tablesToXlsx(list))
    return { ok: true, message: `저장했습니다: ${res.filePath}` }
  } catch (e) {
    return { ok: false, message: `저장하지 못했습니다. 엑셀에서 같은 파일을 열어 두었다면 닫고 다시 해 주세요. (${e instanceof Error ? e.message : e})` }
  }
}
