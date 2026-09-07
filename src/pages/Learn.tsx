import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DocKind, ExtractedDoc, ModelChoice, TaskDraft } from '../../shared/types'
import { currentSchoolYear, schoolYearLabel } from '../../shared/types'
import { groupNotices, joinNotice, parseNoticeName } from '../../shared/notice'
import type { NoticeGroup } from '../../shared/notice'
import type { PageId } from '../App'
import { useToast } from '../lib/toast'
import {
  addDrafts,
  clearDrafts,
  finishJob,
  isStopping,
  setDrafts as setJobDrafts,
  setProgress as setJobProgress,
  startJob,
  useLearnJob
} from '../lib/learnJob'
import ModelPicker from '../components/ModelPicker'
import YearPicker from '../components/YearPicker'
import StoredDocsLearn from '../components/StoredDocsLearn'

interface Props {
  jobTitle: string
  onGo: (p: PageId) => void
}

/**
 * 같은 공문의 파일은 늘 같은 폴더에 있다.
 *
 * 문서번호는 해마다 1번부터 다시 매겨져서, 번호만 보고 묶으면 지난해 4169번과
 * 올해 4169번이 한 덩어리가 된다. 폴더까지 함께 봐야 섞이지 않는다.
 */
function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i < 0 ? '' : path.slice(0, i)
}

interface FileRow {
  path: string
  name: string
  state: '대기' | '읽는 중' | '읽음' | '실패'
  doc?: ExtractedDoc
}

