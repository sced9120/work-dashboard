// shared/mdtable.ts — 답에서 표 뽑기 · 이어 붙이기
const fs = require('fs')
const path = require('path')
const ts = require(path.join(__dirname, '../node_modules/typescript'))
const load = (f) => {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../shared', f), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const m = { exports: {} }
  new Function('module', 'exports', 'require', code)(m, m.exports, require)
  return m.exports
}
const M = load('mdtable.ts')
const G = load('gemini.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

const md = [
  '> 업로드된 문서를 분석한 결과, **반복 양식(유형 A)** 로 판단되어 ...',
  '',
  '## 영어 수행평가',
  '',
  '| 페이지 | 학번 | 이름 | 제목 | 상세 내용 |',
  '| --- | :---: | --- | --- | --- |',
  '| 1 | 00123 | 학생A | AI \\| Use | I think `a|b` is **good** |',
  '| 2 | 30107 | [불확실: 학생B/학생C] | (미작성) | (본문 없음) |',
  '',
  '```',
  '| 코드 | 안 |',
  '| --- | --- |',
  '| 표 | 아님 |',
  '```',
  '',
  '| 가 | 나 |',
  '|---|---|',
  '| 1 | 2 |'
].join('\n')
const t = M.extractTables(md)
ok(t.length === 2, `표 2개 (코드 울타리 안의 표는 빼고): ${t.length}`)
ok(t[0].title === '영어 수행평가' && t[0].header.join(',') === '페이지,학번,이름,제목,상세 내용', '제목 · 머리글')
ok(t[0].rows[0][1] === '00123' && t[0].rows[0][3] === 'AI | Use' && t[0].rows[0][4] === 'I think `a|b` is **good**', `\\| 는 글자, \`a|b\` 는 한 칸: ${JSON.stringify(t[0].rows[0])}`)
ok(M.plainCell('**굵게** 와 *기울임* 과 `코드`') === '굵게 와 기울임 과 코드', '굵게 · 기울임 · 코드 표시 떼기')
ok(M.toTsv(t[1]) === '가\t나\n1\t2', '탭으로 복사')
ok(M.proseOf(md).startsWith('> 업로드된 문서를 분석한 결과'), '안내 문장')

// 끊긴 답 → 덜 나온 마지막 행은 빼고, 이어 받은 표를 붙인다
const cut = '| 번호 | 이름 | 본문 |\n|---|---|---|\n| 1 | 가 | 첫째 |\n| 2 | 나 | 둘째 |\n| 3 | 다 | 셋째 문장이 길어 중간에서 끊'
const kept = M.dropPartialTail(cut)
ok(!kept.includes('| 3 |') && kept.trim().endsWith('| 2 | 나 | 둘째 |'), '덜 나온 마지막 행을 뺌')
ok(M.dropPartialTail('| a | b |\n|---|---|\n| 1 | 2 |') === '| a | b |\n|---|---|\n| 1 | 2 |', '다 나온 답은 그대로')
const merged = M.mergeTables(M.extractTables(kept), M.extractTables('| 번호 | 이름 | 본문 |\n|---|---|---|\n| 2 | 나 | 둘째 |\n| 3 | 다 | 셋째 문장 |\n| 4 | 라 | 넷째 |'))
ok(merged.length === 1 && merged[0].rows.map((r) => r[0]).join() === '1,2,3,4', `머리글이 같으면 이어 붙이고 겹친 행은 한 번만: ${merged[0].rows.map((r) => r[0]).join()}`)
ok(M.mergeTables(t.slice(0, 1), t.slice(1)).length === 2, '머리글이 다르면 새 표')

// Gemini 모델 구분 (temperature 를 빼는 모델)
ok(['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-4.0-pro'].every(G.isModernGemini) && !['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.1-pro'].some(G.isModernGemini), '3.6 이후 · 3.5 Flash-Lite 만 temperature 빼기')
ok(G.isGeminiModel('gemini-3.8-flash') && !G.isGeminiModel('gpt-5') && !G.isGeminiModel('gemini-3.8-flash/../x'), '모델 이름 검사')

console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
process.exit(fails ? 1 : 0)
