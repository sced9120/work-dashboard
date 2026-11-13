/**
 * 세특 작성실 — 화면 상태와 동작 (Seteuk.tsx 에서 나눔, 3.8.0).
 * 화면 조각(seteuk/*.tsx)은 이 훅이 돌려주는 값(SeteukState)만 받아 그린다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ModelChoice } from '../../../shared/types'
import {
  COLUMN_SETS,
  cleanGroup,
  groupOf,
  groupsOf,
  mergeGroup,
  GRADES,
  SETEUK_SUBJECTS,
  joinFields,
  readColumns,
  subjectOf,
  SETEUK_AMOUNTS,
  SETEUK_EXAMPLE_MAX,
  SETEUK_MODES,
  SETEUK_RECORDS,
  buildSeteukPrompt,
  byteLen,
  checkBadge,
  emptyRosters,
  emptyRow,
  defaultConfig,
  defaultOptions,
  emptyStyle,
  groundLeft,
  limitOf,
  minRatioOf,
  mergeNote,
  modeInfo,
  modeOfRec,
  newActivity,
  parseRoster,
  recordOf,
  setSeteukConfig,
  studentLabel,
  validateSeteuk
} from '../../../shared/seteuk'
import type { SeteukActivity, SeteukAmount, SeteukCheck, SeteukConfig, SeteukImportHit, SeteukMode, SeteukOptions, SeteukRosters, SeteukRow, SeteukRows, SeteukStyle } from '../../../shared/seteuk'
import Icon from '../../components/Icon'
import ModelPicker from '../../components/ModelPicker'
import SeteukImport from '../../components/SeteukImport'
import SeteukReview from '../../components/SeteukReview'
import SeteukRules from '../../components/SeteukRules'
import SeteukFill from '../../components/SeteukFill'
import SeteukPromptMaker from '../../components/SeteukPromptMaker'
import RelayCard from '../../components/RelayCard'
import SeteukStylePanel from '../../components/SeteukStyle'
import SeteukSumView from '../../components/SeteukSum'
import SeteukXlsx from '../../components/SeteukXlsx'
import { useConfirm } from '../../lib/confirm'
import type { PageId } from '../../App'
import Ocr from '../Ocr'
import { useToast } from '../../lib/toast'

/**
 * 세특 작성실 — 명단을 붙여 넣고, 활동마다 학생별 관찰 기록을 적으면 AI 가 초안을 쓰고,
 * 선생님이 다듬은 최종본을 한 표에서 본다.
 *
 * 수업 반 · 동아리 부원 · 우리 반은 서로 다른 학생이라 모드(교과 · 동아리 · 담임)마다 명단을 따로 둔다.
 * 쓰는 규칙(프롬프트)과 분량은 처음부터 맞춰져 있고, 활동도 모드마다 만들어 둔다 — 명단만 넣으면 쓴다.
 * 적는 대로 잠시 뒤 저절로 저장한다. 학생 이름은 AI 에 보내지 않고(메인에서 가린다),
 * 명단 · 관찰 기록 · 글은 이 PC 에만 두며 인수인계 파일에도 넣지 않는다.
 */

export type SaveState = 'saved' | 'dirty' | 'saving'
export type Patch = Record<string, Partial<SeteukRow>>
export type Panel = '' | 'roster' | 'xlsx' | 'rules' | 'style' | 'review' | 'phone'

export const SAVE_DELAY = 900
export const MODE_KEY = 'wd.seteuk.mode'
export const INTRO_KEY = 'wd.seteuk.intro'
export const newId = (): string => 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36)

export function stored(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}
export function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 이번에만
  }
}

