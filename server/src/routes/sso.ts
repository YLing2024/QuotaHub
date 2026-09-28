import { Router, type Request, type Response } from 'express'
import { config } from '../config.js'
import { readCookie, serializeCookie } from '../lib/cookies.js'
import { ssoService } from '../services/ssoService.js'

// BFF 模式 SSO 路由: /sso/login, /sso/callback, /sso/logout 以及 /api/me。
// 换 token 全在服务端, 前端只拿到身份 { name, role }。

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 // 秒, 与 ssoService 的 7 天滑动一致

// 回调地址: 显式配置优先; 否则按反代头推导 (生产建议显式固定, 与认证中心注册精确一致)
export function resolveRedirectUri(req: Request): string {
  if (config.ssoRedirectUri) return config.ssoRedirectUri
  const forwarded = req.headers['x-forwarded-proto']
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded
  const proto = raw?.split(',')[0]?.trim() || req.protocol
  const host = req.get('host') || `${config.host}:${config.port}`
  return `${proto}://${host}/sso/callback`
}

function sessionCookie(value: string, maxAge: number): string {
  return serializeCookie(config.ssoCookieName, value, { maxAge })
}

export function createSsoRouter(): Router {
  const router = Router()

  // ① 生成 state + PKCE, 302 到认证中心 /authorize
  router.get('/login', (req, res) => {
    const { state, challenge } = ssoService.createAuthRequest()
    res.redirect(ssoService.buildAuthorizeUrl(resolveRedirectUri(req), state, challenge))
  })

  // ② 回调: 校验并消费 state -> 换 token -> 建站内会话 -> 种 cookie -> 回首页
  router.get('/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : ''
    const verifier = ssoService.consumeAuthState(state)
    if (!verifier) {
      res.status(400).json({ error: '无效或已过期的 state' })
      return
    }
    const code = typeof req.query.code === 'string' ? req.query.code : ''
    if (!code) {
      res.status(400).json({ error: '缺少授权码 code' })
      return
    }
    try {
      const tokens = await ssoService.exchangeCode({ code, redirectUri: resolveRedirectUri(req), verifier })
      const profile = await ssoService.fetchProfile(tokens.accessToken, tokens.idToken)
      const sid = ssoService.createSession({
        sub: profile.sub,
        name: profile.name,
        role: profile.role,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        exp: tokens.exp,
      })
      res.setHeader('Set-Cookie', sessionCookie(sid, SESSION_MAX_AGE))
      res.redirect('/')
    } catch {
      // 认证中心拒绝或网络异常: 统一 502, 不泄漏内部细节
      res.status(502).json({ error: '登录换取令牌失败' })
    }
  })

  // ③ 登出: 删站内会话 + 撤销 token + 清 cookie
  router.post('/logout', async (req, res) => {
    const sid = readCookie(req.headers.cookie, config.ssoCookieName)
    const session = ssoService.destroySession(sid)
    await ssoService.revokeSession(session)
    res.setHeader('Set-Cookie', sessionCookie('', 0))
    res.status(204).end()
  })

  return router
}

// ④ /api/me: 只认站内会话, 未登录 401 (前端"显示你是谁"只用这个)
export function createMeRouter(): Router {
  const router = Router()
  router.get('/', (req: Request, res: Response) => {
    const sid = readCookie(req.headers.cookie, config.ssoCookieName)
    const user = ssoService.getSession(sid)
    if (!user) {
      res.status(401).json({ error: '未登录' })
      return
    }
    res.json({ name: user.name, role: user.role })
  })
  return router
}
