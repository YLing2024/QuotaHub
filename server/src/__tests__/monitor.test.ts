import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

process.env.QUOTAHUB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-monitor-'))

const { monitorService } = await import('../services/monitorService.js')
const { platformRepo } = await import('../repositories/index.js')
const { historyRepo } = await import('../repositories/index.js')
const { closeDb } = await import('../db/connection.js')
const { initSchema } = await import('../db/init.js')

initSchema()

afterAll(() => {
  closeDb()
})

// 通过桩替换 global.fetch 控制 fetchBalance 结果 (不发起真实网络请求)
const realFetch = globalThis.fetch
function stubFetch(impl: (...args: unknown[]) => Promise<Response>): void {
  globalThis.fetch = impl as typeof fetch
}
afterEach(() => {
  globalThis.fetch = realFetch
})

function addPlatform(id: string, name: string, handler?: string, format?: string): void {
  const list = platformRepo.getAll()
  const p: Record<string, unknown> = {
    id,
    name,
    request: { method: 'GET', url: 'https://mock.test/api', headers: {} },
    handler: handler ?? 'function (raw) { return JSON.parse(raw).balance }',
    extractor: '',
    parse: '',
    createdAt: new Date().toISOString(),
  }
  if (format !== undefined) p.format = format
  list.push(p as never)
  platformRepo.saveAll(list)
}

