// shared/gianmun.ts — 받은 공문에서 근거 뽑기 · 기안문 지시 · 글 다듬기 (빌드 없이)
const { loadShared: load } = require('./tsload.cjs')
const G = load('gianmun.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

console.log('1. 기안 종류')
ok(G.GIANMUN_KINDS.length === 6, '종류 6가지')
ok(G.GIANMUN_KINDS.every((k) => k.label && k.desc && k.skeleton.includes('관련') && k.closing), '종류마다 설명 · 뼈대(관련) · 맺음 안내')

console.log('\n2. extractRef — 머리글에서 근거 뽑기')
const a = G.extractRef([
  '○○교육청',
  '수신 각급학교장',
  '(경유)',
  '제목 2026학년도 ○○ 교육 운영 계획 제출 안내',
  '1. 관련: 교육부 정책과-55(2026. 2. 1.)',
  '2. 위 호와 관련하여 …',
  '시행 교육과-1234 (2026. 3. 5.) 접수 ',
  ''
].join('\n'))
ok(a.org === '○○교육청', `기관: ${a.org}`)
ok(a.docNo === '교육과-1234', `문서번호: ${a.docNo}`)
ok(a.date === '2026. 3. 5.', `시행일자: ${a.date}`)
ok(a.title === '2026학년도 ○○ 교육 운영 계획 제출 안내', `제목: ${a.title}`)

const b = G.extractRef('제 목 : 가나다 연수 참가 안내\n시행 교육지원과-77 (2026.4.1)\n')
ok(b.title === '가나다 연수 참가 안내' && b.docNo === '교육지원과-77' && b.date === '2026. 4. 1.', `모양이 다른 머리글: ${JSON.stringify(b)}`)

const c = G.extractRef('수신 각급학교장\n제목 라마바 협조 요청\n내용 …\n서울특별시교육감\n')
ok(c.org === '서울특별시교육청' && c.docNo === '' && c.date === '', `끝의 발신 명의에서 기관: ${JSON.stringify(c)}`)

const d = G.extractRef('아무 말이나 적힌 글')
ok(d.org === '' && d.docNo === '' && d.date === '' && d.title === '', '못 찾으면 모두 빈 글')

console.log('\n3. 관련 줄')
ok(G.relatedLine(a) === '1. 관련: ○○교육청 교육과-1234(2026. 3. 5.) 「2026학년도 ○○ 교육 운영 계획 제출 안내」', G.relatedLine(a))
ok(G.relatedLine({ title: '가나다' }) === '1. 관련: 「가나다」', `제목만: ${G.relatedLine({ title: '가나다' })}`)
ok(G.relatedLine({ org: '○○교육청', docNo: '교육과-1' }) === '1. 관련: ○○교육청 교육과-1', '기관 + 번호만')
ok(G.relatedLine({}).includes('○○○') && G.relatedLine({}).startsWith('1. 관련:'), '모두 없으면 빈칸 표시')

console.log('\n4. gianmunPrompt')
const p = G.gianmunPrompt('plan', a, '공문 본문 가나다', '4월 둘째 주 수요일')
ok(p.user.includes(G.relatedLine(a)) && p.user.includes('공문 본문 가나다') && p.user.includes('4월 둘째 주 수요일'), '사용자 글에 관련 줄 · 공문 · 추가 내용')
ok(p.system.includes('관련') && p.system.includes('가. 나. 다.') && p.system.includes('끝.'), '지시에 관련 · 가나다 번호 · 끝.')
ok(/지어내지 마세요/.test(p.system) && p.system.includes('○○'), '없는 사실을 지어내지 말고 ○○ 로 비운다')
ok(p.system.includes('수립하고자') && !G.gianmunPrompt('reply', a, 'x').system.includes('수립하고자'), '종류별 맺음 안내가 다름')
ok(G.gianmunPrompt('zzz', a, 'x').system.includes('회신'), '모르는 종류는 첫 종류로')

console.log('\n5. formatGianmun')
const f1 = G.formatGianmun('## 제목입니다\n\n1.관련: ○○교육청\n2.위 호와 관련하여 **다음**과 같이 함.\n  가.내용 확인\n  나) 아님\n붙임 1. 계획서 1부.')
const L = f1.split('\n')
ok(L[0] === '제목입니다', `# 제거: ${L[0]}`)
ok(f1.includes('1. 관련: ○○교육청') && f1.includes('2. 위 호와') && f1.includes('  가. 내용 확인'), '번호 뒤 띄어쓰기')
ok(!f1.includes('**'), '굵게 표시 제거')
ok(f1.includes('붙임  1. 계획서 1부.') && f1.endsWith('1부.  끝.'), `붙임 두 칸 · 끝: ${JSON.stringify(f1.slice(-24))}`)
ok(G.formatGianmun('내용 함.\n끝') .endsWith('함.\n끝.') || G.formatGianmun('내용 함.  끝.') === '내용 함.  끝.', '이미 끝이 있으면 중복하지 않음')
ok(G.formatGianmun(G.formatGianmun('1. 가나다 함.')) === '1. 가나다 함.  끝.', '두 번 다듬어도 같음')
ok(G.formatGianmun('') === '' && G.formatGianmun('<think>생각</think>\n1. 본문 함.').startsWith('1. 본문'), '빈 글 · 생각 과정 제거')

if (fails) { console.log(`\n실패 ${fails}`); process.exit(1) }
console.log('\n모두 통과')
