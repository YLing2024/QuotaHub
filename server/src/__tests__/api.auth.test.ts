import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TestServer } from './helpers.js'

// 新架构鉴权测试: 用户身份只认 Auth Gateway 注入的 X-Auth-User 头;
// 头缺失/为空 → 401; 公开静态资源不受保护。
process.env.QUOTAHUB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-api-auth-'))

const { createApp } = await import('../app.js')
const { initSchema } = await import('../db/init.js')
const { closeDb } = await import('../db/connection.js')
const { startServer, req } = await import('./helpers.js')

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

describe('X-Auth-User 鉴权', () => {
  it('缺少 X-Auth-User -> 401 未登录', async () => {
    const r = await req<{ error: string }>(base, 'GET', '/api/settings', undefined, {
      'X-Auth-User': '',
    })
    expect(r.status).toBe(401)
    expect(r.body.error).toBe('未登录')
  })

  it('X-Auth-User 非空 -> 放行 (200)', async () => {
    const r = await req<{ collectIntervalSeconds: number }>(base, 'GET', '/api/settings', undefined, {
      'X-Auth-User': 'alice',
    })
    expect(r.status).toBe(200)
  })

  it('Authorization: Bearer 不再作为凭证 (缺失 X-Auth-User 仍 401)', async () => {
    const r = await req(base, 'GET', '/api/settings', undefined, {
      'X-Auth-User': '',
      Authorization: 'Bearer legacy-token',
    })
    expect(r.status).toBe(401)
  })

  it('静态资源不受鉴权保护', async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
  })
})