describe('monitorService 采集流程 (fetcher -> history_samples)', () => {
  it('collect 成功 -> 写采样点并反映到面板', async () => {
    addPlatform('mp1', '平台一')
    stubFetch(async () => new Response(JSON.stringify({ balance: 42.5 }), { status: 200 }))

    const outcome = await monitorService.collect(platformRepo.getAll()[0]!)
    expect(outcome.ok).toBe(true)
    expect(outcome.value).toBe(42.5)

    const dash = monitorService.buildDashboard()
    const card = dash.platforms.find((p) => p.id === 'mp1')!
    expect(card.value).toBeCloseTo(42.5)
    expect(card.format).toBeNull()
    expect(card.error).toBeNull()
    expect(card.fetchedAt).toBeTruthy()
    expect(historyRepo.get('mp1').length).toBe(1)
  })

  it('collect 字符串返回(配置错误) -> 失败并提示必须返回数字', async () => {
    addPlatform('mpstr', '字符串平台', 'function (raw) { return "28.12元" }')
    const p = platformRepo.getAll().find((x) => x.id === 'mpstr')!
    stubFetch(async () => new Response(JSON.stringify({ x: 1 }), { status: 200 }))
    const outcome = await monitorService.collect(p)
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('处理函数必须返回数字')

    const card = monitorService.buildDashboard().platforms.find((c) => c.id === 'mpstr')!
    expect(card.format).toBeNull()
    expect(card.error).toContain('处理函数必须返回数字')
    // 字符串不入历史
    expect(historyRepo.get('mpstr')).toEqual([])
  })

  it('collect 数字 + 配置 format -> 面板 format 原样透传源码, value 为数值(不执行 format)', async () => {
    addPlatform(
      'mpfmt',
      '带格式平台',
      'function (raw) { return JSON.parse(raw).balance }',
      'function (v) { return v.toFixed(2) + "元" }',
    )
    const p = platformRepo.getAll().find((x) => x.id === 'mpfmt')!
    stubFetch(async () => new Response(JSON.stringify({ balance: 28.12 }), { status: 200 }))
    const outcome = await monitorService.collect(p)
    expect(outcome.ok).toBe(true)
    expect(outcome.value).toBeCloseTo(28.12)

    const card = monitorService.buildDashboard().platforms.find((c) => c.id === 'mpfmt')!
    expect(card.value).toBeCloseTo(28.12)
    expect(card.format).toBe('function (v) { return v.toFixed(2) + "元" }')
    expect(card.error).toBeNull()
    expect(historyRepo.get('mpfmt')).toEqual([expect.objectContaining({ v: 28.12 })])
  })

  it('format 源码原样透传(抛错/非字符串等执行问题交给前端兜底), 不炸面板', async () => {
    const badFmt = 'function (v) { throw new Error("x") }'
    const numFmt = 'function (v) { return v }'
    addPlatform('mpbadfmt', '坏格式平台', undefined, badFmt)
    addPlatform('mpnumfmt', '非字符串格式', undefined, numFmt)
    stubFetch(async () => new Response(JSON.stringify({ balance: 7 }), { status: 200 }))
    for (const id of ['mpbadfmt', 'mpnumfmt']) {
      const p = platformRepo.getAll().find((x) => x.id === id)!
      const outcome = await monitorService.collect(p)
      expect(outcome.ok).toBe(true)
    }
    const dash = monitorService.buildDashboard()
    const bad = dash.platforms.find((c) => c.id === 'mpbadfmt')!
    expect(bad.value).toBeCloseTo(7)
    expect(bad.format).toBe(badFmt)
    const num = dash.platforms.find((c) => c.id === 'mpnumfmt')!
    expect(num.value).toBeCloseTo(7)
    expect(num.format).toBe(numFmt)
  })

  it('collect 无 format 平台 -> format=null(前端 fmt 兜底)', async () => {
    addPlatform('mpnofmt', '无格式平台')
    const p = platformRepo.getAll().find((x) => x.id === 'mpnofmt')!
    stubFetch(async () => new Response(JSON.stringify({ balance: 42.5 }), { status: 200 }))
    const outcome = await monitorService.collect(p)
    expect(outcome.ok).toBe(true)
    const card = monitorService.buildDashboard().platforms.find((c) => c.id === 'mpnofmt')!
    expect(card.value).toBeCloseTo(42.5)
    expect(card.format).toBeNull()
  })

  it('collect 失败 -> 面板显示错误态; 恢复成功后回到数值', async () => {
    stubFetch(async () => {
      throw new TypeError('mock network down')
    })
    const p = platformRepo.getAll().find((x) => x.id === 'mp1')!
    const bad = await monitorService.collect(p)
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('mock network down')

    let card = monitorService.buildDashboard().platforms.find((c) => c.id === 'mp1')!
    expect(card.error).toContain('mock network down')

    // 恢复成功 -> 错误清除, 最新采样生效
    stubFetch(async () => new Response(JSON.stringify({ balance: 100 }), { status: 200 }))
    const good = await monitorService.collect(p)
    expect(good.ok).toBe(true)
    card = monitorService.buildDashboard().platforms.find((c) => c.id === 'mp1')!
    expect(card.error).toBeNull()
    expect(card.value).toBeCloseTo(100)
  })

  it('fetchOne 记录操作日志; 不存在平台抛 404', async () => {
    stubFetch(async () => new Response(JSON.stringify({ balance: 7 }), { status: 200 }))
    const outcome = await monitorService.fetchOne('mp1')
    expect(outcome.ok).toBe(true)

    try {
      await monitorService.fetchOne('no-such-id')
      throw new Error('should not reach')
    } catch (e) {
      expect((e as { status?: number }).status).toBe(404)
      expect((e as Error).message).toBe('平台不存在')
    }
  })

  it('refreshAll 汇总成功/失败并写日志', async () => {
    addPlatform('mr-fail', '会失败的平台')
    stubFetch((url: unknown) => {
      const u = String(url)
      if (u.includes('mock.test')) return Promise.resolve(new Response(JSON.stringify({ balance: 3 }), { status: 200 }))
      return Promise.reject(new Error('boom'))
    })
    // mr-fail 使用不同 URL 以触发失败分支
    const list = platformRepo.getAll()
    const failPlat = list.find((p) => p.id === 'mr-fail')!
    failPlat.request.url = 'https://fail.test/api'
    platformRepo.saveAll(list)

    const r = await monitorService.refreshAll()
    expect(r.ok).toBe(true)
    const okItem = r.results.find((x) => x.id === 'mp1')
    const failItem = r.results.find((x) => x.id === 'mr-fail')
    expect(okItem?.ok).toBe(true)
    expect(failItem?.ok).toBe(false)
    expect((failItem as { error?: string }).error).toContain('boom')
  })

  it('runOnce 无平台时直接返回; 定时调度 start/reschedule/stop 不抛错', async () => {
    await expect(monitorService.runOnce('test')).resolves.toBeUndefined()
    expect(() => monitorService.start()).not.toThrow()
    expect(() => monitorService.reschedule()).not.toThrow()
    monitorService.stop()
  })

  it('空平台列表的面板返回 updatedAt + 空数组', () => {
    const all = platformRepo.getAll()
    platformRepo.saveAll([])
    const dash = monitorService.buildDashboard()
    expect(dash.platforms).toEqual([])
    expect(new Date(dash.updatedAt).toString()).not.toBe('Invalid Date')
    platformRepo.saveAll(all)
  })
})
