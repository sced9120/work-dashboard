import { useEffect, useMemo, useState } from 'react'
import type { ModelChoice } from '../../shared/types'
import { SETEUK_BANNED } from '../../shared/seteukRules'
import { SETEUK_MODES, modeOfRec, studentLabel, validateSeteuk } from '../../shared/seteuk'
import type { SeteukActivity, SeteukRosters, SeteukRows, SeteukStudent } from '../../shared/seteuk'
import { REVIEW_MAX_CHARS, REVIEW_MIN_CHARS, findHeaderNames } from '../../shared/seteukReview'
import type { ReviewGrade } from '../../shared/seteukReview'
import Markdown from './Markdown'
import ModelPicker from './ModelPicker'
import SeteukMap from './SeteukMap'
import type { TopicMap } from '../../shared/seteukMap'
import { useToast } from '../lib/toast'

/**
 * 학생부 분석 — 상담 힌트 (담임).
 * 한 학생의 학생부 파일(PDF · 한글 · 워드 · 텍스트)을 올리거나 붙여 넣고 학년을 고르면, 담임이 상담에서 쓸 강점 · 관심의 흐름 · 물어볼 질문 ·
 * 대화 포인트 · 살펴볼 점 · 다음 학기 관찰 장면을 받는다. 판단이 아니라 대화의 실마리다.
 * 어느 쪽에서 불러도 혼자 동작한다 — 모두 선택 props 이고, 없으면 window.api 로 필요한 것을 스스로 읽는다.
 * 기재요령 금지어는 보내기 전에 이 PC 에서 먼저 짚는다.
 */
interface Props {
  /** 작성실에서 모으기에 쓸 명단 · 활동 · 글 — 없으면 스스로 읽는다 */
  students?: SeteukStudent[]
  rosters?: SeteukRosters
  acts?: SeteukActivity[]
  rows?: Record<string, SeteukRows>
  /** 없으면 이 화면의 모델 고르기를 쓴다 */
  model?: ModelChoice | null
  onClose?: () => void
}

/** 올릴 수 있는 학생부 파일 — 스캔본(이미지)은 [문서 스캔]으로 먼저 글자를 옮긴다 */
const FILE_EXTS = ['pdf', 'hwp', 'hwpx', 'docx', 'txt', 'md']
const SCAN_HINT = '스캔본은 [문서 스캔]으로 글자를 먼저 옮겨 주세요.'
const extOf = (name: string): string => (name.split('.').pop() ?? '').toLowerCase()

/** 그 학생(이름이 같은 학생)의 모든 영역 최종본(없으면 초안)을 '[영역 · 활동]' 머리를 붙여 모은다 */
function collect(s: SeteukStudent, rosters: SeteukRosters, acts: SeteukActivity[], rows: Record<string, SeteukRows>): string {
  const out: string[] = []
  for (const a of acts) {
    const list = rosters[modeOfRec(a.rec)]
    const same = list.filter((x) => x.name === s.name)
    if (same.length !== 1) continue
    const r = rows[a.id]?.[same[0].id]
    const text = (r?.final.trim() || r?.ai.trim() || '').replace(/\s*\n+\s*/g, ' ')
    if (text) out.push(`[${a.rec} · ${a.name}]\n${text}`)
  }
  return out.join('\n\n')
}

interface Loaded {
  rosters: SeteukRosters
  acts: SeteukActivity[]
  rows: Record<string, SeteukRows>
}

