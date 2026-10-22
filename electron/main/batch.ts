/**
 * 폴더 일괄 분석 — 학생 결과물 폴더를 통째로 읽어 학생마다 한 번씩 AI 에 묻고, 항목별로 정리한 표(엑셀 · CSV)와 세특 · 채점을 받는다.
 *
 *  - 폴더(하위 폴더 3단계까지)의 파일을 파일 이름으로 학생별로 묶는다(shared/batch.ts). 사진 여러 장도 한 학생으로.
 *  - 학생 한 명 = 요청 한 번. 그 학생의 파일을 모두 함께 보낸다.
 *    PDF 는 원본 그대로(그림 · 표 · 손글씨까지 본다), 사진은 그림으로,
 *    한글 · 워드 · 엑셀 · 글 파일은 글자를 뽑아 보내고, 안에 붙은 그림(그래프 · 손글씨 사진)도 몇 장 함께 보낸다.
 *  - 사용자가 고른 서비스(Gemini · OpenAI · Claude)와 모델로, 동시에 3명씩. 답은 JSON 으로 받는다.
 *  - 세특 글자 수가 목표에서 많이 벗어나면 글만 보내 한 번 고쳐 받는다.
 *  - 파일 이름(학생 이름이 들어 있다)은 보내지 않는다. 결과는 저장하지 않는다(엑셀 · CSV 로 저장하지 않으면 사라진다).
 */

import { dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import CFB from 'cfb'
import { inflateSync, unzipSync } from 'fflate'
import type { BatchFolder, BatchOptions, BatchProgress, BatchRequest, BatchResult, BatchRow, RawEntry } from '../../shared/batch'
import { BATCH_MAX_DEPTH, BATCH_MAX_FILES, batchKindOf, batchSystem, batchTable, groupStudents, lengthOk, parseBatchAnswer, seteukFixText, seteukLength, toCsv } from '../../shared/batch'
import { isModernGemini } from '../../shared/gemini'
import type { LocalSettings, ModelChoice, Provider } from '../../shared/types'
import { extractFile } from './extract'
import { httpFetch } from './http'
import { tablesToXlsx } from './ocr'
import { loadLocalSettings } from './secrets'

/** 동시에 읽는 학생 수 · 한 학생에 실어 보내는 파일 합 · 한글 · 워드 안의 그림 수 · 한 학생 기다리는 시간 */
const PARALLEL = 3
const INLINE_LIMIT = 14 * 1024 * 1024
const EMBED_MAX = 6
const EMBED_MIN = 8 * 1024
const TIMEOUT = 5 * 60 * 1000
/** 한 학생의 글이 이보다 길면 자른다 (보고서 몇 쪽이면 충분) */
const TEXT_MAX = 60000

interface Picked {
  path: string
  name: string
}

/** 이번 실행에서 고른 파일 (화면은 번호로만 가리킨다) */
const picked = new Map<string, Picked>()
const jobs = new Map<string, AbortController>()

const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp' }
/** OpenAI · Claude 가 받는 그림 */
const COMMON_IMAGES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/* ---------- 폴더 고르기 ---------- */

const ignored = (name: string): boolean => name.startsWith('.') || name.startsWith('~$') || /^(thumbs\.db|desktop\.ini)$/i.test(name)

export function scanFolder(dir: string): BatchFolder {
  const root = path.resolve(dir)
  const entries: RawEntry[] = []
  const skipped: string[] = []
  const walk = (d: string, dirs: string[]): void => {
    let list: fs.Dirent[]
    try {
      list = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of list.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }))) {
      if (ignored(e.name) || entries.length >= BATCH_MAX_FILES) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (dirs.length < BATCH_MAX_DEPTH) walk(p, [...dirs, e.name])
        continue
      }
      if (!e.isFile()) continue
      if (!batchKindOf(e.name)) {
        skipped.push(e.name)
        continue
      }
      let size = 0
      try {
        size = fs.statSync(p).size
      } catch {
        continue
      }
      const id = crypto.randomUUID()
      picked.set(id, { path: p, name: e.name })
      entries.push({ id, name: e.name, size, dirs })
    }
  }
  walk(root, [])
  if (!entries.length) return { ok: false, folder: path.basename(root), students: [], skipped, error: '읽을 수 있는 파일(PDF · 한글 · 워드 · 사진 · 엑셀 · 글)이 없습니다.' }
  return { ok: true, folder: path.basename(root), students: groupStudents(entries), skipped }
}

