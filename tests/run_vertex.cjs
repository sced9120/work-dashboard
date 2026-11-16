// Gemini 를 Google Cloud(Vertex AI)로 (electron/main/vertex.ts · ai.ts) — 빌드된 앱의 IPC 로.
// 키는 이 시험이 만든 일회용 RSA 키뿐이고, 바깥 요청은 모두 가로채 가짜로 답한다(진짜 자격 증명 · 진짜 서버를 쓰지 않는다).
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { handlers, next, USER_DATA } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const log = []
let script = []
const enc = new TextEncoder()
function sse(lines) {
  const all = lines.join('')
  const pieces = []
  for (let i = 0; i < all.length; i += 23) pieces.push(all.slice(i, i + 23))
  return new Response(new ReadableStream({ start(c) { for (const p of pieces) c.enqueue(enc.encode(p)); c.close() } }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
const gemini = (text) => sse([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\r\n\r\n`, `data: ${JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] })}\r\n\r\n`])
const tokenOk = (t) => () => new Response(JSON.stringify({ access_token: t, expires_in: 3600, token_type: 'Bearer' }), { status: 200, headers: { 'content-type': 'application/json' } })
const errJson = (status, body) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
global.fetch = async (url, opts = {}) => {
  const entry = { url: String(url), method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body }
  log.push(entry)
  const step = script.shift()
  if (!step) throw new Error('예상 못 한 요청 ' + url)
  return await step(entry)
}
const tokenCount = () => log.filter((e) => e.url === TOKEN_URL).length
const lastBody = () => JSON.parse(log[log.length - 1].body)
const MODEL = { provider: 'gemini', model: 'gemini-3.6-flash' }
let q = 0
const chat = (text = '안녕') => call('ai:chatStream', { reqId: `v${++q}`, mode: 'free', jobTitle: '', instruction: '', history: [{ role: 'user', content: '먼저 한 말' }, { role: 'assistant', content: '네' }, { role: 'user', content: text }], model: MODEL })
const AI_GLOBAL = 'https://aiplatform.googleapis.com/v1/projects/fake-proj-1/locations/global/publishers/google/models/gemini-3.6-flash:streamGenerateContent?alt=sse'

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
const PEM_BODY = privateKey.split('\n').filter((l) => l && !l.startsWith('-----'))[2]
const EMAIL = 'orbit-test@fake-proj-1.iam.gserviceaccount.com'
const written = new Set()
const writeSa = (name, obj) => {
  const p = path.join(USER_DATA, name)
  written.add(p)
  fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj))
  return p
}
const goodSa = { type: 'service_account', project_id: 'fake-proj-1', private_key_id: 'fakekeyid1', private_key: privateKey, client_email: EMAIL, client_id: '1', token_uri: TOKEN_URL, auth_uri: 'https://accounts.google.com/o/oauth2/auth', universe_domain: 'googleapis.com' }

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('vertex:pickSa'); i++) await new Promise((r) => setTimeout(r, 50))
  ok(handlers.has('vertex:pickSa') && handlers.has('vertex:clearSa'), '서비스 계정 고르기 · 빼기 IPC 가 있음')
  const s0 = await call('local:load')
  await call('local:save', { ...s0, provider: 'gemini', gemini_mode: 'key', gemini_key: 'TEST-KEY', gemini_model: 'gemini-3.6-flash' })

  console.log('1. 잘못된 파일은 한국어 오류, 아무것도 저장하지 않음')
  const bad = [
    [writeSa('a.json', { type: 'authorized_user', client_id: 'x' }), 'service_account'],
    [writeSa('b.json', { type: 'service_account', client_email: EMAIL, project_id: 'p' }), '개인 키(private_key)가 없습니다'],
    [writeSa('c.json', { type: 'service_account', client_email: EMAIL, private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n', project_id: 'p' }), '개인 키'],
    [writeSa('d.json', { type: 'service_account', private_key: privateKey, project_id: 'p' }), 'client_email'],
    [writeSa('e.json', { type: 'service_account', client_email: EMAIL, private_key: privateKey }), 'project_id'],
    [writeSa('f.json', '이건 JSON 이 아님'), 'JSON']
  ]
  for (const [p, want] of bad) {
    next.open.push([p])
    const r = await call('vertex:pickSa')
    ok(r.ok === false && typeof r.error === 'string' && r.error.includes(want) && /[가-힣]/.test(r.error), `${path.basename(p)}: ${r.error}`)
  }
  next.open.length = 0
  const sBad = await call('local:load')
  ok(sBad.vertex_sa_set === false && !sBad.vertex_email && !sBad.vertex_project, '오류일 때 아무것도 저장되지 않음')
  const cancel = await call('vertex:pickSa')
  ok(cancel.ok === false && cancel.canceled === true, '창을 닫으면 취소')

  console.log('\n2. 서비스 계정 JSON 고르기 — 비밀 키는 화면으로 가지 않음')
  const saPath = writeSa('내려받은 키.json', goodSa)
  next.open.push([saPath])
  const picked = await call('vertex:pickSa')
  ok(picked.ok === true && picked.project === 'fake-proj-1' && picked.email === EMAIL, `ok · 프로젝트 · 이메일: ${picked.project} ${picked.email}`)
  ok(!JSON.stringify(picked).includes('PRIVATE KEY') && !JSON.stringify(picked).includes(PEM_BODY), '고른 결과에 비밀 키 없음')
  const s1 = await call('local:load')
  const dump = JSON.stringify(s1)
  ok(!dump.includes('PRIVATE KEY') && !dump.includes(PEM_BODY) && !dump.includes('fakekeyid1') && !('vertex_sa' in s1), 'local:load 결과에 비밀 키 · 키 번호 없음')
  ok(s1.vertex_sa_set === true && s1.vertex_project === 'fake-proj-1' && s1.vertex_email === EMAIL && s1.vertex_location === 'global', '표시용 값: vertex_sa_set · 프로젝트 · 이메일 · 위치(global)')
  const leaked = walk(USER_DATA).filter((f) => !written.has(f) && fs.readFileSync(f).includes('BEGIN PRIVATE KEY') && path.basename(f) !== 'settings.json')
  ok(leaked.length === 0, '원본 파일을 어디에도 복사하지 않음')
  ok(!fs.readFileSync(path.join(USER_DATA, 'settings.json'), 'utf8').includes(saPath) && !fs.readFileSync(path.join(USER_DATA, 'settings.json'), 'utf8').includes('내려받은 키'), '원본 파일 경로를 기억하지 않음')

  console.log('\n3. 화면에서 저장해도 비밀 키가 지워지지 않음 · 화면이 보낸 값으로 바뀌지 않음')
  await call('local:save', { ...s1, provider: 'gemini', gemini_mode: 'vertex', vertex_sa: 'HACK', gemini_model: 'gemini-3.6-flash' })
  const s2 = await call('local:load')
  ok(s2.vertex_sa_set === true && s2.gemini_mode === 'vertex' && s2.vertex_project === 'fake-proj-1', '화면이 보낸 저장 뒤에도 서비스 계정이 그대로')

  console.log('\n4. Vertex — 토큰 받기(JWT) → 호출')
  script = [tokenOk('ya29.first'), () => gemini('안녕하세요 Vertex')]
  const r1 = await chat()
  ok(r1.ok && r1.answer === '안녕하세요 Vertex', `답을 받음: ${r1.answer || r1.error}`)
  ok(log.length === 2, `요청은 토큰 1번 + 호출 1번 (${log.length})`)
  const t = log[0]
  ok(t.method === 'POST' && t.url === TOKEN_URL && /application\/x-www-form-urlencoded/.test(t.headers['Content-Type'] || t.headers['content-type'] || ''), '첫 요청: 토큰 주소로 POST (form)')
  const form = new URLSearchParams(t.body)
  ok(form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'grant_type')
  const [h, c, sig] = (form.get('assertion') || '').split('.')
  const head = JSON.parse(Buffer.from(h || '', 'base64url').toString())
  const claims = JSON.parse(Buffer.from(c || '', 'base64url').toString())
  ok(head.alg === 'RS256' && head.typ === 'JWT' && head.kid === 'fakekeyid1', `JWT 머리: ${JSON.stringify(head)}`)
  const now = Math.floor(Date.now() / 1000)
  ok(claims.iss === EMAIL && claims.scope === 'https://www.googleapis.com/auth/cloud-platform' && claims.aud === TOKEN_URL && claims.exp - claims.iat === 3600 && Math.abs(claims.iat - now) < 30, `JWT 내용: iss · scope · aud · exp=iat+3600`)
  ok(crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig || '', 'base64url')), 'JWT 서명이 공개 키로 맞음')
  const a = log[1]
  ok(a.method === 'POST' && a.url === AI_GLOBAL, `호출 주소(global, 스트림): ${a.url}`)
  ok(a.headers.Authorization === 'Bearer ya29.first' && !('x-goog-api-key' in a.headers), 'Authorization: Bearer 토큰 (API 키 머리글 없음)')
  const b1 = lastBody()
  ok(b1.contents.length === 3 && b1.contents.every((x) => x.role === 'user' || x.role === 'model') && b1.contents[1].role === 'model', `모든 contents 에 role: ${b1.contents.map((x) => x.role).join(',')}`)

  console.log('\n5. 받아 둔 토큰을 다시 씀')
  script = [() => gemini('두 번째')]
  const n0 = log.length
  const r2 = await chat('또')
  ok(r2.ok && log.length === n0 + 1 && log[log.length - 1].url === AI_GLOBAL && log[log.length - 1].headers.Authorization === 'Bearer ya29.first', '토큰 요청 없이 호출만')

  console.log('\n6. 401 이면 토큰을 새로 받아 한 번만 다시')
  script = [errJson(401, { error: { code: 401, message: 'expired', status: 'UNAUTHENTICATED' } }), tokenOk('ya29.second'), () => gemini('다시 됐어요')]
  const n1 = log.length
  const r3 = await chat('401')
  ok(r3.ok && r3.answer === '다시 됐어요' && log.length === n1 + 3 && log[n1 + 1].url === TOKEN_URL && log[n1 + 2].headers.Authorization === 'Bearer ya29.second', '401 → 토큰 새로 → 다시 호출')
  script = [errJson(401, { error: { code: 401, status: 'UNAUTHENTICATED' } }), tokenOk('ya29.third'), errJson(401, { error: { code: 401, status: 'UNAUTHENTICATED' } })]
  const n2 = log.length
  const r4 = await chat('계속 401')
  ok(!r4.ok && log.length === n2 + 3 && r4.error.includes('서비스 계정 키가 만료') && r4.error.includes('PC 시계'), `두 번째도 401 이면 멈추고 안내: ${r4.error}`)

  console.log('\n7. 오류 한국어 안내')
  const cases = [
    [403, { error: { code: 403, message: 'Vertex AI API has not been used in project fake-proj-1 before or it is disabled.', status: 'PERMISSION_DENIED', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED', domain: 'googleapis.com' }] } }, 'aiplatform.googleapis.com'],
    [403, { error: { code: 403, message: "Permission 'aiplatform.endpoints.predict' denied", status: 'PERMISSION_DENIED' } }, 'roles/aiplatform.user'],
    [404, { error: { code: 404, message: 'Publisher Model was not found', status: 'NOT_FOUND' } }, '위치'],
    [429, { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }, '할당량 초과']
  ]
  for (const [st, body, want] of cases) {
    script = [errJson(st, body)]
    const r = await chat('오류')
    ok(!r.ok && r.error.includes(want) && !r.error.includes('API 키가 올바르지'), `${st}: ${r.error.slice(0, 80)}`)
  }
  script = [errJson(403, cases[0][1])]
  const rd = await chat('오류')
  ok(rd.error.includes('사용 설정'), '사용 설정(SERVICE_DISABLED) 안내')

  console.log('\n8. 위치 · 토큰 만료 · 동시에 부르기')
  await call('local:save', { ...(await call('local:load')), vertex_location: 'asia-northeast3' })
  script = [() => gemini('서울')]
  await chat('리전')
  ok(log[log.length - 1].url === 'https://asia-northeast3-aiplatform.googleapis.com/v1/projects/fake-proj-1/locations/asia-northeast3/publishers/google/models/gemini-3.6-flash:streamGenerateContent?alt=sse', '리전 주소')
  await call('local:save', { ...(await call('local:load')), vertex_location: 'global' })
  const realNow = Date.now
  Date.now = () => realNow() + 56 * 60 * 1000
  script = [tokenOk('ya29.fresh'), () => gemini('만료 전에 새로')]
  const n3 = log.length
  await chat('만료')
  Date.now = realNow
  ok(log.length === n3 + 2 && log[n3].url === TOKEN_URL && log[n3 + 1].headers.Authorization === 'Bearer ya29.fresh', '만료 5분 전이면 토큰을 새로 받음')
  // 서비스 계정을 다시 고르면 받아 둔 토큰을 버림 → 동시에 두 번 불러도 토큰 요청은 한 번
  next.open.push([saPath])
  await call('vertex:pickSa')
  script = [async () => { await new Promise((r) => setTimeout(r, 60)); return tokenOk('ya29.one')() }, () => gemini('A'), () => gemini('B')]
  const n4 = log.length
  const both = await Promise.all([chat('동시1'), chat('동시2')])
  const added = log.slice(n4)
  ok(both.every((x) => x.ok) && added.filter((e) => e.url === TOKEN_URL).length === 1 && added.length === 3, `동시에 둘 → 토큰 요청 1번 (요청 ${added.length}개)`)

  console.log('\n9. 연결 확인(ai:test)')
  script = [() => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '연결 확인' }] } }] }), { status: 200 })]
  const n5 = log.length
  const tst = await call('ai:test')
  const tb = lastBody()
  ok(tst.ok && tb.contents[0].parts[0].text === '연결 확인이라고만 답해 줘.' && log[n5].url === 'https://aiplatform.googleapis.com/v1/projects/fake-proj-1/locations/global/publishers/google/models/gemini-3.6-flash:generateContent' && !('responseMimeType' in (tb.generationConfig || {})), `연결 확인: ${tst.message}`)
  script = [errJson(403, cases[1][1])]
  const tst2 = await call('ai:test')
  ok(!tst2.ok && tst2.message.includes('roles/aiplatform.user'), '연결 확인 실패는 안내 말로')

  console.log('\n10. Express')
  await call('local:save', { ...(await call('local:load')), gemini_mode: 'express', vertex_express_key: 'EXPRESS-FAKE-KEY' })
  const s3 = await call('local:load')
  ok(!JSON.stringify(s3).includes('EXPRESS-FAKE-KEY') && s3.vertex_express_key_set === true, 'Express 키도 화면으로 가지 않음(표시만)')
  script = [() => gemini('익스프레스')]
  const n6 = log.length
  const re = await chat('express')
  ok(re.ok && log.length === n6 + 1 && log[n6].url === 'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.6-flash:streamGenerateContent?alt=sse' && log[n6].headers['x-goog-api-key'] === 'EXPRESS-FAKE-KEY' && !('Authorization' in log[n6].headers), 'Express: 주소 + x-goog-api-key (토큰 요청 없음)')
  await call('local:save', { ...s3, gemini_model: 'gemini-3.6-flash' })
  script = [() => gemini('여전히')]
  const re2 = await chat('express2')
  ok(re2.ok && log[log.length - 1].headers['x-goog-api-key'] === 'EXPRESS-FAKE-KEY', '화면이 다시 저장해도 Express 키가 남음')
  script = [errJson(403, { error: { code: 403, status: 'PERMISSION_DENIED' } })]
  const re3 = await chat('express3')
  ok(!re3.ok && re3.error.includes('Express'), `Express 오류 안내: ${re3.error.slice(0, 60)}`)
  await call('local:save', { ...(await call('local:load')), vertex_express_key: '' })
  ok((await call('local:load')).vertex_express_key_set === false, '빈 값으로 저장하면 지워짐')
  const none = await chat('키 없음')
  ok(!none.ok && none.error.includes('Express'), `키가 없으면 안내: ${none.error.slice(0, 50)}`)

  console.log('\n11. API 키 방식은 그대로')
  await call('local:save', { ...(await call('local:load')), gemini_mode: 'key' })
  script = [() => gemini('키 방식')]
  const n7 = log.length
  const rk = await chat('key')
  ok(rk.ok && log.length === n7 + 1 && log[n7].url === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse' && log[n7].headers['x-goog-api-key'] === 'TEST-KEY' && !('Authorization' in log[n7].headers), 'generativelanguage 주소 + x-goog-api-key')
  script = [errJson(403, { error: { code: 403, status: 'PERMISSION_DENIED' } })]
  const rk2 = await chat('key403')
  ok(!rk2.ok && rk2.error.includes('API 키가 올바르지 않거나 권한이 없습니다'), '키 방식의 오류 말은 옛 그대로')

  console.log('\n12. 서비스 계정 빼기')
  await call('local:save', { ...(await call('local:load')), gemini_mode: 'vertex' })
  const cl = await call('vertex:clearSa')
  const s4 = await call('local:load')
  ok(cl.ok && s4.vertex_sa_set === false && !s4.vertex_email, '빼면 지워짐')
  const nc = log.length
  const rc = await chat('빼고 호출')
  ok(!rc.ok && rc.error.includes('Vertex AI') && log.length === nc, `서비스 계정이 없으면 요청하지 않고 안내: ${rc.error.slice(0, 50)}`)

  console.log(fails ? `\n${fails}개 실패` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => {
  console.error('✗ 예외', e)
  process.exit(1)
})
