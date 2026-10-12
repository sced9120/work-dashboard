/**
 * 스캔 문서 → 엑셀 (OCR). 사용자가 넣어 둔 자기 Gemini 키로 PDF · 사진 원본을 Gemini 에 보내
 * 원문 그대로 마크다운 표를 받고, 그 표를 엑셀 파일로 저장한다.
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
import type { MdTable } from '../../shared/mdtable'
import { dropPartialTail, extractTables, plainCell } from '../../shared/mdtable'
import type { OcrAnswer, OcrFile, OcrProgress, OcrRequest } from '../../shared/ocr'
import { OCR_DEFAULT_MODEL, OCR_MAX_IMAGE, OCR_MAX_PDF, OCR_TYPES, fmtBytes, isGeminiModel, isModernGemini, ocrContinueText, ocrUserText, saysStoppedEarly } from '../../shared/ocr'
import { OCR_AGENT_PROMPT, OCR_RULES } from '../../shared/ocrPrompt'
import { peekCatalog } from './catalog'
import { httpFetch } from './http'
import { loadLocalSettings } from './secrets'

const API = 'https://generativelanguage.googleapis.com'
/** 요청 하나에 바로 싣는 파일 크기 합 (base64 로 늘어나도 요청 20MB 안쪽) */
const INLINE_LIMIT = 14 * 1024 * 1024
/** 한 번 읽는 데 기다리는 최대 시간 */
const READ_TIMEOUT = 15 * 60 * 1000

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

interface Session {
  key: string
  model: string
  system: string
  turns: Turn[]
  /** Gemini 파일 저장소에 올린 것 — 끝나면 지운다 */
  uploaded: string[]
  /** 마지막으로 받은 답 */
  last: string
}

let session: Session | null = null
let abort: AbortController | null = null

/* ---------- 파일 고르기 ---------- */

export async function pickFiles(win: BrowserWindow | null): Promise<OcrFile[]> {
  if (!win) return []
  const res = await dialog.showOpenDialog(win, {
    title: '읽을 스캔 문서 고르기',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF · 사진', extensions: Object.keys(OCR_TYPES) }]
  })
  if (res.canceled) return []
  const out: OcrFile[] = []
  for (const p of res.filePaths) {
    const ext = path.extname(p).slice(1).toLowerCase()
    const mime = OCR_TYPES[ext]
    if (!mime) continue
    const size = fs.statSync(p).size
    const id = crypto.randomUUID()
    const name = path.basename(p)
    picked.set(id, { path: p, name, size, mime })
    out.push({ id, name, size, mime })
  }
  // 스캔 파일은 번호를 붙여 나오는 일이 많아 이름 차례로 (2 가 10 보다 먼저)
  return out.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }))
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

async function deleteUploaded(key: string, names: string[]): Promise<void> {
  await Promise.all(
    names.map((n) =>
      httpFetch(`${API}/v1beta/${n}`, { method: 'DELETE', headers: { 'x-goog-api-key': key } }).catch(() => undefined)
    )
  )
}

/** 읽던 것을 끝낸다 — Gemini 에 올려 둔 파일도 지운다 */
export async function clearOcr(): Promise<void> {
  abort?.abort()
  const s = session
  session = null
  if (s?.uploaded.length) await deleteUploaded(s.key, s.uploaded)
}

export function cancelOcr(): void {
  abort?.abort()
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

interface GenOptions {
  thinking: boolean
  media: boolean
}

/** 한 번 묻고 받는 대로 쌓는다 */
async function generate(s: Session, onProgress: (p: OcrProgress) => void, signal: AbortSignal, opts: GenOptions = { thinking: true, media: true }): Promise<OcrAnswer> {
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
    if (res.status === 400 && opts.thinking && /thinking/i.test(txt)) return generate(s, onProgress, signal, { ...opts, thinking: false })
    if (res.status === 400 && opts.media && /media_?resolution/i.test(txt)) return generate(s, onProgress, signal, { ...opts, media: false })
    throw new Error(await describe(new Response(txt, { status: res.status })))
  }
  if (!res.body) throw new Error('Gemini 가 빈 응답을 보냈습니다.')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let text = ''
  let finish = ''
  let blocked = ''
  let usage: OcrAnswer['usage']
  let lastSent = 0
  const report = (force = false): void => {
    const now = Date.now()
    if (!force && now - lastSent < 300) return
    lastSent = now
    const rows = text.split('\n').filter((l) => l.trim().startsWith('|')).length
    onProgress({ phase: 'read', chars: text.length, rows: Math.max(0, rows - 2) })
  }
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
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    // 줄바꿈이 \r\n 이어도 한 가지로 (조각 경계에서 갈라져도 버퍼 전체를 다시 맞춘다)
    buf = (buf + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
    let cut: number
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, cut)
      buf = buf.slice(cut + 2)
      const data = chunk
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('')
      if (data) take(data)
    }
  }
  if (buf.trim().startsWith('data:')) take(buf.trim().slice(5).trim())
  report(true)

  if (blocked) throw new Error(`Gemini 가 이 문서를 읽기를 거절했습니다 (${blocked}).`)
  if (!text.trim()) {
    if (finish === 'RECITATION') throw new Error('Gemini 가 저작권이 있는 글로 판단해 멈췄습니다(RECITATION). 교과서 · 책 본문은 읽지 못할 수 있습니다.')
    if (finish === 'SAFETY') throw new Error('Gemini 가 안전 기준에 걸린다며 멈췄습니다(SAFETY).')
    throw new Error('Gemini 가 빈 답을 보냈습니다. 다시 해 보거나 다른 모델을 골라 주세요.')
  }
  // 표 뒤에 "몇 페이지까지 처리했다" 고 적고 멈춘 경우도 끊긴 것으로 본다
  const tail = text.slice(text.lastIndexOf('|') + 1)
  const truncated = finish === 'MAX_TOKENS' || saysStoppedEarly(tail)
  return { ok: true, text, finish, truncated, usage }
}

