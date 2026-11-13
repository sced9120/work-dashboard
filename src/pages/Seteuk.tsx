import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ModelChoice } from '../../shared/types'
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
} from '../../shared/seteuk'
import type { SeteukActivity, SeteukAmount, SeteukCheck, SeteukConfig, SeteukImportHit, SeteukMode, SeteukOptions, SeteukRosters, SeteukRow, SeteukRows, SeteukStyle } from '../../shared/seteuk'
import Icon from '../components/Icon'
import ModelPicker from '../components/ModelPicker'
import SeteukImport from '../components/SeteukImport'
import SeteukReview from '../components/SeteukReview'
import SeteukRules from '../components/SeteukRules'
import SeteukFill from '../components/SeteukFill'
import SeteukPromptMaker from '../components/SeteukPromptMaker'
import RelayCard from '../components/RelayCard'
import SeteukStylePanel from '../components/SeteukStyle'
import SeteukSumView from '../components/SeteukSum'
import SeteukXlsx from '../components/SeteukXlsx'
import { useConfirm } from '../lib/confirm'
import type { PageId } from '../App'
import Ocr from './Ocr'
import { useToast } from '../lib/toast'

/**
 * 세특 작성실 — 명단을 붙여 넣고, 활동마다 학생별 관찰 기록을 적으면 AI 가 초안을 쓰고,
 * 선생님이 다듬은 최종본을 한 표에서 본다.
 *
 * 수업 반 · 동아리 부원 · 우리 반은 서로 다른 학생이라 모드(교과 · 동아리 · 담임)마다 명단을 따로 둔다.
 * 쓰는 규칙(프롬프트)과 분량은 처음부터 맞춰져 있고, 활동도 모드마다 만들어 둔다 — 명단만 넣으면 쓴다.
 * 적는 대로 잠시 뒤 저절로 저장한다. 학생 이름은 AI 에 보내지 않고(메인에서 가린다),
 * 명단 · 관찰 기록 · 글은 이 PC 에만 두며 인수인계 파일에도 넣지 않는다.
 */

type SaveState = 'saved' | 'dirty' | 'saving'
type Patch = Record<string, Partial<SeteukRow>>
type Panel = '' | 'roster' | 'xlsx' | 'rules' | 'style' | 'review' | 'phone'

const SAVE_DELAY = 900
const MODE_KEY = 'wd.seteuk.mode'
const INTRO_KEY = 'wd.seteuk.intro'
const newId = (): string => 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36)

function stored(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}
function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 이번에만
  }
}

