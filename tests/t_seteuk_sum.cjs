// shared/seteukSum.ts · shared/seteukNeis.ts — 취합 · 압축 규칙 · 학생 간 점검 · 나이스 양식 채우기 (빌드 없이). 이름은 지어낸 것
const { loadShared: load } = require('./tsload.cjs')
const S = load('seteuk.ts')
const M = load('seteukSum.ts')
const N = load('seteukNeis.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

console.log('1. 취합')
const acts = [
  S.newActivity('a1', { name: '함수 탐구', rec: '과세특' }),
  S.newActivity('a2', { name: '독서 토론', rec: '자율' }),
  S.newActivity('a3', { name: '통계 프로젝트', rec: '과세특' })
]
const rows = {
  a1: { '1-1': { note: '', ai: '초안 글.', final: '다듬은 글.' }, '1-2': { note: '', ai: '초안만\n있음.', final: '  ' } },
  a3: { '1-1': { note: '', ai: '', final: '통계 글.' } },
  a2: {}
}
const areas = M.areasOf(acts)
ok(areas.map((a) => a.rec.key).join() === '과세특,자율' && areas[0].acts.length === 2 && areas[0].limit === 1500, '활동이 있는 영역만, 정해진 차례 · 한도')
const p1 = M.partsOf(areas[0], rows, '1-1')
ok(p1.join('|') === '다듬은 글.|통계 글.' && M.mergedOf(p1) === '다듬은 글. 통계 글.', '활동 차례대로 · 최종본 먼저')
ok(M.partsOf(areas[0], rows, '1-2').join('|') === '초안만 있음.|' && M.mergedOf(M.partsOf(areas[0], rows, '9-9')) === '', '최종본이 비면 초안(줄바꿈은 빈칸) · 글 없는 학생')

console.log('\n2. 최종본 · 상태')
const long = '가'.repeat(40)
ok(M.sumFinal(undefined, '합본.', 100) === '합본.' && M.sumFinal(undefined, long, 100) === '' && M.sumFinal({ final: '' }, '합본.', 100) === '' && M.sumFinal({ ai: '압축' }, '합본.', 100) === '합본.', '손대지 않았으면 한도 안의 합본 · 넘으면 빈칸 · 지운 것은 지운 대로')
ok(M.sumState(undefined, '합본.', 100) === 'same' && M.sumState(undefined, long, 100) === 'over' && M.sumState(undefined, '', 100) === 'none', '합본 그대로 · 한도 넘음 · 빈 칸')
ok(M.sumState({ ai: '줄인 글.', final: '줄인 글.' }, long, 100) === 'ai' && M.sumState({ ai: '줄인 글.', final: '고친 글.' }, long, 100) === 'edit' && M.sumState({ final: long }, long, 100) === 'over', '압축본 · 다듬음 · 최종본이 한도를 넘음')
ok(M.adoptCompressed(undefined, long, '줄인 글.', 100) && M.adoptCompressed({ final: long }, long, '줄인 글.', 100) && M.adoptCompressed({ final: '합본.' }, '합본.', '줄인 글.', 100), '최종본이 비었거나 · 한도를 넘거나 · 합본 그대로면 압축본을 넣음')
ok(!M.adoptCompressed({ final: '선생님이 다듬은 글.' }, long, '줄인 글.', 100) && !M.adoptCompressed(undefined, long, '  ', 100), '다듬은 글은 덮지 않음 · 빈 압축본')
ok(M.trimToBytes('가나다라마. 바사아자', 20) === '가나다라마.' && M.trimToBytes('가나다라마', 9) === '가나다' && M.trimToBytes('짧음', 100) === '짧음', '한도 안으로 자르기 — 되도록 마침표에서')

console.log('\n3. 압축 규칙')
const cp = M.compressPrompt(S.recordOf('과세특'))
ok((cp.match(/^# .+$/gm) || []).join(' | ') === '# 역할 | # 과제 | # 서술 규칙 | # 학생부 기재 금지사항 | # 분량 | # 출력', '조립 순서')
ok(cp.includes('당신은 여러 교과를 15년간 지도해 온 고등학교 교사입니다.') && !/[{}]/.test(cp), '역할 — 과목 빈칸은 "여러 교과를"')
ok(cp.includes('하나의 과목별 세부능력 및 특기사항으로 통합') && cp.includes('500자(1500바이트) 이내') && cp.includes('1350바이트 이상'), '과제 · 분량')
ok(M.compressPrompt(S.recordOf('행발')).includes('300자(900바이트) 이내') && M.compressUser(' 글 ') === '[통합할 문장들]\n글', '행발 한도 · 보내는 글')

console.log('\n4. 학생 간 점검')
const base = '실생활 자료로 함수의 그래프를 그리고 구간마다 기울기를 비교하여 변화율의 뜻을 설명함. 모둠 토의에서 나온 질문에 자료를 다시 정리하여 답함.'
ok(M.similarity(base, base) === 1 && M.similarity(base, '전혀 다른 내용으로 독서 토론에서 근거를 들어 반론하고 상대의 말을 요약하여 되물음.') === 0 && M.similarity('', base) === 0, '겹침 비율')
const eq = M.checkEquity([
  { label: '1번 가', text: base },
  { label: '2번 나', text: base + ' 풀이를 고쳐 발표함.' },
  { label: '3번 다', text: '독서 토론에서 근거를 들어 반론하고 상대의 말을 요약하여 되물음. 토론 뒤 자신의 주장을 고쳐 글로 정리하고 친구의 글에 의견을 적어 줌.' },
  { label: '4번 라', text: '짧은 글.' },
  { label: '5번 마', text: '  ' },
  { label: '6번 바', text: '통계 자료를 모아 표와 그래프로 나타내고 평균과 중앙값이 달라지는 까닭을 설명함. 자료를 더 모아 처음의 결론을 고치고 발표함.' }
])
ok(eq.n === 6 && eq.filled === 5 && eq.empty.join() === '5번 마', '학생 수 · 빈 최종본')
ok(eq.similar.length === 1 && eq.similar[0].a === '1번 가' && eq.similar[0].b === '2번 나' && eq.similar[0].ratio === 1, '같은 문장 쌍')
ok(eq.gaps.length === 1 && eq.gaps[0].label === '4번 라' && eq.gaps[0].kind === '짧음' && eq.median > 0, '분량 차이(4명 이상일 때)')
ok(M.checkEquity([{ label: 'a', text: '짧음' }, { label: 'b', text: base }]).gaps.length === 0, '학생이 적으면 분량은 보지 않음')
ok(Object.keys(M.readSums('망가짐')).length === 0 && M.readSums('{"1-1":{"ai":"x","final":3},"1-2":{}}')['1-1'].final === undefined && !('1-2' in M.readSums('{"1-2":{}}')), '망가진 설정')

console.log('\n5. 나이스 양식')
const is = (ref, t, s = '') => `<c r="${ref}"${s} t="inlineStr"><is><t>${t}</t></is></c>`
const headA = ['학년도', '학기', '학년', '학생개인번호', '과목', '과목코드', '반/번호', '성명', '학적변동 구분', '세부능력 및 특기사항', '영재·발명교육 기록사항']
const L = 'ABCDEFGHIJK'
const rowA = (r, clsNo, name, status, content) =>
  `<row r="${r}">${is('A' + r, '2026')}${is('B' + r, '2')}${is('C' + r, '1')}${is('D' + r, 'P00' + r)}${is('E' + r, '공통수학2')}${is('F' + r, 'M02')}${is('G' + r, clsNo)}${is('H' + r, name)}${is('I' + r, status)}` +
  (content ? is('J' + r, content, ' s="4"') : `<c r="J${r}" s="4"></c>`) + `<c r="K${r}" s="4"/></row>`
const sheetA = `<?xml version="1.0"?><worksheet><sheetData><row r="1">${headA.map((h, i) => is(L[i] + '1', h)).join('')}</row>` +
  rowA(2, '1/1', '가나다', '재학') + rowA(3, '1/2', '라 마바', '재학') + rowA(4, '1/3', '사아자', '전출') + rowA(5, '1/4', '차카타', '재학', '이미 쓴 글') + rowA(6, '1/5', '다른이', '재학') + rowA(7, '2/1', '없는반', '재학') + rowA(8, '1/6', '빈글이', '재학') +
  '</sheetData></worksheet>'
const partsA = {
  'xl/workbook.xml': '<workbook><sheets><sheet name="세특 &amp; 양식" sheetId="1" r:id="rId3"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId3" Target="worksheets/sheet7.xml"/></Relationships>',
  'xl/worksheets/sheet7.xml': sheetA
}
const form = N.readNeisForm(partsA)
ok(form.kind === '과세특' && form.subject === '공통수학2' && form.year === '2026' && form.term === '2' && form.sheetName === '세특 & 양식' && form.sheetPath === 'xl/worksheets/sheet7.xml', '과목 세특 양식 — 종류 · 과목 · 학년도 · 시트 자리')
ok(form.contentCol === 9 && form.rows.length === 7 && form.rows[0].cls === 1 && form.rows[0].no === 1 && form.rows[0].year === 1 && form.rows[3].content === '이미 쓴 글', '넣는 칸 J · 반/번호 나눔 · 이미 든 글')
const src = [
  { cls: '1', no: '1', name: '가나다', text: '첫 학생 글 <A&B>.' },
  { cls: '1', no: '2', name: '라마바', text: '둘째\n글.' },
  { cls: '1', no: '3', name: '사아자', text: '전출 학생 글.' },
  { cls: '1', no: '4', name: '차카타', text: '새 글.' },
  { cls: '1', no: '5', name: '이름다름', text: '글.' },
  { cls: '1', no: '6', name: '빈글이', text: ' ' },
  { cls: '1', no: '7', name: '고칠이', text: '고칠 글.', flagged: true }
]
let plan = N.matchNeisRows(form.rows, src, { limit: 1500 })
ok(plan.filter((x) => x.ok).map((x) => x.r).join() === '2,3' && plan[1].label === '1학년 1반 2번 라 마바', '반 · 번호 · 성명이 맞는 학생만 (성명의 빈칸은 무시)')
ok(plan.map((x) => x.why).join('|') === '||학적변동: 전출|나이스 양식에 이미 내용이 있음|반 · 번호는 같은데 이름이 다름|명단에 없는 학생|최종본이 비어 있음', `빠지는 까닭: ${plan.map((x) => x.why).join('|')}`)
ok(N.matchNeisRows(form.rows, src, { limit: 1500, overwrite: true })[3].ok && N.matchNeisRows(form.rows, src, { limit: 5 })[0].why.startsWith('바이트 초과'), '이미 든 글도 바꾸기 · 바이트 초과')
const fl = N.matchNeisRows([{ r: 2, year: 1, cls: 1, no: 7, name: '고칠이', status: '재학', content: '' }], src, {})
ok(fl[0].why === '검사에서 고칠 곳이 남아 있음' && N.matchNeisRows([{ r: 2, year: 1, cls: 1, no: 7, name: '고칠이', status: '', content: '' }], src, { includeFlagged: true })[0].ok, '고칠 곳이 남은 글은 빼고, 고르면 넣음')
ok(N.neisColumn(plan).join('|') === '첫 학생 글 <A&B>.|둘째 글.|||||', '양식 순서대로 한 열 — 빠진 학생은 빈 줄, 줄바꿈은 빈칸')

const fills = {}
for (const x of plan) if (x.ok) fills[x.r] = x.text
const out = N.fillNeisSheetXml(sheetA, form.contentCol, fills)
ok(out.includes('<c r="J2" s="4" t="inlineStr"><is><t xml:space="preserve">첫 학생 글 &lt;A&amp;B&gt;.</t></is></c>'), '그 칸만 바꾸고 서식(s)은 그대로 · 글자는 XML 로')
ok(out.includes(is('J5', '이미 쓴 글', ' s="4"')) && out.includes('<c r="J4" s="4"></c>') && out.includes(is('D2', 'P002')) && out.includes('<c r="K2" s="4"/>'), '다른 칸 · 다른 줄은 손대지 않음')
const again = N.readNeisForm({ ...partsA, 'xl/worksheets/sheet7.xml': out })
ok(again.rows[0].content === '첫 학생 글 <A&B>.' && again.rows[1].content === '둘째\n글.' && again.rows[2].content === '', '채운 파일을 다시 읽으면 그 글')
const noCell = N.fillNeisSheetXml('<sheetData><row r="2"><c r="A2"/><c r="K2"/></row><row r="3"/></sheetData>', 9, { 2: '끼움', 3: '빈 줄' })
ok(noCell.includes('<c r="A2"/><c r="J2" t="inlineStr"><is><t xml:space="preserve">끼움</t></is></c><c r="K2"/>') && noCell.includes('<row r="3"><c r="J3" t="inlineStr">'), '칸이 없으면 열 순서에 맞게 끼움')

const headB = ['영역 구분', '학년도', '학년', '학과', '반', '번호', '동아리활동 부서명', '학생개인번호', '성명', '특기사항']
const sheetB = `<worksheet><sheetData><row r="1">${headB.map((h, i) => `<c r="${L[i]}1" t="s"><v>${i}</v></c>`).join('')}</row><row r="2"><c r="A2" t="s"><v>10</v></c><c r="E2"><v>3</v></c><c r="F2"><v>12</v></c><c r="I2" t="s"><v>11</v></c></row></sheetData></worksheet>`
const formB = N.readNeisForm({
  '/xl/workbook.xml': '<workbook><sheets><sheet name="s" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml': sheetB,
  'xl/sharedStrings.xml': `<sst>${[...headB, '동아리활동_특기사항', '가나다'].map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`
})
ok(formB.kind === '동아리' && formB.rows[0].cls === 3 && formB.rows[0].no === 12 && formB.rows[0].name === '가나다' && formB.contentCol === 9, '동아리 양식 — 공유 문자열 · 반 · 번호 따로')
let threw = ''
try { N.readNeisForm({ 'xl/workbook.xml': '<workbook><sheets><sheet name="s" r:id="rId1"/></sheets></workbook>', 'xl/worksheets/sheet1.xml': `<sheetData><row r="1">${is('A1', '이름')}${is('B1', '점수')}</row></sheetData>` }) } catch (e) { threw = e.message }
ok(threw.includes('특기사항 칸을 찾지 못했습니다'), '나이스 양식이 아니면 알림')
ok(N.colLetterOf(0) === 'A' && N.colLetterOf(27) === 'AB' && N.colIndexOf('AB12') === 27, '열 이름')

console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
process.exit(fails ? 1 : 0)
