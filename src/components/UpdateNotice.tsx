import { useEffect } from 'react'
import type { UpdateInfo } from '../../shared/types'

interface Props {
  info: UpdateInfo
  /** 받는 중이면 진행률(0~100), 다 받았으면 'done', 아직이면 null */
  progress: number | 'done' | null
  error: string
  onDownload: () => void
  onInstall: () => void
  onOpenPage: () => void
  /** 받기 전에 [나중에] — 이번 판은 그만 묻는다 */
  onLater: () => void
  /** 받기 시작한 뒤 [닫기] — 창만 닫는다. 받기는 뒤에서 계속된다 */
  onClose: () => void
}

/** 지금 어느 단계인가 */
export type UpdatePhase = '받기 전' | '받는 중' | '확인 중' | '다 받음'

/**
 * 진행 값을 단계로 바꾼다.
 *
 * 100% 를 채웠는데 아직 "다 받음" 이 아니면 확인 중이다. electron-updater 는
 * 받은 뒤 서명을 확인하고 파일 이름을 바꾸는데, 백신이 새 exe 를 붙잡으면
 * 이름 바꾸기를 30초까지 다시 시도한다. 그동안 100% 만 떠 있으면 멈춘 줄 안다.
 */
export function phaseOf(progress: number | 'done' | null): UpdatePhase {
  if (progress === null) return '받기 전'
  if (progress === 'done') return '다 받음'
  return progress >= 100 ? '확인 중' : '받는 중'
}

/** 이 버전의 팝업을 이미 닫았는지 기억해 둘 곳 */
const SEEN_KEY = 'update-seen'

/** 이미 본 버전인가. 창을 열 때마다 같은 팝업이 뜨면 성가시다. */
export function alreadySeen(version: string): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === version
  } catch {
    return false
  }
}

export function markSeen(version: string): void {
  try {
    window.localStorage.setItem(SEEN_KEY, version)
  } catch {
    // 저장이 막혀 있어도 팝업은 떠야 한다. 다음에 한 번 더 뜨는 것뿐이다.
  }
}

export interface NoteBlock {
  kind: 'item' | 'para'
  text: string
}

/**
 * 커밋 메시지에 쓴 마크다운 표시를 벗긴다.
 *
 * 팝업은 글자만 그리므로 `**굵게**` 가 별표째 보인다. 굵게 칠하지는 않더라도
 * 별표는 걷어 내야 읽을 만하다.
 */
