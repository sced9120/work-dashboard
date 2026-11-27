// PDF 변환 — 만들 파일 정하기(합치기 · 이름 겹침) · 쪽 범위 · 사진 돌림 (빌드 없이)
const { loadShared } = require('./tsload.cjs')
const c = loadShared('convert')

let fails = 0
const ok = (cond, m) => { console.log(cond ? '  ✓' : '  ✗', m); if (!cond) fails++ }
const files = (...names) => names.map((name, i) => ({ id: `i${i}`, name, kind: c.convKindOf(name) }))
const names = (p) => p.map((o) => o.name)

console.log('1. 형식')
ok(c.convKindOf('a.HWPX') === 'hwp' && c.convKindOf('b.xlsm') === 'excel' && c.convKindOf('c.JPEG') === 'image', '대소문자 가리지 않음')
ok(c.convKindOf('d.zip') === null && c.convKindOf('e.webp') === null && c.convKindOf('이름') === null, '바꿀 수 없는 형식')

console.log('\n2. 파일마다 하나씩 — 이름 겹침')
let p = c.planOutputs(files('보고서.hwp', '보고서.jpg', '보고서.pdf', 'a.docx', 'A.pdf'), 'none')
ok(names(p).join('|') === '보고서 (hwp).pdf|보고서 (jpg).pdf|보고서.pdf|a (docx).pdf|A.pdf', names(p).join('|'))
p = c.planOutputs(files('1.pdf', '1.pdf', '1.pdf'), 'none')
ok(new Set(names(p).map((n) => n.toLowerCase())).size === 3, `같은 이름은 (2) (3): ${names(p).join(' ')}`)

console.log('\n3. 학생별로 합치기')
const list = files(
  '39924(홍길동)_IMG_2.png', '39924(홍길동)_IMG_10.png', '39924(홍길동)_글.pdf', '39921 김철수.hwp', '39921_2.jpg',
  '10130(이영희).pdf', '10130(박민수).pdf', '2026학년도 안내.pdf', '2026. 계획.hwpx', '1101.pdf', '메모.docx'
)
p = c.planOutputs(list, 'student')
const by = Object.fromEntries(p.map((o) => [o.name, o.ids.map((id) => list[Number(id.slice(1))].name)]))
ok(by['39924(홍길동).pdf'].join('|') === '39924(홍길동)_글.pdf|39924(홍길동)_IMG_2.png|39924(홍길동)_IMG_10.png', '문서 먼저 · 사진은 숫자 차례')
ok(by['39921(김철수).pdf'].length === 2, '학번만 있는 파일은 그 학번의 한 사람에게')
ok(by['10130(이영희).pdf'].length === 1 && by['10130(박민수).pdf'].length === 1, '학번이 같아도 이름이 다르면 섞지 않음')
ok(['2026학년도 안내.pdf', '2026. 계획.pdf', '1101.pdf', '메모.pdf'].every((n) => by[n] && by[n].length === 1), '해 · 4자리 숫자 · 학번 없는 파일은 따로')
ok(p.filter((o) => o.alone).length === 4, '학번을 못 찾은 파일은 표시')
ok(p.reduce((n, o) => n + o.ids.length, 0) === list.length, '빠지거나 두 번 들어가는 파일 없음')

console.log('\n4. 모두 하나로')
p = c.planOutputs(files('b.pdf', 'a.pdf'), 'all', '폴더 전체')
ok(p.length === 1 && p[0].name === '폴더 전체.pdf' && p[0].ids.join() === 'i0,i1', '목록 차례대로 하나')
ok(c.planOutputs([], 'all').length === 0, '빈 목록')

console.log('\n5. 쪽 범위')
const g = (t, n = 10) => JSON.stringify(c.parseRanges(t, n).groups)
ok(g('1-3, 5, 8-') === '[[1,2,3],[5],[8,9,10]]', '1-3, 5, 8-')
ok(g('2쪽 ~ 3쪽') === '[[2,3]]', '쪽 · 물결표')
ok(g('', 3) === '[[1],[2],[3]]', '비우면 한 쪽씩')
for (const bad of ['0', '3-2', '11', 'a', '1-3-4', ',']) ok(!c.parseRanges(bad, 10).ok, `거절: '${bad}'`)

console.log('\n6. 사진')
const exif = (o, le) => {
  const u16 = (v) => (le ? [v & 255, v >> 8] : [v >> 8, v & 255])
  const u32 = (v) => (le ? [...u16(v & 0xffff), 0, 0] : [0, 0, ...u16(v)])
  const tiff = [...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(o), 0, 0, ...u32(0)]
  const body = [...Buffer.from('Exif\0\0'), ...tiff]
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body, 0xff, 0xd9])
}
ok(c.exifOrientation(exif(6, true)) === 6 && c.exifOrientation(exif(8, false)) === 8, '돌림 표시 읽기 (두 가지 차례)')
ok(c.exifOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])) === 1 && c.exifOrientation(new Uint8Array(0)) === 1, '없으면 1')
// 그림의 네 귀퉁이가 늘 쪽 안의 같은 네모를 채우고, 원본의 왼쪽 위가 EXIF 가 말하는 자리로 간다
const corner = { 1: 'LT', 2: 'RT', 3: 'RB', 4: 'LB', 5: 'LT', 6: 'RT', 7: 'RB', 8: 'LB' }
for (let o = 1; o <= 8; o++) {
  const { page, matrix: [a, b, cc, d, e, f] } = c.imagePlacement(o, 400, 200)
  const at = (u, v) => [a * u + cc * v + e, b * u + d * v + f]
  const pts = [at(0, 0), at(1, 0), at(0, 1), at(1, 1)]
  const xs = pts.map((q) => q[0])
  const ys = pts.map((q) => q[1])
  const [x, y] = at(0, 1) // 원본의 왼쪽 위
  const where = `${Math.abs(x - Math.min(...xs)) < 0.01 ? 'L' : 'R'}${Math.abs(y - Math.max(...ys)) < 0.01 ? 'T' : 'B'}`
  const w = Math.max(...xs) - Math.min(...xs)
  const h = Math.max(...ys) - Math.min(...ys)
  const inside = Math.min(...xs) >= 17.9 && Math.max(...xs) <= page[0] - 17.9 && Math.min(...ys) >= 17.9 && Math.max(...ys) <= page[1] - 17.9
  ok(where === corner[o] && inside && (o >= 5 ? h > w && page[1] > page[0] : w > h && page[0] > page[1]), `돌림 ${o}: 왼쪽 위 → ${where}`)
}

console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
process.exit(fails ? 1 : 0)
