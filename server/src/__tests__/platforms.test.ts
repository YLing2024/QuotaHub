import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

process.env.QUOTAHUB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-platforms-'))

const { platformService, HttpError } = await import('../services/platformService.js')
const { platformRepo } = await import('../repositories/index.js')
const { closeDb } = await import('../db/connection.js')

afterAll(() => {
  closeDb()
})

const basePlatform = {
  name: '测试平台',
  request: { method: 'GET', url: 'https://example.com/api', headers: { Authorization: 'Bearer x' } },
  handler: 'function (raw) { return JSON.parse(raw).balance }',
}

function create(body: Record<string, unknown>): ReturnType<typeof platformService.createPlatform> {
  return platformService.createPlatform(body)
}

describe('platformService 平台 CRUD', () => {
  it('normalizePlatform 缺省值与旧实现一致(不再生成 display)', () => {
    const p = platformService.normalizePlatform({})
    expect(p.name).toBe('未命名平台')
    expect(p.request).toEqual({ method: 'GET', url: '', headers: {} })
    expect(p.handler).toBe('')
    expect(p).not.toHaveProperty('display')
    expect(p.url).toBe('')
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(new Date(p.createdAt).toString()).not.toBe('Invalid Date')
  })

  it('createPlatform 无处理函数 -> 400 中文错误', () => {
    try {
      create({ name: 'x', request: { url: 'https://a.b/c' } })
      throw new Error('should not reach')
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError)
      expect((e as HttpError).status).toBe(400)
      expect((e as Error).message).toBe('需要配置处理函数（或旧的提取/解析函数）')
    }
  })

  it('createPlatform 成功并落盘; listPlatforms 输出不含 display 的 PublicPlatform', () => {
    const created = create(basePlatform)
    expect(created.name).toBe('测试平台')
    expect(created).not.toHaveProperty('display')
    expect(platformRepo.getAll().length).toBe(1)
    const stored = platformRepo.getAll()[0]!
    expect(stored).not.toHaveProperty('display')
    const listed = platformService.listPlatforms()
    expect(listed[0]!.id).toBe(created.id)
    expect(listed[0]).not.toHaveProperty('display')
  })

  it('create 忽略 body.display(不落盘 legacy display); 旧条目 legacy 字段编辑后保留', () => {
    const created = create({ ...basePlatform, display: { prefix: '$', suffix: 'USD' } } as never)
    expect(created).not.toHaveProperty('display')
    // 存储中也不应生成 display
    const stored = platformRepo.getAll().find((p) => p.id === created.id)!
    expect(stored).not.toHaveProperty('display')
  })

  it('toPublic 剔除 legacy display 与 response.prefix/suffix; 存储仍保留 legacy', () => {
    platformRepo.saveAll([
      {
        id: 'legacy',
        name: '旧平台',
        request: { method: 'GET', url: '', headers: {} },
        handler: 'f',
        response: { path: 'data.x', prefix: '~', suffix: ' 元' },
        display: { prefix: '~', suffix: ' 元' },
        createdAt: new Date().toISOString(),
      } as never,
    ])
    const pub = platformService.listPlatforms()[0]!
    expect(pub).not.toHaveProperty('display')
    // response 内 prefix/suffix 不输出, path 等保留
    expect(pub.response).toEqual({ path: 'data.x' })
    // 存储层 legacy 字段原样保留(导入兼容), 不参与渲染与导出
    const stored = platformRepo.getAll()[0]!
    expect(stored.display).toEqual({ prefix: '~', suffix: ' 元' })
    expect(stored.response).toEqual({ path: 'data.x', prefix: '~', suffix: ' 元' })
  })

  it('updatePlatform 部分更新; handler 覆盖时清空 extractor/parse', () => {
    const created = create({
      name: 'P',
      request: { url: 'https://a.b/c' },
      extractor: 'function(d){return d.x}',
    })
    const updated = platformService.updatePlatform(created.id, {
      handler: 'function(r){return 42}',
    })
    // pickConfig(handler) 同时清掉旧字段
    const stored = platformRepo.getAll().find((p) => p.id === created.id)!
    expect(stored.handler).toContain('return 42')
    expect(stored.extractor).toBe('')
    expect(stored.parse).toBe('')
    expect(updated.name).toBe('P') // 未提供的字段保持

    platformService.updatePlatform(created.id, { name: 'P2', url: 'https://home.page' })
    const stored2 = platformRepo.getAll().find((p) => p.id === created.id)!
    expect(stored2.name).toBe('P2')
    expect(stored2.url).toBe('https://home.page')
  })

  it('updatePlatform 把处理函数全部清空 -> 400', () => {
    const created = create(basePlatform)
    try {
      platformService.updatePlatform(created.id, { handler: '  ' })
      throw new Error('should not reach')
    } catch (e) {
      expect((e as HttpError).status).toBe(400)
    }
  })

  it('updatePlatform/deletePlatform 不存在的 id -> 404 平台不存在', () => {
    try {
      platformService.updatePlatform('nope', {})
      throw new Error('should not reach')
    } catch (e) {
      expect((e as HttpError).status).toBe(404)
      expect((e as Error).message).toBe('平台不存在')
    }
    try {
      platformService.deletePlatform('nope')
      throw new Error('should not reach')
    } catch (e) {
      expect((e as HttpError).status).toBe(404)
    }
  })

  describe('reorderPlatforms 校验信息与旧版逐字一致', () => {
    const idsOf = () => platformRepo.getAll().map((p) => p.id)
    let idA = ''
    let idB = ''
    it('准备两个平台', () => {
      platformRepo.saveAll([])
      idA = create({ ...basePlatform, name: 'A' }).id
      idB = create({ ...basePlatform, name: 'B' }).id
    })
    it('非数组 -> 需要 ids 数组', () => {
      expect(() => platformService.reorderPlatforms('x')).toThrow('需要 ids 数组')
    })
    it('数量不匹配 -> ids 数量与现有平台不匹配', () => {
      expect(() => platformService.reorderPlatforms([idA])).toThrow(
        'ids 数量与现有平台不匹配',
      )
    })
    it('未知 id -> 未知平台 id: zzz', () => {
      expect(() => platformService.reorderPlatforms([idA, 'zzz'])).toThrow('未知平台 id: zzz')
    })
    it('重复项 -> ids 包含重复项', () => {
      expect(() => platformService.reorderPlatforms([idA, idA])).toThrow('ids 包含重复项')
    })
    it('正确排序生效', () => {
      platformService.reorderPlatforms([idB, idA])
      expect(idsOf()).toEqual([idB, idA])
    })
  })

  it('historyView 返回 {id,name,points}; 平台不存在 -> 404', async () => {
    const created = create(basePlatform)
    const view = platformService.historyView(created.id, [
      { v: 1, t: '2026-01-01T00:00:00.000Z' },
    ])
    expect(view).toEqual({
      id: created.id,
      name: '测试平台',
      points: [{ v: 1, t: '2026-01-01T00:00:00.000Z' }],
    })
    try {
      platformService.historyView('missing', [])
      throw new Error('should not reach')
    } catch (e) {
      expect((e as HttpError).status).toBe(404)
    }
  })
})