export async function pickFolder(win: BrowserWindow | null): Promise<BatchFolder | null> {
  if (!win) return null
  const res = await dialog.showOpenDialog(win, { title: '학생 결과물 폴더 고르기', properties: ['openDirectory'] })
  if (res.canceled || !res.filePaths[0]) return null
  return scanFolder(res.filePaths[0])
}

/** 끌어 놓은 폴더 */
export function addFolder(p: unknown): BatchFolder {
  if (typeof p !== 'string' || !p) return { ok: false, folder: '', students: [], skipped: [], error: '폴더를 찾지 못했습니다.' }
  try {
    if (!fs.statSync(p).isDirectory()) return { ok: false, folder: path.basename(p), students: [], skipped: [], error: '파일이 아니라 폴더를 끌어 놓아 주세요.' }
  } catch {
    return { ok: false, folder: '', students: [], skipped: [], error: '폴더를 찾지 못했습니다.' }
  }
  return scanFolder(p)
}

/* ---------- 파일 → 보낼 것 ---------- */

type Piece = { type: 'text'; text: string } | { type: 'image'; mime: string; data: Buffer } | { type: 'pdf'; data: Buffer }

/** 한글(hwpx) · 워드(docx) 안에 붙은 그림 */
function zipImages(buf: Buffer): { mime: string; data: Buffer }[] {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(buf), { filter: (f) => /^(BinData|word\/media)\//i.test(f.name) && f.originalSize <= 8 * 1024 * 1024 })
  } catch {
    return []
  }
  return Object.entries(files)
    .map(([n, d]) => ({ mime: IMAGE_MIME[n.split('.').pop()!.toLowerCase()] ?? '', data: Buffer.from(d) }))
    .filter((x) => x.mime && x.data.length >= EMBED_MIN)
}

/** 한글(hwp) 안에 붙은 그림 — BinData 저장소. 본문처럼 압축돼 있을 수 있다 */
function hwpImages(buf: Buffer): { mime: string; data: Buffer }[] {
  if (buf.length > 2 && buf[0] === 0x50 && buf[1] === 0x4b) return zipImages(buf)
  try {
    const cfb = CFB.read(buf, { type: 'buffer' })
    const out: { mime: string; data: Buffer }[] = []
    cfb.FullPaths.forEach((p, i) => {
      const m = /BinData\/[^/]+\.(\w+)$/i.exec(p)
      const mime = m ? IMAGE_MIME[m[1].toLowerCase()] : ''
      const content = cfb.FileIndex[i]?.content
      if (!mime || !content) return
      let data = Buffer.from(content as Uint8Array)
      try {
        data = Buffer.from(inflateSync(data))
      } catch {
        // 압축하지 않은 그림
      }
      if (data.length >= EMBED_MIN && data.length <= 8 * 1024 * 1024) out.push({ mime, data })
    })
    return out
  } catch {
    return []
  }
}

/** 그림이 정말 그 형식인지 (깨진 그림을 보내면 요청 전체가 거절된다) */
function looksLike(mime: string, d: Buffer): boolean {
  if (mime === 'image/png') return d[0] === 0x89 && d[1] === 0x50
  if (mime === 'image/jpeg') return d[0] === 0xff && d[1] === 0xd8
  if (mime === 'image/gif') return d[0] === 0x47 && d[1] === 0x49
  if (mime === 'image/webp') return d.subarray(8, 12).toString('latin1') === 'WEBP'
  return true
}

