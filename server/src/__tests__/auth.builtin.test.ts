import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TestServer } from './helpers.js'

// builtin 模式端到端测试: 自带账号登录 -> 会话 cookie/Bearer -> 访问业务接口。
// 独立临时数据目录; 管理员口令由 env 固定, 首启引导创建。
process.env.QUOTAHUB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-auth-builtin-'))
process.env.AUTH_MODE = 'builtin'
process.env.QUOTAHUB_ADMIN_USER = 'admin'
process.env.QUOTAHUB_ADMIN_PASSWORD = 'seed-password-123'

const { createApp } = await import('../app.js')
const { initSchema } = await import('../db/init.js')
const { closeDb } = await import('../db/connection.js')
const { authService } = await import('../services/authService.js')
const { startServer } = await import('./helpers.js')

initSchema()
authService.ensureSeedAdmin()

let srv: TestServer
let base = ''

const rawFetch = globalThis.fetch.bind(globalThis)

interface Raw {
  status: number
  body: Record<string, unknown>
  setCookie: string
}

async function call(
  method: string,
  pathname: string,
  opts: { body?: unknown; headers?: Record<string, string>; cookie?: string } = {},
): Promise<Raw> {
  const headers: Record<string, string> = { ...opts.headers }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (opts.cookie) headers.cookie = opts.cookie
  const res = await rawFetch(`${base}${pathname}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    body = { raw: text }
  }
  return { status: res.status, body, setCookie: res.headers.get('set-cookie') ?? '' }
}

function tokenFrom(setCookie: string): string {
  return /quotahub_session=([^;]+)/.exec(setCookie)?.[1] ?? ''
}

beforeAll(async () => {
  srv = await startServer(createApp())
  base = srv.base
})

afterAll(async () => {
  await srv.close()
  closeDb()
})

describe('builtin 模式认证', () => {
  it('auth-mode 免鉴权返回 builtin', async () => {
    const r = await call('GET', '/api/auth-mode')
    expect(r.status).toBe(200)
    expect(r.body.authMode).toBe('builtin')
  })

  it('未登录访问业务接口 -> 401', async () => {
    const r = await call('GET', '/api/platforms')
    expect(r.status).toBe(401)
  })

  it('builtin 忽略 X-Auth-User (外部头不提权)', async () => {
    const r = await call('GET', '/api/platforms', { headers: { 'X-Auth-User': 'hacker' } })
    expect(r.status).toBe(401)
  })

  it('错口令 -> 401 且不下发 cookie', async () => {
    const r = await call('POST', '/api/auth/login', {
      body: { username: 'admin', password: 'wrong' },
    })
    expect(r.status).toBe(401)
    expect(r.body.error).toBe('账号或密码错误')
    expect(r.setCookie).toBe('')
  })

  it('正确口令 -> 200 + HttpOnly SameSite=Lax cookie', async () => {
    const r = await call('POST', '/api/auth/login', {
      body: { username: 'admin', password: 'seed-password-123' },
    })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, user: { name: 'admin' } })
    expect(r.setCookie).toContain('quotahub_session=')
    expect(r.setCookie.toLowerCase()).toContain('httponly')
    expect(r.setCookie).toContain('Path=/')
    expect(r.setCookie).toContain('SameSite=Lax')
    expect(tokenFrom(r.setCookie)).not.toBe('')
  })

  it('带会话 cookie 可访问业务接口, me 返回用户名', async () => {
    const login = await call('POST', '/api/auth/login', {
      body: { username: 'admin', password: 'seed-password-123' },
    })
    const cookie = `quotahub_session=${tokenFrom(login.setCookie)}`
    const list = await call('GET', '/api/platforms', { cookie })
    expect(list.status).toBe(200)
    const me = await call('GET', '/api/auth/me', { cookie })
    expect(me.status).toBe(200)
    expect(me.body).toEqual({ name: 'admin' })
  })

  it('Bearer token 同样可用', async () => {
    const login = await call('POST', '/api/auth/login', {
      body: { username: 'admin', password: 'seed-password-123' },
    })
    const token = tokenFrom(login.setCookie)
    const list = await call('GET', '/api/platforms', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(list.status).toBe(200)
  })

  it('logout 后旧 cookie 失效, 且 logout 幂等', async () => {
    const login = await call('POST', '/api/auth/login', {
      body: { username: 'admin', password: 'seed-password-123' },
    })
    const cookie = `quotahub_session=${tokenFrom(login.setCookie)}`
    const out = await call('POST', '/api/auth/logout', { cookie })
    expect(out.status).toBe(200)
    const again = await call('POST', '/api/auth/logout', { cookie })
    expect(again.status).toBe(200)
    const list = await call('GET', '/api/platforms', { cookie })
    expect(list.status).toBe(401)
  })

  it('连续失败触发按 IP 限速 -> 429 retryAfter', async () => {
    for (let i = 0; i < 5; i += 1) {
      await call('POST', '/api/auth/login', { body: { username: 'admin', password: `bad-${i}` } })
    }
    const r = await call('POST', '/api/auth/login', {
      body: { username: 'admin', password: 'seed-password-123' },
    })
    expect(r.status).toBe(429)
    expect(typeof r.body.retryAfter).toBe('number')
    expect(Number(r.body.retryAfter)).toBeGreaterThan(0)
  })
})
