import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { TestServer } from './helpers.js'

// API 全链路等价性测试 (Express app 层, 独立临时数据目录)
process.env.QUOTAHUB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-api-core-'))

const { createApp } = await import('../app.js')
const { initSchema } = await import('../db/init.js')
const { closeDb } = await import('../db/connection.js')
const { historyRepo } = await import('../repositories/index.js')
const { monitorService } = await import('../services/monitorService.js')
const { startServer, req } = await import('./helpers.js')

initSchema()

let srv: TestServer
let base = ''

const realFetch = globalThis.fetch

beforeAll(async () => {
  srv = await startServer(createApp())
  base = srv.base
})

afterAll(async () => {
  monitorService.stop()
  await srv.close()
  closeDb()
})

// 通过桩替换全局 fetch 控制抓取结果
function stubFetchOk(value: number): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ balance: value }), { status: 200 })) as typeof fetch
}
function stubFetchFail(message: string): void {
  globalThis.fetch = (async () => {
    throw new Error(message)
  }) as typeof fetch
}
afterEach(() => {
  globalThis.fetch = realFetch
})

let pid = ''
let pidB = ''

describe('平台 CRUD API', () => {
  it('GET /api/platforms 初始为空数组', async () => {
    const r = await req<unknown[]>(base, 'GET', '/api/platforms')
    expect(r.status).toBe(200)
    expect(r.body).toEqual([])
  })

  it('POST 缺处理函数 -> 400 中文错误', async () => {
    const r = await req<{ error: string }>(base, 'POST', '/api/platforms', {
      name: '坏平台',
      request: { url: 'https://x.example/a' },
    })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('需要配置处理函数（或旧的提取/解析函数）')
  })

  it('POST 创建 -> 201 完整结构(无 display)', async () => {
    const r = await req<{
      id: string
      name: string
      request: { method: string; url: string }
      createdAt: string
    }>(base, 'POST', '/api/platforms', {
      name: '平台A',
      request: { url: 'https://mock.test/api', headers: { Authorization: 'Bearer k' } },
      handler: 'function (raw) { return JSON.parse(raw).balance }',
      url: 'https://a.example',
    })
    expect(r.status).toBe(201)
    expect(r.body.name).toBe('平台A')
    expect(r.body).not.toHaveProperty('display')
    expect(r.body.request.url).toBe('https://mock.test/api')
    expect(r.body.id).toMatch(/^[0-9a-f-]{36}$/)
    pid = r.body.id
  })

  it('GET 列表包含新平台', async () => {
    const r = await req<Array<{ id: string; name: string }>>(base, 'GET', '/api/platforms')
    expect(r.body.map((p) => p.id)).toContain(pid)
  })

  it('PUT 部分更新 -> 返回更新后的 PublicPlatform', async () => {
    const r = await req<{ name: string; id: string }>(base, 'PUT', `/api/platforms/${pid}`, {
      name: '平台A改',
    })
    expect(r.status).toBe(200)
    expect(r.body.name).toBe('平台A改')
  })

  it('PUT 不存在 -> 404 平台不存在', async () => {
    const r = await req<{ error: string }>(base, 'PUT', '/api/platforms/nope', { name: 'x' })
    expect(r.status).toBe(404)
    expect(r.body.error).toBe('平台不存在')
  })
})

