// t_markdown.cjs 가 묶어 돌린다 — 화면에 그릴 HTML 을 서버 쪽에서 만들어 본다
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from '../src/components/Markdown'

// 링크를 누를 때만 쓰는 것 — 그리기에는 필요 없다
;(globalThis as unknown as { window: unknown }).window = { api: { shell: { open: () => undefined } } }

const cases: [string, string, (h: string) => boolean][] = [
  ['굵게 · 기울임 · 코드', '**굵게** 와 *기울임* 과 `a*b*c` 그리고 ~~지움~~', (h) => h.includes('<strong>굵게</strong>') && h.includes('<em>기울임</em>') && h.includes('<code>a*b*c</code>') && h.includes('<del>지움</del>')],
  ['스크립트는 글자로', '<script>alert(1)</script> <img src=x onerror=alert(1)>', (h) => !h.includes('<script') && h.includes('&lt;script&gt;') && !h.includes('<img')],
  ['링크는 http(s) 만', '[보기](https://example.com) [나쁜](javascript:alert(1)) https://a.kr/b.', (h) => h.includes('href="https://example.com"') && !h.includes('href="javascript') && h.includes('href="https://a.kr/b"')],
  ['겹친 목록', '- 하나\n  - 하나의 하나\n- 둘\n1. 첫째\n2. 둘째', (h) => h.includes('<ul><li>하나<ul><li>하나의 하나</li></ul></li><li>둘</li></ul><ol><li>첫째</li><li>둘째</li></ol>')],
  ['표 (칸 수가 달라도)', '| a | b |\n|---|---|\n| 1 |\n| 2 | 3 | 4 |', (h) => h.includes('<th>a</th><th>b</th>') && (h.match(/<td>/g) || []).length === 4],
  ['닫히지 않은 코드', '```js\nconst x = 1\n**굵게 아님**', (h) => h.includes('<pre class="md-code"><code>const x = 1\n**굵게 아님**</code></pre>')],
  ['제목 · 인용 · 줄', '## 제목\n> 인용\n> 둘째\n\n---\n끝', (h) => h.includes('<h4 class="md-h">제목</h4>') && h.includes('<blockquote') && h.includes('<hr/>')],
  ['수식', '행렬 $\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}$ 와 $x^2$', (h) => h.includes('(1 2; 3 4)') && h.includes('x²')],
  ['밑줄 낱말 안은 기울임 아님', 'file_name_here 와 _기울임_', (h) => h.includes('file_name_here') && h.includes('<em>기울임</em>')],
  ['빈 글', '', (h) => h === '<div class="md"></div>'],
  ['할 일 목록', '- [x] 끝남\n- [ ] 남음', (h) => h.includes('☑') && h.includes('☐')],
  ['줄바꿈', '첫 줄\n둘째 줄', (h) => h.includes('첫 줄<br/>둘째 줄')],
  ['깊게 들어간 것부터', '    - 깊은\n- 얕은', (h) => h.includes('깊은') && h.includes('얕은')],
  ['세 단계', '- a\n  - b\n    - c\n- d', (h) => h.includes('<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>')]
]
let fails = 0
for (const [name, md, check] of cases) {
  const h = renderToStaticMarkup(<Markdown text={md} />)
  const okk = check(h)
  if (!okk) fails++
  console.log(okk ? '  ✓' : '  ✗', name, okk ? '' : h)
}
// 오래 걸리지 않는지 (별표가 많은 긴 글)
const t0 = Date.now()
renderToStaticMarkup(<Markdown text={('*a ' + '**b '.repeat(50) + '\n').repeat(200)} />)
console.log(Date.now() - t0 < 1500 ? '  ✓' : '  ✗', `별표 많은 긴 글 ${Date.now() - t0}ms`)
console.log(fails ? `\n실패 ${fails}` : '\n모두 통과')
process.exit(fails ? 1 : 0)