export default function SeteukReview({ students: pStudents, rosters: pRosters, acts: pActs, rows: pRows, model: pModel, onClose }: Props): JSX.Element {
  const toast = useToast()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [ownModel, setOwnModel] = useState<ModelChoice | null>(null)
  const [sid, setSid] = useState('')
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [drag, setDrag] = useState(false)
  const [grade, setGrade] = useState<ReviewGrade | ''>('')
  const [career, setCareer] = useState('')
  const [studentName, setStudentName] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState('')
  const [topicMap, setTopicMap] = useState<TopicMap | null>(null)
  const [mapBusy, setMapBusy] = useState(false)

  const model = pModel !== undefined ? pModel : ownModel
  const needLoad = !pRosters || !pActs || !pRows

  // 작성실에서 모으기에 필요한 것을 props 로 못 받았으면 직접 읽는다(없어도 파일 · 붙여 넣기로 쓸 수 있다)
  useEffect(() => {
    if (!needLoad) return
    let alive = true
    void (async () => {
      try {
        const a = await window.api.seteuk.load()
        if (alive) setLoaded({ rosters: a.rosters, acts: a.acts, rows: a.rows })
      } catch {
        /* 작성실 자료 없이도 쓸 수 있다 */
      }
    })()
    return () => {
      alive = false
    }
  }, [needLoad])

  const rosters = pRosters ?? loaded?.rosters
  const acts = pActs ?? loaded?.acts
  const rows = pRows ?? loaded?.rows
  const students = useMemo<SeteukStudent[]>(() => {
    if (pStudents) return pStudents
    const out: SeteukStudent[] = []
    if (rosters) for (const m of SETEUK_MODES) for (const s of rosters[m.key] ?? []) if (!out.some((x) => x.name === s.name)) out.push(s)
    return out
  }, [pStudents, rosters])

  const clearOut = (): void => {
    setReport('')
    setTopicMap(null)
  }

  const pick = (id: string): void => {
    setSid(id)
    const s = students.find((x) => x.id === id)
    if (!s || !rosters || !acts || !rows) return
    const t = collect(s, rosters, acts, rows)
    if (!t) return toast('이 학생은 작성실에 쓴 글이 아직 없습니다. 학생부 파일을 올리거나 직접 붙여 넣어 주세요.')
    setText(t)
    setFileName('')
    clearOut()
  }

  /** 학생부 파일에서 글자를 뽑아 글상자에 채운다(여러 파일이면 이어 붙임). 올린 뒤에도 고치거나 붙여 넣을 수 있다 */
  const readPaths = async (paths: string[]): Promise<void> => {
    if (reading) return
    const ok = paths.filter((p) => FILE_EXTS.includes(extOf(p)))
    if (!ok.length) return toast(`PDF · 한글(hwp, hwpx) · 워드(docx) · 텍스트 파일을 올려 주세요. ${SCAN_HINT}`, 'err')
    setReading(true)
    const parts: string[] = []
    const names: string[] = []
    for (const p of ok) {
      try {
        const d = await window.api.files.extract(p)
        if (d.error || !d.text.trim()) {
          toast(`${d.filename || p}: ${d.error ?? '글자를 읽지 못했습니다.'} ${SCAN_HINT}`, 'err')
          continue
        }
        parts.push(d.text.trim())
        names.push(d.filename)
      } catch (e) {
        toast(`${(e as Error).message || '파일을 읽지 못했습니다.'}`, 'err')
      }
    }
    setReading(false)
    if (!parts.length) return
    setText(parts.join('\n\n'))
    setFileName(names.join(', '))
    setSid('')
    clearOut()
    if (ok.length < paths.length) toast(`올릴 수 없는 형식은 뺐습니다. ${SCAN_HINT}`)
  }

  const chooseFile = async (): Promise<void> => {
    const list = await window.api.files.pick()
    if (list.length) await readPaths(list.map((f) => f.path))
  }

  const hasFiles = (e: React.DragEvent): boolean => [...e.dataTransfer.types].includes('Files')

  // 기재요령 금지어 — 이 PC 에서만 본다
  const banned = useMemo(() => {
    if (!text.trim()) return []
    return validateSeteuk(text, 0, SETEUK_BANNED).issues.filter((x) => x.label !== '결과 없음')
  }, [text])

  // 학생부 머리의 성명은 따로 가려 보낸다
  const headerNames = useMemo(() => findHeaderNames(text), [text])

  const reqBase = (): { text: string; grade: ReviewGrade; career: string; studentName: string; model: ModelChoice | undefined } => ({
    text,
    grade: grade as ReviewGrade,
    career,
    studentName,
    model: model ?? undefined
  })

  const send = async (dry: boolean): Promise<void> => {
    if (!grade || busy) return
    setBusy(true)
    const r = await window.api.seteuk.review({ ...reqBase(), dry })
    setBusy(false)
    if (!r.ok) return toast(r.error ?? '분석하지 못했습니다.', 'err')
    if (dry && r.text) {
      await window.api.clipboard.write(r.text)
      return toast('요청 글을 복사했습니다(이름은 가렸습니다). AI 앱에 붙여 넣으세요.', 'ok')
    }
    setReport(r.report ?? '')
  }

  const mapNow = async (dry: boolean): Promise<void> => {
    if (!grade || mapBusy) return
    setMapBusy(true)
    const r = await window.api.seteuk.map({ ...reqBase(), dry })
    setMapBusy(false)
    if (!r.ok) return toast(r.error ?? '주제 지도를 만들지 못했습니다.', 'err')
    if (dry && r.text) {
      await window.api.clipboard.write(r.text)
      return toast('요청 글을 복사했습니다(이름은 가렸습니다). AI 앱에 붙여 넣으세요.', 'ok')
    }
    setTopicMap(r.map ?? null)
  }

  const mapLabel = ((): string => {
    const s = students.find((x) => x.id === sid)
    return s ? studentLabel(s) : studentName.trim() || '학생'
  })()

  const len = text.trim().length
  const tooLong = len > REVIEW_MAX_CHARS
  const ready = !!grade && len >= REVIEW_MIN_CHARS && !tooLong

  return (
    <section className="card stk-side stk-review">
      <div className="stk-import-head">
        <div className="card-title">학생부 분석 — 상담 힌트</div>
        <span className="spacer" />
        {onClose && (
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            닫기
          </button>
        )}
      </div>
      <p className="small muted">학생부를 읽고 상담 때 쓸 힌트를 줍니다. 판단이 아니라 대화의 실마리입니다.</p>

      <div className="stk-review-form">
        <label>
          <span>학년</span>
          <select value={grade} onChange={(e) => setGrade(e.target.value as ReviewGrade)}>
            <option value="">고르기</option>
            <option value="1">1학년</option>
            <option value="2">2학년</option>
            <option value="3">3학년</option>
          </select>
        </label>
        <label>
          <span>학생 이름(가려서 보냄, 선택)</span>
          <input type="text" value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="예: 홍길동" autoComplete="off" />
        </label>
        <label>
          <span>진로 희망 (있으면)</span>
          <input type="text" value={career} onChange={(e) => setCareer(e.target.value)} placeholder="예: 통계 · 데이터 분야" />
        </label>
        {students.length > 0 && (
          <label>
            <span>작성실에서 모으기 (선택)</span>
            <select value={sid} onChange={(e) => pick(e.target.value)}>
              <option value="">학생 고르기</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {studentLabel(s)} {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {pModel === undefined && <ModelPicker feature="seteuk" label="모델" onReady={setOwnModel} onChange={setOwnModel} />}

      <div
        className={`stk-review-drop${drag ? ' on' : ''}`}
        onDragOver={(e) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          const paths = [...e.dataTransfer.files].map((f) => window.api.files.pathOf(f)).filter(Boolean)
          if (paths.length) void readPaths(paths)
        }}
      >
        <div className="row">
          <button className="btn btn-sm" onClick={() => void chooseFile()} disabled={reading}>
            {reading ? '읽는 중…' : '학생부 파일 올리기'}
          </button>
          <span className="small muted">PDF · 한글(hwp, hwpx) · 워드(docx) · 텍스트 — 아래 상자에 끌어 놓아도 됩니다. {SCAN_HINT}</span>
        </div>
        <textarea
          className="stk-review-text"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            clearOut()
          }}
          placeholder={'학생부 파일을 올리거나, 나이스에서 복사한 세특 · 창체 · 행발을 붙여 넣습니다. 영역 이름을 함께 붙이면 더 잘 읽습니다.\n예) [수학] 교과서에 제시된 공식 대신 …'}
          aria-label="학생부 글"
        />
        <p className={`small ${tooLong ? 'smap-warn' : 'muted'}`}>
          {fileName ? `${fileName} · ` : ''}
          {text.length.toLocaleString()}자{tooLong ? ` — ${REVIEW_MAX_CHARS.toLocaleString()}자까지 보낼 수 있습니다. 한 학년이나 몇 영역씩 나눠 주세요.` : ''}
        </p>
      </div>
      <p className="small muted">
        작성실 명단의 학생 이름({SETEUK_MODES.length}개 명단), 위에 적은 학생 이름, 학생부 머리의 '성명'은 가려 보냅니다
        {headerNames.length > 0 ? ` (이 글에서 성명 ${headerNames.length}건을 찾았습니다)` : ''}. 그 밖의 이름(다른 학년 · 다른 반 학생)이 글에 있으면 지우고 보내 주세요. 가리지 못한 이름이
        남으면 보내지 않습니다.
      </p>
      {banned.length > 0 && (
        <ul className="stk-issues stk-review-banned">
          {banned.map((x, i) => (
            <li key={i} className={x.level}>
              <b>{x.level === 'block' ? '고침' : '확인'}</b> {x.label}
              {x.hit && <span className="hit"> — {x.hit}</span>}
              {x.why && <span className="why">{x.why}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button className="btn btn-primary btn-sm" onClick={() => void send(false)} disabled={!ready || busy}>
          {busy ? '읽는 중…' : '분석하기'}
        </button>
        <button className="btn btn-sm" onClick={() => void mapNow(false)} disabled={!ready || busy || mapBusy} title="학생부의 주제를 뽑아 서로 잇고, 이어 갈 주제를 어느 영역에 둘지 지도로 봅니다">
          {mapBusy ? '그리는 중…' : '주제 지도'}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => void mapNow(true)} disabled={!ready || busy || mapBusy} title="키 없이 — 주제 지도 요청 글 복사">
          지도 요청 글 복사
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => void send(true)} disabled={!ready || busy} title="AI 키가 없을 때 — 요청 글을 복사해 AI 앱에서 받습니다">
          키 없이 — 요청 글 복사
        </button>
        {!grade && <span className="small muted">학년을 고르면 시작할 수 있습니다.</span>}
      </div>

      {report && (
        <div className="stk-review-out">
          <div className="stk-import-head">
            <span className="stk-style-label">상담 힌트</span>
            <span className="spacer" />
            <button
              className="btn btn-sm"
              onClick={() =>
                void (async () => {
                  await window.api.clipboard.write(report)
                  toast('상담 힌트를 복사했습니다.', 'ok')
                })()
              }
            >
              복사
            </button>
          </div>
          <div className="stk-review-md">
            <Markdown text={report} />
          </div>
          <p className="small muted">AI 가 학생부만 보고 만든 힌트입니다. 학생을 단정하는 근거로 쓰지 말고, 상담에서 학생과 이야기하며 확인해 주세요.</p>
        </div>
      )}
      {topicMap && <SeteukMap map={topicMap} label={mapLabel} />}
    </section>
  )
}