/** 고른 파일을 읽는다 (새로 시작) */
export async function runOcr(req: OcrRequest, onProgress: (p: OcrProgress) => void): Promise<OcrAnswer> {
  const fail = (error: string): OcrAnswer => ({ ok: false, text: '', finish: '', truncated: false, error })
  const key = (loadLocalSettings().gemini_key ?? '').trim()
  if (!key) return fail('Gemini API 키가 없습니다. [설정 → AI 연결] 에서 Gemini 키를 넣어 주세요.')
  const files = (Array.isArray(req?.ids) ? req.ids : []).map((id) => picked.get(String(id))).filter((f): f is Picked => !!f)
  if (!files.length) return fail('읽을 파일을 먼저 골라 주세요.')
  for (const f of files) {
    const max = f.mime === 'application/pdf' ? OCR_MAX_PDF : OCR_MAX_IMAGE
    if (f.size > max) return fail(`「${f.name}」 이(가) 너무 큽니다(${fmtBytes(f.size)}). ${f.mime === 'application/pdf' ? 'PDF 는 50MB' : '사진은 20MB'} 까지 읽습니다. 나눠서 읽어 주세요.`)
    if (!fs.existsSync(f.path)) return fail(`「${f.name}」 을(를) 찾을 수 없습니다. 다시 골라 주세요.`)
  }

  await clearOcr()
  const ctrl = new AbortController()
  abort = ctrl
  const timer = setTimeout(() => ctrl.abort(), READ_TIMEOUT)
  // 만든이가 지침 · 기본 모델을 바꿔 두었으면 그것을 (catalog.json 의 "ocr" — 받으러 가지 않고 이 PC 에 둔 것)
  const remote = peekCatalog().ocr
  const model = isGeminiModel(String(req.model ?? '')) ? String(req.model) : remote?.model || OCR_DEFAULT_MODEL
  const s: Session = { key, model, system: `${OCR_RULES}\n\n${remote?.prompt || OCR_AGENT_PROMPT}`, turns: [], uploaded: [], last: '' }
  session = s
  try {
    const parts: Part[] = []
    const total = files.reduce((n, f) => n + f.size, 0)
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
    if (abort === ctrl) abort = null
  }
}

/** 끊긴 답의 나머지를 받는다 */
export async function continueOcr(onProgress: (p: OcrProgress) => void): Promise<OcrAnswer> {
  const fail = (error: string): OcrAnswer => ({ ok: false, text: '', finish: '', truncated: false, error })
  const s = session
  if (!s || !s.last) return fail('이어 받을 결과가 없습니다. 처음부터 다시 읽어 주세요.')
  const ctrl = new AbortController()
  abort = ctrl
  const timer = setTimeout(() => ctrl.abort(), READ_TIMEOUT)
  try {
    const kept = dropPartialTail(s.last)
    const t = extractTables(kept)
    const lastTable = t[t.length - 1]
    const lastRow = lastTable?.rows.length ? `| ${lastTable.rows[lastTable.rows.length - 1].join(' | ')} |` : ''
    s.turns.push({ role: 'model', parts: [{ text: kept }] }, { role: 'user', parts: [{ text: ocrContinueText(lastRow) }] })
    onProgress({ phase: 'wait', chars: 0, rows: 0 })
    const a = await generate(s, onProgress, ctrl.signal)
    s.last = a.text
    return a
  } catch (e) {
    if (ctrl.signal.aborted) return fail('멈췄습니다.')
    return fail(e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
    if (abort === ctrl) abort = null
  }
}

/* ---------- 엑셀로 ---------- */

/** 화면에서 보이는 너비 — 한글 · 한자는 두 칸 */
function widthOf(s: string): number {
  let w = 0
  for (const ch of s) w += /[ᄀ-ᇿ　-〿㄰-㆏一-鿿가-힣＀-￯]/.test(ch) ? 2 : 1
  return w
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
    const widths = header.map((h) => widthOf(h))
    t.rows.forEach((r, ri) => {
      const values = Array.from({ length: width }, (_, j) => plainCell(r[j] ?? ''))
      const row = ws.addRow(values)
      values.forEach((v, j) => (widths[j] = Math.max(widths[j], Math.min(widthOf(v), 80))))
      row.eachCell({ includeEmpty: true }, (c) => {
        c.font = { name: '맑은 고딕', size: 10 }
        c.alignment = { vertical: 'top', wrapText: true }
        c.border = border
        if (ri % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }
      })
    })
    // 열 너비: 내용에 맞추되 너무 넓으면 줄을 바꿔 보이게
    ws.columns.forEach((c, j) => (c.width = Math.max(8, Math.min(60, (widths[j] ?? 8) + 2))))
    // 줄 높이: 긴 글은 몇 줄로 보일지 어림해서
    ws.eachRow((row, rn) => {
      if (rn === 1) return
      let lines = 1
      row.eachCell({ includeEmpty: true }, (c, cn) => {
        const w = Math.max(8, Math.min(60, (widths[cn - 1] ?? 8) + 2))
        const text = String(c.value ?? '')
        lines = Math.max(lines, ...text.split('\n').map((l) => Math.ceil(widthOf(l) / w) || 1))
      })
      row.height = Math.min(409, Math.max(18, lines * 15))
    })
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
