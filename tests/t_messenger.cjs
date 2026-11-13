// shared/attendance.ts · shared/messenger.ts · shared/relay.ts — 명단 읽기 · 출결 합치기 · AI 답 읽기 · 폰 우편함 스크립트
const { loadShared: load } = require('./tsload.cjs')
const A = load('attendance.ts')
const M = load('messenger.ts')
const R = load('relay.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

// 명단 (이름은 지어낸 것)
const ro = A.parseRoster('1 가나다\n2. 라마바\n3번 사아자\n20404\t차카타\n\n파하가\n2 중복이')
ok(ro.length === 5, `다섯 명 (${ro.map((s) => s.no + s.name).join(',')})`)
ok(ro.find((s) => s.no === 4)?.name === '차카타', '학번 20404 → 4번 · 탭 나눔')
ok(ro.find((s) => s.no === 5)?.name === '파하가', '번호 없으면 앞 번호 다음')
ok(!ro.some((s) => s.name === '중복이'), '같은 번호는 처음 것')
ok(A.readRoster('망가짐').students.length === 0 && A.readRecords('{').length === 0, '망가진 설정')

// 출결 합치기 · 합계 · 표
const r1 = { id: 'a', date: '2026-11-05', no: 2, type: '결석', reason: '질병', note: '장염', proof: '필요', neis: false }
const r2 = { id: 'b', date: '2026-11-05', no: 2, type: '결석', reason: '미인정', note: '', proof: '없음', neis: false }
const r3 = { id: 'c', date: '2026-11-06', no: 3, type: '지각', reason: '기타', note: '', proof: '필요', neis: true }
const up = A.upsertRecords([r1], [r2, r3])
ok(up.length === 2 && up.find((r) => r.no === 2).reason === '미인정' && up.find((r) => r.no === 2).id === 'a', '같은 날 · 학생 · 종류는 바꿔 쓰고 id 는 그대로')
const sum = A.summarize(up, '2026-11-01', '2026-11-30')
ok(sum.get(2).counts['결석']['미인정'] === 1 && sum.get(3).total === 1, '학생별 합계')
ok(A.readRecords(JSON.stringify([{ date: '2026-11-05', no: 1, type: '결석', reason: '이상함', proof: 'x' }]))[0].reason === '기타', '모르는 사유는 기타')
const tsv = A.recordsTsv(up, { cls: '2-4', students: ro })
ok(tsv.split('\n').length === 3 && tsv.includes('라마바\t결석\t미인정'), '표 복사')
ok(A.defaultProof('미인정') === '없음' && A.defaultProof('질병') === '필요', '서류 기본값')

// 메신저 — 프롬프트 · 답 읽기
const p = M.messengerPrompt('[교무부] 학생3 결석', '2026-11-05', [{ no: 3 }])
ok(p.includes('2026-11-05(목)') && p.includes('2026-11-18(수)') && p.includes('우리 반 번호: 3'), '오늘 · 2주 날짜 · 반 번호')
const raw = '```json\n' + JSON.stringify({
  todos: [
    { title: '수행평가 계획서 제출', due: '2026-11-14', time: '', kind: '기한', from: '교무부', note: '학년 공유 폴더' },
    { title: '학업성적관리위원회', due: '2026-11-10', time: '15:00', kind: '일정' },
    { title: '', due: 'x' },
    { title: '날짜 이상', due: '11/20', time: '25:00', kind: '?' }
  ],
  attendance: [
    { who: '학생3', date: '2026-11-05', type: '지각', reason: '질병', note: '장염', proof: '' },
    { who: '사람A', date: '2026-11-05', type: '결석', reason: '미인정' },
    { who: '학생4', type: '외출' }
  ]
}) + '\n```'
const res = M.parseMsgResult(raw)
ok(res.todos.length === 3 && res.todos[1].time === '15:00' && res.todos[1].kind === '일정', '할 일 셋 (빈 제목은 버림)')
ok(res.todos[2].due === '' && res.todos[2].time === '' && res.todos[2].kind === '기한', '틀린 날짜 · 시각 · 종류는 비우거나 기본값')
ok(res.attendance.length === 2 && res.attendance[0].no === 3 && res.attendance[0].proof === '필요', '학생3 → 3번, 서류 기본값')
ok(res.attendance[1].no === 0 && res.attendance[1].proof === '없음', '명단에 없는 사람은 번호 0, 미인정은 서류 없음')
ok(M.parseMsgResult('모르겠어요').todos.length === 0, '모양이 틀린 답')

// 폰 우편함 스크립트
const key = R.newRelayKey((n) => new Uint8Array(Array.from({ length: n }, (_, i) => i * 7)))
ok(/^[A-Za-z0-9]{24}$/.test(key), '열쇠 24자')
ok(R.normalizeRelayUrl('https://script.google.com/macros/s/AKfycbx1234567890abcdefghij/exec?x=1') === 'https://script.google.com/macros/s/AKfycbx1234567890abcdefghij/exec', '웹 앱 주소')
ok(R.normalizeRelayUrl('https://example.com/macros/s/AKfycbx1234567890abcdefghij/exec') === '', '다른 주소는 안 받음')
ok(R.parsePull({ ok: true, items: [{ id: '1-2', t: 5, text: 'a' }, { id: 'x', text: 'b' }] }).length === 1 && R.parsePull({ ok: false }) === null, 'pull 답 읽기')

// 생성한 Apps Script 를 가짜 구글 객체로 돌려 본다
const code = R.relayScript(key)
const store = {}
const fake = {
  PropertiesService: { getScriptProperties: () => ({ setProperty: (k, v) => (store[k] = v), getProperties: () => ({ ...store }), getProperty: (k) => (k in store ? store[k] : null), deleteProperty: (k) => delete store[k] }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ s, setMimeType() { return this } }) },
  HtmlService: { createHtmlOutput: (h) => ({ h, setTitle() { return this }, addMetaTag() { return this } }) }
}
const gas = new Function(...Object.keys(fake), code + '\nreturn { doGet, send, PAGE };')(...Object.values(fake))
ok(gas.doGet({ parameter: { k: 'wrong', op: 'pull' } }).h.includes('맞지 않습니다'), '열쇠가 틀리면 거절')
ok(gas.send(key, '  내일 회의  ') === 1 && gas.send(key, '두 번째') === 2, '보내기 → 쌓임')
let threw = false
try { gas.send('wrong', 'x') } catch { threw = true }
ok(threw, '열쇠 틀린 보내기는 오류')
const pulled = JSON.parse(gas.doGet({ parameter: { k: key, op: 'pull' } }).s)
ok(pulled.ok && pulled.items.length === 2 && pulled.items[0].text === '내일 회의', '가져오기')
gas.doGet({ parameter: { k: key, op: 'ack', ids: pulled.items[0].id + ',../evil' } })
ok(JSON.parse(gas.doGet({ parameter: { k: key, op: 'ping' } }).s).n === 1, '가져간 글은 지움 (이상한 id 는 무시)')
const page = gas.doGet({ parameter: { k: key } }).h
const boot = JSON.parse(page.slice(page.indexOf('var B=') + 6, page.indexOf(',K=B.k')))
ok(boot.k === key && boot.board === null && !page.includes('__BOOT__'), '폰 화면에 열쇠 · 아직 판 없음')
const script = page.slice(page.indexOf('<script>') + 8, page.indexOf('</script>'))
let parsed = true
try { new Function(script) } catch { parsed = false }
ok(parsed, '폰 화면의 스크립트가 문법에 맞음')
ok(script.includes("'\\n'") && script.includes('/^\\d+$/'), '역슬래시가 그대로 (줄바꿈 · 정규식)')

