// 스캔 문서 → 엑셀 (electron/main/ocr.ts) — 빌드된 앱의 IPC 로. Gemini 는 가로채 가짜로 답한다(진짜 키를 쓰지 않는다).
const path = require('path')
const fs = require('fs')
const ExcelJS = require(path.join(__dirname, '../node_modules/exceljs'))
const { handlers, next, USER_DATA } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

const API = 'https://generativelanguage.googleapis.com'
const log = []
let script = []
const enc = new TextEncoder()
/** SSE 를 조각조각(경계가 아무 데서나 갈라지게) 보낸다 */
function sse(events, crlf) {
  const nl = crlf ? '\r\n' : '\n'
  const all = events.map((e) => `data: ${JSON.stringify(e)}${nl}${nl}`).join('')
  const pieces = []
  for (let i = 0; i < all.length; i += 37) pieces.push(all.slice(i, i + 37))
  return new Response(new ReadableStream({ start(c) { for (const p of pieces) c.enqueue(enc.encode(p)); c.close() } }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
const textEvents = (text, finish, extra = {}) => {
  const out = []
  for (let i = 0; i < text.length; i += 120) out.push({ candidates: [{ content: { parts: [{ text: text.slice(i, i + 120) }] } }] })
  out.push({ candidates: [{ content: { parts: [{ text: '' }] }, finishReason: finish }], usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 900 }, ...extra })
  return out
}
global.fetch = async (url, opts = {}) => {
  const u = String(url)
  const entry = { url: u, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body }
  log.push(entry)
  const step = script.shift()
  if (!step) throw new Error('예상 못 한 요청 ' + u)
  return step(entry)
}

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('ocr:run'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'gemini', gemini_key: 'TEST-FAKE-KEY', gemini_model: 'gemini-3.6-flash' })

  // 시험 파일: 작은 PDF 하나, 큰 PDF 하나(15MB — Gemini 파일 저장소로)
  const small = path.join(USER_DATA, '3학년 영어 수행.pdf')
  fs.writeFileSync(small, Buffer.from('%PDF-1.4\n% 가짜 PDF\n'))
  const img = path.join(USER_DATA, 'page2.png')
  fs.writeFileSync(img, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const big = path.join(USER_DATA, 'big.pdf')
  fs.writeFileSync(big, Buffer.alloc(15 * 1024 * 1024, 7))

  console.log('1. 파일 고르기')
  next.open.push([small, img, path.join(USER_DATA, 'note.txt')])
  fs.writeFileSync(path.join(USER_DATA, 'note.txt'), 'x')
  const files = await call('ocr:pick')
  ok(files.length === 2 && files[0].mime === 'application/pdf' && files[1].mime === 'image/png' && !('path' in files[0]), `PDF · 사진만, 경로는 화면에 넘기지 않음: ${files.map((f) => f.name).join(', ')}`)

  console.log('\n2. 읽기 (작은 파일은 요청에 바로)')
  const md1 = [
    '> 업로드된 문서를 분석한 결과, **반복 양식(유형 A)**로 판단되어, 내용을 요약하지 않은 **유효 원문 그대로** 정리했습니다.',
    '',
    '| 페이지 | 학번 | 이름 | 제목 | 상세 내용 |',
    '| --- | --- | --- | --- | --- |',
    '| 1 | 00123 | 학생가 | AI Use | **I think** AI should be allowed. |',
    '| 2 | 30107 | 학생나 | My Phone | =SUM(A1) is not a formula here |',
    '| 3 | 30108 | 학생다 | Dream | I want to be a tea'
  ].join('\n')
  const progress = []
  script = [(e) => sse(textEvents(md1, 'MAX_TOKENS'), true)]
  const runP = call('ocr:run', { ids: files.map((f) => f.id), note: '학번 순으로', model: 'gemini-3.8-flash' })
  const a1 = await runP
  const req1 = JSON.parse(log[log.length - 1].body)
  const parts = req1.contents[0].parts
  ok(log[log.length - 1].url === `${API}/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse` && log[log.length - 1].headers['x-goog-api-key'] === 'TEST-FAKE-KEY', '사용자 키 · 고른 모델 · 받는 대로(stream)')
  ok(req1.systemInstruction.parts[0].text.startsWith('OCR 전용 처리 규칙') && req1.systemInstruction.parts[0].text.includes('Gemini OCR 전용 프롬프트 — 고정밀 원문 전사 및 표 구조화'), 'OCR 규칙 + 에이전트 지침')
  ok(req1.generationConfig.mediaResolution === 'MEDIA_RESOLUTION_HIGH' && req1.generationConfig.thinkingConfig.thinkingLevel === 'LOW' && req1.generationConfig.thinkingConfig.includeThoughts === false && !('temperature' in req1.generationConfig) && !req1.tools, '그림 해상도 high · 생각 low · temperature 없음 · 도구 없음')
  ok(parts.length === 3 && parts[0].inlineData.mimeType === 'application/pdf' && Buffer.from(parts[0].inlineData.data, 'base64').toString().startsWith('%PDF') && parts[1].inlineData.mimeType === 'image/png' && parts[2].text === '출력해주세요\n\n추가 요청사항: 학번 순으로', 'PDF · 사진 원본 그대로 + "출력해주세요" + 추가 요청')
  ok(a1.ok && a1.truncated && a1.finish === 'MAX_TOKENS' && a1.usage.output === 900, '끊긴 답(MAX_TOKENS) → 이어 받기 표시')

  console.log('\n3. 이어서 받기')
  const md2 = ['| 페이지 | 학번 | 이름 | 제목 | 상세 내용 |', '| --- | --- | --- | --- | --- |', '| 3 | 30108 | 학생다 | Dream | I want to be a teacher. |', '| 4 | 30109 | 학생라 | Sports | (본문 없음) |'].join('\n')
  script = [(e) => sse(textEvents(md2, 'STOP'), false)]
  const a2 = await call('ocr:continue')
  const req2 = JSON.parse(log[log.length - 1].body)
  ok(req2.contents.length === 3 && req2.contents[1].role === 'model' && !req2.contents[1].parts[0].text.includes('| 3 | 30108') && req2.contents[2].parts[0].text.includes('| 2 | 30107 |'), '앞 답(덜 나온 행은 빼고) + 마지막 행을 알려 주고 이어 달라고')
  ok(req2.contents[0].parts[0].inlineData, '처음 파일도 다시 함께 (Gemini 는 앞 대화를 기억하지 않는다)')
  ok(a2.ok && !a2.truncated, '다 받음')

  console.log('\n4. 엑셀로 저장')
  // 화면처럼 두 답을 이어 붙여 저장
  const ts = require(path.join(__dirname, '../node_modules/typescript'))
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../shared/mdtable.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const M = { exports: {} }
  new Function('module', 'exports', 'require', code)(M, M.exports, require)
  const tables = M.exports.answersToTables([a1, a2])
  ok(tables.length === 1 && tables[0].rows.map((r) => r[0]).join() === '1,2,3,4' && tables[0].rows[2][4] === 'I want to be a teacher.', `두 답을 한 표로 (덜 나온 행은 이어 받은 것으로): ${tables[0].rows.map((r) => r[0]).join()}`)
  const out = path.join(USER_DATA, 'ocr.xlsx')
  next.save.push(out)
  const sv = await call('ocr:save', tables, '3학년 영어 수행')
  ok(sv.ok && fs.existsSync(out), sv.message)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(out)
  const ws = wb.worksheets[0]
  ok(ws.getRow(1).values.slice(1).join(',') === '페이지,학번,이름,제목,상세 내용' && ws.getCell('A1').font.bold, '머리글 줄 (굵게)')
  ok(ws.getCell('B2').value === '00123' && typeof ws.getCell('A2').value === 'string', '학번 앞의 0 을 지킴 (모든 칸 글자 그대로)')
  ok(ws.getCell('E2').value === 'I think AI should be allowed.' && ws.getCell('E3').value === '=SUM(A1) is not a formula here' && !ws.getCell('E3').formula, '**굵게** 표시는 떼고, = 로 시작해도 수식이 아님')
  ok(ws.rowCount === 5 && ws.views[0].ySplit === 1 && ws.autoFilter, '4행 · 머리글 고정 · 거르기')

  console.log('\n5. 큰 파일은 Gemini 파일 저장소로 (이름은 보내지 않고, 끝나면 지움)')
  next.open.push([big])
  const [bf] = await call('ocr:pick')
  const before = log.length
  script = [
    (e) => new Response('{}', { status: 200, headers: { 'x-goog-upload-url': 'https://upload.example/s1' } }),
    (e) => new Response(JSON.stringify({ file: { name: 'files/abc', uri: `${API}/v1beta/files/abc`, state: 'PROCESSING' } }), { status: 200 }),
    (e) => new Response(JSON.stringify({ name: 'files/abc', uri: `${API}/v1beta/files/abc`, state: 'ACTIVE' }), { status: 200 }),
    (e) => sse(textEvents('| 가 | 나 |\n|---|---|\n| 1 | 2 |', 'STOP'), false)
  ]
  const a3 = await call('ocr:run', { ids: [bf.id], note: '', model: 'gemini-3.8-flash' })
  const reqs = log.slice(before)
  ok(reqs[0].url === `${API}/upload/v1beta/files` && JSON.parse(reqs[0].body).file.display_name === 'document' && reqs[0].headers['X-Goog-Upload-Header-Content-Length'] === String(15 * 1024 * 1024), '올리기 시작 (파일 이름 대신 document)')
  ok(reqs[1].url === 'https://upload.example/s1' && reqs[1].headers['X-Goog-Upload-Command'] === 'upload, finalize' && reqs[2].url === `${API}/v1beta/files/abc`, '올리고 · 받아 들일 때까지 기다림')
  const req3 = JSON.parse(reqs[3].body)
  ok(a3.ok && req3.contents[0].parts[0].fileData.fileUri === `${API}/v1beta/files/abc` && req3.contents[0].parts[1].text === '출력해주세요', '올린 파일을 가리켜 읽기')
  script = [(e) => new Response('{}', { status: 200 })]
  await call('ocr:clear')
  ok(log[log.length - 1].method === 'DELETE' && log[log.length - 1].url === `${API}/v1beta/files/abc`, '화면을 떠나면 올린 파일을 지움')

  console.log('\n6. 모델이 설정을 모를 때 · 오류 안내')
  next.open.push([small])
  const [sf] = await call('ocr:pick')
  script = [
    (e) => new Response('{"error":{"message":"thinking_level is not supported for this model"}}', { status: 400 }),
    (e) => sse(textEvents('| a | b |\n|---|---|\n| 1 | 2 |', 'STOP'), false)
  ]
  const a4 = await call('ocr:run', { ids: [sf.id], note: '', model: 'gemini-2.5-flash' })
  const retry = JSON.parse(log[log.length - 1].body)
  ok(a4.ok && !retry.generationConfig.thinkingConfig && retry.generationConfig.temperature === 0, '생각 단계를 모르는 모델이면 빼고 다시 (예전 모델은 temperature 0)')
  script = [(e) => new Response('{"error":{"message":"API key not valid. Please pass a valid API key."}}', { status: 400 })]
  const a5 = await call('ocr:run', { ids: [sf.id], note: '', model: 'gemini-3.8-flash' })
  ok(!a5.ok && a5.error.includes('키가 올바르지 않습니다'), `키 오류 안내: ${a5.error}`)
  script = [(e) => sse([{ candidates: [{ content: { parts: [] }, finishReason: 'RECITATION' }] }], false)]
  const a6 = await call('ocr:run', { ids: [sf.id], note: '', model: 'gemini-3.8-flash' })
  ok(!a6.ok && a6.error.includes('저작권'), `저작권으로 멈춤 안내: ${a6.error.slice(0, 40)}…`)
  ok(!(await call('ocr:run', { ids: ['없는번호'], note: '', model: 'gemini-3.8-flash' })).ok, '고르지 않은 파일은 읽지 않음')

  console.log('\n7. 만든이가 바꾼 지침 · 모델 (catalog.json 의 "ocr")')
  fs.writeFileSync(path.join(USER_DATA, 'catalog.json'), JSON.stringify({ fetchedAt: Date.now(), catalog: { schema: 1, tools: [], themes: [], ocr: { prompt: '새 지침: 표로만 답하세요', model: 'gemini-3.7-flash' } } }))
  script = [(e) => sse(textEvents('| a |\n|---|\n| 1 |', 'STOP'), false)]
  await call('ocr:run', { ids: [sf.id], note: '', model: '' })
  const req7 = JSON.parse(log[log.length - 1].body)
  ok(log[log.length - 1].url.includes('/models/gemini-3.7-flash:') && req7.systemInstruction.parts[0].text.endsWith('새 지침: 표로만 답하세요') && req7.systemInstruction.parts[0].text.startsWith('OCR 전용 처리 규칙'), '바꾼 지침 · 기본 모델을 씀')

  console.log('\n8. 기존 Gemini 대화도 3.6 이후 모델엔 temperature 를 빼고')
  const reply = (e) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '연결됨' }] } }] }), { status: 200 })
  script = [reply]
  await call('ai:test')
  const t1 = JSON.parse(log[log.length - 1].body)
  await call('local:save', { ...(await call('local:load')), gemini_model: 'gemini-2.5-flash' })
  script = [reply]
  await call('ai:test')
  const t2 = JSON.parse(log[log.length - 1].body)
  ok(!('temperature' in (t1.generationConfig || {})) && t2.generationConfig.temperature === 0.2, `3.6 Flash: temperature 없음 · 2.5 Flash: 0.2`)

  console.log('\n9. 인수인계 파일')
  const h = path.join(USER_DATA, 'h.db')
  next.save.push(h)
  ok((await call('data:export', true)).ok && !fs.readFileSync(h).toString('utf8').includes('I think AI'), 'OCR 결과는 어디에도 저장하지 않음')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
