/**
 * 받은 공문으로 기안문 쓰기 — 순수 로직 (화면 · 메인 공용).
 * 공문 본문에서 관련 근거(기관 · 문서번호 · 시행일자 · 제목)를 뽑고, AI 에게 줄 지시를 만들고,
 * 받은 글을 기안문 번호 · 띄어쓰기에 맞춰 다듬는다.
 */

export type GianmunKindId = 'reply' | 'plan' | 'apply' | 'report' | 'request' | 'notify'

export interface GianmunKind {
  id: GianmunKindId
  label: string
  /** 화면에 보일 한 줄 설명 */
  desc: string
  /** 본문 뼈대 — AI 에게 보여 주는 얼개 */
  skeleton: string
  /** 맺음 문장 안내 */
  closing: string
}

export const GIANMUN_KINDS: GianmunKind[] = [
  {
    id: 'reply',
    label: '회신(자료 제출)',
    desc: '받은 공문이 요청한 자료를 모아 제출합니다.',
    skeleton:
      '1. 관련: …\n2. 위 호와 관련하여 요청하신 자료를 아래와 같이 제출합니다.\n  가. 제출 자료: …\n  나. 제출 기한: …\n  다. 담당: …',
    closing: '"…제출합니다." 또는 "…제출하고자 합니다." 로 맺습니다.'
  },
  {
    id: 'plan',
    label: '계획 수립(행사·사업)',
    desc: '받은 공문에 따라 학교 계획을 세워 결재를 받습니다.',
    skeleton:
      '1. 관련: …\n2. 위 호와 관련하여 다음과 같이 ○○ 계획을 수립하고자 합니다.\n  가. 목적: …\n  나. 일시 · 장소: …\n  다. 대상: …\n  라. 주요 내용: …\n  마. 소요 예산: …',
    closing: '"…수립하고자 합니다." 로 맺고 붙임에 계획서를 적습니다.'
  },
  {
    id: 'apply',
    label: '참가 신청',
    desc: '연수 · 대회 · 사업 참가를 신청합니다.',
    skeleton:
      '1. 관련: …\n2. 위 호와 관련하여 우리 학교의 ○○ 참가를 아래와 같이 신청합니다.\n  가. 참가 대상: …\n  나. 일시 · 장소: …\n  다. 신청 인원: …',
    closing: '"…참가를 신청합니다." 로 맺습니다.'
  },
  {
    id: 'report',
    label: '결과 보고',
    desc: '시행한 행사 · 사업의 결과를 보고합니다.',
    skeleton:
      '1. 관련: …\n2. 위 호와 관련하여 ○○ 결과를 다음과 같이 보고합니다.\n  가. 운영 개요: …\n  나. 운영 결과: …\n  다. 성과 및 개선점: …',
    closing: '"…보고합니다." 로 맺습니다.'
  },
  {
    id: 'request',
    label: '협조 요청',
    desc: '관계 기관 · 부서에 협조를 요청합니다.',
    skeleton:
      '1. 관련: …\n2. 위 호와 관련하여 ○○ 업무 추진에 필요한 사항을 아래와 같이 요청하오니 협조하여 주시기 바랍니다.\n  가. 요청 사항: …\n  나. 기한: …\n  다. 제출 방법: …',
    closing: '"…협조하여 주시기 바랍니다." 로 맺습니다.'
  },
  {
    id: 'notify',
    label: '내부 결재(안내·통지)',
    desc: '교직원에게 안내하거나 통지하는 내부 결재 문서입니다.',
    skeleton:
      '1. 관련: …\n2. 위 호와 관련하여 교직원에게 다음과 같이 안내하고자 합니다.\n  가. 안내 내용: …\n  나. 협조 사항: …\n  다. 문의: …',
    closing: '"…안내하고자 합니다." 로 맺습니다.'
  }
]

export function gianmunKind(id: string): GianmunKind {
  return GIANMUN_KINDS.find((k) => k.id === id) ?? GIANMUN_KINDS[0]
}

/** 받은 공문에서 뽑은 근거 */
export interface GianmunRef {
  /** 발신 기관 (예: ○○교육청) */
  org: string
  /** 문서번호 (예: 교육과-1234) */
  docNo: string
  /** 시행일자 (YYYY. M. D.) */
  date: string
  /** 제목 */
  title: string
}

export const EMPTY_REF: GianmunRef = { org: '', docNo: '', date: '', title: '' }

function normDate(s: string): string {
  const m = s.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/)
  return m ? `${m[1]}. ${Number(m[2])}. ${Number(m[3])}.` : ''
}

