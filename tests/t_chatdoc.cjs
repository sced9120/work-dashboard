// 업무 도우미의 한글 파일 묶음 — 여러 문서 · 너그러운 읽기, 양식 글의 모양 표시 걷어 내기, 말하는 사람 대조
const { loadShared: load } = require('./tsload.cjs')
const A = load('agent.ts')
const H = load('hwpform.ts')
const F = load('hwpfit.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

// 두 문서를 한 답에
const two = `두 문서를 만들었습니다.
<<<문서
양식: 학생선도위원회 진행 절차
파일이름: 제11회 진행 시나리오
내용:
일시 2026. 11. 11.
문서>>>
<<<문서
양식: 없음
파일이름: 제11회 사안 설명
내용:
학생A 흡연 사안
문서>>>`
const s = A.splitAnswer(two)
ok(s.docs.length === 2 && s.docs[0].form === '학생선도위원회 진행 절차' && s.docs[1].form === '' && s.docs[1].content.includes('흡연'), '묶음 두 개를 모두 읽음')
ok(s.text === '두 문서를 만들었습니다.' && s.doc === s.docs[0], '보여 줄 말 · 첫 문서')
// "내용:" 줄을 빠뜨린 묶음도 버리지 않음
const loose = A.splitAnswer('준비했습니다.\n<<<문서\n양식: 사안 설명\n파일이름: 사안\n1. 학생A : 흡연\n2. 학생B : 지각\n문서>>>')
ok(loose.docs.length === 1 && loose.docs[0].content.startsWith('1. 학생A') && loose.docs[0].fileName === '사안', '"내용:" 없이 머리글 뒤를 본문으로')
ok(A.splitAnswer('<<<문서\n본문: 글\n문서>>>').docs[0].content === '글', '"본문:" 도 받음')
ok(A.splitAnswer('그냥 답').docs.length === 0, '묶음 없음')
ok(A.docGuide([]).includes('묶음 두 개') && A.docGuide([]).includes('반드시 묶음'), '지침: 여러 문서 · 묶음 빠뜨리지 않기')

// 양식 글 앞의 모양 표시
ok(H.stripStyleLabel('(가운데 · 24pt · 굵게) 2026학년도 제11회') === '2026학년도 제11회', '(가운데 · 24pt · 굵게) 걷어 냄')
ok(H.stripStyleLabel('11pt · 굵게 — 1. 안내 및 국민의례') === '1. 안내 및 국민의례', '미리보기 꼴(— ) 도')
ok(H.stripStyleLabel('(의사봉 3타)') === '(의사봉 3타)' && H.stripStyleLabel('(학생 차례 후) 다음은') === '(학생 차례 후) 다음은', '본문의 괄호는 그대로')
const pc = H.parseComposed('[P0] (가운데 · 24pt · 굵게) 진행 절차\n[P1] (11pt · 굵게) 1. 안내\n[P2] ■ 인성부장 : 반갑습니다.')
ok(pc.items.map((i) => i.text).join('|') === '진행 절차|1. 안내|■ 인성부장 : 반갑습니다.', 'AI 답 읽을 때 걷어 냄')

// 말하는 사람
ok(F.speakerOf('■ 위 원 장 : 성원이') === '위원장' && F.speakerOf('◎위원장 : 교감') === '위원장' && F.speakerOf('1. 안내') === '', '화자 읽기')
const form = [
  { id: 'P0', text: '진행 절차', kind: 'text' },
  { id: 'P1', text: '■ 인성부장 : 반갑습니다.', kind: 'text' },
  { id: 'P2', text: '■ 위 원 장 : 성원이 되었으므로 개회를 선언합니다.', kind: 'text' }
]
const out = [
  { kind: 'p', sample: 'P0', text: '진행 절차' },
  { kind: 'p', sample: 'P1', text: '■ 담당자 : 반갑습니다.' },
  { kind: 'p', sample: 'P2', text: '■ 위원장 : 성원이 되었으므로 개회를 선언합니다.' }
]
const found = F.checkAgainstForm(form, out)
ok(found.some((f) => f.kind === '말하는 사람' && f.detail.startsWith('"담당자"')) && !found.some((f) => f.kind === '말하는 사람' && f.detail.startsWith('"위원장"')), "양식에 없는 화자 '담당자' 를 찾음 (띄어쓰기는 같게 봄)")

console.log(fails ? `\n${fails}개 실패` : '\n모두 통과')
process.exit(fails ? 1 : 0)
