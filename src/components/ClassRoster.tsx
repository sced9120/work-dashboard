import { useEffect, useState } from 'react'
import type { PageId } from '../App'
import { ATT_ROSTER_KEY, parseRoster, readRoster } from '../../shared/attendance'
import type { Roster, Student } from '../../shared/attendance'
import type { CounselMeta } from '../../shared/counsel'
import { useConfirm } from '../lib/confirm'
import { queueCounselStudent } from '../lib/counselNav'
import { useToast } from '../lib/toast'

/**
 * 학생 명단 — 우리 반 명단(출결과 같은 명단)을 보고 고친다.
 * 학부모 연락처 · 메모는 명단 모양을 바꾸지 않으려고 번호로 상담 기록 쪽(counsel_meta)에 따로 둔다.
 * 이 PC 에만 두고 인수인계 파일에는 넣지 않는다.
 */
export default function ClassRoster({ onGo }: { onGo: (p: PageId) => void }): JSX.Element {
  void onGo
  const toast = useToast()
  const ask = useConfirm()
  const [roster, setRoster] = useState<Roster | null>(null)
  const [meta, setMeta] = useState<CounselMeta>({ teacher: '', students: {} })
  const [paste, setPaste] = useState(false)
  const [text, setText] = useState('')

  useEffect(() => {
    void (async () => {
      const r = readRoster(await window.api.setting.get(ATT_ROSTER_KEY, ''))
      if (!r.cls) r.cls = (await window.api.setting.get('my_class', '')) || ''
      setRoster(r)
      setMeta((await window.api.counsel.load()).meta)
      if (!r.students.length) setPaste(true)
    })()
  }, [])

  if (!roster) return <p className="muted small">불러오는 중…</p>

  const save = (r: Roster): void => {
    setRoster(r)
    void window.api.setting.set(ATT_ROSTER_KEY, JSON.stringify(r))
  }
  const editStudent = (no: number, patch: Partial<Student>): void => {
    const next = roster.students.map((s) => (s.no === no ? { ...s, ...patch } : s))
    if (patch.no !== undefined && (!Number.isInteger(patch.no) || patch.no <= 0 || next.filter((s) => s.no === patch.no).length > 1)) {
      toast('번호는 1 이상이고 겹치면 안 됩니다.', 'err')
      return
    }
    save({ ...roster, students: next.sort((a, b) => a.no - b.no) })
  }
  const move = (from: number, to: number): void => {
    // 번호를 바꾸면 그 번호로 적어 둔 연락처 · 메모도 같이 옮긴다
    const m = meta.students[String(from)]
    editStudent(from, { no: to })
    if (m && !meta.students[String(to)]) {
      void window.api.counsel.meta({ no: to, contact: m.contact, memo: m.memo }).then(setMeta)
      void window.api.counsel.meta({ no: from, contact: '', memo: '' }).then(setMeta)
    }
  }
  const addStudent = (): void => {
    const no = Math.max(0, ...roster.students.map((s) => s.no)) + 1
    save({ ...roster, students: [...roster.students, { no, name: '새 학생' }] })
  }
  const remove = async (s: Student): Promise<void> => {
    const ok = await ask({
      title: `${s.no}번 ${s.name} 을(를) 명단에서 뺄까요?`,
      body: '출결 · 상담 기록 화면의 명단에서도 빠집니다. 이미 적은 상담 기록은 지워지지 않습니다.',
      okText: '빼기',
      danger: true
    })
    if (ok) save({ ...roster, students: roster.students.filter((x) => x.no !== s.no) })
  }
  const metaSave = (no: number, patch: { contact?: string; memo?: string }): void => {
    const cur = meta.students[String(no)]
    if ((cur?.contact ?? '') === (patch.contact ?? cur?.contact ?? '') && (cur?.memo ?? '') === (patch.memo ?? cur?.memo ?? '')) return
    void window.api.counsel.meta({ no, ...patch }).then(setMeta)
  }
  const applyPaste = async (): Promise<void> => {
    const list = parseRoster(text)
    if (!list.length) return toast('읽은 학생이 없습니다. 한 줄에 \'번호 이름\' 으로 적어 주세요.', 'err')
    if (roster.students.length) {
      const ok = await ask({ title: `명단을 ${list.length}명으로 바꿀까요?`, body: `지금 명단 ${roster.students.length}명은 붙여 넣은 명단으로 바뀝니다. 연락처 · 메모는 번호가 같으면 그대로 이어집니다.`, okText: '바꾸기' })
      if (!ok) return
    }
    save({ ...roster, students: list })
    setPaste(false)
    setText('')
    toast(`명단 ${list.length}명을 저장했습니다.`, 'ok')
  }

  return (
    <div className="cr-wrap">
      <section className="card">
        <div className="cr-head">
          <label className="check-row">
            반
            <input type="text" value={roster.cls} onChange={(e) => setRoster({ ...roster, cls: e.target.value })} onBlur={() => save(roster)} placeholder="예: 2-4" style={{ width: 80 }} aria-label="반 이름" />
          </label>
          <b className="cr-count">명단 {roster.students.length}명</b>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={() => setPaste((v) => !v)}>
            {paste ? '붙여 넣기 닫기' : '붙여 넣어 바꾸기'}
          </button>
          <button className="btn btn-sm btn-primary" onClick={addStudent}>
            ＋ 학생 추가
          </button>
        </div>
        <p className="muted small">출결 화면의 &lsquo;우리 반 명단&rsquo; 과 같은 명단입니다. 학부모 연락 · 메모는 이 PC 에만 두고 인수인계 파일에는 넣지 않습니다.</p>

        {paste && (
          <div className="cr-paste">
            <p className="muted small">한 줄에 한 명 — &lsquo;1 홍길동&rsquo; · &lsquo;20401 홍길동&rsquo;(학번) · 엑셀에서 번호 · 이름 두 칸을 복사해 붙여 넣어도 됩니다.</p>
            <textarea className="att-roster-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={'1 가나다\n2 라마바'} aria-label="붙여 넣을 명단" />
            <div className="row row-end" style={{ gap: 8, marginTop: 8 }}>
              <span className="muted small">읽은 학생 {parseRoster(text).length}명</span>
              <button className="btn btn-primary btn-sm" onClick={() => void applyPaste()} disabled={!text.trim()}>
                명단으로 저장
              </button>
            </div>
          </div>
        )}
      </section>

      {roster.students.length > 0 && (
        <section className="card cr-table-card">
          <div className="att-table-wrap">
            <table className="cr-table">
              <thead>
                <tr>
                  <th style={{ width: 64 }}>번호</th>
                  <th style={{ width: 130 }}>이름</th>
                  <th>학부모 연락</th>
                  <th>메모</th>
                  <th style={{ width: 150 }} />
                </tr>
              </thead>
              <tbody>
                {roster.students.map((s) => {
                  const m = meta.students[String(s.no)]
                  return (
                    <tr key={s.no}>
                      <td>
                        <input type="number" min={1} defaultValue={s.no} key={`n${s.no}`} onBlur={(e) => Number(e.target.value) !== s.no && move(s.no, Number(e.target.value))} aria-label={`${s.name} 번호`} className="cr-no" />
                      </td>
                      <td>
                        <input type="text" defaultValue={s.name} key={`m${s.no}${s.name}`} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.name && editStudent(s.no, { name: e.target.value.trim() })} aria-label={`${s.no}번 이름`} />
                      </td>
                      <td>
                        <input type="text" defaultValue={m?.contact ?? ''} key={`c${s.no}${m?.contact ?? ''}`} onBlur={(e) => metaSave(s.no, { contact: e.target.value })} placeholder="예: 어머니 010-0000-0000" aria-label={`${s.no}번 학부모 연락`} />
                      </td>
                      <td>
                        <input type="text" defaultValue={m?.memo ?? ''} key={`o${s.no}${m?.memo ?? ''}`} onBlur={(e) => metaSave(s.no, { memo: e.target.value })} placeholder="메모" aria-label={`${s.no}번 메모`} />
                      </td>
                      <td className="cr-act">
                        <button className="btn btn-sm" onClick={() => queueCounselStudent(s.no)}>
                          상담 기록
                        </button>
                        <button className="btn btn-sm btn-ghost danger" onClick={() => void remove(s)} aria-label={`${s.no}번 ${s.name} 빼기`}>
                          삭제
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
