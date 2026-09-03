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
  '목격자',
  '상담사'
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
 * 두 글자 성. 이름이 네 글자가 되는 것은 이때뿐이다.
 */
const DOUBLE_SURNAMES = ['남궁', '선우', '황보', '독고', '제갈', '사공', '서문', '을지']

/**
 * 이름 자리에 올 수 있는 토막.
 *
 * 길이를 세 글자로 묶어 둔다. 예전에는 네 글자까지 잡았는데,
 * "인성부장 김택동입니다" 에서 '김택동입' 처럼 조사까지 삼켜 버렸다.
 * 네 글자는 두 글자 성일 때뿐이므로 그때만 따로 허락한다.
 */
const NAME = `(?:(?:${DOUBLE_SURNAMES.join('|')})[가-힣]{1,2}|[가-힣]{2,3})`

/**
 * 표지 뒤에 붙는 조사. "학생이", "학생은", "학생에게" 처럼 붙여 쓴다.
 *
 * 예전에는 표지 뒤에 한글이 오면 무조건 이름이 아닌 것으로 보았다.
 * 그런데 우리말은 조사가 붙는 말이라, 그러면 "이동현 학생이" 처럼
 * 가장 흔한 꼴을 통째로 놓친다. 조사만 허락하고
 * "학생회"·"학생부" 처럼 낱말이 이어지는 것은 그대로 막는다.
 */
const AFTER =
  '(?:님)?(?:들)?(?:께서|에게|으로|입니다|이며|이라|이고|은|는|이|가|을|를|의|에|와|과|도|만|로|께|임)?(?![가-힣])'

/** 이름 뒤에 바로 붙는 서술격조사. "김택동입니다" */
const COPULA = '(?=입니다|이며|이고|이라|임)'

/** "이정숙 님", "홍길동님" 처럼 뒤에 높임말만 오는 것도 이름의 끝이다. */
const HONORIFIC = '(?=[ \\t]*님)'

/**
 * 서식의 칸에 적힌 값은 이름 하나로 끝난다.
 *
 * 대본은 "■ 인성부장 : 반갑습니다…" 처럼 쌍점 뒤에 대사가 이어지는데,
 * 이것이 "보호자: 홍판서" 와 생김새가 같다. 뒤에 말이 이어지면
 * 이름이 아닌 것으로 본다. 이 조건이 없으면 대본의 대사가 통째로 지워진다.
 */
const VALUE_END = '(?=[ \\t]*(?:$|[,、·/|()\\[\\]])|[ \\t]{2,})'

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
  '직급',
  // 회의 대본·진행 절차에 흔히 나오는 말
  '선도',
  '진행',
  '절차',
  '진술',
  '개요',
  '개회',
  '폐회',
  '사안',
  '차례',
  '인사',
  '성원',
  '질의',
  '응답',
  '통보',
  '입장',
  '퇴장',
  '발언',
  '동의',
  '의사',
  '규정',
  '조항',
  '징계',
  '금품',
  '흡연',
  '폭행',
  '폭언',
  '욕설',
  '적발',
  '누계',
  '결석',
  '지각',
  '조퇴',
  '미인',
  '본교',
  '우리',
  '이제',
  '먼저',
  '이것',
  '지금',
  '수고',
  '교육',
  '교무',
  '상담',
  '생활',
  '안전',
  '인성',
  '학교',
  '교실',
  '사건',
  '사항',
  '전달',
  '설명',
  '논의',
  '심사',
  '서면',
  '비밀',
  '유지',
  '의무',
  '변화',
  '갈등',
  '의견',
  '표결',
  '찬성',
  '반대',
  '기권',
  '불복',
  '신고',
  '목격',
  '최후',
  '경위',
  '조사서'
])

/** 이름이라면 이렇게 끝나지 않는다. 부서·기구 이름을 걸러 낸다. */
const NOT_NAME_TAIL = /[회실팀청과별]$/

/**
 * 직위나 칸 이름으로 끝나면 이름이 아니다.
 * "교감선생님 / 위원 김미영" 에서 '선생님' 이 이름으로 잡히는 것을 막는다.
 */
const ROLE_TAIL = new RegExp('(?:' + [...ROLE_MARKERS, ...NAME_LABELS].join('|') + ')$')

/**
 * "이상인 학생" 의 '이상인' 처럼, 흔한 말에 어미가 붙어 이름꼴이 된 것.
 * 앞 두 글자가 이름이 아닌 말이고 끝이 어미면 이름으로 보지 않는다.
 * '이상현' 같은 진짜 이름은 끝 글자가 어미가 아니므로 그대로 남는다.
 */
const ENDING = /[은는인한된할이가의도만과와로]$/
function looksLikeWord(name: string): boolean {
  return name.length === 3 && NOT_NAMES.has(name.slice(0, 2)) && ENDING.test(name)
}

/** 성이 맞는지 따져 본다. 두 글자 성이면 그것으로 갈음한다. */
function looksLikeSurname(name: string): boolean {
  return SURNAMES.has(name[0]) || DOUBLE_SURNAMES.some((s) => name.startsWith(s))
}

/**
 * 글에서 사람 이름으로 보이는 것을 추려 낸다.
 * 확실하지 않으므로 화면에서 사람이 확인하도록 후보만 돌려준다.
 */
