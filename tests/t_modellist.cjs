// shared/modelList.ts — [최신 목록 불러오기]: 서비스별 목록 거르기 · 정렬 · diffModels · 새 모델 이름의 temperature 분류
const { loadShared: load } = require('./tsload.cjs')
const L = load('modelList.ts')
const G = load('gemini.ts')
const T = load('types.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('1. OpenAI — 대화 모델만')
const oa = { object: 'list', data: ['gpt-6.1-sol', 'gpt-6-luna', 'o3-mini', 'chatgpt-4o-latest', 'text-embedding-3-large', 'tts-1', 'whisper-1', 'dall-e-3', 'gpt-image-1', 'gpt-4o-audio-preview', 'gpt-realtime', 'gpt-4o-transcribe', 'omni-moderation-latest', 'gpt-4o-search-preview', 'davinci-002', 'gpt-6.1-sol'].map((id) => ({ id, object: 'model' })) }
const o = L.parseModelList('openai', oa)
ok(eq(o, ['gpt-6.1-sol', 'gpt-6-luna', 'chatgpt-4o-latest', 'o3-mini']), `거름 · 새것 먼저 · 중복 없음: ${o}`)

console.log('\n2. Gemini — generateContent 만, 임베딩 · imagen · veo · tts · aqa 제외')
const ge = { models: [
  { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/gemini-4-carbon', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
  { name: 'models/text-embedding-004', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/imagen-4.0-generate', supportedGenerationMethods: ['predict'] },
  { name: 'models/veo-3.0', supportedGenerationMethods: ['predictLongRunning'] },
  { name: 'models/aqa', supportedGenerationMethods: ['generateAnswer'] },
  { name: 'models/gemini-3.6-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }
] }
const g = L.parseModelList('gemini', ge)
ok(eq(g, ['gemini-4-carbon', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']), `거름 · 정렬: ${g}`)

console.log('\n3. Claude — 중단 · 폐기 제외')
const cl = { data: [
  { id: 'claude-fable-5-2', lifecycle: 'active' }, { id: 'claude-opus-5-5', lifecycle: 'active' },
  { id: 'claude-haiku-4-5-20251001', lifecycle: 'active' }, { id: 'claude-opus-4-1', lifecycle: 'deprecated' }, { id: 'claude-3-haiku', lifecycle: 'retired' }, { id: 'claude-sonnet-5' }
] }
const c = L.parseModelList('claude', cl)
ok(!c.includes('claude-opus-4-1') && !c.includes('claude-3-haiku') && c.includes('claude-sonnet-5') && c.includes('claude-haiku-4-5-20251001'), `deprecated · retired 제외: ${c}`)
ok(c[0] === 'claude-opus-5-5' || c[0] === 'claude-fable-5-2', '새것 먼저')

console.log('\n4. EXAONE · 이상한 입력')
ok(eq(L.parseModelList('exaone', { data: [{ id: 'k-exaone_v2.5' }, { id: 'exaone-embed' }] }), ['k-exaone_v2.5']), 'EXAONE data[].id')
ok(eq(L.parseModelList('openai', null), []) && eq(L.parseModelList('gemini', { models: 'x' }), []) && eq(L.parseModelList('claude', 5), []), '모양이 이상하면 빈 목록')

console.log('\n5. 정렬')
const s = ['gpt-5.6-luna', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-sol-2026-09-01', 'gpt-6-astra', 'gpt-5.6-terra'].sort(L.compareModelIds)
ok(s[0] === 'gpt-6.1-sol' && s.indexOf('gpt-6-sol') < s.indexOf('gpt-6-sol-2026-09-01') && s.indexOf('gpt-6-sol-2026-09-01') < s.indexOf('gpt-5.6-luna'), `버전 큰 것 먼저 · 날짜 꼬리는 뒤: ${s}`)

console.log('\n6. diffModels')
const d = L.diffModels(['gpt-6.2-sol', 'gpt-6.1-sol', 'gpt-6-luna'], ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.6-luna'])
ok(eq(d.added, ['gpt-6.2-sol']) && eq(d.missing, ['gpt-5.6-luna']), `added/missing: ${JSON.stringify(d)}`)

console.log('\n7. 요청 모양 · 새 모델 이름의 분류')
const r = L.listRequestFor('claude', ' K ')
ok(r.headers['x-api-key'] === 'K' && r.headers['anthropic-version'] === '2023-06-01' && r.url.startsWith('https://api.anthropic.com/v1/models'), 'Claude: 앱이 쓰는 머리글')
ok(L.listRequestFor('gemini', 'K').headers['x-goog-api-key'] === 'K' && L.listRequestFor('openai', 'K').headers.Authorization === 'Bearer K', 'Gemini · OpenAI 머리글')
ok(['gemini-4-hydrogen', 'gemini-4-argon', 'gemini-4-carbon', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'].every(G.isModernGemini) && !G.isModernGemini('gemini-3.1-pro-preview') && !G.isModernGemini('gemini-2.5-flash'), 'gemini-4-* 는 최신 계열(temperature 안 보냄), 3.1 · 2.5 는 아님')
ok(T.OPENAI_MODELS[0] === 'gpt-6.1-sol' && T.GEMINI_MODELS.includes('gemini-4-carbon') && T.CLAUDE_MODELS[0] === 'claude-fable-5-2', '기본 목록에 새 모델')
ok(T.OPENAI_MODELS.includes('gpt-6-astra') && T.OPENAI_MODELS.includes('gpt-6.1-terra'), 'gpt-6-astra · gpt-6.1-terra')

console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
process.exit(fails ? 1 : 0)
