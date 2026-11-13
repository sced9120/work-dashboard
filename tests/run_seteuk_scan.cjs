// 세특 작성실 — 스캔 · 사진에서 관찰 기록 가져오기. 화면이 하는 차례 그대로(ocr:run → 끊기면 ocr:continue → 표 → 명단과 맞추기)
// 빌드된 앱의 IPC 로. Gemini 는 가로채 가짜로 답한다(진짜 키를 쓰지 않는다). 이름은 지어낸 것
const path = require('path')
const fs = require('fs')
const { handlers, next, calls, USER_DATA } = global.__it
const { loadShared: load } = require('./tsload.cjs')
const S = load('seteuk.ts')
const T = load('mdtable.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

const log = []
let script = []
const enc = new TextEncoder()
function sse(events) {
  const all = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
  return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(all)); c.close() } }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
const textEvents = (text, finish) => [{ candidates: [{ content: { parts: [{ text }] } }] }, { candidates: [{ content: { parts: [{ text: '' }] }, finishReason: finish }] }]
global.fetch = async (url, opts = {}) => {
  const entry = { url: String(url), body: opts.body }
  log.push(entry)
  const step = script.shift()
  if (!step) throw new Error('예상 못 한 요청 ' + url)
  return step(entry)
}

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('seteuk:load'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'gemini', gemini_key: 'TEST-FAKE-KEY', openai_key: '', claude_key: '', exaone_key: '' })
  const roster = S.parseRoster('1\t1\t가나다\n1\t2\t라마바\n1\t3\t사아자').students

  const pdf = path.join(USER_DATA, '활동지.pdf')
  fs.writeFileSync(pdf, Buffer.from('%PDF-1.4\n% 가짜 PDF\n'))
  next.open.push([pdf])
  const files = await call('ocr:pick')

  console.log('1. 읽기 → 끊기면 이어 받기 → 명단과 맞추기')
  const md1 = ['> 학생마다 한 행으로 옮겼습니다.', '', '| 반 | 번호 | 이름 | 내용 |', '| --- | --- | --- | --- |', '| 1 | 1 | 가나다 | 기울기를 구간마다 비교함 |', '| 1 | 2 | 라마바 | 풀이를 고쳐 다시 설'].join('\n')
  const md2 = ['| 반 | 번호 | 이름 | 내용 |', '| --- | --- | --- | --- |', '| 1 | 2 | 라마바 | 풀이를 고쳐 다시 설명함 |', '|  | 3 |  | 질문을 정리해 옴 |', '|  |  | 없는이 | 명단에 없는 학생 |'].join('\n')
  script = [() => sse(textEvents(md1, 'MAX_TOKENS')), () => sse(textEvents(md2, 'STOP'))]
  const a1 = await call('ocr:run', { tab: 'seteuk', ids: files.map((f) => f.id), note: S.SETEUK_OCR_NOTE, model: '' })
  ok(a1.ok && a1.truncated, '첫 답은 길어서 끊김')
  const said = JSON.parse(log[0].body).contents[0].parts.map((p) => p.text || '').join('')
  ok(said.includes('출력해주세요') && said.includes('반 | 번호 | 이름 | 내용'), '세특용 요청(학생마다 한 행 · 반 | 번호 | 이름 | 내용)을 함께 보냄')
  ok(calls.sent.some((x) => x.ch === 'ocr:progress' && x.payload.tab === 'seteuk'), "진행 소식에 탭 이름 'seteuk'")
  const a2 = await call('ocr:continue', 'seteuk')
  ok(a2.ok && !a2.truncated, '이어 받음')
  const im = S.matchNotes(T.answersToTables([a1, a2]), roster)
  ok(im.hits.length === 3 && im.hits.find((h) => h.id === '1-2').text === '풀이를 고쳐 다시 설명함', `덜 받은 줄은 버리고 이어 받은 줄로: ${JSON.stringify(im.hits)}`)
  ok(im.hits.find((h) => h.id === '1-3').text === '질문을 정리해 옴' && im.misses.length === 1 && im.misses[0].label === '없는이', '번호만 있어도 맞춤 · 명단에 없는 줄은 따로')

  console.log('\n2. 관찰 기록에 넣기 — 이미 적힌 글 뒤에')
  await call('seteuk:roster', 'subject', roster)
  await call('seteuk:acts', [{ id: 'a1', name: '함수 탐구', rec: '과세특' }])
  await call('seteuk:rows', 'a1', { '1-1': { note: '수업 중 발표함', final: '다듬은 글' } })
  const before = (await call('seteuk:load')).rows.a1
  const patch = {}
  for (const h of im.hits) patch[h.id] = { note: S.mergeNote(before[h.id]?.note ?? '', h.text) }
  await call('seteuk:rows', 'a1', patch)
  const after = (await call('seteuk:load')).rows.a1
  ok(after['1-1'].note === '수업 중 발표함\n기울기를 구간마다 비교함' && after['1-1'].final === '다듬은 글' && after['1-3'].note === '질문을 정리해 옴', '적힌 글은 남기고 뒤에 붙임 · 최종본은 그대로')

  console.log('\n3. 끝나면 지우기 · 키 없음')
  await call('ocr:clear', 'seteuk')
  const a3 = await call('ocr:continue', 'seteuk')
  ok(!a3.ok, '지운 뒤에는 이어 받을 것이 없음')
  await call('local:save', { ...(await call('local:load')), gemini_key: '' })
  const a4 = await call('ocr:run', { tab: 'seteuk', ids: files.map((f) => f.id), note: S.SETEUK_OCR_NOTE, model: '' })
  ok(!a4.ok && /키/.test(a4.error), `읽을 키가 없으면 안내: ${a4.error}`)

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
