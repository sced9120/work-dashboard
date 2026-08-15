import { useEffect, useState } from 'react'
import type { Task, TaskInput } from '../../shared/types'

export const BLANK: TaskInput = {
  title: '',
  task_date_display: '',
  task_date_raw: '',
  task_type: '직접 등록',
  workflow: '',
  draft_full: '',
  key_points: '',
  filename: '',
  is_completed: 0,
  document_id: 0
}

interface Props {
  /** 수정 대상. 없으면 새로 등록하는 형태가 된다. */
  task?: Task
  onSave: (value: TaskInput) => Promise<void> | void
  onCancel?: () => void
  saveLabel?: string
}

export default function TaskForm({ task, onSave, onCancel, saveLabel }: Props): JSX.Element {
  const [value, setValue] = useState<TaskInput>(BLANK)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (task) {
      const { id: _id, ...rest } = task
      setValue(rest)
    } else {
      setValue(BLANK)
    }
  }, [task])

  const set = (patch: Partial<TaskInput>): void => setValue((v) => ({ ...v, ...patch }))

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      await onSave(value)
      if (!task) setValue(BLANK)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="field">
        <label>업무명</label>
        <input
          type="text"
          value={value.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="예: 학교생활기록부 정정 대장 정리"
        />
      </div>

      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label>시기</label>
          <input
            type="text"
            value={value.task_date_display}
            onChange={(e) => set({ task_date_display: e.target.value })}
            placeholder="예: 3월 1주, 수시"
          />
          <div className="hint">“○월 ○주” 형식으로 적으면 로드맵에서 자동 정렬됩니다.</div>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 160 }}>
          <label>원본 날짜 (선택)</label>
          <input
            type="text"
            value={value.task_date_raw}
            onChange={(e) => set({ task_date_raw: e.target.value })}
            placeholder="예: 2026-03-05 접수"
          />
        </div>
      </div>

      <div className="field">
        <label>처리 절차</label>
        <textarea
          value={value.workflow}
          onChange={(e) => set({ workflow: e.target.value })}
          placeholder={'1. 공문 접수\n2. 기안 작성\n3. 결재 후 회신'}
        />
      </div>

      <div className="field">
        <label>핵심 유의사항</label>
        <textarea
          value={value.key_points}
          onChange={(e) => set({ key_points: e.target.value })}
          placeholder="놓치기 쉬운 부분, 담당 부서 연락처 등"
          style={{ minHeight: 70 }}
        />
      </div>

      <div className="field">
        <label>상세 본문</label>
        <textarea
          value={value.draft_full}
          onChange={(e) => set({ draft_full: e.target.value })}
          placeholder="공문 원문이나 자세한 설명"
          style={{ minHeight: 160 }}
        />
      </div>

      <div className="row row-end">
        {onCancel && (
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            취소
          </button>
        )}
        <button
          className="btn btn-primary"
          onClick={() => void submit()}
          disabled={busy || !value.title.trim()}
        >
          {saveLabel ?? '저장'}
        </button>
      </div>
    </div>
  )
}
