// shared/seteuk.ts — 내 규칙(끈 검사 · 내 금지어 · 더할 규칙 · 뺄 칸) (빌드 없이). 이름은 지어낸 것
const { loadShared: load } = require('./tsload.cjs')
const S = load('seteuk.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

console.log('1. 읽기 · 기본값')
const d = S.defaultConfig()
ok(d.off.length === 0 && d.mine.length === 0 && d.sections.avoid && d.sections.frame && d.sections.view, '처음엔 모두 켜짐')
const bad = S.readConfig(JSON.stringify({ off: ['없는 규칙', S.RULE_GROUPS[0].rules[0].re], mine: [{ words: ' 열정적 ', level: 'x' }, { words: '' }], sections: { avoid: false }, extra: 5 }))
ok(bad.off.length === 1 && bad.mine.length === 1 && bad.mine[0].level === 'check' && bad.mine[0].words === '열정적' && !bad.sections.avoid && bad.sections.frame && bad.extra === '5', '모르는 규칙 · 빈 금지어는 버리고 틀린 값은 기본값')
ok(S.readConfig('망가짐').sections.view === true, '망가진 설정')
ok(S.RULE_GROUPS.map((g) => g.key).join() === 'neis,format,ai' && S.RULE_GROUPS.every((g) => g.rules.length > 0), '기본 검사 세 묶음')

console.log('\n2. 검사')
const text = '학급 회의에서 리더십을 발휘함. 토익 점수를 말함. 이를 통해 협력함.'
let v = S.validateSeteuk(text, 0)
ok(v.issues.some((x) => x.label === '공인어학시험') && v.issues.some((x) => x.label.startsWith('AI 투')), '기본 — 기재 금지 · AI 말투')
const toeic = S.RULE_GROUPS[0].rules.find((r) => r.label === '공인어학시험').re
S.setSeteukConfig({ ...S.defaultConfig(), off: [toeic], mine: [{ words: '리더십을 발휘함, 솔선수범', level: 'block', why: '우리 학교에서 쓰지 않음' }] })
v = S.validateSeteuk(text, 0)
ok(!v.issues.some((x) => x.label === '공인어학시험'), '끈 검사는 걸리지 않음')
const mine = v.issues.find((x) => x.label === '내 금지어')
ok(mine && mine.level === 'block' && mine.hit === '리더십을 발휘함' && mine.why === '우리 학교에서 쓰지 않음' && !v.ok, '내 금지어 — 고침 수준 · 이유')
ok(S.validateSeteuk('a.b(c)', 0) && S.myRules({ ...S.defaultConfig(), mine: [{ words: 'a.b(c)', level: 'check', why: '' }] })[0].re === 'a\\.b\\(c\\)', '낱말 속 기호는 글자 그대로 찾음')
ok(S.validateSeteuk('글 a.b(c) 끝.', 0, S.myRules({ ...S.defaultConfig(), mine: [{ words: 'a.b(c)', level: 'check', why: '' }] })).issues.length === 1 && S.validateSeteuk('axb(c)', 0, S.myRules({ ...S.defaultConfig(), mine: [{ words: 'a.b(c)', level: 'check', why: '' }] })).issues.length === 0, '점은 아무 글자가 아님')
ok(S.wordsOf('가, 나，다、라\n마,,') .join() === '가,나,다,라,마', '쉼표 · 줄바꿈으로 나눔')

console.log('\n3. 쓰는 규칙')
const act = S.newActivity('x', { rec: '과세특' })
S.setSeteukConfig(S.defaultConfig())
const base = S.buildSeteukPrompt(act)
ok(base.includes('# 피할 표현') && base.includes('# 서술 관점과 역량') && base.includes('계기(수업 속 질문)'), '기본 — 모든 칸')
S.setSeteukConfig({ off: [], mine: [{ words: '열정적, 솔선수범', level: 'check', why: '' }], extra: '- 한 문장은 80자를 넘기지 않는다\n\n수업 차시를 밝히지 않는다', sections: { avoid: false, frame: false, view: false } })
const p = S.buildSeteukPrompt(act)
ok(!p.includes('# 피할 표현') && !p.includes('# 서술 관점과 역량') && !p.includes('계기(수업 속 질문)'), '끈 칸은 빠짐')
ok(p.includes('- 한 문장은 80자를 넘기지 않는다\n- 수업 차시를 밝히지 않는다') && p.indexOf('수업 차시') < p.indexOf('# 학생부 기재 금지사항'), '더한 규칙은 서술 규칙 끝에 한 줄씩')
ok(p.includes('- 선생님이 정한 금지어: 열정적, 솔선수범'), '내 금지어는 기재 금지사항에')
ok(['# 역할', '# 서술 규칙', '# 학생부 기재 금지사항', '# 분량', '# 출력'].every((h) => p.includes(h)), '기재요령의 틀(서술 규칙 · 금지사항 · 분량 · 출력)은 늘 있음')
ok(S.buildSeteukPrompt(act, { config: S.defaultConfig() }).includes('# 피할 표현'), '설정을 넘겨 미리 보기')
S.setSeteukConfig(S.defaultConfig())

console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
process.exit(fails ? 1 : 0)