export function findNameCandidates(text: string): string[] {
  const tight = TIGHT_MARKERS.join('|')
  const role = ROLE_MARKERS.join('|')
  const all = [...TIGHT_MARKERS, ...ROLE_MARKERS, ...NAME_LABELS].join('|')

  /** 자리가 분명해서 성을 따지지 않아도 되는 것 */
  const sure = new Set<string>()
  /** 성이 맞는지 따져 봐야 하는 것 */
  const maybe = new Set<string>()

  const scan = (re: RegExp, into: Set<string>): void => {
    for (const m of text.matchAll(re)) if (m[1]) into.add(m[1])
  }

  // 1) "1727 홍길동 학생" — 학번이 앞에 붙으면 자리가 분명하다.
  //    귀화 학생처럼 우리 성이 아닌 이름도 여기서 잡힌다.
  scan(new RegExp(`(?:^|[\\s.)])\\d{4,5}\\s+(${NAME})\\s*(?:${tight})${AFTER}`, 'gm'), sure)

  // 2) "홍길동 학생", "김철수군" — 붙여 써도 된다.
  //    앞에 경계를 두어 "일반학생회" 같은 데서 잘려 나오지 않게 한다.
  scan(new RegExp(`(?:^|[\\s,·:：(\\[/])(${NAME})\\s*(?:${tight})${AFTER}`, 'gm'), maybe)

  // 3) "박정민 위원장" — 직위가 뒤에 올 때는 반드시 띄어 쓴 것만
  scan(new RegExp(`(${NAME})\\s+(?:${role})${AFTER}`, 'g'), maybe)

  // "위원 김미영 교무지원부장" — 앞뒤가 모두 직위면 가운데는 이름이다.
  const between = `(?=[ \\t]+[가-힣]{0,4}(?:${role})${AFTER})`

  // 4) "인성부장 김택동입니다", "위원장 홍길동" — 표지가 앞에 올 때.
  //    뒤에 말이 이어지면 이름이 아니라 대사다.
  scan(
    new RegExp(
      `(?:${all})\\s+(${NAME})(?:${COPULA}|${HONORIFIC}|${between}|${VALUE_END})`,
      'gm'
    ),
    maybe
  )

  // 5) "보호자: 홍판서", "성명: 김영수" — 쌍점으로 이어진 칸
  scan(new RegExp(`(?:${all})\\s*[:：]\\s*(${NAME})${VALUE_END}`, 'gm'), maybe)

  // 6) "홍길동 (인)" 처럼 서명란에 적힌 경우
  scan(new RegExp(`(${NAME})\\s*\\(\\s*(?:인|서명)\\s*\\)`, 'g'), maybe)

  // 7) "2학년 3반 15번 홍길동" — 명부나 표에서 학번 뒤에 이름만 오는 경우
  scan(new RegExp(`(?:\\d+\\s*[반번])\\s+(${NAME})(?:${COPULA}|${VALUE_END})`, 'gm'), maybe)

  const usable = (n: string): boolean =>
    !NOT_NAMES.has(n) &&
    !NOT_NAME_TAIL.test(n) &&
    !ROLE_TAIL.test(n) &&
    !looksLikeWord(n) &&
    !n.includes('○') &&
    !n.includes('*')

  return [
    ...new Set([
      ...[...sure].filter(usable),
      ...[...maybe].filter((n) => usable(n) && looksLikeSurname(n))
    ])
  ]
}

/**
 * 학번처럼 사람을 곧바로 가리키는 번호를 찾는다.
 *
 * 이름을 가려도 학번이 남으면 명부 한 장으로 누구인지 알 수 있다.
 * 이름과 함께 가명으로 바꿔 보내고, 돌아온 결과에서 되돌린다.
 */
export function findIdNumbers(text: string): string[] {
  const found = new Set<string>()
  const tight = TIGHT_MARKERS.join('|')

  // "3616 이동현 학생" — 이름 앞에 붙은 번호
  const front = new RegExp(`(?:^|[\\s.)])(\\d{4,5})\\s+${NAME}\\s*(?:${tight})${AFTER}`, 'gm')
  for (const m of text.matchAll(front)) found.add(m[1])

  // "학번: 30612"
  for (const m of text.matchAll(/학번\s*[:：]?\s*(\d{4,10})/g)) found.add(m[1])

  return [...found]
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
  // 이름을 가려도 학번이 남으면 명부 한 장으로 누구인지 알 수 있다.
  // "3616 ○○○ 학생" 처럼 이름 앞에 붙은 번호는 함께 가린다.
  {
    label: '학번',
    re: /(?<![\d\-.])\d{4,5}(?=\s+[가-힣○]{2,4}\s*(?:학생|군|양))/g,
    to: '○○○○'
  },
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
    const re = new RegExp(nameRe(name), 'g')
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

/**
 * 이름을 낱말 첫머리에서만 바꾸도록 묶는다.
 *
 * 뒤는 묶지 않는다. "김택동입니다" 처럼 조사가 붙어도 바꿔야 하기 때문이다.
 * 앞을 묶지 않으면 잘못 잡힌 두 글자가 "학생선도위원회" 한가운데를 파먹는다.
 */
function nameRe(name: string): string {
  // 학번 같은 번호는 더 긴 번호의 한 토막일 때 건드리면 안 된다.
  if (/^\d+$/.test(name)) return '(?<!\\d)' + escapeRe(name) + '(?!\\d)'
  return '(?<![가-힣])' + escapeRe(name)
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
    out = out.replace(new RegExp(nameRe(p.real), 'g'), p.alias)
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
