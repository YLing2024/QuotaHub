import type { SessionUser } from '../services/ssoService.js'

// 让 req.user 可用 (会话中间件注入身份)
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser
    }
  }
}

export {}
