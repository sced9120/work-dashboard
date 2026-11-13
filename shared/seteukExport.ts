/**
 * 세특 작성실 — AI 앱용 지침 내보내기 · 보고서 요점 뽑기.
 * 시트(16_Rules buildGemText · buildSkillMd)와 같은 모양으로, 작성실이 조립한 규칙을 다른 AI 앱에 한 번 저장해 두게 한다.
 * 학생 자료는 들어가지 않는다 — 규칙(쓰는 규칙 · 예시 · 문체)만 담는다. electron 도 DOM 도 쓰지 않는다.
 */

const SLUG: Record<string, string> = { 과세특: 'subject', 개세특: 'personal', 자율: 'autonomy', 동아리: 'club', 진로: 'career', 행발: 'behavior' }

/** 스킬 이름 — 영문 소문자 · 숫자 · 하이픈만, 64자 이내 */
export function skillName(recKey: string, n = 1): string {
  return `saeteuk-${SLUG[recKey] ?? 'record'}-${n}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64)
}

/** Gemini Gem · ChatGPT GPT · Claude 프로젝트 지침에 붙여 넣을 글 */
export function buildGemText(system: string): string {
  return (
    String(system || '').trim() +
    '\n\n# 사용법\n교사가 학생 자료를 붙여 넣으면 위 규칙대로 특기사항 본문만 쓴다. 여러 명이면 [S1] [S2] 처럼 학생마다 표시 한 줄을 쓰고 다음 줄에 본문을 쓴다.'
  )
}

export const AI_NOTICE_2026 = '2026학년도 기재요령: AI 가 만든 글을 그대로 옮기지 않고, 교사가 직접 관찰한 사실로 확인 · 수정한 뒤 입력한다.'

/** Claude 스킬(SKILL.md) */
export function buildSkillMd(o: { name: string; activity: string; record: string; system: string }): string {
  const desc = `${o.activity} 활동의 학교생활기록부 ${o.record} 초안을 2026학년도 기재요령에 맞춰 쓴다. 교사가 학생 관찰 자료를 주고 세특 · 특기사항 초안을 부탁할 때 쓴다.`.replace(/\s+/g, ' ')
  return [
    '---',
    `name: ${o.name}`,
    `description: ${desc.slice(0, 1000)}`,
    '---',
    '',
    `# ${o.activity} — ${o.record} 초안 쓰기`,
    '',
    '업무데스크 오르빗 세특 작성실에서 내보낸 규칙입니다.',
    '',
    '## 규칙',
    '',
    String(o.system || '').trim(),
    '',
    '## 여러 학생을 한 번에 받을 때',
    '',
    '학생마다 [S1] [S2] 처럼 표시 한 줄을 쓰고 다음 줄에 그 학생의 본문만 쓴다. 학생 자료를 서로 섞지 않는다.',
    '',
    '## 꼭 지킬 것',
    '',
    `- ${AI_NOTICE_2026}`,
    '- 결과는 초안이다. 교사가 직접 관찰한 사실과 맞는지 확인하고 고쳐 쓰도록 답 끝에 한 줄로 알린다.',
    ''
  ].join('\n')
}

/* ---------- 보고서 요점 ---------- */

/** 학생이 쓴 긴 글(보고서 · 소감문 · 활동지)에서 세특에 쓸 사실만 뽑는 규칙 */
export const POINTS_SYSTEM = `# 역할
당신은 학생이 쓴 보고서를 읽고, 그 학생의 세특을 쓸 교사를 돕는 고등학교 교사다.

# 할 일
[학생 글]에서 교사가 세특에 쓸 수 있는 사실만 짧은 요점으로 뽑는다.
- 탐구 주제와 계기, 학생이 직접 한 조사 · 실험 · 계산 · 비교, 사용한 개념과 방법, 결론과 한계, 이어서 해 보려는 것
- 글에 없는 것은 만들지 않는다. 감상 · 다짐은 빼거나 한 줄로 줄인다.
- 보고서 제목, 참고문헌, 대학명 · 기관명 · 대회 · 논문 실적은 옮기지 않는다.

# 출력
"- "로 시작하는 요점 3~6줄만 출력한다. 머리말이나 설명을 붙이지 않는다.`

export const pointsUser = (masked: string): string => `[학생 글]\n${masked.trim()}`

/** 요점 답 다듬기 — '- ' 줄만, 여덟 줄까지 */
export function cleanPoints(raw: string): string {
  const lines = String(raw || '')
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-·•*]\s+/.test(l) || /^\d+[.)]\s+/.test(l))
    .map((l) => '- ' + l.replace(/^([-·•*]|\d+[.)])\s+/, '').replace(/\*\*/g, ''))
  return lines.slice(0, 8).join('\n')
}

/** 요점으로 줄일 만큼 긴 글인지 */
export const POINTS_MIN_CHARS = 200