export function useSeteuk({ onGo }: { onGo: (p: PageId) => void }) {
  const toast = useToast()
  const ask = useConfirm()
  const [loaded, setLoaded] = useState(false)
  const [rosters, setRosters] = useState<SeteukRosters>(emptyRosters)
  const [acts, setActs] = useState<SeteukActivity[]>([])
  const [rows, setRows] = useState<Record<string, SeteukRows>>({})
  const [demo, setDemo] = useState({ filled: false, canFill: false })
  const [style, setStyle] = useState<SeteukStyle>(emptyStyle)
  const [options, setOptions] = useState<SeteukOptions>(defaultOptions)
  const [config, setConfig] = useState<SeteukConfig>(defaultConfig)
  const [grounding, setGrounding] = useState('')
  const [mode, setMode] = useState<SeteukMode>(() => (SETEUK_MODES.some((m) => m.key === stored(MODE_KEY)) ? (stored(MODE_KEY) as SeteukMode) : 'subject'))
  const [actIds, setActIds] = useState<Record<string, string>>({})
  const [cls, setCls] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [focus, setFocus] = useState('')
  const [save, setSave] = useState<SaveState>('saved')
  const [model, setModel] = useState<ModelChoice | null>(null)
  const [panel, setPanel] = useState<Panel>('')
  const [rosterText, setRosterText] = useState('')
  const [rosterGroup, setRosterGroup] = useState('')
  const [cfgOpen, setCfgOpen] = useState(false)
  const [makerOpen, setMakerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [view, setView] = useState<'acts' | 'sum' | 'scan'>('acts')
  /** 표에서 학생 · 최종본만 — 다 쓴 뒤 훑어볼 때 */
  const [finalOnly, setFinalOnly] = useState(false)
  const [rev, setRev] = useState(0)
  const [intro, setIntro] = useState(() => stored(INTRO_KEY) !== '1')
  const [job, setJob] = useState('')
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const pending = useRef<{ actId: string; patch: Patch } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const actsTimer = useRef<number | undefined>(undefined)
  const actsRef = useRef<SeteukActivity[] | null>(null)
  const jobRef = useRef({ id: '', act: '' })

  const info = modeInfo(mode)
  const students = rosters[mode]
  const modeActs = useMemo(() => acts.filter((a) => modeOfRec(a.rec) === mode), [acts, mode])
  const act = modeActs.find((a) => a.id === actIds[mode]) ?? modeActs[0] ?? null
  const limit = act ? limitOf(act) : 0
  const cur: SeteukRows = (act && rows[act.id]) || {}

  /* ---------- 읽기 · 저장 ---------- */

  const reload = useCallback(async (): Promise<void> => {
    const all = await window.api.seteuk.load()
    setRosters(all.rosters)
    setActs(all.acts)
    setRows(all.rows)
    setDemo(all.demo)
    setStyle(all.style)
    setOptions(all.options)
    setSeteukConfig(all.config)
    setConfig(all.config)
    setLoaded(true)
    // 취합 보기는 저장된 것을 처음에 한 번 읽으므로 다시 그리게 한다
    setRev((n) => n + 1)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const flush = useCallback(async (): Promise<void> => {
    window.clearTimeout(timer.current)
    window.clearTimeout(actsTimer.current)
    const a = actsRef.current
    const p = pending.current
    if (!a && !p) return
    actsRef.current = null
    pending.current = null
    setSave('saving')
    if (a) await window.api.seteuk.saveActs(a)
    if (p) await window.api.seteuk.saveRows(p.actId, p.patch)
    setSave(pending.current || actsRef.current ? 'dirty' : 'saved')
  }, [])

  // 화면을 떠날 때 미뤄 둔 저장을 마친다
  useEffect(() => () => void flush(), [flush])

  // 폰에서 수업 관찰이 들어오면 — 적던 것을 먼저 저장하고 관찰 기록만 다시 읽는다
  useEffect(
    () =>
      window.api.relay.onRouted((r) => {
        if (!r.obs) return
        void (async () => {
          await flush()
          const all = await window.api.seteuk.load()
          setRows(all.rows)
        })()
      }),
    [flush]
  )

  useEffect(() => {
    return window.api.seteuk.onProgress((p) => {
      if (p.job !== jobRef.current.id) return
      setProg({ done: p.done, total: p.total })
      const id = p.id
      if (!id) return
      if (p.error) setErrors((e) => ({ ...e, [id]: p.error as string }))
      const got = p.row
      if (got) {
        const a = jobRef.current.act
        // 관찰 기록 · 최종본은 그사이 고쳤을 수 있으니 받은 칸만 바꾼다
        setRows((prev) => ({ ...prev, [a]: { ...(prev[a] ?? {}), [id]: { ...(prev[a]?.[id] ?? emptyRow()), ai: got.ai, repaired: got.repaired, ground: got.ground } } }))
      }
    })
  }, [])

  const setCell = (sid: string, patch: Partial<SeteukRow>): void => {
    if (!act) return
    const id = act.id
    setRows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), [sid]: { ...(prev[id]?.[sid] ?? emptyRow()), ...patch } } }))
    if (pending.current && pending.current.actId !== id) void flush()
    const before = pending.current?.actId === id ? pending.current.patch : {}
    pending.current = { actId: id, patch: { ...before, [sid]: { ...(before[sid] ?? {}), ...patch } } }
    setSave('dirty')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY)
  }

  const changeActs = (next: SeteukActivity[], now = false): void => {
    setActs(next)
    actsRef.current = next
    setSave('dirty')
    window.clearTimeout(actsTimer.current)
    if (now) void flush()
    else actsTimer.current = window.setTimeout(() => void flush(), SAVE_DELAY)
  }
  const patchAct = (patch: Partial<SeteukActivity>): void => {
    if (!act) return
    changeActs(acts.map((a) => (a.id === act.id ? { ...a, ...patch } : a)))
  }

  const resetView = (): void => {
    setSel(new Set())
    setFocus('')
    setErrors({})
    setImportOpen(false)
    setCfgOpen(false)
  }

  /* ---------- 모드 · 보기 ---------- */

  const switchMode = async (m: SeteukMode): Promise<void> => {
    if (m === mode || job) return
    await flush()
    setMode(m)
    remember(MODE_KEY, m)
    setCls('')
    setPanel('')
    resetView()
  }

  const switchView = async (v: 'acts' | 'sum' | 'scan'): Promise<void> => {
    if (v === view || job) return
    await flush()
    setImportOpen(false)
    setView(v)
  }

  const togglePanel = async (p: Panel): Promise<void> => {
    await flush()
    setPanel((now) => (now === p ? '' : p))
  }

  /* ---------- 명단 ---------- */

  const parsed = useMemo(() => parseRoster(rosterText), [rosterText])

  const applyRoster = async (): Promise<void> => {
    if (!parsed.students.length) return
    const g = cleanGroup(rosterGroup)
    const had = g ? students.filter((s) => groupOf(s) === g).length : students.length
    if (had) {
      const ok = await ask({
        title: g ? `${g} 명단을 ${parsed.students.length}명으로 바꿀까요?` : `${info.name} 명단을 ${parsed.students.length}명으로 바꿀까요?`,
        body: g
          ? `지금 ${g}에 ${had}명이 있습니다. 다른 반 명단은 그대로 둡니다. 반 · 번호가 같은 학생의 관찰 기록과 글은 그대로 이어집니다.`
          : '반 이름을 비워 두어 명단 전체를 바꿉니다. 반 · 번호가 같은 학생의 관찰 기록과 글은 그대로 이어집니다. 반별로 따로 두려면 반 이름을 적어 주세요.',
        okText: '바꾸기'
      })
      if (!ok) return
    }
    const next = g ? mergeGroup(students, g, parsed.students) : parsed.students
    const saved = await window.api.seteuk.saveRoster(mode, next)
    setRosters((prev) => ({ ...prev, [mode]: saved }))
    setDemo((d) => ({ ...d, canFill: false }))
    setPanel('')
    setRosterText('')
    setRosterGroup('')
    setSel(new Set())
    setCls(g)
    toast(g ? `${g} ${parsed.students.length}명을 넣었습니다. (${info.name} 모두 ${saved.length}명)` : `${info.name} 명단 ${saved.length}명을 넣었습니다.`, 'ok')
  }

  /** 수업반 하나를 명단에서 뺀다 — 글은 남는다 */
  const removeGroup = async (g: string): Promise<void> => {
    const n = students.filter((s) => groupOf(s) === g).length
    const ok = await ask({
      title: `${g} ${n}명을 명단에서 뺄까요?`,
      body: '명단만 뺍니다. 적어 둔 관찰 기록 · 초안 · 최종본은 남아 있어, 같은 반 이름으로 다시 넣으면 돌아옵니다.',
      okText: '빼기',
      danger: true
    })
    if (!ok) return
    const saved = await window.api.seteuk.saveRoster(mode, students.filter((s) => groupOf(s) !== g))
    setRosters((prev) => ({ ...prev, [mode]: saved }))
    setSel(new Set())
    if (cls === g) setCls('')
    toast(`${g}을(를) 명단에서 뺐습니다.`, 'ok')
  }

  /** 명단에서 학생을 뺀다 — 적어 둔 글은 지우지 않아 같은 반 · 번호로 다시 넣으면 돌아온다 */
  const removeStudent = async (id: string): Promise<void> => {
    const s = students.find((x) => x.id === id)
    if (!s) return
    const next = students.filter((x) => x.id !== id)
    const saved = await window.api.seteuk.saveRoster(mode, next)
    setRosters((prev) => ({ ...prev, [mode]: saved }))
    setSel((prev) => {
      const n = new Set(prev)
      n.delete(id)
      return n
    })
    toast(`${studentLabel(s)} ${s.name}을(를) 명단에서 뺐습니다. 적어 둔 글은 남아 있어 다시 넣으면 돌아옵니다.`, 'ok')
  }

  const clearRoster = async (): Promise<void> => {
    const ok = await ask({
      title: `${info.name} 명단 ${students.length}명을 모두 지울까요?`,
      body: '명단만 지웁니다. 적어 둔 관찰 기록 · 초안 · 최종본은 남아 있어, 같은 반 · 번호로 명단을 다시 넣으면 돌아옵니다.',
      okText: '모두 지우기',
      danger: true
    })
    if (!ok) return
    await window.api.seteuk.saveRoster(mode, [])
    setRosters((prev) => ({ ...prev, [mode]: [] }))
    setSel(new Set())
    setCls('')
    toast(`${info.name} 명단을 지웠습니다.`, 'ok')
  }

  /** 수업반 — 명단을 넣을 때 정한 반 이름(없으면 담임 반) */
  const classes = useMemo(() => groupsOf(students), [students])
  const shown = useMemo(() => (cls ? students.filter((s) => groupOf(s) === cls) : students), [students, cls])
  // 고른 반이 명단에서 사라졌으면 모든 반으로
  useEffect(() => {
    if (cls && !classes.some((c) => c.name === cls)) setCls('')
  }, [cls, classes])
  /** 명단을 붙여 넣으면 반 이름을 짐작해 채운다 — 담임 반 하나뿐이면 '3반' */
  const prevRosterText = useRef('')
  useEffect(() => {
    const was = prevRosterText.current
    prevRosterText.current = rosterText
    // 처음 붙여 넣었을 때만 — 선생님이 일부러 비운 칸은 다시 채우지 않는다
    if (was.trim() || !rosterText.trim() || rosterGroup) return
    const cs = [...new Set(parseRoster(rosterText).students.map((s) => s.cls).filter(Boolean))]
    if (cs.length === 1) setRosterGroup(`${cs[0]}반`)
  }, [rosterText, rosterGroup])

  /* ---------- 체험 자료 · 처음 안내 ---------- */

  const closeIntro = (): void => {
    setIntro(false)
    remember(INTRO_KEY, '1')
  }

  const fillDemo = async (): Promise<void> => {
    await flush()
    const r = await window.api.seteuk.demoFill()
    if (!r.ok) return toast(r.error ?? '체험 자료를 넣지 못했습니다.', 'err')
    await reload()
    setActIds({})
    resetView()
    closeIntro()
    toast('체험 자료를 넣었습니다. 학생과 글은 모두 지어낸 것입니다.', 'ok')
  }

  const clearDemo = async (): Promise<void> => {
    const ok = await ask({
      title: '체험 자료를 지울까요?',
      body: '체험 활동과 지어낸 학생만 지웁니다. 선생님이 만든 활동과 넣은 학생은 그대로 둡니다.',
      okText: '지우기',
      danger: true
    })
    if (!ok) return
    await flush()
    await window.api.seteuk.demoClear()
    await reload()
    setActIds({})
    resetView()
    toast('체험 자료를 지웠습니다. 이제 실제 명단을 넣으세요.', 'ok')
  }

  /* ---------- 활동 ---------- */

  const switchAct = async (id: string): Promise<void> => {
    if (id === act?.id) return
    await flush()
    setActIds((prev) => ({ ...prev, [mode]: id }))
    resetView()
  }

  const addAct = async (): Promise<void> => {
    await flush()
    const base = act ?? modeActs[modeActs.length - 1]
    const a = newActivity(newId(), { rec: base?.rec ?? info.recs[0], subject: base?.subject ?? '' })
    changeActs([...acts, a], true)
    setRows((prev) => ({ ...prev, [a.id]: {} }))
    setActIds((prev) => ({ ...prev, [mode]: a.id }))
    resetView()
    setCfgOpen(true)
    setMakerOpen(false)
  }

  const removeAct = async (): Promise<void> => {
    if (!act) return
    const filled = Object.values(cur).filter((r) => r.note.trim() || r.ai.trim() || r.final.trim()).length
    const ok = await ask({
      title: `「${act.name}」 활동을 지울까요?`,
      body: filled ? `학생 ${filled}명의 관찰 기록 · 초안 · 최종본도 함께 지워지고 되돌릴 수 없습니다.` : '되돌릴 수 없습니다.',
      okText: '지우기',
      danger: true
    })
    if (!ok) return
    window.clearTimeout(timer.current)
    if (pending.current?.actId === act.id) pending.current = null
    changeActs(
      acts.filter((a) => a.id !== act.id),
      true
    )
    setActIds((prev) => ({ ...prev, [mode]: '' }))
    setCfgOpen(false)
    toast('활동을 지웠습니다.', 'ok')
  }

  /* ---------- 예시 ---------- */

  /** 이 학생의 관찰 기록과 최종본을 이 활동의 예시로 — 다음 초안부터 이 표현 방식과 흐름을 따른다 */
  const addExample = (sid: string): void => {
    if (!act) return
    const r = cur[sid]
    if (!r?.final.trim()) return
    if (act.examples.some((e) => e.result === r.final.trim())) return toast('이미 예시로 등록한 글입니다.')
    patchAct({ examples: [...act.examples, { note: r.note.trim(), result: r.final.trim() }] })
    toast(
      act.examples.length >= SETEUK_EXAMPLE_MAX
        ? `예시로 등록했습니다. 초안에는 앞의 ${SETEUK_EXAMPLE_MAX}개만 쓰입니다 — [활동 설정]에서 덜 좋은 예시를 빼세요.`
        : `예시로 등록했습니다(${act.examples.length + 1}개). 다음 초안부터 이 글의 표현 방식을 따릅니다.`,
      'ok'
    )
  }

  /* ---------- 관찰 기록 가져오기 ---------- */

  const importNotes = (hits: SeteukImportHit[]): void => {
    for (const h of hits) setCell(h.id, { note: mergeNote(cur[h.id]?.note ?? '', h.text) })
  }

  /* ---------- 초안 받기 ---------- */

  const targets = useMemo(() => {
    const ids = shown.map((s) => s.id)
    return sel.size ? ids.filter((id) => sel.has(id)) : ids
  }, [shown, sel])
  const ready = targets.filter((id) => cur[id]?.note.trim())

  const write = async (): Promise<void> => {
    if (!act || !ready.length || job) return
    const again = ready.filter((id) => cur[id]?.ai.trim()).length
    if (again) {
      const ok = await ask({
        title: `초안이 있는 ${again}명도 다시 받을까요?`,
        body: '지금 있는 AI 초안은 새 초안으로 바뀝니다. 최종본은 건드리지 않습니다.',
        okText: '다시 받기'
      })
      if (!ok) return
    }
    await flush()
    const id = newId()
    jobRef.current = { id, act: act.id }
    setJob(id)
    setErrors({})
    setProg({ done: 0, total: ready.length })
    const r = await window.api.seteuk.write({ job: id, actId: act.id, ids: ready, model: model ?? undefined })
    jobRef.current = { id: '', act: '' }
    setJob('')
    setProg(null)
    if (!r.ok) return toast(r.error ?? '초안을 받지 못했습니다.', 'err')
    const tail = (r.failed ? ` · 받지 못한 학생 ${r.failed}명` : '') + (r.canceled ? ' · 멈춤' : '')
    toast(`${r.written}명의 초안을 받았습니다${tail}. 읽고 다듬어 최종본에 옮기세요.`, r.failed ? 'err' : 'ok')
  }

  /** 키 없이 — 규칙과 이름을 가린 관찰 기록을 복사한다. AI 앱에서 받은 답은 [AI 초안] 칸에 붙여 넣는다 */
  const saveOptions = (patch: Partial<SeteukOptions>): void => {
    const next = { ...options, ...patch }
    setOptions(next)
    void window.api.seteuk.saveOptions(next)
  }

  /** 한 학생의 근거 확인 — 최종본(없으면 초안)에 관찰 기록에 없는 내용이 있는지 */
  const checkGround = async (sid: string): Promise<void> => {
    if (!act || grounding) return
    await flush()
    setGrounding(sid)
    const r = await window.api.seteuk.ground(act.id, sid, model)
    setGrounding('')
    if (!r.ok || !r.row) return toast(r.error ?? '근거를 확인하지 못했습니다.', 'err')
    const got = r.row
    setRows((prev) => ({ ...prev, [act.id]: { ...(prev[act.id] ?? {}), [sid]: { ...(prev[act.id]?.[sid] ?? emptyRow()), ground: got.ground } } }))
    toast(got.ground?.length ? `관찰 기록에 없는 내용 ${got.ground.length}곳을 찾았습니다. 표시된 구절을 확인하세요.` : '관찰 기록에 없는 내용을 찾지 못했습니다.', got.ground?.length ? undefined : 'ok')
  }

  const copyRequest = async (sid: string): Promise<void> => {
    if (!act) return
    await flush()
    const r = await window.api.seteuk.request(act.id, sid)
    if (!r.ok || !r.text) return toast(r.error ?? '요청 글을 만들지 못했습니다.', 'err')
    await window.api.clipboard.write(r.text)
    toast('요청 글을 복사했습니다(이름은 가렸습니다). AI 앱에 붙여 넣고, 받은 글을 [AI 초안] 칸에 붙이세요.', 'ok')
  }

  const adoptEmpty = (): void => {
    let n = 0
    for (const s of shown) {
      const r = cur[s.id]
      if (r && r.ai.trim() && !r.final.trim()) {
        setCell(s.id, { final: r.ai })
        n++
      }
    }
    toast(n ? `${n}명의 초안을 최종본에 넣었습니다.` : '옮길 초안이 없습니다(최종본이 빈 학생만 옮깁니다).', n ? 'ok' : undefined)
  }

  const copyFinals = async (): Promise<void> => {
    const text = shown.map((s) => (cur[s.id]?.final ?? '').replace(/\s*\r?\n+\s*/g, ' ')).join('\n')
    await window.api.clipboard.write(text)
    toast(`최종본 ${shown.length}줄을 복사했습니다. 엑셀 · 나이스 표의 첫 칸에 붙여 넣으세요.`, 'ok')
  }

  /* ---------- 검사 ---------- */

  const actKey = act?.id ?? ''
  const checks = useMemo(() => {
    const out: Record<string, SeteukCheck> = {}
    if (!actKey) return out
    for (const s of shown) {
      const r = rows[actKey]?.[s.id]
      const text = r?.final.trim() ? r.final : (r?.ai ?? '')
      if (text.trim()) out[s.id] = validateSeteuk(text, limit, undefined, act ? minRatioOf(act) : 0.7)
    }
    return out
    // config: 내 규칙을 바꾸면 다시 검사한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, actKey, shown, limit, config])

  const allOn = shown.length > 0 && shown.every((s) => sel.has(s.id))
  const toggleAll = (): void => setSel(allOn ? new Set() : new Set(shown.map((s) => s.id)))
  const toggle = (id: string): void =>
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const filled = shown.filter((s) => cur[s.id]?.final.trim()).length
  const rec = act ? recordOf(act.rec) : null
  const rules = useMemo(() => (act ? buildSeteukPrompt(act, { style, config }) : ''), [act, style, config])

  return { onGo, toast, ask, loaded, setLoaded, rosters, setRosters, acts, setActs, rows, setRows, demo, setDemo, style, setStyle, options, setOptions, config, setConfig, grounding, setGrounding, mode, setMode, actIds, setActIds, cls, setCls, sel, setSel, focus, setFocus, save, setSave, model, setModel, panel, setPanel, rosterText, setRosterText, rosterGroup, setRosterGroup, cfgOpen, setCfgOpen, makerOpen, setMakerOpen, importOpen, setImportOpen, view, setView, finalOnly, setFinalOnly, rev, setRev, intro, setIntro, job, setJob, prog, setProg, errors, setErrors, pending, timer, actsTimer, actsRef, jobRef, info, students, modeActs, act, limit, cur, reload, flush, setCell, changeActs, patchAct, resetView, switchMode, switchView, togglePanel, parsed, applyRoster, removeGroup, removeStudent, clearRoster, classes, shown, prevRosterText, closeIntro, fillDemo, clearDemo, switchAct, addAct, removeAct, addExample, importNotes, targets, ready, write, saveOptions, checkGround, copyRequest, adoptEmpty, copyFinals, actKey, checks, allOn, toggleAll, toggle, filled, rec, rules }
}

export type SeteukState = ReturnType<typeof useSeteuk>
