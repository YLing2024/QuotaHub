import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// 放开内网限制后, 对本地 HTTP 服务做 fetchBalance 全链路验证
const prevAllowPrivate = process.env.QUOTAHUB_ALLOW_PRIVATE
process.env.QUOTAHUB_ALLOW_PRIVATE = '1'

const { fetchBalance } = await import('../lib/fetcher.js')

// 恢复 env, 防止泄漏到同 worker 的其他测试文件 (config 已在 import 时捕获)
if (prevAllowPrivate === undefined) delete process.env.QUOTAHUB_ALLOW_PRIVATE
else process.env.QUOTAHUB_ALLOW_PRIVATE = prevAllowPrivate

let server: http.Server
let base = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const urlPath = req.url ?? '/'
    res.setHeader('content-type', 'application/json')
    if (urlPath === '/json') {
      res.end(JSON.stringify({ data: { quota: 500000 } }))
    } else if (urlPath === '/js') {
      // JS 赋值式响应(opencode 风格)
      res.setHeader('content-type', 'text/javascript')
      res.end(';0x1f;$R = { total: 88.5 };$R')
    } else if (urlPath === '/boom') {
      res.statusCode = 500
      res.end('server exploded')
    } else if (urlPath === '/echo-method') {
      res.end(JSON.stringify({ method: req.method }))
    } else {
      res.end('{}')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(
  () =>
    new Promise<void>((resolve) => {
      if (!server) return resolve()
      server.close(() => resolve())
    }),
)

describe('fetchBalance 全链路 (本地 HTTP)', () => {
  it('单函数模型: handler 解析+提取', async () => {
    const r = await fetchBalance({
      request: { url: `${base}/json` },
      handler: 'function (raw) { return JSON.parse(raw).data.quota / 500000 }',
    })
    expect(r.value).toBe(1)
  })

  it('旧模型: 默认 JSON.parse + extractor 提取', async () => {
    const r = await fetchBalance({
      request: { url: `${base}/json` },
      extractor: 'function (data) { return data.data.quota / 1000 }',
    })
    expect(r.value).toBe(500)
  })

  it('JS 响应自动回退 evalJsResponse + extractor', async () => {
    const r = await fetchBalance({
      request: { url: `${base}/js` },
      extractor: 'function (data) { return data.total }',
    })
    expect(r.value).toBeCloseTo(88.5)
  })

  it('旧版 response.path + divider 模型', async () => {
    const r = await fetchBalance({
      request: { url: `${base}/json` },
      response: { path: 'data.quota', divider: 500000 },
    } as never)
    expect(r.value).toBe(1)
  })

  it('POST 方法与 body 透传', async () => {
    const r = await fetchBalance({
      request: { method: 'POST', url: `${base}/echo-method`, headers: {}, body: { a: 1 } },
      handler: 'function (raw) { return JSON.parse(raw).method === "POST" ? 7 : 0 }',
    })
    expect(r.value).toBe(7)
  })

  it('HTTP 错误状态 -> 中文错误信息', async () => {
    await expect(
      fetchBalance({ request: { url: `${base}/boom` }, handler: 'function(r){return 1}' }),
    ).rejects.toThrow(/HTTP 500: server exploded/)
  })

  it('处理函数未返回余额 -> 报错', async () => {
    await expect(
      fetchBalance({
        request: { url: `${base}/json` },
        handler: 'function (raw) { return undefined }',
      }),
    ).rejects.toThrow('处理函数未返回余额')
  })

  it('handler 返回字符串(配置错误) -> 明确报错提示返回数字', async () => {
    await expect(
      fetchBalance({
        request: { url: `${base}/plain` },
        handler: 'function (raw) { return "$8.51 元" }',
      }),
    ).rejects.toThrow('处理函数必须返回数字(当前返回 string)')

    await expect(
      fetchBalance({
        request: { url: `${base}/json` },
        handler: 'function (raw) { var n = JSON.parse(raw).data.quota / 500000; return n + "元" }',
      }),
    ).rejects.toThrow('处理函数必须返回数字(当前返回 string)')
  })

  it('handler 返回非数字/非有限数 -> 报错', async () => {
    await expect(
      fetchBalance({
        request: { url: `${base}/json` },
        handler: 'function (raw) { return true }',
      }),
    ).rejects.toThrow('处理函数必须返回数字(当前返回 boolean)')
    await expect(
      fetchBalance({
        request: { url: `${base}/json` },
        handler: 'function (raw) { return NaN }',
      }),
    ).rejects.toThrow(/处理函数必须返回数字/)
  })

  it('handler 返回 null/空串 -> 处理函数未返回余额', async () => {
    await expect(
      fetchBalance({
        request: { url: `${base}/json` },
        handler: 'function (raw) { return null }',
      }),
    ).rejects.toThrow('处理函数未返回余额')
    await expect(
      fetchBalance({
        request: { url: `${base}/json` },
        handler: 'function (raw) { return "   " }',
      }),
    ).rejects.toThrow('处理函数未返回余额')
  })

  it('无任何处理配置 -> 未配置处理函数', async () => {
    await expect(fetchBalance({ request: { url: `${base}/json` } })).rejects.toThrow(
      '未配置处理函数',
    )
  })
})