export default function Seteuk({ onGo }: { onGo: (p: PageId) => void }): JSX.Element {
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

  if (!loaded) return <></>

  const rosterPanel = (
    <div className="stk-panel">
      <p className="small">
        엑셀 · 나이스 명렬표에서 <b>학번(또는 반 · 번호) · 이름</b> 칸을 끌어 복사해 붙여 넣으세요. 이 명단은 <b>{info.name}</b>({info.who})에만 씁니다.
        <br />
        <b>반마다 따로</b> 넣으면 표를 반별로 보고 나이스에도 반별로 올립니다. 선택과목처럼 여러 반 학생이 모인 수업은 <b>미적분A반</b> 처럼 이름을 지어 넣으세요.
      </p>
      {classes.length > 0 && (
        <div className="stk-groups-now">
          {classes.map((c) => (
            <span key={c.name} className="stk-chip">
              <b>{c.name}</b> {c.count}명
              <button onClick={() => void removeGroup(c.name)} aria-label={`${c.name} 명단에서 빼기`} title="이 반을 명단에서 빼기">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {students.length > 0 && (
        <div className="stk-roster-now">
          <div className="stk-import-head">
            <span className="stk-style-label">
              지금 {info.name} 명단 {students.length}명 <span className="muted">× 를 누르면 그 학생을 뺍니다</span>
            </span>
            <span className="spacer" />
            <button className="btn btn-sm btn-ghost stk-danger-text" onClick={() => void clearRoster()}>
              명단 모두 지우기
            </button>
          </div>
          <div className="stk-chips">
            {students.map((s) => (
              <span key={s.id} className="stk-chip">
                {studentLabel(s)} {s.name}
                <button onClick={() => void removeStudent(s.id)} aria-label={`${s.name} 빼기`} title="명단에서 빼기">
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      <label className="stk-group-name">
        <span>반 이름</span>
        <input
          type="text"
          value={rosterGroup}
          onChange={(e) => setRosterGroup(e.target.value)}
          placeholder="예: 3반 · 미적분A반 · 과학탐구실험 2반"
          list="stk-group-list"
          aria-describedby="stk-group-hint"
        />
        <datalist id="stk-group-list">
          {classes.map((c) => (
            <option key={c.name} value={c.name} />
          ))}
        </datalist>
        <span id="stk-group-hint" className="small muted">
          {cleanGroup(rosterGroup)
            ? classes.some((c) => c.name === cleanGroup(rosterGroup))
              ? `${cleanGroup(rosterGroup)} 명단만 새로 바꿉니다. 다른 반은 그대로입니다.`
              : `${cleanGroup(rosterGroup)}을(를) 새로 더합니다. 다른 반은 그대로입니다.`
            : '비워 두면 명단 전체를 바꿉니다.'}
        </span>
      </label>
      <textarea className="stk-roster" value={rosterText} onChange={(e) => setRosterText(e.target.value)} placeholder={'학번\t이름\n20301\t이름\n20415\t이름\n…'} aria-label={`${info.name} 명단 붙여넣기`} />
      <div className="row">
        <button className="btn btn-primary btn-sm" onClick={() => void applyRoster()} disabled={!parsed.students.length}>
          {parsed.students.length ? `${cleanGroup(rosterGroup) ? `${cleanGroup(rosterGroup)}에 ` : ''}${parsed.students.length}명 넣기` : '명단 넣기'}
        </button>
        {rosterText.trim() && (
          <span className="small muted">
            {parsed.students.length
              ? `읽은 학생 ${parsed.students.length}명 · 담임 반 ${new Set(parsed.students.map((s) => s.cls || '없음')).size}개에서` + (parsed.skipped ? ` · 건너뛴 줄 ${parsed.skipped}` : '')
              : '이름을 찾지 못했습니다. 이름이 든 칸을 함께 복사해 주세요.'}
          </span>
        )}
      </div>
    </div>
  )

  return (
    <>
      <div className="page-head">
        <h1>세특 작성실</h1>
        <p>관찰한 것을 적으면 AI 가 초안을 쓰고, 선생님이 다듬어 최종본으로 둡니다. 학생 이름은 AI 에 보내지 않습니다.</p>
      </div>

      {intro && (
        <section className="card stk-intro">
          <div className="card-title">처음이시면</div>
          <ol>
            <li>
              <b>교과 · 동아리 · 담임</b> 가운데 쓸 것을 고릅니다. 학생이 서로 달라 명단을 따로 둡니다.
            </li>
            <li>
              <b>명단</b>을 엑셀에서 복사해 붙여 넣습니다. 활동은 미리 만들어 두었습니다.
            </li>
            <li>
              학생마다 <b>관찰한 것</b>을 적고 [초안 받기]. 쓰는 규칙과 분량은 이미 맞춰져 있습니다.
            </li>
            <li>
              초안을 읽고 고쳐 <b>최종본</b>으로 두면, [취합 · 나이스]에서 모아 나이스 파일로 받습니다.
            </li>
          </ol>
          <div className="row">
            {demo.canFill && (
              <button className="btn btn-primary btn-sm" onClick={() => void fillDemo()}>
                체험 자료로 먼저 보기
              </button>
            )}
            <button className="btn btn-sm" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1' }))}>
              화면 따라 배우기 (F1)
            </button>
            <button className="btn btn-sm btn-ghost" onClick={closeIntro}>
              닫기
            </button>
            {demo.canFill && <span className="small muted">지어낸 학생 16명과 채워진 활동이 들어갑니다. 한 번에 지울 수 있습니다.</span>}
          </div>
        </section>
      )}

      {demo.filled && (
        <div className="note note-info small stk-demo">
          <span>
            <b>체험 자료</b>가 들어 있습니다. 학생과 글은 모두 지어낸 것입니다. 교과의 윤바다 초안에는 일부러 고칠 곳을 넣었고, 강하늘은
            [취합]에서 한도를 넘습니다.
          </span>
          <button className="btn btn-sm" onClick={() => void clearDemo()} disabled={!!job}>
            체험 자료 지우기
          </button>
        </div>
      )}

      <div className="ocr-modes stk-modes" role="tablist" aria-label="모드">
        {SETEUK_MODES.map((m) => (
          <button key={m.key} role="tab" aria-selected={m.key === mode} className={`ocr-mode ${m.key === mode ? 'active' : ''}`} onClick={() => void switchMode(m.key)} disabled={!!job}>
            {m.name}
            <small>
              {m.desc} · {rosters[m.key].length ? `${m.who} ${rosters[m.key].length}명` : '명단 없음'}
            </small>
          </button>
        ))}
      </div>

      <div className="stk-bar">
        <div className="memo-filter stk-view" role="radiogroup" aria-label="보기">
          <button role="radio" aria-checked={view === 'acts'} className={view === 'acts' ? 'on' : ''} onClick={() => void switchView('acts')}>
            활동별 작성
          </button>
          <button role="radio" aria-checked={view === 'sum'} className={view === 'sum' ? 'on' : ''} onClick={() => void switchView('sum')} disabled={!!job}>
            취합 · 나이스
          </button>
          <button role="radio" aria-checked={view === 'scan'} className={view === 'scan' ? 'on' : ''} onClick={() => void switchView('scan')} disabled={!!job} title="스캔 · 사진 속 표를 글자 그대로 읽어 엑셀로 · 폴더째 학생별 정리">
            문서 스캔
          </button>
        </div>
        <span className="spacer" />
        <span className="small muted stk-save" aria-live="polite">
          {save === 'saved' ? '저장됨' : save === 'saving' ? '저장 중…' : '적는 중…'}
        </span>
        <button className="btn btn-sm btn-ghost" onClick={() => void togglePanel('phone')} aria-expanded={panel === 'phone'} title="수업 중에 폰으로 번호를 누르고 본 것을 적으면 관찰 기록에 붙습니다">
          폰으로 관찰
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => void togglePanel('review')} aria-expanded={panel === 'review'} title="한 학생의 학생부를 읽고 1 · 2학년은 이어 갈 탐구, 3학년은 짜임과 보완할 곳을 짚습니다">
          학생부 살펴보기
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => void togglePanel('style')} aria-expanded={panel === 'style'}>
          내 문체{style.on ? ' · 켬' : ''}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => void togglePanel('rules')} aria-expanded={panel === 'rules'} title="금지어 · 검사 · 쓰는 규칙을 켜고 끄거나 내 것을 더합니다">
          내 규칙
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => void togglePanel('xlsx')} aria-expanded={panel === 'xlsx'} disabled={!!job}>
          엑셀로 주고받기
        </button>
        <button className="btn btn-sm" onClick={() => void togglePanel('roster')} aria-expanded={panel === 'roster'} disabled={!!job}>
          {students.length ? `명단 ${students.length}명` : '명단 넣기'}
        </button>
      </div>

      {panel === 'roster' && <section className="card stk-side">{rosterPanel}</section>}
      {panel === 'phone' && (
        <RelayCard
          tab="obs"
          title="폰으로 수업 관찰"
          desc="수업 중에 학생을 누르고 본 것을 적으면, 그 활동의 관찰 기록 뒤에 날짜와 함께 붙습니다"
          startOpen
          className="stk-phone"
          howTo={
            <ol className="small relay-how">
              <li>폰 화면의 <b>[수업 관찰]</b> 탭에서 활동과 수업반을 고릅니다. 이 PC 의 활동 · 명단이 몇 분 안에 폰에 올라갑니다. 폰에는 학번 · 이름이 보이지만 구글에는 이 PC 에서 잠근 글만 갑니다.</li>
              <li>학생을 누르고 [발표] · [질문] 같은 단어를 눌러 시작하거나, 키보드의 마이크로 말해서 적고 [보내기].</li>
              <li>3분 안에 이 표의 관찰 기록에 <b>[11/13] 발표: …</b> 처럼 붙습니다. 오늘 적은 학생은 폰에서 색이 칠해져 아직 못 본 학생이 보입니다.</li>
            </ol>
          }
        />
      )}
      {panel === 'xlsx' && <SeteukXlsx onImported={() => void reload()} onClose={() => setPanel('')} />}
      {panel === 'review' && <SeteukReview students={students} rosters={rosters} acts={acts} rows={rows} model={model} onClose={() => setPanel('')} />}
      {panel === 'style' && <SeteukStylePanel style={style} model={model} onChange={setStyle} onClose={() => setPanel('')} />}
      {panel === 'rules' && (
        <SeteukRules
          config={config}
          preview={rules}
          actName={act?.name ?? '활동'}
          onChange={(c) => {
            setSeteukConfig(c)
            setConfig(c)
          }}
          onClose={() => {
            setPanel('')
            // 취합 보기도 새 규칙으로 다시 검사하게
            setRev((n) => n + 1)
          }}
        />
      )}

      {panel !== 'review' && view === 'sum' && <SeteukSumView key={`${rev}-${mode}`} students={students} acts={modeActs} rows={rows} />}
      {panel !== 'review' && view === 'scan' && (
        <div className="stk-scan">
          <Ocr onGo={onGo} />
        </div>
      )}

      {panel !== 'review' && view === 'acts' && (
        <>
          <section className="card stk-top">
            <div className="stk-acts" role="tablist" aria-label="활동">
              {modeActs.map((a) => (
                <button key={a.id} role="tab" aria-selected={a.id === act?.id} className={`tab${a.id === act?.id ? ' active' : ''}`} onClick={() => void switchAct(a.id)}>
                  {a.name}
                </button>
              ))}
              <button className="btn btn-sm" onClick={() => void addAct()} disabled={!!job}>
                <Icon name="plus" size={14} /> 활동
              </button>
            </div>

            {act && rec && (
              <div className="stk-actbar">
                <span className="small">
                  <b>{rec.key}</b> · 한도 {limit}바이트(한글 약 {Math.floor(limit / 3)}자) · 분량 {act.fill}%{act.amount === '메모만큼' ? ' · 짧은 메모는 짧게' : ''}{act.structure.trim() ? ' · 구성 있음' : ''}
                  {act.subject ? ` · ${act.subject}` : ''}
                </span>
                <span className="spacer" />
                <button
                  className={`btn btn-sm ${makerOpen ? 'btn-primary' : ''}`}
                  onClick={() => {
                    setMakerOpen((v) => !v)
                    setCfgOpen(false)
                  }}
                  aria-expanded={makerOpen}
                  title="세특 구성 · 요청사항 · 분량을 적고, AI 에게 가는 프롬프트를 기재요령 틀과 함께 봅니다"
                >
                  프롬프트 만들기
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    setCfgOpen((v) => !v)
                    setMakerOpen(false)
                  }}
                  aria-expanded={cfgOpen}
                >
                  {cfgOpen ? '활동 설정 닫기' : '활동 설정'}
                </button>
              </div>
            )}

            {act && rec && makerOpen && <SeteukPromptMaker act={act} style={style} config={config} onPatch={patchAct} onClose={() => setMakerOpen(false)} />}

            {act && rec && cfgOpen && (
              <div className="stk-panel stk-cfg">
                <label>
                  <span>활동 이름</span>
                  <input type="text" value={act.name} onChange={(e) => patchAct({ name: e.target.value })} />
                </label>
                <label>
                  <span>기록 영역</span>
                  <select value={act.rec} onChange={(e) => patchAct({ rec: e.target.value, bytes: 0 })} disabled={info.recs.length < 2}>
                    {SETEUK_RECORDS.filter((r) => info.recs.includes(r.key)).map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.key} — {r.name} ({r.chars * 3}바이트)
                      </option>
                    ))}
                  </select>
                </label>
                {act.rec === '과세특' && (
                  <label>
                    <span>과목</span>
                    <input type="text" value={act.subject} onChange={(e) => patchAct({ subject: e.target.value })} placeholder="예: 공통수학2" />
                  </label>
                )}
                <label>
                  <span>교과 역량 문구</span>
                  <select value={act.area} onChange={(e) => patchAct({ area: e.target.value })}>
                    <option value="">넣지 않음</option>
                    {SETEUK_SUBJECTS.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.kind === '공통' ? '공통 핵심역량 (창체 · 행발)' : `${x.name} 교과 역량`}
                      </option>
                    ))}
                  </select>
                </label>
                {act.area && subjectOf(act.area)?.comp && <p className="small muted stk-wide stk-comp">{subjectOf(act.area)?.comp}</p>}
                <div className="stk-wide stk-cols">
                  <span className="stk-style-label">
                    입력 항목 <span className="muted">둘 이상이면 관찰 기록을 항목별 칸으로 나눠 적습니다. 비우면 한 칸</span>
                  </span>
                  <div className="stk-templates">
                    {COLUMN_SETS.map((c) => (
                      <button key={c.name} type="button" className="btn btn-sm" onClick={() => patchAct({ columns: c.cols })}>
                        {c.name}
                      </button>
                    ))}
                    {act.columns.length > 0 && (
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => patchAct({ columns: [] })}>
                        한 칸으로
                      </button>
                    )}
                  </div>
                  <input type="text" value={act.columns.join(', ')} onChange={(e) => patchAct({ columns: readColumns(e.target.value) })} placeholder="예: 탐구 주제, 탐구 과정, 알게 된 점 (쉼표로)" aria-label="입력 항목" />
                </div>
                <label>
                  <span>이 활동의 분량(바이트)</span>
                  <input
                    type="number"
                    min={0}
                    max={rec.chars * 3}
                    step={30}
                    value={act.bytes || ''}
                    onChange={(e) => patchAct({ bytes: Math.max(0, Math.min(rec.chars * 3, Math.floor(Number(e.target.value) || 0))) })}
                    placeholder={`비우면 ${rec.chars * 3}`}
                  />
                </label>
                <div className="stk-wide">
                  <SeteukFill fill={act.fill} limit={limit} short={act.amount === '메모만큼'} onFill={(v) => patchAct({ fill: v })} onShort={(v) => patchAct({ amount: v ? '메모만큼' : '보통' })} />
                </div>
                <label className="stk-wide">
                  <span>활동 개요 — 무엇을 한 수업 · 활동인지</span>
                  <textarea value={act.desc} onChange={(e) => patchAct({ desc: e.target.value })} placeholder="예: 실생활 자료로 함수의 그래프를 그리고 변화율을 설명하는 모둠 탐구 3차시" />
                </label>
                <p className="small muted stk-wide">{rec.note} 한 영역에 활동이 여럿이면 활동마다 분량을 나눠 적어 두세요.</p>
                <div className="stk-wide stk-examples">
                  <span className="stk-style-label">
                    예시 {act.examples.length}개{' '}
                    <span className="muted">
                      잘 쓴 최종본을 예시로 두면 초안이 그 표현 방식을 따릅니다. 표에서 학생 줄을 누르고 [예시로 등록]. 초안에는 앞의 {SETEUK_EXAMPLE_MAX}개가
                      쓰입니다.
                    </span>
                  </span>
                  {act.examples.map((e, i) => (
                    <div key={i} className="stk-example">
                      <p className="small">
                        <b>{i + 1}</b> {e.result}
                      </p>
                      <button className="btn btn-sm btn-ghost" onClick={() => patchAct({ examples: act.examples.filter((_x, k) => k !== i) })} aria-label={`예시 ${i + 1} 빼기`}>
                        빼기
                      </button>
                    </div>
                  ))}
                </div>
                <div className="stk-wide row row-end">
                  <button className="btn btn-sm btn-danger" onClick={() => void removeAct()} disabled={!!job}>
                    <Icon name="trash" size={14} /> 이 활동 지우기
                  </button>
                </div>
              </div>
            )}
          </section>

          {!act ? (
            <section className="card empty">
              <p>{info.name} 활동이 없습니다. [＋ 활동] 으로 하나 만들면 학생별 표가 열립니다.</p>
            </section>
          ) : !students.length ? (
            <section className="card stk-first">
              <div className="card-title">{info.name} 명단을 넣으면 바로 씁니다</div>
              <p className="small muted">
                「{act.name}」 활동은 만들어 두었습니다. {info.who} 명단만 붙여 넣으세요.
              </p>
              {rosterPanel}
              {demo.canFill && (
                <p className="small muted stk-first-demo">
                  어떻게 생겼는지 먼저 보려면{' '}
                  <button className="link" onClick={() => void fillDemo()}>
                    체험 자료로 먼저 보기
                  </button>
                </p>
              )}
            </section>
          ) : (
            <section className="card stk-main">
              {classes.length > 1 && (
                <div className="stk-group-tabs" role="tablist" aria-label="반별로 보기">
                  {[{ name: '', count: students.length }, ...classes].map((c) => (
                    <button
                      key={c.name || '_all'}
                      role="tab"
                      aria-selected={cls === c.name}
                      className={cls === c.name ? 'on' : ''}
                      onClick={() => {
                        setCls(c.name)
                        setSel(new Set())
                      }}
                    >
                      {c.name || '모든 반'} <span className="muted">{c.count}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="stk-tools">
                <ModelPicker feature="seteuk" label="모델" onReady={setModel} onChange={setModel} />
                <label className="stk-opt small" title="검사에서 분량 초과 · 기재 금지 · 어미 같은 '고침'이 나온 학생만 걸린 점을 짚어 한 번 더 받습니다. 나아진 경우에만 바꿉니다.">
                  <input type="checkbox" checked={options.autoRepair} onChange={(e) => saveOptions({ autoRepair: e.target.checked })} disabled={!!job} />
                  자동 고쳐쓰기
                </label>
                <label className="stk-opt small" title="초안을 받은 뒤 관찰 기록에 없는 활동 · 수치 · 과장된 평가가 있는지 한 번 더 묻습니다. 학생마다 AI 를 한 번 더 부릅니다.">
                  <input type="checkbox" checked={options.ground} onChange={(e) => saveOptions({ ground: e.target.checked })} disabled={!!job} />
                  근거 확인
                </label>
                <span className="spacer" />
                <button className="btn btn-sm" onClick={() => setImportOpen((v) => !v)} disabled={!!job} aria-expanded={importOpen} title="스캔한 활동지 · 사진이나 엑셀 표에서 학생별 관찰 기록을 가져옵니다">
                  <Icon name="scan" size={14} /> 관찰 기록 가져오기
                </button>
                {job ? (
                  <button className="btn btn-sm" onClick={() => void window.api.seteuk.cancel(job)}>
                    멈추기
                  </button>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={() => void write()} disabled={!ready.length}>
                    <Icon name="spark" size={14} /> {sel.size ? `고른 ${ready.length}명` : `${ready.length}명`} 초안 받기
                  </button>
                )}
                <button className={`btn btn-sm ${finalOnly ? 'btn-primary' : ''}`} onClick={() => setFinalOnly((v) => !v)} aria-pressed={finalOnly} title="표에서 학생과 최종본만 넓게 봅니다">
                  {finalOnly ? '모두 보기' : '최종본만 보기'}
                </button>
                <button className="btn btn-sm" onClick={adoptEmpty} disabled={!!job} title="최종본이 빈 학생만 AI 초안을 최종본에 넣습니다">
                  빈 최종본에 초안 넣기
                </button>
                <button className="btn btn-sm" onClick={() => void copyFinals()} title="보이는 학생 순서대로 최종본을 한 줄씩 복사합니다">
                  최종본 열 복사
                </button>
              </div>
              {importOpen && <SeteukImport students={shown} onApply={importNotes} onClose={() => setImportOpen(false)} />}
              {prog && (
                <div className="stk-prog" role="status">
                  <div className="progress">
                    <div style={{ width: `${prog.total ? Math.round((prog.done / prog.total) * 100) : 0}%` }} />
                  </div>
                  <span className="small muted">
                    {prog.done} / {prog.total}명
                  </span>
                </div>
              )}
              <p className="small muted stk-count">
                최종본 {filled} / {shown.length}명
              </p>

              <div className="stk-scroll">
                <table className={`stk-table ${finalOnly ? 'final-only' : ''}`}>
                  <thead>
                    <tr>
                      <th className="c-chk">
                        <input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="모두 고르기" />
                      </th>
                      <th className="c-who">학생</th>
                      {!finalOnly && <th>관찰 기록</th>}
                      {!finalOnly && <th>AI 초안</th>}
                      <th>최종본</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((s) => {
                      const r = cur[s.id] ?? emptyRow()
                      const c = checks[s.id]
                      const badge = c ? checkBadge(c) : null
                      const fb = byteLen(r.final)
                      const on = focus === s.id
                      const shownText = r.final.trim() ? r.final : r.ai
                      const left = groundLeft(r.ground, shownText)
                      return (
                        <tr key={s.id} className={on ? 'on' : ''} onFocus={() => setFocus(s.id)}>
                          <td className="c-chk">
                            <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggle(s.id)} aria-label={`${studentLabel(s)} 고르기`} />
                          </td>
                          <td className="c-who">
                            <b>{s.name}</b>
                            <span className="small muted">{studentLabel(s)}</span>
                            {rec?.useGrade && (
                              <select className="stk-grade" value={r.grade ?? ''} onChange={(e) => setCell(s.id, { grade: e.target.value })} aria-label={`${studentLabel(s)} 성취수준`} title="성취수준 — 글에는 쓰지 않고 서술의 깊이만 맞춥니다">
                                <option value="">성취수준</option>
                                {GRADES.map((g) => (
                                  <option key={g} value={g}>
                                    {g}
                                  </option>
                                ))}
                              </select>
                            )}
                            {badge && badge.kind !== 'none' && <span className={`stk-badge ${badge.kind}`}>{badge.text}</span>}
                            {left.length > 0 && <span className="stk-badge check">근거 확인 {left.length}</span>}
                          </td>
                          {!finalOnly && (
                            <>
                          <td>
                            {act.columns.length >= 2 ? (
                              <div className="stk-fields">
                                {act.columns.map((c) => (
                                  <label key={c}>
                                    <span>{c}</span>
                                    <textarea
                                      value={r.fields?.[c] ?? ''}
                                      onChange={(e) => {
                                        const fields = { ...(r.fields ?? {}), [c]: e.target.value }
                                        setCell(s.id, { fields, note: joinFields(act.columns, fields) })
                                      }}
                                      aria-label={`${studentLabel(s)} ${c}`}
                                    />
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <textarea value={r.note} onChange={(e) => setCell(s.id, { note: e.target.value })} placeholder="수업 · 활동에서 본 것을 적습니다" aria-label={`${studentLabel(s)} 관찰 기록`} />
                            )}
                            {on && r.note.trim() && (
                              <div className="stk-under">
                                <span />
                                <button
                                  className="btn btn-sm btn-ghost"
                                  onClick={() => void copyRequest(s.id)}
                                  title="AI 키가 없을 때 — 규칙과 이름을 가린 관찰 기록을 복사합니다. Gemini · ChatGPT · Claude 앱에 붙여 넣으세요."
                                >
                                  키 없이 — 요청 글 복사
                                </button>
                              </div>
                            )}
                          </td>
                          <td>
                            <textarea className="stk-ai" value={r.ai} onChange={(e) => setCell(s.id, { ai: e.target.value })} placeholder="초안이 여기에 옵니다" aria-label={`${studentLabel(s)} AI 초안`} />
                            {errors[s.id] && <p className="small stk-err">{errors[s.id]}</p>}
                            {r.ai.trim() && (
                              <div className="stk-under">
                                <span className="small muted">
                                  {byteLen(r.ai)}바이트{r.repaired ? ' · 걸린 곳을 한 번 고쳐 받음' : ''}
                                </span>
                                <button className="btn btn-sm btn-ghost" onClick={() => setCell(s.id, { final: r.ai })} disabled={r.final === r.ai}>
                                  최종본으로 →
                                </button>
                              </div>
                            )}
                          </td>
                            </>
                          )}
                          <td>
                            <textarea value={r.final} onChange={(e) => setCell(s.id, { final: e.target.value })} placeholder="초안을 옮겨 다듬거나 바로 적습니다" aria-label={`${studentLabel(s)} 최종본`} />
                            <div className="stk-under">
                              <span className={`small ${fb > limit ? 'stk-over' : 'muted'}`}>
                                {fb} / {limit}바이트
                              </span>
                              {on && r.note.trim() && shownText.trim() && (
                                <button
                                  className="btn btn-sm btn-ghost"
                                  onClick={() => void checkGround(s.id)}
                                  disabled={!!grounding || !!job}
                                  title="최종본(없으면 초안)에 관찰 기록에 없는 내용이 있는지 AI 에게 묻습니다. 이름은 가려 보냅니다."
                                >
                                  {grounding === s.id ? '확인 중…' : '근거 확인'}
                                </button>
                              )}
                              {on && r.final.trim() && (
                                <button className="btn btn-sm btn-ghost" onClick={() => addExample(s.id)} title="이 글을 이 활동의 예시로 둡니다. 다음 초안부터 이 표현 방식과 흐름을 따릅니다.">
                                  예시로 등록
                                </button>
                              )}
                            </div>
                            {left.length > 0 && (
                              <ul className="stk-issues stk-ground">
                                {left.map((g, i) => (
                                  <li key={i} className="check">
                                    <b>확인</b> 관찰 기록에 없는 내용<span className="hit"> — {g.quote}</span>
                                    {g.why && <span className="why">{g.why}</span>}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {on && r.ground && r.ground.length === 0 && <p className="small muted stk-ground-ok">근거 확인 — 관찰 기록에 없는 내용을 찾지 못했습니다.</p>}
                            {on && c && c.issues.length > 0 && (
                              <ul className="stk-issues">
                                {c.issues.map((x, i) => (
                                  <li key={i} className={x.level}>
                                    <b>{x.level === 'block' ? '고침' : '확인'}</b> {x.label}
                                    {x.hit && <span className="hit"> — {x.hit}</span>}
                                    {x.fix && <span className="fix"> → {x.fix}</span>}
                                    {x.why && <span className="why">{x.why}</span>}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  )
}
