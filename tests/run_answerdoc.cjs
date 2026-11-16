// 답 → 한글(.hwpx) · 엑셀 저장 — 빌드된 앱의 IPC 로 (hwp:answerDoc · ocr:save). 저장 창은 가짜 경로로 답한다.
const path = require('path')
const fs = require('fs')
const AdmZip = require(path.join(__dirname, '../node_modules/adm-zip'))
const ExcelJS = require(path.join(__dirname, '../node_modules/exceljs'))
const { handlers, next, USER_DATA, calls } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('hwp:answerDoc'); i++) await new Promise((r) => setTimeout(r, 50))
  ok(handlers.has('hwp:answerDoc'), 'hwp:answerDoc 처리기가 있음')

  console.log('1. 답 → 한글 문서')
  const md = [
    '# 가나다 안내문',
    '',
    '## 준비할 것',
    '',
    '- 필기구 챙기기',
    '- 라마바 신청서 내기',
    '',
    '1. 첫째 순서 확인',
    '2. 둘째 순서 확인',
    '',
    '| 번호 | 이름 | 점수 |',
    '| --- | --- | --- |',
    '| 1 | 가나다 | 90 |',
    '| 2 | 라마바 | 85 |',
    '| 3 | 가나다 | 70 |',
    '',
    '이 부분은 **굵게** 보여야 합니다. 📌',
    '',
    '<<<문서 양식=없음 파일=숨김',
    '보이면 안 되는 본문',
    '문서>>>'
  ].join('\n')
  const out = path.join(USER_DATA, 'answer.hwpx')
  next.save.push(out)
  const r = await call('hwp:answerDoc', { name: '', markdown: md })
  ok(r.ok && r.path === out && fs.existsSync(out), `저장함: ${r.message}`)
  const zip = new AdmZip(out)
  const names = zip.getEntries().map((e) => e.entryName)
  ok(names[0] === 'mimetype', `첫 항목은 mimetype: ${names[0]}`)
  const sec = zip.readAsText('Contents/section0.xml')
  ok(/<hp:tbl[\s>]/.test(sec), '표(hp:tbl)가 있음')
  ok(sec.includes('가나다 안내문') && sec.includes('준비할 것'), '제목 · 소제목 글')
  ok(sec.includes('필기구 챙기기') && sec.includes('첫째 순서 확인'), '글머리 · 번호 목록 글')
  ok(sec.includes('이 부분은') && sec.includes('굵게'), '굵게 로 쓴 글은 남음')
  ok(!sec.includes('**'), '글자 ** 가 그대로 남지 않음')
  ok(!sec.includes('보이면 안 되는') && !sec.includes('📌') && !sec.includes('<<<'), '제어 묶음 · 이모지는 빠짐')
  ok((sec.match(/<hp:tbl[\s>]/g) || []).length === 1 && (sec.match(/<hp:tc[\s>]/g) || []).length >= 12, '3x4(머리글 포함) 칸이 모두 있음')

  console.log('\n2. 제목이 없는 답 · 대화 제목')
  const out2 = path.join(USER_DATA, 'answer2.hwpx')
  next.save.push(out2)
  const r2 = await call('hwp:answerDoc', { name: '3월 학급 안내', markdown: '준비물은 가나다 입니다.' })
  const sec2 = new AdmZip(out2).readAsText('Contents/section0.xml')
  ok(r2.ok && sec2.includes('3월 학급 안내') && sec2.includes('준비물은'), '제목 없는 답에 대화 제목을 제목으로 단다')

  console.log('\n3. 취소 · 빈 글 · 열기 허용')
  const r3 = await call('hwp:answerDoc', { name: '', markdown: '# 제목\n\n본문' })
  ok(!r3.ok && r3.message === '저장을 취소했습니다.', '저장 창에서 취소하면 파일을 만들지 않음')
  const r4 = await call('hwp:answerDoc', { name: '', markdown: '<think>생각만</think>' })
  ok(!r4.ok, `쓸 글이 없으면 실패: ${r4.message}`)
  ok((await call('files:openSaved', out)) === '' && calls.opened.includes(path.resolve(out)), '저장한 파일은 [열기] 로 열림')

  console.log('\n4. 엑셀 — 학번 글자 · 열 정렬 · 칸 서식')
  const tables = [{
    title: '가나다 명단',
    header: ['번호', '학번', '날짜', '금액', '메모'],
    rows: [
      ['1', '0123', '2026. 3. 5.', '1,200', '**굵게**'],
      ['2', '0456', '3월 6일', '3,400', '`code`'],
      ['3', '010-1234-5678', '26.3.7', '15%', '*기울임*'],
      ['4', '=SUM(A1)', '2026-03-08', '7', '라마바']
    ]
  }]
  const xo = path.join(USER_DATA, 'kind.xlsx')
  next.save.push(xo)
  const sv = await call('ocr:save', tables, '가나다 명단')
  ok(sv.ok && fs.existsSync(xo), sv.message)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(xo)
  const ws = wb.worksheets[0]
  ok(ws.getCell('B2').value === '0123' && typeof ws.getCell('B2').value === 'string', '학번 0123 은 글자 그대로')
  ok(ws.getCell('B4').value === '010-1234-5678' && ws.getCell('B5').value === '=SUM(A1)' && !ws.getCell('B5').formula, '전화번호 · =SUM 도 글자')
  ok(typeof ws.getCell('D2').value === 'string' && ws.getCell('D2').value === '1,200', '금액 칸도 글자 그대로')
  ok(ws.getCell('A2').alignment.horizontal === 'center', '번호 열은 가운데')
  ok(ws.getCell('C2').alignment.horizontal === 'center', '날짜 열은 가운데')
  ok(ws.getCell('D2').alignment.horizontal === 'right', '금액 열은 오른쪽')
  ok(ws.getCell('E2').alignment.horizontal === 'left' && ws.getCell('E2').alignment.vertical === 'top', '글 열은 왼쪽 · 위')
  ok(ws.getCell('E2').value === '굵게' && ws.getCell('E2').font.bold, '칸 전체 **굵게** → 굵은 글씨')
  ok(ws.getCell('E3').value === 'code' && ws.getCell('E3').font.name === 'Consolas' && ws.getCell('E3').fill.fgColor.argb === 'FFF0F0F0', '`코드` → Consolas + 연회색')
  ok(ws.getCell('E4').value === '기울임' && ws.getCell('E4').font.italic, '*기울임* → 기울임꼴')
  const wA = ws.getColumn(1).width, wD = ws.getColumn(4).width, wC = ws.getColumn(3).width
  ok(wA >= 8 && wA <= 15 && wD >= 12 && wD <= 25 && wC >= 15 && wC <= 20, `열 너비 범위: 번호 ${wA} · 날짜 ${wC} · 금액 ${wD}`)

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
