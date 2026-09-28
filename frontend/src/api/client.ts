// 统一 API client: 同源请求自动带网关会话 cookie (credentials: same-origin),
// 不携带 Authorization。全局唯一 401 处理: 整页跳网关登录页, 不做弹窗/局部登录 UI/重试。

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface ApiOptions {
  method?: string
  body?: unknown
}

let redirecting = false

// 401 → 整页跳网关登录页, next 带回当前地址 (pathname + search)
function redirectToLogin(): void {
  if (redirecting) return
  redirecting = true
  const next = encodeURIComponent(window.location.pathname + window.location.search)
  window.location.href = `/_auth/login?next=${next}`
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'same-origin',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  if (res.status === 401) {
    redirectToLogin()
    throw new ApiError(401, '未登录或登录已过期')
  }

  if (res.status === 204) return undefined as T

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new ApiError(res.status, (data.error as string) || `HTTP ${res.status}`)
  }
  return data as T
}
