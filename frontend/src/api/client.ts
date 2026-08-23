// 统一 API client: 每次请求带 Authorization Bearer; 401 → 清 token 并跳认证中心
// 业务模块只调用本文件, 不感知 SSO 细节

import { getToken, redirectToAuth } from '@/auth/sso'

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

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  if (res.status === 401) {
    // 未登录或登录已过期 → 跳认证中心(回跳当前页)
    redirectToAuth()
    throw new ApiError(401, '未登录或登录已过期')
  }
  if (res.status === 204) return undefined as T

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new ApiError(res.status, (data.error as string) || `HTTP ${res.status}`)
  }
  return data as T
}
