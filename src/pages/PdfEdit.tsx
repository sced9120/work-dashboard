import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PeKind, PeObj, PeOpen, Rot } from '../../shared/pdfedit'
import { PE_KIND_LABEL, PE_MAX_FILES, PE_MAX_PAGES, moveObj, objToView, resizeObj, viewSize, viewToObj, type Rect } from '../../shared/pdfedit'
import Icon from '../components/Icon'
import { useConfirm } from '../lib/confirm'
import { useToast } from '../lib/toast'
import { cachedThumb, hasDoc, renderInto, thumb, thumbKey } from '../lib/pdfRender'
import { drawDecorations, drawObjects, fontsReady, measureText, normalizeImage, warmWatermarkFont } from '../lib/pdfDraw'
import {
  type EdPage,
  addObj,
  addOpened,
  assets,
  beginChange,
  clearAll,
  deletePages,
  dropPages,
  duplicatePages,
  endChange,
  geomOf,
  getPe,
  hasRedaction,
  insertBlank,
  movePages,
  newKey,
  pageLabel,
  redo,
  removeObj,
  rotatePages,
  save,
  setCurrent,
  setNumbers,
  setPicked,
  setWatermark,
  targets,
  togglePick,
  undo,
  updateObj,
  usePdfEdit
} from '../lib/pdfEditStore'

type Tool = 'select' | Exclude<PeKind, 'image'>

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: '고르기 · 옮기기', hint: '그린 것을 눌러 고르고, 끌어서 옮깁니다. 오른쪽 아래 손잡이로 크기를 바꿉니다.' },
  { id: 'text', label: '글자', hint: '쪽을 누른 곳에 글자를 넣습니다. 아래 칸에서 글을 고쳐 쓰세요.' },
  { id: 'cover', label: '덮고 새로 쓰기', hint: '끌어서 칸을 만들면 흰 칸으로 덮고 그 위에 새 글을 씁니다.' },
  { id: 'highlight', label: '형광펜', hint: '끌어서 칠합니다.' },
  { id: 'rect', label: '네모', hint: '끌어서 네모 테두리를 그립니다.' },
  { id: 'line', label: '선', hint: '끌어서 곧은 선을 긋습니다.' },
  { id: 'pen', label: '펜', hint: '끌면서 자유롭게 그립니다.' },
  { id: 'redact', label: '완전 가리기', hint: '끌어서 가릴 곳을 칠합니다. 저장하면 그 안의 글 · 그림이 파일에서 완전히 지워집니다.' }
]

const hasFiles = (e: React.DragEvent): boolean => [...e.dataTransfer.types].includes('Files')
const PAGE_DRAG = 'application/x-pe-page'
const isTyping = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/** 도구 · 색은 화면을 떠났다 와도 그대로 */
const prefs = { tool: 'select' as Tool, textColor: '#111111', lineColor: '#e03131', hlColor: '#ffe14d', size: 14, width: 2, zoom: 1 }

/**
 * PDF 편집 — 여러 PDF 를 합치고, 쪽을 정리하고, 글 · 그림 · 서명을 더한다.
 * 원본은 그대로 두고 늘 새 파일로 저장한다. 이 PC 안에서만 한다.
 */
export default function PdfEdit(): JSX.Element {
  const s = usePdfEdit()
  const toast = useToast()
  const ask = useConfirm()
  const [over, setOver] = useState(0)

  const take = useCallback(
    (o: PeOpen | null): void => {
      if (!o) return
      const msgs = addOpened(o)
      if (o.files.length) toast(`PDF ${o.files.length}개를 열었습니다.`, 'ok')
      msgs.slice(0, 3).forEach((m) => toast(m, 'err'))
    },
    [toast]
  )
  const pick = (): void => void window.api.pdfedit.pick().then(take)

  // 되돌리기 · 다시 하기 글쇠 (글을 쓰는 칸에서는 그 칸의 되돌리기)
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (isTyping(e.target) || !(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const onDrop = (e: React.DragEvent): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    setOver(0)
    if (s.busy) return
    const files = [...e.dataTransfer.files]
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name)).map((f) => window.api.files.pathOf(f)).filter(Boolean)
    if (pdfs.length) void window.api.pdfedit.add(pdfs).then(take)
    else if (files.some((f) => /\.(png|jpe?g)$/i.test(f.name))) toast(s.pages.length ? '그림은 크게 보는 쪽 위에 끌어 놓아 주세요.' : '먼저 PDF 를 열어 주세요.')
    else if (files.length) toast('PDF 파일을 끌어 놓아 주세요.', 'err')
  }

  const clear = async (): Promise<void> => {
    const okk = await ask({
      title: '목록을 비울까요?',
      body: '열어 둔 PDF 와 쪽 정리 · 그린 것을 모두 비웁니다. 저장하지 않은 편집은 사라지고 되돌릴 수 없습니다.\n원본 파일은 그대로 있습니다.',
      okText: '비우기',
      danger: true
    })
    if (okk) clearAll()
  }

  const total = s.pages.length
  return (
    <div
      className={`pe ${over > 0 ? 'over' : ''}`}
      data-drop=""
      onDragEnter={(e) => hasFiles(e) && setOver((n) => n + 1)}
      onDragLeave={(e) => hasFiles(e) && setOver((n) => Math.max(0, n - 1))}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDropCapture={() => setOver(0)}
      onDrop={onDrop}
    >
      <div className="page-head">
        <h1>PDF 편집</h1>
        <p>
          여러 PDF 를 합치고, 쪽을 정리하고, 글 · 서명 · 도장을 더합니다. <b>이 PC 안에서만</b> 하고, 원본은 그대로 둔 채 <b>늘 새 파일</b>로 저장합니다.
        </p>
      </div>

      {total === 0 ? (
        <div className="card pe-empty">
          <div className="card-title">
            <span>PDF 열기</span>
          </div>
          <div className="row">
            <button className="btn btn-primary" onClick={pick}>
              PDF 열기
            </button>
          </div>
          <div className="ocr-drop-hint">
            편집할 PDF 를 고르거나 여기에 <b>끌어 놓으세요</b>. 여러 개를 열면 차례대로 이어 붙습니다(합치기).
            <br />
            암호가 걸린 PDF 는 열 수 없습니다. 한 번에 {PE_MAX_FILES}개 파일 · {PE_MAX_PAGES}쪽까지 다룹니다.
          </div>
        </div>
      ) : (
        <>
          <div className="card pe-bar" role="toolbar" aria-label="편집 도구 줄">
            <button className="btn btn-sm" onClick={pick} disabled={s.busy}>
              <Icon name="plus" size={14} /> PDF 더 넣기
            </button>
            <button className="btn btn-sm" onClick={undo} disabled={!s.past.length || s.busy} title="Ctrl+Z">
              되돌리기
            </button>
            <button className="btn btn-sm" onClick={redo} disabled={!s.future.length || s.busy} title="Ctrl+Y">
              다시 하기
            </button>
            <span className="pe-grow" />
            <span className="badge">
              PDF {s.files.length}개 · {total}쪽
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => void clear()} disabled={s.busy}>
              목록 비우기
            </button>
          </div>
          <div className="pe-main">
            <PageList />
            <Editor />
          </div>
          <DocOptions />
          <SaveCard />
        </>
      )}
    </div>
  )
}