export default function Learn({ jobTitle, onGo }: Props): JSX.Element {
  const toast = useToast()
  const [kind, setKind] = useState<DocKind>('길라잡이/매뉴얼')
  const [files, setFiles] = useState<FileRow[]>([])
  // 진행 상태와 찾아낸 업무는 화면 밖에 둔다. 다른 화면으로 넘어갔다 돌아와도
  // 이어서 보이고, 위쪽 띠에 "학습 중" 이 계속 떠 있다.
  const job = useLearnJob()
  const drafts = job.drafts
  const setDrafts = setJobDrafts
  const busy = job.running
  const progress = job.message
  const done = job.done
  const [hasKey, setHasKey] = useState(true)
  const [preview, setPreview] = useState<string | null>(null)
  const [keepOriginal, setKeepOriginal] = useState(true)
  /** AI 에 보내기 전에 이름·연락처를 ○○○ 으로 덮을지 */
  const [scrub, setScrub] = useState(false)
  /**
   * 이 문서들이 몇 학년도 것인지.
   *
   * 해가 바뀌어 넘겨줄 때 "지난 학년도 것만 지우기" 를 하려면 지금 정해 두어야
   * 한다. 전임자에게 받은 묵은 공문을 학습시킬 때는 그 해로 바꿔 주면 된다.
   */
  const [year, setYear] = useState(currentSchoolYear())
  const [model, setModel] = useState<ModelChoice | null>(null)
  /** 파일을 새로 올릴지, 이미 보관한 공문을 학습할지 */
  const [source, setSource] = useState<'파일' | '보관함'>('파일')
  /** 설정에 적어 둔 업무분장. 있으면 뽑아낸 것을 내 일과 남의 일로 갈라 준다. */
  const [roster, setRoster] = useState('')
  /** 검토 목록에서 다른 부서 것을 감출지 */
  const [onlyMine, setOnlyMine] = useState(false)
  /** 문서번호가 같은 본문·첨부를 한 공문으로 묶을지 */
  const [groupFiles, setGroupFiles] = useState(true)

  useEffect(() => {
    void (async () => {
      const s = await window.api.local.load()
      setHasKey(!!(s.openai_key || s.gemini_key || s.claude_key))
      setRoster(await window.api.setting.get('duty_roster'))
    })()
  }, [])

  useEffect(() => window.api.ai.onProgress((msg) => setJobProgress({ message: msg })), [])

  const pick = useCallback(async () => {
    const picked = await window.api.files.pick()
    if (!picked.length) return

    const rows: FileRow[] = picked.map((p) => ({ ...p, state: '대기' }))
    setFiles((prev) => [...prev, ...rows])

    for (const row of rows) {
      setFiles((prev) => prev.map((f) => (f.path === row.path ? { ...f, state: '읽는 중' } : f)))
      const doc = await window.api.files.extract(row.path)
      setFiles((prev) =>
        prev.map((f) =>
          f.path === row.path ? { ...f, doc, state: doc.error ? '실패' : '읽음' } : f
        )
      )
    }
  }, [])

  const ready = useMemo(
    () => files.filter((f) => f.state === '읽음' && f.doc?.text),
    [files]
  )

  /**
   * 분석에 넘길 덩어리.
   *
   * 공문은 본문 하나에 첨부 몇 개로 내려오고 그 전체가 하나의 일이다.
   * 이름 앞머리의 문서번호가 같으면 한 공문이므로 묶어서 한 번에 보낸다.
   * 길라잡이는 파일마다 따로 본다.
   */
  const groups = useMemo(() => {
    if (kind !== '개별 공문' || !groupFiles) {
      return ready.map((f): NoticeGroup<FileRow> => ({ key: f.path, number: '', label: f.name, items: [f] }))
    }
    return groupNotices(
      ready,
      (f) => f.name,
      (f) => folderOf(f.path)
    )
  }, [ready, kind, groupFiles])

  /** 묶여서 줄어든 건수. 0 이면 묶인 것이 없다. */
  const gathered = ready.length - groups.length

  const analyze = async (): Promise<void> => {
    if (!groups.length) {
      toast('먼저 읽을 수 있는 문서를 올려 주세요.', 'err')
      return
    }

    startJob('문서 분석', groups.length)
    let found = 0

    // 도중에 무엇이 잘못되어도 '학습 중' 을 반드시 풀어야 한다.
    try {
      for (let i = 0; i < groups.length; i++) {
        if (isStopping()) break
        const g = groups[i]
        // 묶음을 대표하는 것은 본문이다. 뽑은 업무가 이 파일에 매달린다.
        const head = g.items[0]
        setJobProgress({ now: g.label, message: `${g.label} 분석 중` })

        const joined = joinNotice(g.items.map((f) => ({ name: f.name, text: f.doc!.text })))
        // 켜 두면 개인정보를 가린 글을 보낸다. 보관하는 원문은 그대로 둔다 —
        // 학교 안에서는 원문이 필요하고, 밖으로 나가는 것만 가리면 되기 때문이다.
        const text = scrub ? (await window.api.privacy.scrub(joined)).text : joined

        const res = await window.api.ai.analyze({
          filename: head.name,
          text,
          kind,
          jobTitle,
          model: model ?? undefined
        })
        if (!res.ok) {
          toast(`${g.label}: ${res.error}`, 'err')
        } else if (res.drafts.length === 0) {
          toast(`${g.label}: 업무로 뽑을 내용을 찾지 못했습니다.`, 'err')
        }
        // 한 건이 끝날 때마다 바로 담는다. 도중에 화면을 옮겨도 남는다.
        addDrafts(res.drafts)
        found += res.drafts.length
        setJobProgress({ done: i + 1 })
      }
    } finally {
      finishJob()
    }
    if (found) toast(`${found}건을 찾았습니다. 확인 후 등록해 주세요.`, 'ok')
  }

  /**
   * 읽어 둔 원문을 보관함에 넣고, 파일명 → 문서 id 를 돌려준다.
   * 나중에 [통합 검색]에서 공문 자체를 찾을 수 있게 하려는 것이다.
   */
  const storeOriginals = async (): Promise<Map<string, number>> => {
    const map = new Map<string, number>()
    if (!keepOriginal) return map

    const ready = files.filter((f) => f.state === '읽음' && f.doc?.text)
    if (!ready.length) return map

    const payload = await Promise.all(
      ready.map(async (f) => ({
        filename: f.name,
        doc_kind: kind,
        doc_date: await window.api.docs.guessDate(f.doc!.text),
        added_at: '',
        content: f.doc!.text,
        school_year: year
      }))
    )

    // 한 번에 넘긴다. 건마다 넘기면 그때마다 DB 전체가 다시 쓰인다.
    const ids = await window.api.docs.addMany(payload)
    ready.forEach((f, i) => map.set(f.name, ids[i]))
    return map
  }

  const registerSelected = async (): Promise<void> => {
    const chosen = drafts.filter((d) => d.selected)
    if (!chosen.length) {
      toast('등록할 항목을 선택해 주세요.', 'err')
      return
    }
    const docIds = await storeOriginals()

    await window.api.tasks.addMany(
      chosen.map((d) => ({
        title: d.title,
        task_date_display: d.task_date_display,
        task_date_raw: d.task_date_raw,
        task_type: kind,
        workflow: d.workflow,
        draft_full: d.draft_full,
        key_points: d.key_points,
        filename: d.filename,
        is_completed: 0,
        // 보관함에서 뽑은 것은 이미 문서 id 를 달고 온다
        document_id: d.document_id ?? docIds.get(d.filename) ?? 0,
        // 보관함에서 뽑은 것은 그 공문의 학년도를 따르고, 새로 올린 것은 위에서 고른 값을 쓴다
        school_year: d.school_year || year
      }))
    )
    clearDrafts()
    setFiles([])
    toast(
      docIds.size
        ? `${schoolYearLabel(year)} 업무 ${chosen.length}건을 등록하고, 공문 원문 ${docIds.size}건을 보관했습니다.`
        : `${schoolYearLabel(year)} 업무 ${chosen.length}건을 등록했습니다.`,
      'ok'
    )
    onGo('로드맵')
  }

  const saveRawAsTask = async (f: FileRow): Promise<void> => {
    if (!f.doc) return

    let docId = 0
    if (keepOriginal && f.doc.text) {
      docId = await window.api.docs.add({
        filename: f.name,
        doc_kind: kind,
        doc_date: await window.api.docs.guessDate(f.doc.text),
        added_at: '',
        content: f.doc.text,
        school_year: year
      })
    }

    await window.api.tasks.add({
      title: f.name.replace(/\.[^.]+$/, ''),
      task_date_display: '수시',
      task_date_raw: '',
      task_type: 'AI 없이 등록',
      workflow: '',
      draft_full: f.doc.text,
      key_points: '',
      filename: f.name,
      is_completed: 0,
      document_id: docId,
      school_year: year
    })
    toast('문서 내용을 그대로 등록했습니다.', 'ok')
  }

  /** AI 분석 없이 원문만 검색용으로 보관한다. */
  const archiveOnly = async (): Promise<void> => {
    const ready = files.filter((f) => f.state === '읽음' && f.doc?.text)
    if (!ready.length) {
      toast('먼저 읽을 수 있는 문서를 올려 주세요.', 'err')
      return
    }
    const payload = await Promise.all(
      ready.map(async (f) => ({
        filename: f.name,
        doc_kind: kind,
        doc_date: await window.api.docs.guessDate(f.doc!.text),
        added_at: '',
        content: f.doc!.text,
        school_year: year
      }))
    )
    await window.api.docs.addMany(payload)
    setFiles([])
    toast(`${schoolYearLabel(year)} 공문 ${ready.length}건을 보관했습니다. [통합 검색]에서 찾을 수 있습니다.`, 'ok')
    onGo('검색')
  }

  /** 검토 목록의 한 줄만 고친다 */
  const editDraft = (i: number, patch: Partial<TaskDraft>): void => {
    setDrafts(drafts.map((x, xi) => (xi === i ? { ...x, ...patch } : x)))
  }

  const readyCount = files.filter((f) => f.state === '읽음').length

  /** 묶음이 눈에 보이도록 같은 공문끼리 붙여 세운다 */
  const shownFiles = useMemo(() => {
    if (kind !== '개별 공문' || !groupFiles) return files
    const order = new Map<string, number>()
    groups.forEach((g, i) => g.items.forEach((f) => order.set(f.path, i)))
    // 아직 읽는 중인 파일은 묶음에 없다. 맨 뒤로 보낸다.
    return [...files].sort(
      (a, b) => (order.get(a.path) ?? 1e9) - (order.get(b.path) ?? 1e9)
    )
  }, [files, groups, kind, groupFiles])

  /** 파일 이름에서 읽어낸 문서번호·본문/첨부. 공문 이름이 아니면 null */
  const noticeTag = (f: FileRow): { number: string; part: string } | null => {
    if (kind !== '개별 공문' || !groupFiles) return null
    return parseNoticeName(f.name)
  }

  /* 업무분장과 맞춰 본 결과. 분장을 안 적었으면 모두 '내 업무' 가 된다. */
  const mineCount = drafts.filter((d) => d.mine !== false).length
  const otherCount = drafts.length - mineCount
  /** 감추기를 켜도 원래 자리(i)는 그대로 들고 다녀야 고칠 수 있다 */
  const rows = drafts
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => !onlyMine || d.mine !== false)

  return (
    <>
      <div className="page-head">
        <h1>문서로 업무 만들기</h1>
        <p>
          업무 길라잡이나 공문을 올리면 AI가 업무 목록으로 정리합니다. 등록 전에 직접 확인하고 고칠
          수 있습니다.
        </p>
      </div>

      {!hasKey && (
        <div className="note note-warn" style={{ marginBottom: 14 }}>
          API 키가 없어 AI 분석은 쓸 수 없습니다. 문서를 올려 내용을 확인하고 그대로 등록하는 것은
          가능합니다.{' '}
          <button className="link" onClick={() => onGo('설정')}>
            설정에서 키 넣기
          </button>
        </div>
      )}

      <div className="viewswitch" style={{ marginBottom: 14 }}>
        <button
          className={`viewswitch-btn ${source === '파일' ? 'active' : ''}`}
          onClick={() => setSource('파일')}
        >
          <span className="viewswitch-icon">📁</span> 파일 올리기
        </button>
        <button
          className={`viewswitch-btn ${source === '보관함' ? 'active' : ''}`}
          onClick={() => setSource('보관함')}
          title="이미 보관해 둔 공문을 파일 고르기 없이 학습시킵니다"
        >
          <span className="viewswitch-icon">🗄</span> 저장된 문서 학습
        </button>
      </div>

      <div className="card">
        <div className="card-title">1. 문서 종류 고르기</div>
        <div className="row">
          {(['길라잡이/매뉴얼', '개별 공문'] as DocKind[]).map((k) => (
            <button
              key={k}
              className={`btn ${kind === k ? 'btn-primary' : ''}`}
              onClick={() => setKind(k)}
            >
              {k === '길라잡이/매뉴얼' ? '📚 길라잡이 · 매뉴얼' : '📃 개별 공문'}
            </button>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          {kind === '길라잡이/매뉴얼'
            ? '문서 안의 모든 업무를 뽑아 연간 로드맵을 만듭니다. 업무분장을 적어 두었으면 내 일만 골라 둡니다.'
            : '공문 한 건을 업무 한 건으로 정리합니다. 붙임과 세부 항목은 그 업무의 “절차”로 들어갑니다.'}
        </p>

        {kind === '길라잡이/매뉴얼' && !roster.trim() && (
          <div className="note note-warn" style={{ marginTop: 10 }}>
            <b>업무분장을 적어 두지 않았습니다.</b> 길라잡이에는 부서 전체의 일이 실려 있어, 적어
            두지 않으면 내가 맡지 않은 일까지 함께 뽑힙니다.{' '}
            <button className="link" onClick={() => onGo('설정')}>
              설정에서 적기
            </button>
          </div>
        )}
      </div>

      {source === '파일' ? (
        <>
        <div className="card">
          <div className="card-title">
            <span>2. 파일 올리기</span>
            <button className="btn btn-sm" onClick={() => void pick()} disabled={busy}>
              ＋ 파일 선택
            </button>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>
            PDF · 한글(hwp, hwpx) · 엑셀(xlsx) · 워드(docx) · 텍스트를 지원합니다. PDF가 가장
            정확합니다.
          </p>

          <YearPicker
            value={year}
            onChange={setYear}
            label="몇 학년도 공문인가요?"
            hint="해가 바뀌어 넘겨줄 때 학년도별로 골라 지울 수 있습니다. 전임자에게 받은 묵은 공문이면 그 해로 바꿔 주세요."
          />

          {kind === '개별 공문' && (
            <label className="row" style={{ gap: 6, cursor: 'pointer', marginBottom: 6 }}>
              <input
                type="checkbox"
                checked={groupFiles}
                onChange={(e) => setGroupFiles(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
              />
              <span className="small">
                같은 문서번호끼리 <b>한 공문으로 묶기</b>{' '}
                <span className="muted">
                  — 나이스에서 받은 (본문)·(첨부) 파일을 한 건으로 봅니다
                </span>
              </span>
            </label>
          )}

          {kind === '개별 공문' && groupFiles && gathered > 0 && (
            <div className="note note-info" style={{ marginBottom: 10 }}>
              파일 <b>{ready.length}개</b>를 공문 <b>{groups.length}건</b>으로 묶었습니다. AI 요청도
              그만큼만 나갑니다.
            </div>
          )}

          <label className="row" style={{ gap: 6, cursor: 'pointer', marginBottom: 6 }}>
            <input
              type="checkbox"
              checked={keepOriginal}
              onChange={(e) => setKeepOriginal(e.target.checked)}
              style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
            />
            <span className="small">
              공문 원문도 함께 보관하기 <span className="muted">— [통합 검색]에서 찾을 수 있습니다</span>
            </span>
          </label>

          <label className="row" style={{ gap: 6, cursor: 'pointer', marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={scrub}
              onChange={(e) => setScrub(e.target.checked)}
              style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
            />
            <span className="small">
              🧹 개인정보를 가리고 AI에 보내기{' '}
              <span className="muted">
                — 이름·연락처·주민등록번호·학번·주소를 ○○○ 으로 덮어 보냅니다. 보관하는 원문은
                그대로 남습니다
              </span>
            </span>
          </label>

          {files.length === 0 ? (
            <div className="empty">아직 올린 파일이 없습니다.</div>
          ) : (
            <div className="list">
              {shownFiles.map((f) => (
                <div className="item" key={f.path}>
                  <div className="item-head">
                    <div style={{ minWidth: 0 }}>
                      <div className="item-title">
                        {noticeTag(f) && (
                          <span
                            className={`badge ${noticeTag(f)!.part === '본문' ? 'badge-accent' : ''}`}
                            title={noticeTag(f)!.number}
                            style={{ marginRight: 6 }}
                          >
                            {noticeTag(f)!.number.split('-').pop()} {noticeTag(f)!.part}
                          </span>
                        )}
                        {f.name}
                      </div>
                      <div className="item-meta">
                        {f.state === '읽음' && `${f.doc?.chars.toLocaleString()}자 읽음`}
                        {f.state === '읽는 중' && '읽는 중…'}
                        {f.state === '대기' && '대기 중'}
                        {f.state === '실패' && '읽기 실패'}
                      </div>
                    </div>
                    <div className="row">
                      {f.doc?.text && (
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => setPreview(preview === f.path ? null : f.path)}
                        >
                          {preview === f.path ? '내용 닫기' : '내용 보기'}
                        </button>
                      )}
                      {f.state === '읽음' && (
                        <button className="btn btn-sm btn-ghost" onClick={() => void saveRawAsTask(f)}>
                          그대로 등록
                        </button>
                      )}
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => setFiles((prev) => prev.filter((x) => x.path !== f.path))}
                        disabled={busy}
                      >
                        제거
                      </button>
                    </div>
                  </div>
                  {f.doc?.error && (
                    <div className="note note-danger" style={{ marginTop: 8 }}>
                      {f.doc.error}
                    </div>
                  )}
                  {preview === f.path && f.doc?.text && (
                    <div className="scroll-box" style={{ marginTop: 8 }}>
                      {f.doc.text.slice(0, 4000)}
                      {f.doc.text.length > 4000 ? '\n\n… (이하 생략)' : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">3. AI로 정리하기</div>
          {hasKey && <ModelPicker feature="analyze" label="문서 분석에 쓸 모델" onReady={setModel} onChange={setModel} />}
          <div className="row">
            <button
              className="btn btn-primary"
              onClick={() => void analyze()}
              disabled={busy || !hasKey || groups.length === 0}
            >
              {busy
                ? '분석 중…'
                : gathered > 0
                  ? `공문 ${groups.length}건 분석 시작`
                  : `${groups.length}개 문서 분석 시작`}
            </button>
            <button
              className="btn"
              onClick={() => void archiveOnly()}
              disabled={busy || readyCount === 0}
            >
              📁 AI 없이 원문만 보관
            </button>
            {busy && <span className="muted small">{progress}</span>}
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            지난 공문을 검색용으로 쌓아두기만 할 때는 “원문만 보관”을 쓰세요. AI 사용료가 들지 않고
            훨씬 빠릅니다.
          </p>
          {busy && (
            <div className="progress" style={{ marginTop: 12 }}>
              <div style={{ width: `${groups.length ? (done / groups.length) * 100 : 0}%` }} />
            </div>
          )}
        </div>
        </>
      ) : (
        <div className="card">
          <div className="card-title">
            <span>2. 저장된 문서 학습하기</span>
          </div>
          {hasKey && (
            <ModelPicker feature="analyze" label="문서 분석에 쓸 모델" onReady={setModel} onChange={setModel} />
          )}
          <StoredDocsLearn
            jobTitle={jobTitle}
            kind={kind}
            model={model}
          />
        </div>
      )}

      {drafts.length > 0 && (
        <div className="card">
          <div className="card-title">
            <span>4. 확인하고 등록하기</span>
            <span className="badge badge-accent">
              {drafts.filter((d) => d.selected).length} / {drafts.length} 선택
            </span>
          </div>

          {otherCount > 0 && (
            <div className="note note-info" style={{ marginBottom: 10 }}>
              업무분장과 맞춰 보니 <b>내 업무 {mineCount}건</b> · <b>다른 부서 {otherCount}건</b>{' '}
              입니다. 내 업무만 켜 두었습니다.
              <div className="small muted" style={{ marginTop: 4 }}>
                가려낸 것이 어긋나면 그냥 켜고 끄시면 됩니다. 등록되는 것은 켜 둔 것뿐입니다.
              </div>
            </div>
          )}

          <div className="row" style={{ marginBottom: 12 }}>
            <button
              className="btn btn-sm"
              onClick={() => setDrafts(drafts.map((d) => ({ ...d, selected: true })))}
            >
              전체 선택
            </button>
            <button
              className="btn btn-sm"
              onClick={() => setDrafts(drafts.map((d) => ({ ...d, selected: false })))}
            >
              전체 해제
            </button>
            {otherCount > 0 && (
              <>
                <button
                  className="btn btn-sm"
                  onClick={() =>
                    setDrafts(drafts.map((d) => ({ ...d, selected: d.mine !== false })))
                  }
                >
                  내 업무만 선택
                </button>
                <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={onlyMine}
                    onChange={(e) => setOnlyMine(e.target.checked)}
                    style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
                  />
                  <span className="small">다른 부서 것 감추기</span>
                </label>
              </>
            )}
            <span className="spacer" />
            <button className="btn btn-primary" onClick={() => void registerSelected()}>
              선택한 항목 등록
            </button>
          </div>

          <div className="list">
            {rows.map(({ d, i }) => (
              <div className="item" key={`${d.filename}-${i}`}>
                <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={d.selected}
                    onChange={(e) =>
                      editDraft(i, { selected: e.target.checked })
                    }
                    style={{ marginTop: 9, width: 15, height: 15, accentColor: 'var(--accent)' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <input
                        type="text"
                        value={d.title}
                        onChange={(e) =>
                          editDraft(i, { title: e.target.value })
                        }
                        style={{ flex: 2, minWidth: 180 }}
                      />
                      <input
                        type="text"
                        value={d.task_date_display}
                        onChange={(e) =>
                          editDraft(i, { task_date_display: e.target.value })
                        }
                        placeholder="시기"
                        style={{ flex: 1, minWidth: 110 }}
                      />
                      {d.mine === false && (
                        <span className="badge badge-warn" title="업무분장에서 찾지 못했습니다">
                          {d.owner || '다른 부서'}
                        </span>
                      )}
                    </div>
                    <div className="item-meta" style={{ marginTop: 6 }}>
                      출처: {d.filename}
                      {d.task_date_raw ? ` · 문서상 시기: ${d.task_date_raw}` : ''}
                    </div>
                    {d.key_points && (
                      <div className="note note-warn" style={{ marginTop: 8 }}>
                        {d.key_points}
                      </div>
                    )}
                    {d.draft_full && (
                      <div className="scroll-box" style={{ marginTop: 8, maxHeight: 150 }}>
                        {d.draft_full}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
