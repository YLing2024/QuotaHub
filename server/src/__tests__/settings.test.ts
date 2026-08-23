import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

process.env.QUOTAHUB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-settings-'))

const { settingsService } = await import('../services/settingsService.js')
const { settingsRepo } = await import('../repositories/index.js')
const { closeDb } = await import('../db/connection.js')

afterAll(() => {
  closeDb()
})

describe('settingsService (与旧 settings.js 语义一致)', () => {
  it('默认值 collectIntervalSeconds=0', () => {
    expect(settingsService.getSettings()).toEqual({ collectIntervalSeconds: 0 })
    expect(settingsService.DEFAULTS).toEqual({ collectIntervalSeconds: 0 })
  })

  it('合法值更新并持久化', () => {
    const next = settingsService.updateSettings({ collectIntervalSeconds: 1800 })
    expect(next.collectIntervalSeconds).toBe(1800)
    expect(settingsRepo.get().collectIntervalSeconds).toBe(1800)
  })

  it.each([
    ['30', 30], // 字符串数字
    [30.9, 30], // floor
    [999999, 86400], // 上限钳制
    [null, 0], // Number(null)=0 -> 合法
    ['abc', 0], // NaN -> 默认
    [-5, 0], // 负数 -> 默认
    [{}, 0], // 对象 NaN -> 默认
    [[30], 30], // Number([30])=30 -> 与旧实现一致
  ])('collectIntervalSeconds=%p -> %p', (input, expected) => {
    const next = settingsService.updateSettings({ collectIntervalSeconds: input })
    expect(next.collectIntervalSeconds).toBe(expected)
  })

  it('未提供字段时保持原值', () => {
    settingsService.updateSettings({ collectIntervalSeconds: 60 })
    const next = settingsService.updateSettings({})
    expect(next.collectIntervalSeconds).toBe(60)
  })

  it('settings.json 损坏时回退默认', () => {
    fs.writeFileSync(settingsRepo.settingsFile(), '{broken')
    expect(settingsService.getSettings()).toEqual({ collectIntervalSeconds: 0 })
  })

  it('settings.json 含额外键时合并且保留', () => {
    settingsRepo.save({ collectIntervalSeconds: 90 } as never)
    fs.writeFileSync(
      settingsRepo.settingsFile(),
      JSON.stringify({ collectIntervalSeconds: 120, extraKey: 'x' }),
    )
    const s = settingsService.getSettings()
    expect((s as Record<string, unknown>).collectIntervalSeconds).toBe(120)
    expect((s as Record<string, unknown>).extraKey).toBe('x')
  })
})