describe('reorder / balances / history API', () => {
  it('PUT /reorder 数量不匹配 -> 400; 成功 -> ok:true', async () => {
    // 先创建第二个平台, 再验证数量不匹配
    const r2 = await req<{ id: string }>(base, 'POST', '/api/platforms', {
      name: '平台B',
      request: { url: 'https://mock.test/api' },
      handler: 'function (raw) { return JSON.parse(raw).balance }',
    })
    expect(r2.status).toBe(201)
    pidB = r2.body.id

    const bad = await req<{ error: string }>(base, 'PUT', '/api/platforms/reorder', { ids: [pid] })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('ids 数量与现有平台不匹配')

    const ok = await req<{ ok: boolean }>(base, 'PUT', '/api/platforms/reorder', {
      ids: [pidB, pid],
    })
    expect(ok.status).toBe(200)
    expect(ok.body.ok).toBe(true)

    const dup = await req<{ error: string }>(base, 'PUT', '/api/platforms/reorder', {
      ids: [pid, pid],
    })
    expect(dup.body.error).toBe('ids 包含重复项')

    const unknown = await req<{ error: string }>(base, 'PUT', '/api/platforms/reorder', {
      ids: [pid, 'zzz'],
    })
    expect(unknown.body.error).toBe('未知平台 id: zzz')
  })

  it('balances 初始 value/text 为 null, 抓取后有最新值与 fetchedAt', async () => {
    const empty = await req<{
      updatedAt: string
      platforms: Array<{ id: string; value: number | null; text: string | null; fetchedAt: string | null }>
    }>(base, 'GET', '/api/platforms/balances')
    expect(empty.status).toBe(200)
    expect(new Date(empty.body.updatedAt).toString()).not.toBe('Invalid Date')
    expect(empty.body.platforms.find((p) => p.id === pid)?.value).toBeNull()

    stubFetchOk(55.5)
    const f = await req<{ ok: boolean; value: number; fetchedAt: string }>(
      base,
      'POST',
      `/api/platforms/${pid}/fetch`,
    )
    expect(f.status).toBe(200)
    expect(f.body.ok).toBe(true)
    expect(f.body.value).toBeCloseTo(55.5)

    const dash = await req<{
      platforms: Array<{ id: string; value: number | null; text: string | null; error: string | null }>
    }>(base, 'GET', '/api/platforms/balances')
    const card = dash.body.platforms.find((p) => p.id === pid)!
    expect(card.value).toBeCloseTo(55.5)
    expect(card.text).toBeNull()
    expect(card.error).toBeNull()
  })

  it('字符串平台 fetch -> 面板 text 为展示文本, value 为数值', async () => {
    const rc = await req<{ id: string }>(base, 'POST', '/api/platforms', {
      name: '字符串平台',
      request: { url: 'https://mock.test/api' },
      handler: 'function (raw) { return "28.12元" }',
    })
    expect(rc.status).toBe(201)
    const strPid = rc.body.id

    stubFetchOk(1)
    const f = await req<{ ok: boolean; value: number | string }>(
      base,
      'POST',
      `/api/platforms/${strPid}/fetch`,
    )
    expect(f.status).toBe(200)
    expect(f.body.value).toBe('28.12元')

    const dash = await req<{
      platforms: Array<{ id: string; value: number | null; text: string | null }>
    }>(base, 'GET', '/api/platforms/balances')
    const card = dash.body.platforms.find((p) => p.id === strPid)!
    expect(card.text).toBe('28.12元')
    expect(card.value).toBeCloseTo(28.12)
  })

  it('纯文本平台 fetch -> 面板 text 展示, value=null, 无报错; 删除后消失', async () => {
    const rc = await req<{ id: string }>(base, 'POST', '/api/platforms', {
      name: '纯文本平台',
      request: { url: 'https://mock.test/api' },
      handler: 'function (raw) { return "已过期" }',
    })
    expect(rc.status).toBe(201)
    const txtPid = rc.body.id

    stubFetchOk(1)
    const f = await req<{ ok: boolean; value: number | string }>(
      base,
      'POST',
      `/api/platforms/${txtPid}/fetch`,
    )
    expect(f.status).toBe(200)
    expect(f.body.value).toBe('已过期')

    const dash = await req<{
      platforms: Array<{ id: string; value: number | null; text: string | null; error: string | null }>
    }>(base, 'GET', '/api/platforms/balances')
    const card = dash.body.platforms.find((p) => p.id === txtPid)!
    expect(card.text).toBe('已过期')
    expect(card.value).toBeNull()
    expect(card.error).toBeNull()

    const del = await req(base, 'DELETE', `/api/platforms/${txtPid}`)
    expect(del.status).toBe(204)
  })

  it('fetch 失败 -> 502 + 错误态出现在 balances; 恢复后清除', async () => {
    stubFetchFail('模拟网络故障')
    const f = await req<{ ok: boolean; error: string }>(
      base,
      'POST',
      `/api/platforms/${pid}/fetch`,
    )
    expect(f.status).toBe(502)
    expect(f.body.ok).toBe(false)
    expect(f.body.error).toContain('模拟网络故障')

    const dash = await req<{
      platforms: Array<{ id: string; value: number | null; error: string | null }>
    }>(base, 'GET', '/api/platforms/balances')
    expect(dash.body.platforms.find((p) => p.id === pid)?.error).toContain('模拟网络故障')

    stubFetchOk(66)
    await req(base, 'POST', `/api/platforms/${pid}/fetch`)
    const dash2 = await req<{ platforms: Array<{ error: string | null; value: number | null }> }>(
      base,
      'GET',
      '/api/platforms/balances',
    )
    const card2 = dash2.body.platforms.find((p) => p.id === pid)!
    expect(card2.error).toBeNull()
    expect(card2.value).toBeCloseTo(66)
  })

  it(':id/history 返回折线图采样点 ({v,t} 升序)', async () => {
    const r = await req<{
      id: string
      name: string
      points: Array<{ v: number; t: string }>
    }>(base, 'GET', `/api/platforms/${pid}/history`)
    expect(r.status).toBe(200)
    expect(r.body.points.length).toBeGreaterThanOrEqual(2)
    expect(r.body.points[0]).toHaveProperty('v')
    expect(r.body.points[0]).toHaveProperty('t')

    const missing = await req<{ error: string }>(base, 'GET', '/api/platforms/zzz/history')
    expect(missing.status).toBe(404)
  })

  it('POST /validate 与 /:id/test (不写历史)', async () => {
    stubFetchOk(12)
    const v = await req<{ ok: boolean; value: number }>(base, 'POST', '/api/platforms/validate', {
      request: { url: 'https://mock.test/api' },
      handler: 'function (raw) { return JSON.parse(raw).balance }',
    })
    expect(v.status).toBe(200)
    expect(v.body.value).toBeCloseTo(12)

    stubFetchOk(13)
    const t = await req<{ ok: boolean; testedAt?: string }>(
      base,
      'POST',
      `/api/platforms/${pid}/test`,
    )
    expect(t.status).toBe(200)
    expect(t.body.ok).toBe(true)
    expect(typeof t.body.testedAt).toBe('string')
    // test 不应新增采样点
    const h = await req<{ points: unknown[] }>(base, 'GET', `/api/platforms/${pid}/history`)
    const countAfterTest = h.body.points.length

    stubFetchOk(14)
    await req(base, 'POST', `/api/platforms/${pid}/fetch`) // 再抓一次
    const h2 = await req<{ points: unknown[] }>(base, 'GET', `/api/platforms/${pid}/history`)
    expect(h2.body.points.length).toBe(countAfterTest + 1)
  })

  it('POST /refresh 汇总全部平台结果', async () => {
    stubFetchOk(99)
    const r = await req<{ ok: boolean; results: Array<{ id: string; ok: boolean }> }>(
      base,
      'POST',
      '/api/platforms/refresh',
    )
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.results.length).toBeGreaterThanOrEqual(2)
    expect(r.body.results.every((x) => x.ok)).toBe(true)

    stubFetchFail('刷新失败用例')
    const r2 = await req<{ results: Array<{ id: string; ok: boolean; error?: string }> }>(
      base,
      'POST',
      '/api/platforms/refresh',
    )
    expect(r2.body.results.every((x) => !x.ok)).toBe(true)
    // 失败结果带 error 信息
    expect(r2.body.results[0]?.error).toContain('刷新失败用例')
  })

  it('DELETE 平台 -> 204 且历史同步删除', async () => {
    stubFetchOk(1)
    await req(base, 'POST', `/api/platforms/${pidB}/fetch`)
    expect(historyRepo.get(pidB).length).toBeGreaterThan(0)

    const d = await req(base, 'DELETE', `/api/platforms/${pidB}`)
    expect(d.status).toBe(204)
    expect(historyRepo.get(pidB)).toEqual([])

    const gone = await req(base, 'DELETE', `/api/platforms/${pidB}`)
    expect(gone.status).toBe(404)
  })
})