// v2 — 수업 관찰 · 출결 · 판 (수업반 · 학생 id) · 잠근 이름표
ok(code.includes('(v2)') && R.RELAY_VERSION === 2 && JSON.parse(gas.doGet({ parameter: { k: key, op: 'ping' } }).s).v === 2, '판 2')
const gas2 = new Function(...Object.keys(fake), code + '\nreturn { doGet, sendItem };')(...Object.values(fake))
const roster = [
  { id: '1-3', cls: '1', no: '3', group: '1반' },
  { id: '1-1', cls: '1', no: '1', group: '' },
  { id: '1-2', cls: '1', no: '2', group: '' },
  { id: '2-1', cls: '2', no: '1', group: '미적분A반' },
  { id: '1-5@미적분A반', cls: '1', no: '5', group: '미적분A반' }
]
const board = R.buildBoard({ subject: roster, club: [] }, [{ id: 'a1', name: '함수 탐구 <b>', mode: 'subject' }, { id: 'c1', name: '동아리', mode: 'club' }], { cls: '2-4', nos: [1, 2, 3, 4] })
ok(JSON.stringify(board) === JSON.stringify({ m: { subject: [['1반', ['1-1', '1-2', '1-3']], ['미적분A반', ['1-5@미적분A반', '2-1']]] }, a: [{ i: 'a1', n: '함수 탐구 <b>', m: 'subject' }], h: { c: '2-4', r: '1-4' } }), '판 — 수업반별 학생 id (반 · 번호 차례) · 정하지 않은 반은 담임 반 · 명단 없는 활동은 뺌')
ok(R.rangeOf([3, 1, 2, 2, 7, 9, 8, 0, 120]) === '1-3,7-9', '번호 범위')
const big = R.buildBoard({ s: [{ id: '1-1', cls: '1', no: '1', group: '' }] }, Array.from({ length: 1200 }, (_, i) => ({ id: 'act' + i, name: '아주 긴 활동 이름입니다 ' + i, mode: 's' })), null)
ok(JSON.stringify(big).length <= R.BOARD_MAX && big.a.length > 10 && big.a.length < 1200 && big.h === null, '판이 크면 뒤 활동부터 뺌')

