import { Router } from 'express'
import { z } from 'zod'
import { logService } from '../services/logService.js'

// 操作日志路由: GET /api/logs, DELETE /api/logs
// ?limit= 控制条数(1~2000, 默认 200), 与旧行为一致

const MAX_LOGS = 2000

const listQuerySchema = z.object({
  limit: z
    .union([z.string(), z.array(z.string()), z.undefined()])
    .transform((v) => {
      const raw = Array.isArray(v) ? v.join(',') : v
      const n = Number(raw)
      // 旧实现: Number(limit) || 200 后钳制到 [1, MAX_LOGS]
      return Math.min(Math.max(Number(n) || 200, 1), MAX_LOGS)
    }),
})

export function createLogsRouter(): Router {
  const router = Router()

  router.get('/', (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query)
    const limit = parsed.success ? parsed.data.limit : 200
    res.json({ logs: logService.list(limit), total: logService.total() })
  })

  router.delete('/', (_req, res) => {
    logService.clear()
    logService.log('clear-logs', '操作日志已清空')
    res.status(204).end()
  })

  return router
}