describe('预设 API', () => {
  it('GET 内置预设在前', async () => {
    const r = await req<Array<{ id: string; builtin: boolean }>>(base, 'GET', '/api/presets')
    expect(r.status).toBe(200)
    expect(r.body.filter((p) => p.builtin).map((p) => p.id)).toEqual(['newapi', 'deepseek'])
  })

  it('POST 校验失败 -> 400; 成功 -> 201', async () => {
    const bad = await req<{ error: string }>(base, 'POST', '/api/presets', { name: '' })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('预设名称不能为空')

    const ok = await req<{ id: string; builtin: boolean }>(base, 'POST', '/api/presets', {
      name: '自定义预设',
      fields: [{ key: 'token', label: '令牌' }],
      urlTemplate: '{{baseUrl}}/b',
      headersTemplate: {},
      extractorTemplate: 'function(d){return d.b}',
    })
    expect(ok.status).toBe(201)
    expect(ok.body.builtin).toBe(false)
  })

  it('PUT upsert / reset / delete 规则', async () => {
    const put = await req<{ id: string; builtin: boolean }>(base, 'PUT', '/api/presets/my-preset', {
      name: '自定义预设2',
      fields: [{ key: 'k', label: 'K' }],
      urlTemplate: 'u',
      headersTemplate: '{}',
      extractorTemplate: 'e',
    })
    expect(put.status).toBe(200)

    const editBuiltin = await req<{ edited?: boolean }>(base, 'PUT', '/api/presets/deepseek', {
      name: 'DeepSeek改',
      fields: [{ key: 'apiKey', label: 'K' }],
      urlTemplate: 'u',
      headersTemplate: '{}',
      extractorTemplate: 'e',
    })
    expect(editBuiltin.body.edited ?? true).toBeTruthy()

    const reset = await req<{ name: string; extractorTemplate: string }>(
      base,
      'POST',
      '/api/presets/deepseek/reset',
    )
    expect(reset.status).toBe(200)
    expect(reset.body.name).toBe('DeepSeek')
    expect(reset.body.extractorTemplate).toContain('total_balance')

    const resetCustom = await req<{ error: string }>(base, 'POST', '/api/presets/my-preset/reset')
    expect(resetCustom.status).toBe(400)
    expect(resetCustom.body.error).toBe('仅内置预设支持重置')

    const delBuiltin = await req<{ error: string }>(base, 'DELETE', '/api/presets/newapi')
    expect(delBuiltin.status).toBe(400)
    expect(delBuiltin.body.error).toBe('内置预设使用重置恢复默认，不能删除')

    const delCustom = await req(base, 'DELETE', '/api/presets/my-preset')
    expect(delCustom.status).toBe(204)
  })
})

