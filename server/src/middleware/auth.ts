import type { NextFunction, Request, Response } from 'express'
import { config } from '../config.js'

// 应用层令牌鉴权 (纵深防御, nginx auth_request 探针之外的第二道防线)
// 设置 QUOTAHUB_TOKEN 后, /api/* 需要:
//   Authorization: Bearer <token>  或  X-Quotahub-Token: <token>  或  X-Auth-Token: <token>
// 默认不设则跳过鉴权 (与旧 index.js 行为一致)

export function requireToken(req: Request, res: Response, next: NextFunction): void {
  const token = config.token
  if (!token) return next()
  const auth = req.headers.authorization || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const headerToken = req.headers['x-quotahub-token']
  const altToken = req.headers['x-auth-token']
  if (
    bearer === token ||
    (typeof headerToken === 'string' && headerToken === token) ||
    (typeof altToken === 'string' && altToken === token)
  ) {
    return next()
  }
  res.status(401).json({ error: '未授权: 缺少或错误的访问令牌' })
}
