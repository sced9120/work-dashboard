// shared/answerdoc.ts — 답을 한글 · 엑셀 파일로 옮기기 전 다듬기 · 말뜻 · 파일 이름
const { loadShared: load } = require('./tsload.cjs')
const A = load('answerdoc.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

// 제어 묶음
const withBlock = [
  '# 안내문',
  '',
  '내일까지 제출해 주세요.',
  '',
  '<<<문서 양식=없음 파일=안내문',
  '가나다 본문',
  '문서>>>',
  ''
].join('\n')
const a1 = A.prepareAnswerMd(withBlock)
ok(!a1.includes('<<<') && !a1.includes('문서>>>') && !a1.includes('가나다 본문'), '문서 제어 블록 제거')
ok(a1.includes('내일까지 제출해 주세요.'), '본문은 남음')
ok(!A.prepareAnswerMd('안녕하세요 <<<문').includes('<<<'), '덜 온 <<< 꼬리 제거')

// 생각 과정
const a2 = A.prepareAnswerMd('<think>속으로 생각</think>\n# 결과\n\n본문\n\n<details><summary>풀이</summary>세부 풀이</details>\n\n끝')
ok(!a2.includes('속으로 생각') && !a2.includes('<think>'), '<think> 제거')
ok(!a2.includes('세부 풀이') && !a2.includes('<details'), '<details> 제거')
ok(a2.includes('# 결과') && a2.includes('끝'), '나머지 남음')
ok(!A.prepareAnswerMd('<think>끝나지 않은 생각\n# 제목').includes('끝나지'), '닫히지 않은 <think> 는 끝까지 제거')

// 이모지
const a3 = A.prepareAnswerMd('## 📌 준비물\n\n- ✅ 필기구 😀\n- 가나다라마바 ※ 참고 ★ 별 ▶ 다음\n\n한글 ㄱㄴㄷ ㅏㅑ 가힣 ꯍ')
ok(!/[📌✅😀]/u.test(a3), '이모지 제거')
ok(a3.includes('## 준비물'), '이모지 뒤 겹공백 정리')
ok(a3.includes('가나다라마바') && a3.includes('ㄱㄴㄷ') && a3.includes('가힣') && a3.includes('ㅏㅑ'), '한글 · 자모 그대로')
ok(a3.includes('※') && a3.includes('★') && a3.includes('▶'), '글머리 기호는 그대로')
ok(A.stripEmoji('1️⃣ 첫째') === '1 첫째', '키캡 이모지는 숫자만 남김')

// 울타리
const fenced = '표입니다.\n\n```markdown\n| 이름 | 점수 |\n| --- | --- |\n| 가나다 | 90 |\n```\n\n끝.'
const a4 = A.prepareAnswerMd(fenced)
ok(!a4.includes('```') && a4.includes('| 가나다 | 90 |'), 'markdown 울타리로 감싼 표는 벗김')
const code = '```python\nprint("|a|b|")\n```'
ok(A.prepareAnswerMd(code).includes('```python'), '코드 울타리는 그대로')
const plain = '```\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```'
ok(!A.prepareAnswerMd(plain).includes('```'), '언어 없는 울타리의 표도 벗김')
const notTable = '```markdown\n# 예시\n- 항목\n```'
ok(A.prepareAnswerMd(notTable).includes('```markdown'), '표가 아닌 울타리는 그대로')

// 제목
ok(A.prepareAnswerMd('본문만 있어요', '가정통신문').startsWith('# 가정통신문\n\n본문만'), '제목 없으면 title 을 # 로 붙임')
ok(A.prepareAnswerMd('# 이미 제목\n\n본문', '가정통신문').startsWith('# 이미 제목'), '이미 # 로 시작하면 title 을 붙이지 않음')
ok(A.prepareAnswerMd('## 소제목\n본문', '가정통신문').startsWith('## 소제목'), '## 로 시작해도 붙이지 않음')
ok(A.prepareAnswerMd('본문만').startsWith('본문만'), 'title 없으면 붙이지 않음')
ok(A.prepareAnswerMd('본문', '📌 제목: 안내/문서').startsWith('# 제목 안내문서'), 'title 도 이모지 · 금지 문자 정리')
ok(A.prepareAnswerMd('') === '', '빈 글은 빈 글')
ok(A.firstHeading('앞글\n\n## 🎉 주간 계획\n본문') === '주간 계획', 'firstHeading')
ok(A.firstHeading('```\n# 코드 안\n```\n# 진짜 제목') === '진짜 제목', 'firstHeading 은 울타리 안을 건너뜀')
ok(A.firstHeading('제목 없음') === '', 'firstHeading 없으면 빈 글')

// 말뜻
const I = A.exportIntent
ok(I('이걸 엑셀로 정리해 줘').xlsx && !I('이걸 엑셀로 정리해 줘').hwp, '엑셀로 → xlsx')
ok(I('표로 만들어 줘').xlsx, '표로 → xlsx')
ok(I('스프레드시트 형식으로').xlsx && I('XLSX 로').xlsx && I('시트에 넣게').xlsx, '스프레드시트 · xlsx · 시트')
ok(I('한글 파일로 만들어 줘').hwp, '한글 → hwp')
ok(I('hwpx 로 줘').hwp && I('HWP 파일').hwp, 'hwp · hwpx')
for (const w of ['문서로 정리', '파일로 주세요', '보고서 써 줘', '공문 만들어', '가정통신문 초안', '안내문 작성', '계획서 부탁']) ok(I(w).hwp, `hwp 말뜻: ${w}`)
ok(I('엑셀과 한글 둘 다 줘').xlsx && I('엑셀과 한글 둘 다 줘').hwp, '둘 다')
ok(!I('내일 급식 뭐야?').xlsx && !I('내일 급식 뭐야?').hwp, '관계없는 말은 둘 다 아님')
ok(!I('').xlsx && !I(undefined).hwp, '빈 말')

// 파일 이름
ok(A.cleanTitle('📊 3월 \ 계획: "안내" <초안> | ?*  ') === '3월 계획 안내 초안', '이모지 · 금지 문자 · 공백 정리')
ok(A.cleanTitle('가'.repeat(60)).length === 40, '40자 제한')
ok(A.cleanTitle('...제목...') === '제목', '앞뒤 점 제거')
const d = new Date(2026, 2, 5, 9, 7)
ok(A.exportFileName('3월 계획', '업무도우미_문서', d) === '3월 계획_20260305_0907', '{제목}_{YYYYMMDD_HHMM}')
ok(A.exportFileName('', '업무도우미_문서', d) === '업무도우미_문서_20260305_0907', '제목이 비면 기본 이름')
ok(A.exportFileName('🎉 ?', '업무도우미_표', d) === '업무도우미_표_20260305_0907', '정리하고 비면 기본 이름')

console.log(fails ? `\n실패 ${fails}건` : '\n모두 통과')
process.exit(fails ? 1 : 0)
