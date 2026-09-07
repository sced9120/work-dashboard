/**
 * 나이스에서 내려받은 공문 파일 이름을 읽어 같은 공문끼리 묶는다.
 *
 * 공문 하나는 본문 파일 하나에 첨부 파일 몇 개로 내려오고, 그 전체가 하나의 일이다.
 * 이름 앞머리에 같은 문서번호가 붙어 있어 그것으로 묶을 수 있다.
 *
 *   (김해분성고등학교-2338 (본문)) 2026학년도 제1회 학생선도위원회 개최.pdf
 *   (김해분성고등학교-2338 (첨부)) 2026학년도 제1회 학생선도위원회 사건 개요.hwp
 *   (김해분성고등학교-2338 (첨부)) 2026학년도 제1회 … 학부모 의견서.hwp
 *
 * 받은 곳이 뒤에 붙는 것도 있다.
 *
 *   (김해분성고등학교-7562 (본문) 경상남도김해교육지원청 학교통합지원센터) … .odt
 */

const NAME_RE = /^\(\s*(.+?)\s*-\s*(\d+)\s*\(\s*(본문|첨부)\s*\)[^)]*\)\s*(.*)$/

export interface NoticeName {
  /** "김해분성고등학교-2338" — 같은 공문을 묶는 열쇠 */
  number: string
  part: '본문' | '첨부'
  /** 괄호와 확장자를 걷어낸 제목 */
  title: string
}

/** 공문 이름이 아니면 null. 길라잡이나 손수 만든 파일이 여기에 든다. */
export function parseNoticeName(filename: string): NoticeName | null {
  const m = NAME_RE.exec(filename.trim())
  if (!m) return null
  const title = m[4].replace(/\.[^.]+$/, '').trim()
  return {
    number: `${m[1]}-${m[2]}`,
    part: m[3] as '본문' | '첨부',
    title: title || filename
  }
}

/** 한 공문으로 묶인 파일들 */
export interface NoticeGroup<T> {
  /** 묶은 열쇠 */
  key: string
  /** 문서번호. 공문 이름이 아니면 빈 문자열 */
  number: string
  /** 사람에게 보여 줄 이름 — 본문의 제목 */
  label: string
  /** 본문이 맨 앞에 오도록 세운 것 */
  items: T[]
}

/**
 * 문서번호가 같은 파일을 한 공문으로 묶는다.
 *
 * 문서번호는 해마다 1번부터 다시 매겨진다. 그래서 번호만 보고 묶으면
 * 지난해 4169번과 올해 4169번이 한 덩어리가 된다. 실제로 이 학교 자료에도
 * 그런 짝이 있었다. 그래서 같은 자리에 있는 것끼리만 묶는다 —
 * 파일은 폴더로, 보관해 둔 공문은 학년도로 자리를 가른다.
 */
export function groupNotices<T>(
  items: T[],
  nameOf: (t: T) => string,
  scopeOf: (t: T) => string = () => ''
): NoticeGroup<T>[] {
  const out: NoticeGroup<T>[] = []
  const index = new Map<string, NoticeGroup<T>>()

  for (const it of items) {
    const name = nameOf(it)
    const parsed = parseNoticeName(name)

    // 공문 이름이 아니면 혼자 한 건이다.
    if (!parsed) {
      out.push({ key: `${scopeOf(it)}|${name}`, number: '', label: name, items: [it] })
      continue
    }

    const key = `${scopeOf(it)}|${parsed.number}`
    let g = index.get(key)
    if (!g) {
      g = { key, number: parsed.number, label: parsed.title, items: [] }
      index.set(key, g)
      out.push(g)
    }

    // 본문을 맨 앞에 세우고, 묶음 이름도 본문의 제목으로 삼는다.
    if (parsed.part === '본문') {
      g.label = parsed.title
      g.items.unshift(it)
    } else {
      g.items.push(it)
    }
  }

  return out
}

/**
 * 묶은 공문 하나를 AI에 보낼 한 덩어리 글로 잇는다.
 *
 * 본문은 통째로 넣는다. 붙임은 남은 만큼만 넣고, 다 못 넣은 것은
 * 이름만이라도 적어 둔다. 붙임이 두꺼우면 요청이 몇 배로 늘어 요금이
 * 붙기 때문이다. 원문 전체는 어차피 보관함에 그대로 남는다.
 */
export const NOTICE_BUDGET = 40000

export function joinNotice(parts: { name: string; text: string }[]): string {
  if (parts.length === 1) return parts[0].text

  const out: string[] = []
  const skipped: string[] = []
  let left = NOTICE_BUDGET

  for (const [i, p] of parts.entries()) {
    const parsed = parseNoticeName(p.name)
    const head = parsed ? `=== ${parsed.part}: ${parsed.title} ===` : `=== ${p.name} ===`

    // 첫 조각(본문)은 잘라 내지 않는다. 공문의 알맹이가 거기 있다.
    if (i === 0) {
      out.push(`${head}\n${p.text}`)
      left -= p.text.length
      continue
    }

    if (left < 500) {
      skipped.push(parsed?.title ?? p.name)
      continue
    }

    const body =
      p.text.length <= left ? p.text : `${p.text.slice(0, left)}\n… (이하 줄임)`
    left -= body.length
    out.push(`${head}\n${body}`)
  }

  if (skipped.length) {
    out.push(`=== 함께 온 붙임 (글은 싣지 않음) ===\n${skipped.join('\n')}`)
  }
  return out.join('\n\n')
}
