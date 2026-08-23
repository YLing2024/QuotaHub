import { Router } from 'express'
import { z } from 'zod'
import { platformRepo } from '../repositories/index.js'
import { historyRepo } from '../repositories/index.js'
import { platformService, HttpError } from '../services/platformService.js'
import { monitorService } from '../services/monitorService.js'
import { logService } from '../services/logService.js'
import { fetchBalance } from '../lib/fetcher.js'

// 平台资源路由 (薄层: 参数信封校验 + 调 service + 响应)
// 注意: /reorder 与 /balances 必须注册在 /:id 之前

// 信封校验: 请求体必须是对象; 字段级规范化(截断/trim/默认值)由 service 按旧规则处理
const platformBodySchema = z
  .object({
    name: z.unknown().optional(),
    url: z.unknown().optional(),
    request: z.unknown().optional(),
    handler: z.unknown().optional(),
    extractor: z.unknown().optional(),
    parse: z.unknown().optional(),
    display: z.unknown().optional(),
  })
  .loose()

const reorderSchema = z.object({ ids: z.array(z.unknown()) })

function bodyObject(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}
}

function sendError(res: import('express').Response, e: unknown): void {
  const err = e as { status?: number; message?: string }
  res.status(err.status ?? 400).json({ error: err.message ?? String(e) })
}

export function createPlatformsRouter(): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(platformService.listPlatforms())
  })

  // 平台排序: ids 必须是现有平台 id 的完整排列(同时影响监控面板卡片顺序)
  router.put('/reorder', (req, res) => {
    const parsed = reorderSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      sendError(res, new HttpError(400, '需要 ids 数组'))
      return
    }
    try {
      platformService.reorderPlatforms(parsed.data.ids)
      logService.log('reorder', `调整平台排序`, { meta: { count: parsed.data.ids.length } })
      res.json({ ok: true })
    } catch (e) {
      sendError(res, e)
    }
  })

  router.post('/', (req, res) => {
    const parsed = platformBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      sendError(res, new HttpError(400, '请求体必须是 JSON 对象'))
      return
    }
    try {
      const created = platformService.createPlatform(parsed.data)
      logService.log('create', `新增平台「${created.name}」`, {
        platformId: created.id,
        platformName: created.name,
      })
      res.status(201).json(created)
    } catch (e) {
      sendError(res, e)
    }
  })

  // 面板数据: 最新值取自历史采样最新点
  router.get('/balances', (_req, res) => {
    res.json(monitorService.buildDashboard())
  })

  // 立即刷新全部平台
  router.post('/refresh', async (_req, res) => {
    const results = await monitorService.refreshAll()
    res.json(results)
  })

  // 抓取配置验证(不保存、不写历史)
  router.post('/validate', async (req, res) => {
    const body = bodyObject(req.body ?? {})
    try {
      const result = await fetchBalance(body as Parameters<typeof fetchBalance>[0])
      res.json({ ok: true, ...result })
    } catch (e) {
      res.status(502).json({ ok: false, error: (e as Error).message })
    }
  })

  router.put('/:id', (req, res) => {
    const parsed = platformBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      sendError(res, new HttpError(400, '请求体必须是 JSON 对象'))
      return
    }
    try {
      const updated = platformService.updatePlatform(req.params.id, parsed.data)
      logService.log('update', `更新平台「${updated.name}」`, {
        platformId: updated.id,
        platformName: updated.name,
      })
      res.json(updated)
    } catch (e) {
      sendError(res, e)
    }
  })

  router.delete('/:id', (req, res) => {
    try {
      const removed = platformService.deletePlatform(req.params.id)
      historyRepo.remove(removed.id)
      logService.log('delete', `删除平台「${removed.name}」`, {
        platformId: removed.id,
        platformName: removed.name,
      })
      res.status(204).end()
    } catch (e) {
      sendError(res, e)
    }
  })

  // 单平台测试(不写历史): 返回 testedAt
  router.post('/:id/test', async (req, res) => {
    const p = platformRepo.getAll().find((x) => x.id === req.params.id)
    if (!p) {
      sendError(res, new HttpError(404, '平台不存在'))
      return
    }
    try {
      const result = await fetchBalance(p)
      res.json({ ok: true, ...result, testedAt: new Date().toISOString() })
    } catch (e) {
      res.status(502).json({ ok: false, error: (e as Error).message })
    }
  })

  // 单平台抓取并记录采样点
  router.post('/:id/fetch', async (req, res) => {
    try {
      const outcome = await monitorService.fetchOne(req.params.id)
      if (outcome.ok) {
        res.json({ ok: true, value: outcome.value, fetchedAt: outcome.fetchedAt })
      } else {
        res.status(502).json({ ok: false, error: outcome.error })
      }
    } catch (e) {
      sendError(res, e)
    }
  })

  // 折线图采样点: {id, name, points:[{v,t}...] 时间升序}
  router.get('/:id/history', (req, res) => {
    try {
      const view = platformService.historyView(req.params.id, historyRepo.get(req.params.id))
      res.json(view)
    } catch (e) {
      sendError(res, e)
    }
  })

  return router
}
