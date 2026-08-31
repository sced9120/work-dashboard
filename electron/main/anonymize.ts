/**
 * 학교 문서에는 학생·보호자·교사의 개인정보가 들어간다.
 * AI에 보내기 전에 이름·연락처 따위를 가명으로 바꾸고,
 * 돌아온 결과에서 다시 실명으로 되돌린다.
 *
 * 치환표는 이 PC 메모리에만 있고 어디에도 저장·전송되지 않는다.
 *
 * 두 가지 방식이 있다.
 *  - 가명 바꾸기(maskText)   — '학생A' 로 바꿔 보내고 결과에서 되돌린다.
 *                              누가 누구인지 구분해야 하는 글에 쓴다.
 *  - 싹 가리기(scrubPersonal) — 모두 ○○○ 으로 지운다. 되돌리지 않는다.
 *                              형식만 보려는 예시나, 학습용으로 넘길 원문에 쓴다.
 */

import type { AliasPair, ScrubResult } from '../../shared/types'

/** 사람이 실수로 지우지 못한 번호류를 기계적으로 가린다. */
const AUTO_RULES: { label: string; re: RegExp; to: string }[] = [
  { label: '주민등록번호', re: /\d{6}\s*[-–—]\s*\d{7}/g, to: '(주민등록번호 삭제)' },
  {
    label: '휴대전화',
    re: /01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}/g,
    to: '(연락처 삭제)'
  },
  {
    label: '일반전화',
    re: /0\d{1,2}[-.\s]\d{3,4}[-.\s]\d{4}/g,
    to: '(연락처 삭제)'
  },
  { label: '이메일', re: /[\w.+-]+@[\w-]+\.[\w.]+/g, to: '(이메일 삭제)' },
  // "2학년 3반 15번" 에서 반·번호는 식별성이 높아 지운다. 학년은 남긴다.
  {
    label: '반·번호',
    re: /(\d\s*학년)\s*\d+\s*반\s*(?:\d+\s*번)?/g,
    to: '$1 ○반'
  }
]

/**
 * 이름 바로 뒤에 붙는 말. 띄어쓰기 없이 붙여 쓰기도 한다. ("홍길동학생")
 */
const TIGHT_MARKERS = ['학생', '군', '양', '씨']

/**
 * 이름 앞뒤에 오는 직위·관계.
 *
 * 이런 말은 다른 말과 붙어 한 낱말을 이루는 일이 잦다 —
 * "생활안전부장", "학생생활교육위원회" 처럼. 그래서 붙여 쓴 것은 이름으로
 * 보지 않고, **띄어쓰기나 쌍점이 있을 때만** 앞뒤를 이름으로 본다.
 * 그러지 않으면 "생활안전" 이 이름으로 잡혀 부서명이 지워진다.
 */
const ROLE_MARKERS = [
  '선생님',
  '교사',
  '교장',
  '교감',
  '부장',
  '담임',
  '위원장',
  '위원',
  '어머니',
  '아버지',
  '보호자',
  '학부모',
  '신고자',
  '목격자'
]

/** 서식의 칸 이름. "성명: 홍길동" 처럼 뒤에 이름이 온다. */
const NAME_LABELS = [
  '성명',
  '이름',
  '작성자',
  '담당자',
  '신청인',
  '진술인',
  '확인자',
  '기록자',
  '대상자',
  '작성',
  '기안자'
]

/**
 * 우리나라에서 흔한 성(姓).
 *
 * 표지 뒤에 오는 두세 글자를 다 이름으로 보면 "위원: 재발 방지…" 의
 * '재발' 까지 이름이 된다. 첫 글자가 성이 아니면 이름으로 보지 않는 것만으로
 * 헛짚기가 크게 줄어든다.
 */
const SURNAMES = new Set(
  ('김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구' +
    '나민진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁' +
    '국어은편용예봉사부가복태계').split('')
)

