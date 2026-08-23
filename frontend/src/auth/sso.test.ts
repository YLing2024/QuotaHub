import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  TOKEN_KEY,
  authCenterUrl,
  buildAuthRedirect,
  captureTokenFromLocation,
  clearToken,
  extractToken,
  getToken,
  saveToken,
  stripTokenUrl,
} from './sso'

// 注入式内存存储(测试不触碰真实 localStorage)
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  }
}

describe('extractToken', () => {
  it('从 query ?token= 提取', () => {
    expect(extractToken('?token=abc123', '')).toBe('abc123')
  })

  it('从 fragment #token= 提取并 decodeURIComponent', () => {
    expect(extractToken('', '#token=ab%2Bcd')).toBe('ab+cd')
  })

  it('fragment 优先于 query', () => {
    expect(extractToken('?token=query-tok', '#token=frag-tok')).toBe('frag-tok')
  })

  it('无 token 返回 null', () => {
    expect(extractToken('?foo=1', '#other')).toBeNull()
    expect(extractToken('', '')).toBeNull()
  })

  it('query 中无 token 键返回 null', () => {
    expect(extractToken('?foo=bar&baz=qux', '')).toBeNull()
  })
})

describe('token 存取(注入 storage)', () => {
  it('saveToken/getToken/clearToken', () => {
    const s = memoryStorage()
    expect(getToken(s)).toBe('')
    saveToken('tok-1', s)
    expect(getToken(s)).toBe('tok-1')
    clearToken(s)
    expect(getToken(s)).toBe('')
  })

  it('使用的键名为 auth_token', () => {
    const s = memoryStorage()
    saveToken('x', s)
    expect(s._map.has(TOKEN_KEY)).toBe(true)
  })
})

describe('captureTokenFromLocation', () => {
  it('捕获 token: 存储 + replaceState 清地址栏 + 返回 token', () => {
    const s = memoryStorage()
    const replaceState = vi.fn()
    const historyLike = { replaceState } as unknown as History
    const token = captureTokenFromLocation(
      { search: '?token=tok-abc', hash: '', pathname: '/index.html' },
      s,
      historyLike,
    )
    expect(token).toBe('tok-abc')
    expect(getToken(s)).toBe('tok-abc')
    // 清地址栏: 只保留 pathname, 不带 query/hash
    expect(replaceState).toHaveBeenCalledWith(null, '', '/index.html')
  })

  it('fragment 形式同样处理', () => {
    const s = memoryStorage()
    const replaceState = vi.fn()
    const token = captureTokenFromLocation(
      { search: '', hash: '#token=f-tok', pathname: '/' },
      s,
      { replaceState } as unknown as History,
    )
    expect(token).toBe('f-tok')
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
  })

  it('无 token 时不写存储、不动地址栏', () => {
    const s = memoryStorage()
    const replaceState = vi.fn()
    const token = captureTokenFromLocation(
      { search: '?foo=1', hash: '', pathname: '/x' },
      s,
      { replaceState } as unknown as History,
    )
    expect(token).toBeNull()
    expect(replaceState).not.toHaveBeenCalled()
    expect(s._map.size).toBe(0)
  })
})

describe('buildAuthRedirect / authCenterUrl', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_AUTH_CENTER_URL', 'https://auth.example.com/auth')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('redirect 参数被 encodeURIComponent 编码', () => {
    const url = buildAuthRedirect('http://127.0.0.1:3000/?x=1&y=中文')
    expect(url.startsWith('https://auth.example.com/auth?redirect=')).toBe(true)
    expect(url).toContain(encodeURIComponent('http://127.0.0.1:3000/?x=1&y=中文'))
  })

  it('authCenterUrl 读环境变量', () => {
    expect(authCenterUrl()).toBe('https://auth.example.com/auth')
  })

  it('环境变量未配置时回退占位域名(不携带私有域名)', () => {
    vi.stubEnv('VITE_AUTH_CENTER_URL', '')
    expect(authCenterUrl()).toBe('https://auth.example.com/auth')
    expect(authCenterUrl()).toMatch(/^https:\/\/auth\.example\.com\//)
  })
})

describe('stripTokenUrl', () => {
  it('仅保留 pathname', () => {
    expect(stripTokenUrl('/index.html')).toBe('/index.html')
  })
})
