import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

/**
 * 화면 하나에서 오류가 나도 앱 전체가 하얀 화면이 되지 않게 한다.
 *  · PageGuard — 화면(page)마다. 다른 화면으로 옮기면 저절로 다시 그린다.
 *  · AppGuard  — 맨 바깥. 메뉴까지 그리지 못할 때 [다시 시작]만 둔다.
 * 오류는 logs/error.log 에 남긴다(이 PC 에만). 적어 둔 자료는 DB 에 있어 사라지지 않는다.
 */

interface State {
  error: Error | null
  stack: string
}

function report(where: string, error: Error, info?: ErrorInfo): void {
  try {
    void window.api?.log?.error(where, `${error.name}: ${error.message}`, `${error.stack ?? ''}${info?.componentStack ? `\n화면 위치:${info.componentStack}` : ''}`)
  } catch {
    // 기록을 못 남겨도 화면은 보여 준다
  }
}

const detail = (e: Error, stack: string): string => `${e.name}: ${e.message}\n${(e.stack ?? '').split('\n').slice(1, 6).join('\n')}${stack ? `\n${stack.split('\n').slice(0, 6).join('\n')}` : ''}`

interface PageProps {
  page: string
  onHome: () => void
  children: ReactNode
}

export class PageGuard extends Component<PageProps, State> {
  state: State = { error: null, stack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ stack: info.componentStack ?? '' })
    report(this.props.page, error, info)
  }

  componentDidUpdate(prev: PageProps): void {
    if (prev.page !== this.props.page && this.state.error) this.setState({ error: null, stack: '' })
  }

  render(): ReactNode {
    const { error, stack } = this.state
    if (!error) return this.props.children
    return (
      <section className="card err-guard" role="alert">
        <div className="err-guard-mark" aria-hidden="true">!</div>
        <h2>이 화면을 그리다 문제가 생겼어요</h2>
        <p>적어 둔 자료는 그대로 있어요. 다시 열어 보거나 다른 화면으로 가세요. 되풀이되면 [오류 내용 복사]를 눌러 [의견 · 오류 보내기]에 붙여 주세요.</p>
        <div className="row err-guard-btns">
          <button className="btn btn-primary btn-sm" onClick={() => this.setState({ error: null, stack: '' })}>
            다시 열기
          </button>
          <button className="btn btn-sm" onClick={this.props.onHome}>
            홈으로
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => void window.api.clipboard.write(`[오르빗 오류 · 화면 ${this.props.page}]\n${detail(error, stack)}`)}
          >
            오류 내용 복사
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => void window.api.log.openFolder()}>
            오류 기록 폴더 열기
          </button>
        </div>
        <details className="small">
          <summary>오류 내용</summary>
          <pre>{detail(error, stack)}</pre>
        </details>
      </section>
    )
  }
}

export class AppGuard extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ stack: info.componentStack ?? '' })
    report('앱 전체', error, info)
  }

  render(): ReactNode {
    const { error, stack } = this.state
    if (!error) return this.props.children
    return (
      <div className="err-app">
        <section className="card err-guard" role="alert">
          <div className="err-guard-mark" aria-hidden="true">!</div>
          <h2>오르빗을 그리다 문제가 생겼어요</h2>
          <p>적어 둔 자료는 그대로 있어요. [다시 시작]을 눌러 주세요.</p>
          <div className="row err-guard-btns">
            <button className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
              다시 시작
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => void window.api.clipboard.write(`[오르빗 오류 · 앱 전체]\n${detail(error, stack)}`)}>
              오류 내용 복사
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => void window.api.log.openFolder()}>
              오류 기록 폴더 열기
            </button>
          </div>
          <details className="small">
            <summary>오류 내용</summary>
            <pre>{detail(error, stack)}</pre>
          </details>
        </section>
      </div>
    )
  }
}

/** 화면 코드 밖에서 난 오류(타이머 · 이벤트 · Promise)도 기록한다 — 화면은 그대로 둔다 */
export function installWindowErrorLog(): void {
  window.addEventListener('error', (e) => {
    const err = e.error instanceof Error ? e.error : new Error(String(e.message || '알 수 없는 오류'))
    report('창', err)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    report('Promise', r instanceof Error ? r : new Error(typeof r === 'string' ? r : JSON.stringify(r ?? null)))
  })
}
