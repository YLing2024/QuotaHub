import type { NextFunction, Request, Response } from 'express'

// 业务侧唯一鉴权：用户身份由 Auth Gateway 注入请求头 `X-Auth-User`
// （网关会先剥掉客户端伪造的同名头，见 NEW-AUTH-CONVENTION）。
// 头缺失或为空 → 401（不 302、不 500、不自己跳登录）。

export interface AuthUser {
  name: string
}

export function requireAuthUser(req: Request, res: Response, next: NextFunction): void {
  const raw = req.headers['x-auth-user']
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!name) {
    res.status(401).json({ error: '未登录' })
    return
  }
  req.user = { name }
  next()
}
