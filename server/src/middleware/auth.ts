import type { NextFunction, Request, Response } from 'express'
import { config } from '../config.js'
import { readSessionToken } from '../lib/cookies.js'
import { authService } from '../services/authService.js'

// 业务侧鉴权, 按 AUTH_MODE 分支:
// - builtin(默认): 校验自带会话 (Authorization: Bearer 或 cookie quotahub_session);
//   忽略 X-Auth-User, 不因外部头提权。
// - sso: 只认前置认证层注入的 X-Auth-User, 缺失/空 -> 401。
// 两种模式都不 302、不写登录态。

export interface AuthUser {
  name: string
}

// builtin: 从 Bearer / cookie 解析出有效会话用户名
export function resolveBuiltinUser(req: Request): string | null {
  const user = authService.verifySession(readSessionToken(req))
  return user ? user.name : null
}

function requireSsoUser(req: Request, res: Response, next: NextFunction): void {
  const raw = req.headers['x-auth-user']
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!name) {
    res.status(401).json({ error: '未登录' })
    return
  }
  req.user = { name }
  next()
}

function requireBuiltinUser(req: Request, res: Response, next: NextFunction): void {
  const name = resolveBuiltinUser(req)
  if (!name) {
    res.status(401).json({ error: '未登录' })
    return
  }
  req.user = { name }
  next()
}

export function requireAuthUser(req: Request, res: Response, next: NextFunction): void {
  if (config.authMode === 'sso') {
    requireSsoUser(req, res, next)
    return
  }
  requireBuiltinUser(req, res, next)
}
