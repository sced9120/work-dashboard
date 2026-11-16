// 학생부 주제 지도 — 읽기 · 배치 · 마크다운 · 지시문 (빌드 없이). 이름은 지어낸 것
const { loadShared: load } = require('./tsload.cjs')
const M = load('seteukMap.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

const record = '[수학] 좌표 차를 이용해 점근선을 판단함.\n[동아리] 암호의 빈도 분석을 함.\n[자율] 학급 회의에서 규칙을 정함.'
const good = {
  topics: [
    { id: 't1', name: '유리함수 점근선', areas: ['수학'], evidence: ['좌표 차를 이용해 점근선을 판단함'], competency: '수학적 추론' },
    { id: 't2', name: '암호 빈도 분석', areas: ['동아리', '정보'], evidence: ['빈도 분석을 함'], competency: '문제 해결' },
    { id: 't3', name: '학급 규칙 정하기', areas: ['자율'], evidence: ['규칙을 정함', '둘', '셋', '넷'], competency: '공동체' }
  ],
  links: [{ a: 't1', b: 't2', why: '규칙 찾기' }, { a: 't1', b: 't9', why: 'x' }, { a: 't2', b: 't1', why: '중복' }, { a: 't3', b: 't3', why: '자기' }],
  suggests: [
    { topic: '수학적 모델링', area: '수학', kind: '교과', why: '수학 역량', from: 't1', competency: '모델링' },
    { topic: '통계 탐구', area: '확률과통계', kind: '교과', why: 'w', from: '암호 빈도 분석', competency: 'c' },
    { topic: '진로 탐색', area: '수학', kind: '진로', why: 'w', from: 't1', competency: '' },
    { topic: '엉뚱', area: '', kind: '이상한', why: 'w', from: 't1', competency: '' },
    { topic: '없는 주제에서', area: '자율', kind: '자율', why: 'w', from: 't77', competency: '' },
    { topic: '자율 규칙', area: '행발', kind: '교과', why: 'w', from: 't3', competency: '' }
  ]
}

console.log('1. parseMap')
let m = M.parseMap('```json\n' + JSON.stringify(good) + '\n```', record)
ok(m.topics.length === 3 && m.topics[2].evidence.length === 3, '코드 울타리 · 인용 3개까지')
ok(JSON.stringify(m.topics[1].areas) === '["동아리"]', '학생부에 없는 영역(정보)은 주제에서 뺌')
ok(m.links.length === 1 && m.links[0].a === 't1', '모르는 id · 자기 연결 · 중복 연결은 버림')
ok(m.suggests.find((s) => s.topic === '통계 탐구').from === 't2' && m.suggests.find((s) => s.topic === '통계 탐구').newArea === true, '이름으로 쓴 from 도 id 로 · 학생부에 없는 교과는 newArea')
ok(m.suggests.find((s) => s.topic === '수학적 모델링').newArea === undefined, '있는 과목은 newArea 없음')
const jr = m.suggests.find((s) => s.topic === '진로 탐색')
ok(jr.kind === '진로' && jr.area === '진로', '종류가 진로면 과목 영역 대신 진로에 둠')
ok(!m.suggests.some((s) => s.topic === '엉뚱' || s.topic === '없는 주제에서'), '종류 · 영역이 없는 추천, 모르는 from 은 버림')
const hb = m.suggests.find((s) => s.topic === '자율 규칙')
ok(hb.kind === '자율' && hb.area === '자율', '행발 영역은 자율로, 종류는 영역에 맞춤')
ok(m.suggests.every((s) => M.MAP_KINDS.includes(s.kind)), '종류는 허용된 넷만')
for (const bad of ['', 'not json', '{"topics": [', '[1,2]', 'null']) ok(M.parseMap(bad).topics.length === 0, `엉터리 답 → 빈 지도 (${JSON.stringify(bad).slice(0, 14)})`)
ok(M.parseMap('말씀드리면 ' + JSON.stringify(good) + ' 끝', record).topics.length === 3, '앞뒤 말이 붙어도 읽음')
ok(M.parseMap('{"topics":[{"id":"a","name":"가나다라마바사아자차카타파하","areas":"수학","evidence":"원문"}],}').topics[0].name.length === 12, '12자로 줄이고 문자열도 배열로')
const many = { topics: Array.from({ length: 20 }, (_, i) => ({ id: 't' + i, name: '주제' + i, areas: [], evidence: [] })) }
ok(M.parseMap(JSON.stringify(many)).topics.length === 12, '주제는 12개까지')

console.log('\n2. layoutMap')
const A = M.layoutMap(m, 900, 520)
const B = M.layoutMap(m, 900, 520)
ok(JSON.stringify(A) === JSON.stringify(B), '같은 입력은 같은 자리')
ok(A.nodes.length === m.topics.length + m.suggests.length, '주제 + 추천 모두 놓임')
ok(A.nodes.every((n) => n.x - n.w / 2 >= 0 && n.x + n.w / 2 <= 900 && n.y - n.h / 2 >= 0 && n.y + n.h / 2 <= 520), '상자가 모두 그림 안')
let overlap = 0
for (let i = 0; i < A.nodes.length; i++) for (let j = i + 1; j < A.nodes.length; j++) {
  const a = A.nodes[i], b = A.nodes[j]
  if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2) overlap++
}
ok(overlap === 0, '상자끼리 겹치지 않음')
ok(M.layoutMap({ topics: [], links: [], suggests: [] }, 900, 520).nodes.length === 0, '빈 지도')
const one = M.layoutMap({ topics: [m.topics[0]], links: [], suggests: [] }, 900, 520)
ok(one.nodes.length === 1 && one.nodes[0].x > 0 && one.nodes[0].x < 900, '주제 하나')

console.log('\n3. 마크다운')
ok(M.toMarkdown(m, 'x').includes('## 이어 갈 추천') && M.toMarkdown(m, '').startsWith('# 학생부 주제 지도 — 학생'), '마크다운 복사')

console.log('\n4. buildMapSystem')
const sys = M.buildMapSystem()
ok(sys.includes('수학적 모델링 · 추론') && sys.includes('자율 또는 진로에 둔다') && sys.includes('그 과목 교육과정에 맞는'), '교과 역량 vs 자율 · 진로 규칙')
ok(['대회', '논문', '공인어학시험', '사교육', '지어내지 않는다', '모든 과목을 진로에 잇지 않는다', '점수 · 등급 · 합격 가능성'].every((w) => sys.includes(w)), '지킬 것')
ok(sys.includes('JSON 하나만') && sys.includes('5~12개') && sys.includes('3~6개') && sys.includes('from'), '출력 모양 · 개수 · from')

console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
process.exit(fails ? 1 : 0)
