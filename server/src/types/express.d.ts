import type { SessionUser } from '../services/ssoService.js'

// 让 req.user 可用 (会话中间件注入身份)
declare global {
  namespace Express {
    interface Request {
      user?: SessionUser
    }
  }
}

export {}
