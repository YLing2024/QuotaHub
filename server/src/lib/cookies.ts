import type { Request } from 'express'

// 会话 cookie 读写工具 (builtin 模式)。不引入 cookie-parser, 手写解析足够。

export const SESSION_COOKIE = 'quotahub_session'

export interface SessionCookieOptions {
  path: string
  httpOnly: boolean
  sameSite: 'lax'
  secure: boolean
  maxAge: number
}

// Cookie 头形如 "a=1; b=2"; 只取第一段等号, 值做最小解码
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    if (!key || out[key] !== undefined) continue
    const raw = part.slice(eq + 1).trim()
    try {
      out[key] = decodeURIComponent(raw)
    } catch {
      out[key] = raw
    }
  }
  return out
}

// 是否 HTTPS 请求: 直连看 req.secure, 反代场景看 X-Forwarded-Proto
export function isSecureRequest(req: Request): boolean {
  if (req.secure) return true
  const proto = req.headers['x-forwarded-proto']
  const value = Array.isArray(proto) ? proto[0] : proto
  return typeof value === 'string' && value.split(',')[0]!.trim() === 'https'
}

// 优先 Authorization: Bearer, 其次 cookie; 均无则 null
export function readSessionToken(req: Request): string | null {
  const auth = req.headers.authorization
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim())
    const token = m?.[1]?.trim()
    if (token) return token
  }
  const cookie = parseCookieHeader(req.headers.cookie)[SESSION_COOKIE]
  return cookie ? cookie.trim() || null : null
}

export function sessionCookieOptions(
  secure: boolean,
  maxAgeSeconds: number,
): SessionCookieOptions {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: Math.max(0, Math.round(maxAgeSeconds)) * 1000,
  }
}
