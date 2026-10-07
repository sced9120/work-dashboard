import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyTheme } from './lib/theme'
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
