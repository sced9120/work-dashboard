/**
 * HSOrbit 마크 — 궤도(꼬리가 그리는 원) · 가운데 점 · 새벽 4시 자리의 주황 점.
 * 먹색은 글자색(currentColor), 주황은 --hand 를 따라가 밝게 · 어둡게 모두 맞는다.
 * 원본: hsorbit.uk 로고 파일 svg/hsorbit-mark.svg (viewBox 64)
 */
export function OrbitMark({ size = 24, className }: { size?: number; className?: string }): JSX.Element {
  return (
    <svg className={`orbit-mark ${className ?? ''}`.trim()} width={size} height={size} viewBox="0 0 64 64" fill="none" strokeLinecap="round" aria-hidden="true">
      <path d="M12.95 25 A22 22 0 1 1 24.48 56.67" stroke="currentColor" strokeWidth="4.5" />
      <circle cx="32" cy="36" r="9" fill="currentColor" />
      <circle className="orbit-hand" cx="51.05" cy="47" r="5.5" fill="var(--hand, #E07A3F)" />
    </svg>
  )
}

