import path from 'node:path'
import fs from 'node:fs'
import express, { Express } from 'express'
import { config } from './config.js'
import { sessionOrToken } from './middleware/session.js'
import { createSsoRouter, createMeRouter } from './routes/sso.js'
import { createPlatformsRouter } from './routes/platforms.js'
import { createPresetsRouter } from './routes/presets.js'
import { createSettingsRouter } from './routes/settings.js'
import { createLogsRouter } from './routes/logs.js'
import { createTransferRouter } from './routes/transfer.js'

// 构造 express app: 静态资源 + /api 路由挂载 + 可选令牌鉴权 + 统一错误处理

function resolveStaticDir(): string | null {
  if (config.staticDir && fs.existsSync(config.staticDir)) return config.staticDir
  // 兜底: 从 CWD 与模块位置向上探测 public/
  const candidates = [
    path.resolve(process.cwd(), 'public'),
    path.resolve(process.cwd(), '..', 'public'),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir
  }
  return null
}

export function createApp(): Express {
  const app = express()

  app.use(express.json())

  // BFF SSO 端点 (免业务鉴权): /sso/login, /sso/callback, /sso/logout
  app.use('/sso', createSsoRouter())
  // /api/me 只认站内会话, 挂在业务鉴权之前 (未登录必须 401)
  app.use('/api/me', createMeRouter())

  const staticDir = resolveStaticDir()
  if (staticDir) {
    app.use(express.static(staticDir))
  }

  // 会话优先; 无会话退回原有令牌鉴权 (探针通道保留, 行为与改造前一致)
  app.use('/api', sessionOrToken)

  app.use('/api/platforms', createPlatformsRouter())
  app.use('/api/presets', createPresetsRouter())
  app.use('/api/logs', createLogsRouter())
  app.use('/api/settings', createSettingsRouter())
  app.use('/api', createTransferRouter())

  // 统一错误处理: 保持 JSON 响应风格
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = (err as { status?: number; statusCode?: number }).status ??
        (err as { statusCode?: number }).statusCode ?? 500
      if (res.headersSent) return
      res.status(status).json({ error: err.message || '服务器内部错误' })
    },
  )

  return app
}