/** 학생 한 명의 파일 → 보낼 조각들 · 알릴 말 */
async function piecesOf(files: Picked[], provider: Provider): Promise<{ pieces: Piece[]; notes: string[] }> {
  const pieces: Piece[] = []
  const notes: string[] = []
  let budget = INLINE_LIMIT
  let n = 0
  const okImage = (mime: string): boolean => provider === 'gemini' || COMMON_IMAGES.has(mime)
  for (const f of files) {
    n++
    const kind = batchKindOf(f.name)
    const label = `[파일 ${n}${kind === 'image' ? ' · 사진' : kind === 'pdf' ? ' · PDF' : ''}]`
    let buf: Buffer
    try {
      buf = fs.readFileSync(f.path)
    } catch {
      notes.push(`${f.name}: 파일을 열지 못함`)
      continue
    }
    if (kind === 'image') {
      const ext = f.name.split('.').pop()!.toLowerCase()
      const mime = IMAGE_MIME[ext]
      if (!okImage(mime)) {
        notes.push(`${f.name}: 이 서비스는 ${ext.toUpperCase()} 사진을 읽지 못함(Gemini 로 읽거나 JPG 로 바꿔 주세요)`)
        continue
      }
      if (buf.length > budget) {
        notes.push(`${f.name}: 너무 커서 뺌`)
        continue
      }
      budget -= buf.length
      pieces.push({ type: 'text', text: label }, { type: 'image', mime, data: buf })
      continue
    }
    if (kind === 'pdf' && buf.length <= budget) {
      budget -= buf.length
      pieces.push({ type: 'text', text: label }, { type: 'pdf', data: buf })
      continue
    }
    // 한글 · 워드 · 엑셀 · 글 (또는 너무 큰 PDF) — 글자를 뽑고, 붙은 그림을 몇 장
    const doc = await extractFile(f.path)
    const ext = f.name.split('.').pop()!.toLowerCase()
    const imgs = (ext === 'hwp' || ext === 'hwpx' ? hwpImages(buf) : ext === 'docx' ? zipImages(buf) : [])
      .filter((x) => okImage(x.mime) && looksLike(x.mime, x.data))
      .slice(0, EMBED_MAX)
    if (!doc.text.trim() && !imgs.length) {
      notes.push(`${f.name}: ${doc.error || '글자를 읽지 못함'}`)
      continue
    }
    const text = doc.text.length > TEXT_MAX ? `${doc.text.slice(0, TEXT_MAX)}\n…(길어서 여기까지)` : doc.text
    pieces.push({ type: 'text', text: `${label} 문서에서 뽑은 글${imgs.length ? ` (문서 안의 그림 ${imgs.length}장이 뒤따름)` : ''}:\n${text || '(글자 없음 — 그림만 있는 문서)'}` })
    for (const im of imgs) {
      if (im.data.length > budget) break
      budget -= im.data.length
      pieces.push({ type: 'image', mime: im.mime, data: im.data })
    }
  }
  return { pieces, notes }
}

/* ---------- AI 에 묻기 ---------- */

interface Answer {
  text: string
  usage: { input: number; output: number }
}

async function failText(res: Response, who: string): Promise<string> {
  let detail = ''
  try {
    detail = (await res.text()).slice(0, 300)
  } catch {
    /* 상태 코드만으로 */
  }
  if (res.status === 401 || res.status === 403) return `${who} API 키가 올바르지 않거나 권한이 없습니다. [설정 → AI 연결] 에서 키를 확인해 주세요.`
  if (res.status === 404) return `${who} 에 그 모델이 없습니다. 다른 모델을 골라 주세요.`
  if (res.status === 413) return '보낼 파일이 너무 큽니다.'
  if (res.status === 429) return /insufficient_quota|credit/i.test(detail) ? `${who} 크레딧 · 결제를 확인해 주세요.` : `${who} 사용량 한도에 걸렸습니다. 잠시 뒤 [실패한 학생 다시] 를 눌러 주세요.`
  if (res.status === 400 && /API key not valid/i.test(detail)) return `${who} API 키가 올바르지 않습니다.`
  return `${who} 오류 (${res.status}) ${detail}`
}

