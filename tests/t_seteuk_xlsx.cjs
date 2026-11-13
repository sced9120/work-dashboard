// shared/seteukXlsx.ts — 엑셀 표 ↔ 작성실 자료 (빌드 없이). 이름은 지어낸 것
const { loadShared: load } = require('./tsload.cjs')
const S = load('seteuk.ts')
const X = load('seteukXlsx.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

console.log('1. 세특 시트를 내려받은 파일 읽기')
const sheetFile = [
  { name: '🚀 시작하기', rows: [['안내']] },
  { name: '👤 학생명단', rows: [['명단'], ['학년', '반', '번호', '이름', '성취수준'], ['1', '3', '1', '가나다', 'A'], ['1', '3', '2', '라마바', ''], ['', '', '', '', '']] },
  {
    name: '🗂 활동목록',
    rows: [
      ['활동 목록'],
      ['활동키', '활동명', '기록종류', '교과영역', '바이트 한도', '입력 항목', '활동 개요', '프롬프트 모드', '직접 작성 프롬프트', '입력 시트', '예시 시트', '분량 맞추기'],
      ['A1', '함수 탐구', '과세특', '수학', '600', '관찰 메모', '그래프로 변화율 설명', '바로쓰기', '', '함수 탐구 ▸입력', '', '넉넉히'],
      ['A2', '독서 활동', '자율', '공통', '', '책|느낀 점', '', '자동', '', '독서 활동 ▸입력', '', '']
    ]
  },
  {
    name: '함수 탐구 ▸입력',
    rows: [
      ['바로 쓰기 — 안내'],
      [],
      ['학년-반', '번호', '이름', '성취수준', '관찰 메모', '생성', '모델', 'AI 결과', '최종본', '바이트', '검증'],
      ['1-3', '1', '가나다', 'A', '기울기를 비교함', 'FALSE', '', '초안 글.', '다듬은 글.', '15', '통과'],
      ['1-3', '2', '라마바', '', '풀이를 고침', 'TRUE', '', '⚠ 실패: 키 없음', '', '', ''],
      ['1-3', '3', '사아자', '', '', 'FALSE', '', '', '', '', '']
    ]
  },
  {
    name: '독서 활동 ▸입력',
    rows: [[], [], ['반', '번호', '이름', '성취수준', '책', '느낀 점', '생성', '모델', 'AI 결과', '최종본', '바이트', '검증'], ['3', '1', '가나다', '', '수학 책', '재미있었음', '', '', '', '', '', '']]
  },
  { name: '함수 탐구 ▸예시', rows: [[], [], ['예시번호', '관찰 메모', '결과']] },
  { name: '📦 취합 ▸과세특', rows: [[], [], ['반', '번호', '이름', '성취수준', '함수 탐구', '합본', '합본 바이트', '압축', '모델', 'AI 압축결과', '최종본', '바이트', '검증'], ['3', '1', '가나다', '', '다듬은 글.', '다듬은 글.', '15', '', '', '', '다듬은 글.', '', ''], ['3', '2', '라마바', '', '', '긴 합본', '', '', '', '줄인 글.', '선생님이 고친 글.', '', '']] }
]
const book = X.readBook(sheetFile)
ok(book.rosters.homeroom.map((s) => s.name).join() === '가나다' && book.rosters.club.length === 0 && book.rosters.subject.map((s) => s.id + s.name).join() === '3-1가나다,3-2라마바,3-3사아자', `명단 — 학년-반은 반만 · 활동 시트에만 있는 학생도: ${book.rosters.subject.map((s) => s.id).join()}`)
ok(book.acts.map((a) => a.name).join() === '함수 탐구,독서 활동', '▸입력 시트만 활동으로 (예시 시트는 아님)')
const a1 = book.acts[0]
ok(a1.rec === '과세특' && a1.subject === '수학' && a1.bytes === 600 && a1.amount === '넉넉히' && a1.desc === '그래프로 변화율 설명', '활동목록에서 영역 · 과목 · 분량 · 개요')
ok(a1.rows['3-1'].note === '기울기를 비교함' && a1.rows['3-1'].ai === '초안 글.' && a1.rows['3-1'].final === '다듬은 글.', '관찰 메모 · AI 결과 · 최종본 (성취수준 · 생성 · 검증 칸은 관찰 기록이 아님)')
ok(a1.rows['3-2'].ai === '' && a1.rows['3-2'].note === '풀이를 고침' && !('3-3' in a1.rows), '실패 표시(⚠)는 글이 아님 · 빈 줄은 뺌')
ok(book.acts[1].rec === '자율' && book.acts[1].subject === '' && book.acts[1].rows['3-1'].note === '책: 수학 책\n느낀 점: 재미있었음', "입력 칸이 여럿이면 '머리글: 글' · 교과영역 '공통' 은 과목 아님")
ok(!('3-1' in book.sums.과세특) && book.sums.과세특['3-2'].ai === '줄인 글.' && book.sums.과세특['3-2'].final === '선생님이 고친 글.', '취합 — 합본 그대로인 최종본은 넣지 않고, 다듬은 글 · 압축본만')
ok(X.readBook([{ name: '아무 표', rows: [['이름', '점수'], ['가', '1']] }]).acts.length === 0, '세특 자료가 아닌 파일')

console.log('\n2. 지금 자료와 합치기')
let n = 0
const newId = () => 'n' + ++n
const cur = {
  rosters: { subject: [{ id: '3-1', cls: '3', no: '1', name: '가나다' }, { id: '3-2', cls: '3', no: '2', name: '다른이름' }], club: [], homeroom: [] },
  acts: [S.newActivity('a1', { name: '함수 탐구', rec: '과세특', bytes: 450 })],
  rows: { a1: { '3-1': { note: '내가 적은 메모', ai: '', final: '' } } },
  sums: {}
}
let m = X.mergeBook(cur, book, {}, newId)
ok(m.report.newStudents === 2 && m.data.rosters.subject.length === 3 && m.data.rosters.homeroom.length === 1 && m.report.mismatched.length === 1 && m.report.mismatched[0].includes('다른이름'), '없던 학생은 더하고 · 이름이 다른 학생은 알림')
ok(m.report.mergedActs.join() === '함수 탐구' && m.report.newActs.join() === '독서 활동' && m.data.acts.length === 2 && m.data.acts[1].id === 'n1' && m.data.acts[0].bytes === 450, '이름이 같은 활동은 합치고(설정은 그대로) · 없는 활동은 새로')
ok(m.data.rows.a1['3-1'].note === '내가 적은 메모' && m.data.rows.a1['3-1'].ai === '초안 글.' && m.data.rows.a1['3-1'].final === '다듬은 글.' && m.report.kept === 1, '빈 칸만 채우고 이미 적은 글은 그대로')
ok(!('3-2' in m.data.rows.a1) && !m.data.sums.과세특?.['3-2'], '이름이 다른 학생의 글 · 취합은 넣지 않음')
ok(m.report.cells === 3 && cur.rows.a1['3-1'].ai === '' && cur.acts.length === 1, `채운 칸 수 ${m.report.cells} · 원래 자료는 건드리지 않음`)
m = X.mergeBook(cur, book, { overwrite: true }, newId)
ok(m.data.rows.a1['3-1'].note === '기울기를 비교함' && m.report.kept === 0 && m.report.cells === 4, '덮어쓰기를 고르면 파일의 글로')
const emptyBook = { rosters: { subject: [], club: [], homeroom: [] }, acts: [{ name: '함수 탐구', rec: '과세특', subject: '', desc: '', bytes: 0, amount: '보통', rows: { '3-1': { note: ' ', ai: '', final: '' } } }], sums: {} }
ok(X.mergeBook(cur, emptyBook, { overwrite: true }, newId).data.rows.a1['3-1'].note === '내가 적은 메모', '파일의 빈 칸은 아무것도 지우지 않음')

console.log('\n3. 내보내기 → 다시 읽기')
const data = {
  rosters: { subject: [{ id: '1-1', cls: '1', no: '1', name: '가나다' }, { id: '1-2', cls: '1', no: '2', name: '라마바' }], club: [], homeroom: [{ id: '1-1', cls: '1', no: '1', name: '가나다' }, { id: '1-2', cls: '1', no: '2', name: '라마바' }] },
  acts: [S.newActivity('a1', { name: '함수/탐구: [1학기] 아주 긴 이름의 활동입니다 정말로', rec: '과세특', subject: '공통수학2', desc: '개요', bytes: 600, amount: '메모만큼' }), S.newActivity('a2', { name: '학급 자치', rec: '행발' })],
  rows: { a1: { '1-1': { note: '메모\n둘째 줄', ai: '초안.', final: '최종.' } }, a2: { '1-2': { note: '', ai: '', final: '회의를 진행함.' } } },
  sums: { 과세특: { '1-1': { ai: '줄인 글.', final: '다듬은 취합 글.' } } }
}
const grids = X.buildBook(data)
ok(grids[0].name === '👤 학생명단 ▸교과' && grids[1].name === '👤 학생명단 ▸담임' && grids[2].name === '🗂 활동목록' && grids.every((g) => g.name.length <= 31 && !/[\\/?*[\]:]/.test(g.name)), `시트 이름 — 31자 안 · 못 쓰는 글자 없음: ${grids.map((g) => g.name).join(' | ')}`)
ok(grids[3].name.endsWith(' ▸입력') && grids[3].rows[2].join('|') === '반|번호|이름|관찰 메모|AI 결과|최종본|바이트' && grids[3].rows[3].join('|') === '1|1|가나다|메모\n둘째 줄|초안.|최종.|7', '활동 시트 — 3행이 머리글, 4행부터 학생')
const sumG = grids.find((g) => g.name === '📦 취합 ▸행발')
ok(sumG && sumG.rows[4][3] === '회의를 진행함.' && sumG.rows[4].includes('회의를 진행함.') && grids.some((g) => g.name === '📦 취합 ▸과세특'), '취합 시트 — 영역마다')
const back = X.readBook(grids)
ok(back.rosters.subject.length === 2 && back.rosters.homeroom.length === 2 && back.rosters.club.length === 0 && back.acts.length === 2 && back.acts[0].name === data.acts[0].name && back.acts[0].rows['1-1'].final === '최종.', '다시 읽으면 학생 · 활동 · 글 — 시트 이름에서 잘린 긴 활동 이름도 그대로')
ok(back.acts[0].rec === '과세특' && back.acts[0].subject === '공통수학2' && back.acts[0].bytes === 600 && back.acts[0].amount === '메모만큼' && back.acts[1].rec === '행발', '활동 설정도')
ok(back.acts[0].rows['1-1'].note === '메모\n둘째 줄' && back.sums.과세특['1-1'].final === '다듬은 취합 글.' && !back.sums.행발?.['1-2'], '관찰 기록의 줄바꿈 · 다듬은 취합 글 (합본 그대로는 넣지 않음)')
const fresh = X.mergeBook({ rosters: { subject: [], club: [], homeroom: [] }, acts: [], rows: {}, sums: {} }, back, {}, newId)
ok(fresh.data.rosters.subject.length === 2 && fresh.data.rosters.homeroom.length === 2 && fresh.data.acts.length === 2 && fresh.report.mismatched.length === 0 && Object.values(fresh.data.rows).some((r) => r['1-2']?.final === '회의를 진행함.'), '빈 작성실에 가져오면 그대로 옮겨짐')
const twice = X.mergeBook(fresh.data, back, {}, newId)
ok(twice.report.cells === 0 && twice.report.kept === 0 && twice.report.newActs.length === 0 && twice.report.newStudents === 0, '같은 파일을 한 번 더 가져와도 바뀌는 것이 없음')


console.log('\n4. 수업반 · 학번 (반별 목록)')
// 같은 학생(3반 1번)이 3반 · 미적분A반 두 수업반에 — 명단 차례에서 '@미적분A반' 학생이 먼저 오는 경우까지
const gd = {
  rosters: {
    subject: [
      { id: '3-1@미적분A반', cls: '3', no: '1', name: '가나다', group: '미적분A반', hakbun: '20301' },
      { id: '4-2', cls: '4', no: '2', name: '라마바', group: '미적분A반', hakbun: '20402' },
      { id: '3-1', cls: '3', no: '1', name: '가나다', group: '3반', hakbun: '20301' },
      { id: '3-5', cls: '3', no: '5', name: '사아자' }
    ],
    club: [],
    homeroom: []
  },
  acts: [S.newActivity('a1', { name: '미적분 탐구', rec: '과세특' })],
  rows: { a1: { '3-1@미적분A반': { note: '미적분 반 메모', ai: '', final: '' }, '3-1': { note: '3반 메모', ai: '', final: '' } } },
  sums: {}
}
const gg = X.buildBook(gd)
ok(gg[0].rows[1].join('|') === '반|번호|이름|수업반|학번' && gg[0].rows[2].join('|') === '3|1|가나다|미적분A반|20301' && gg[0].rows[5].join('|') === '3|5|사아자||', '명단 시트에 수업반 · 학번 칸 (정하지 않은 반 · 없는 학번은 빈칸)')
const gb = X.readBook(gg)
const gs = gb.rosters.subject
ok(gs.length === 4 && gs[0].group === '미적분A반' && gs[0].hakbun === '20301' && gs[2].group === '3반' && gs[2].id === '3-1@3반' && !gs[3].group && !gs[3].hakbun, '다시 읽기 — 수업반 · 학번을 살리고, 같은 학생이 두 반이면 @수업반 으로 가름')
ok(gb.acts[0].rows[gs[0].id].note === '미적분 반 메모' && gb.acts[0].rows[gs[2].id].note === '3반 메모', '활동 시트의 같은 반 · 번호 두 줄은 명단 차례대로 제 학생에게')
const gEmpty = X.mergeBook({ rosters: { subject: [], club: [], homeroom: [] }, acts: [], rows: {}, sums: {} }, gb, {}, newId)
ok(gEmpty.data.rosters.subject.length === 4 && gEmpty.data.rosters.subject.filter((s) => s.group === '미적분A반').length === 2 && gEmpty.report.newStudents === 4, '빈 작성실로 옮기면 반별 목록 그대로')
const gBack = X.mergeBook(gd, gb, {}, newId)
ok(gBack.report.newStudents === 0 && gBack.data.rosters.subject.length === 4 && gBack.report.cells === 0 && gBack.report.kept === 0, '내보낸 작성실에 다시 가져오면 바뀌는 것이 없음 (id 가 달라도 반 · 번호 · 수업반으로 맞춤)')
const gOver = X.mergeBook(gd, { ...gb, acts: [{ ...gb.acts[0], rows: { [gs[0].id]: { note: '미적분 반 새 메모', ai: '', final: '' }, [gs[2].id]: { note: '3반 새 메모', ai: '', final: '' } } }] }, { overwrite: true }, newId)
ok(gOver.data.rows.a1['3-1@미적분A반'].note === '미적분 반 새 메모' && gOver.data.rows.a1['3-1'].note === '3반 새 메모' && !gOver.data.rows.a1['3-1@3반'], '덮어써도 글이 제 수업반 학생에게 감')
const noHak = { ...cur, rosters: { ...cur.rosters, subject: [{ id: '3-1', cls: '3', no: '1', name: '가나다' }] } }
const filled = X.mergeBook(noHak, X.readBook([{ name: '👤 학생명단 ▸교과', rows: [['반', '번호', '이름', '수업반', '학번'], ['3', '1', '가나다', '3반', '20301']] }]), {}, newId)
ok(filled.data.rosters.subject[0].hakbun === '20301' && filled.data.rosters.subject[0].group === '3반' && !noHak.rosters.subject[0].hakbun, '같은 학생이면 비어 있던 학번 · 수업반만 채움 (원래 자료는 그대로)')

console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
process.exit(fails ? 1 : 0)
