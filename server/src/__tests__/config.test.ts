import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'

describe('loadConfig (Zod env 校验)', () => {
  it('缺省给默认值', () => {
    const cfg = loadConfig({})
    expect(cfg.port).toBe(3000)
    expect(cfg.host).toBe('127.0.0.1')
    expect(cfg.scriptTimeoutMs).toBe(2000)
    expect(cfg.allowPrivate).toBe(false)
  })

  it('解析 PORT/HOST', () => {
    const cfg = loadConfig({
      PORT: '5310',
      HOST: '0.0.0.0',
    })
    expect(cfg.port).toBe(5310)
    expect(cfg.host).toBe('0.0.0.0')
  })

  it('非法 PORT 抛出明确错误', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(/PORT/)
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/)
    expect(() => loadConfig({ PORT: '0' })).toThrow(/PORT/)
  })

  describe('沙箱脚本超时钳制 (100~30000, 默认 2000)', () => {
    it.each([
      [undefined, 2000],
      ['', 2000],
      ['abc', 2000],
      ['-5', 2000],
      ['50', 100],
      ['1234', 1234],
      ['99999', 30000],
    ])('QUOTAHUB_SCRIPT_TIMEOUT_MS=%s -> %s', (input, expected) => {
      const cfg = loadConfig({ QUOTAHUB_SCRIPT_TIMEOUT_MS: input as string | undefined })
      expect(cfg.scriptTimeoutMs).toBe(expected)
    })
  })

  it('QUOTAHUB_ALLOW_PRIVATE 仅 =1 时开启', () => {
    expect(loadConfig({ QUOTAHUB_ALLOW_PRIVATE: '1' }).allowPrivate).toBe(true)
    expect(loadConfig({ QUOTAHUB_ALLOW_PRIVATE: '' }).allowPrivate).toBe(false)
    expect(loadConfig({ QUOTAHUB_ALLOW_PRIVATE: 'true' }).allowPrivate).toBe(false)
  })

  describe('AUTH_MODE (默认 builtin, 非法回退 builtin)', () => {
    it.each([
      [undefined, 'builtin'],
      ['', 'builtin'],
      ['builtin', 'builtin'],
      ['sso', 'sso'],
      ['SSO', 'builtin'],
      ['nonsense', 'builtin'],
    ])('AUTH_MODE=%s -> %s', (input, expected) => {
      expect(loadConfig({ AUTH_MODE: input as string | undefined }).authMode).toBe(expected)
    })

    it('管理员用户名默认 admin, 口令默认 null', () => {
      const cfg = loadConfig({})
      expect(cfg.adminUser).toBe('admin')
      expect(cfg.adminPassword).toBeNull()
    })

    it('会话 TTL 默认 12 小时, 非法回退', () => {
      expect(loadConfig({}).sessionTtlSeconds).toBe(12 * 3600)
      expect(loadConfig({ QUOTAHUB_SESSION_TTL_HOURS: '1' }).sessionTtlSeconds).toBe(3600)
      expect(loadConfig({ QUOTAHUB_SESSION_TTL_HOURS: '0' }).sessionTtlSeconds).toBe(12 * 3600)
      expect(loadConfig({ QUOTAHUB_SESSION_TTL_HOURS: 'abc' }).sessionTtlSeconds).toBe(12 * 3600)
    })
  })

  it('QUOTAHUB_DATA_DIR 覆盖数据目录(相对路径按 CWD 解析)', () => {
    const cfg = loadConfig({ QUOTAHUB_DATA_DIR: '/tmp/qh-explicit' })
    expect(cfg.dataDir).toBe('/tmp/qh-explicit')
    const rel = loadConfig({ QUOTAHUB_DATA_DIR: 'data-sub' })
    expect(rel.dataDir.endsWith('data-sub')).toBe(true)
  })
})
