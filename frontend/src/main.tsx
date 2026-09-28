import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './fonts/fonts.css'
import './styles/style.css'

// 登录由 Auth Gateway 负责: 页面直接渲染, 未登录时任何 /api 调用收到 401,
// 由统一 client 整页跳 /_auth/login (不再有启动探测与本地登录态)。
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
