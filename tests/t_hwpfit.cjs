// shared/hwpfit.ts — 양식과 새 문서 맞춰 보기 · 칸 맞춤 빈칸 · 괄호 안 글자 모양 · 검사관 답 읽기
const { loadShared: load } = require('./tsload.cjs')
const F = load('hwpfit.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

// 칸 맞춤: 양식 "학생 학번:" 뒤 빈칸 20개 → 값 네 글자면 빈칸 15개(사람이 한 것과 같게)
const row = '학생 학번:                    학생 성명: '
const a1 = F.alignLike(row, '학생 학번: 1101  학생 성명: 학생A')
ok(a1 === '학생 학번: 1101' + ' '.repeat(15) + '학생 성명: 학생A', '칸 맞춤 빈칸 되살리기')
ok(a1.indexOf('학생 성명') === row.indexOf('학생 성명'), '뒤 항목이 양식과 같은 자리에서 시작')
ok(F.alignLike('보호자 성명:                  연락처:', '보호자 성명: 보호자A 연락처:').indexOf('연락처') === '보호자 성명:                  연락처:'.indexOf('연락처'), '보호자 줄도')
ok(F.alignLike('- 다   음 -', '- 다 음 -') === '- 다 음 -', '":" 없는 빈칸은 손대지 않음')
ok(F.alignLike('2026년      월      일', '2026년 월 일') === '2026년 월 일', '날짜 빈칸 줄은 그대로')
ok(F.alignLike(row, '학생 학번: 1101, 학생 성명: 학생A') === '학생 학번: 1101, 학생 성명: 학생A', '빈칸 없이 붙인 것은 그대로')

// 괄호 안 굵게
const sample = '귀 자녀가 본교 학생생활규정 『제2부제5조제12항 미인정 결석이 5회 이상인 학생』에 의거 회부되었습니다.'
const so = sample.indexOf('『'), sc = sample.indexOf('』')
const shapes = [...sample].map((_, i) => (i > so && i < sc ? 'B' : 'N'))
const text = '귀 자녀가 본교 학생생활규정 『제2부제5조제15항 교내·교외에서 흡연 또는 음주 행위가 적발된 학생』에 의거 회부되었습니다.'
const to = text.indexOf('『'), tc = text.indexOf('』')
const mapped = [...text].map((_, i) => (i === tc ? 'B' : 'N')) // LCS 가 』 하나만 굵게 한 상태
const fixed = F.bracketShapes(sample, shapes, text, mapped, 'N')
ok(fixed.slice(to + 1, tc).every((v) => v === 'B'), '『 』 안이 모두 굵게')
ok(fixed[to] === 'N' && fixed[tc] === 'N' && fixed[0] === 'N' && fixed[tc + 1] === 'N', '괄호와 바깥은 양식대로')
const plain = [...sample].map(() => 'N')
ok(F.bracketShapes(sample, plain, text, mapped, 'N') === mapped || F.bracketShapes(sample, plain, text, mapped, 'N').join('') === mapped.join(''), '양식 괄호 안이 바탕 모양이면 그대로')

// 양식(빈 통지서 모양 — 이름은 지어낸 것)
const form = [
  ['P0', '학생선도위원회 개최 통지 및 학부모의견서'],
  ['P1', ''],
  ['P2', '안녕하십니까? 자녀 교육에 얼마나 노고가 많으십니까? 가나고등학교는 학생들의 바른 생활지도를 위해 최선을 다하고 있습니다.'],
  ['P3', '귀 자녀가 본교 학생생활규정 『제2부제5조제12항 미인정 결석이 5회 이상인 학생』에 의거 학생선도위원회에 회부되어 선도 조치를 받게 되었습니다. 이에 학생선도위원회를 다음과 같이 개최하오니 바쁘신 중이라도 꼭 참석하셔서 학부모님의 의견 진술 권리를 행사하여 주십시오.'],
  ['P4', '만약 부득이한 이유로 참석할 수 없을 때에는 학생 편으로 보내드리는 학부모의견서를 학교에 보내어 학부모님의 의견 진술 권리를 행사하여 주시고, 학생선도위원회의 결정 사항을 존중하여 주시기 바랍니다.'],
  ['P5', '- 다 음 -'],
  ['P6', '1. 일 시: 2026년 4월 3일(금요일) 13:00 ~'],
  ['P7', '2. 장 소: 본교 1층 학교운영위원회실'],
  ['P8', '3. 참석대상'],
  ['P9', '가. 학생선도위원회 위원'],
  ['P10', '나. 해당 학생 및 학부모'],
  ['P11', '가 나 고 등 학 교 장'],
  ['P12', '학 부 모 의 견 서'],
  ['P13', '학생 학번: 학생 성명:'],
  ['P14', '위 본인은 ( )학생의 보호자로 학생선도위원회의 결정사항을 존중하며, 다만 학생 선도에 대한 보호자 의견은 다음과 같습니다.'],
  ['P15', '2026년 월 일'],
  ['P16', '보호자: 인']
].map(([id, t]) => ({ id, text: t, kind: t ? 'text' : 'empty' }))
const P = (sample, text) => ({ kind: 'p', sample, text })
const keep = (id) => P(id, form.find((f) => f.id === id).text)

// 앱이 쓴 것과 같은 꼴(제11회): 제목 바꿈 · "이에 …" 빠짐 · 설명 문단 · 장소 줄 빠짐 · 빈칸 채움
const bad = [
  P('P0', '제11회 학생선도위원회 개최 통지 및 학부모의견서'),
  keep('P2'),
  P('P3', '귀 자녀가 본교 학생생활규정 『제2부 제5조 제15항』에 의거 학생선도위원회에 회부되어 선도 조치를 받게 되었습니다. 회부 사유는 숙소에서 흡연한 사안입니다.'),
  P('P3', '학생생활규정 제2부 제5조 제15항은 흡연 또는 음주 행위가 적발된 학생에 관한 규정으로, 흡연 1회는 교내봉사에 해당합니다.'),
  keep('P4'), keep('P5'),
  P('P6', '1. 일 시: 2026년 11월 11일(수요일)'),
  keep('P8'), keep('P9'), keep('P10'), keep('P11'), keep('P12'),
  P('P13', '학생 학번: 1101 학생 성명: 학생A'),
  P('P14', '위 본인은 학생A 학생의 보호자로 학생선도위원회의 결정사항을 존중하며, 다만 학생 선도에 대한 보호자 의견은 다음과 같습니다.'),
  keep('P15'), keep('P16')
]
const found = F.checkAgainstForm(form, bad)
const kinds = (k) => found.filter((f) => f.kind === k)
ok(kinds('빠진 문장').some((f) => f.detail.startsWith('이에 학생선도위원회를')), '빠진 "이에 … 참석" 문장')
ok(kinds('빠진 항목').some((f) => f.where === 'P7'), '빠진 "2. 장 소" 줄')
ok(kinds('번호').length === 1 && /1 다음이 3/.test(kinds('번호')[0].detail), '번호 1 → 3 건너뜀')
ok(kinds('새 문단').some((f) => f.detail.startsWith('학생생활규정 제2부')), '지어 붙인 규정 풀이 문단')
ok(kinds('제목').length === 1, '제목 바꿈')
ok(kinds('빈칸').some((f) => f.where === 'P14'), '받는 사람 빈칸을 채움')
ok(F.checkAgainstForm(form, bad.filter((it) => it.sample !== 'P12')).some((f) => f.kind === '빠진 문단' && f.where === 'P12'), '머리 줄 "학 부 모 의 견 서" 가 통째로 빠짐')
ok(!found.some((f) => f.kind === '빠진 문단' && f.where === 'P3'), '문장이 바뀐 문단은 통째로 빠졌다고 하지 않음')
ok(!kinds('빠진 문장').some((f) => f.detail.startsWith('만약')), '있는 문장은 빠졌다고 하지 않음')
ok(F.findingsText(found).includes('[P7] 빠진 항목'), '검사관에게 줄 글')

// 양식대로 쓴 것은 문제 없음 — 학생 두 명(두 벌)
const one = (n, who) => [
  keep('P0'), keep('P2'),
  P('P3', '귀 자녀가 본교 학생생활규정 『제2부제5조제15항 교내·교외에서 흡연 또는 음주 행위가 적발된 학생』에 의거 학생선도위원회에 회부되어 선도 조치를 받게 되었습니다. 이에 학생선도위원회를 다음과 같이 개최하오니 바쁘신 중이라도 꼭 참석하셔서 학부모님의 의견 진술 권리를 행사하여 주십시오.'),
  keep('P4'), keep('P5'),
  P('P6', '1. 일 시: 2026년 11월 11일(수요일) 13:00 ~'),
  keep('P7'), keep('P8'), keep('P9'), keep('P10'), keep('P11'), keep('P12'),
  P('P13', `학생 학번: ${n} 학생 성명: ${who}`),
  keep('P14'), keep('P15'), keep('P16')
]
const good = [...one('1101', '학생A'), ...one('1102', '학생B')]
const none = F.checkAgainstForm(form, good)
ok(none.length === 0, `양식대로 쓴 두 벌은 문제 없음 (${none.map((f) => f.kind + ':' + f.detail).join(', ')})`)
// 둘째 벌에서만 빠져도 찾는다
const second = [...one('1101', '학생A'), ...one('1102', '학생B').filter((it) => it.sample !== 'P7')]
ok(F.checkAgainstForm(form, second).some((f) => f.where === 'P7'), '둘째 학생 장에서 빠진 줄도')

// 검사관 답 읽기
const ans = F.parseInspection(`## 검사
- [P3] "이에 학생선도위원회를 …" 문장을 되살렸습니다
- [P7] 장소 줄을 되살렸습니다
## 물을 것
- 회의 시각을 알려 주세요 | 13:00 ~
## 고친 문서
[P0] 학생선도위원회 개최 통지 및 학부모의견서
[P2] 안녕하십니까?`)
ok(ans.fixed.length === 2 && ans.fixed[1].includes('장소'), '고친 것 두 줄')
ok(ans.ask.length === 1 && ans.ask[0].q === '회의 시각을 알려 주세요' && ans.ask[0].hint === '13:00 ~', '물을 것과 지금 값')
ok(ans.doc.startsWith('[P0]'), '고친 문서')
const same = F.parseInspection('## 검사\n- 없음\n## 물을 것\n- 없음\n## 고친 문서\n그대로')
ok(!same.fixed.length && !same.ask.length && same.doc === '', '"없음" · "그대로"')
ok(F.parseInspection('아무 말').doc === '', '모양이 틀린 답은 고친 문서 없음')

console.log(fails ? `\n${fails}개 실패` : '\n모두 통과')
process.exit(fails ? 1 : 0)
