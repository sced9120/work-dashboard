import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CleanupPlan, YearSummary } from '../../shared/types'
import { currentSchoolYear, schoolYearLabel } from '../../shared/types'
import { useConfirm } from '../lib/confirm'
import { useToast } from '../lib/toast'

interface Props {
  onChanged: () => Promise<void>
}

/** 지워도 되는 것과, 절대 지우지 않는 것 */
const KEEPS = [
  '업무 워크플로우 (그려 둔 흐름도)',
  '문서 서식과 예시 (직접 만든 서식 포함)',
  '업무 상세 가이드',
  '주제 이름표',
  '설정 · 업무분장표'
]

/**
 * 새 학년도 정리.
 *
 * 해가 바뀌면 전임자에게 받은 묵은 공문이 짐이 된다. 그렇다고 통째로
 * 초기화하면 한 해 동안 그려 둔 워크플로우와 만들어 둔 서식까지 날아간다.
 * 그래서 **학년도로 갈라** 지우고, 해를 타지 않는 자산은 남긴다.
 */
export default function YearCleanup({ onChanged }: Props): JSX.Element {
  const toast = useToast()
  const ask = useConfirm()
  const [years, setYears] = useState<YearSummary[]>([])
  const [target, setTarget] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [plan, setPlan] = useState<Omit<CleanupPlan, 'year'>>({
    docs: true,
    tasks: false,
    journal: false,
    events: false
  })

  const load = useCallback(async () => {
    const list = await window.api.years.summary()
    setYears(list)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const now = currentSchoolYear()
  const chosen = useMemo(() => years.find((y) => y.year === target) ?? null, [years, target])
  const unassigned = years.find((y) => y.year === 0)

  const autoAssign = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await window.api.years.auto()
      await load()
      await onChanged()
      toast(
        res.docs || res.tasks
          ? `공문 ${res.docs}건, 업무 ${res.tasks}건에 학년도를 매겼습니다.`
          : '문서 날짜로 매길 수 있는 것이 없습니다. 아래에서 직접 골라 매겨 주세요.',
        res.docs || res.tasks ? 'ok' : 'err'
      )
    } finally {
      setBusy(false)
    }
  }

  const runCleanup = async (): Promise<void> => {
    if (target === null) return
    const label = schoolYearLabel(target)
    const what: string[] = []
    if (plan.docs && chosen?.docs) what.push(`공문 ${chosen.docs}건`)
    if (plan.tasks && chosen?.tasks) what.push(`업무 ${chosen.tasks}건`)
    if (plan.journal) what.push('그 해의 업무 일지')
    if (plan.events) what.push('그 해의 달력 일정')
    if (!what.length) {
      toast('지울 것을 하나는 골라 주세요.', 'err')
      return
    }

    const ok = await ask({
      title: `${label}의 ${what.join(', ')} 을(를) 지울까요?`,
      body: (
        <>
          워크플로우 · 서식 · 예시 · 가이드는 그대로 남습니다.
          <br />
          지우기 전에 백업 파일을 자동으로 남기므로 되돌릴 수 있습니다.
        </>
      ),
      okText: '지우기',
      danger: true
    })
    if (!ok) return

    setBusy(true)
    try {
      const res = await window.api.years.cleanup({ year: target, ...plan })
      await load()
      await onChanged()
      toast(res.message, res.ok ? 'ok' : 'err')
      if (res.ok && res.backup) {
        // 어디에 백업했는지 남겨 두어야 되돌릴 수 있다
        toast(`백업: ${res.backup}`)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="card-title">
        <span>🧹 새 학년도 정리</span>
        <button className="btn btn-sm" onClick={() => void autoAssign()} disabled={busy}>
          📅 날짜로 학년도 매기기
        </button>
      </div>

      <p className="hint" style={{ marginTop: 0 }}>
        해가 바뀌어 넘겨줄 때, <b>지난 학년도 자료만 골라 지웁니다.</b> 한 해 동안 그려 둔
        워크플로우와 만들어 둔 서식은 그대로 두고, 묵은 공문만 덜어 내려는 것입니다.
      </p>

      {unassigned && (unassigned.docs > 0 || unassigned.tasks > 0) && (
        <div className="note note-warn" style={{ marginBottom: 12 }}>
          <b>학년도를 매기지 않은 자료가 있습니다</b> — 공문 {unassigned.docs}건, 업무{' '}
          {unassigned.tasks}건.
          <div style={{ marginTop: 6 }}>
            <b>[📅 날짜로 학년도 매기기]</b> 를 누르면 문서에서 찾은 접수일자로 자동으로 매깁니다.
            날짜를 못 찾은 것은 그대로 남으니, 아래에서 <b>학년도 미지정</b>을 골라 한꺼번에
            처리하시면 됩니다.
          </div>
        </div>
      )}

      {years.length === 0 ? (
        <div className="empty">아직 쌓인 자료가 없습니다.</div>
      ) : (
        <div className="list">
          {years.map((y) => (
            <div className="item" key={y.year}>
              <div className="item-head">
                <label className="row" style={{ gap: 8, cursor: 'pointer', minWidth: 0 }}>
                  <input
                    type="radio"
                    checked={target === y.year}
                    onChange={() => setTarget(y.year)}
                    style={{ width: 15, height: 15, accentColor: 'var(--accent)' }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div className="item-title">
                      {schoolYearLabel(y.year)}
                      {y.year === now && (
                        <span className="badge badge-accent" style={{ marginLeft: 8 }}>
                          올해
                        </span>
                      )}
                    </div>
                    <div className="item-meta">
                      공문 {y.docs.toLocaleString()}건 · 업무 {y.tasks.toLocaleString()}건
                    </div>
                  </div>
                </label>
                {y.year === now && <span className="badge badge-warn">지우지 마세요</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {target !== null && (
        <>
          <div className="field" style={{ marginTop: 14 }}>
            <label>{schoolYearLabel(target)}에서 무엇을 지울까요?</label>
            {(
              [
                ['docs', '공문 원문', `${chosen?.docs ?? 0}건 — 학습에 쓴 원문. 통합 검색에서 사라집니다`],
                ['tasks', '업무 목록', `${chosen?.tasks ?? 0}건 — 로드맵에서 사라집니다`],
                ['journal', '업무 일지', '그 학년도(3월~이듬해 2월)에 쓴 일지'],
                ['events', '달력 일정', '그 학년도에 넣어 둔 일정']
              ] as const
            ).map(([key, label, note]) => (
              <label
                className="row"
                key={key}
                style={{ gap: 6, cursor: 'pointer', marginBottom: 6, alignItems: 'flex-start' }}
              >
                <input
                  type="checkbox"
                  checked={plan[key]}
                  onChange={(e) => setPlan({ ...plan, [key]: e.target.checked })}
                  style={{ width: 15, height: 15, accentColor: 'var(--accent)', marginTop: 4 }}
                />
                <span className="small">
                  <b>{label}</b> <span className="muted">— {note}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="note note-ok" style={{ marginBottom: 12 }}>
            <b>이런 것은 지우지 않습니다.</b>
            <div className="cal-tasklist" style={{ marginTop: 8 }}>
              {KEEPS.map((k) => (
                <span key={k} className="badge">
                  {k}
                </span>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              해를 타지 않는 자산이라 그대로 두어야, 다음 담당자가 이어서 쓸 수 있습니다.
            </div>
          </div>

          {plan.docs && !plan.tasks && (
            <div className="note note-info" style={{ marginBottom: 12 }}>
              공문만 지우고 <b>업무는 남깁니다.</b> 로드맵의 "작년에 이런 일을 했다" 는 그대로
              남고, 원문 보기만 사라집니다. 대개 이쪽을 권합니다.
            </div>
          )}

          {target === now && (
            <div className="note note-danger" style={{ marginBottom: 12 }}>
              <b>올해 자료를 지우려 하고 있습니다.</b> 정말 이 학년도가 맞는지 다시 봐 주세요.
            </div>
          )}

          <div className="row">
            <button className="btn btn-danger" onClick={() => void runCleanup()} disabled={busy}>
              {busy ? '지우는 중…' : `🗑 ${schoolYearLabel(target)} 자료 지우기`}
            </button>
            <span className="muted small">지우기 전에 백업을 자동으로 남깁니다</span>
          </div>
        </>
      )}
    </div>
  )
}
