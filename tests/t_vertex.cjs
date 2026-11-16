// shared/gemini.ts — Gemini 를 Google Cloud(Vertex AI)로 쓰는 연결: "쓸 수 있나"(geminiReady) · 주소 모양
const { loadShared: load } = require('./tsload.cjs')
const G = load('gemini.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

console.log('1. geminiReady — 연결 방식마다 보는 칸이 다르다')
ok(G.geminiReady({ gemini_key: 'AIza-x' }) === true, '방식을 안 적은 옛 설정 + API 키 → 쓸 수 있음(기본은 key)')
ok(G.geminiReady({ gemini_mode: 'key', gemini_key: '  ' }) === false, 'key: 공백만이면 못 씀')
ok(G.geminiReady({ gemini_mode: 'key', gemini_key: '', vertex_sa_set: true, vertex_project: 'p' }) === false, 'key: Vertex 칸이 차 있어도 소용없음')
ok(G.geminiReady({ gemini_mode: 'vertex', vertex_sa_set: true, vertex_project: 'my-proj' }) === true, 'vertex: 서비스 계정 + 프로젝트 → 쓸 수 있음')
ok(G.geminiReady({ gemini_mode: 'vertex', vertex_sa_set: true, vertex_project: '  ' }) === false, 'vertex: 프로젝트가 비면 못 씀')
ok(G.geminiReady({ gemini_mode: 'vertex', vertex_sa_set: false, vertex_project: 'p', gemini_key: 'AIza-x' }) === false, 'vertex: 서비스 계정이 없으면 못 씀(API 키가 있어도)')
ok(G.geminiReady({ gemini_mode: 'express', vertex_express_key_set: true }) === true, 'express: 키가 있으면 쓸 수 있음')
ok(G.geminiReady({ gemini_mode: 'express', vertex_express_key_set: false, gemini_key: 'AIza-x' }) === false, 'express: 키가 없으면 못 씀')
ok(G.geminiModeOf({ gemini_mode: 'bogus' }) === 'key' && G.geminiModeOf(undefined) === 'key' && G.geminiModeOf({ gemini_mode: 'vertex' }) === 'vertex', '모르는 방식은 key')

console.log('\n2. 주소 모양')
const P = { project: 'my-proj', location: 'global' }
ok(G.geminiUrl('key', {}, 'gemini-3.6-flash', 'generateContent') === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent', 'key: 지금까지와 같은 주소')
ok(G.geminiUrl('key', {}, 'gemini-3.6-flash', 'streamGenerateContent') === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse', 'key: 스트림은 ?alt=sse')
ok(G.geminiUrl('vertex', P, 'gemini-3.6-flash', 'generateContent') === 'https://aiplatform.googleapis.com/v1/projects/my-proj/locations/global/publishers/google/models/gemini-3.6-flash:generateContent', 'vertex global')
ok(G.geminiUrl('vertex', { project: 'my-proj', location: '' }, 'm', 'generateContent').includes('/locations/global/'), 'vertex: 위치가 비면 global')
ok(G.geminiUrl('vertex', { project: 'my-proj', location: 'asia-northeast3' }, 'gemini-3.6-flash', 'streamGenerateContent') === 'https://asia-northeast3-aiplatform.googleapis.com/v1/projects/my-proj/locations/asia-northeast3/publishers/google/models/gemini-3.6-flash:streamGenerateContent?alt=sse', 'vertex 리전 + 스트림')
ok(G.geminiUrl('vertex', { project: 'my-proj', location: 'evil.com/x' }, 'm', 'generateContent').startsWith('https://aiplatform.googleapis.com/'), 'vertex: 이상한 위치는 global 로(주소를 바꾸지 못함)')
ok(G.geminiUrl('vertex', { project: 'a/b', location: 'global' }, 'm', 'generateContent').includes('/projects/a%2Fb/'), 'vertex: 프로젝트 ID 는 주소용으로 인코딩')
ok(G.geminiUrl('express', {}, 'gemini-3.6-flash', 'generateContent') === 'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.6-flash:generateContent', 'express')
ok(G.geminiUrl('express', {}, 'gemini-3.6-flash', 'streamGenerateContent').endsWith(':streamGenerateContent?alt=sse'), 'express 스트림')
ok(G.vertexLocationOf('  Asia-Northeast3 ') === 'asia-northeast3' && G.vertexLocationOf(undefined) === 'global', '위치 다듬기')

console.log(fails ? `\n${fails}개 실패` : '\n모두 통과')
process.exit(fails ? 1 : 0)
