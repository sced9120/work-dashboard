/**
 * 성취기준 찾기 화면 (3.8.0~) — 2022 개정 교육과정 초 · 중 · 고 성취기준 4,451개.
 * 인터넷 없이 프로그램 안의 자료로 찾는다. 고른 것을 복사하거나 메모장으로 보낸다.
 */
import type { Standard } from '../../shared/curriculum'
import { standardLines } from '../../shared/curriculum'
import type { PageId } from '../App'
import StandardFinder from '../components/StandardFinder'
import { useToast } from '../lib/toast'

export default function Standards({ onGo }: { onGo: (p: PageId) => void }): JSX.Element {
  const toast = useToast()

  const copy = async (picked: Standard[], withNote: boolean): Promise<void> => {
    const text = withNote
      ? picked.map((s) => `${s.code} ${s.content}${s.note ? `\n  해설: ${s.note}` : ''}`).join('\n')
      : standardLines(picked)
    await window.api.clipboard.write(text)
    toast(`${picked.length}개를 복사했습니다. 한글 · 세특 칸에 붙여 넣으세요.`, 'ok')
  }

  return (
    <>
      <div className="page-head">
        <h1>성취기준 찾기</h1>
        <p>
          2022 개정 교육과정 초 · 중 · 고 성취기준을 학교급 · 과목 · 낱말로 찾습니다. 고른 것은 「[코드] 문장」 한 줄씩 복사됩니다. 인터넷 없이
          프로그램 안의 자료로 찾습니다.
        </p>
      </div>
      <div className="card">
        <StandardFinder
          actions={[
            { label: '해설까지 복사', run: (p) => void copy(p, true) },
            { label: '고른 것 복사', primary: true, run: (p) => void copy(p, false) }
          ]}
        />
      </div>
      <div className="note note-info small">
        세특 작성실의 <b>[활동 설정]</b>, 학교 문서 만들기의 <b>교수 · 학습 및 평가계획서 · 수행평가 채점기준표</b>, <b>교과진도 계획</b>에서도 [성취기준 찾기]로 바로
        넣을 수 있습니다.{' '}
        <button type="button" className="link" onClick={() => onGo('진도계획')}>
          교과진도 계획 열기
        </button>
      </div>
    </>
  )
}
