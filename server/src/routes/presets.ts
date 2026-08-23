import { Router } from 'express'
import { z } from 'zod'
import { presetService } from '../services/presetService.js'

// 预设路由: GET/POST /api/presets, PUT/DELETE /api/presets/:id, POST /api/presets/:id/reset
// 业务校验(名称/字段/模板等, 含旧版逐条中文错误信息)在 presetService.validatePreset

// 信封校验: 请求体必须是对象; 字段级规则由 service 处理
const presetBodySchema = z.object({}).loose()

function first400(res: import('express').Response, e: unknown): void {
  const err = e as { status?: number; message?: string }
  res.status(err.status ?? 400).json({ error: err.message ?? String(e) })
}

export function createPresetsRouter(): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(presetService.listPresets())
  })

  router.post('/', (req, res) => {
    const parsed = presetBodySchema.safeParse(req.body)
    if (!parsed.success) {
      first400(res, new Error('请求体必须是 JSON 对象'))
      return
    }
    try {
      const item = presetService.createPreset(parsed.data)
      res.status(201).json(item)
    } catch (e) {
      first400(res, e)
    }
  })

  router.put('/:id', (req, res) => {
    const parsed = presetBodySchema.safeParse(req.body)
    if (!parsed.success) {
      first400(res, new Error('请求体必须是 JSON 对象'))
      return
    }
    try {
      const item = presetService.upsertPreset(req.params.id, parsed.data)
      res.json(item)
    } catch (e) {
      first400(res, e)
    }
  })

  router.delete('/:id', (req, res) => {
    try {
      presetService.deletePreset(req.params.id)
      res.status(204).end()
    } catch (e) {
      first400(res, e)
    }
  })

  router.post('/:id/reset', (req, res) => {
    try {
      res.json(presetService.resetPreset(req.params.id))
    } catch (e) {
      first400(res, e)
    }
  })

  return router
}
