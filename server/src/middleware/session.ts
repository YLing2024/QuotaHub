import type { NextFunction, Request, Response } from 'express'
import { config } from '../config.js'
import { readCookie } from '../lib/cookies.js'
import { ssoService, type SessionUser } from '../services/ssoService.js'
import { requireToken } from './auth.js'

// /api/* 会话中间件: 有有效站内会话 -> 放行并注入 req.user;
// 无会话 -> 退回原有 requireToken (探针/令牌通道保留, 行为与改造前一致)。

export function loadSession(req: Request): SessionUser | null {
  const sid = readCookie(req.headers.cookie, config.ssoCookieName)
  if (!sid) return null
  return ssoService.getSession(sid)
}

export function sessionOrToken(req: Request, res: Response, next: NextFunction): void {
  const user = loadSession(req)
  if (user) {
    req.user = user
    next()
    return
  }
  requireToken(req, res, next)
}
