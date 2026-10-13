// 업무 도우미 · 일반 대화 (electron/main/ai.ts · chats.ts) — 빌드된 앱의 IPC 로. AI 는 가로채 가짜로 답한다(진짜 키를 쓰지 않는다).
const path = require('path')
const fs = require('fs')
const { handlers, next, USER_DATA, calls } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

const log = []
let script = []
const enc = new TextEncoder()
/** SSE 를 조각조각 보낸다 (경계가 아무 데서나 갈라지게) */
function sse(lines) {
  const all = lines.join('')
  const pieces = []
  for (let i = 0; i < all.length; i += 23) pieces.push(all.slice(i, i + 23))
  return new Response(new ReadableStream({ start(c) { for (const p of pieces) c.enqueue(enc.encode(p)); c.close() } }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
const chunks = (text, n = 7) => {
  const out = []
  for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n))
  return out
}
const gemini = (text, finish = 'STOP') => sse([...chunks(text).map((t) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\r\n\r\n`), `data: ${JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: finish }] })}\r\n\r\n`])
const openai = (text) => sse([...chunks(text).map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`), `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`, 'data: [DONE]\n\n'])
const claude = (text) =>
  sse([
    `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'm' } })}\n\n`,
    ...chunks(text).map((t) => `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })}\n\n`),
    `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`
  ])