async function askGemini(key: string, model: string, system: string, pieces: Piece[], json: boolean, signal: AbortSignal, thinking = true): Promise<Answer> {
  const parts = pieces.map((p) =>
    p.type === 'text' ? { text: p.text } : { inlineData: { mimeType: p.type === 'pdf' ? 'application/pdf' : p.mime, data: p.data.toString('base64') } }
  )
  const res = await httpFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        ...(json ? { responseMimeType: 'application/json' } : {}),
        ...(thinking ? { thinkingConfig: { thinkingLevel: 'LOW', includeThoughts: false } } : {}),
        ...(isModernGemini(model) ? {} : { temperature: 0.3 })
      }
    })
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    if (res.status === 400 && thinking && /thinking/i.test(txt)) return askGemini(key, model, system, pieces, json, signal, false)
    throw new Error(await failText(new Response(txt, { status: res.status }), 'Gemini'))
  }
  const d = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
    promptFeedback?: { blockReason?: string }
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  }
  if (d.promptFeedback?.blockReason) throw new Error(`Gemini 가 읽기를 거절했습니다 (${d.promptFeedback.blockReason}).`)
  const text = (d.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('')
  if (!text.trim()) throw new Error(`Gemini 가 빈 답을 보냈습니다${d.candidates?.[0]?.finishReason ? ` (${d.candidates[0].finishReason})` : ''}.`)
  return { text, usage: { input: d.usageMetadata?.promptTokenCount ?? 0, output: d.usageMetadata?.candidatesTokenCount ?? 0 } }
}

async function askOpenai(key: string, model: string, system: string, pieces: Piece[], json: boolean, signal: AbortSignal, reasoning = true): Promise<Answer> {
  const content = pieces.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : p.type === 'image'
        ? { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data.toString('base64')}`, detail: 'high' } }
        : { type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${p.data.toString('base64')}` } }
  )
  const res = await httpFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content }
      ],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      ...(reasoning ? { reasoning_effort: 'low' } : {})
    })
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    if (res.status === 400 && reasoning && /reasoning/i.test(txt)) return askOpenai(key, model, system, pieces, json, signal, false)
    throw new Error(await failText(new Response(txt, { status: res.status }), 'OpenAI'))
  }
  const d = (await res.json()) as { choices?: { message?: { content?: string; refusal?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
  const m = d.choices?.[0]?.message
  if (!m?.content?.trim()) throw new Error(m?.refusal ? `OpenAI 가 거절했습니다: ${m.refusal.slice(0, 150)}` : 'OpenAI 가 빈 답을 보냈습니다.')
  return { text: m.content, usage: { input: d.usage?.prompt_tokens ?? 0, output: d.usage?.completion_tokens ?? 0 } }
}

async function askClaude(key: string, model: string, system: string, pieces: Piece[], signal: AbortSignal): Promise<Answer> {
  const content = pieces.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : { type: p.type === 'pdf' ? 'document' : 'image', source: { type: 'base64', media_type: p.type === 'pdf' ? 'application/pdf' : p.mime, data: p.data.toString('base64') } }
  )
  const res = await httpFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 8000, system, messages: [{ role: 'user', content }] })
  })
  if (!res.ok) throw new Error(await failText(res, 'Claude'))
  const d = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } }
  const text = (d.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
  if (!text.trim()) throw new Error('Claude 가 빈 답을 보냈습니다.')
  return { text, usage: { input: d.usage?.input_tokens ?? 0, output: d.usage?.output_tokens ?? 0 } }
}

function ask(c: ModelChoice, key: string, system: string, pieces: Piece[], json: boolean, signal: AbortSignal): Promise<Answer> {
  if (c.provider === 'openai') return askOpenai(key, c.model, system, pieces, json, signal)
  if (c.provider === 'claude') return askClaude(key, c.model, system, pieces, signal)
  return askGemini(key, c.model, system, pieces, json, signal)
}

