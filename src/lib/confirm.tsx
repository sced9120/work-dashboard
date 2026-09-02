import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

/**
 * 프로그램 안에서 뜨는 "정말 할까요?" 창.
 *
 * 예전에는 브라우저의 confirm() 을 그대로 썼는데, 일렉트론에서 그 창을 닫고 나면
 * **화면이 글쇠 입력을 못 받는 일**이 생겼다. 주제를 지우고 나서 검색창에
 * 글자가 안 쳐지던 것이 그것이다. 창을 눌러 나갔다 돌아와야 풀렸다.
 *
 * 그래서 운영체제 창 대신 화면 안에 그려 넣는다. 생김새도 프로그램과 맞고,
 * 무엇을 지우는지 여러 줄로 찬찬히 보여 줄 수 있다.
 */

export interface ConfirmOptions {
  title: string
  /** 제목 아래에 붙는 설명. 줄바꿈은 그대로 살아난다. */
  body?: ReactNode
  okText?: string
  cancelText?: string
  /** 지우기처럼 되돌리기 어려운 일이면 켠다 */
  danger?: boolean
}

type Ask = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmCtx = createContext<Ask>(async () => false)

export function useConfirm(): Ask {
  return useContext(ConfirmCtx)
}

interface Pending extends ConfirmOptions {
  resolve: (v: boolean) => void
}

export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [pending, setPending] = useState<Pending | null>(null)
  // 물어보는 사이에 값이 바뀌어도 늘 최신 것을 쓰도록
  const ref = useRef<Pending | null>(null)
  ref.current = pending

  const ask = useCallback<Ask>((opts) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve })
    })
  }, [])

  const close = (answer: boolean): void => {
    ref.current?.resolve(answer)
    setPending(null)
  }

  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {pending && (
        <div
          className="ask-back"
          onClick={() => close(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close(false)
          }}
        >
          <div
            className="ask"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ask-title">{pending.title}</div>
            {pending.body && <div className="ask-body">{pending.body}</div>}
            <div className="row row-end" style={{ marginTop: 16 }}>
              <button className="btn" onClick={() => close(false)}>
                {pending.cancelText ?? '취소'}
              </button>
              <button
                className={`btn ${pending.danger ? 'btn-danger' : 'btn-primary'}`}
                autoFocus
                onClick={() => close(true)}
              >
                {pending.okText ?? '계속'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  )
}
