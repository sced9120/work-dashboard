/**
 * 글자 한 자 타일 — 문서 종류 · 도구처럼 이모지를 아이콘으로 쓰던 자리에 이름의 첫 글자를 둔다.
 * (이모지는 PC 마다 그림이 달라 보이고 'AI 가 만든 화면' 같은 인상을 줘서 3.6.3 에서 걷어 냈다)
 */
export default function Mono({ name, size = 28, className }: { name: string; size?: number; className?: string }): JSX.Element {
  const ch = (name.replace(/^[^0-9A-Za-z가-힣]+/, '').trim()[0] ?? '·').toUpperCase()
  return (
    <span className={`mono ${className ?? ''}`.trim()} style={{ width: size, height: size, fontSize: Math.round(size * 0.48) }} aria-hidden="true">
      {ch}
    </span>
  )
}
