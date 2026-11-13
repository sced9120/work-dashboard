// 세특 작성실 — 보고서 요점 뽑기 · 다른 AI 앱용 지침 내보내기. 빌드된 앱의 IPC 로. AI 는 가로채 가짜로 답한다(진짜 키를 쓰지 않는다). 이름은 지어낸 것
const path = require('path')
const fs = require('fs')
const { unzipSync, strFromU8 } = require('fflate')
const { handlers, next, USER_DATA } = global.__it
const { loadShared: load } = require('./tsload.cjs')
const E = load('seteukExport.ts')

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

console.log('0. 규칙 (빌드 없이)')
ok(E.skillName('과세특', 2) === 'saeteuk-subject-2' && E.skillName('모름') === 'saeteuk-record-1', '스킬 이름 — 영문 소문자 · 하이픈')
const gem = E.buildGemText('# 역할\n교사다.')
ok(gem.startsWith('# 역할\n교사다.\n\n# 사용법') && gem.includes('[S1] [S2]'), 'Gem 지침 — 규칙 + 사용법')
const md = E.buildSkillMd({ name: 'saeteuk-subject-1', activity: '함수 탐구', record: '교과세특', system: '# 역할\n교사다.' })
ok(md.startsWith('---\nname: saeteuk-subject-1\ndescription: 함수 탐구 활동의') && md.includes('## 규칙\n\n# 역할\n교사다.') && md.includes('## 꼭 지킬 것'), 'SKILL.md — 머리말 · 규칙 · 지킬 것')
ok(E.cleanPoints('```\n요점입니다\n- 하나\n* **둘**\n1. 셋\n그냥 줄\n```') === '- 하나\n- 둘\n- 셋', '요점 답 — 목록 줄만, 꾸밈 빼기')
ok(E.cleanPoints(Array.from({ length: 12 }, (_x, i) => '- ' + i).join('\n')).split('\n').length === 8, '요점은 여덟 줄까지')

;(async () => {
  require(path.join(__dirname, '../out/main/index.js'))
  for (let i = 0; i < 100 && !handlers.has('seteuk:points'); i++) await new Promise((r) => setTimeout(r, 50))
  const s = await call('local:load')
  await call('local:save', { ...s, provider: 'exaone', exaone_key: 'TEST-EXAONE', gemini_key: '', openai_key: '', claude_key: '' })
  await call('seteuk:roster', 'subject', [{ id: '1-1', cls: '1', no: '1', name: '가나다' }, { id: '1-2', cls: '1', no: '2', name: '라마바' }])
  await call('seteuk:acts', [{ id: 'a1', name: '함수 탐구', rec: '과세특', bytes: 600, examples: [{ note: '가나다가 그래프를 그림', result: '그래프를 그려 설명함.' }] }])

  console.log('\n1. 보고서 요점')
  const long = '가나다는 이 보고서에서 우리 동네 버스 배차 간격을 조사하였다. '.repeat(8)
  script = [answer('요점입니다.\n- 버스 배차 간격을 조사함\n- 가나다가 표로 정리함')]
  let r = await call('seteuk:points', [{ id: '1-1', text: long }, { id: '1-2', text: '짧은 메모' }], null)
  ok(r.ok && log.length === 1, '긴 글만 보냄 (짧은 글은 보내지 않음)')
  ok(r.out[0].text === '[보고서 요점]\n- 버스 배차 간격을 조사함\n- 가나다가 표로 정리함' && r.out[1].text === '짧은 메모', '요점은 머리표와 함께 · 가명은 이름으로 되돌림')
  const body = JSON.stringify(log[0].body)
  ok(!body.includes('가나다') && body.includes('학생') && log[0].body.messages[0].content.includes('# 할 일'), '보낼 때 이름을 가림 · 요점 규칙')
  script = [() => json({ error: { message: 'x' } }, 401)]
  r = await call('seteuk:points', [{ id: '1-1', text: long }], null)
  ok(r.out[0].text === long.trim() && r.out[0].error, '실패하면 원문을 그대로 · 까닭과 함께')
  script = [answer('목록이 아닌 답')]
  r = await call('seteuk:points', [{ id: '1-1', text: long }], null)
  ok(r.out[0].text === long.trim() && /원문/.test(r.out[0].error), '요점을 못 받으면 원문')

  console.log('\n2. Gem · GPT · 프로젝트 지침')
  const before = log.length
  const g = await call('seteuk:gem', 'a1')
  ok(g.ok && g.text.includes('# 서술 규칙') && g.text.includes('# 사용법') && g.text.includes('# 예시') && log.length === before, '규칙 · 예시 · 사용법 (AI 로 보내지 않음)')
  ok(!g.text.includes('가나다') && !g.text.includes('라마바'), '예시에 든 이름도 가림')
  ok(!(await call('seteuk:gem', 'none')).ok, '없는 활동')

  console.log('\n3. Claude 스킬 파일')
  const out = path.join(USER_DATA, 'skill-test.zip')
  next.save.push(out)
  const k = await call('seteuk:skill', 'a1')
  ok(k.ok && fs.existsSync(out), `저장: ${k.message}`)
  const files = unzipSync(new Uint8Array(fs.readFileSync(out)))
  const skill = strFromU8(files['saeteuk-subject-1/SKILL.md'] || new Uint8Array())
  ok(skill.startsWith('---\nname: saeteuk-subject-1\n') && skill.includes('# 함수 탐구 — ') && skill.includes('# 서술 규칙') && !skill.includes('가나다'), 'zip 안에 폴더/SKILL.md · 이름 가림')
  const c = await call('seteuk:skill', 'a1')
  ok(!c.ok && c.message === '취소했습니다.', '저장 창을 닫으면 취소')

  console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
