import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyTheme } from './lib/theme'
import { installWindowErrorLog } from './components/ErrorBoundary'
// 글꼴은 앱에 넣어 둔다(학교망 · 오프라인에서도 같은 모양). 모두 SIL OFL.
//  학교 안심폰트(KERIS) — 케리스 배움체: 화면 글 · 본문, 학교안심 산뜻돋움: 제목 · 큰 숫자 (src/assets/fonts/keris)
//  Pretendard — 두 글꼴에 없는 기호의 받침, Nunito — 영문 이름 HSOrbit (로고와 같은 글꼴)
import './assets/fonts/keris/fonts.css'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import '@fontsource/nunito/latin-600.css'
import '@fontsource/nunito/latin-800.css'
import './styles.css'
import './themes.css'
import './tour.css'

// 첫 화면을 그리기 전에 고른 테마를 단다 (그래야 깜빡이지 않는다)
applyTheme()
installWindowErrorLog()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
