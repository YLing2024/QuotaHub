import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

process.env.QUOTAHUB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-logs-'))

const { logRepo } = await import('../repositories/index.js')
const { logService } = await import('../services/logService.js')
const { closeDb } = await import('../db/connection.js')

afterAll(() => closeDb)

describe('logRepo + logService 操作日志', () => {
  it('append/list 最新在前, limit 钳制', () => {
    for (let i = 1; i <= 5; i++) {
      logService.log('fetch', `第 ${i} 条`, i === 3 ? { platformId: 'p3', platformName: 'P3', meta: { i } } : {})
    }
    const all = logService.list(200)
    expect(all.length).toBeGreaterThanOrEqual(5)
    // 最新的在前
    expect(all[0]!.detail).toBe('第 5 条')
    expect(logService.list(2).length).toBe(2)
  })

  it('条目结构与旧 logger.js 一致', () => {
    const entry = logService.log('create', '新增平台「X」', { platformId: 'px', platformName: 'X' })
    expect(entry.id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/)
    expect(entry.time).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(entry.action).toBe('create')
    expect(entry.detail).toBe('新增平台「X」')
    expect(entry.platformId).toBe('px')
    expect(entry.platformName).toBe('X')
  })

  it('持久化到 logs.json, 重载后可恢复 (模拟重启)', () => {
    logService.log('settings', '自动采集间隔设置为 30 秒', { meta: { from: 0, to: 30 } })
    // 模拟重启: 从磁盘重新加载
    logRepo.load()
    const found = logService.list(50).find((e) => e.action === 'settings')
    expect(found?.detail).toContain('30 秒')
  })

  it('clear 清空并落盘, clear 后仍有 clear-logs 记录', () => {
    logService.clear()
    expect(logService.total()).toBe(0)
    logService.log('clear-logs', '操作日志已清空')
    expect(logService.list()[0]?.action).toBe('clear-logs')
    expect(logService.total()).toBe(1)
  })
})