// 이름표 — 판에 나온 학생만 · 잠그기(PC, 노드 crypto) → 풀기(폰 화면의 unseal, WebCrypto)
const names = R.buildNames(board, [{ id: '1-1', label: '10101', name: '가나다' }, { id: '2-1', label: '2반 1번', name: '라마바' }, { id: '9-9', label: '90909', name: '안나와' }], [{ no: 1, name: '사아자' }, { no: 2, name: '차카타' }])
ok(JSON.stringify(names) === JSON.stringify({ s: { '1-1': ['10101', '가나다'], '2-1': ['2반 1번', '라마바'] }, h: { 1: '사아자', 2: '차카타' } }), '이름표 — 판에 나온 학생 · 담임 반 번호만')
ok(!JSON.stringify(board).includes('가나다') && !JSON.stringify(board).includes('10101'), '판에는 이름 · 학번 없음')
const nodeCrypto = require('crypto')
const nkey = R.newNameKey((n) => new Uint8Array(nodeCrypto.randomBytes(n)))
ok(R.isNameKey(nkey) && !R.isNameKey(nkey + 'x') && !R.isNameKey('a/b'), '이름표 열쇠 43자 base64url')
const seal = (plain, k) => {
  const iv = nodeCrypto.randomBytes(12)
  const c = nodeCrypto.createCipheriv('aes-256-gcm', Buffer.from(k, 'base64url'), iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return R.b64u(new Uint8Array(Buffer.concat([iv, ct, c.getAuthTag()])))
}
const sealed = seal(JSON.stringify(names), nkey)
ok(/^[A-Za-z0-9_-]+$/.test(sealed) && !sealed.includes('가나다'), '잠근 이름표는 base64url · 이름이 보이지 않음')
const pageLine = (name) => script.split('\n').find((l) => l.startsWith('function ' + name + '('))
const phoneFns = new Function('window', pageLine('unb') + '\n' + pageLine('unseal') + '\n' + pageLine('nkeyOf') + '\nreturn { unseal, nkeyOf };')(globalThis)
const unsealP = (s, k) => new Promise((res) => phoneFns.unseal(s, k, res))

// 판 · 이름표를 조각으로 올리고 모으기
const parts = R.splitParts('가'.repeat(5000) + 'abc' + '😀'.repeat(10))
ok(parts.length > 2 && parts.every((p) => encodeURIComponent(p).length <= R.PART_MAX) && parts.join('') === '가'.repeat(5000) + 'abc' + '😀'.repeat(10), '조각 나누기 — 주소 길이 6000 안 · 글자를 자르지 않음')
ok(R.splitParts('').length === 1 && R.splitParts('').join('') === '', '빈 글도 조각 하나')
const put = (name, text, max) => {
  const ps = R.splitParts(text, max)
  return ps.map((b, i) => JSON.parse(gas.doGet({ parameter: { k: key, op: 'put', name, i: String(i), n: String(ps.length), b } }).s).ok)
}
ok(put('board', JSON.stringify(board), 300).every(Boolean) && put('names', sealed, 50).length > 1, '판 · 이름표를 여러 조각으로 올림')
ok(!JSON.parse(gas.doGet({ parameter: { k: key, op: 'put', name: 'evil', i: '0', n: '1', b: '{}' } }).s).ok, '모르는 이름은 안 받음')
ok(!JSON.parse(gas.doGet({ parameter: { k: key, op: 'put', name: 'names', i: '0', n: '1', b: '가나다' } }).s).ok, '이름표 자리에 잠그지 않은 글은 안 받음')
ok(!JSON.parse(gas.doGet({ parameter: { k: key, op: 'put', name: 'board', i: '3', n: '2', b: '{}' } }).s).ok, '조각 번호가 틀리면 안 받음')
ok(!JSON.parse(gas.doGet({ parameter: { k: key, op: 'put', name: 'board', i: '0', n: '1', b: '{망가짐' } }).s).ok, '망가진 판은 안 받음')
const page2 = gas.doGet({ parameter: { k: key, tab: 'att' } }).h
const boot2 = JSON.parse(page2.slice(page2.indexOf('var B=') + 6, page2.indexOf(',K=B.k')))
ok(boot2.tab === 'att' && JSON.stringify(boot2.board) === JSON.stringify(board) && !page2.includes('<b>",') && page2.includes('\\u003cb>'), '폰 화면에 모은 판 · 탭 (망가진 판이 와도 앞 판 그대로 · 꺾쇠는 \\u003c 로)')
ok(boot2.names === sealed && !Object.values(store).some((v) => String(v).includes('가나다')), '폰 화면에 잠근 이름표 그대로 · 구글 저장소 어디에도 이름 없음')
ok(put('board', JSON.stringify({ m: {}, a: [], h: null }), 6000).length === 1 && store.x_board_n === '1' && !('x_board_1' in store) && !Object.keys(store).some((k) => k.startsWith('y_')), '작아지면 남은 옛 조각을 지움')

// 보내기 · 받기 — 학생 id
ok(gas2.sendItem(key, { kind: 'obs', a: 'a1', s: '1-5@미적분A반', g: '미적분A반', c: '1', n: 5, d: '2026-11-13', x: ' 발표: 기울기 비교 ' }) === 2, '관찰 보내기 (학생 id · 수업반)')
ok(gas2.sendItem(key, { kind: 'obs', a: 'a1', s: 'x-y', g: '', c: '', n: 0, d: '2026-11-13', x: '번호를 모르는 학생 id' }) === 3, '번호를 몰라도 학생 id 가 있으면 받음')
ok(gas2.sendItem(key, { kind: 'att', n: '4', d: '2026-11-13', ty: '결석', r: '질병', x: '병원' }) === 4, '출결 보내기')
const bads = [{ kind: 'obs', a: 'a1', c: '1', n: 3, d: '2026-11-13', x: '  ' }, { kind: 'obs', a: 'a1', n: 0, d: '2026-11-13', x: 'id 도 번호도 없음' }, { kind: 'att', n: 0, d: '2026-11-13' }, { kind: 'att', s: '1-1', n: 0, d: '2026-11-13' }, { kind: 'att', n: 3, d: '11/13' }, { kind: 'zzz', n: 3, d: '2026-11-13' }]
ok(bads.every((b) => { try { gas2.sendItem(key, b); return false } catch { return true } }), '빈 관찰 · id 도 번호도 없음 · 출결 번호 0 · 날짜 모양 · 모르는 종류는 오류')
const p2 = R.parsePull(JSON.parse(gas.doGet({ parameter: { k: key, op: 'pull' } }).s))
ok(p2.length === 4 && p2[0].kind === 'text' && p2[1].kind === 'obs' && p2[1].text === '발표: 기울기 비교' && p2[1].sid === '1-5@미적분A반' && p2[1].group === '미적분A반' && p2[1].no === 5 && p2[2].sid === 'x-y' && p2[2].no === 0 && p2[3].kind === 'att' && p2[3].no === 4 && p2[3].type === '결석', 'pull — 글 · 관찰(학생 id · 수업반) · 출결로 나눠 읽음')
ok(R.parsePull({ ok: true, items: [{ id: '1-1', kind: 'obs', n: 3, d: '2026-11-13', x: '' }, { id: '1-2', kind: 'att', n: 200, d: '2026-11-13' }, { id: '1-3', kind: 'obs', n: 0, d: '2026-11-13', x: 'a' }] }).length === 0, '모양이 틀린 관찰 · 출결은 버림')
ok(R.phoneUrl('https://x/exec', 'K1', 'obs') === 'https://x/exec?k=K1&tab=obs' && R.phoneUrl('https://x/exec', 'K1', 'att', nkey) === `https://x/exec?k=K1&tab=att#n=${nkey}` && R.versionOf({ v: 2 }) === 2 && R.versionOf({}) === 0, '폰 주소 — 탭은 ? 뒤, 이름표 열쇠는 맨 뒤 # (서버로 안 감) · 판 읽기')
ok(phoneFns.nkeyOf('n=' + nkey) === nkey && phoneFns.nkeyOf('#n=' + nkey) === nkey && phoneFns.nkeyOf('n=짧음') === '', '폰 화면이 주소의 # 뒤에서 열쇠를 찾음')
let bad = false
try { R.relayScript("x'; evil()") } catch { bad = true }
ok(bad, '열쇠 모양이 아니면 코드를 만들지 않음')

;(async () => {
  ok(JSON.stringify(await unsealP(sealed, nkey)) === JSON.stringify(names), '폰 화면이 WebCrypto 로 이름표를 풂')
  ok((await unsealP(sealed, R.newNameKey((n) => new Uint8Array(nodeCrypto.randomBytes(n))))) === null, '열쇠가 틀리면 못 풂 (번호만 보임)')
  ok((await unsealP(sealed.slice(0, -3) + (sealed.slice(-3, -2) === 'A' ? 'B' : 'A') + sealed.slice(-2), nkey)) === null, '고친 글은 못 풂')
  ok((await unsealP('', nkey)) === null && (await unsealP(sealed, '')) === null, '이름표 · 열쇠가 없으면 null')
  console.log(fails ? `\n${fails}개 실패` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})()
