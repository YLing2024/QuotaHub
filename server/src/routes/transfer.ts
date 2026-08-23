import { Router } from 'express'
import { z } from 'zod'
import { transferService } from '../services/transferService.js'

// 配置导入导出路由: GET /api/export, POST /api/import
// 格式识别与逐条校验在 transferService (完整配置/单平台/单预设 三种格式)

// 信封校验: 请求体必须是对象; 具体格式由 service 识别并逐条报错(与旧行为一致)
const importBodySchema = z.object({}).loose()

export function createTransferRouter(): Router {
  const router = Router()

  router.get('/export', (_req, res) => {
    res.json(transferService.exportConfig())
  })

  router.post('/import', (req, res) => {
    const parsed = importBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({
        error: '无法识别的配置格式: 需要完整配置(含 platforms/presets 数组)、单个平台或单个预设的 JSON',
      })
      return
    }
    try {
      res.json(transferService.importConfig(parsed.data))
    } catch (e) {
      const err = e as { status?: number; message?: string }
      res.status(err.status ?? 400).json({ error: err.message ?? String(e) })
    }
  })

  return router
}
