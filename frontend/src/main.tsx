import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './fonts/fonts.css'
import './styles/style.css'

// 启动探测登录态: 调一次 /api/me; 未登录交给标准 SSO 流程 (后端 /sso/login)。
// token 全在服务端, 前端只认 cookie。
async function bootstrap(): Promise<void> {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' })
    if (res.status === 401) {
      window.location.href = '/sso/login'
      return
    }
  } catch {
    // 网络异常不阻塞渲染
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void bootstrap()
