// shared/xlsxkind.ts — 엑셀 열 성격 판별 · 칸 서식
const { loadShared: load } = require('./tsload.cjs')
const K = load('xlsxkind.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const kind = K.columnKind

// 머리글 낱말
ok(kind('번호', ['가', '나']) === 'sequence', '번호 → sequence')
ok(kind('학번', ['0123', '0456']) === 'sequence', '학번 → sequence')
ok(kind('출석번호', []) === 'sequence', '출석번호 → sequence')
ok(kind('날짜', ['가']) === 'date', '날짜 → date')
ok(kind('제출일', []) === 'date', '제출일 → date')
ok(kind('금액(원)', ['가']) === 'number', '금액(원) → number')
ok(kind('점수', ['A']) === 'number', '점수 → number')
ok(kind('비율 (%)', []) === 'number', '비율 → number')
ok(kind('비고', ['가나다', '라마바']) === 'text', '비고 → text')
ok(kind('반복 횟수 안내', ['x']) === 'number', '횟수 포함 → number')
ok(kind('반응', ['x']) === 'text', "'반응' 은 한 글자 '반' 에 걸리지 않음")
ok(kind('반', ['1', '2']) === 'sequence', "'반' 만 있으면 sequence")

// 영어는 낱말 단위
ok(kind('note', ['a', 'b']) === 'text', "English 'note' 는 sequence 아님")
ok(kind('Video', ['a']) === 'text', "'Video' 는 id 로 오판 안 함")
ok(kind('No.', []) === 'sequence', "'No.' → sequence")
ok(kind('Student ID', []) === 'sequence', "'Student ID' → sequence")
ok(kind('Total Amount', []) === 'number', 'Total Amount → number')
ok(kind('Date', []) === 'date', 'Date → date')

// 값 표본 70%
ok(kind('내용', ['10', '20', '30', '가', '나', '다', '15', '10', '20', '30']) === 'number', '숫자 7/10 → number')
ok(kind('내용', ['10', '20', '가', '나', '다', '라', '마', '10', '20', '바']) === 'text', '숫자 40% → text')
ok(kind('내용', ['1,200', '3,400', '15%', '7.5', '가나다']) === 'number', '쉼표 · % · 소수 → number (4/5)')
ok(kind('내용', ['2026-03-05', '2026-03-06', '2026-03-07', '가', '나', '다', '라', '2026-03-08', '마', '바']) === 'text', '날짜 40% → text')
ok(kind('내용', ['2026-03-05', '2026-03-06', '2026-03-07']) === 'date', '날짜 100% → date')
ok(kind('내용', ['1', '2', '3', '4', '5']) === 'sequence', '1,2,3… 차례로 커지는 정수 → sequence')
ok(kind('내용', ['85', '92', '70', '88', '95']) === 'number', '들쭉날쭉한 정수 → number')
ok(kind('내용', []) === 'text', '값 없음 → text')

// 숫자로 보면 안 되는 것
ok(!K.isNumberValue('0123'), '0123(학번)은 숫자 아님')
ok(!K.isNumberValue('010-1234-5678'), '전화번호는 숫자 아님')
ok(!K.isNumberValue('1e3'), '1e3 은 숫자 아님')
ok(!K.isNumberValue('=SUM(A1:A3)'), '=SUM 은 숫자 아님')
ok(kind('내용', ['0123', '0456', '0789']) === 'text', '앞 0 학번만 있는 열은 text')

// 한국어 날짜
for (const d of ['2026. 3. 5.', '3월 5일', '26.3.5', '2026-03-05', '2026/3/5', '20260305', '2026년 3월 5일', '3월 5일(목)', '5-3-2026']) ok(K.isDateValue(d), `날짜 값: ${d}`)
for (const d of ['3.14', '12', '가나다', '1.2.3.4', '2026']) ok(!K.isDateValue(d), `날짜 아님: ${d}`)
ok(kind('내용', ['2026. 3. 5.', '3월 5일', '26.3.5']) === 'date', '한국어 날짜 3종 → date')

// 너비
ok(K.clampWidth('sequence', 3) === 8 && K.clampWidth('sequence', 40) === 15, 'sequence 8~15')
ok(K.clampWidth('number', 3) === 12 && K.clampWidth('number', 40) === 25, 'number 12~25')
ok(K.clampWidth('date', 3) === 15 && K.clampWidth('date', 40) === 20, 'date 15~20')
ok(K.clampWidth('text', 40) === 40 && K.clampWidth('text', 3) === 3, 'text 는 그대로')

// 칸 서식
const m = K.cellMark
ok(m('**굵게**').bold && m('**굵게**').text === '굵게', '**굵게**')
ok(m('*기울임*').italic && m('*기울임*').text === '기울임', '*기울임*')
ok(m('`x=1`').code && m('`x=1`').text === 'x=1', '`코드`')
ok(m('***둘***').bold && m('***둘***').italic, '***둘***')
const part = m('**가** 그리고 **나**')
ok(!part.bold && part.text === '**가** 그리고 **나**', '일부만 굵게면 서식 없음')
ok(!m('2*3*4').italic, '2*3*4 는 기울임 아님')

console.log(fails ? `\n실패 ${fails}건` : '\n모두 통과')
process.exit(fails ? 1 : 0)
