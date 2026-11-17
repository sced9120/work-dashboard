// 업무 도우미 자동 모델 (GPT 자동 · Gemini 자동) — 빌드된 앱의 IPC 로. AI 는 가로채 가짜로 답한다(진짜 키를 쓰지 않는다). 이름은 지어낸 것
const path = require('path')
const { handlers } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

const log = []
let script = []
const enc = new TextEncoder()
function sse(lines) {
  const all = lines.join('')
  const pieces = []
  for (let i = 0; i < all.length; i += 23) pieces.push(all.slice(i, i + 23))
  return new Response(new ReadableStream({ start(c) { for (const p of pieces) c.enqueue(enc.encode(p)); c.close() } }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
const chunks = (text, n = 7) => { const out = []; for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n)); return out }
const gemini = (text) => sse([...chunks(text).map((t) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\r\n\r\n`), `data: ${JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' } ] })}\r\n\r\n`])
const openai = (text) => sse([...chunks(text).map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`), `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`, 'data: [DONE]\n\n'])
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const routerSays = (text) => () => json({ choices: [{ message: { role: 'assistant', content: text } }] })
global.fetch = async (url, opts = {}) => {
  log.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null, signal: opts.signal })
  const step = script.shift()
  if (!step) throw new Error('예상 못 한 요청 ' + url)
  // 끊기(signal)를 알아듣는 가짜 fetch — 라우터 시간 초과를 시험하려고
  return new Promise((resolve, reject) => {
    const sig = opts.signal
    if (sig) {
      const stop = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      if (sig.aborted) return stop()
      sig.addEventListener('abort', stop, { once: true })
    }
    Promise.resolve(step()).then(resolve, reject)
  })
}
const last = () => log[log.length - 1]
const chat = (text, model, extra = {}) => call('ai:chatStream', { reqId: 'r' + Math.random().toString(36).slice(2, 8), mode: 'free', jobTitle: '', instruction: '', history: [{ role: 'user', content: text }], model, ...extra })
const GPT = { provider: 'openai', model: 'gpt-auto' }
const GEM = { provider: 'gemini', model: 'gemini-auto' }

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('ai:chatStream'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'openai', openai_key: 'TEST-OPENAI', gemini_key: 'TEST-GEMINI', claude_key: '', exaone_key: '', openai_model: 'gpt-6.1-sol', gemini_model: 'gemini-3.6-flash' })

  console.log('1. GPT 자동 — 쉬운 질문은 라우터 없이 luna · low')
  script = [() => openai('안녕하세요, 선생님!')]
  let r = await chat('안녕하세요', GPT)
  ok(log.length === 1 && last().url === 'https://api.openai.com/v1/chat/completions', '요청은 한 번뿐 (라우터를 부르지 않음)')
  ok(last().body.model === 'gpt-6-luna' && last().body.reasoning_effort === 'low' && last().body.stream === true, `모델 ${last().body.model} · reasoning_effort ${last().body.reasoning_effort}`)
  ok(r.ok && r.answer.startsWith('안녕하세요') && r.routed && r.routed.model === 'gpt-6-luna' && r.routed.label === '자동 → gpt-6-luna · 쉬운 질문', `답과 함께 이름표: ${r.routed && r.routed.label}`)

  console.log('\n2. 업무 문서 · 어려운 질문은 라우터 없이 sol')
  log.length = 0
  script = [() => openai('초안입니다.')]
  r = await chat('3학년 수행평가 루브릭 초안 만들어 줘', GPT)
  ok(log.length === 1 && last().body.model === 'gpt-6.1-sol' && last().body.reasoning_effort === 'medium' && r.routed.label === '자동 → gpt-6.1-sol · 업무 문서', '업무 문서 → sol · medium')
  ok(!last().body.messages[0].content.includes('# 2026 학교생활기록부 기재'), '학생부 이야기가 아니면 기재 지식을 붙이지 않음')
  log.length = 0
  script = [() => openai('세특 초안입니다.')]
  r = await chat('세특 초안 써 줘', GPT)
  ok(last().body.messages[0].content.includes('# 2026 학교생활기록부 기재') && last().body.model === 'gpt-6.1-sol', '세특 이야기면 2026 기재 지식을 붙임 · sol')
  log.length = 0
  script = [() => openai('증명입니다.')]
  r = await chat('이 정리를 엄밀하게 증명해 줘', GPT)
  ok(log.length === 1 && last().body.model === 'gpt-6.1-sol' && last().body.reasoning_effort === 'high' && r.routed.label === '자동 → gpt-6.1-sol · 어려운 추론', '어려움 → sol · high')

  console.log('\n3. 애매하면 라우터(gpt-6-luna)에게 한 번 물음')
  const vague = '우리 반 학생들이 요즘 쉬는 시간에 복도에서 자꾸 뛰어다니는데 어떻게 지도하면 좋을지 모르겠어요. 야단치면 더 심해지는 것 같고 조용히 타이르면 듣지 않아요. 선생님들은 보통 어떻게 하시는지, 그리고 학부모께는 어떻게 말씀드리면 좋을지도 함께 알려 주세요.'
  log.length = 0
  script = [routerSays('{"tier":"cheap","effort":"medium","reason":"일반 상담"}'), () => openai('이렇게 해 보세요.')]
  r = await chat(vague, GPT)
  ok(log.length === 2 && log[0].body.model === 'gpt-6-luna' && !log[0].body.stream && log[0].body.messages[0].content.includes('당신은 라우터입니다') && log[0].body.messages[0].content.includes('답하지 말고'), '첫 요청은 라우터(luna · 지시문 포함 · 스트리밍 아님)')
  ok(log[0].body.messages[1].content.includes('[질문]') && log[0].body.messages[1].content.includes('복도에서') && log[0].body.response_format.type === 'json_object' && log[0].body.reasoning_effort === 'low' && !('max_completion_tokens' in log[0].body), '질문을 싣고 JSON 모드 · 생각 low · 한도 없음(생각이 한도를 먹어 빈 답이 되지 않게)')
  ok(log[1].body.model === 'gpt-6-luna' && log[1].body.reasoning_effort === 'medium' && log[1].body.stream === true && r.routed.label === '자동 → gpt-6-luna · 일반 상담', '둘째 요청이 답 — 라우터가 고른 모델 · 강도')
  ok(!JSON.stringify(log[0].body).includes('TEST-OPENAI') && log[0].body.messages.length === 2, '라우터에는 키 · 다른 글을 싣지 않음')

  log.length = 0
  script = [routerSays('{"tier":"expensive","effort":"high","reason":"여러 조건"}'), () => openai('꼼꼼히 봤습니다.')]
  r = await chat(vague, GPT)
  ok(log[1].body.model === 'gpt-6.1-sol' && log[1].body.reasoning_effort === 'high' && r.routed.label === '자동 → gpt-6.1-sol · 여러 조건', '라우터가 expensive · high 라 하면 sol · high')

  console.log('\n4. 라우터가 실패하면 sol · medium · 기본값')
  for (const [name, step] of [['이상한 글', routerSays('잘 모르겠어요')], ['정해진 값 밖', routerSays('{"tier":"standard","effort":"low","reason":"x"}')], ['HTTP 오류', () => json({ error: { message: 'boom' } }, 500)]]) {
    log.length = 0
    script = [step, () => openai('답')]
    r = await chat(vague, GPT)
    ok(log.length === 2 && log[1].body.model === 'gpt-6.1-sol' && log[1].body.reasoning_effort === 'medium' && r.ok && r.routed.label === '자동 → gpt-6.1-sol · 기본값', `${name} → ${r.routed && r.routed.label}`)
  }
  log.length = 0
  script = [() => new Promise(() => {}), () => openai('답')]
  const t0 = Date.now()
  r = await chat(vague, GPT)
  ok(Date.now() - t0 < 9000 && log[0].signal && log[0].signal.aborted && log[1].body.model === 'gpt-6.1-sol' && r.routed.label.endsWith('기본값'), `응답이 없으면 6초쯤 뒤 끊고 기본값 (${Date.now() - t0}ms)`)

  console.log('\n5. 이어 묻기 — 짧은 질문은 앞 질문을 이어받음')
  log.length = 0
  script = [() => openai('이어서 씁니다.')]
  r = await call('ai:chatStream', { reqId: 'f1', mode: 'free', jobTitle: '', instruction: '', model: GPT, history: [{ role: 'user', content: '이 정리를 엄밀하게 증명해 줘' }, { role: 'assistant', content: '증명 1단계…' }, { role: 'user', content: '계속' }] })
  ok(log.length === 1 && last().body.model === 'gpt-6.1-sol' && last().body.reasoning_effort === 'high', '"계속" → 앞의 어려운 질문처럼 sol · high')
  log.length = 0
  script = [() => openai('네')]
  r = await call('ai:chatStream', { reqId: 'f2', mode: 'free', jobTitle: '', instruction: '', model: GPT, history: [{ role: 'user', content: '안녕' }, { role: 'assistant', content: '안녕하세요' }, { role: 'user', content: '고마워' }] })
  ok(last().body.model === 'gpt-6-luna', '앞이 쉬우면 그대로 luna')

  console.log('\n6. 첨부가 있으면 쉬운 질문으로 단정하지 않음')
  log.length = 0
  script = [routerSays('{"tier":"cheap","effort":"low","reason":"읽기"}'), () => openai('읽었습니다.')]
  r = await call('ai:chatStream', { reqId: 'a1', mode: 'free', jobTitle: '', instruction: '', model: GPT, history: [{ role: 'user', content: '안녕', attachments: [{ kind: 'text', name: '가나다 메모.txt', text: '가나다 학생 메모' }] }] })
  ok(log.length === 2 && log[0].body.model === 'gpt-6-luna' && log[0].body.messages[1].content.includes('문서 1개') && !log[0].body.messages[1].content.includes('가나다'), '라우터에는 첨부 개수만 (파일 이름 · 내용은 안 보냄)')

  console.log('\n7. Gemini 자동 — 규칙만, 라우터 없음')
  log.length = 0
  script = [() => gemini('증명을 시작합니다.')]
  r = await chat('이 정리를 엄밀하게 증명해 줘', GEM)
  ok(log.length === 1 && last().url.includes('/models/gemini-3.8-flash:streamGenerateContent') && last().body.generationConfig.thinkingConfig.thinkingLevel === 'high', '어려움 → gemini-3.8-flash · thinkingLevel high')
  ok(r.ok && r.routed.label === '자동 → gemini-3.8-flash · 어려움' && !('includeThoughts' in last().body.generationConfig.thinkingConfig) && !('temperature' in last().body.generationConfig), `이름표 ${r.routed && r.routed.label} · 생각 요약은 안 켬`)
  log.length = 0
  script = [() => gemini('안녕하세요!')]
  r = await chat('안녕', GEM)
  ok(last().url.includes('gemini-3.5-flash-lite') && last().body.generationConfig.thinkingConfig.thinkingLevel === 'low' && r.routed.label === '자동 → gemini-3.5-flash-lite · 쉬움', '쉬움 → flash-lite · low')
  log.length = 0
  script = [() => gemini('정리했습니다.')]
  r = await chat('이 두 자료를 비교하고 장단점을 정리해 줘', GEM)
  ok(last().url.includes('gemini-3.6-flash:') && last().body.generationConfig.thinkingConfig.thinkingLevel === 'medium' && r.routed.label === '자동 → gemini-3.6-flash · 보통', '보통 → 3.6-flash · medium')

  console.log('\n8. 생각 설정을 거절하면 빼고 다시 보내고, 이후에는 안 보냄')
  log.length = 0
  script = [() => json({ error: { message: 'Thinking level is not supported for this model.' } }, 400), () => gemini('다시 보냈습니다.')]
  r = await chat('이 정리를 엄밀하게 증명해 줘', GEM)
  ok(log.length === 2 && log[0].body.generationConfig.thinkingConfig && !log[1].body.generationConfig.thinkingConfig && r.ok && r.answer.includes('다시'), 'Gemini 400(thinking) → thinkingConfig 빼고 한 번 더')
  log.length = 0
  script = [() => gemini('바로 보냅니다.')]
  r = await chat('이 정리를 엄밀하게 증명해 줘', GEM)
  ok(log.length === 1 && !log[0].body.generationConfig.thinkingConfig && r.ok, '그 모델에는 이후 요청부터 안 보냄 (기억)')

  log.length = 0
  script = [() => json({ error: { message: "Unsupported parameter: 'reasoning_effort' is not supported with this model." } }, 400), () => openai('다시 보냈습니다.')]
  r = await chat('이 정리를 엄밀하게 증명해 줘', GPT)
  ok(log.length === 2 && log[0].body.reasoning_effort === 'high' && !('reasoning_effort' in log[1].body) && log[1].body.model === 'gpt-6.1-sol' && r.ok && r.answer.includes('다시'), 'OpenAI 400(reasoning_effort) → 빼고 한 번 더')
  log.length = 0
  script = [() => openai('바로 보냅니다.')]
  r = await chat('이 정리를 엄밀하게 증명해 줘', GPT)
  ok(log.length === 1 && !('reasoning_effort' in log[0].body) && r.ok, '그 모델에는 이후 요청부터 안 보냄 (기억)')
  log.length = 0
  script = [() => json({ error: { message: 'something else' } }, 400)]
  r = await chat('안녕', GPT)
  ok(!r.ok && /400/.test(r.error) && log.length === 1, '다른 까닭의 400 은 다시 보내지 않고 오류로')
  log.length = 0
  script = [() => openai('luna 도 한 번은 보냄')]
  await chat('안녕', GPT)
  ok(log[0].body.reasoning_effort === 'low', '기억은 모델별 — luna 에는 그대로 보냄')

  console.log('\n9. 일반 모델은 그대로 — 이름표 · 생각 설정 없음')
  log.length = 0
  script = [() => openai('그냥 답')]
  r = await chat('안녕', { provider: 'openai', model: 'gpt-6-luna' })
  ok(!('reasoning_effort' in last().body) && !r.routed, '자동이 아니면 reasoning_effort 도 이름표도 없음')
  log.length = 0
  script = [() => gemini('그냥 답')]
  r = await chat('안녕', { provider: 'gemini', model: 'gemini-3.8-flash' })
  ok(!last().body.generationConfig.thinkingConfig && !r.routed, 'Gemini 도 마찬가지')

  console.log('\n10. 대화 밖에서는 자동 이름이 HTTP 에 닿지 않음')
  const names = () => log.map((x) => (x.body && x.body.model) || x.url).join(' | ')
  log.length = 0
  script = [routerSays('{"todos":[]}')]
  await call('msg:extract', '내일 회의 있어요', GPT)
  ok(log.length === 1 && log[0].body.model === 'gpt-6.1-sol' && !names().includes('auto'), `askJson + gpt-auto → ${log[0].body.model} (설정의 기본 모델)`)
  log.length = 0
  script = [() => json({ candidates: [{ content: { parts: [{ text: '{"todos":[]}' }] } }] })]
  await call('msg:extract', '내일 회의 있어요', GEM)
  ok(log.length === 1 && log[0].url.includes('/models/gemini-3.6-flash:generateContent') && !log[0].url.includes('auto') && !('temperature' in log[0].body.generationConfig), `askJson + gemini-auto → ${log[0].url.split('/models/')[1].split(':')[0]}`)
  await call('seteuk:roster', 'subject', [{ id: '1-1', cls: '1', no: '1', name: '가나다' }])
  await call('seteuk:acts', [{ id: 'a1', name: '함수 탐구', rec: '과세특', bytes: 1500 }])
  await call('seteuk:rows', 'a1', { '1-1': { note: '라마바와 함께 그래프 기울기를 비교함', final: '일차함수 모둠 발표에서 가나다와 함께 그래프의 기울기를 비교하여 변화율을 설명함. 질문에 답함.' } })
  log.length = 0
  script = [routerSays('## 잘 드러난 것\n- 의견입니다')]
  const adv = await call('seteuk:advice', 'a1', '1-1', GPT)
  ok(adv.ok && log.length === 1 && log[0].body.model === 'gpt-6.1-sol' && !('reasoning_effort' in log[0].body) && !names().includes('auto'), `askSeteuk + gpt-auto → ${log[0].body.model}`)
  // 설정의 기본 모델이 다른 것이면 그것으로
  await call('local:save', { ...(await call('local:load')), openai_model: 'gpt-6-luna' })
  log.length = 0
  script = [routerSays('{"todos":[]}')]
  await call('msg:extract', '내일 회의 있어요', GPT)
  ok(log[0].body.model === 'gpt-6-luna', '설정의 기본 모델이 luna 면 luna')

  console.log('\n11. 설정은 자동 이름을 기본 모델로 받지 않음 · 대화의 모델 선택은 저장됨')
  const cur = await call('local:load')
  await call('local:save', { ...cur, openai_model: 'gpt-auto', gemini_model: 'gemini-auto', feature_models: { chat: GPT } })
  const back = await call('local:load')
  ok(back.openai_model === 'gpt-6.1-sol' && back.gemini_model === 'gemini-3.8-flash', `기본 모델: ${back.openai_model} · ${back.gemini_model}`)
  ok(back.feature_models.chat && back.feature_models.chat.model === 'gpt-auto', '업무 도우미에 고른 자동은 저장됨')
  log.length = 0
  script = [routerSays('{"todos":[]}')]
  await call('msg:extract', '내일 회의 있어요')
  ok(log.length === 1 && log[0].body.model !== 'gpt-auto', '다른 기능은 (모델 안 골라도) 자동 이름이 닿지 않음')

  console.log('\n12. 키가 없으면')
  await call('local:save', { ...(await call('local:load')), provider: 'gemini', openai_key: '', gemini_key: '', claude_key: '', exaone_key: '' })
  log.length = 0
  r = await chat('안녕', GPT)
  ok(!r.ok && /키/.test(r.error) && log.length === 0, '키가 없으면 보내지 않고 안내')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
