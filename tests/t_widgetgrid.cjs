// shared/widgetGrid.ts — 새 화면 '오늘' 판의 위젯 칸
const { loadShared: load } = require('./tsload.cjs')
const G = load('widgetGrid.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const at = (list, id) => list.find((x) => x.id === id)
const clean = (list) => list.every((a, i) => list.every((b, j) => i === j || !G.overlaps(a, b)))

const board = [
  { id: 'a', x: 0, y: 0, w: 4, h: 2 },
  { id: 'b', x: 4, y: 0, w: 4, h: 2 },
  { id: 'c', x: 0, y: 2, w: 4, h: 3 },
  { id: 'd', x: 0, y: 5, w: 8, h: 2 }
]
const lim = { minW: 2, minH: 1, maxW: 8, maxH: 8 }

console.log('\n1. 놓기 · 밀어내기')
const p1 = G.place(board, 'b', { x: 0, y: 2, w: 4, h: 2 })
ok(at(p1, 'b').x === 0 && at(p1, 'b').y === 2, '놓은 위젯은 그 자리')
ok(at(p1, 'c').y === 4 && at(p1, 'd').y === 7, '겹친 위젯은 아래로, 밀린 위젯이 또 겹치면 그것도 민다')
ok(clean(p1), '놓은 뒤 겹침 없음')
ok(at(board, 'c').y === 2, '처음 판은 그대로 (끄는 동안 매번 처음 자리에서 계산)')
const p2 = G.place(board, 'a', { x: 4, y: 0, w: 4, h: 2 })
ok(at(p2, 'b').y === 2 && clean(p2), '옆자리로 옮기면 그 자리 위젯이 아래로')

console.log('\n2. 빈칸 · 빈자리')
const gap = [{ id: 'a', x: 0, y: 3, w: 4, h: 2 }, { id: 'b', x: 4, y: 6, w: 4, h: 1 }, { id: 'c', x: 0, y: 7, w: 4, h: 1 }]
const cp = G.compact(gap)
ok(at(cp, 'a').y === 0 && at(cp, 'b').y === 0 && at(cp, 'c').y === 2, '빈칸 메우기는 막히는 데까지 위로, 가로 자리는 그대로')
ok(JSON.stringify(G.firstFree(board, 4, 2)) === '{"x":4,"y":2}', '첫 빈자리는 위에서부터 왼쪽부터')
ok(JSON.stringify(G.firstFree(board, 8, 1)) === '{"x":0,"y":7}', '넓은 위젯은 다 들어가는 줄에')
const tangled = G.untangle([{ id: 'a', x: 0, y: 0, w: 4, h: 3 }, { id: 'b', x: 2, y: 1, w: 4, h: 2 }])
ok(at(tangled, 'b').y === 3 && clean(tangled), '깨진 판은 겹친 위젯을 아래로 풀어 준다')

console.log('\n3. 크기 바꾸기 · 한도')
ok(JSON.stringify(G.clampCell({ x: 7, y: -2, w: 4, h: 0 }, lim)) === '{"w":4,"h":1,"x":4,"y":0}', '판 밖 · 한도 밖이면 안으로')
const c = { x: 2, y: 2, w: 4, h: 3 }
ok(JSON.stringify(G.resizeCell(c, 'e', 5, 0, lim)) === '{"x":2,"y":2,"w":6,"h":3}', '오른쪽은 판 끝까지만')
ok(JSON.stringify(G.resizeCell(c, 'w', -5, 0, lim)) === '{"x":0,"y":2,"w":6,"h":3}', '왼쪽은 판 왼쪽 끝까지만')
ok(JSON.stringify(G.resizeCell(c, 'n', 0, 5, lim)) === '{"x":2,"y":4,"w":4,"h":1}', '위를 끌어내리면 가장 작은 높이까지, 아래 끝은 그대로')
ok(JSON.stringify(G.resizeCell(c, 'se', -9, 9, lim)) === '{"x":2,"y":2,"w":2,"h":8}', '모서리는 너비 · 높이 함께, 한도 안')
ok(JSON.stringify(G.toCell(270, 190, 120, 80, 12)) === '{"x":2,"y":2}', '화면 좌표 → 가까운 칸')

console.log('\n4. 좁은 창 차례')
ok(G.stackOrder(board).map((x) => x.id).join() === 'a,b,c,d', '위에서 아래, 같은 줄이면 왼쪽부터')

console.log(fails ? `\n${fails}개 실패` : '\n모두 통과')
process.exit(fails ? 1 : 0)
