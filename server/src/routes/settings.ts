import { Router } from 'express'
import { z } from 'zod'
import { settingsService } from '../services/settingsService.js'
import { monitorService } from '../services/monitorService.js'
import { logService } from '../services/logService.js'

// 设置路由: GET /api/settings, PUT /api/settings
// PUT 后重新排程定时采集; 间隔变化时记录操作日志 (与旧行为一致)

// 信封校验: 请求体必须是对象; 数值合法性(>=0 且钳制 86400)由 service 按旧规则处理
const putBodySchema = z.object({}).loose()

export function createSettingsRouter(): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(settingsService.getSettings())
  })

  router.put('/', (req, res) => {
    const parsed = putBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: '请求体必须是 JSON 对象' })
      return
    }
    const before = settingsService.getSettings()
    const next = settingsService.updateSettings(parsed.data)
    monitorService.reschedule()
    const interval = next.collectIntervalSeconds
    if (before.collectIntervalSeconds !== interval) {
      logService.log('settings', `自动采集间隔设置为 ${interval} 秒${interval === 0 ? '（已关闭）' : ''}`, {
        meta: { from: before.collectIntervalSeconds, to: interval },
      })
    }
    res.json(next)
  })

  return router
}