describe('设置 / 日志 API', () => {
  it('GET/PUT settings 语义等价 (非法值回退默认 0)', async () => {
    const g = await req<{ collectIntervalSeconds: number }>(base, 'GET', '/api/settings')
    expect(g.status).toBe(200)

    const p = await req<{ collectIntervalSeconds: number }>(base, 'PUT', '/api/settings', {
      collectIntervalSeconds: '90',
    })
    expect(p.body.collectIntervalSeconds).toBe(90)

    const invalid = await req<{ collectIntervalSeconds: number }>(base, 'PUT', '/api/settings', {
      collectIntervalSeconds: -3,
    })
    expect(invalid.body.collectIntervalSeconds).toBe(0)

    const clamp = await req<{ collectIntervalSeconds: number }>(base, 'PUT', '/api/settings', {
      collectIntervalSeconds: 999999,
    })
    expect(clamp.body.collectIntervalSeconds).toBe(86400)

    // 收尾关闭自动采集, 避免测试进程残留定时器
    await req(base, 'PUT', '/api/settings', { collectIntervalSeconds: 0 })
  })

  it('GET logs 结构与 limit; DELETE 清空', async () => {
    const r = await req<{ logs: Array<Record<string, unknown>>; total: number }>(
      base,
      'GET',
      '/api/logs?limit=5',
    )
    expect(r.status).toBe(200)
    expect(Array.isArray(r.body.logs)).toBe(true)
    expect(r.body.total).toBeGreaterThanOrEqual(r.body.logs.length)
    // 前面的操作已经产生过日志
    expect(r.body.total).toBeGreaterThan(0)

    const del = await req(base, 'DELETE', '/api/logs')
    expect(del.status).toBe(204)
    const after = await req<{ total: number; logs: Array<{ action: string }> }>(
      base,
      'GET',
      '/api/logs',
    )
    expect(after.body.total).toBe(1)
    expect(after.body.logs[0]?.action).toBe('clear-logs')
  })
})

describe('导入导出 API', () => {
  it('GET /export 结构完整且记录日志', async () => {
    const r = await req<{
      type: string
      version: number
      platforms: unknown[]
      presets: unknown[]
    }>(base, 'GET', '/api/export')
    expect(r.status).toBe(200)
    expect(r.body.type).toBe('quotahub-config')
    expect(r.body.version).toBe(1)
    expect(Array.isArray(r.body.platforms)).toBe(true)
  })

  it('POST /import 无法识别 -> 400', async () => {
    const r = await req<{ error: string }>(base, 'POST', '/api/import', { foo: 1 })
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('无法识别的配置格式')
  })

  it('POST /import 单平台 + 脱敏凭据拒绝', async () => {
    const r = await req<{
      ok: boolean
      platforms: number
      errors: string[]
    }>(base, 'POST', '/api/import', {
      platforms: [
        {
          id: 'imp-e2e',
          name: 'E2E 导入',
          request: { url: 'https://imp.example/api', headers: { Authorization: '********' } },
          handler: 'f',
        },
        {
          id: 'imp-e2e-ok',
          name: 'E2E 正常',
          request: { url: 'https://imp.example/api' },
          handler: 'function(raw){return JSON.parse(raw).balance}',
        },
      ],
    })
    expect(r.status).toBe(200)
    expect(r.body.platforms).toBe(1)
    expect(r.body.errors.length).toBe(1)
    expect(r.body.errors[0]).toContain('脱敏占位符')
  })
})

describe('静态资源与未知路由', () => {
  it('GET / 服务旧前端 public/index.html', async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('<!') // html 文档
  })

  it('未知 /api 路由 -> 404', async () => {
    const res = await fetch(`${base}/api/definitely-not-exist`)
    expect(res.status).toBe(404)
  })
})
