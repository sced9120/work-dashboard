import { AnnotationMode, PDFWorker, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/**
 * PDF 편집 화면에서 쪽을 그리는 곳 (pdf.js).
 *  - 한글 CID 글꼴(파일에 글꼴이 들어 있지 않은 것)도 글자가 나오도록 cMap · 기본 글꼴 자료를 메인에서 받는다.
 *    앱은 file:// 로 열리고 보안 규칙(default-src 'self')이 있어 pdf.js 가 직접 받아 오지 못하기 때문이다.
 *  - 받지 못한 자료가 하나라도 있으면 세어 둔다. 완전 가리기 그림을 만들 때 그 쪽은 저장하지 않는다.
 *  - 쪽 그림 작은 것(목록용)은 몇백 개만 기억하고, 큰 그림은 화면에 보이는 한 쪽만 그린다.
 */

/**
 * pdf.js 일꾼(따로 도는 스레드)은 직접 만들어 넘긴다. 설치한 앱은 file:// 라 pdf.js 에 주소만 주면 blob: 으로 감싸다가
 * 보안 규칙에 막혀 화면 스레드에서 돌고, 큰 PDF 를 여는 동안 창이 멎는다. 문서들이 하나를 함께 쓴다.
 */
let shared: PDFWorker | null = null
function pdfWorker(): PDFWorker {
  if (!shared || shared.destroyed) {
    // pdf.js 의 타입에는 port 가 null 로만 적혀 있다
    shared = new PDFWorker({ port: new Worker(workerUrl, { type: 'module' }) as unknown as null })
  }
  return shared
}

let assetFailures = 0
export const assetFailureCount = (): number => assetFailures

class IpcCMapFactory {
  constructor(_o: unknown) {}
  async fetch({ name }: { name: string }): Promise<{ cMapData: Uint8Array; isCompressed: boolean }> {
    const data = await window.api.pdfedit.asset('cmap', name)
    if (!data) {
      assetFailures++
      throw new Error(`cMap ${name}`)
    }
    return { cMapData: data, isCompressed: true }
  }
}

class IpcFontFactory {
  constructor(_o: unknown) {}
  async fetch({ filename }: { filename: string }): Promise<Uint8Array> {
    const data = await window.api.pdfedit.asset('font', filename)
    if (!data) {
      assetFailures++
      throw new Error(`font ${filename}`)
    }
    return data
  }
}

/** strict: 그리다 틀리는 곳이 있으면 건너뛰지 않고 멈춘다 (완전 가리기 그림용) */
export function openPdf(bytes: Uint8Array, strict = false): Promise<PDFDocumentProxy> {
  return getDocument({
    // pdf.js 는 받은 내용을 일꾼에게 넘기며 비운다 — 사본을 준다
    data: bytes.slice(),
    worker: pdfWorker(),
    CMapReaderFactory: IpcCMapFactory,
    StandardFontDataFactory: IpcFontFactory,
    isEvalSupported: false,
    enableXfa: false,
    stopAtErrors: strict,
    verbosity: 0
  }).promise
}

const docs = new Map<string, Promise<PDFDocumentProxy>>()

export function addDoc(id: string, bytes: Uint8Array): void {
  if (!docs.has(id)) docs.set(id, openPdf(bytes))
}

export function dropDoc(id: string): void {
  const d = docs.get(id)
  docs.delete(id)
  void d?.then((x) => x.destroy()).catch(() => undefined)
  for (const k of [...thumbs.keys()]) if (k.startsWith(`${id}:`)) thumbs.delete(k)
}

export const hasDoc = (id: string): boolean => docs.has(id)

/** 일을 하나씩 — 큰 쪽 여러 개를 한꺼번에 그려 메모리가 튀지 않게 */
let chain: Promise<unknown> = Promise.resolve()
function queue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
}

/**
 * 쪽 하나를 캔버스에 그린다. rotation 은 모든 돌림(파일 + 사용자). 캔버스 크기는 pxW × pxH 로 맞춘다.
 * 주석(입력칸 값 포함)도 함께 그린다.
 */
export async function drawPdfPage(doc: PDFDocumentProxy, index: number, rotation: number, canvas: HTMLCanvasElement, pxW: number, pxH: number): Promise<void> {
  const page = await doc.getPage(index + 1)
  try {
    const base = page.getViewport({ scale: 1, rotation })
    const vp = page.getViewport({ scale: pxW / base.width, rotation })
    canvas.width = pxW
    canvas.height = pxH
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, pxW, pxH)
    await page.render({ canvasContext: ctx, viewport: vp, annotationMode: AnnotationMode.ENABLE }).promise
  } finally {
    page.cleanup()
  }
}

export function renderInto(fileId: string, index: number, rotation: number, canvas: HTMLCanvasElement, pxW: number, pxH: number): Promise<void> {
  const d = docs.get(fileId)
  if (!d) return Promise.reject(new Error('no doc'))
  return queue(async () => drawPdfPage(await d, index, rotation, canvas, pxW, pxH))
}

/* ---------- 목록용 작은 그림 ---------- */

const thumbs = new Map<string, string>()
const THUMB_MAX = 400

export const thumbKey = (fileId: string, index: number, rotation: number): string => `${fileId}:${index}:${rotation}`
export const cachedThumb = (key: string): string | undefined => thumbs.get(key)

export async function thumb(fileId: string, index: number, rotation: number, vw: number, vh: number, width: number): Promise<string> {
  const key = thumbKey(fileId, index, rotation)
  const hit = thumbs.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  const pxW = Math.max(16, Math.round(width))
  await renderInto(fileId, index, rotation, c, pxW, Math.max(16, Math.round((pxW * vh) / vw)))
  const url = c.toDataURL('image/jpeg', 0.82)
  c.width = c.height = 0
  thumbs.set(key, url)
  if (thumbs.size > THUMB_MAX) thumbs.delete(thumbs.keys().next().value as string)
  return url
}
