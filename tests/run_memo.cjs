// 자유 메모장 — 빌드된 앱의 IPC 로
const path = require('path')
const fs = require('fs')
const { handlers, next, USER_DATA } = global.__it
let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }
const call = (ch, ...args) => handlers.get(ch)({}, ...args)

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('memos:list'); i++) await new Promise((r) => setTimeout(r, 50))

  console.log('1. 만들기 · 고치기')
  const a = await call('memos:add', 'memo', '', '학부모 상담 메모\n학생A 어머님 다음 주 화요일 다시 연락')
  const flow = { nodes: [{ id: 'n1', x: 0, y: 0, w: 190, text: '체험학습 신청서 접수', kind: 'start' }, { id: 'n2', x: 0, y: 100, w: 190, text: '담임 확인', kind: 'step' }], edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '' }] }
  const b = await call('memos:add', 'flow', '체험학습 처리', JSON.stringify(flow))
  const c = await call('memos:add', 'memo', '공유할 요령', '나이스 출결 마감은 매월 5일')
  let list = await call('memos:list')
  ok(list.length === 3 && list.every((m) => m.share === 0 && m.created_at.length === 16), `3장, 처음엔 모두 '나만 봄'`)
  const before = list.find((m) => m.id === a).updated_at
  await call('memos:update', a, { pinned: 1 })
  list = await call('memos:list')
  ok(list[0].id === a && list[0].updated_at === before, '고정하면 맨 위 (고친 때는 그대로)')
  await call('memos:update', c, { content: '나이스 출결 마감은 매월 5일. 늦으면 교무부에 연락', share: 1 })
  list = await call('memos:list')
  ok(list.find((m) => m.id === c).share === 1 && list.find((m) => m.id === c).content.includes('교무부'), '내용 · 넘기기 표시 고침')

  console.log('\n2. 통합 검색')
  const hits = await call('search:run', '체험학습 담임')
  ok(hits.some((h) => h.kind === 'memo' && h.id === b && h.subtitle.startsWith('자유 워크플로우')), '워크플로우 상자 글자로 찾음')
  const h2 = await call('search:run', '상담')
  ok(h2.some((h) => h.kind === 'memo' && h.id === a && h.title === '학부모 상담 메모'), '제목 없는 메모는 첫 줄이 이름')

  console.log('\n3. 인수인계 파일')
  const out = path.join(USER_DATA, 'h.db')
  next.save.push(out)
  ok((await call('data:export', false)).ok, '내보내기')
  const bytes = fs.readFileSync(out).toString('utf8')
  ok(bytes.includes('나이스 출결 마감') && !bytes.includes('학생A') && !bytes.includes('체험학습 신청서'), "'넘기기' 켠 메모만 들어감 (나머지 글자는 파일에 남지 않음)")
  next.open.push([out])
  ok((await call('data:import')).ok !== false, '받은 파일 불러오기')
  list = await call('memos:list')
  ok(list.length === 1 && list[0].title === '공유할 요령', `받는 사람에게는 1장만`)

  console.log('\n4. 지우기')
  await call('memos:delete', list[0].id)
  ok((await call('memos:list')).length === 0, '지움')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
