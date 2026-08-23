import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

process.env.QUOTAHUB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-transfer-'))

const { transferService } = await import('../services/transferService.js')
const { platformRepo, presetRepo } = await import('../repositories/index.js')
const { closeDb } = await import('../db/connection.js')

afterAll(() => {
  closeDb()
})

const fullPlatform = {
  name: '导入平台',
  request: { method: 'GET', url: 'https://x.example/api', headers: { Authorization: 'Bearer k1' } },
  handler: 'function (raw) { return JSON.parse(raw).b }',
}

describe('transferService.exportConfig', () => {
  it('导出结构 type/version/platforms/presets', () => {
    const payload = transferService.exportConfig()
    expect(payload.type).toBe('quotahub-config')
    expect(payload.version).toBe(1)
    expect(new Date(payload.exportedAt).toString()).not.toBe('Invalid Date')
    expect(Array.isArray(payload.platforms)).toBe(true)
    expect(Array.isArray(payload.presets)).toBe(true)
  })
})

describe('transferService.importConfig 三种格式识别', () => {
  it('无法识别的格式 -> 400 中文错误', () => {
    try {
      transferService.importConfig({ hello: 'world' })
      throw new Error('should not reach')
    } catch (e) {
      expect((e as { status?: number }).status).toBe(400)
      expect((e as Error).message).toBe(
        '无法识别的配置格式: 需要完整配置(含 platforms/presets 数组)、单个平台或单个预设的 JSON',
      )
    }
  })

  it('单个平台导入(按 id upsert)', () => {
    const r1 = transferService.importConfig({ ...fullPlatform, id: 'imp-1' })
    expect(r1.platforms).toBe(1)
    expect(r1.errors).toEqual([])
    // 同 id 再导入 -> 覆盖
    transferService.importConfig({ ...fullPlatform, id: 'imp-1', name: '导入平台2' })
    const stored = platformRepo.getAll().find((p) => p.id === 'imp-1')
    expect(stored?.name).toBe('导入平台2')
    expect(platformRepo.getAll().filter((p) => p.id === 'imp-1').length).toBe(1)
  })

  it('单平台缺处理函数/脱敏凭据被拒并计入 errors', () => {
    const r = transferService.importConfig({
      platforms: [
        { name: '无函数', request: { url: 'https://x.example/a' } }, // 缺处理函数
        {
          name: '脱敏',
          request: { url: 'https://x.example/b', headers: { Authorization: '********' } },
          handler: 'f',
        },
        fullPlatform,
      ],
    })
    expect(r.platforms).toBe(1)
    expect(r.errors.length).toBe(2)
    expect(r.errors[0]).toContain('缺少处理函数')
    expect(r.errors[1]).toContain('是脱敏占位符，请使用完整导出（含真实凭据）的 JSON 导入')
  })

  it('旧版 response.path 模型允许导入', () => {
    const r = transferService.importConfig({
      name: '旧模型',
      request: { url: 'https://x.example/c' },
      response: { path: 'data.quota', divider: 500000 },
    })
    expect(r.platforms).toBe(1)
    const stored = platformRepo.getAll().find((p) => p.name === '旧模型')
    expect(stored?.response?.path).toBe('data.quota')
    expect(typeof stored?.handler).toBe('string')
  })

  it('单个预设导入(isPresetLike)', () => {
    const r = transferService.importConfig({
      id: 'preset-imp-1',
      name: '导入预设',
      fields: [{ key: 'token', label: '令牌' }],
      urlTemplate: '{{baseUrl}}/x',
      headersTemplate: {},
      extractorTemplate: 'function(d){return d.b}',
    })
    expect(r.presets).toBe(1)
    expect(presetRepo.getAll().some((p) => p.id === 'preset-imp-1')).toBe(true)
  })

  it('完整配置混合导入: 单项失败不影响其他项', () => {
    const r = transferService.importConfig({
      platforms: [fullPlatform, { bad: true }],
      presets: [
        { name: '坏预设' }, // 缺字段
        {
          name: '好预设',
          fields: [{ key: 'k', label: 'K' }],
          urlTemplate: 'u',
          headersTemplate: '{}',
          extractorTemplate: 'e',
        },
      ],
    })
    expect(r.ok).toBe(true)
    expect(r.platforms).toBe(1)
    expect(r.presets).toBe(1)
    expect(r.errors.length).toBe(2)
    // 好预设确实入库
    expect(presetRepo.getAll().some((p) => p.name === '好预设')).toBe(true)
  })
})
