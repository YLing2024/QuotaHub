import type { AuthUser } from '../middleware/auth.js'

// 让 req.user 可用 (网关注入 X-Auth-User 后由鉴权中间件写入身份)
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export {}
