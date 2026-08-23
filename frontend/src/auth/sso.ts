// ===== SSO 客户端核心（认证中心统一登录）=====
// 独立纯逻辑: token 提取/存取/清 URL/401 跳转; DOM 副作用集中在文件底部薄封装
// 认证中心地址走环境变量注入(开源仓库不携带私有域名):
//   构建时 VITE_AUTH_CENTER_URL=https://your-auth-center.example.com
//   未配置时回调占位(需部署方配置)
export function authCenterUrl(): string {
  const v = (import.meta.env.VITE_AUTH_CENTER_URL as string | undefined)?.trim()
  return v && v.length ? v : 'https://auth.example.com/auth'
}
export const TOKEN_KEY = 'auth_token'

// 从 URL 提取认证中心回跳的 token: OAuth2 风格 query ?token=(fragment #token= 兜底)
export function extractToken(search: string, hash: string): string | null {
  const frag = /^#token=([^&]+)/.exec(hash)
  if (frag) return decodeURIComponent(frag[1])
  return new URLSearchParams(search).get('token')
}

export interface TokenStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function getToken(storage: TokenStorage = defaultStorage()): string {
  return storage.getItem(TOKEN_KEY) || ''
}

export function saveToken(token: string, storage: TokenStorage = defaultStorage()): void {
  storage.setItem(TOKEN_KEY, token)
}

export function clearToken(storage: TokenStorage = defaultStorage()): void {
  storage.removeItem(TOKEN_KEY)
}

// 清地址栏 token(避免留在地址栏/浏览器历史), 返回清理后的 URL
export function stripTokenUrl(pathname: string): string {
  return pathname
}

export function applyReplaceState(url: string, historyLike: History = window.history): void {
  historyLike.replaceState(null, '', url)
}

// 页面加载时处理回跳 token: 有则存储并清地址栏, 返回是否捕获到 token
export function captureTokenFromLocation(
  loc: { search: string; hash: string; pathname: string } = window.location,
  storage: TokenStorage = defaultStorage(),
  historyLike: History = window.history,
): string | null {
  const token = extractToken(loc.search, loc.hash)
  if (token) {
    saveToken(token, storage)
    applyReplaceState(stripTokenUrl(loc.pathname), historyLike)
  }
  return token
}

// 构造认证中心跳转地址(带回跳当前页)
export function buildAuthRedirect(
  currentHref: string,
  authCenter = authCenterUrl(),
): string {
  return `${authCenter}?redirect=${encodeURIComponent(currentHref)}`
}

// 会话失效/未登录: 清 token 并跳认证中心
export function redirectToAuth(
  currentHref: string = window.location.href,
  storage: TokenStorage = defaultStorage(),
): void {
  clearToken(storage)
  if (typeof window !== 'undefined') {
    window.location.href = buildAuthRedirect(currentHref)
  }
}

function defaultStorage(): Storage {
  return window.localStorage
}
