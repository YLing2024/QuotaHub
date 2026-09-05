import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { captureTokenFromLocation } from './auth/sso'
import './fonts/fonts.css'
import './styles/style.css'

// SSO 回跳处理: 提取 ?token= / #token= → 存 localStorage → history.replaceState 清地址栏
captureTokenFromLocation()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
