import path from 'node:path'
import fs from 'node:fs'
import express, { Express } from 'express'
import { config } from './config.js'
import { requireToken } from './middleware/auth.js'
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

  const staticDir = resolveStaticDir()
  if (staticDir) {
    app.use(express.static(staticDir))
  }

  // 可选鉴权: 设置 QUOTAHUB_TOKEN 后, /api/* 需要 Bearer/X-Quotahub-Token/X-Auth-Token 令牌
  app.use('/api', requireToken)

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
