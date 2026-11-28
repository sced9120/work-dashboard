// 성취기준 자료 · 찾기 · 코드 확인 (빌드 없이)
const path = require('path')
const { loadShared } = require('./tsload.cjs')
const cu = loadShared('curriculum')
const data = require(path.join(__dirname, '../electron/main/data/curriculum2022.json'))

let fail = 0
const ok = (c, msg) => {
  console.log(`${c ? '✓' : '✗'} ${msg}`)
  if (!c) fail = 1
}

const list = data.rows.map(cu.rowToStandard)
const by = (l) => list.filter((s) => s.level === l).length
ok(list.length === 4451, `초 · 중 · 고 성취기준 4,451개 (${list.length})`)
ok(by('초') === 611 && by('중') === 714 && by('고') === 3126, '학교급별 건수 611 · 714 · 3,126')
ok(new Set(list.map((s) => s.key)).size === list.length, 'key 가 겹치지 않는다')
ok(data.meta.license === 'CC BY 4.0' && data.meta.source === 'greatsong/k-curriculum-2022', '출처 · 라이선스가 자료에 있다')
ok(list.every((s) => s.code.startsWith('[') && s.content.length > 5), '모든 줄에 코드와 문장')

// 모든 코드를 글 속에서 찾아낸다
const missed = list.filter((s) => cu.findCodes(`가 ${s.code} 나`).length !== 1)
ok(missed.length === 0, `글 속 코드 찾기 — 모든 코드 (놓친 것 ${missed.length}${missed.length ? ': ' + missed.slice(0, 3).map((s) => s.code).join(' ') : ''})`)
const known = new Set(list.map((s) => cu.normCode(s.code)))
const c1 = cu.checkCodes('관련: [10공수1-01-01], [10공수1-01-01] 그리고 [10공수9-99-99] 와 [9수01-01]', known)
ok(c1.found.length === 3, '겹친 코드는 한 번')
ok(c1.unknown.join() === '[10공수9-99-99]', '자료에 없는 코드를 가려낸다')
ok(cu.checkCodes('[ 10공수1-01-01 ]', known).unknown.length === 0, '대괄호 안 띄어쓰기도 같은 코드')
ok(cu.findCodes('2026-03-03 회의 [참고 01-01] 메모 10-01-01').length <= 1, '날짜 · 일반 글은 거의 잡지 않는다')
ok(cu.checkCodes('[10통사03-01] 은 2015 개정', known).unknown.length === 1, '옛 교육과정 코드는 모르는 코드')

// 찾기
const r1 = cu.searchStandards(list, { level: '고', q: '나머지정리' })
ok(r1.total >= 1 && r1.items.every((s) => s.level === '고' && s.content.includes('나머지정리')), '낱말로 찾기')
const r2 = cu.searchStandards(list, { q: '10공수1-01' })
ok(r2.total >= 2 && r2.items.every((s) => s.code.includes('10공수1-01')), '코드 일부로 찾기')
const r3 = cu.searchStandards(list, { q: '듣기 말하기', level: '중' })
ok(r3.total > 0 && r3.items.every((s) => s.level === '중'), '띄어 쓴 낱말은 모두 들어간 것')
const subj = cu.subjectsOf(list)
const sx = subj.find((s) => s.level === '고' && s.subject.includes('공통수학1'))
ok(!!sx && cu.searchStandards(list, { subject: sx.subject }).total === sx.count, '과목 목록과 과목 찾기 건수가 같다')
ok(cu.searchStandards(list, { limit: 5 }).items.length === 5 && cu.searchStandards(list, { limit: 5 }).total === 4451, '보여 줄 수 제한 · 전체 건수')
ok(cu.searchStandards(list, { q: '듣기⋅말하기' }).total === cu.searchStandards(list, { q: '듣기·말하기' }).total, '가운뎃점 모양을 가리지 않는다')
ok(cu.standardLines(r1.items.slice(0, 1)).startsWith(r1.items[0].code + ' '), '칸에 넣는 글은 "[코드] 문장"')

process.exit(fail)
