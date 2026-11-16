// [최신 목록 불러오기] (ai:listModels) — 빌드된 앱의 IPC 로. 밖으로 나가는 요청은 가로채 가짜로 답한다(진짜 키를 쓰지 않는다).
const path = require('path')
const { handlers } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })

const log = []
let script = []
global.fetch = async (url, opts = {}) => {
  log.push({ url: String(url), headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null })
  const step = script.shift()
  if (!step) throw new Error('예상 못 한 요청 ' + url)
  return step()
}
const SSE = (text) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } })

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('ai:listModels'); i++) await new Promise((r) => setTimeout(r, 50))
  ok(handlers.has('ai:listModels'), 'ai:listModels IPC 가 있음')
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'openai', openai_key: 'TEST-OAI', gemini_key: 'TEST-GEM', claude_key: 'TEST-CLA', exaone_key: 'TEST-EXA', gemini_mode: 'key' })

  console.log('1. OpenAI')
  script = [() => json({ data: [{ id: 'gpt-6.1-sol' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' }, { id: 'o3-mini' }] })]
  let r = await call('ai:listModels', 'openai')
  ok(r.ok && r.models.join() === 'gpt-6.1-sol,o3-mini', `거른 목록: ${r.models}`)
  ok(log[0].url === 'https://api.openai.com/v1/models' && log[0].headers.Authorization === 'Bearer TEST-OAI', '주소 · Bearer 키')

  console.log('\n2. Gemini')
  script = [() => json({ models: [{ name: 'models/gemini-4-carbon', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] }] })]
  r = await call('ai:listModels', 'gemini')
  ok(r.ok && r.models.join() === 'gemini-4-carbon', `거른 목록: ${r.models}`)
  ok(log[1].url.startsWith('https://generativelanguage.googleapis.com/v1beta/models') && log[1].headers['x-goog-api-key'] === 'TEST-GEM', '주소 · x-goog-api-key')

  console.log('\n3. Claude (여러 쪽)')
  script = [
    () => json({ data: [{ id: 'claude-fable-5-2', lifecycle: 'active' }, { id: 'claude-opus-4-1', lifecycle: 'deprecated' }], has_more: true, last_id: 'claude-opus-4-1' }),
    () => json({ data: [{ id: 'claude-haiku-5-5', lifecycle: 'active' }], has_more: false })
  ]
  r = await call('ai:listModels', 'claude')
  ok(r.ok && r.models.join() === 'claude-fable-5-2,claude-haiku-5-5', `폐기 제외 · 두 쪽 합침: ${r.models}`)
  const cl = log[2]
  ok(cl.headers['x-api-key'] === 'TEST-CLA' && cl.headers['anthropic-version'] === '2023-06-01' && log[3].url.includes('after_id=claude-opus-4-1'), 'x-api-key · anthropic-version · 다음 쪽 after_id')

  console.log('\n4. EXAONE — 안 되면 친절한 안내')
  script = [() => json({}, 404)]
  r = await call('ai:listModels', 'exaone')
  ok(!r.ok && r.error === '이 서비스는 목록을 불러올 수 없습니다', `404: ${r.error}`)
  script = [() => json({ data: [{ id: 'k-exaone_v2.5' }] })]
  r = await call('ai:listModels', 'exaone')
  ok(r.ok && r.models.join() === 'k-exaone_v2.5' && log[log.length - 1].headers.Authorization === 'Bearer TEST-EXA', '되면 목록 · Bearer')

  console.log('\n5. 오류')
  script = [() => { throw new Error('ECONNRESET') }]
  r = await call('ai:listModels', 'openai')
  ok(!r.ok && /불러오지 못했습니다/.test(r.error) && /인터넷/.test(r.error), `네트워크 오류: ${r.error}`)
  script = [() => json({}, 401)]
  r = await call('ai:listModels', 'openai')
  ok(!r.ok && /키/.test(r.error), `401: ${r.error}`)
  await call('local:save', { ...(await call('local:load')), openai_key: '' })
  const before = log.length
  r = await call('ai:listModels', 'openai')
  ok(!r.ok && /키/.test(r.error) && log.length === before, '키 없으면 요청 없이 안내')

  console.log('\n6. Vertex · Express 연결')
  for (const mode of ['vertex', 'express']) {
    await call('local:save', { ...(await call('local:load')), gemini_mode: mode })
    const n = log.length
    r = await call('ai:listModels', 'gemini')
    ok(!r.ok && r.error === 'Vertex AI 연결에서는 목록을 불러오지 않습니다. 모델 이름을 직접 넣어 주세요.' && log.length === n, `${mode}: 안내만, 요청 없음`)
  }
  await call('local:save', { ...(await call('local:load')), gemini_mode: 'key', openai_key: 'TEST-OAI' })

  console.log('\n7. 새 모델 이름은 temperature 를 보내지 않음')
  const ask = async (provider, model) => {
    script = [() => SSE('답')]
    await call('ai:chatStream', { reqId: 'm' + model, mode: 'work', jobTitle: '', instruction: '', history: [{ role: 'user', content: '안녕' }], model: { provider, model } })
    return log[log.length - 1].body
  }
  for (const m of ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-astra']) ok(!('temperature' in (await ask('openai', m))), `${m}: temperature 없음`)
  ok('temperature' in (await ask('openai', 'gpt-4o')), '대조: gpt-4o 는 temperature 보냄')
  script = [() => json({ candidates: [{ content: { parts: [{ text: '답' }] } }] })]
  await call('ai:chatStream', { reqId: 'g4', mode: 'work', jobTitle: '', instruction: '', history: [{ role: 'user', content: '안녕' }], model: { provider: 'gemini', model: 'gemini-4-carbon' } })
  ok(!('temperature' in (log[log.length - 1].body.generationConfig || {})), 'gemini-4-carbon: temperature 없음')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
