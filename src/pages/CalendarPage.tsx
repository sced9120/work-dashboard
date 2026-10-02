import { useCallback, useEffect, useState } from 'react'
import type { Task } from '../../shared/types'
import Calendar from '../components/Calendar'
import ScheduleImport from '../components/ScheduleImport'
import type { PageId } from '../App'

interface Props {
  onGo: (p: PageId) => void
}

/**
 * 달력만 크게 보는 화면.
 * 로드맵 안에 있을 때는 좁아서 한 칸에 일정이 두세 개밖에 안 보였다.
 */
export default function CalendarPage({ onGo }: Props): JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([])
  const [importing, setImporting] = useState(false)
  /** 학사일정을 넣은 뒤 달력을 다시 그린다 */
  const [round, setRound] = useState(0)

  const load = useCallback(async () => {
    setTasks(await window.api.tasks.list())
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <div className="page-head page-head-row">
        <div>
          <h1>달력</h1>
          <p>일정과 절차 기한을 한 달씩 봅니다. 날짜를 두 번 누르면 바로 일정을 넣습니다.</p>
        </div>
        {!importing && (
          <button className="btn" onClick={() => setImporting(true)}>
            📥 나이스 학사일정 가져오기
          </button>
        )}
      </div>
      {importing && (
        <ScheduleImport onDone={() => setRound((r) => r + 1)} onClose={() => setImporting(false)} onGo={onGo} />
      )}
      <Calendar key={round} tasks={tasks} big onShrink={() => onGo('홈')} />
    </>
  )
}