/* ---------- 쪽 목록 ---------- */

function PageList(): JSX.Element {
  const s = usePdfEdit()
  const toast = useToast()
  const [dropAt, setDropAt] = useState<{ key: string | null; after: boolean } | null>(null)
  const anchor = useRef<string | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const t = s.picked.length ? s.picked : s.current ? [s.current] : []
  const n = t.length
  const busy = s.busy

  const click = (e: React.MouseEvent, key: string): void => {
    if (e.shiftKey && anchor.current) {
      const a = s.pages.findIndex((p) => p.key === anchor.current)
      const b = s.pages.findIndex((p) => p.key === key)
      const [lo, hi] = a < b ? [a, b] : [b, a]
      setPicked(s.pages.slice(lo, hi + 1).map((p) => p.key))
    } else if (e.ctrlKey || e.metaKey) {
      togglePick(key)
      anchor.current = key
    } else {
      anchor.current = key
    }
    setCurrent(key)
  }

  const focusKey = (key: string): void => {
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)?.focus())
  }
  const keyNav = (e: React.KeyboardEvent, i: number): void => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const dir = e.key === 'ArrowUp' ? -1 : 1
    const key = s.pages[i].key
    if (e.altKey) {
      movePages(getPe().picked.includes(key) ? getPe().picked : [key], dir)
      focusKey(key)
      return
    }
    const next = s.pages[i + dir]
    if (next) {
      setCurrent(next.key)
      focusKey(next.key)
    }
  }

  const del = (): void => {
    const keys = targets()
    if (!keys.length) return
    if (keys.length >= s.pages.length) return toast('모든 쪽을 지울 수는 없습니다. [목록 비우기]를 쓰세요.', 'err')
    deletePages(keys)
    toast(`${keys.length}쪽을 지웠습니다. [되돌리기]로 살릴 수 있습니다.`)
  }

  const dragStart = (e: React.DragEvent, key: string): void => {
    const keys = getPe().picked.includes(key) ? getPe().picked : [key]
    e.dataTransfer.setData(PAGE_DRAG, JSON.stringify(keys))
    e.dataTransfer.effectAllowed = 'move'
  }
  const dragOver = (e: React.DragEvent, key: string): void => {
    if (![...e.dataTransfer.types].includes(PAGE_DRAG)) return
    e.preventDefault()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setDropAt({ key, after: e.clientY > r.top + r.height / 2 })
  }
  const drop = (e: React.DragEvent): void => {
    const raw = e.dataTransfer.getData(PAGE_DRAG)
    // 놓은 자리는 놓는 순간의 칸에서 다시 잰다
    const li = (e.target as HTMLElement).closest<HTMLElement>('.pe-thumb')
    const key = li?.querySelector<HTMLElement>('[data-key]')?.dataset.key
    setDropAt(null)
    if (!raw || !li || !key) return
    e.preventDefault()
    e.stopPropagation()
    const keys = JSON.parse(raw) as string[]
    const r = li.getBoundingClientRect()
    const after = e.clientY > r.top + r.height / 2
    const i = s.pages.findIndex((p) => p.key === key)
    const before = after ? (s.pages.slice(i + 1).find((p) => !keys.includes(p.key))?.key ?? null) : key
    dropPages(keys, before)
    setDropAt(null)
  }

  return (
    <div className="card pe-pages">
      <div className="pe-pages-head">
        <b>쪽</b>
        <span className="small muted">{s.picked.length ? `${s.picked.length}쪽 고름` : '끌어서 차례 바꾸기'}</span>
      </div>
      <div className="pe-page-tools" role="group" aria-label={n > 1 ? `고른 ${n}쪽에 할 일` : '이 쪽에 할 일'}>
        <button className="btn btn-sm" onClick={() => movePages(targets(), -1)} disabled={busy || !n} aria-label="앞으로 옮기기">
          ↑ 앞으로
        </button>
        <button className="btn btn-sm" onClick={() => movePages(targets(), 1)} disabled={busy || !n} aria-label="뒤로 옮기기">
          ↓ 뒤로
        </button>
        <button className="btn btn-sm" onClick={() => rotatePages(targets(), -90)} disabled={busy || !n} aria-label="왼쪽으로 돌리기">
          ↺ 왼쪽
        </button>
        <button className="btn btn-sm" onClick={() => rotatePages(targets(), 90)} disabled={busy || !n} aria-label="오른쪽으로 돌리기">
          ↻ 오른쪽
        </button>
        <button className="btn btn-sm" onClick={() => duplicatePages(targets())} disabled={busy || !n}>
          복제
        </button>
        <button className="btn btn-sm" onClick={() => insertBlank(s.current)} disabled={busy}>
          빈 쪽 넣기
        </button>
        <button className="btn btn-sm pe-danger" onClick={del} disabled={busy || !n}>
          지우기
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setPicked(s.picked.length ? [] : s.pages.map((p) => p.key))} disabled={busy}>
          {s.picked.length ? '고르기 풀기' : '모두 고르기'}
        </button>
      </div>
      <ol className="pe-thumbs" ref={listRef} onDrop={drop} onDragLeave={(e) => e.currentTarget === e.target && setDropAt(null)}>
        {s.pages.map((p, i) => (
          <li
            key={p.key}
            className={`pe-thumb ${p.key === s.current ? 'cur' : ''} ${s.picked.includes(p.key) ? 'picked' : ''} ${dropAt?.key === p.key ? (dropAt.after ? 'drop-after' : 'drop-before') : ''}`}
            draggable={!busy}
            onDragStart={(e) => dragStart(e, p.key)}
            onDragOver={(e) => dragOver(e, p.key)}
            onDragEnd={() => setDropAt(null)}
          >
            <button
              className="pe-thumb-btn"
              data-key={p.key}
              aria-pressed={p.key === s.current}
              aria-label={`${i + 1}쪽 — ${pageLabel(p)}${p.objs.length ? `, 그린 것 ${p.objs.length}개` : ''}`}
              title="Ctrl · Shift 를 누르고 누르면 여러 쪽을 고릅니다. Alt+↑↓ 로 옮깁니다."
              onClick={(e) => click(e, p.key)}
              onKeyDown={(e) => keyNav(e, i)}
            >
              <Thumb page={p} />
              <span className="pe-thumb-no">{i + 1}</span>
              {p.objs.some((o) => o.kind === 'redact') ? <span className="pe-thumb-tag dark">가림</span> : p.objs.length > 0 && <span className="pe-thumb-tag">그림 {p.objs.length}</span>}
            </button>
            <label className="pe-thumb-pick">
              <input type="checkbox" checked={s.picked.includes(p.key)} onChange={() => togglePick(p.key)} aria-label={`${i + 1}쪽 고르기`} />
            </label>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** 보일 때만 그리는 작은 그림 */
function Thumb({ page }: { page: EdPage }): JSX.Element {
  const g = geomOf(page)
  const [vw, vh] = viewSize(g.w, g.h, g.total)
  const key = page.file ? thumbKey(page.file, page.index!, g.total) : ''
  const [url, setUrl] = useState(() => (key ? (cachedThumb(key) ?? '') : ''))
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!page.file) return
    const hit = cachedThumb(key)
    if (hit) return setUrl(hit)
    setUrl('')
    let alive = true
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (es) => {
        if (!es.some((x) => x.isIntersecting)) return
        io.disconnect()
        if (!hasDoc(page.file!)) return
        void thumb(page.file!, page.index!, g.total, vw, vh, 150 * Math.min(2, window.devicePixelRatio || 1))
          .then((u) => alive && setUrl(u))
          .catch(() => undefined)
      },
      { rootMargin: '200px' }
    )
    io.observe(el)
    return () => {
      alive = false
      io.disconnect()
    }
  }, [key, page.file, page.index, g.total, vw, vh])
  return (
    <span ref={ref} className="pe-thumb-img" style={{ aspectRatio: `${vw} / ${vh}` }}>
      {url ? <img src={url} alt="" draggable={false} /> : page.blank ? null : <span className="pe-thumb-wait" aria-hidden="true" />}
    </span>
  )
}

