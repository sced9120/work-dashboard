import { Fragment, type ReactNode } from 'react'
import { splitRow } from '../../shared/mdtable'
import { mathText } from '../../shared/mathtext'

/**
 * AI 답의 Markdown 을 화면에 — 제목 · 목록 · 표 · 인용 · 코드 · 굵게 · 기울임 · 링크.
 * HTML 로 옮겨 끼우지 않고 React 요소로만 그린다(답 안의 <script> 같은 것이 돌 일이 없다).
 * 링크는 http(s) 만, 누르면 브라우저로 연다. 수식($…$)은 읽기 쉬운 글자로(shared/mathtext).
 */

const open = (url: string): void => {
  void window.api.shell.open(url)
}

/** 한 줄 안의 꾸밈 */
const INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*(?=\S)([\s\S]+?)\*\*|__(?=\S)([\s\S]+?)__|~~(?=\S)([\s\S]+?)~~|\*(?=[^\s*])([^*]+?)\*|(?<![\p{L}\p{N}_])_(?=\S)([^_]+?)_(?![\p{L}\p{N}_])|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"’”])/u

function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let n = 0
  while (rest) {
    const m = INLINE.exec(rest)
    if (!m) {
      out.push(mathText(rest))
      break
    }
    if (m.index > 0) out.push(mathText(rest.slice(0, m.index)))
    const k = `${key}-${n++}`
    if (m[1]) out.push(<code key={k}>{m[2]}</code>)
    else if (m[3] ?? m[4]) out.push(<strong key={k}>{inline((m[3] ?? m[4]) as string, k)}</strong>)
    else if (m[5]) out.push(<del key={k}>{inline(m[5], k)}</del>)
    else if (m[6] ?? m[7]) out.push(<em key={k}>{inline((m[6] ?? m[7]) as string, k)}</em>)
    else if (m[8]) {
      const url = m[9]
      out.push(
        <a key={k} href={url} onClick={(e) => (e.preventDefault(), open(url))} title={url}>
          {inline(m[8], k)}
        </a>
      )
    } else if (m[10]) {
      const url = m[10]
      out.push(
        <a key={k} href={url} onClick={(e) => (e.preventDefault(), open(url))}>
          {url}
        </a>
      )
    }
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}

/** 줄바꿈을 살린 글 덩어리 */
function lines(text: string, key: string): ReactNode[] {
  return text.split('\n').flatMap((l, i, all) => (i < all.length - 1 ? [<Fragment key={`${key}-${i}`}>{inline(l, `${key}-${i}`)}</Fragment>, <br key={`${key}-br${i}`} />] : [<Fragment key={`${key}-${i}`}>{inline(l, `${key}-${i}`)}</Fragment>]))
}

const SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
const LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/

interface ListItem {
  depth: number
  ordered: boolean
  text: string
}

function renderList(items: ListItem[], key: string): ReactNode {
  const itemBody = (it: ListItem, k: string): ReactNode => {
    const task = /^\[([ xX])\]\s+(.*)$/s.exec(it.text)
    return task ? (
      <>
        <span className="md-check">{task[1] === ' ' ? '☐' : '☑'}</span> {inline(task[2], k)}
      </>
    ) : (
      inline(it.text, k)
    )
  }
  // 같은 깊이 · 같은 종류(글머리 / 번호)끼리 한 목록. 더 깊은 것은 바로 앞 항목 안에 넣는다
  const build = (from: number): [ReactNode, number] => {
    const { depth, ordered } = items[from]
    const lis: { node: ReactNode[]; key: string }[] = []
    let i = from
    while (i < items.length && items[i].depth >= depth) {
      if (items[i].depth > depth) {
        const [sub, next] = build(i)
        if (lis.length) lis[lis.length - 1].node.push(<Fragment key={`${key}-s${i}`}>{sub}</Fragment>)
        else lis.push({ node: [sub], key: `${key}-${i}` })
        i = next
        continue
      }
      if (items[i].ordered !== ordered) break
      lis.push({ node: [<Fragment key="b">{itemBody(items[i], `${key}-${i}`)}</Fragment>], key: `${key}-${i}` })
      i++
    }
    const kids = lis.map((l) => <li key={l.key}>{l.node}</li>)
    return [ordered ? <ol key={`${key}-o${from}`}>{kids}</ol> : <ul key={`${key}-u${from}`}>{kids}</ul>, i]
  }
  const parts: ReactNode[] = []
  let i = 0
  while (i < items.length) {
    const [node, next] = build(i)
    parts.push(node)
    i = next
  }
  return <Fragment key={key}>{parts}</Fragment>
}

export default function Markdown({ text }: { text: string }): JSX.Element {
  const src = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let para: string[] = []
  let i = 0
  const flush = (): void => {
    if (!para.length) return
    const k = `p${blocks.length}`
    blocks.push(<p key={k}>{lines(para.join('\n'), k)}</p>)
    para = []
  }
  while (i < src.length) {
    const line = src[i]
    const k = `b${blocks.length}`
    const fence = FENCE.exec(line)
    if (fence) {
      flush()
      const mark = fence[1]
      const body: string[] = []
      i++
      while (i < src.length && !(src[i].trim().startsWith(mark[0].repeat(mark.length)) && !src[i].trim().slice(mark.length).trim())) body.push(src[i++])
      i++
      blocks.push(
        <pre key={k} className="md-code">
          <code>{body.join('\n')}</code>
        </pre>
      )
      continue
    }
    if (!line.trim()) {
      flush()
      i++
      continue
    }
    const head = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (head) {
      flush()
      const level = Math.min(6, head[1].length + 2)
      const Tag = `h${level}` as 'h3'
      blocks.push(
        <Tag key={k} className="md-h">
          {inline(head[2], k)}
        </Tag>
      )
      i++
      continue
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush()
      blocks.push(<hr key={k} />)
      i++
      continue
    }
    // 표: 머리글 줄 + 구분선
    if (line.includes('|') && i + 1 < src.length && SEP.test(src[i + 1]) && splitRow(line).length === splitRow(src[i + 1]).length) {
      flush()
      const header = splitRow(line)
      const rows: string[][] = []
      i += 2
      while (i < src.length && src[i].trim() && src[i].includes('|')) rows.push(splitRow(src[i++]))
      blocks.push(
        <div key={k} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th key={hi}>{inline(h, `${k}-h${hi}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {header.map((_, ci) => (
                    <td key={ci}>{lines((r[ci] ?? '').replace(/<br\s*\/?>/gi, '\n'), `${k}-${ri}-${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }
    if (/^\s{0,3}>/.test(line)) {
      flush()
      const quote: string[] = []
      while (i < src.length && /^\s{0,3}>/.test(src[i])) quote.push(src[i++].replace(/^\s{0,3}>\s?/, ''))
      blocks.push(
        <blockquote key={k} className="md-quote">
          <Markdown text={quote.join('\n')} />
        </blockquote>
      )
      continue
    }
    if (LIST.test(line)) {
      flush()
      const items: ListItem[] = []
      while (i < src.length) {
        const m = LIST.exec(src[i])
        if (m) {
          items.push({ depth: Math.floor(m[1].replace(/\t/g, '    ').length / 2), ordered: /\d/.test(m[2]), text: m[3] })
          i++
        } else if (src[i].trim() && /^\s{2,}/.test(src[i]) && items.length) {
          // 목록 안에서 이어지는 줄
          items[items.length - 1].text += `\n${src[i].trim()}`
          i++
        } else break
      }
      blocks.push(renderList(items, k))
      continue
    }
    para.push(line)
    i++
  }
  flush()
  return <div className="md">{blocks}</div>
}
