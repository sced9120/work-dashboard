// 우편함 스크립트 v3 — 구글 설문지 응답 시트 읽기(form_) · 답 읽기 · 시트 주소 → ID · 응답 머리글 다듬기 (빌드 없이, 가짜 구글)
const { loadShared: load } = require('./tsload.cjs')
const R = load('relay.ts')
const S = load('seteuk.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

const key = R.newRelayKey((n) => new Uint8Array(Array.from({ length: n }, (_, i) => (i * 13) % 251)))
const code = R.relayScript(key)
ok(code.includes('(v3)') && R.RELAY_VERSION === 3 && R.RELAY_NEEDS.form === 3 && R.RELAY_NEEDS.obs === 2, '판 3 · 기능마다 필요한 판')

// 가짜 응답 시트: 머리글 + 5행 (첫 칸 Date)
const base = Date.UTC(2026, 10, 13, 5, 0, 0)
const rows = [['타임스탬프', '학번', '이름', '탐구 주제']].concat(Array.from({ length: 5 }, (_, i) => [new Date(base + i * 60000), String(20301 + i), '학생' + i, '주제' + i]))
const big = [['타임스탬프', '학번', '이름', '내용']].concat(Array.from({ length: 450 }, (_, i) => [new Date(base + i * 1000), '20301', 'x', 'y' + i]))
const sheets = { AAAAAAAAAAAAAAAAAAAAAAAA1: { name: '탐구 설문 (응답)', data: rows }, BBBBBBBBBBBBBBBBBBBBBBBB2: { name: '큰 설문', data: big } }
const show = (v) => (v instanceof Date ? `2026. 11. 13 오후 ${v.getUTCMinutes()}` : String(v))
const store = {}
const fake = {
  PropertiesService: { getScriptProperties: () => ({ setProperty: (k, v) => (store[k] = v), getProperty: (k) => (k in store ? store[k] : null), getProperties: () => ({ ...store }), deleteProperty: (k) => delete store[k] }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ s, setMimeType() { return this } }) },
  HtmlService: { createHtmlOutput: (h) => ({ h, setTitle() { return this }, addMetaTag() { return this } }) },
  SpreadsheetApp: {
    openById: (id) => {
      const sh = sheets[id]
      if (!sh) throw new Error('no access')
      return { getName: () => sh.name, getSheets: () => [{ getDataRange: () => ({ getValues: () => sh.data.map((r) => r.slice()), getDisplayValues: () => sh.data.map((r) => r.map(show)) }) }] }
    }
  }
}
const gas = new Function(...Object.keys(fake), code + '\nreturn { doGet };')(...Object.values(fake))
const get = (p) => JSON.parse(gas.doGet({ parameter: { k: key, ...p } }).s)

let r = get({ op: 'form', sheet: 'AAAAAAAAAAAAAAAAAAAAAAAA1', after: '0' })
ok(r.ok && r.v === 3 && r.title === '탐구 설문 (응답)' && r.head.join() === '타임스탬프,학번,이름,탐구 주제' && r.rows.length === 5 && r.last === base + 4 * 60000, '처음 — 머리글 · 모든 행 · 마지막 시각')
ok(typeof r.rows[0][0] === 'string' && r.rows[0][1] === '20301', '칸은 화면에 보이는 글자로')
r = get({ op: 'form', sheet: 'AAAAAAAAAAAAAAAAAAAAAAAA1', after: String(base + 2 * 60000) })
ok(r.rows.length === 2 && r.rows[0][2] === '학생3', 'after 뒤의 새 응답만')
ok(!get({ op: 'form', sheet: '../evil', after: '0' }).ok && !get({ op: 'form', sheet: 'CCCCCCCCCCCCCCCCCCCCCCCC3', after: '0' }).ok, '시트 ID 모양이 아니거나 열 수 없는 시트는 거절')
ok(gas.doGet({ parameter: { k: 'wrong', op: 'form', sheet: 'AAAAAAAAAAAAAAAAAAAAAAAA1' } }).h.includes('맞지 않습니다'), '열쇠가 틀리면 거절')
r = get({ op: 'form', sheet: 'BBBBBBBBBBBBBBBBBBBBBBBB2', after: '0' })
ok(r.rows.length === 300 && r.more === true, '한 번에 300행까지 · more')
ok(Object.keys(store).length === 0, '시트 내용을 스크립트에 남기지 않음')

const p = R.parseForm(get({ op: 'form', sheet: 'AAAAAAAAAAAAAAAAAAAAAAAA1', after: '0' }))
ok(p && p.rows.length === 5 && p.times.length === 5 && p.more === false && R.parseForm({ ok: false }) === null && R.parseForm({ ok: true, head: 'x' }) === null, '답 읽기')
ok(R.sheetIdOf('https://docs.google.com/spreadsheets/d/1AbC_dEf-GhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0') === '1AbC_dEf-GhIjKlMnOpQrStUvWxYz0123456789' && R.sheetIdOf('https://example.com/x') === '' && R.sheetIdOf('AAAAAAAAAAAAAAAAAAAAAAAA1') === 'AAAAAAAAAAAAAAAAAAAAAAAA1', '시트 주소 → ID')

const sh = S.formToSheet(['타임스탬프', '이메일 주소', '학번을 적어 주세요', '성명', '탐구 주제는?', '점수', '보호자 연락처', '몇 반인가요?'], [['t', 'a@b.c', '20315', '가나다', '함수', '3', '010', '3']])
ok(sh.header.join('|') === '학번|이름|탐구 주제는?|반' && sh.rows[0].join('|') === '20315|가나다|함수|3', '머리글 — 학번 · 이름 · 반으로, 타임스탬프 · 이메일 · 점수 · 연락처는 뺌')
const m = S.matchNotes([sh], [{ id: '3-15', cls: '3', no: '15', name: '가나다' }, { id: '3-16', cls: '3', no: '16', name: '라마바' }])
ok(m.hits.length === 1 && m.hits[0].id === '3-15' && m.hits[0].text === '함수', '학번으로 명단과 맞춤 · 문항이 하나면 답만')

console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
process.exit(fails ? 1 : 0)