const keyOf = (s: LocalSettings, p: Provider): string => ((p === 'openai' ? s.openai_key : p === 'claude' ? s.claude_key : s.gemini_key) ?? '').trim()
const defaultOf = (s: LocalSettings, p: Provider): string => (p === 'openai' ? s.openai_model : p === 'claude' ? s.claude_model : s.gemini_model)

/** 고른 모델 → 없으면 이 기능에 저장한 것 → 기본 서비스 → 키가 있는 서비스 */
function resolve(s: LocalSettings, want: ModelChoice | null): { choice: ModelChoice; key: string } | null {
  const tries: ModelChoice[] = []
  if (want?.provider && want.model) tries.push(want)
  const saved = s.feature_models?.batch
  if (saved?.model) tries.push(saved)
  for (const p of [s.provider, 'gemini', 'openai', 'claude'] as Provider[]) tries.push({ provider: p, model: defaultOf(s, p) })
  for (const c of tries) {
    const key = keyOf(s, c.provider)
    if (key && c.model) return { choice: c, key }
  }
  return null
}

/** 학생 한 명 */
async function readStudent(c: ModelChoice, key: string, o: BatchOptions, files: Picked[], signal: AbortSignal): Promise<BatchResult> {
  const { pieces, notes } = await piecesOf(files, c.provider)
  if (!pieces.length) throw new Error(notes.join(' · ') || '읽을 수 있는 파일이 없습니다.')
  const system = batchSystem(o)
  const items = o.items.map((x) => x.trim()).filter(Boolean)
  const body: Piece[] = [...pieces, { type: 'text', text: '위 파일들은 한 학생의 결과물입니다. 지침대로 정리해 JSON 으로만 답해 주세요.' }]
  let a: Answer | null = null
  let r: BatchResult | null = null
  // 답 모양이 깨졌으면 한 번 더
  for (let attempt = 0; !r; attempt++) {
    a = await ask(c, key, system, body, true, signal)
    try {
      r = parseBatchAnswer(a.text, items)
    } catch (e) {
      if (attempt >= 1) throw e
    }
  }
  const usage = { ...a!.usage }
  // 세특 글자 수 맞추기 (한 번만 — 글만 보낸다)
  if (o.seteuk && r.seteuk && !lengthOk(seteukLength(r.seteuk), o.seteukLength)) {
    try {
      const fix = await ask(c, key, '교사의 세특 문장 다듬기를 돕는 조수입니다. 고친 세특 글만 답합니다.', [{ type: 'text', text: seteukFixText(r.seteuk, o.seteukLength) }], false, signal)
      const t = fix.text.trim().replace(/^["'「]|["'」]$/g, '').replace(/\s*\n+\s*/g, ' ')
      usage.input += fix.usage.input
      usage.output += fix.usage.output
      if (t && Math.abs(seteukLength(t) - o.seteukLength) < Math.abs(seteukLength(r.seteuk) - o.seteukLength)) r.seteuk = t
    } catch {
      // 고치지 못하면 처음 것을 둔다
    }
  }
  if (notes.length) r.note = [r.note, ...notes].filter(Boolean).join(' · ')
  return { ...r, usage }
}

/** 고른 학생들을 읽는다 — 한 명 끝날 때마다 화면에 알린다 */
export async function runBatch(req: BatchRequest, send: (p: BatchProgress) => void): Promise<{ ok: boolean; error?: string }> {
  const job = String(req?.job ?? '')
  if (!/^[\w-]{1,64}$/.test(job)) return { ok: false, error: '작업을 찾지 못했습니다.' }
  if (jobs.has(job)) return { ok: false, error: '이미 읽는 중입니다.' }
  const o = req.options
  if (!o || !Array.isArray(o.items)) return { ok: false, error: '정리할 항목을 정해 주세요.' }
  if (!o.items.some((x) => x.trim()) && !o.seteuk && !o.grade) return { ok: false, error: '정리할 항목을 하나 이상 적거나 세특 · 채점을 켜 주세요.' }
  const r = resolve(loadLocalSettings(), req.model)
  if (!r) return { ok: false, error: 'AI API 키가 없습니다. [설정 → AI 연결] 에서 Gemini · OpenAI · Claude 가운데 하나의 키를 넣어 주세요.' }
  const list = (Array.isArray(req.students) ? req.students : []).map((s) => ({ key: String(s.key), files: (s.ids ?? []).map((id) => picked.get(String(id))).filter((f): f is Picked => !!f) }))
  if (!list.length) return { ok: false, error: '읽을 학생이 없습니다.' }
  const options: BatchOptions = { ...o, seteukLength: Math.max(50, Math.min(1500, Math.round(Number(o.seteukLength) || 200))) }

  const ctrl = new AbortController()
  jobs.set(job, ctrl)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < list.length && !ctrl.signal.aborted) {
      const s = list[next++]
      send({ job, key: s.key, status: 'reading' })
      const one = new AbortController()
      const stop = (): void => one.abort()
      ctrl.signal.addEventListener('abort', stop)
      const timer = setTimeout(stop, TIMEOUT)
      try {
        if (!s.files.length) throw new Error('파일을 찾지 못했습니다. 폴더를 다시 골라 주세요.')
        const result = await readStudent(r.choice, r.key, options, s.files, one.signal)
        send({ job, key: s.key, status: 'done', result })
      } catch (e) {
        const msg = ctrl.signal.aborted ? '멈췄습니다.' : one.signal.aborted ? '너무 오래 걸려 멈췄습니다.' : e instanceof Error ? e.message : String(e)
        send({ job, key: s.key, status: 'error', error: msg })
        // 키 · 크레딧 문제면 나머지도 똑같이 실패하므로 멈춘다
        if (/API 키|크레딧|모델이 없습니다/.test(msg)) ctrl.abort()
      } finally {
        clearTimeout(timer)
        ctrl.signal.removeEventListener('abort', stop)
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL, list.length) }, worker))
  } finally {
    jobs.delete(job)
  }
  return { ok: true }
}

