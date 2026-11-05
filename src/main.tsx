import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyTheme } from './lib/theme'
// 글꼴은 앱에 넣어 둔다(학교망 · 오프라인에서도 같은 모양). 모두 SIL OFL.
//  Pretendard — 본문 · 화면 글, Gowun Dodum — 제목 · 큰 숫자(hsorbit.uk 와 같은 결), Nunito — 영문 이름
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import '@fontsource/gowun-dodum/korean-400.css'
import '@fontsource/gowun-dodum/latin-400.css'
import '@fontsource/nunito/latin-600.css'
import '@fontsource/nunito/latin-800.css'
import './styles.css'
import './themes.css'
import './tour.css'

// 첫 화면을 그리기 전에 고른 테마를 단다 (그래야 깜빡이지 않는다)
applyTheme()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
