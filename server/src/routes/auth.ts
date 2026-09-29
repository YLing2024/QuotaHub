import { Router, type Request, type RequestHandler, type Response } from 'express'
import { z } from 'zod'
import { config } from '../config.js'
import {
  SESSION_COOKIE,
  isSecureRequest,
  readSessionToken,
  sessionCookieOptions,
} from '../lib/cookies.js'
import { authService } from '../services/authService.js'

// 认证路由 (prefix /api/auth):
// - GET /api/auth-mode 免鉴权 (单独注册在 app 上)
// - builtin: POST /login, POST /logout, GET /me
// - sso: login/logout/me 一律 404 (登录态完全交给前置认证层)

const loginBodySchema = z.object({
  username: z.string(),
  password: z.string(),
})

export function authModeHandler(_req: Request, res: Response): void {
  res.json({ authMode: config.authMode })
}

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown'
}

// sso 模式下本地认证端点不存在
const builtinOnly: RequestHandler = (_req, res, next) => {
  if (config.authMode !== 'builtin') {
    res.status(404).json({ error: '未找到' })
    return
  }
  next()
}

export function createAuthRouter(): Router {
  const router = Router()
  router.use(builtinOnly)

  router.post('/login', (req, res) => {
    const parsed = loginBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(401).json({ error: '账号或密码错误' })
      return
    }
    const { username, password } = parsed.data
    const ip = clientIp(req)
    const retryAfter = authService.retryAfterSeconds(ip)
    if (retryAfter > 0) {
      res.status(429).json({ error: '尝试过于频繁', retryAfter })
      return
    }
    const session = authService.login(username, password)
    if (!session) {
      authService.recordLoginFailure(ip)
      res.status(401).json({ error: '账号或密码错误' })
      return
    }
    authService.resetLoginFailures(ip)
    const ttl = authService.sessionTtlSeconds()
    res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions(isSecureRequest(req), ttl))
    res.json({ ok: true, user: { name: session.username } })
  })

  // 幂等: 未登录也 200, 只负责删会话 + 清 cookie
  router.post('/logout', (req, res) => {
    authService.logout(readSessionToken(req))
    const opts = sessionCookieOptions(isSecureRequest(req), 0)
    res.clearCookie(SESSION_COOKIE, {
      path: opts.path,
      httpOnly: opts.httpOnly,
      sameSite: opts.sameSite,
      secure: opts.secure,
    })
    res.json({ ok: true })
  })

  router.get('/me', (req, res) => {
    const user = authService.verifySession(readSessionToken(req))
    if (!user) {
      res.status(401).json({ error: '未登录' })
      return
    }
    res.json({ name: user.name })
  })

  return router
}
