// 출결 기록 → 결석계 — 빌드된 앱의 IPC 로 (hwpforms:add · hwpforms:layout · attdocs:make). 양식은 시험이 직접 만든 hwpx. 이름은 지어낸 것
const path = require('path')
const fs = require('fs')
const os = require('os')
const AdmZip = require(path.join(__dirname, '../node_modules/adm-zip'))
const { loadShared: load } = require('./tsload.cjs')
const A = load('attdoc.ts')
const { handlers, next } = global.__it

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)
const textOf = (file) => new AdmZip(file).getEntries().filter((e) => /Contents\/section\d+\.xml$/.test(e.entryName)).map((e) => e.getData().toString('utf8')).join('')

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('attdocs:make'); i++) await new Promise((r) => setTimeout(r, 50))
  ok(handlers.has('attdocs:make'), 'attdocs:make 처리기가 있음')

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'attdoc-'))
  const formFile = path.join(tmp, '결석계양식.hwpx')
  next.save.push(formFile)
  const nd = await call('hwp:newDoc', { name: '결석계양식', text: '결석계\n성명: {{성명}}\n결석 기간: {{결석기간}}\n사유: {{사유}}\n비고: {{메모}}' })
  ok(nd.ok && fs.existsSync(formFile), '시험용 양식(.hwpx) 만듦')

  console.log('\n1. 양식 넣기 · 칸 읽기')
  next.open.push([formFile])
  const added = await call('hwpforms:add', '')
  ok(added.added.length === 1 && !added.errors.length, '양식 보관함에 넣음')
  const id = added.added[0].id
  const layout = await call('hwpforms:layout', { id })
  ok(layout.ok && ['성명', '결석기간', '사유', '메모'].every((s) => layout.slots.includes(s)), `{{칸}} 이름: ${layout.slots.join(', ')}`)
  const map = A.autoMap(layout.slots, layout.blanks)
  ok(map['slot:성명'] === 'name' && map['slot:결석기간'] === 'period' && map['slot:사유'] === 'reason' && map['slot:메모'] === '', '칸 짝을 짐작')

  console.log('\n2. 결석계 만들기')
  const students = [{ no: 1, name: '가나다' }, { no: 2, name: '라마바' }]
  const recs = [
    { id: 'a', date: '2026-03-06', no: 1, type: '결석', reason: '질병', note: 'B형 독감', proof: '필요', neis: false },
    { id: 'b', date: '2026-03-09', no: 1, type: '결석', reason: '질병', note: '', proof: '필요', neis: false },
    { id: 'c', date: '2026-03-12', no: 2, type: '결석', reason: '기타', note: '가정 행사', proof: '냄', neis: false }
  ]
  const items = A.groupAbsences(recs, students, '2-4').map((g) => {
    const { values, blanks } = A.fillArgs(map, A.itemValues(g, '2026-11-17'))
    return { fileName: A.docFileName(g), values, blanks }
  })
  ok(items.length === 2, '두 건(금 · 월은 한 건)')
  const outDir = path.join(tmp, '결과')
  fs.mkdirSync(outDir)
  next.open.push([outDir])
  const r = await call('attdocs:make', { ref: { id }, items })
  ok(r.ok && r.written === 2 && !r.failed.length && r.folder === outDir, `저장: ${r.message}`)
  const files = fs.readdirSync(outDir).sort()
  ok(files.length === 2 && files.every((f) => f.endsWith('.hwpx')), `파일 이름: ${files.join(' · ')}`)
  const first = files.find((f) => f.includes('가나다'))
  const xml = textOf(path.join(outDir, first))
  ok(xml.includes('가나다') && xml.includes('2026. 3. 6.(금) ~ 2026. 3. 9.(월)') && xml.includes('B형 독감'), '이름 · 기간 · 사유가 들어감')
  ok(!xml.includes('{{성명}}') && !xml.includes('{{결석기간}}') && !xml.includes('{{사유}}'), '채운 칸의 {{ }} 는 사라짐')
  ok(xml.includes('{{메모}}'), '비워 둔 칸은 그대로')

  console.log('\n3. 같은 이름 · 취소 · 못 만든 건')
  next.open.push([outDir])
  const r2 = await call('attdocs:make', { ref: { id }, items: [items[0]] })
  ok(r2.written === 1 && fs.readdirSync(outDir).length === 3, '같은 이름이 있으면 (2) 를 붙여 덮어쓰지 않음')
  const r3 = await call('attdocs:make', { ref: { id }, items })
  ok(!r3.ok && r3.written === 0, '폴더 고르기를 취소하면 만들지 않음')
  next.open.push([outDir])
  const r4 = await call('attdocs:make', { ref: { id }, items: [{ fileName: 'x', values: {}, blanks: {} }] })
  ok(!r4.ok && r4.failed.length === 1, '채울 칸이 없으면 만들지 않고 알림')
  const r5 = await call('attdocs:make', { ref: { id: 99999 }, items })
  ok(!r5.ok && /양식/.test(r5.message), '없는 양식')

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})()
