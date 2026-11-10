// K-EXAONE (LG AI연구원, docs.exaone.ai) — 빌드된 앱의 IPC 로. AI 는 가로채 가짜로 답한다(진짜 키를 쓰지 않는다).
const path = require('path')
const fs = require('fs')
const { handlers, USER_DATA } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

const log = []
let script = []
const enc = new TextEncoder()
function sse(lines) {
  const all = lines.join('')
  const pieces = []
  for (let i = 0; i < all.length; i += 19) pieces.push(all.slice(i, i + 19))
  return new Response(new ReadableStream({ start(c) { for (const p of pieces) c.enqueue(enc.encode(p)); c.close() } }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: 'k-exaone_v2.5', choices: [{ index: 0, delta, ...(finish ? { finish_reason: finish } : {}) }] })}\n\n`
const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } })
global.fetch = async (url, opts = {}) => {
  const entry = { url: String(url), headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null }
  log.push(entry)
  const step = script.shift()
  if (!step) throw new Error('예상 못 한 요청 ' + url)
  return step(entry)
}

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('ai:chatStream'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  ok(s.exaone_model === 'k-exaone_v2.5' && s.exaone_key === '', '처음 값: 모델 k-exaone_v2.5 · 키 없음')
  await call('local:save', { ...s, provider: 'exaone', exaone_key: 'TEST-EXAONE', gemini_key: '', openai_key: '', claude_key: '' })

  console.log('1. 연결 확인 (한 번에 받는 답)')
  script = [() => json({ choices: [{ message: { role: 'assistant', reasoning_content: '생각…', content: '\n\n{"tasks":[]}' } }] })]
  const t = await call('ai:test')
  const req = log[log.length - 1]
  ok(t.ok && /k-exaone_v2\.5/.test(t.message) && t.message.includes('{"tasks":[]}'), `성공 · 앞 줄바꿈 없앰: ${t.message}`)
  ok(req.url === 'https://api.exaone.ai/v1/chat/completions' && req.headers.Authorization === 'Bearer TEST-EXAONE', '주소 · Bearer 키')
  ok(req.body.model === 'k-exaone_v2.5' && req.body.stream === false && req.body.reasoning_effort === 'high' && req.body.max_tokens > 0 && !('response_format' in req.body), '모델 · 추론 강도 high · response_format 안 보냄')

  console.log('\n2. 업무 도우미 (받는 대로) — 생각은 버리고 답만')
  script = [() => sse([chunk({ role: 'assistant', content: '' }), chunk({ reasoning_content: '사용자가' }), chunk({ reasoning_content: ' 묻는다' }), chunk({ content: '\n\n안녕하세요' }), chunk({ content: ', 무엇을 도와드릴까요?' }), chunk({}, 'stop'), 'data: [DONE]\n\n'])]
  const r = await call('ai:chatStream', { reqId: 'e1', mode: 'free', jobTitle: '인성부', instruction: '', history: [{ role: 'user', content: '안녕' }], model: { provider: 'exaone', model: 'k-exaone_v2.5' } })
  ok(r.ok && r.answer === '안녕하세요, 무엇을 도와드릴까요?', `답: ${r.answer}`)
  ok(log[log.length - 1].body.stream === true && log[log.length - 1].body.messages.some((m) => m.role === 'system'), '받는 대로 · 지침 함께')

  console.log('\n3. 사진을 올린 대화 — 글로 알리고 보내지 않음')
  const png = path.join(USER_DATA, 'p.png')
  fs.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))
  const att = (await call('chat:attach', [png])).attachments
  script = [() => sse([chunk({ content: '사진은 읽지 못합니다.' }, 'stop')])]
  await call('ai:chatStream', { reqId: 'e2', mode: 'free', jobTitle: '', instruction: '', history: [{ role: 'user', content: '이거 봐 줘', attachments: att }], model: { provider: 'exaone', model: 'k-exaone_v2.5' } })
  const last = log[log.length - 1].body.messages.pop()
  ok(typeof last.content === 'string' && last.content.includes('읽지 못해 보내지 않았습니다') && !JSON.stringify(log[log.length - 1].body).includes('base64'), '사진은 안 보내고 글로 알림')

  console.log('\n4. 한도(429) — 잠깐 쉬고 한 번 더')
  script = [() => json({ result_code: 'TOO_MANY' }, 429, { 'retry-after-ms': '10' }), () => json({ choices: [{ message: { content: '{"tasks":[]}' } }] })]
  const t2 = await call('ai:test')
  ok(t2.ok && script.length === 0, '두 번째에 성공')
  script = [() => json({}, 401)]
  const t3 = await call('ai:test')
  ok(!t3.ok && /K-EXAONE/.test(t3.message) && /키/.test(t3.message), `키 오류 안내: ${t3.message}`)

  console.log('\n5. 저장 — 키는 AI 키와 같은 칸(암호화되는 PC 에서는 암호화)')
  const file = JSON.parse(fs.readFileSync(path.join(USER_DATA, 'settings.json'), 'utf8'))
  ok((file.plain?.exaone_key === 'TEST-EXAONE' || !!file.enc?.exaone_key) && !('exaone_key' in file) && file.provider === 'exaone', '키 칸 · 고른 서비스')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
