// shared/tsvpaste.ts — 엑셀에서 복사한 글을 칸마다 나누기(parseTsv · planPaste · pasteClipped) (빌드 없이). 이름은 지어낸 것
const { loadShared: load } = require('./tsload.cjs')
const P = load('tsvpaste.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('1. parseTsv')
ok(same(P.parseTsv('a\tb\nc\td'), [['a', 'b'], ['c', 'd']]), '탭 · 줄')
ok(same(P.parseTsv('a\tb\r\nc\td\r\n'), [['a', 'b'], ['c', 'd']]), 'CRLF + 끝의 빈 줄 하나 뗌')
ok(same(P.parseTsv('가나다\n'), [['가나다']]), '한 칸 + 끝 줄바꿈')
ok(same(P.parseTsv('a\n\nb'), [['a'], [''], ['b']]), '가운데 빈 줄은 남김')
ok(same(P.parseTsv('a\t\tb'), [['a', '', 'b']]), '빈 칸')
ok(same(P.parseTsv(' a \tb'), [[' a ', 'b']]), '칸 앞뒤 공백은 그대로')
ok(same(P.parseTsv('"첫 줄\n둘째 줄"\t다음'), [['첫 줄\n둘째 줄', '다음']]), '따옴표 안 줄바꿈은 한 칸')
ok(same(P.parseTsv('"그가 ""안녕"" 했다"\tx'), [['그가 "안녕" 했다', 'x']]), '"" 는 따옴표 하나')
ok(same(P.parseTsv('"a\r\nb"\r\nc'), [['a\nb'], ['c']]), '따옴표 안 CRLF')
ok(same(P.parseTsv('5" 자\tx'), [['5" 자', 'x']]), '칸 가운데 따옴표는 그대로')
ok(same(P.parseTsv(''), []), '빈 글')

console.log('2. planPaste')
const ids = ['s1', 's2', 's3']
const cols = ['note', 'ai', 'final']
const g = [['가나다 메모', '라마바 초안'], ['둘째 메모', '둘째 초안']]
const p1 = P.planPaste(g, 0, 0, ids, cols)
ok(p1.length === 4 && same(p1[0], { rowId: 's1', colKey: 'note', value: '가나다 메모' }) && same(p1[3], { rowId: 's2', colKey: 'ai', value: '둘째 초안' }), '왼쪽 위에서 2×2')
const p2 = P.planPaste([['a'], ['b'], ['c']], 1, 0, ids, cols)
ok(same(p2.map((x) => x.rowId), ['s2', 's3']), '아래로 — 마지막 학생에서 잘림')
const p3 = P.planPaste([['a', 'b', 'c']], 0, 1, ids, cols)
ok(same(p3.map((x) => x.colKey), ['ai', 'final']), '옆으로 — 마지막 열에서 잘림')
const p4 = P.planPaste([['x', 'y']], 2, 2, ids, cols)
ok(p4.length === 1 && p4[0].rowId === 's3' && p4[0].colKey === 'final' && p4[0].value === 'x', '모서리 — 한 칸만')
ok(P.planPaste(g, 3, 0, ids, cols).length === 0, '시작이 표 밖이면 없음')
const p5 = P.planPaste([['f1', 'f2', 'f3']], 0, 0, ids, ['f:주제', 'f:과정', 'ai', 'final'])
ok(same(p5.map((x) => x.colKey), ['f:주제', 'f:과정', 'ai']), '입력 항목 열이 먼저 오는 순서')
const p6 = P.planPaste([['a'], ['b']], 0, 0, ids, ['final'])
ok(same(p6.map((x) => [x.rowId, x.colKey]), [['s1', 'final'], ['s2', 'final']]), '최종본만 보일 때 — 아래로만')

console.log('3. pasteClipped')
const c1 = P.pasteClipped([['a'], ['b'], ['c'], ['d']], 1, 0, 3, 3)
ok(c1.rows === 2 && c1.cells === 0, '표 4줄 · 학생 2명 남음 → 2줄 버림')
const c2 = P.pasteClipped([['a', 'b', 'c', 'd']], 0, 1, 3, 3)
ok(c2.rows === 0 && c2.cells === 2, '열이 모자라 2칸 버림')
ok(P.pasteClipped(g, 0, 0, 3, 3).rows === 0, '다 들어가면 0')

console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
process.exit(fails ? 1 : 0)
