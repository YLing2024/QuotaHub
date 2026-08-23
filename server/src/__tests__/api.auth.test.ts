import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TestServer } from './helpers.js'

// 应用层令牌鉴权测试: QUOTAHUB_TOKEN 设置后的访问控制
const prevToken = process.env.QUOTAHUB_TOKEN
process.env.QUOTAHUB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-api-auth-'))
process.env.QUOTAHUB_TOKEN = 'e2e-secret-token'

const { createApp } = await import('../app.js')
const { initSchema } = await import('../db/init.js')
const { closeDb } = await import('../db/connection.js')
const { startServer, req } = await import('./helpers.js')

// 恢复 env, 防止泄漏到同 worker 的其他测试文件 (config 已在 import 时捕获)
if (prevToken === undefined) delete process.env.QUOTAHUB_TOKEN
else process.env.QUOTAHUB_TOKEN = prevToken

initSchema()

let srv: TestServer
let base = ''

beforeAll(async () => {
  srv = await startServer(createApp())
  base = srv.base
})

afterAll(async () => {
  await srv.close()
  closeDb()
})

describe('QUOTAHUB_TOKEN 鉴权', () => {
  it('无令牌 -> 401 未授权', async () => {
    const r = await req<{ error: string }>(base, 'GET', '/api/settings')
    expect(r.status).toBe(401)
    expect(r.body.error).toBe('未授权: 缺少或错误的访问令牌')
  })

  it('错误令牌 -> 401', async () => {
    const r = await req(base, 'GET', '/api/settings', undefined, {
      Authorization: 'Bearer wrong-token',
    })
    expect(r.status).toBe(401)
  })

  it('Authorization: Bearer 通过', async () => {
    const r = await req<{ collectIntervalSeconds: number }>(base, 'GET', '/api/settings', undefined, {
      Authorization: 'Bearer e2e-secret-token',
    })
    expect(r.status).toBe(200)
  })

  it('X-Quotahub-Token 头通过 (旧客户端兼容)', async () => {
    const r = await req(base, 'GET', '/api/settings', undefined, {
      'X-Quotahub-Token': 'e2e-secret-token',
    })
    expect(r.status).toBe(200)
  })

  it('X-Auth-Token 头通过 (SSO/nginx 探针转发)', async () => {
    const r = await req(base, 'GET', '/api/settings', undefined, {
      'X-Auth-Token': 'e2e-secret-token',
    })
    expect(r.status).toBe(200)
  })

  it('静态资源不受令牌保护', async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
  })
})
