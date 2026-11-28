// 세특 검사 — 부정적 서술 · 다짐 표현 점검 (3.8.0~, 빌드 없이). 문장은 모두 지어낸 것
const { loadShared: load } = require('./tsload.cjs')
const S = load('seteuk.ts')
const R = load('seteukRules.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const hit = (text, label) => S.validateSeteuk(text, 0).issues.find((x) => x.label === label)
const pair = (label, bad, good) => {
  const h = hit(bad, label)
  ok(!!h && h.level === 'check', `${label} — 잡음: ${bad}`)
  ok(!hit(good, label), `${label} — 안 잡음: ${good}`)
}

console.log('부정적 서술 · 다짐 (모두 살펴볼 곳)')
pair('표현 점검 · 뒤집는 구조', '기구 조작이 서툴렀으나 순서를 그림으로 그려 확인함.', '기구 조작 순서를 그림으로 그려 확인하며 실험을 진행함.')
pair('표현 점검 · 뒤집는 구조', '처음에는 발표를 어려워하였으나 자료를 준비함.', '발표 자료를 세 쪽으로 나누어 준비함.')
pair('표현 점검 · 이전 수준을 드러냄', '제출 기한을 넘기는 일이 줄어듦.', '주간 점검표를 만들어 과제 기한을 스스로 관리함.')
pair('표현 점검 · 이전 수준을 드러냄', '계산 실력이 향상됨.', '검산 과정을 표로 정리하여 계산 결과를 확인함.')
pair('표현 점검 · 사건을 짐작하게 함', '친구와 다툼 뒤 먼저 사과함.', '모둠 회의에서 서로 다른 의견을 정리하여 안을 냄.')
pair('표현 점검 · 사건을 짐작하게 함', '지각 없이 등교함.', '아침 독서 시간에 꾸준히 책을 읽음.')
pair('표현 점검 · 부정문 칭찬', '한 번도 과제를 빠뜨리지 않음.', '꾸준히 과제를 기한에 맞추어 제출함.')
pair('표현 점검 · 고치기 전 잘못', '풀이에 잘못된 곳이 있음을 찾아 고침.', '검산하며 풀이 단계를 점검함.')
pair('표현 점검 · 다짐 · 소감', '앞으로 환경을 지키는 사람이 되고 싶다고 다짐함.', '분리배출 안내문을 만들어 학급 게시판에 붙임.')
ok(!hit('작품 속 인물의 갈등 구조를 분석함.', '표현 점검 · 사건을 짐작하게 함'), '작품 속 갈등 분석은 안 잡음')
ok(!hit('사과의 단면을 관찰함.', '표현 점검 · 사건을 짐작하게 함'), '과일 사과는 안 잡음')
ok(!hit('진로 상담 내용을 정리함.', '표현 점검 · 사건을 짐작하게 함'), '진로 상담은 안 잡음')
const added = ['표현 점검 · 뒤집는 구조', '표현 점검 · 이전 수준을 드러냄', '표현 점검 · 사건을 짐작하게 함', '표현 점검 · 부정문 칭찬', '표현 점검 · 고치기 전 잘못', '표현 점검 · 다짐 · 소감']
ok(added.every((l) => R.SETEUK_AI_TELL.some((r) => r.label === l && r.level === 'check')), '새 규칙은 모두 확인(check)만 — 자동 고쳐쓰기를 부르지 않음')
ok(!(R.SETEUK_HARD ?? S.SETEUK_HARD ?? []).some((r) => added.includes(r.label)), '지침 금지어(자동 고쳐쓰기)에는 넣지 않음')

console.log('관련 성취기준')
const act = S.newActivity('a1', { name: '함수 탐구', rec: '과세특', standards: '[10공수1-01-01] 다항식의 사칙연산의 원리를 설명하고, 그 계산을 할 수 있다.\n\n' })
const p = S.buildSeteukPrompt(act)
ok(p.includes('# 관련 성취기준') && p.includes('[10공수1-01-01]') && p.includes('옮겨 적지 않는다'), '성취기준 칸이 프롬프트에 들어간다')
ok(!S.buildSeteukPrompt(S.newActivity('a2', { name: 'x' })).includes('# 관련 성취기준'), '비면 넣지 않는다')
const back = S.readActs(JSON.stringify([act]))
ok(back[0].standards.startsWith('[10공수1-01-01]'), '저장했다 읽어도 성취기준이 남는다')

process.exit(fails ? 1 : 0)
