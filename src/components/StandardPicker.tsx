/**
 * [성취기준 찾기] 창 (3.8.0~) — 고른 성취기준을 "[코드] 문장" 줄로 돌려준다.
 * 세특 [활동 설정] 창(z 300) 위에, 확인 창(z 400) 아래에 뜬다.
 */
import { useEffect } from 'react'
import type { SchoolLevel, Standard } from '../../shared/curriculum'
import { standardLines } from '../../shared/curriculum'
import StandardFinder from './StandardFinder'

interface Props {
  title?: string
  initialLevel?: SchoolLevel | ''
  initialQuery?: string
  onPick: (lines: string, picked: Standard[]) => void
  onClose: () => void
}

/** 칸에 이미 있는 글 뒤에 고른 줄을 붙인다 — 같은 코드는 다시 넣지 않는다 */
export function appendStandards(current: string, picked: Standard[]): string {
  const have = current
  const add = picked.filter((s) => !have.includes(s.code))
  if (!add.length) return current
  const body = standardLines(add)
  return current.trim() ? `${current.replace(/\s+$/, '')}\n${body}` : body
}

export default function StandardPicker({ title = '성취기준 찾기', initialLevel, initialQuery, onPick, onClose }: Props): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="std-pick-back" onClick={onClose}>
      <div className="std-pick" role="dialog" aria-modal="true" aria-labelledby="std-pick-title" onClick={(e) => e.stopPropagation()}>
        <div className="std-pick-head">
          <b id="std-pick-title">{title}</b>
          <span className="small muted">2022 개정 교육과정 · 고른 것을 「[코드] 문장」 한 줄씩 넣습니다</span>
          <span className="spacer" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="닫기">
            닫기
          </button>
        </div>
        <StandardFinder
          compact
          initialLevel={initialLevel}
          initialQuery={initialQuery}
          actions={[
            {
              label: '고른 것 넣기',
              primary: true,
              run: (picked) => {
                onPick(standardLines(picked), picked)
                onClose()
              }
            }
          ]}
        />
      </div>
    </div>
  )
}