function plain(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * 릴리스 설명을 화면에 맞게 나눈다.
 *
 * 설명은 태그를 붙인 커밋 메시지를 그대로 올린 것이다. 첫 줄이
 * "v2.6.3: 무엇을 고쳤다" 꼴이라 그것을 제목으로 쓴다.
 *
 * 커밋 메시지는 여든 자쯤에서 손으로 줄을 바꿔 두었으므로 줄 단위로 그리면
 * 한 문단이 여러 토막으로 흩어진다. 빈 줄이 나올 때까지, 또는 다음 "- " 가
 * 나올 때까지 이어 붙여 한 덩어리로 만든다.
 */
export function splitNotes(notes: string): { head: string; blocks: NoteBlock[] } {
  const lines = notes.replace(/\r\n?/g, '\n').split('\n')
  if (!lines.length) return { head: '', blocks: [] }

  // "v2.6.3: 제목" 에서 버전 표시는 이미 위에 크게 있으므로 뗀다.
  const head = plain((lines[0] ?? '').trim().replace(/^v?\d+(\.\d+)*\s*[:：]\s*/, ''))

  const blocks: NoteBlock[] = []
  const push = (kind: NoteBlock['kind'], text: string): void => {
    const t = plain(text)
    if (t) blocks.push({ kind, text: t })
  }

  let kind: NoteBlock['kind'] = 'para'
  let buf = ''

  for (const raw of lines.slice(1)) {
    const line = raw.trimEnd()

    // 빈 줄이면 덩어리를 끊는다.
    if (!line.trim()) {
      push(kind, buf)
      buf = ''
      kind = 'para'
      continue
    }

    const bullet = /^\s*[-*·]\s+/.exec(line)
    if (bullet) {
      push(kind, buf)
      buf = line.slice(bullet[0].length)
      kind = 'item'
      continue
    }

    // 이어지는 줄. 우리말은 줄 끝에 띄어쓰기가 없으므로 한 칸 넣어 붙인다.
    buf = buf ? `${buf} ${line.trim()}` : line.trim()
  }
  push(kind, buf)

  return { head, blocks }
}

/**
 * 새 버전이 나왔을 때 뜨는 팝업.
 *
 * 무엇이 달라졌는지 먼저 보여 주고 나서 받을지 묻는다.
 * 예전에는 위쪽에 띠만 떠서, 무엇이 바뀌는지 모른 채 누르거나 그냥 지나쳤다.
 */
export default function UpdateNotice({
  info,
  progress,
  error,
  onDownload,
  onInstall,
  onOpenPage,
  onLater,
  onClose
}: Props): JSX.Element {
  const { head, blocks } = splitNotes(info.notes ?? '')
  const phase = phaseOf(progress)
  /** 받기를 누른 뒤에는 [나중에] 가 아니라 [닫기] 다 */
  const dismiss = phase === '받기 전' ? onLater : onClose

  // Esc 로 닫는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dismiss])

  return (
    <div className="ask-back" onClick={dismiss}>
      <div
        className="ask update-ask"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ask-title">
          새 버전 <span className="update-ver">{info.latest}</span> 이 나왔습니다
          <div className="small muted" style={{ fontWeight: 400, marginTop: 4 }}>
            지금 쓰는 것은 {info.current} 입니다.
          </div>
        </div>

        {head && <div className="update-head">{head}</div>}

        {blocks.length > 0
          ? (
              <div className="update-notes">
                {blocks.map((b, i) => (
                  <div key={i} className={b.kind === 'item' ? 'update-item' : 'update-para'}>
                    {b.text}
                  </div>
                ))}
              </div>
            )
          : !head && (
              <div className="ask-body">
                무엇이 달라졌는지는 [자세히 보기]에서 확인하실 수 있습니다.
              </div>
            )}

        {phase === '받기 전' && (
          <div className="note note-info" style={{ marginTop: 14, marginBottom: 0 }}>
            업데이트해도 <b>정리해 둔 업무·공문·기한은 그대로 남습니다.</b>
            {!info.canAutoInstall && ' 무설치(Portable)로 쓰고 계셔서 직접 받아 바꿔야 합니다.'}
          </div>
        )}

        {(phase === '받는 중' || phase === '확인 중') && (
          <div className="update-progress">
            <div className="row" style={{ marginBottom: 6 }}>
              <b className="small">
                {phase === '받는 중' ? `받는 중… ${progress as number}%` : '받은 파일을 확인하는 중…'}
              </b>
            </div>
            <div className="progress">
              <div style={{ width: `${Math.min(100, progress as number)}%` }} />
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              {phase === '받는 중'
                ? '받는 동안 창을 닫고 다른 일을 하셔도 됩니다. 프로그램은 끄지 마세요.'
                : '백신이 받은 파일을 검사하면 30초쯤 걸릴 수 있습니다. 프로그램은 끄지 마세요.'}
            </div>
          </div>
        )}

        {phase === '다 받음' && (
          <div className="note note-info" style={{ marginTop: 14, marginBottom: 0 }}>
            <b>다 받았습니다.</b> 지금 다시 시작해 설치하시거나, 창을 닫고 쓰시다가{' '}
            <b>프로그램을 끌 때 설치됩니다.</b>
          </div>
        )}

        {error && (
          <div className="note note-danger" style={{ marginTop: 10, marginBottom: 0 }}>
            {error} — [받으러 가기]로 직접 내려받아 설치해 주세요.
          </div>
        )}

        <div className="row row-end" style={{ marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onOpenPage}>
            자세히 보기
          </button>
          <span className="spacer" />

          {phase === '받기 전' && (
            <>
              <button className="btn" onClick={onLater}>
                나중에
              </button>
              {info.canAutoInstall ? (
                <button className="btn btn-primary" autoFocus onClick={onDownload}>
                  지금 받아서 설치
                </button>
              ) : (
                <button className="btn btn-primary" autoFocus onClick={onOpenPage}>
                  받으러 가기
                </button>
              )}
            </>
          )}

          {(phase === '받는 중' || phase === '확인 중') && (
            <button className="btn btn-primary" autoFocus onClick={onClose}>
              닫기
            </button>
          )}

          {phase === '다 받음' && (
            <>
              <button className="btn" onClick={onClose}>
                닫기
              </button>
              <button className="btn btn-primary" autoFocus onClick={onInstall}>
                다시 시작하고 설치
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
