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

function addPlatform(id: string, name: string): void {
  const list = platformRepo.getAll()
  list.push({
    id,
    name,
    request: { method: 'GET', url: 'https://mock.test/api', headers: {} },
    handler: 'function (raw) { return JSON.parse(raw).balance }',
    extractor: '',
    parse: '',
    display: { prefix: '', suffix: '' },
    createdAt: new Date().toISOString(),
  })
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
    expect(card.balance).toBeCloseTo(42.5)
    expect(card.error).toBeNull()
    expect(card.fetchedAt).toBeTruthy()
    expect(historyRepo.get('mp1').length).toBe(1)
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
    expect(card.balance).toBeCloseTo(100)
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
