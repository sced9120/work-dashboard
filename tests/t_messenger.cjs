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
  PropertiesService: { getScriptProperties: () => ({ setProperty: (k, v) => (store[k] = v), getProperties: () => ({ ...store }), deleteProperty: (k) => delete store[k] }) },
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
ok(page.includes(`var K="${key}"`) && !page.includes('__KEY__'), '폰 화면에 열쇠')
const script = page.slice(page.indexOf('<script>') + 8, page.indexOf('</script>'))
let parsed = true
try { new Function(script) } catch { parsed = false }
ok(parsed, '폰 화면의 스크립트가 문법에 맞음')
ok(script.includes('"\\n"'), '붙여 넣을 때 줄바꿈 글자가 그대로')
let bad = false
try { R.relayScript("x'; evil()") } catch { bad = true }
ok(bad, '열쇠 모양이 아니면 코드를 만들지 않음')

console.log(fails ? `\n${fails}개 실패` : '\n모두 통과')
process.exit(fails ? 1 : 0)