const ORG_END = /(교육청|교육지원청|교육부|교육국|교육원|시청|도청|군청|구청|학교|센터|재단|진흥원|연구원|위원회|협회|공단)$/
const SIGNER_END = /(교육감|교육장|학교장|교장|원장|센터장|이사장|위원장|시장|도지사|군수|구청장|회장)$/

/** 공문 머리글에서 근거 정보를 뽑는다. 못 찾은 것은 빈 문자열. */
export function extractRef(content: string): GianmunRef {
  const text = String(content ?? '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const ref: GianmunRef = { ...EMPTY_REF }

  // 제목
  const t = text.match(/^[ \t]*제\s*목\s*[:：]?[ \t]*(.+)$/m)
  if (t) ref.title = t[1].replace(/\s+/g, ' ').trim()

  // 시행 교육과-1234 (2026. 3. 5.)
  const run = text.match(/시\s*행\s*[:：]?\s*([^\s()（）]+-\s?\d+)\s*[(（]\s*(\d{4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}[^)）]{0,3})[)）]/)
  if (run) {
    ref.docNo = run[1].replace(/\s+/g, '')
    ref.date = normDate(run[2])
  } else {
    const no = text.match(/문서\s*번호\s*[:：]?\s*([^\s()（）]+-\s?\d+)/) ?? text.match(/([가-힣]{2,12}-\d{2,6})\s*[(（]\s*\d{4}\s*[.\-/]/)
    if (no) ref.docNo = no[1].replace(/\s+/g, '')
    const d =
      text.match(/(?:시\s*행\s*일\s*자?|시행)\s*[:：]?\s*(\d{4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2})/) ??
      (no ? text.slice(text.indexOf(no[0])).match(/[(（]\s*(\d{4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2})/) : null)
    if (d) ref.date = normDate(d[1])
  }

  // 발신 기관 — 1) "발신: …"  2) 머리글 맨 위 기관 이름  3) 끝의 "○○교육감" 같은 발신 명의
  const from = text.match(/발\s*신\s*(?:기\s*관)?\s*[:：]\s*([^\n]+)/)
  if (from) ref.org = from[1].trim()
  if (!ref.org) {
    for (const l of lines.slice(0, 6)) {
      const s = l.replace(/\s+/g, ' ')
      if (s.length <= 30 && ORG_END.test(s) && !/^(수\s*신|제\s*목|시\s*행|경\s*유)/.test(s)) {
        ref.org = s
        break
      }
    }
  }
  if (!ref.org) {
    for (const l of lines.slice(-8).reverse()) {
      const s = l.replace(/\s+/g, ' ')
      if (s.length <= 30 && SIGNER_END.test(s) && /[가-힣]{2,}/.test(s)) {
        ref.org = s.replace(SIGNER_END, '').replace(/\s+$/, '')
        if (/교육감$/.test(s) && ref.org && !ORG_END.test(ref.org)) ref.org += '교육청'
        if (/교육장$/.test(s) && ref.org && !ORG_END.test(ref.org)) ref.org += '교육지원청'
        break
      }
    }
  }
  return ref
}

/** "1. 관련: 기관 문서번호(날짜) 「제목」" — 없는 조각은 건너뛴다. 모두 없으면 빈칸 표시로. */
export function relatedLine(ref: Partial<GianmunRef>): string {
  const org = (ref.org ?? '').trim()
  const no = (ref.docNo ?? '').trim()
  const date = (ref.date ?? '').trim()
  const title = (ref.title ?? '').trim()
  let head = [org, no].filter(Boolean).join(' ')
  if (date) head += (head ? '' : '○○○ ○○○-○○○') + `(${date})`
  if (!org && !no && !date && !title) return '1. 관련: ○○○ ○○○-○○○(○○○○. ○. ○.) 「○○○」'
  const tail = title ? ` 「${title.replace(/^[「『"']|[」』"']$/g, '')}」` : ''
  return `1. 관련: ${head}${tail}`.replace(/: {2,}/, ': ').replace(/\s+$/, '')
}

const RULES = [
  '당신은 대한민국 학교의 행정 업무를 잘 아는 교사입니다. 받은 공문을 근거로 학교에서 올릴 기안문(결재 문서)의 글을 씁니다.',
  '',
  '[형식]',
  '- 첫 줄은 기안문 제목입니다. 제목만 한 줄로 적고 번호를 붙이지 않습니다.',
  '- 본문은 번호로 나눕니다. 1. → 가. → 1) → 가) 차례이며, 한 단계 내려갈 때마다 두 칸 들여 씁니다.',
  '- 첫 항목은 반드시 근거입니다. 아래 "관련 줄" 을 한 글자도 바꾸지 말고 그대로 쓰세요.',
  '- 둘째 항목은 "2. 위 호와 관련하여 …" 로 시작하고, 세부 내용은 "가. 나. 다." 로 나눕니다.',
  '- 개조식으로 씁니다. 항목 안의 문장은 "~함", "~임", "~바람", "~예정임" 처럼 명사형으로 끝냅니다. 서술형 존댓말 문장은 둘째 항목의 맺음 문장(예: "…하고자 합니다.")에만 씁니다.',
  '- 붙임이 있으면 본문 아래에 "붙임  1. ○○○ 1부.  끝." 으로 씁니다(붙임 뒤 두 칸, 끝 앞 두 칸). 붙임이 없으면 마지막 줄 끝에 두 칸을 띄고 "끝." 을 붙입니다.',
  '- 마크다운 표시(#, **, -, ```, 표)를 쓰지 마세요. 글자 그대로 한글(HWP)에 붙여 넣을 수 있는 순수 글로만 씁니다.',
  '- 설명이나 머리말 없이 기안문 글만 출력하세요.',
  '',
  '[사실]',
  '- 받은 공문과 "추가로 쓸 내용" 에 없는 사실(날짜 · 금액 · 인원 · 장소 · 이름 · 문서번호)은 지어내지 마세요. 모르는 것은 ○○ 로 비워 두세요(예: 2026. ○. ○., ○○○원, ○○명).',
  '- 공문에 이미 ○ 로 가려진 이름이나 연락처는 그대로 ○ 로 두세요.',
  '- 학교 이름이 정해지지 않았으면 "우리 학교" 라고 쓰세요.'
].join('\n')

/** AI 에게 줄 지시. system 은 규칙 · 형식, user 는 이번 문서 재료. */
export function gianmunPrompt(
  kindId: string,
  ref: Partial<GianmunRef>,
  content: string,
  extra = ''
): { system: string; user: string } {
  const kind = gianmunKind(kindId)
  const rel = relatedLine(ref)
  const system = `${RULES}\n\n[이번 기안 종류] ${kind.label} — ${kind.desc}\n${kind.closing}\n\n[본문 뼈대 예시]\n${kind.skeleton}`
  const user = [
    `관련 줄(그대로 쓸 것):\n${rel}`,
    '',
    `추가로 쓸 내용(일정 · 예산 · 대상 등):\n${extra.trim() || '(없음 — 공문에 없는 내용은 ○○ 로 비워 두세요)'}`,
    '',
    '--- 받은 공문 ---',
    String(content ?? '').slice(0, 14000)
  ].join('\n')
  return { system, user }
}

/** 받은 글을 기안문 모양으로 — 마크다운 찌꺼기 · 번호 띄어쓰기 · 끝 표시를 바로잡는다. */
export function formatGianmun(text: string): string {
  let t = String(text ?? '').replace(/\r\n?/g, '\n').replace(/<think>[\s\S]*?<\/think>/gi, '')
  t = t.replace(/^\s*```[a-z]*\s*$/gim, '')
  const out: string[] = []
  for (const raw of t.split('\n')) {
    let l = raw.replace(/\s+$/, '')
    l = l.replace(/^(\s*)#{1,6}\s+/, '$1').replace(/\*\*/g, '').replace(/^(\s*)[*•]\s+/, '$1')
    // 번호 뒤 띄어쓰기: "1.관련" → "1. 관련", "가.내용" → "가. 내용", "1)가" → "1) 가"
    l = l.replace(/^(\s*)(\d{1,2}[.)]|[가-하][.)])(?=\S)/, '$1$2 ')
    // 붙임 줄 — "붙임 1. …" 은 두 칸
    l = l.replace(/^(\s*붙임)[ \t]+(?=\S)/, '$1  ')
    out.push(l)
  }
  let s = out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!s) return ''
  // 끝 표시: 이미 있으면 모양만 맞추고, 없으면 마지막 줄 끝에 붙인다
  if (/[ \t\n]끝\s*\.?\s*$/.test(s)) {
    s = s.replace(/[ \t]*(\n?)[ \t]*끝\s*\.?\s*$/, (_m, nl: string) => (nl ? '\n끝.' : '  끝.'))
  } else {
    s += '  끝.'
  }
  return s
}

export interface GianmunDraftRequest {
  docId: number
  kind: string
  /** 화면에서 고친 근거. 비우면 공문 본문에서 다시 뽑는다 */
  ref?: Partial<GianmunRef>
  extra?: string
  model?: { provider: string; model: string } | null
}

export interface GianmunDraftReply {
  ok: boolean
  text: string
  /** AI 로 보낸 글(가린 뒤) — 확인용 */
  sentToAi?: string
  error?: string
}

export interface GianmunSaveReply {
  ok: boolean
  message: string
  path?: string
}
