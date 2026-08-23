import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'

describe('loadConfig (Zod env 校验)', () => {
  it('缺省给默认值', () => {
    const cfg = loadConfig({})
    expect(cfg.port).toBe(3000)
    expect(cfg.host).toBe('127.0.0.1')
    expect(cfg.token).toBe('')
    expect(cfg.scriptTimeoutMs).toBe(2000)
    expect(cfg.allowPrivate).toBe(false)
  })

  it('解析 PORT/HOST/TOKEN', () => {
    const cfg = loadConfig({
      PORT: '5310',
      HOST: '0.0.0.0',
      QUOTAHUB_TOKEN: ' secret ',
    })
    expect(cfg.port).toBe(5310)
    expect(cfg.host).toBe('0.0.0.0')
    expect(cfg.token).toBe('secret')
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

  it('QUOTAHUB_DATA_DIR 覆盖数据目录(相对路径按 CWD 解析)', () => {
    const cfg = loadConfig({ QUOTAHUB_DATA_DIR: '/tmp/qh-explicit' })
    expect(cfg.dataDir).toBe('/tmp/qh-explicit')
    const rel = loadConfig({ QUOTAHUB_DATA_DIR: 'data-sub' })
    expect(rel.dataDir.endsWith('data-sub')).toBe(true)
  })
})