global.fetch = async (url, opts = {}) => {
  const entry = { url: String(url), method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body, signal: opts.signal }
  log.push(entry)
  const step = script.shift()
  if (!step) throw new Error('예상 못 한 요청 ' + url)
  return step(entry)
}
const lastBody = () => JSON.parse(log[log.length - 1].body)
const G = { provider: 'gemini', model: 'gemini-3.8-flash' }

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('ai:chatStream'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'gemini', gemini_key: 'TEST-GEMINI', openai_key: 'TEST-OPENAI', claude_key: 'TEST-CLAUDE', gemini_model: 'gemini-3.8-flash', openai_model: 'gpt-5.5', claude_model: 'claude-test' })

  // 시험 파일
  const txt = path.join(USER_DATA, '학생 보고서.txt')
  fs.writeFileSync(txt, '행렬의 덧셈으로 이미지 두 장을 겹치는 과정을 탐구함. 교환법칙 A+B=B+A 를 확인함.')
  const png = path.join(USER_DATA, '활동지 사진.png')
  fs.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))
  const heic = path.join(USER_DATA, '폰 사진.heic')
  fs.writeFileSync(heic, Buffer.from([0, 0, 0, 24]))
  const scan = path.join(USER_DATA, '스캔 보고서.pdf')
  fs.writeFileSync(scan, Buffer.from('%PDF-1.4\n% 글자 없는 가짜 스캔\n'))
  const exe = path.join(USER_DATA, 'setup.exe')
  fs.writeFileSync(exe, 'x')

  console.log('1. 파일 올리기 (고르기 · 끌어 놓기 같은 길)')
  next.open.push([txt, png])
  ok((await call('chat:pick')).join() === `${txt},${png}`, '고르기 창은 문서 · 사진 경로를 돌려줌')
  const att = await call('chat:attach', [txt, png, scan, heic, exe, USER_DATA, path.join(USER_DATA, '없는.pdf')])
  const [aTxt, aPng, aScan, aHeic] = att.attachments
  ok(aTxt.kind === 'text' && aTxt.text.includes('교환법칙') && aPng.kind === 'image' && aPng.mime === 'image/png' && !aPng.text && aScan.kind === 'pdf' && aScan.mime === 'application/pdf' && aHeic.kind === 'image', `글은 뽑고, 사진 · 글자 없는 PDF 는 파일 그대로: ${att.attachments.map((a) => a.kind).join(', ')}`)
  ok(att.errors.length === 3 && att.errors[0].includes('setup.exe') && att.errors[1].includes('폴더') && att.errors[2].includes('찾을 수 없습니다'), `올릴 수 없는 것은 까닭과 함께: ${att.errors.length}개`)

  console.log('\n2. 일반 대화 (Gemini) — 지침 · 보관 자료 없음 · 사진과 파일을 함께 · 받는 대로')
  const before = calls.sent.length
  script = [() => gemini('**세특 초안**\n\n행렬의 덧셈을 활용해 이미지 합성 원리를 탐구함.')]
  const r1 = await call('ai:chatStream', {
    reqId: 'q1',
    mode: 'free',
    jobTitle: '수학 교사',
    instruction: '교과 세특을 500자 안팎으로, ~함. 으로 끝내서 쓴다',
    history: [{ role: 'user', content: '이 보고서로 세특 초안 써 줘', attachments: [aTxt, aPng, aScan] }],
    model: G
  })
  const b1 = lastBody()
  const sys1 = b1.systemInstruction.parts[0].text
  const parts1 = b1.contents[0].parts
  ok(log[log.length - 1].url.includes('/models/gemini-3.8-flash:streamGenerateContent?alt=sse') && log[log.length - 1].headers['x-goog-api-key'] === 'TEST-GEMINI', '고른 모델로 받는 대로(stream)')
  ok(sys1.includes('교과 세특을 500자 안팎으로') && sys1.includes('선생님이 정한 지침') && !sys1.includes('참고 자료') && !sys1.includes('<<<할일') && !sys1.includes('나이스'), '지침을 싣고, 보관 자료 · 일감 넣기 · 학교 정보는 싣지 않음')
  ok(parts1.length === 3 && parts1[0].inlineData.mimeType === 'image/png' && parts1[1].inlineData.mimeType === 'application/pdf' && parts1[2].text.includes('[올린 파일: 학생 보고서.txt]') && parts1[2].text.includes('교환법칙') && parts1[2].text.endsWith('이 보고서로 세특 초안 써 줘'), '사진 · 스캔 PDF 는 파일 그대로, 글 파일은 글로, 질문은 끝에')
  ok(!('temperature' in (b1.generationConfig || {})), '일반 대화는 temperature 를 보내지 않음 (서비스 기본값)')
  ok(r1.ok && r1.answer.startsWith('**세특 초안**') && r1.sources.length === 0, '조각 답을 이어 붙여 받음')
  const deltas = calls.sent.slice(before).filter((x) => x.ch === 'ai:chatDelta')
  ok(deltas.length >= 1 && deltas.every((d) => d.payload.reqId === 'q1') && r1.answer.startsWith(deltas[deltas.length - 1].payload.text.trim().slice(0, 5)), `받는 중인 글을 화면으로 (${deltas.length}번)`)

  console.log('\n3. 다음 질문에도 앞서 올린 파일을 함께 · 고르지 않은 경로는 읽지 않음')
  script = [() => gemini('더 짧게 고쳤습니다.')]
  await call('ai:chatStream', {
    reqId: 'q2',
    mode: 'free',
    jobTitle: '',
    instruction: '',
    history: [
      { role: 'user', content: '이 보고서로 세특 초안 써 줘', attachments: [aTxt, aPng] },
      { role: 'assistant', content: '**세특 초안** …' },
      { role: 'user', content: '300자로 줄여 줘', attachments: [{ kind: 'image', name: '몰래.png', path: path.join(USER_DATA, 'h.db'), mime: 'image/png' }] }
    ],
    model: G
  })
  const b2 = lastBody()
  ok(b2.contents.length === 3 && b2.contents[0].parts.some((p) => p.inlineData) && b2.contents[0].parts.some((p) => p.text && p.text.includes('교환법칙')) && b2.contents[1].role === 'model', '앞 마디의 파일도 다시 실음 (AI 는 앞 대화를 기억하지 않는다)')
  ok(!b2.contents[2].parts.some((p) => p.inlineData) && b2.contents[2].parts[0].text.includes('몰래.png — 이 PC 에서 파일을 찾을 수 없어'), '올리지 않은 경로는 읽지 않고 빼고 보냄')
  ok(!b2.systemInstruction.parts[0].text.includes('선생님이 정한 지침'), '지침이 없으면 기본 규칙만')

  console.log('\n4. 업무 도우미 — 보관 자료 · 일감 넣기 안내')
  script = [() => gemini('기한을 정리했습니다.')]
  const r3 = await call('ai:chatStream', { reqId: 'q3', mode: 'work', jobTitle: '학교폭력 담당', instruction: '무시되어야 함', history: [{ role: 'user', content: '놓치면 안 되는 기한 알려 줘' }], formFiles: ['회의록.hwpx'], model: G })
  const sys3 = lastBody().systemInstruction.parts[0].text
  ok(sys3.includes("'학교폭력 담당' 업무를 돕는") && sys3.includes('<<<할일') && sys3.includes('회의록.hwpx (이 대화에 올린 파일)') && !sys3.includes('무시되어야 함'), '업무 도우미 지침 · 일감 · 양식 이름, 일반 대화 지침은 안 씀')
  ok(r3.ok && Array.isArray(r3.sources), '근거 목록과 함께')

  console.log('\n5. OpenAI — 사진은 image_url, PDF 는 file(이름 대신 document.pdf)')
  script = [() => openai('OpenAI 답입니다.')]
  const r4 = await call('ai:chatStream', { reqId: 'q4', mode: 'free', jobTitle: '', instruction: '짧게', history: [{ role: 'user', content: '봐 줘', attachments: [aPng, aScan] }], model: { provider: 'openai', model: 'gpt-5.5' } })
  const b4 = lastBody()
  const c4 = b4.messages[1].content
  ok(log[log.length - 1].url === 'https://api.openai.com/v1/chat/completions' && b4.stream === true && b4.messages[0].role === 'system' && b4.messages[0].content.includes('짧게'), '받는 대로 · 지침은 system')
  ok(c4[0].type === 'text' && c4[1].type === 'image_url' && c4[1].image_url.url.startsWith('data:image/png;base64,') && c4[2].type === 'file' && c4[2].file.filename === 'document.pdf' && c4[2].file.file_data.startsWith('data:application/pdf;base64,'), '사진 · PDF 를 그대로 (파일 이름은 보내지 않음)')
  ok(r4.ok && r4.answer === 'OpenAI 답입니다.' && !('temperature' in b4), '[DONE] 까지 받아 이어 붙임 · temperature 없음')

  console.log('\n6. Claude — image · document 블록, HEIC 는 빼고 안내')
  script = [() => claude('Claude 답입니다.')]
  const r5 = await call('ai:chatStream', { reqId: 'q5', mode: 'free', jobTitle: '', instruction: '', history: [{ role: 'user', content: '봐 줘', attachments: [aPng, aScan, aHeic] }], model: { provider: 'claude', model: 'claude-test' } })
  const b5 = lastBody()
  const c5 = b5.messages[0].content
  ok(b5.stream === true && b5.max_tokens > 0 && c5[0].type === 'image' && c5[0].source.media_type === 'image/png' && c5[1].type === 'document' && c5[1].source.media_type === 'application/pdf' && c5.length === 3, '사진 · PDF 블록 + 글')
  ok(c5[2].text.includes('폰 사진.heic — 이 AI 는 HEIC 사진을 읽지 못해'), 'HEIC 는 Gemini 만 — 다른 AI 에는 빼고 안내')
  ok(r5.ok && r5.answer === 'Claude 답입니다.', 'content_block_delta 를 이어 붙임')

  console.log('\n7. 멈추기 · 오류')
  script = [
    (e) =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '여기까지 받' }] } }] })}\n\n`))
            e.signal?.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })))
          }
        }),
        { status: 200 }
      )
  ]
  const p6 = call('ai:chatStream', { reqId: 'q6', mode: 'free', jobTitle: '', instruction: '', history: [{ role: 'user', content: '길게 써 줘' }], model: G })
  await new Promise((r) => setTimeout(r, 60))
  await call('ai:chatStop', 'q6')
  const r6 = await p6
  ok(r6.ok && r6.stopped && r6.answer === '여기까지 받', `멈추면 받은 데까지 돌려줌: "${r6.answer}"`)
  script = [() => new Response('{"error":{"message":"bad key"}}', { status: 401 })]
  const r7 = await call('ai:chatStream', { reqId: 'q7', mode: 'free', jobTitle: '', instruction: '', history: [{ role: 'user', content: '안녕' }], model: G })
  ok(!r7.ok && r7.error.includes('키가 올바르지 않거나'), `키 오류 안내: ${r7.error.slice(0, 30)}…`)
  script = [() => gemini('긴 답의 앞부분', 'MAX_TOKENS')]
  const r8 = await call('ai:chatStream', { reqId: 'q8', mode: 'free', jobTitle: '', instruction: '', history: [{ role: 'user', content: '아주 길게' }], model: G })
  ok(r8.ok && r8.answer.includes('이어서 써 줘'), '답이 길어 끊기면 이어 달라고 하라고 안내')
  ok(!(await call('ai:chatStream', { reqId: 'q9', mode: 'free', jobTitle: '', instruction: '', history: [{ role: 'assistant', content: '혼자' }], model: G })).ok, '보낼 질문이 없으면 보내지 않음')

  // 키를 지운 서비스를 골라 두었으면 키가 있는 서비스의 기본 모델로
  await call('local:save', { ...(await call('local:load')), claude_key: '' })
  script = [() => gemini('키 있는 쪽으로')]
  const r11 = await call('ai:chatStream', { reqId: 'q11', mode: 'free', jobTitle: '', instruction: '', history: [{ role: 'user', content: '안녕' }], model: { provider: 'claude', model: 'claude-test' } })
  ok(r11.ok && log[log.length - 1].url.includes('generativelanguage.googleapis.com') && log[log.length - 1].url.includes('/gemini-3.8-flash:'), '키가 없는 서비스를 골랐으면 키 있는 서비스(Gemini) 기본 모델로')

  console.log('\n8. 대화 보관 — 새로 · 목록 · 이름 바꾸기 · 지우기 (chats/ 폴더, DB 아님)')
  ok((await call('chats:list')).length === 0, '처음엔 비어 있음')
  const id = '3f2a9c1e-0b7d-4c55-9e21-7a1b2c3d4e5f'
  const rec = { id, title: '수학 세특', mode: 'free', instruction: '세특 지침', created: '2026-10-12T01:00:00.000Z', updated: '2026-10-12T01:00:00.000Z', messages: [{ role: 'user', content: '보고서 세특', attachments: [aTxt] }, { role: 'assistant', content: '초안입니다', plan: [], extra: 1 }] }
  const sv = await call('chats:save', rec)
  ok(sv.ok && sv.meta.count === 2 && fs.existsSync(path.join(USER_DATA, 'chats', `${id}.json`)), '대화마다 파일 하나')
  const got = await call('chats:get', id)
  ok(got.instruction === '세특 지침' && got.messages[1].extra === 1 && got.messages[0].attachments[0].text.includes('교환법칙'), '다시 열면 지침 · 덧붙임 · 올린 파일 글까지 그대로')
  await call('chats:save', { ...rec, id: 'a1b2c3d4-0000-4000-8000-000000000001', title: '두 번째', updated: '2026-10-12T02:00:00.000Z', messages: [{ role: 'user', content: '안녕' }] })
  const list = await call('chats:list')
  ok(list.length === 2 && list[0].title === '두 번째' && list[1].title === '수학 세특' && !('messages' in list[0]), '목록은 최근 것부터 (글은 빼고)')
  ok((await call('chats:rename', id, '  수학   세특 (1반) ')).title === '수학 세특 (1반)', '이름 바꾸기')
  ok(!(await call('chats:save', { ...rec, id: '../../etc/passwd' })).ok && (await call('chats:get', '../h')) === null, '이상한 번호는 저장 · 읽기 거절 (폴더 밖으로 못 나감)')
  ok((await call('chats:delete', id)) && (await call('chats:list')).length === 1 && !fs.existsSync(path.join(USER_DATA, 'chats', `${id}.json`)), '지우면 파일도 사라짐')
  // 다시 연 대화의 사진은 이어서 보낼 수 있다 (그 대화에서 올린 것이므로)
  const id2 = 'b2c3d4e5-0000-4000-8000-000000000002'
  const other = path.join(USER_DATA, '다른 사진.png')
  fs.writeFileSync(other, Buffer.from([0x89, 0x50]))
  await call('chats:save', { id: id2, title: 't', mode: 'free', instruction: '', messages: [{ role: 'user', content: '이 사진', attachments: [{ kind: 'image', name: '다른 사진.png', path: other, mime: 'image/png' }] }] })
  await call('chats:get', id2)
  script = [() => gemini('봤습니다')]
  await call('ai:chatStream', { reqId: 'q10', mode: 'free', jobTitle: '', instruction: '', history: [{ role: 'user', content: '이 사진', attachments: [{ kind: 'image', name: '다른 사진.png', path: other, mime: 'image/png' }] }], model: G })
  ok(lastBody().contents[0].parts[0].inlineData?.mimeType === 'image/png', '저장된 대화를 다시 열면 그 대화의 사진도 다시 보냄')

  console.log('\n9. 지침 모음')
  const saved = await call('chats:savePresets', [{ id: 'p-abc123', name: '수학 세특', text: '지침 글' }, { id: 'builtin-setuk', name: '가짜', text: 'x' }, { id: 'p-empty', name: '', text: '' }])
  ok(saved.length === 1 && saved[0].name === '수학 세특' && (await call('chats:presets')).length === 1, '내 지침만 저장 (보기 · 빈 것은 뺌)')

  console.log('\n9b. 예전 기본 모델은 새 모델로 한 번만 (v3.3.1)')
  await call('local:save', await call('local:load'))
  const sfile = path.join(USER_DATA, 'settings.json')
  const old = JSON.parse(fs.readFileSync(sfile, 'utf8'))
  delete old.models_rev
  fs.writeFileSync(sfile, JSON.stringify({ ...old, openai_model: 'gpt-5.6-terra', claude_model: 'claude-sonnet-5', gemini_model: 'gemini-3.6-flash', feature_models: { chat: { provider: 'openai', model: 'gpt-5.6-luna' }, analyze: { provider: 'claude', model: 'claude-haiku-4-5' }, summary: { provider: 'gemini', model: 'gemini-3.8-flash' } } }))
  const up = await call('local:load')
  ok(up.openai_model === 'gpt-6-sol' && up.claude_model === 'claude-sonnet-5-5' && up.gemini_model === 'gemini-3.6-flash', `기본 모델: ${up.openai_model} · ${up.claude_model} · ${up.gemini_model}`)
  ok(up.feature_models.chat.model === 'gpt-6-luna' && up.feature_models.analyze.model === 'claude-haiku-5-5' && up.feature_models.summary.model === 'gemini-3.8-flash', '화면마다 고른 모델도 같은 등급의 새 모델로 (Gemini 는 그대로)')
  await call('local:save', { ...up, openai_model: 'gpt-5.6-terra' })
  ok((await call('local:load')).openai_model === 'gpt-5.6-terra' && JSON.parse(fs.readFileSync(sfile, 'utf8')).models_rev === 2, '바뀐 뒤 사람이 다시 고른 예전 모델은 그대로')

  console.log('\n10. 인수인계 파일에는 대화가 들어가지 않음')
  const h = path.join(USER_DATA, 'handoff.db')
  next.save.push(h)
  ok((await call('data:export', true)).ok && !fs.readFileSync(h).toString('utf8').includes('보고서 세특') && !fs.readFileSync(h).toString('utf8').includes('지침 글'), '대화 · 지침은 이 PC 에만')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
