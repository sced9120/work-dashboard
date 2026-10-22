// 폴더 일괄 분석 (electron/main/batch.ts) — 빌드된 앱의 IPC 로. AI 는 가로채 가짜로 답한다(진짜 키를 쓰지 않는다).
const path = require('path')
const fs = require('fs')
const ExcelJS = require(path.join(__dirname, '../node_modules/exceljs'))
const { zipSync, strToU8 } = require(path.join(__dirname, '../node_modules/fflate'))
const { handlers, next, USER_DATA, calls } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

const log = []
let answer = () => { throw new Error('답을 정하지 않았습니다') }
global.fetch = async (url, opts = {}) => {
  const entry = { url: String(url), headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null }
  log.push(entry)
  return answer(entry)
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const gemini = (text) => json({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 300 } })
const seteuk = (n) => '함수의 합성을 활용하여 자료 처리 과정을 단계별로 설명함. '.repeat(20).slice(0, n)

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('batch:run'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'gemini', gemini_key: 'TEST-FAKE-KEY', gemini_model: 'gemini-3.8-flash', openai_key: 'TEST-OA', claude_key: 'TEST-CL' })

  // 시험 폴더: 사진 두 장 낸 학생 · PDF · 그림이 붙은 워드 · 학생 하위 폴더 · 읽지 않는 파일
  const dir = path.join(USER_DATA, '수행평가 제출')
  fs.mkdirSync(path.join(dir, '10301 박민수'), { recursive: true })
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 1)])
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20000, 2)])
  fs.writeFileSync(path.join(dir, '10107(홍길동)_Screenshot_1.jpg'), jpg)
  fs.writeFileSync(path.join(dir, '10107(홍길동)_Screenshot_2.jpg'), jpg)
  fs.writeFileSync(path.join(dir, '10121 김철수.pdf'), Buffer.from('%PDF-1.4\n% 가짜 PDF\n'))
  const docXml = '<w:document><w:body><w:p><w:r><w:t>탐구 제목: 함수로 보는 프로그래밍</w:t></w:r></w:p><w:p><w:r><w:t>탐구 동기는 코딩이다</w:t></w:r></w:p></w:body></w:document>'
  fs.writeFileSync(path.join(dir, '10201(이영희)_보고서.docx'), Buffer.from(zipSync({ 'word/document.xml': strToU8(docXml), 'word/media/image1.png': new Uint8Array(png) })))
  fs.writeFileSync(path.join(dir, '10301 박민수', 'page1.png'), png)
  fs.writeFileSync(path.join(dir, '안내.zip'), 'x')
  fs.writeFileSync(path.join(dir, '~$임시.docx'), 'x')

  console.log('1. 폴더 고르기 · 학생별로 묶기')
  next.open.push([dir])
  const f = await call('batch:pick')
  ok(f.ok && f.folder === '수행평가 제출', `폴더 이름만 넘김: ${f.folder}`)
  ok(f.students.length === 4, `학생 4명: ${f.students.map((x) => `${x.sid}${x.name}(${x.files.length})`).join(', ')}`)
  const hong = f.students.find((x) => x.sid === '10107')
  ok(hong && hong.name === '홍길동' && hong.files.length === 2 && hong.files.every((x) => x.kind === 'image'), '사진 두 장 낸 학생은 한 사람으로')
  ok(f.students.some((x) => x.sid === '10301' && x.name === '박민수'), '하위 폴더 이름으로 학생 찾기')
  ok(f.skipped.includes('안내.zip') && !f.skipped.some((x) => x.startsWith('~$')), `읽지 않는 형식은 빼고 알림 · 임시 파일은 조용히: ${f.skipped.join(', ')}`)
  ok(!JSON.stringify(f).includes(USER_DATA), '경로는 화면에 넘기지 않음')
  const dropped = await call('batch:add', dir)
  ok(dropped.ok && dropped.students.length === 4, '끌어 놓은 폴더도 같게')
  const notDir = await call('batch:add', path.join(dir, '10121 김철수.pdf'))
  ok(!notDir.ok && /폴더/.test(notDir.error), `파일을 놓으면 안내: ${notDir.error}`)

  const options = { items: ['탐구 제목', '탐구 동기'], style: 'summary', seteuk: true, seteukLength: 200, seteukGuide: '- 학생 이름은 쓰지 않는다', grade: true, rubric: '형식 5점 · 내용 5점', note: '' }
  const students = f.students.map((x) => ({ key: x.key, sid: x.sid, name: x.name, ids: x.files.map((y) => y.id) }))

  console.log('\n2. Gemini 로 읽기 (학생마다 한 번 · 세특 글자 수 맞추기)')
  calls.sent.length = 0
  log.length = 0
  answer = (e) => {
    const parts = e.body.contents[0].parts
    const last = parts[parts.length - 1].text || ''
    if (/공백 포함 \d+자입니다/.test(last)) return gemini(seteuk(195))
    const short = parts.some((p) => p.inlineData && p.inlineData.mimeType === 'application/pdf')
    return gemini('```json\n' + JSON.stringify({ items: { '탐구 제목': '함수 탐구', '탐구동기': '코딩' }, score: '9', score_reason: '형식 완비', seteuk: seteuk(short ? 120 : 198), note: '' }) + '\n```')
  }
  const r = await call('batch:run', { job: 'job-1', students, options, model: { provider: 'gemini', model: 'gemini-3.8-flash' } })
  ok(r.ok, '끝까지 읽음')
  const done = calls.sent.filter((c) => c.ch === 'batch:progress' && c.payload.status === 'done').map((c) => c.payload)
  ok(done.length === 4, `4명 모두 완료 (${done.length})`)
  const reads = log.filter((e) => !/공백 포함 \d+자입니다/.test(e.body.contents[0].parts.slice(-1)[0].text || ''))
  ok(reads.length === 4, `학생마다 요청 한 번 (${reads.length})`)
  const hongReq = reads.find((e) => e.body.contents[0].parts.filter((p) => p.inlineData && p.inlineData.mimeType === 'image/jpeg').length === 2)
  ok(!!hongReq, '사진 두 장을 한 요청에')
  const wordReq = reads.find((e) => e.body.contents[0].parts.some((p) => /탐구 동기는 코딩이다/.test(p.text || '')))
  ok(wordReq && wordReq.body.contents[0].parts.some((p) => p.inlineData && p.inlineData.mimeType === 'image/png'), '워드는 글을 뽑고 안의 그림도 함께')
  ok(reads.every((e) => !JSON.stringify(e.body).match(/홍길동|김철수|이영희|박민수|Screenshot|보고서\.docx/)), '파일 이름 · 학생 이름은 보내지 않음')
  ok(reads[0].body.generationConfig.responseMimeType === 'application/json' && reads[0].body.generationConfig.temperature === undefined, 'JSON 으로 받기 · 새 Gemini 에는 temperature 없음')
  const sys = reads[0].body.systemInstruction.parts[0].text
  ok(/탐구 제목/.test(sys) && /200자/.test(sys) && /형식 5점/.test(sys) && /학생 이름은 쓰지 않는다/.test(sys), '지침에 항목 · 글자 수 · 채점 기준 · 세특 지침')
  ok(reads[0].headers['x-goog-api-key'] === 'TEST-FAKE-KEY', '내 Gemini 키로')
  const kim = done.find((p) => p.key.startsWith('10121'))
  ok(kim.result.seteuk.length === 195, `글자 수가 모자라면(120자) 한 번 고쳐 받음 → ${kim.result.seteuk.length}자`)
  ok(log.length === 5, `고쳐 받기는 그 학생만 (요청 ${log.length}개)`)
  ok(kim.result.items['탐구 동기'] === '코딩' && kim.result.score === '9', '항목 이름을 조금 다르게 써 와도 맞춤 · 점수')

  console.log('\n3. 저장 (엑셀 · CSV)')
  const rows = f.students.map((x) => ({ sid: x.sid, name: x.name, files: x.files.map((y) => y.name), result: done.find((p) => p.key === x.key).result }))
  const xlsx = path.join(USER_DATA, 'out.xlsx')
  next.save.push(xlsx)
  const sv = await call('batch:save', rows, options, '수행평가 제출', 'xlsx')
  ok(sv.ok && fs.existsSync(xlsx), sv.message)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(xlsx)
  const ws = wb.worksheets[0]
  const head = ws.getRow(1).values.slice(1)
  ok(head.join('|') === '학번|이름|탐구 제목|탐구 동기|점수|채점 근거|세특|세특 글자 수|파일|비고', `머리글: ${head.join(' | ')}`)
  ok(ws.rowCount === 5 && ws.getRow(2).getCell(1).value === '10107', '학번 차례 · 학번은 글자로')
  const csv = path.join(USER_DATA, 'out.csv')
  next.save.push(csv)
  await call('batch:save', rows, options, '', 'csv')
  const text = fs.readFileSync(csv, 'utf8')
  ok(text.startsWith('﻿학번,이름,') && text.split('\r\n').length === 6, 'CSV 는 BOM 붙여 엑셀에서 한글이 바로 보이게')

  console.log('\n4. OpenAI · Claude 요청 모양')
  log.length = 0
  answer = () => json({ choices: [{ message: { content: JSON.stringify({ items: { '탐구 제목': 'A', '탐구 동기': 'B' }, seteuk: seteuk(190) }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
  await call('batch:run', { job: 'job-2', students: students.filter((x) => /10107|10121/.test(x.key)), options: { ...options, grade: false }, model: { provider: 'openai', model: 'gpt-6-luna' } })
  ok(log.every((e) => e.url.endsWith('/chat/completions') && e.body.response_format.type === 'json_object'), 'OpenAI: JSON 형식으로')
  const oaParts = log.flatMap((e) => e.body.messages[1].content)
  ok(oaParts.filter((p) => p.type === 'image_url' && p.image_url.detail === 'high').length === 2 && oaParts.some((p) => p.type === 'file' && p.file.filename === 'document.pdf'), 'OpenAI: 사진은 detail high, PDF 는 이름 없이')
  log.length = 0
  answer = () => json({ content: [{ type: 'text', text: JSON.stringify({ items: { '탐구 제목': 'A', '탐구 동기': 'B' }, seteuk: seteuk(190) }) }], usage: { input_tokens: 1, output_tokens: 1 } })
  await call('batch:run', { job: 'job-3', students: students.filter((x) => /10121/.test(x.key)), options, model: { provider: 'claude', model: 'claude-sonnet-5-5' } })
  ok(log.length === 1 && log[0].url.includes('anthropic') && log[0].body.messages[0].content.some((p) => p.type === 'document'), 'Claude: PDF 는 document 로')

  console.log('\n5. 키가 틀리면 나머지는 멈춤')
  calls.sent.length = 0
  log.length = 0
  answer = () => json({ error: { message: 'API key not valid' } }, 400)
  await call('batch:run', { job: 'job-4', students, options, model: { provider: 'gemini', model: 'gemini-3.8-flash' } })
  const errs = calls.sent.filter((c) => c.ch === 'batch:progress' && c.payload.status === 'error')
  ok(errs.length >= 1 && /키/.test(errs[0].payload.error), `오류 안내: ${errs[0] && errs[0].payload.error}`)
  ok(log.length <= 3, `더 보내지 않음 (요청 ${log.length}개)`)
  const again = await call('batch:run', { job: 'bad job!', students, options, model: null })
  ok(!again.ok, '이상한 작업 번호는 거절')

  console.log(fails ? `\n✗ ${fails}개 실패` : '\n✓ 모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
