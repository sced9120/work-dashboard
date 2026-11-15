// shared/seteuk.ts · shared/seteukSum.ts — 관찰 기록 날짜(stampNote) · 프롬프트의 날짜 규칙 · 학생끼리 견주기(checkEquity · pairsOf) (빌드 없이). 이름은 지어낸 것
const { loadShared: load } = require('./tsload.cjs')
const S = load('seteuk.ts')
const M = load('seteukSum.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

console.log('1. stampNote')
const d1 = new Date(2026, 10, 16)
const d2 = new Date(2026, 2, 5)
ok(S.stampNote('', d1) === '[11.16] ', '빈 기록 → 날짜만')
ok(S.stampNote('발표를 했다', d1) === '발표를 했다\n[11.16] ', '줄바꿈 없이 끝나면 줄을 바꿔 붙임')
ok(S.stampNote('발표를 했다\n', d1) === '발표를 했다\n[11.16] ', '줄바꿈으로 끝나면 그대로 붙임')
ok(S.stampNote('', d2) === '[3.5] ', '한 자리 달 · 날은 0 을 붙이지 않음')
ok(S.stampNote(S.stampNote('', d2), d1) === '[3.5] \n[11.16] ', '두 번 붙이면 두 줄')

console.log('2. 프롬프트의 날짜 규칙')
const act = S.newActivity('a1', { name: '함수 탐구', rec: '과세특' })
const p = S.buildSeteukPrompt(act)
ok(p.includes('[3.12] 같은 날짜가 있으면 시간 순서로 읽고'), '날짜를 시간 순서로 읽는 규칙이 있음')
ok(p.includes('날짜는 글에 쓰지 않는다'), '날짜를 글에 쓰지 않는 규칙이 있음')
const p2 = S.buildSeteukPrompt({ ...act, columns: ['관찰', '질문'] })
ok(p2.includes('둘 이상이면 기록이 뒷받침하는 만큼만'), '항목으로 나눈 기록에도 규칙이 있음')

console.log('3. 학생끼리 견주기')
const same1 = '함수의 그래프를 모둠원과 함께 그려 보며 변화율이 커지는 구간을 찾아 설명하고 친구의 질문에 근거를 들어 답함'
const same2 = '함수의 그래프를 모둠원과 함께 그려 보며 변화율이 커지는 구간을 찾아 설명하고 친구의 질문에 근거를 들어 답하였음'
const other = '교과서 밖의 통계 자료를 스스로 찾아 평균과 분산의 차이를 비교하고 발표 자료에 표로 정리하여 학급에 공유함'
const items = [
  { label: '10101 가나다', text: same1 },
  { label: '10102 라마바', text: same2 },
  { label: '10103 사아자', text: other }
]
const r = M.checkEquity(items)
ok(r.similar.length === 1, '거의 같은 두 글 → 한 쌍')
ok(r.similar[0].a === '10101 가나다' && r.similar[0].b === '10102 라마바', '짝 이름')
ok(r.empty.length === 0, '빈 학생 없음')
const pa = M.pairsOf(r, '10101 가나다')
ok(pa.length === 1 && pa[0].other === '10102 라마바' && pa[0].ratio >= 0.4, 'pairsOf — 가나다의 상대는 라마바')
ok(M.pairsOf(r, '10102 라마바')[0].other === '10101 가나다', 'pairsOf — 반대쪽에서도 찾음')
ok(M.pairsOf(r, '10103 사아자').length === 0, 'pairsOf — 다른 글은 없음')
ok(M.pairsOf(null, '10101 가나다').length === 0, 'pairsOf — 보고서가 없으면 빈 목록')

const r2 = M.checkEquity([
  { label: 'A 가나다', text: same1 },
  { label: 'B 라마바', text: other },
  { label: 'C 사아자', text: '' }
])
ok(r2.similar.length === 0, '서로 다른 글 → 쌍 없음')
ok(r2.empty.length === 1 && r2.empty[0] === 'C 사아자', '빈 글 찾기')

if (fails) { console.log(`\n${fails}개 실패`); process.exit(1) }
console.log('\n모두 통과')
