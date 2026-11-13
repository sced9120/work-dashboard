// 세특 작성실 — 취합 · 압축 · 나이스 입력 파일. 빌드된 앱의 IPC 로. AI 는 가로채 가짜로 답한다(진짜 키를 쓰지 않는다). 이름은 지어낸 것
const path = require('path')
const fs = require('fs')
const { zipSync, unzipSync, strToU8, strFromU8 } = require(path.join(__dirname, '../node_modules/fflate'))
const { handlers, next, calls, USER_DATA } = global.__it
const { loadShared: load } = require('./tsload.cjs')
const N = load('seteukNeis.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

const log = []
let script = []
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const answer = (text) => () => json({ choices: [{ message: { role: 'assistant', content: text } }] })
global.fetch = async (url, opts = {}) => {
  const entry = { url: String(url), body: opts.body ? JSON.parse(opts.body) : null }
  log.push(entry)
  const step = script.shift()
  if (!step) throw new Error('예상 못 한 요청 ' + url)
  return step(entry)
}

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('seteuk:sums'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'exaone', exaone_key: 'TEST-EXAONE', gemini_key: '', openai_key: '', claude_key: '' })

  const roster = ['가나다', '라마바', '사아자', '차카타'].map((name, i) => ({ id: `1-${i + 1}`, cls: '1', no: String(i + 1), name }))
  await call('seteuk:roster', 'homeroom', roster)
  await call('seteuk:acts', [
    { id: 'a1', name: '독서 토론', rec: '행발' },
    { id: 'a2', name: '학급 자치', rec: '행발' }
  ])
  const long = '토론에서 근거를 들어 반론하고 상대의 말을 요약하여 되물음. '.repeat(18).trim() // 한도 900바이트를 넘는다
  await call('seteuk:rows', 'a1', {
    '1-1': { final: long },
    '1-2': { final: '가나다와 함께 토론을 준비하고 자료를 나누어 읽음.' },
    '1-3': { final: long },
    '1-4': { ai: '초안만 있는 글.' }
  })
  await call('seteuk:rows', 'a2', { '1-1': { final: '학급 회의를 진행함.' }, '1-2': { final: '회의록을 정리함.' }, '1-3': { final: '규칙을 제안함.' } })

  console.log('1. 취합 칸 저장')
  let sums = await call('seteuk:sums')
  ok(Object.keys(sums.행발).length === 0 && '과세특' in sums, '처음엔 비어 있음 (영역마다 한 칸)')
  await call('seteuk:sum', '행발', { '1-3': { final: '선생님이 직접 줄여 다듬은 글.' }, '1-2': { final: '고칠 글' } })
  await call('seteuk:sum', '행발', { '1-2': { final: null } })
  await call('seteuk:sum', '없는영역', { '1-1': { final: 'x' } })
  sums = await call('seteuk:sums')
  ok(sums.행발['1-3'].final.includes('다듬은') && !('1-2' in sums.행발) && !('없는영역' in sums), '고친 칸만 · null 이면 되돌림 · 없는 영역에는 안 넣음')

  console.log('\n2. 압축 — 합본만 보내고 이름은 가림')
  script = [answer('"토론에서 근거를 들어 반론하고 되물음.\n학급 회의를 진행함."'), answer('가'.repeat(400) + '.'), answer('다듬은 글이 있는 학생의 압축본.')]
  calls.sent.length = 0
  let r = await call('seteuk:compress', { job: 'c1', rec: '행발', ids: ['1-1', '1-2', '1-3', '9-9'] })
  ok(r.ok && r.written === 3 && r.failed === 0, `세 명 받음 (${JSON.stringify(r)})`)
  const sent = JSON.stringify(log.map((e) => e.body))
  ok(log.length === 3 && !roster.some((x) => sent.includes(x.name)) && log[1].body.messages[1].content.startsWith('[통합할 문장들]\n학생1와 함께'), '학생마다 한 번 · 이름은 가명으로')
  ok(log[0].body.messages[0].content.includes('행동특성 및 종합의견으로 통합') && log[0].body.messages[0].content.includes('900바이트'), '압축 규칙은 system 으로 — 영역 한도')
  ok(log[0].body.messages[1].content.includes('학급 회의를 진행함.') && log[0].body.messages[1].content.includes('되물음. 토론에서'), '활동별 글을 이어 붙인 합본을 보냄')
  sums = await call('seteuk:sums')
  ok(sums.행발['1-1'].ai === '토론에서 근거를 들어 반론하고 되물음. 학급 회의를 진행함.' && sums.행발['1-1'].final === sums.행발['1-1'].ai, '한도를 넘던 학생: 압축본이 최종본으로 (따옴표 · 줄바꿈 걷어 냄)')
  const b2 = Buffer.byteLength(sums.행발['1-2'].ai.replace(/[^\x00-\x7f]/g, 'xxx'))
  ok(b2 <= 900 && sums.행발['1-2'].final === sums.행발['1-2'].ai, `답이 한도를 넘으면 잘라 둠 (${b2}바이트) · 합본 그대로였으니 최종본으로`)
  ok(sums.행발['1-3'].ai === '다듬은 글이 있는 학생의 압축본.' && sums.행발['1-3'].final === '선생님이 직접 줄여 다듬은 글.', '선생님이 다듬은 최종본은 덮지 않고 압축본만 둠')
  const prog = calls.sent.filter((x) => x.ch === 'seteuk:sumProgress').map((x) => x.payload)
  ok(prog.length === 3 && prog[2].done === 3 && prog[0].id === '1-1' && prog[0].sum.final && prog.every((x) => x.job === 'c1'), '진행 소식 — 학생마다 한 번')

  console.log('\n3. 압축 — 오류 · 멈추기 · 빈 합본')
  script = [() => json({ error: { message: 'x' } }, 401)]
  r = await call('seteuk:compress', { job: 'c2', rec: '행발', ids: ['1-1'] })
  ok(r.ok && r.failed === 1 && (await call('seteuk:sums')).행발['1-1'].ai.includes('토론에서'), '실패해도 옛 압축본은 그대로')
  script = [async () => { await call('seteuk:compressCancel', 'c3'); return json({ choices: [{ message: { content: '첫 학생.' } }] }) }, answer('오면 안 됨')]
  r = await call('seteuk:compress', { job: 'c3', rec: '행발', ids: ['1-1', '1-2'] })
  ok(r.canceled && r.written === 1 && script.length === 1, '멈추면 받던 학생까지만')
  script = []
  await call('seteuk:rows', 'a1', { '1-4': { ai: '' } })
  r = await call('seteuk:compress', { job: 'c4', rec: '행발', ids: ['1-4'] })
  ok(!r.ok && r.empty === 1, `글이 없는 학생은 보내지 않음: ${r.error}`)
  r = await call('seteuk:compress', { job: 'c5', rec: '과세특', ids: ['1-1'] })
  ok(!r.ok, '활동이 없는 영역')

  console.log('\n4. 나이스 입력 파일')
  const is = (ref, t, st = '') => `<c r="${ref}"${st} t="inlineStr"><is><t>${t}</t></is></c>`
  const head = ['영역 구분', '학년도', '학년', '반', '번호', '학생개인번호', '성명', '행동특성 및 종합의견']
  const L = 'ABCDEFGH'
  const row = (n, no, name, content) => `<row r="${n}">${is('A' + n, '행동특성 및 종합의견')}${is('B' + n, '2026')}${is('C' + n, '1')}${is('D' + n, '1')}${is('E' + n, no)}${is('F' + n, 'P' + n)}${is('G' + n, name)}${content ? is('H' + n, content, ' s="3"') : `<c r="H${n}" s="3"></c>`}</row>`
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData><row r="1">${head.map((h, i) => is(L[i] + '1', h)).join('')}</row>${row(2, '1', '가나다')}${row(3, '2', '라마바')}${row(4, '3', '이름다름')}${row(5, '4', '차카타')}${row(6, '5', '전입생')}</sheetData></worksheet>`
  const styles = '<styleSheet><!-- 그대로 두어야 하는 서식 --></styleSheet>'
  const formPath = path.join(USER_DATA, '행발_양식.xlsx')
  fs.writeFileSync(formPath, Buffer.from(zipSync({
    'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
    'xl/styles.xml': strToU8(styles)
  })))
  const original = fs.readFileSync(formPath)
  // 2번 학생의 최종본에는 고칠 곳(존댓말)을 남겨 둔다
  await call('seteuk:sum', '행발', { '1-2': { final: '자료를 나누어 읽었습니다.' } })

  next.open.push([formPath])
  let pv = await call('seteuk:neisPick', '행발', {})
  ok(pv.ok && pv.file === '행발_양식.xlsx' && pv.form.kind === '행발' && pv.form.students === 5 && pv.form.contentHead === '행동특성 및 종합의견' && !JSON.stringify(pv).includes(USER_DATA), '양식 읽기 — 종류 · 학생 수 · 넣는 칸 (경로는 화면에 안 넘김)')
  ok(pv.fill === 1 && pv.plan.map((x) => x.why).join('|') === '|검사에서 고칠 곳이 남아 있음|반 · 번호는 같은데 이름이 다름|최종본이 비어 있음|명단에 없는 학생', `누가 왜 빠지는지: ${pv.plan.map((x) => x.why).join('|')}`)
  ok(pv.column.length === 5 && pv.column[0].includes('학급 회의') && pv.column[1] === '', '양식 순서대로 한 열')
  pv = await call('seteuk:neisPreview', pv.id, '행발', { includeFlagged: true })
  ok(pv.ok && pv.fill === 2, '고칠 곳이 남은 글도 넣기를 고르면 2명')
  ok((await call('seteuk:neisPreview', '없는번호', '행발', {})).ok === false, '고르지 않은 양식')

  const outPath = path.join(USER_DATA, '채움.xlsx')
  next.save.push(outPath)
  let sv = await call('seteuk:neisSave', pv.id, '행발', { includeFlagged: true })
  ok(sv.ok && /2명/.test(sv.message), `저장: ${sv.message.replace(USER_DATA, '…')}`)
  const got = unzipSync(new Uint8Array(fs.readFileSync(outPath)))
  const again = N.readNeisForm(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, strFromU8(v)])))
  ok(again.rows[0].content.includes('학급 회의를 진행함.') && again.rows[1].content === '자료를 나누어 읽었습니다.' && again.rows[2].content === '' && again.rows[3].content === '', '맞는 학생 칸만 채워짐')
  ok(strFromU8(got['xl/styles.xml']) === styles && strFromU8(got['xl/worksheets/sheet1.xml']).includes(is('F2', 'P2')) && strFromU8(got['xl/worksheets/sheet1.xml']).includes('<c r="H2" s="3" t="inlineStr">'), '서식 · 학생개인번호 등 다른 것은 그대로')
  ok(fs.readFileSync(formPath).equals(original), '원래 양식 파일은 건드리지 않음')
  next.save.push(formPath)
  sv = await call('seteuk:neisSave', pv.id, '행발', { includeFlagged: true })
  ok(!sv.ok && fs.readFileSync(formPath).equals(original), `원래 파일 이름으로는 저장하지 않음: ${sv.message}`)
  const bad = path.join(USER_DATA, 'bad.xlsx')
  fs.writeFileSync(bad, 'xlsx 아님')
  next.open.push([bad])
  pv = await call('seteuk:neisPick', '행발', {})
  ok(pv.ok === false && /엑셀/.test(pv.error), `엑셀이 아닌 파일: ${pv.error}`)
  ok((await call('seteuk:neisPick', '행발', {})) === null, '고르지 않고 닫음')

  console.log('\n5. 인수인계 파일')
  const out = path.join(USER_DATA, 'h.db')
  next.save.push(out)
  ok((await call('data:export', true)).ok, '내보내기')
  const bytes = fs.readFileSync(out).toString('utf8')
  ok(!bytes.includes('다듬은 글') && !bytes.includes('seteuk_sum') && !bytes.includes('가나다'), '취합한 글 · 압축본도 파일에 없음')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
