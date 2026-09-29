import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/store/useAuthStore'

// 本地登录页 (builtin 模式): 账号 + 口令, 失败提示, 429 显示倒计时。
// 未登录时只渲染本页, 登录成功后由 App 进入现有面板。

export default function LoginPage() {
  const login = useAuthStore((s) => s.login)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lockLeft, setLockLeft] = useState(0)

  // 锁定期倒计时
  useEffect(() => {
    if (lockLeft <= 0) return
    const timer = window.setInterval(() => {
      setLockLeft((n) => (n > 0 ? n - 1 : 0))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [lockLeft])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading || lockLeft > 0) return
    setLoading(true)
    setError('')
    try {
      await login(username, password)
      setPassword('')
    } catch (err) {
      if (err instanceof ApiError && err.status === 429 && err.retryAfter) {
        setLockLeft(err.retryAfter)
        setError('尝试过于频繁')
      } else {
        setError(err instanceof Error ? err.message : '登录失败')
      }
    } finally {
      setLoading(false)
    }
  }

  const disabled = loading || lockLeft > 0 || !username || !password

  return (
    <div className="auth">
      <div className="auth__panel">
        <div className="auth__brand">
          <span className="header__mark">QH</span>
          <h1 className="auth__title">QUOTAHUB</h1>
        </div>
        <div className="auth__line" />
        <p className="auth__desc">登录后查看与管理平台余额。</p>
        <form className="auth__form" onSubmit={(e) => void submit(e)}>
          <label className="field" htmlFor="auth-username">
            <span className="field__label">账号</span>
            <input
              className="field__input"
              id="auth-username"
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="field" htmlFor="auth-password">
            <span className="field__label">口令</span>
            <input
              className="field__input"
              id="auth-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <div className="auth__actions">
            <button type="submit" className="btn auth__submit" disabled={disabled}>
              {loading ? '登录中…' : '登录'}
            </button>
            <span className="auth__msg">
              {lockLeft > 0 ? `${error}，请 ${lockLeft} 秒后重试` : error}
            </span>
          </div>
        </form>
      </div>
      <footer className="footer footer--auth">
        <span>QUOTAHUB © 2026</span>
        <span>OPEN SOURCE · MIT LICENSE</span>
      </footer>
    </div>
  )
}