/* ---------- 크게 보기 · 그리기 ---------- */

type Drag =
  | { mode: 'move'; id: string; from: [number, number]; orig: PeObj }
  | { mode: 'resize'; id: string; from: [number, number]; orig: PeObj; view: Rect }
  | { mode: 'box'; kind: Tool; from: [number, number]; to: [number, number] }
  | { mode: 'pen'; pts: [number, number][] }

function Editor(): JSX.Element {
  const s = usePdfEdit()
  const toast = useToast()
  const [tool, setToolState] = useState<Tool>(prefs.tool)
  const [sel, setSel] = useState<string | null>(null)
  const [style, setStyle] = useState({ textColor: prefs.textColor, lineColor: prefs.lineColor, hlColor: prefs.hlColor, size: prefs.size, width: prefs.width })
  const [zoom, setZoomState] = useState(prefs.zoom)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [focusText, setFocusText] = useState(0)
  const setTool = (t: Tool): void => {
    prefs.tool = t
    setToolState(t)
  }
  const setZoom = (z: number): void => {
    prefs.zoom = Math.min(3, Math.max(0.4, Math.round(z * 10) / 10))
    setZoomState(prefs.zoom)
  }
  const patchStyle = (p: Partial<typeof style>): void => {
    Object.assign(prefs, p)
    setStyle((x) => ({ ...x, ...p }))
  }

  const idx = s.pages.findIndex((p) => p.key === s.current)
  const page = idx >= 0 ? s.pages[idx] : null
  const obj = page?.objs.find((o) => o.id === sel) ?? null
  useEffect(() => {
    if (sel && !obj) setSel(null)
  }, [sel, obj])
  useEffect(() => setSel(null), [s.current])
  useEffect(() => {
    if (!focusText) return
    textRef.current?.focus()
    textRef.current?.select()
  }, [focusText])

  const go = (d: number): void => {
    const p = s.pages[idx + d]
    if (p) setCurrent(p.key)
  }

  const insertImage = async (bytes: Uint8Array): Promise<void> => {
    if (!page) return
    let a
    try {
      a = await normalizeImage(bytes)
    } catch {
      return toast('그림을 읽지 못했습니다. PNG · JPG 인지 확인해 주세요.', 'err')
    }
    const id = newKey('a')
    assets.set(id, a)
    const g = geomOf(page)
    const [vw, vh] = viewSize(g.w, g.h, g.total)
    const w = Math.min(vw * 0.35, (vh * 0.35 * a.w) / a.h)
    const h = (w * a.h) / a.w
    const o: PeObj = { id: newKey('o'), kind: 'image', ...viewToObj({ x: (vw - w) / 2, y: (vh - h) / 2, w, h }, g.w, g.h, g.total), turn: g.total, asset: id }
    addObj(page.key, o)
    setSel(o.id)
    setTool('select')
  }
  const pickImage = async (): Promise<void> => {
    const r = await window.api.pdfedit.pickImage()
    if (!r) return
    if (!r.ok || !r.bytes) return toast(r.error ?? '그림을 읽지 못했습니다.', 'err')
    await insertImage(r.bytes)
  }

  const redacting = tool === 'redact' || hasRedaction()
  return (
    <div className="card pe-editor">
      <div className="pe-tools" role="toolbar" aria-label="그리기 도구">
        {TOOLS.map((t) => (
          <button key={t.id} className={`btn btn-sm pe-tool ${tool === t.id ? 'on' : ''} ${t.id === 'redact' ? 'pe-tool-redact' : ''}`} aria-pressed={tool === t.id} onClick={() => setTool(t.id)} title={t.hint} disabled={s.busy}>
            {t.label}
          </button>
        ))}
        <button className="btn btn-sm pe-tool" onClick={() => void pickImage()} disabled={s.busy || !page} title="서명 · 도장 같은 PNG · JPG 그림을 넣습니다. 그림 파일을 쪽에 끌어 놓아도 됩니다.">
          <Icon name="image" size={14} /> 그림 넣기
        </button>
      </div>
      <div className="pe-tool-hint small muted" aria-live="polite">
        {TOOLS.find((t) => t.id === tool)?.hint}
      </div>
      {tool === 'cover' && (
        <div className="note note-warn small pe-note">
          <b>덮고 새로 쓰기는 가려서 안 보이게 할 뿐입니다.</b> 원래 글은 파일 속에 그대로 남아 복사 · 글 찾기로 나올 수 있습니다. 개인정보는 [완전 가리기]를 쓰세요.
        </div>
      )}
      {redacting && (
        <div className="note note-info small pe-note">
          <b>완전 가리기</b>가 있으면 저장할 때 <b>모든 쪽을 그림으로</b> 바꿔, 가린 곳의 글 · 그림을 새 파일에서 완전히 지웁니다. 그 대신 새 파일에서는 글자를 고르거나 찾을 수 없고 파일이 커질 수 있습니다.
        </div>
      )}

      <div className="pe-view-bar">
        <button className="btn btn-sm" onClick={() => go(-1)} disabled={idx <= 0} aria-label="이전 쪽">
          ‹
        </button>
        <span className="pe-view-no">
          {idx + 1} / {s.pages.length}쪽
        </span>
        <button className="btn btn-sm" onClick={() => go(1)} disabled={idx < 0 || idx >= s.pages.length - 1} aria-label="다음 쪽">
          ›
        </button>
        <span className="small muted pe-view-src">{page ? pageLabel(page) : ''}</span>
        <span className="pe-grow" />
        <button className="btn btn-sm" onClick={() => setZoom(zoom - 0.2)} aria-label="작게 보기" disabled={zoom <= 0.4}>
          −
        </button>
        <button className="btn btn-sm" onClick={() => setZoom(1)} aria-label="쪽 전체 보기">
          {Math.round(zoom * 100)}%
        </button>
        <button className="btn btn-sm" onClick={() => setZoom(zoom + 0.2)} aria-label="크게 보기" disabled={zoom >= 3}>
          +
        </button>
      </div>

      {page && (
        <PageView
          page={page}
          pageNo={idx}
          tool={tool}
          style={style}
          sel={sel}
          zoom={zoom}
          onSel={setSel}
          onTextMade={() => setFocusText((n) => n + 1)}
          onImage={insertImage}
          onToolDone={() => tool === 'text' && setTool('select')}
        />
      )}

      {page && (
        <ObjPanel
          page={page}
          obj={obj}
          tool={tool}
          style={style}
          onStyle={patchStyle}
          onSel={setSel}
          textRef={textRef}
          busy={s.busy}
        />
      )}
      <div className="small muted pe-foot">이미 있는 글을 그 자리에서 고쳐 쓸 수는 없습니다. 고칠 곳은 [덮고 새로 쓰기]로 덮은 뒤 새로 쓰세요.</div>
    </div>
  )
}