/** 사람 이름처럼 생겼지만 이름이 아닌 말 */
const NOT_NAMES = new Set([
  // 성으로 시작해 이름처럼 보이는 흔한 낱말
  '방지',
  '정리',
  '조사',
  '강화',
  '지도',
  '신청',
  '안내',
  '조치',
  '고지',
  '오전',
  '오후',
  '서명',
  '성적',
  '임시',
  '최근',
  '표준',
  '명단',
  '지원',
  '구성',
  '주의',
  '배부',
  '문서',
  '남녀',
  '전체',
  '노력',
  '우수',
  '유의',
  '제출',
  '기타',
  '연수',
  '예방',
  '재발',
  '선정',
  '이상',
  '이하',
  '이후',
  '이전',
  '해당',
  '고등',
  '중학',
  '초등',
  '학생',
  '보호자',
  '학부모',
  '담임',
  '교사',
  '위원',
  '위원장',
  '교장',
  '교감',
  '부장',
  '선생',
  '해당',
  '대상',
  '본인',
  '피해',
  '가해',
  '관련',
  '이상',
  '아래',
  '위와',
  '다음',
  '성명',
  '이름',
  '작성',
  '담당',
  '학년',
  '전체',
  '기타',
  '없음',
  '동일',
  '상기',
  '명부',
  '참석',
  '불참',
  '기록',
  '회의',
  '안건',
  '의결',
  '심의',
  '보고',
  '확인',
  '결과',
  '내용',
  '장소',
  '일시',
  '비고',
  '구분',
  '연번',
  '소속',
  '직위',
  '직급'
])

/**
 * 글에서 사람 이름으로 보이는 것을 추려 낸다.
 * 확실하지 않으므로 화면에서 사람이 확인하도록 후보만 돌려준다.
 */
export function findNameCandidates(text: string): string[] {
  const found = new Set<string>()
  const tight = TIGHT_MARKERS.join('|')
  const role = ROLE_MARKERS.join('|')
  const all = [...TIGHT_MARKERS, ...ROLE_MARKERS, ...NAME_LABELS].join('|')

  const scan = (re: RegExp): void => {
    for (const m of text.matchAll(re)) found.add(m[1])
  }

  // 1) "홍길동 학생", "김철수군" — 붙여 써도 된다.
  //    앞에 경계를 두어 "일반학생회" 같은 데서 잘려 나오지 않게 한다.
  scan(new RegExp(`(?:^|[\\s,·:：(\\[/])([가-힣]{2,4})\\s*(?:${tight})(?![가-힣])`, 'gm'))

  // 2) "박정민 위원장" — 직위가 뒤에 올 때는 반드시 띄어 쓴 것만
  scan(new RegExp(`([가-힣]{2,4})\\s+(?:${role})(?![가-힣])`, 'g'))

  // 3) "학생 홍길동", "담임교사 이지훈" — 표지가 앞에 올 때도 띄어 쓴 것만
  scan(new RegExp(`(?:${all})\\s+([가-힣]{2,4})`, 'g'))

  // 4) "보호자: 홍판서", "성명: 김영수" — 쌍점으로 이어진 칸
  scan(new RegExp(`(?:${all})\\s*[:：]\\s*([가-힣]{2,4})`, 'g'))

  // 5) "홍길동 (인)" 처럼 서명란에 적힌 경우
  scan(/([가-힣]{2,4})\s*\(\s*(?:인|서명)\s*\)/g)

  // 6) "2학년 3반 15번 홍길동" — 명부나 표에서 학번 뒤에 이름만 오는 경우
  scan(/(?:\d+\s*[반번])\s+([가-힣]{2,4})/g)

  // 성으로 시작하지 않는 것, 흔한 낱말, 이미 가려 둔 것은 뺀다.
  return [...found].filter(
    (n) => SURNAMES.has(n[0]) && !NOT_NAMES.has(n) && !n.includes('○') && !n.includes('*')
  )
}

/* ---------- 싹 가리기 ---------- */

/**
 * 번호·주소 따위를 규칙으로 가린다.
 *
 * 되돌릴 수 없게 아예 ○ 로 덮는다. 형식만 보려는 예시나, 학습용으로
 * AI에 넘길 원문처럼 "누가 누구인지" 가 필요 없는 글에 쓰기 위한 것이다.
 *
 * 헷갈릴 여지가 있는 것(계좌번호·생년월일·주소)은 앞에 칸 이름이 붙어
 * 있을 때만 가린다. 그러지 않으면 공문에 흔한 날짜·금액까지 지워 버린다.
 */
