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
  /** 이번 판은 그만 보겠다 */
  onLater: () => void
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
  onLater
}: Props): JSX.Element {
  const { head, blocks } = splitNotes(info.notes ?? '')

  // Esc 로 닫는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onLater()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onLater])

  return (
    <div className="ask-back" onClick={onLater}>
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

        <div className="note note-info" style={{ marginTop: 14, marginBottom: 0 }}>
          업데이트해도 <b>정리해 둔 업무·공문·기한은 그대로 남습니다.</b>
          {!info.canAutoInstall && ' 무설치(Portable)로 쓰고 계셔서 직접 받아 바꿔야 합니다.'}
        </div>

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
          <button className="btn" onClick={onLater}>
            나중에
          </button>

          {progress === 'done' ? (
            <button className="btn btn-primary" autoFocus onClick={onInstall}>
              다시 시작하고 설치
            </button>
          ) : typeof progress === 'number' ? (
            <span className="small" style={{ minWidth: 96, textAlign: 'right' }}>
              받는 중… {progress}%
            </span>
          ) : info.canAutoInstall ? (
            <button className="btn btn-primary" autoFocus onClick={onDownload}>
              지금 받아서 설치
            </button>
          ) : (
            <button className="btn btn-primary" autoFocus onClick={onOpenPage}>
              받으러 가기
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
