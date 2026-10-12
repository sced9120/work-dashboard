// shared/mdtable.ts — 답에서 표 뽑기 · 이어 붙이기
const { loadShared: load } = require('./tsload.cjs')
const M = load('mdtable.ts')
const G = load('gemini.ts')
const X = load('mathtext.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

const md = [
  '> 업로드된 문서를 분석한 결과, **반복 양식(유형 A)** 로 판단되어 ...',
  '',
  '## 영어 수행평가',
  '',
  '| 페이지 | 학번 | 이름 | 제목 | 상세 내용 |',
  '| --- | :---: | --- | --- | --- |',
  '| 1 | 00123 | 학생A | AI \\| Use | I think `a|b` is **good** |',
  '| 2 | 30107 | [불확실: 학생B/학생C] | (미작성) | (본문 없음) |',
  '',
  '```',
  '| 코드 | 안 |',
  '| --- | --- |',
  '| 표 | 아님 |',
  '```',
  '',
  '| 가 | 나 |',
  '|---|---|',
  '| 1 | 2 |'
].join('\n')
const t = M.extractTables(md)
ok(t.length === 2, `표 2개 (코드 울타리 안의 표는 빼고): ${t.length}`)
ok(t[0].title === '영어 수행평가' && t[0].header.join(',') === '페이지,학번,이름,제목,상세 내용', '제목 · 머리글')
ok(t[0].rows[0][1] === '00123' && t[0].rows[0][3] === 'AI | Use' && t[0].rows[0][4] === 'I think `a|b` is **good**', `\\| 는 글자, \`a|b\` 는 한 칸: ${JSON.stringify(t[0].rows[0])}`)
ok(M.plainCell('**굵게** 와 *기울임* 과 `코드`') === '굵게 와 기울임 과 코드', '굵게 · 기울임 · 코드 표시 떼기')
ok(M.toTsv(t[1]) === '가\t나\n1\t2', '탭으로 복사')
ok(M.proseOf(md).startsWith('> 업로드된 문서를 분석한 결과'), '안내 문장')

// 끊긴 답 → 덜 나온 마지막 행은 빼고, 이어 받은 표를 붙인다
const cut = '| 번호 | 이름 | 본문 |\n|---|---|---|\n| 1 | 가 | 첫째 |\n| 2 | 나 | 둘째 |\n| 3 | 다 | 셋째 문장이 길어 중간에서 끊'
const kept = M.dropPartialTail(cut)
ok(!kept.includes('| 3 |') && kept.trim().endsWith('| 2 | 나 | 둘째 |'), '덜 나온 마지막 행을 뺌')
ok(M.dropPartialTail('| a | b |\n|---|---|\n| 1 | 2 |') === '| a | b |\n|---|---|\n| 1 | 2 |', '다 나온 답은 그대로')
const merged = M.mergeTables(M.extractTables(kept), M.extractTables('| 번호 | 이름 | 본문 |\n|---|---|---|\n| 2 | 나 | 둘째 |\n| 3 | 다 | 셋째 문장 |\n| 4 | 라 | 넷째 |'))
ok(merged.length === 1 && merged[0].rows.map((r) => r[0]).join() === '1,2,3,4', `머리글이 같으면 이어 붙이고 겹친 행은 한 번만: ${merged[0].rows.map((r) => r[0]).join()}`)
ok(M.mergeTables(t.slice(0, 1), t.slice(1)).length === 2, '머리글이 다르면 새 표')

// 지침과 달리 표를 ```markdown 으로 감싸 보낸 답 (끊긴 것도)
const fenced = '> 정리했습니다.\n\n```markdown\n| 번호 | 이름 |\n|---|---|\n| 1 | 가 |\n| 2 | 나 |\n```'
ok(M.extractTables(fenced).length === 1 && M.extractTables(fenced)[0].rows.length === 2, '```markdown 울타리 안의 표도 찾음')
ok(M.proseOf(fenced) === '> 정리했습니다.', '안내 문장에 울타리 줄이 섞이지 않음')
const fencedCut = '```\n| 번호 | 이름 |\n|---|---|\n| 1 | 가 |\n| 2 | 나'
ok(M.answersToTables([{ text: fencedCut, truncated: true }])[0].rows.length === 1, '울타리 안에서 끊긴 답도 덜 나온 행만 빼고')
ok(!M.extractTables('설명\n```python\nx = "| a | b |"\n```\n').length && M.extractTables('| a |\n|---|\n| 1 |\n```\n| b |\n|---|\n| 2 |\n```').length === 1, '코드 울타리 · 밖에 표가 있으면 예전 그대로')

// 수식(LaTeX): 표 읽기에서 \\ 를 지키고, 칸 글은 읽기 쉬운 글자로
const tex = M.extractTables([
  '| 번호 | 문제 | 풀이 |',
  '|---|---|---|',
  '| 1 | $A+2E=\\begin{pmatrix} 4 & 1 \\\\ 2 & 3 \\end{pmatrix}$ 일 때 | $X=\\begin{pmatrix} \\frac{5}{3} & -\\frac{2}{3} \\\\ \\frac{5}{3} & \\frac{2}{3} \\end{pmatrix}$ |',
  '| 2 | $\\|A\\|$ 와 $5 짜리 | 경로 a\\\\b |',
  '| 3 | \\begin{bmatrix} a_{11} & a_{12} \\\\ a_{21} & a_{22} \\end{bmatrix} | $$x^2 \\le 4$$ |'
].join('\n'))[0]
ok(tex.rows[0][1].includes('4 & 1 \\\\ 2 & 3'), '수식 안의 \\\\ (행렬 줄 나눔)는 그대로')
ok(tex.rows[1][2] === '경로 a\\b', '수식 밖의 \\\\ 는 예전처럼 \\ 하나')
ok(tex.rows[2][1].includes('a_{12} \\\\ a_{21}'), '$ 없는 \\begin…\\end 안의 \\\\ 도 그대로')
ok(M.plainCell(tex.rows[0][1]) === 'A+2E=(4 1; 2 3) 일 때', `행렬 → (4 1; 2 3): ${M.plainCell(tex.rows[0][1])}`)
ok(M.plainCell(tex.rows[0][2]) === 'X=(5/3 -2/3; 5/3 2/3)', `분수: ${M.plainCell(tex.rows[0][2])}`)
ok(M.plainCell(tex.rows[1][1]) === '|A| 와 $5 짜리', `\\| 는 글자 | · 돈 $ 는 그대로: ${M.plainCell(tex.rows[1][1])}`)
ok(M.plainCell(tex.rows[2][1]) === '[a₁₁ a₁₂; a₂₁ a₂₂]', `$ 없는 행렬 · 아래 첨자: ${M.plainCell(tex.rows[2][1])}`)
ok(M.plainCell(tex.rows[2][2]) === 'x² ≤ 4', `$$…$$ · 위 첨자 · ≤: ${M.plainCell(tex.rows[2][2])}`)
ok(M.plainCell('첫 문단<br>둘째 문단 <br/> 셋째') === '첫 문단 / 둘째 문단 / 셋째', '<br> 은 지침대로 \' / \'')
ok(M.toTsv(tex).split('\n')[1].split('\t')[1] === 'A+2E=(4 1; 2 3) 일 때', '복사(탭)도 같은 글자로')
const cases = [
  ['$\\sqrt{2}$', '√2'],
  ['$\\sqrt[3]{x+1}$', '³√(x+1)'],
  ['$x^{10}$', 'x¹⁰'],
  ['$e^{-x}$', 'e^(-x)'],
  ['$\\begin{pmatrix} e^{-x} & 0 \\\\ 0 & 1 \\end{pmatrix}$', '(e^(-x) 0; 0 1)'],
  ['$\\begin{pmatrix} \\begin{vmatrix} 1 & 2 \\\\ 3 & 4 \\end{vmatrix} & 0 \\end{pmatrix}$', '(|1 2; 3 4| 0)'],
  ['$\\begin{pmatrix} \\begin{pmatrix} e^{-x} \\end{pmatrix} & 0 \\end{pmatrix}^2$', '((e^(-x)) 0)²'],
  ['$5와$7', '$5와$7'],
  ['$\\frac{a+b}{2}$', '(a+b)/2'],
  ['$\\binom{4}{2}=6$', 'C(4, 2)=6'],
  ['$2 \\times 3 \\cdot 4 \\ne 5$', '2 × 3 · 4 ≠ 5'],
  ['$\\angle A = 90^\\circ$', '∠A = 90°'],
  ['$\\text{넓이} = \\pi r^2$', '넓이 = πr²'],
  ['${}_4C_2$', '₄C₂'],
  ['$\\left( \\frac{1}{2} \\right)^2$', '(1/2)²'],
  ['$\\sin x$', 'sin x'],
  ['$f(x)=\\begin{cases} x & (x \\ge 0) \\\\ -x & (x<0) \\end{cases}$', 'f(x)={ x (x ≥ 0); -x (x<0)'],
  ['가격은 \\$5 와 \\$7', '가격은 $5 와 $7'],
  ['$\\constructor$', 'constructor'],
  ['C:\\temp\\toast', 'C:\\temp\\toast'],
  ['2 \\times 3', '2 × 3']
]
const bad = cases.filter(([a, b]) => X.mathText(a) !== b)
ok(!bad.length, `여러 수식: ${bad.map(([a, b]) => `${a} → ${X.mathText(a)} (기대 ${b})`).join(' / ') || '모두 맞음'}`)

// Gemini 모델 구분 (temperature 를 빼는 모델)
ok(['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-4.0-pro'].every(G.isModernGemini) && !['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.1-pro'].some(G.isModernGemini), '3.6 이후 · 3.5 Flash-Lite 만 temperature 빼기')
ok(G.isGeminiModel('gemini-3.8-flash') && !G.isGeminiModel('gpt-5') && !G.isGeminiModel('gemini-3.8-flash/../x'), '모델 이름 검사')

console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
process.exit(fails ? 1 : 0)