const SCRUB_RULES: { label: string; re: RegExp; to: string }[] = [
  { label: '주민등록번호', re: /\d{6}\s*[-–—]\s*\d{7}/g, to: '○○○○○○-○○○○○○○' },
  { label: '연락처', re: /01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}/g, to: '○○○-○○○○-○○○○' },
  { label: '연락처', re: /0\d{1,2}[-.\s]\d{3,4}[-.\s]\d{4}/g, to: '○○-○○○-○○○○' },
  { label: '이메일', re: /[\w.+-]+@[\w-]+\.[\w.]+/g, to: '○○○@○○○' },
  // 학년까지 지우면 무슨 문서인지 알 수 없어진다. 반·번호만 가린다.
  { label: '반·번호', re: /(\d\s*학년)\s*\d+\s*반\s*\d+\s*번/g, to: '$1 ○반 ○번' },
  { label: '반·번호', re: /(\d\s*학년)\s*\d+\s*반/g, to: '$1 ○반' },
  { label: '반·번호', re: /(?<![\d가-힣])\d{1,2}\s*반\s*\d{1,2}\s*번/g, to: '○반 ○번' },
  { label: '학번', re: /(학번)(\s*[:：]?\s*)\d{4,10}/g, to: '$1$2○○○○○' },
  {
    label: '생년월일',
    re: /(생년월일|생일)(\s*[:：]?\s*)\d{2,4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?\.?/g,
    to: '$1$2○○○○. ○○. ○○.'
  },
  { label: '주소', re: /\d+\s*동\s*\d+\s*호/g, to: '○○동 ○○호' },
  // 이미 가려 둔 줄("주소: ○○○")을 다시 가리지 않도록, 뒤가 ○ 뿐이면 건너뛴다.
  {
    label: '주소',
    re: /(주소|거주지)(\s*[:：]\s*)(?![○\s]*(?:\n|$))[^\n]{4,60}/g,
    to: '$1$2○○○'
  },
  {
    label: '계좌번호',
    re: /(계좌\s*번?호?|예금주)(\s*[:：]?\s*)[가-힣]*\s*\d{2,6}[-\s]\d{2,6}[-\s]\d{1,8}/g,
    to: '$1$2○○○'
  }
]

export function scrubPersonal(text: string): ScrubResult {
  let out = text
  const count = new Map<string, number>()
  const bump = (label: string, n: number): void => {
    if (n > 0) count.set(label, (count.get(label) ?? 0) + n)
  }

  // 이름을 먼저 가린다. 번호를 ○ 로 덮은 뒤에는 "2학년 3반 홍길동" 같은
  // 실마리가 사라져 이름을 찾기 어려워지기 때문이다.
  const names = findNameCandidates(out)
  // 긴 이름부터 바꿔야 '김철' 이 '김철수' 를 깨뜨리지 않는다.
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(escapeRe(name), 'g')
    bump('이름', (out.match(re) ?? []).length)
    out = out.replace(re, '○○○')
  }

  for (const rule of SCRUB_RULES) {
    bump(rule.label, (out.match(rule.re) ?? []).length)
    out = out.replace(rule.re, rule.to)
  }

  const order = ['이름', '주민등록번호', '연락처', '이메일', '반·번호', '학번', '생년월일', '주소', '계좌번호']
  const hits = [...count.entries()]
    .map(([label, n]) => ({ label, n }))
    .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))

  return { text: out, hits }
}

/** 이름 목록에 역할별 가명을 붙인다. 같은 역할끼리 A, B, C… */
export function buildAliases(entries: { name: string; role: string }[]): AliasPair[] {
  const seq = new Map<string, number>()
  const out: AliasPair[] = []

  for (const e of entries) {
    const name = e.name.trim()
    if (!name) continue
    if (out.some((p) => p.real === name)) continue

    const role = e.role.trim() || '관계자'
    const n = (seq.get(role) ?? 0) + 1
    seq.set(role, n)
    out.push({ real: name, alias: `${role}${String.fromCharCode(64 + n)}` })
  }
  return out
}

/** 정규식에 쓰일 수 있는 글자를 막아 준다. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 실명 → 가명. 긴 이름부터 바꿔야 "김철" 이 "김철수" 를 깨뜨리지 않는다.
 * 번호류는 규칙으로 함께 지운다.
 */
export function maskText(text: string, pairs: AliasPair[]): string {
  let out = text

  const ordered = [...pairs].sort((a, b) => b.real.length - a.real.length)
  for (const p of ordered) {
    if (!p.real) continue
    out = out.replace(new RegExp(escapeRe(p.real), 'g'), p.alias)
  }

  for (const rule of AUTO_RULES) out = out.replace(rule.re, rule.to)
  return out
}

/** 가명 → 실명. 화면에 보여 줄 때만 되돌린다. */
export function unmaskText(text: string, pairs: AliasPair[]): string {
  let out = text
  const ordered = [...pairs].sort((a, b) => b.alias.length - a.alias.length)
  for (const p of ordered) {
    if (!p.alias) continue
    out = out.replace(new RegExp(escapeRe(p.alias), 'g'), p.real)
  }
  return out
}

/**
 * 가린 뒤에도 실명이 남아 있는지 되짚어 본다.
 * 하나라도 남으면 화면에서 경고를 띄운다.
 */
export function leakCheck(masked: string, pairs: AliasPair[]): string[] {
  return pairs.filter((p) => p.real && masked.includes(p.real)).map((p) => p.real)
}
