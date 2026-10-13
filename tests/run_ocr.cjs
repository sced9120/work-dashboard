// 스캔 문서 → 엑셀 (electron/main/ocr.ts) — 빌드된 앱의 IPC 로. Gemini 는 가로채 가짜로 답한다(진짜 키를 쓰지 않는다).
const path = require('path')
const fs = require('fs')
const ExcelJS = require(path.join(__dirname, '../node_modules/exceljs'))
const { handlers, next, USER_DATA, calls } = global.__it

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
  const entry = { url: u, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body, signal: opts.signal }
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
  const runP = call('ocr:run', { tab: 't1', ids: files.map((f) => f.id), note: '학번 순으로', model: 'gemini-3.8-flash' })
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
  const a2 = await call('ocr:continue', 't1')
  const req2 = JSON.parse(log[log.length - 1].body)
  ok(req2.contents.length === 3 && req2.contents[1].role === 'model' && !req2.contents[1].parts[0].text.includes('| 3 | 30108') && req2.contents[2].parts[0].text.includes('| 2 | 30107 |'), '앞 답(덜 나온 행은 빼고) + 마지막 행을 알려 주고 이어 달라고')
  ok(req2.contents[0].parts[0].inlineData, '처음 파일도 다시 함께 (Gemini 는 앞 대화를 기억하지 않는다)')
  ok(a2.ok && !a2.truncated, '다 받음')

  console.log('\n4. 엑셀로 저장')
  // 화면처럼 두 답을 이어 붙여 저장
  const M = require('./tsload.cjs').loadShared('mdtable')
  const tables = M.answersToTables([a1, a2])
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

  // 손글씨 수식(LaTeX) · 아주 긴 본문(탐구 보고서)
  const long = '가나다라마바사 아자차카타파하 '.repeat(90).trim()
  const mathTables = M.extractTables(
    `| 번호 | 문제 | 본문 |\n|---|---|---|\n| 1 | $A+2E=\\begin{pmatrix} 4 & 1 \\\\ 2 & 3 \\end{pmatrix}$, $\\frac{5}{3}$ | ${long} |\n| 2 | 짧음 | 짧음 |`
  )
  const out2 = path.join(USER_DATA, 'ocr2.xlsx')
  next.save.push(out2)
  ok((await call('ocr:save', mathTables, '수식')).ok, '수식 · 긴 글 표 저장')
  const wb2 = new ExcelJS.Workbook()
  await wb2.xlsx.readFile(out2)
  const ws2 = wb2.worksheets[0]
  ok(ws2.getCell('B2').value === 'A+2E=(4 1; 2 3), 5/3', `수식은 읽기 쉬운 글자로: ${ws2.getCell('B2').value}`)
  ok(ws2.getCell('C2').value === long, '긴 글은 자르지 않고 그대로')
  const wC = ws2.getColumn(3).width
  const hangul = [...long].filter((c) => c !== ' ').length * 2 + [...long].filter((c) => c === ' ').length
  ok(wC > 60 && wC <= 150 && ws2.getRow(2).height <= 409 && Math.ceil((hangul * 1.15) / wC) * 15 <= 409, `긴 글 열은 넓혀서 줄 높이 한도(409) 안에 다 보이게: 너비 ${wC} · 높이 ${ws2.getRow(2).height}`)
  ok(ws2.getColumn(1).width < 20 && ws2.getRow(3).height === 18, '짧은 열 · 짧은 행은 그대로')

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
  const a3 = await call('ocr:run', { tab: 't2', ids: [bf.id], note: '', model: 'gemini-3.8-flash' })
  const reqs = log.slice(before)
  ok(reqs[0].url === `${API}/upload/v1beta/files` && JSON.parse(reqs[0].body).file.display_name === 'document' && reqs[0].headers['X-Goog-Upload-Header-Content-Length'] === String(15 * 1024 * 1024), '올리기 시작 (파일 이름 대신 document)')
  ok(reqs[1].url === 'https://upload.example/s1' && reqs[1].headers['X-Goog-Upload-Command'] === 'upload, finalize' && reqs[2].url === `${API}/v1beta/files/abc`, '올리고 · 받아 들일 때까지 기다림')
  const req3 = JSON.parse(reqs[3].body)
  ok(a3.ok && req3.contents[0].parts[0].fileData.fileUri === `${API}/v1beta/files/abc` && req3.contents[0].parts[1].text === '출력해주세요', '올린 파일을 가리켜 읽기')
  script = [(e) => new Response('{}', { status: 200 })]
  await call('ocr:clear', 't1')
  ok(log[log.length - 1].url !== `${API}/v1beta/files/abc`, '다른 탭을 닫아도 이 탭이 올린 파일은 그대로')
  await call('ocr:clear', 't2')
  ok(log[log.length - 1].method === 'DELETE' && log[log.length - 1].url === `${API}/v1beta/files/abc`, '탭을 닫으면 그 탭이 올린 파일을 지움')

  console.log('\n6. 모델이 설정을 모를 때 · 오류 안내')
  next.open.push([small])
  const [sf] = await call('ocr:pick')
  script = [
    (e) => new Response('{"error":{"message":"thinking_level is not supported for this model"}}', { status: 400 }),
    (e) => sse(textEvents('| a | b |\n|---|---|\n| 1 | 2 |', 'STOP'), false)
  ]
  const a4 = await call('ocr:run', { tab: 't3', ids: [sf.id], note: '', model: 'gemini-2.5-flash' })
  const retry = JSON.parse(log[log.length - 1].body)
  ok(a4.ok && !retry.generationConfig.thinkingConfig && retry.generationConfig.temperature === 0, '생각 단계를 모르는 모델이면 빼고 다시 (예전 모델은 temperature 0)')
  script = [(e) => new Response('{"error":{"message":"API key not valid. Please pass a valid API key."}}', { status: 400 })]
  const a5 = await call('ocr:run', { tab: 't3', ids: [sf.id], note: '', model: 'gemini-3.8-flash' })
  ok(!a5.ok && a5.error.includes('키가 올바르지 않습니다'), `키 오류 안내: ${a5.error}`)
  script = [(e) => sse([{ candidates: [{ content: { parts: [] }, finishReason: 'RECITATION' }] }], false)]
  const a6 = await call('ocr:run', { tab: 't3', ids: [sf.id], note: '', model: 'gemini-3.8-flash' })
  ok(!a6.ok && a6.error.includes('저작권'), `저작권으로 멈춤 안내: ${a6.error.slice(0, 40)}…`)
  ok(!(await call('ocr:run', { tab: 't3', ids: ['없는번호'], note: '', model: 'gemini-3.8-flash' })).ok, '고르지 않은 파일은 읽지 않음')

  ok(!(await call('ocr:run', { ids: [sf.id], note: '', model: 'gemini-3.8-flash' })).ok, '탭 번호가 없으면 읽지 않음')
  ok(!(await call('ocr:continue', '없는탭')).ok, '없는 탭은 이어 받지 않음')

  console.log('\n6b. 탭 — 따로 읽고, 화면을 떠나도 계속, 5개까지')
  // 끌어 놓은 파일: PDF · 사진만 받고 나머지는 이름만 돌려준다
  const dropped = await call('ocr:add', [small, path.join(USER_DATA, 'note.txt'), USER_DATA])
  ok(dropped.files.length === 1 && dropped.files[0].name === '3학년 영어 수행.pdf' && !('path' in dropped.files[0]) && dropped.skipped.join() === 'note.txt,' + path.basename(USER_DATA), `끌어 놓은 파일: PDF 만 받고 txt · 폴더는 뺌 (${dropped.skipped.join(', ')})`)
  // 탭 A 는 늦게, 탭 B 는 빨리 답한다 — 둘이 함께 읽는다
  let releaseA
  const gateA = new Promise((r) => (releaseA = r))
  const before6 = calls.sent.length
  script = [
    async (e) => {
      await gateA
      return sse(textEvents('| 탭 | 값 |\n|---|---|\n| A | 1 |', 'STOP'), false)
    },
    (e) => sse(textEvents('| 탭 | 값 |\n|---|---|\n| B | 2 |', 'STOP'), false)
  ]
  const pa = call('ocr:run', { tab: 'tabA', ids: [dropped.files[0].id], note: '', model: 'gemini-3.8-flash' })
  await new Promise((r) => setTimeout(r, 20))
  ok(!(await call('ocr:run', { tab: 'tabA', ids: [dropped.files[0].id], note: '', model: 'gemini-3.8-flash' })).ok, '읽는 중인 탭에서 또 읽기는 막음')
  const rb = await call('ocr:run', { tab: 'tabB', ids: [sf.id], note: '', model: 'gemini-3.8-flash' })
  ok(rb.ok && rb.text.includes('| B | 2 |'), '탭 B 는 탭 A 를 기다리지 않고 먼저 끝남')
  releaseA()
  const ra = await pa
  ok(ra.ok && ra.text.includes('| A | 1 |'), '탭 A 도 제 답을 받음')
  const prog = calls.sent.slice(before6).filter((x) => x.ch === 'ocr:progress')
  ok(prog.length >= 2 && prog.every((x) => x.payload.tab === 'tabA' || x.payload.tab === 'tabB') && prog.some((x) => x.payload.tab === 'tabA') && prog.some((x) => x.payload.tab === 'tabB'), '진행 표시에 탭 번호가 붙음')
  // 멈추기는 그 탭만 — 둘 다 기다리는 중에 C 만 멈춘다
  let releaseD
  const gateD = new Promise((r) => (releaseD = r))
  const waitAbort = (e) =>
    new Promise((res, rej) => {
      e.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
  script = [waitAbort, async (e) => (await gateD, sse(textEvents('| x |\n|---|\n| D |', 'STOP'), false))]
  const pc = call('ocr:run', { tab: 'tabC', ids: [sf.id], note: '', model: 'gemini-3.8-flash' })
  await new Promise((r) => setTimeout(r, 20))
  const pd = call('ocr:run', { tab: 'tabD', ids: [sf.id], note: '', model: 'gemini-3.8-flash' })
  await new Promise((r) => setTimeout(r, 20))
  await call('ocr:cancel', 'tabC')
  const rc = await pc
  releaseD()
  const rd = await pd
  ok(!rc.ok && rc.error === '멈췄습니다.' && rd.ok && rd.text.includes('| D |'), '멈추기는 그 탭만 (C 는 멈추고 D 는 끝까지)')
  // 5개까지 (tabA · tabB · tabC · tabD · t3 이 열려 있다 — t1 · t2 는 닫았다)
  const sixth = await call('ocr:run', { tab: 'tabE', ids: [sf.id], note: '', model: 'gemini-3.8-flash' })
  ok(!sixth.ok && sixth.error.includes('5개까지'), `여섯째 탭은 막음: ${sixth.error}`)
  await Promise.all(['tabA', 'tabB', 'tabC', 'tabD', 't3'].map((t) => call('ocr:clear', t)))

  console.log('\n7. 만든이가 바꾼 지침 · 모델 (catalog.json 의 "ocr")')
  fs.writeFileSync(path.join(USER_DATA, 'catalog.json'), JSON.stringify({ fetchedAt: Date.now(), catalog: { schema: 1, tools: [], themes: [], ocr: { prompt: '새 지침: 표로만 답하세요', model: 'gemini-3.7-flash' } } }))
  script = [(e) => sse(textEvents('| a |\n|---|\n| 1 |', 'STOP'), false)]
  await call('ocr:run', { tab: 't7', ids: [sf.id], note: '', model: '' })
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

  console.log('\n8b. OpenAI 키만 있을 때 — gpt-6-luna 로 같은 지침 · 같은 흐름')
  fs.writeFileSync(path.join(USER_DATA, 'catalog.json'), JSON.stringify({ fetchedAt: Date.now(), catalog: { schema: 1, tools: [], themes: [], ocr: { prompt: '', model: '' } } }))
  await call('local:save', { ...(await call('local:load')), gemini_key: '', openai_key: 'TEST-OPENAI-KEY' })
  const oaSse = (text, finish, usage = true) => {
    const lines = []
    for (let i = 0; i < text.length; i += 50) lines.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text.slice(i, i + 50) } }] })}\n\n`)
    lines.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\n`)
    if (usage) lines.push(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 3200, completion_tokens: 700 } })}\n\n`)
    lines.push('data: [DONE]\n\n')
    const all = lines.join('')
    const pieces = []
    for (let i = 0; i < all.length; i += 29) pieces.push(all.slice(i, i + 29))
    return new Response(new ReadableStream({ start(c) { for (const p of pieces) c.enqueue(enc.encode(p)); c.close() } }), { status: 200 })
  }
  next.open.push([small, img])
  const oaFiles = await call('ocr:pick')
  script = [(e) => oaSse('> 정리했습니다.\n\n| 번호 | 이름 |\n|---|---|\n| 1 | 학생가 |\n| 2 | 학생', 'length')]
  const o1 = await call('ocr:run', { tab: 'oa', ids: oaFiles.map((f) => f.id), note: '학번 순으로', model: '' })
  const oreq = JSON.parse(log[log.length - 1].body)
  const ouser = oreq.messages[1].content
  ok(log[log.length - 1].url === 'https://api.openai.com/v1/chat/completions' && log[log.length - 1].headers.Authorization === 'Bearer TEST-OPENAI-KEY', 'OpenAI 키로 Chat Completions')
  ok(oreq.model === 'gpt-6-luna' && oreq.stream === true && oreq.reasoning_effort === 'low' && !('temperature' in oreq), `모델을 고르지 않으면 싼 등급 gpt-6-luna · 받는 대로 · 생각 low · temperature 없음 (${oreq.model})`)
  ok(oreq.messages[0].role === 'system' && oreq.messages[0].content.startsWith('OCR 전용 처리 규칙') && oreq.messages[0].content.includes('Gemini OCR 전용 프롬프트'), '같은 OCR 규칙 + 에이전트 지침')
  ok(ouser[0].type === 'file' && ouser[0].file.filename === 'document.pdf' && ouser[0].file.file_data.startsWith('data:application/pdf;base64,') && ouser[1].type === 'image_url' && ouser[1].image_url.detail === 'high' && ouser[1].image_url.url.startsWith('data:image/png;base64,') && ouser[2].text === '출력해주세요\n\n추가 요청사항: 학번 순으로', 'PDF 는 파일 그대로(이름은 document.pdf) · 사진은 detail high · "출력해주세요"')
  ok(o1.ok && o1.truncated && o1.finish === 'length' && o1.usage.output === 700, '끊긴 답(length) → 이어 받기 표시 · 사용량')
  script = [(e) => oaSse('| 번호 | 이름 |\n|---|---|\n| 2 | 학생나 |', 'stop')]
  const o2 = await call('ocr:continue', 'oa')
  const oreq2 = JSON.parse(log[log.length - 1].body)
  ok(o2.ok && !o2.truncated && oreq2.messages.length === 4 && oreq2.messages[2].role === 'assistant' && !oreq2.messages[2].content.includes('| 2 | 학생') && oreq2.messages[3].content.includes('| 1 | 학생가 |') && oreq2.messages[1].content[0].type === 'file', '이어 받기: 앞 답(덜 나온 행 빼고) + 마지막 행 + 처음 파일도 다시')
  ok(M.answersToTables([o1, o2])[0].rows.map((r) => r[0]).join() === '1,2', '두 답을 한 표로')
  // 생각 단계를 모르는 모델이면 빼고 다시
  script = [(e) => new Response('{"error":{"message":"Unsupported parameter: reasoning_effort"}}', { status: 400 }), (e) => oaSse('| a |\n|---|\n| 1 |', 'stop', false)]
  const o3 = await call('ocr:run', { tab: 'oa', ids: [oaFiles[0].id], note: '', model: 'gpt-5.6-luna' })
  ok(o3.ok && !('reasoning_effort' in JSON.parse(log[log.length - 1].body)) && JSON.parse(log[log.length - 1].body).model === 'gpt-5.6-luna', '고른 OpenAI 모델 · 생각 설정을 모르면 빼고 다시')
  // HEIC 는 OpenAI 가 못 읽는다
  const heicFile = path.join(USER_DATA, '폰.heic')
  fs.writeFileSync(heicFile, Buffer.from([0, 0, 0, 24]))
  const [hf] = (await call('ocr:add', [heicFile])).files
  const o4 = await call('ocr:run', { tab: 'oa', ids: [hf.id], note: '', model: 'gpt-6-luna' })
  ok(!o4.ok && o4.error.includes('HEIC'), `HEIC 는 미리 막고 안내: ${o4.error.slice(0, 30)}…`)
  // Gemini 모델을 골랐는데 Gemini 키가 없으면
  const o5 = await call('ocr:run', { tab: 'oa', ids: [oaFiles[0].id], note: '', model: 'gemini-3.8-flash' })
  ok(!o5.ok && o5.error.includes('OpenAI 모델을 골라'), `Gemini 키가 없으면 OpenAI 모델을 고르라고: ${o5.error.slice(0, 30)}…`)
  // 30MB 가 넘는 PDF 는 OpenAI 파일 저장소로 (이름은 document.pdf) → 탭을 닫으면 지움
  const huge = path.join(USER_DATA, 'huge.pdf')
  fs.writeFileSync(huge, Buffer.alloc(31 * 1024 * 1024, 7))
  const [hg] = (await call('ocr:add', [huge])).files
  script = [(e) => new Response(JSON.stringify({ id: 'file-abc123', object: 'file' }), { status: 200 }), (e) => oaSse('| a |\n|---|\n| 1 |', 'stop')]
  const o6 = await call('ocr:run', { tab: 'oa2', ids: [hg.id], note: '', model: '' })
  const up = log[log.length - 2]
  const upBody = Buffer.from(up.body).toString('latin1')
  const used = JSON.parse(log[log.length - 1].body).messages[1].content[0]
  ok(o6.ok && up.url === 'https://api.openai.com/v1/files' && /multipart\/form-data; boundary=/.test(up.headers['Content-Type']) && upBody.includes('name="purpose"\r\n\r\nuser_data') && upBody.includes('filename="document.pdf"') && !upBody.includes('huge.pdf') && used.file.file_id === 'file-abc123', '큰 PDF 는 파일 저장소에 올려(이름 대신 document.pdf) file_id 로')
  script = [(e) => new Response('{}', { status: 200 })]
  await call('ocr:clear', 'oa2')
  ok(log[log.length - 1].method === 'DELETE' && log[log.length - 1].url === 'https://api.openai.com/v1/files/file-abc123', '탭을 닫으면 올린 파일을 지움')
  // 만든이가 catalog.json 으로 바꾼 OpenAI 기본 모델
  fs.writeFileSync(path.join(USER_DATA, 'catalog.json'), JSON.stringify({ fetchedAt: Date.now(), catalog: { schema: 1, tools: [], themes: [], ocr: { prompt: '', model: '', openaiModel: 'gpt-6.1-luna' } } }))
  script = [(e) => oaSse('| a |\n|---|\n| 1 |', 'stop')]
  await call('ocr:run', { tab: 'oa', ids: [oaFiles[0].id], note: '', model: '' })
  ok(JSON.parse(log[log.length - 1].body).model === 'gpt-6.1-luna', '만든이가 정한 OpenAI 기본 모델을 씀')
  // 키가 하나도 없으면
  await call('local:save', { ...(await call('local:load')), openai_key: '' })
  const o7 = await call('ocr:run', { tab: 'oa', ids: [oaFiles[0].id], note: '', model: '' })
  ok(!o7.ok && o7.error.includes('Gemini 또는 OpenAI'), '키가 없으면 둘 중 하나를 넣으라고')
  await Promise.all(['oa', 't7'].map((t) => call('ocr:clear', t)))

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
