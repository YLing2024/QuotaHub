import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TestServer } from './helpers.js'

// sso 模式鉴权测试: 用户身份只认前置认证层注入的 X-Auth-User 头;
// 头缺失/为空 -> 401; 本地账号端点(auth/login|logout|me)一律 404;
// 公开静态资源与 /api/auth-mode 不受保护。
process.env.QUOTAHUB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-api-auth-'))
process.env.AUTH_MODE = 'sso'

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

describe('sso 模式鉴权', () => {
  it('auth-mode 免鉴权返回 sso', async () => {
    const r = await req<{ authMode: string }>(base, 'GET', '/api/auth-mode')
    expect(r.status).toBe(200)
    expect(r.body.authMode).toBe('sso')
  })

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

  it('本地账号端点不存在 (login/logout/me 一律 404)', async () => {
    const login = await req(base, 'POST', '/api/auth/login', { username: 'a', password: 'b' }, {
      'X-Auth-User': 'alice',
    })
    expect(login.status).toBe(404)
    const logout = await req(base, 'POST', '/api/auth/logout', undefined, { 'X-Auth-User': 'alice' })
    expect(logout.status).toBe(404)
    const me = await req(base, 'GET', '/api/auth/me', undefined, { 'X-Auth-User': 'alice' })
    expect(me.status).toBe(404)
  })

  it('Authorization: Bearer 不作为凭证 (缺失 X-Auth-User 仍 401)', async () => {
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
