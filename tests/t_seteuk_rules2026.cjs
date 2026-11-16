// 세특 검사 규칙 2026 개정 반영 — 한자 · 영문 · 장학금 · 대회 · 연구보고서 · 문단 기호 · 오탐 고침 · 채팅 지식 (빌드 없이). 문장은 모두 지어낸 것
const { loadShared: load } = require('./tsload.cjs')
const S = load('seteuk.ts')
const R = load('seteukRules.ts')
const K = load('seteukKnowledge.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const hit = (text, label) => S.validateSeteuk(text, 0).issues.find((x) => x.label === label)
const lvl = (text, label) => hit(text, label)?.level
const rule = (list, label) => list.find((r) => r.label === label)

console.log('1. 낮춘 것 (block → check)')
ok(rule(R.SETEUK_FORMAT, '금지 특수문자').level === 'check' && rule(R.SETEUK_FORMAT, "'학생' 주어").level === 'check', '특수문자 · 학생 주어는 확인')
ok(!rule(R.SETEUK_FORMAT, '금지 특수문자').re.includes('‘') && !hit('‘가나’ 라고 함.', '금지 특수문자'), '‘ ’ 는 더 이상 안 잡음')
ok(lvl('모둠 · 발표', '금지 특수문자') === 'check' && lvl('학생은 발표함.', "'학생' 주어") === 'check', '가운뎃점 · 학생 주어는 확인으로 잡힘')
ok(/문체 권고/.test(rule(R.SETEUK_FORMAT, "'학생' 주어").why) && /p\.79/.test(rule(R.SETEUK_FORMAT, '금지 특수문자').why), '이유를 솔직하게')

console.log('\n2. 오탐 고침')
ok(!hit('모평균을 구함.', '모의고사·석차') && !!hit('모평 성적을 말함.', '모의고사·석차'), '모평균은 안 잡고 모평은 잡음')
ok(!hit('작품 속 어머니의 마음을 분석함.', '부모 정보') && !!hit('아버지가 의사인 인물을 분석함.', '부모 정보') && !!hit('부모님 직업을 조사함.', '부모 정보'), '작품 속 어머니는 안 잡고 부모 직업은 잡음')

console.log('\n3. 대회')
ok(lvl('교내 대회에 참가함.', '대회 언급') === 'block' && !hit('대회의실에서 발표함.', '대회 언급'), '대회 언급은 block, 대회의실은 아님')
ok(/p\.81/.test(rule(R.SETEUK_BANNED, '대회 언급').why), '대회 이유에 쪽수')
ok(lvl('과학 경연 행사에 참가함.', '대회 우회 표현') === 'check' && !hit('행사 안내문을 읽음.', '대회 우회 표현'), '대회 우회(행사 · 경연 + 참가)는 확인, 행사만은 아님')

console.log('\n4. 새 규칙')
ok(lvl('漢字를 씀.', '한자') === 'block' && !hit('한글만 씀.', '한자'), '한자 block')
ok(lvl('설문 결과를 SPSS로 분석함.', '영문') === 'check', 'SPSS 는 영문 확인')
ok(!hit('H2O의 농도를 mL 단위로 잼.', '영문') && !hit('물 20mL와 5kg, 10cm를 씀.', '영문') && !hit('SNS와 AI, PPT, pH를 다룸.', '영문'), '화학식 · 단위 · 허용 영문은 안 잡음')
ok(lvl('Python 으로 구현함.', '영문') === 'check' && !hit('CEO를 인터뷰함.', '영문') && !!hit('CEOs를 인터뷰함.', '영문'), '허용 목록은 낱말 단위로만')
ok(lvl('장학금을 받음.', '장학금') === 'block' && !!hit('장학생으로 뽑힘.', '장학금') && !hit('장학사가 방문함.', '장학금'), '장학금 · 장학생 block')
ok(['DALF', 'TORFL', 'DELE', 'TestDaF', 'DSH', '한자능력검정', '상공회의소 한자', '실용한자', '한자급수', '토익', 'HSK'].every((w) => hit(w + ' 점수를 말함.', '공인어학시험')), '공인어학시험 목록 확장 + 기존 유지')
ok(lvl('연구 보고서를 씀.', '연구보고서 · 소논문') === 'check' && !!hit('소논문을 씀.', '연구보고서 · 소논문') && !hit('탐구 보고를 함.', '연구보고서 · 소논문'), '연구보고서 · 소논문은 확인')
ok(lvl('1. 개념을 정리함.', '문단 기호 · 번호') === 'block' && lvl('앞 문장.\n① 다음 항목', '문단 기호 · 번호') === 'block' && lvl('가. 정리함', '문단 기호 · 번호') === 'block' && lvl('- 정리함', '문단 기호 · 번호') === 'block', '줄 첫머리 번호 · 기호는 block')
ok(!hit('1.5배 증가함.', '문단 기호 · 번호') && !hit('2학기에 발표함.', '문단 기호 · 번호') && !hit('지난 해 3. 5배 이상 늘림', '문단 기호 · 번호'), '1.5배 · 2학기에 · 문장 중간 숫자는 안 잡음')

console.log('\n5. 도서명 · AI 말투 · 영역 안내')
ok(rule(R.SETEUK_BANNED, '도서명 표기').level === 'check' && /Q&A p\.153/.test(rule(R.SETEUK_BANNED, '도서명 표기').why), '도서명 이유(저자 표기 자유)')
ok(R.SETEUK_AI_TELL.every((r) => r.why.startsWith('문체 권고 — ')), '평가어 · AI 말투 이유는 모두 문체 권고로 시작')
const rec = (k) => R.SETEUK_RECORDS.find((r) => r.key === k)
ok(rec('진로').note.includes('p.73') && rec('진로').note.includes('700자') && rec('행발').note.includes('p.73') && rec('행발').note.includes('500자'), '진로 · 행발 notes 에 p.73')
ok(rec('진로').chars === 500 && rec('행발').chars === 300 && rec('과세특').chars === 500, '한도 글자수는 그대로')

console.log('\n6. 채팅 지식')
ok(K.SETEUK_CHAT_KNOWLEDGE.length <= 1800 && K.SETEUK_CHAT_KNOWLEDGE.startsWith('# 2026 학교생활기록부 기재 — 참고'), `길이 ${K.SETEUK_CHAT_KNOWLEDGE.length} · 제목`)
ok(['세특 써 줘', '생기부 점검', '학생부 종합', '생활기록부', '기재요령 알려줘', '특기사항', '행발 300자', '창체', '진로활동', '자율활동', '동아리활동', '교과학습발달상황'].every((t) => K.wantsSeteukKnowledge(t)), '관련 말이 있으면 true')
ok(!K.wantsSeteukKnowledge('오늘 급식 메뉴 알려줘') && !K.wantsSeteukKnowledge('') && !K.wantsSeteukKnowledge(undefined), '관련 없으면 false')

console.log(fails ? `\n✗ ${fails}개 실패` : '\n전부 통과')
process.exit(fails ? 1 : 0)
