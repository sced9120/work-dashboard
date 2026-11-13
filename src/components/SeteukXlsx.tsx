import { useState } from 'react'
import type { XlsxPreview } from '../../shared/seteukXlsx'
import { useToast } from '../lib/toast'

/**
 * 세특 작성실 — 엑셀로 주고받기.
 * 내보낸 파일은 세특 시트와 같은 모양(활동마다 '○○ ▸입력' 시트)이라 다른 PC 의 작성실에서 다시 읽거나,
 * 관찰 메모 · AI 결과 · 최종본 열을 세특 시트의 같은 칸에 붙여 넣을 수 있다.
 * 가져올 때는 무엇이 바뀌는지 먼저 보여 주고, 눌러야 합친다. 지우는 것은 없다.
 */
interface Props {
  /** 합친 뒤 — 화면의 자료를 다시 읽는다 */
  onImported: () => void
  onClose: () => void
}

export default function SeteukXlsx({ onImported, onClose }: Props): JSX.Element {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [pv, setPv] = useState<XlsxPreview | null>(null)
  const [overwrite, setOverwrite] = useState(false)

  const exportNow = async (): Promise<void> => {
    setBusy(true)
    const r = await window.api.seteuk.xlsxExport()
    setBusy(false)
    if (r.message !== '취소했습니다.') toast(r.message, r.ok ? 'ok' : 'err')
  }
  const pick = async (): Promise<void> => {
    setBusy(true)
    const r = await window.api.seteuk.xlsxPick()
    setBusy(false)
    if (!r) return
    setOverwrite(false)
    setPv(r)
  }
  const toggle = async (v: boolean): Promise<void> => {
    setOverwrite(v)
    if (pv?.id) setPv(await window.api.seteuk.xlsxPreview(pv.id, v))
  }
  const apply = async (): Promise<void> => {
    if (!pv?.id) return
    setBusy(true)
    const r = await window.api.seteuk.xlsxApply(pv.id, overwrite)
    setBusy(false)
    if (!r.ok || !r.report) return toast(r.error ?? '가져오지 못했습니다.', 'err')
    toast(`가져왔습니다 — 새 학생 ${r.report.newStudents}명 · 새 활동 ${r.report.newActs.length}개 · 채운 칸 ${r.report.cells}개.`, 'ok')
    setPv(null)
    onImported()
  }

  const rep = pv?.report
  const nothing = rep ? !rep.cells && !rep.newStudents && !rep.newActs.length : false

  return (
    <div className="card stk-xlsx">
      <div className="stk-import-head">
        <b>엑셀로 주고받기</b>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          닫기
        </button>
      </div>
      <div className="stk-xlsx-cols">
        <div>
          <p className="small">
            <b>내보내기</b> — 명단 · 활동 · 관찰 기록 · AI 초안 · 최종본 · 취합을 엑셀 한 파일로 저장합니다. 다른 PC 의 작성실에서 다시
            읽거나, 열을 복사해 세특 시트의 같은 칸에 붙여 넣을 수 있습니다.
          </p>
          <p className="note note-warn small">파일에 학생 이름과 글이 그대로 들어갑니다. 개인 PC · 공유 폴더에 둘 때 조심하세요.</p>
          <button className="btn btn-sm" onClick={() => void exportNow()} disabled={busy}>
            엑셀로 내보내기
          </button>
        </div>
        <div>
          <p className="small">
            <b>가져오기</b> — 세특 시트(구글 시트)에서 <b>[파일 → 다운로드 → Microsoft Excel]</b> 로 받은 파일이나, 여기서 내보낸 파일을
            고릅니다. 활동마다 있는 <b>○○ ▸입력</b> 시트의 관찰 기록 · AI 결과 · 최종본을 읽습니다. 이 PC 에서만 읽고 어디로도 보내지
            않습니다.
          </p>
          <button className="btn btn-sm" onClick={() => void pick()} disabled={busy}>
            파일 고르기
          </button>
        </div>
      </div>

      {pv && (
        <div className="stk-found">
          {!pv.ok || !rep ? (
            <p className="note note-danger small">{pv.error ?? '파일을 읽지 못했습니다.'}</p>
          ) : (
            <>
              <p className="small">
                <b>{pv.file}</b> — 학생 {rep.students}명 · 활동 {rep.acts}개가 들어 있습니다.
              </p>
              <ul className="stk-found-list small">
                <li>
                  <b>명단</b> 새로 더하는 학생 {rep.newStudents}명
                </li>
                {rep.newActs.length > 0 && (
                  <li>
                    <b>새 활동 {rep.newActs.length}개</b> {rep.newActs.join(', ')}
                  </li>
                )}
                {rep.mergedActs.length > 0 && (
                  <li>
                    <b>이름이 같아 합치는 활동 {rep.mergedActs.length}개</b> {rep.mergedActs.join(', ')}
                  </li>
                )}
                <li>
                  <b>채우는 칸 {rep.cells}개</b>
                  {rep.kept > 0 && <span className="muted"> · 이미 글이 있어 그대로 두는 칸 {rep.kept}개</span>}
                </li>
                {rep.mismatched.map((m, i) => (
                  <li key={i} className="stk-over">
                    <b>이름이 달라 넣지 않음</b> {m}
                  </li>
                ))}
              </ul>
              <label className="stk-agree small">
                <input type="checkbox" checked={overwrite} onChange={(e) => void toggle(e.target.checked)} disabled={busy} />
                이미 글이 있는 칸도 파일의 글로 바꾸기
              </label>
              <div className="row">
                <button className="btn btn-primary btn-sm" onClick={() => void apply()} disabled={busy || nothing}>
                  {nothing ? '새로 넣을 것이 없습니다' : '합치기'}
                </button>
                <span className="small muted">지우는 것은 없습니다. 파일에서 비어 있는 칸은 지금 글을 그대로 둡니다.</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