export function cancelBatch(job: string): void {
  jobs.get(String(job))?.abort()
}

/* ---------- 저장 ---------- */

export async function saveBatch(
  win: BrowserWindow | null,
  rows: BatchRow[],
  options: BatchOptions,
  title: string,
  format: 'xlsx' | 'csv'
): Promise<{ ok: boolean; message: string }> {
  if (!win) return { ok: false, message: '창을 찾을 수 없습니다.' }
  if (!Array.isArray(rows) || !rows.length) return { ok: false, message: '저장할 결과가 없습니다.' }
  const t = batchTable(rows, options)
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
  const base = String(title ?? '').replace(/[\\/*?:"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 50) || '학생별_정리'
  const res = await dialog.showSaveDialog(win, {
    title: format === 'csv' ? 'CSV 로 저장' : '엑셀로 저장',
    defaultPath: `${base}_${stamp}.${format}`,
    filters: [format === 'csv' ? { name: 'CSV', extensions: ['csv'] } : { name: 'Excel', extensions: ['xlsx'] }]
  })
  if (res.canceled || !res.filePath) return { ok: false, message: '취소했습니다.' }
  try {
    const data = format === 'csv' ? Buffer.from(toCsv(t.header, t.rows), 'utf8') : await tablesToXlsx([{ title: '학생별 정리', header: t.header, rows: t.rows }])
    fs.writeFileSync(res.filePath, data)
    return { ok: true, message: `저장했습니다: ${res.filePath}` }
  } catch (e) {
    return { ok: false, message: `저장하지 못했습니다. 같은 파일을 엑셀에서 열어 두었다면 닫고 다시 해 주세요. (${e instanceof Error ? e.message : e})` }
  }
}
