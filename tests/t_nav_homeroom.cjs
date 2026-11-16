// 새 화면 위 탭 — 담임 · 세특 차례 · 숨기기 · 출결 위치 (빌드 없이: nav.ts 를 옮겨 적어 읽는다)
const fs = require('fs')
const path = require('path')
const ts = require(path.join(__dirname, '../node_modules/typescript'))

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/nav.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText
const m = { exports: {} }
new Function('module', 'exports', 'require', code)(m, m.exports, (r) => (r === 'react' ? { useSyncExternalStore: () => null } : require(r)))
const nav = m.exports

let fail = 0
const ok = (c, msg) => {
  console.log(`${c ? '✓' : '✗'} ${msg}`)
  if (!c) fail = 1
}

const none = { hidden: [], order: {}, links: [] }
const ids = (p) => nav.visibleTabs(p).map((t) => t.id)

ok(ids(none).includes('homeroom'), '담임 탭은 기본으로 보인다')
ok(ids(none).join() === 'today,week,work,homeroom,seteuk', '탭 차례: 오늘 · 이번 주 · 내 업무 · 담임 · 세특')
ok(!ids({ ...none, hidden: ['담임'] }).includes('homeroom'), '담임을 끄면 탭에서 빠진다')
ok(ids({ ...none, hidden: ['담임'] }).slice(-1)[0] === 'seteuk', '담임을 꺼도 세특이 맨 오른쪽')
ok(nav.visibleTabs(none).slice(-1)[0].id === 'seteuk', '세특 작성실이 맨 오른쪽')
const week = nav.TABS.find((t) => t.id === 'week')
ok(!week.subs.some((s) => s.page === '출결'), '출결 기록은 이번 주 안에 없다')
ok(nav.tabIdOf('담임') === 'homeroom' && nav.tabIdOf('출결') === 'homeroom', '담임 · 출결 모두 담임 탭에 불이 켜진다')
ok(nav.tabIdOf('세특') === 'seteuk' && nav.tabIdOf('시간표') === 'week', '다른 화면 탭 그대로')
ok(nav.isShown(none, '담임') && !nav.isShown({ ...none, hidden: ['담임'] }, '담임'), 'isShown 이 담임을 따른다')
ok(nav.NAV.some((g) => g.section === '담임' && g.items.some((i) => i.id === '담임') && g.items.some((i) => i.id === '출결')), '왼쪽 메뉴에 담임 묶음(담임 · 출결)')
ok(nav.navLabel('담임').startsWith('담임 ('), '메뉴 이름')

process.exit(fail)