interface ViewProps {
  page: EdPage
  pageNo: number
  tool: Tool
  style: { textColor: string; lineColor: string; hlColor: string; size: number; width: number }
  sel: string | null
  zoom: number
  onSel: (id: string | null) => void
  onTextMade: () => void
  onImage: (bytes: Uint8Array) => Promise<void>
  onToolDone: () => void
}

/** 글에 꼭 맞는 틀 — 보기의 왼쪽 위를 그대로 두고 */
function fitText(o: PeObj, w: number, h: number, r: Rot): PeObj {
  const m = measureText(o.text || ' ', o.size ?? 12)
  const v = objToView(o, w, h, r)
  const odd = (((r - (o.turn ?? 0)) % 180) + 180) % 180 === 90
  const [vw, vh] = odd ? [m.h, m.w] : [m.w, m.h]
  return { ...o, ...viewToObj({ x: v.x, y: v.y, w: vw, h: vh }, w, h, r) }
}

function PageView({ page, pageNo, tool, style, sel, zoom, onSel, onTextMade, onImage, onToolDone }: ViewProps): JSX.Element {
  const s = usePdfEdit()
  const g = geomOf(page)
  const R = g.total
  const [vw, vh] = viewSize(g.w, g.h, R)
  const wrap = useRef<HTMLDivElement>(null)
  const base = useRef<HTMLCanvasElement>(null)
  const top = useRef<HTMLCanvasElement>(null)
  const [fit, setFit] = useState(600)
  const [failed, setFailed] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [fontTick, setFontTick] = useState(0)

  const [availH, setAvailH] = useState(600)
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = (): void => {
      setFit(Math.max(200, el.clientWidth - 4))
      setAvailH(Math.max(320, window.innerHeight - 250))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    measure()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // 100% = 쪽 전체가 한눈에 (너비 · 높이 가운데 작은 쪽에 맞춤). 크게 보면 칸 안에서 밀어 본다
  const cssW = Math.round(Math.min(fit, (availH * vw) / vh) * zoom)
  const cssH = Math.round((cssW * vh) / vw)
  const k = cssW / vw
  const dpr = Math.min(3, window.devicePixelRatio || 1)

  // 쪽 그림 — 크기가 바뀌면 잠깐 기다렸다 다시 그린다
  useEffect(() => {
    const c = base.current
    if (!c) return
    let alive = true
    setFailed(false)
    const pxW = Math.round(cssW * dpr)
    const pxH = Math.round(cssH * dpr)
    const t = setTimeout(() => {
      if (!page.file) {
        c.width = pxW
        c.height = pxH
        const ctx = c.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, pxW, pxH)
        return
      }
      const tmp = document.createElement('canvas')
      renderInto(page.file, page.index!, R, tmp, pxW, pxH)
        .then(() => {
          if (!alive) return
          c.width = pxW
          c.height = pxH
          c.getContext('2d')!.drawImage(tmp, 0, 0)
        })
        .catch(() => alive && setFailed(true))
        .finally(() => {
          tmp.width = tmp.height = 0
        })
    }, 80)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [page.file, page.index, page.blank, R, cssW, cssH, dpr])

  // 글꼴이 늦게 오면 다시 그린다
  useEffect(() => {
    let alive = true
    void Promise.all([fontsReady(page.objs), warmWatermarkFont(s.wmOn ? s.watermark : null)]).then(() => alive && setFontTick((n) => n + 1))
    return () => {
      alive = false
    }
  }, [page.objs, s.wmOn, s.watermark])

  // 그린 것 · 쪽 번호 · 워터마크
  useEffect(() => {
    const c = top.current
    if (!c) return
    c.width = Math.round(cssW * dpr)
    c.height = Math.round(cssH * dpr)
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    let objs = page.objs
    if (drag?.mode === 'pen' && drag.pts.length > 1) {
      objs = [...objs, { id: '_pen', kind: 'pen', x: 0, y: 0, w: 0, h: 0, color: style.lineColor, width: style.width, pts: drag.pts.map(([x, y]) => toPage(x, y)) }]
    }
    drawObjects(ctx, objs, g.w, g.h, R, k * dpr, assets)
    drawDecorations(ctx, g.w, g.h, R, k * dpr, pageNo, s.pages.length, s.numbersOn ? s.numbers : null, s.wmOn && s.watermark.text.trim() ? s.watermark : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.objs, cssW, cssH, dpr, R, g.w, g.h, drag, fontTick, s.numbersOn, s.numbers, s.wmOn, s.watermark, s.pages.length, pageNo])

  const toPage = (x: number, y: number): [number, number] => {
    const r = viewToObj({ x, y, w: 0, h: 0 }, g.w, g.h, R)
    return [r.x, r.y]
  }
  const at = (e: React.PointerEvent | React.DragEvent): [number, number] => {
    const r = top.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / k, (e.clientY - r.top) / k]
  }

  /** 누른 곳의 맨 위 그린 것 */
  const hit = (x: number, y: number): PeObj | null => {
    const list = [...page.objs.filter((o) => o.kind !== 'redact'), ...page.objs.filter((o) => o.kind === 'redact')].reverse()
    const tol = 6 / k
    for (const o of list) {
      if (o.kind === 'line' || o.kind === 'pen') {
        const pts = (o.pts ?? []).map(([px, py]) => objToView({ x: px, y: py, w: 0, h: 0 }, g.w, g.h, R))
        for (let i = 1; i < pts.length; i++) if (segDist(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= tol + (o.width ?? 2) / 2) return o
        continue
      }
      const v = objToView(o, g.w, g.h, R)
      if (x >= v.x - tol && x <= v.x + v.w + tol && y >= v.y - tol && y <= v.y + v.h + tol) return o
    }
    return null
  }

  const down = (e: React.PointerEvent): void => {
    if (e.button !== 0 || s.busy) return
    const [x, y] = at(e)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const handle = (e.target as HTMLElement).dataset.handle
    const selected = page.objs.find((o) => o.id === sel)
    if (handle && selected) {
      beginChange()
      setDrag({ mode: 'resize', id: selected.id, from: [x, y], orig: selected, view: objToView(selected, g.w, g.h, R) })
      return
    }
    const h = hit(x, y)
    if (tool === 'select' || (h && h.id === sel)) {
      onSel(h?.id ?? null)
      if (h) {
        beginChange()
        setDrag({ mode: 'move', id: h.id, from: [x, y], orig: h })
      }
      return
    }
    if (tool === 'text' && h?.kind === 'text') {
      onSel(h.id)
      onTextMade()
      return
    }
    if (tool === 'pen') return setDrag({ mode: 'pen', pts: [[x, y]] })
    setDrag({ mode: 'box', kind: tool, from: [x, y], to: [x, y] })
  }

  const move = (e: React.PointerEvent): void => {
    if (!drag) return
    const [x, y] = at(e)
    if (drag.mode === 'pen') {
      const last = drag.pts[drag.pts.length - 1]
      if (Math.hypot(x - last[0], y - last[1]) * k >= 1.5 && drag.pts.length < 5000) setDrag({ mode: 'pen', pts: [...drag.pts, [x, y]] })
      return
    }
    if (drag.mode === 'box') return setDrag({ ...drag, to: [x, y] })
    if (drag.mode === 'move') {
      const a = toPage(...drag.from)
      const b = toPage(x, y)
      updateObj(page.key, drag.id, moveObj(drag.orig, b[0] - a[0], b[1] - a[1]), false)
      return
    }
    // 크기 바꾸기 — 글 · 그림은 모양을 지킨다
    const v = drag.view
    const o = drag.orig
    let nw = Math.max(6, v.w + x - drag.from[0])
    let nh = Math.max(o.kind === 'line' || o.kind === 'pen' ? 0 : 6, v.h + y - drag.from[1])
    if (o.kind === 'text' || o.kind === 'image') {
      const sc = Math.max(nw / Math.max(v.w, 1e-6), nh / Math.max(v.h, 1e-6), 0.1)
      nw = v.w * sc
      nh = v.h * sc
      if (o.kind === 'text') {
        updateObj(page.key, o.id, fitText({ ...o, size: Math.min(200, Math.max(4, Math.round((o.size ?? 12) * sc * 2) / 2)) }, g.w, g.h, R), false)
        return
      }
    }
    if ((o.kind === 'line' || o.kind === 'pen') && v.h < 1e-6) nh = 0
    updateObj(page.key, o.id, resizeObj(o, viewToObj({ x: v.x, y: v.y, w: nw, h: nh }, g.w, g.h, R)), false)
  }

  const up = (): void => {
    const d = drag
    setDrag(null)
    if (!d) return
    if (d.mode === 'move' || d.mode === 'resize') return endChange()
    if (d.mode === 'pen') {
      if (d.pts.length < 2) return
      const o: PeObj = { id: newKey('o'), kind: 'pen', x: 0, y: 0, w: 0, h: 0, color: style.lineColor, width: style.width, pts: d.pts.map(([x, y]) => toPage(x, y)) }
      addObj(page.key, fitPtsLocal(o))
      return
    }
    const [x0, y0] = d.from
    const [x1, y1] = d.to
    const small = Math.abs(x1 - x0) < 4 && Math.abs(y1 - y0) < 4
    const id = newKey('o')
    if (d.kind === 'text') {
      const o = fitText({ id, kind: 'text', ...viewToObj({ x: x0, y: y0, w: 1, h: 1 }, g.w, g.h, R), turn: R, text: '글자', size: style.size, color: style.textColor }, g.w, g.h, R)
      addObj(page.key, o)
      onSel(id)
      onTextMade()
      onToolDone()
      return
    }
    if (d.kind === 'line') {
      if (small) return
      const o: PeObj = { id, kind: 'line', x: 0, y: 0, w: 0, h: 0, color: style.lineColor, width: style.width, pts: [toPage(x0, y0), toPage(x1, y1)] }
      addObj(page.key, fitPtsLocal(o))
      onSel(id)
      return
    }
    const box = small
      ? { x: x0 - 60, y: y0 - 12, w: 120, h: 24 }
      : { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
    const r = viewToObj(box, g.w, g.h, R)
    const kind = d.kind as PeKind
    const o: PeObj =
      kind === 'cover'
        ? { id, kind, ...r, turn: R, text: '', size: style.size, color: style.textColor, fill: '#ffffff' }
        : kind === 'highlight'
          ? { id, kind, ...r, color: style.hlColor }
          : kind === 'rect'
            ? { id, kind, ...r, color: style.lineColor, width: style.width }
            : { id, kind: 'redact', ...r }
    addObj(page.key, o)
    onSel(id)
    if (kind === 'cover') onTextMade()
  }

  const key = (e: React.KeyboardEvent): void => {
    const o = page.objs.find((x) => x.id === sel)
    if (!o) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      removeObj(page.key, o.id)
      onSel(null)
    } else if (e.key === 'Escape') onSel(null)
    else if (e.key === '+' || e.key === '=' || e.key === '-') {
      // 글쇠로 크기 바꾸기 (손잡이를 끌 수 없을 때)
      e.preventDefault()
      const sc = e.key === '-' ? 1 / 1.1 : 1.1
      if (o.kind === 'text') {
        updateObj(page.key, o.id, fitText({ ...o, size: Math.min(200, Math.max(4, Math.round((o.size ?? 12) * sc * 2) / 2)) }, g.w, g.h, R))
      } else {
        const v = objToView(o, g.w, g.h, R)
        updateObj(page.key, o.id, resizeObj(o, viewToObj({ x: v.x, y: v.y, w: Math.max(4, v.w * sc), h: v.h < 1e-6 ? 0 : Math.max(4, v.h * sc) }, g.w, g.h, R)))
      }
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      const a = toPage(0, 0)
      const b = toPage(dx, dy)
      updateObj(page.key, o.id, moveObj(o, b[0] - a[0], b[1] - a[1]))
    }
  }

  const fileDrop = (e: React.DragEvent): void => {
    const img = [...e.dataTransfer.files].find((f) => /\.(png|jpe?g)$/i.test(f.name))
    if (!img) return
    e.preventDefault()
    e.stopPropagation()
    if (img.size > 20 * 1024 * 1024) return
    void img.arrayBuffer().then((b) => onImage(new Uint8Array(b)))
  }

  const selObj = page.objs.find((o) => o.id === sel)
  const sv = selObj ? objToView(selObj, g.w, g.h, R) : null
  const box = drag?.mode === 'box' && drag.kind !== 'text' && drag.kind !== 'line' ? { x: Math.min(drag.from[0], drag.to[0]), y: Math.min(drag.from[1], drag.to[1]), w: Math.abs(drag.to[0] - drag.from[0]), h: Math.abs(drag.to[1] - drag.from[1]) } : null
  const lineGhost = drag?.mode === 'box' && drag.kind === 'line' ? drag : null

  return (
    <div className="pe-view-wrap" ref={wrap}>
      <div
        className={`pe-view tool-${tool}`}
        style={{ width: cssW, height: cssH }}
        tabIndex={0}
        role="application"
        aria-label={`${pageNo + 1}쪽 크게 보기. 그린 것을 고른 뒤 화살표로 옮기고, + · − 로 크기를 바꾸고, Delete 로 지웁니다.`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        onDragOver={(e) => hasFiles(e) && e.preventDefault()}
        onDrop={fileDrop}
      >
        <canvas ref={base} className="pe-canvas" style={{ width: cssW, height: cssH }} aria-hidden="true" />
        <canvas ref={top} className="pe-canvas pe-top" style={{ width: cssW, height: cssH }} aria-hidden="true" />
        {failed && <div className="pe-fail">이 쪽을 그리지 못했습니다. 손상된 쪽일 수 있습니다.</div>}
        {sv && (
          <div className={`pe-sel ${selObj?.kind === 'redact' ? 'dark' : ''}`} style={{ left: sv.x * k - 3, top: sv.y * k - 3, width: sv.w * k + 6, height: sv.h * k + 6 }}>
            <span className="pe-handle" data-handle="1" aria-hidden="true" />
          </div>
        )}
        {box && <div className={`pe-ghost ${drag?.mode === 'box' && drag.kind === 'redact' ? 'dark' : ''}`} style={{ left: box.x * k, top: box.y * k, width: box.w * k, height: box.h * k }} />}
        {lineGhost && (
          <svg className="pe-ghost-line" width={cssW} height={cssH} aria-hidden="true">
            <line x1={lineGhost.from[0] * k} y1={lineGhost.from[1] * k} x2={lineGhost.to[0] * k} y2={lineGhost.to[1] * k} />
          </svg>
        )}
      </div>
    </div>
  )
}

function fitPtsLocal(o: PeObj): PeObj {
  const xs = o.pts!.map((p) => p[0])
  const ys = o.pts!.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { ...o, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l = dx * dx + dy * dy
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

/* ---------- 고른 것 · 도구 설정 ---------- */

interface PanelProps {
  page: EdPage
  obj: PeObj | null
  tool: Tool
  style: ViewProps['style']
  onStyle: (p: Partial<ViewProps['style']>) => void
  onSel: (id: string | null) => void
  textRef: React.RefObject<HTMLTextAreaElement>
  busy: boolean
}

function ObjPanel({ page, obj, tool, style, onStyle, onSel, textRef, busy }: PanelProps): JSX.Element {
  const g = geomOf(page)
  const editing = useRef(false)
  const upd = (patch: Partial<PeObj>, refit = false): void => {
    if (!obj) return
    updateObj(page.key, obj.id, (o) => {
      const n = { ...o, ...patch }
      return refit && n.kind === 'text' ? fitText(n, g.w, g.h, g.total) : n
    })
  }
  const typing = (text: string): void => {
    if (!obj) return
    if (!editing.current) {
      editing.current = true
      beginChange()
    }
    updateObj(page.key, obj.id, (o) => (o.kind === 'text' ? fitText({ ...o, text }, g.w, g.h, g.total) : { ...o, text }), false)
  }
  const doneTyping = (): void => {
    if (!editing.current) return
    editing.current = false
    endChange()
    // 글을 다 지운 글자는 없앤다
    if (obj?.kind === 'text' && !obj.text?.trim()) {
      removeObj(page.key, obj.id)
      onSel(null)
    }
  }
  const list = page.objs
  const usesText = obj ? obj.kind === 'text' || obj.kind === 'cover' : tool === 'text' || tool === 'cover'
  const usesLine = obj ? obj.kind === 'rect' || obj.kind === 'line' || obj.kind === 'pen' : tool === 'rect' || tool === 'line' || tool === 'pen'
  const usesHl = obj ? obj.kind === 'highlight' : tool === 'highlight'

  return (
    <div className="pe-panel">
      <div className="pe-panel-row">
        <label className="pe-field">
          <span>그린 것</span>
          <select value={obj?.id ?? ''} onChange={(e) => onSel(e.target.value || null)} disabled={!list.length}>
            <option value="">{list.length ? `고르지 않음 (${list.length}개)` : '없음'}</option>
            {list.map((o, i) => (
              <option key={o.id} value={o.id}>
                {i + 1}. {PE_KIND_LABEL[o.kind]}
                {o.text ? ` — ${o.text.slice(0, 14)}` : ''}
              </option>
            ))}
          </select>
        </label>
        {usesText && (
          <>
            <label className="pe-field pe-num">
              <span>글자 크기</span>
              <input
                type="number"
                min={4}
                max={200}
                value={obj?.size ?? style.size}
                onChange={(e) => {
                  const v = Math.min(200, Math.max(4, Number(e.target.value) || 12))
                  if (obj) upd({ size: v }, true)
                  else onStyle({ size: v })
                }}
              />
            </label>
            <label className="pe-field pe-color">
              <span>글자 색</span>
              <input type="color" value={obj?.color ?? style.textColor} onChange={(e) => (obj ? upd({ color: e.target.value }) : onStyle({ textColor: e.target.value }))} />
            </label>
          </>
        )}
        {obj?.kind === 'cover' && (
          <label className="pe-field pe-color">
            <span>바탕색</span>
            <input type="color" value={obj.fill ?? '#ffffff'} onChange={(e) => upd({ fill: e.target.value })} />
          </label>
        )}
        {usesLine && (
          <>
            <label className="pe-field pe-color">
              <span>색</span>
              <input type="color" value={obj?.color ?? style.lineColor} onChange={(e) => (obj ? upd({ color: e.target.value }) : onStyle({ lineColor: e.target.value }))} />
            </label>
            <label className="pe-field pe-num">
              <span>굵기</span>
              <input
                type="number"
                min={0.5}
                max={20}
                step={0.5}
                value={obj?.width ?? style.width}
                onChange={(e) => {
                  const v = Math.min(20, Math.max(0.5, Number(e.target.value) || 2))
                  if (obj) upd({ width: v })
                  else onStyle({ width: v })
                }}
              />
            </label>
          </>
        )}
        {usesHl && (
          <label className="pe-field pe-color">
            <span>색</span>
            <input type="color" value={obj?.color ?? style.hlColor} onChange={(e) => (obj ? upd({ color: e.target.value }) : onStyle({ hlColor: e.target.value }))} />
          </label>
        )}
        {obj && (
          <button
            className="btn btn-sm pe-danger"
            onClick={() => {
              removeObj(page.key, obj.id)
              onSel(null)
            }}
            disabled={busy}
          >
            그린 것 지우기
          </button>
        )}
      </div>
      {obj && (obj.kind === 'text' || obj.kind === 'cover') && (
        <label className="pe-field pe-text">
          <span>{obj.kind === 'cover' ? '덮은 칸에 쓸 글' : '글'}</span>
          <textarea ref={textRef} rows={2} value={obj.text ?? ''} onChange={(e) => typing(e.target.value)} onBlur={doneTyping} maxLength={2000} placeholder={obj.kind === 'cover' ? '비워 두면 흰 칸으로 덮기만 합니다.' : ''} />
        </label>
      )}
    </div>
  )
}

/* ---------- 문서 전체 ---------- */

function DocOptions(): JSX.Element {
  const s = usePdfEdit()
  return (
    <div className="card pe-doc">
      <div className="card-title">
        <span>문서 전체</span>
      </div>
      <div className="pe-doc-row">
        <label className="conv-check">
          <input type="checkbox" checked={s.numbersOn} onChange={(e) => setNumbers(e.target.checked)} disabled={s.busy} />
          쪽 번호 넣기
        </label>
        {s.numbersOn && (
          <>
            <label className="pe-field">
              <span>모양</span>
              <select value={s.numbers.style} onChange={(e) => setNumbers(true, { style: e.target.value as 'plain' | 'dash' | 'total' })}>
                <option value="plain">1</option>
                <option value="dash">- 1 -</option>
                <option value="total">1 / 전체</option>
              </select>
            </label>
            <label className="pe-field">
              <span>자리</span>
              <select value={s.numbers.pos} onChange={(e) => setNumbers(true, { pos: e.target.value === 'right' ? 'right' : 'center' })}>
                <option value="center">아래 가운데</option>
                <option value="right">아래 오른쪽</option>
              </select>
            </label>
            <label className="pe-field pe-num">
              <span>첫 번호</span>
              <input type="number" min={1} max={9999} value={s.numbers.start} onChange={(e) => setNumbers(true, { start: Math.min(9999, Math.max(1, Math.trunc(Number(e.target.value) || 1))) })} />
            </label>
            <label className="pe-field pe-num">
              <span>크기</span>
              <input type="number" min={6} max={36} value={s.numbers.size} onChange={(e) => setNumbers(true, { size: Math.min(36, Math.max(6, Number(e.target.value) || 11)) })} />
            </label>
          </>
        )}
      </div>
      <div className="pe-doc-row">
        <label className="conv-check">
          <input type="checkbox" checked={s.wmOn} onChange={(e) => setWatermark(e.target.checked)} disabled={s.busy} />
          워터마크 넣기
        </label>
        {s.wmOn && (
          <>
            <label className="pe-field pe-wm-text">
              <span>워터마크 글</span>
              <input type="text" value={s.watermark.text} maxLength={60} placeholder="예) 사본, 대외비" onChange={(e) => setWatermark(true, { text: e.target.value })} />
            </label>
            <label className="pe-field">
              <span>크기</span>
              <select value={String(s.watermark.scale)} onChange={(e) => setWatermark(true, { scale: Number(e.target.value) })}>
                <option value="0.45">작게</option>
                <option value="0.7">보통</option>
                <option value="0.95">크게</option>
              </select>
            </label>
            <label className="pe-field">
              <span>진하기</span>
              <select value={String(s.watermark.opacity)} onChange={(e) => setWatermark(true, { opacity: Number(e.target.value) })}>
                <option value="0.1">옅게</option>
                <option value="0.18">보통</option>
                <option value="0.3">진하게</option>
              </select>
            </label>
            <label className="pe-field pe-color">
              <span>색</span>
              <input type="color" value={s.watermark.color} onChange={(e) => setWatermark(true, { color: e.target.value })} />
            </label>
          </>
        )}
      </div>
      <div className="small muted">모든 쪽에 같은 자리로 넣습니다. 크게 보는 쪽에 미리 보입니다.</div>
    </div>
  )
}

/* ---------- 저장 ---------- */

function SaveCard(): JSX.Element {
  const s = usePdfEdit()
  const toast = useToast()
  const ask = useConfirm()
  const pickedPages = useMemo(() => s.pages.filter((p) => s.picked.includes(p.key)), [s.pages, s.picked])

  const run = async (mode: 'all' | 'part'): Promise<void> => {
    const pages = mode === 'part' ? pickedPages : s.pages
    if (hasRedaction(pages)) {
      const okk = await ask({
        title: '완전 가리기로 저장할까요?',
        body: '가린 곳의 글 · 그림은 새 파일에서 완전히 지워집니다.\n그 대신 모든 쪽이 그림으로 바뀌어 새 파일에서는 글자를 고르거나 찾을 수 없고, 파일이 커질 수 있습니다.\n원본은 그대로 둡니다.',
        okText: '그림으로 저장'
      })
      if (!okk) return
    } else if (pages.some((p) => p.objs.some((o) => o.kind === 'cover'))) {
      const okk = await ask({
        title: '덮은 채로 저장할까요?',
        body: '[덮고 새로 쓰기]는 안 보이게 덮기만 합니다. 원래 글은 새 파일 안에 남아 복사하거나 검색할 수 있습니다.\n개인정보를 지우려는 것이라면 [취소] 를 누르고 [완전 가리기] 를 쓰세요.',
        okText: '덮은 채로 저장',
        danger: true
      })
      if (!okk) return
    }
    const r = await save(mode)
    if (r && !r.ok) toast(r.error ?? '저장하지 못했습니다.', 'err')
    else if (r?.ok) toast(`'${r.name}' 로 저장했습니다.`, 'ok')
  }
  const reveal = async (): Promise<void> => {
    if (s.result?.key && !(await window.api.pdfedit.reveal(s.result.key))) toast('파일을 찾지 못했습니다. 옮겼거나 지웠는지 확인해 주세요.', 'err')
  }
  const r = s.result
  const p = s.progress

  return (
    <div className="card pe-save">
      <div className="card-title">
        <span>저장</span>
      </div>
      <div className="row">
        <button className="btn btn-primary" onClick={() => void run('all')} disabled={s.busy || !s.pages.length}>
          {s.busy ? '저장하는 중…' : '새 PDF 로 저장'}
        </button>
        <button className="btn" onClick={() => void run('part')} disabled={s.busy || !pickedPages.length}>
          고른 쪽만 새 PDF 로{pickedPages.length ? ` (${pickedPages.length}쪽)` : ''}
        </button>
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>
        원본은 바꾸지 않습니다. 첫 원본 파일 옆에 ‘이름_편집.pdf’(고른 쪽만이면 ‘이름_고른 쪽.pdf’)로 새로 만들고, 같은 이름이 있으면 (2), (3)… 을 붙입니다.
      </div>
      {p && (
        <div className="conv-progress" role="status" aria-live="polite">
          <div className="progress">
            <div style={{ width: `${p.total ? Math.round((100 * p.done) / p.total) : 0}%` }} />
          </div>
          <span className="small">
            {p.done} / {p.total}
          </span>
        </div>
      )}
      {r && !s.busy && (
        <div className={`note ${r.ok ? 'note-ok' : 'note-warn'} conv-result`} role="status">
          <b>{r.ok ? `‘${r.name}’ 로 저장했습니다 (${r.pages}쪽).` : (r.error ?? '저장하지 못했습니다.')}</b>
          {r.notes?.map((n) => (
            <div key={n}>{n}</div>
          ))}
          {r.ok && (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn btn-sm" onClick={() => void reveal()}>
                저장한 폴더 열기
              </button>
              <span className="small">{r.folder}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
