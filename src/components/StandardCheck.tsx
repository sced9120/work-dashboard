/**
 * 글 속 성취기준 코드 확인 (3.8.0~) — 2022 개정 자료에 없는 코드가 있으면 알린다.
 * AI 가 코드를 지어냈거나 옛 교육과정(2015 개정) 코드를 썼을 때 잡는다.
 */
import { useEffect, useState } from 'react'

export default function StandardCheck({ text }: { text: string }): JSX.Element | null {
  const [unknown, setUnknown] = useState<string[]>([])
  const [found, setFound] = useState(0)

  useEffect(() => {
    if (!text.includes('[')) {
      setUnknown([])
      setFound(0)
      return
    }
    let live = true
    const t = window.setTimeout(() => {
      void window.api.curriculum
        .check(text)
        .then((r) => {
          if (!live) return
          setUnknown(r.unknown)
          setFound(r.found.length)
        })
        .catch(() => undefined)
    }, 500)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [text])

  if (!found) return null
  if (!unknown.length) return <p className="std-check std-check-ok small">✓ 성취기준 코드 {found}개가 모두 2022 개정 교육과정 자료에 있습니다.</p>
  return (
    <div className="note note-warn small std-check" role="status">
      <b>2022 개정 자료에 없는 성취기준 코드 {unknown.length}개</b> — {unknown.join(' ')}
      <br />
      지어낸 코드이거나 옛 교육과정 코드일 수 있습니다. [성취기준 찾기]로 맞는 코드를 확인해 주세요.
    </div>
  )
}
