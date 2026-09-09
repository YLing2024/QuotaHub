import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// 注入隔离数据目录后再加载模块 (config 在 import 时解析 env)
process.env.QUOTAHUB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-history-'))

const { historyRepo } = await import('../repositories/index.js')
const { initSchema } = await import('../db/init.js')
const { closeDb } = await import('../db/connection.js')

initSchema()

afterAll(() => {
  closeDb()
})

describe('historyRepo (SQLite)', () => {
  it('record/get/latest/remove 基本流程', () => {
    const pid = 'p1'
    expect(historyRepo.get(pid)).toEqual([])
    expect(historyRepo.latest(pid)).toBeNull()

    expect(historyRepo.record(pid, 10.5, '2026-01-01T00:00:01.000Z')).toBe(true)
    historyRepo.record(pid, 11, '2026-01-01T00:00:02.000Z')
    historyRepo.record(pid, 12, '2026-01-01T00:00:03.000Z')

    const points = historyRepo.get(pid)
    expect(points).toEqual([
      { v: 10.5, t: '2026-01-01T00:00:01.000Z' },
      { v: 11, t: '2026-01-01T00:00:02.000Z' },
      { v: 12, t: '2026-01-01T00:00:03.000Z' },
    ])
    expect(historyRepo.latest(pid)).toEqual({ v: 12, t: '2026-01-01T00:00:03.000Z' })

    historyRepo.remove(pid)
    expect(historyRepo.get(pid)).toEqual([])
    // 删除不存在的平台是安全操作
    expect(() => historyRepo.remove('nope')).not.toThrow()
  })

  it('非法值(非有限数字/字符串/纯文本)拒写; 缺省时间用当前时间', () => {
    expect(historyRepo.record('', 5)).toBe(false)
    expect(historyRepo.record('px', Number.NaN)).toBe(false)
    expect(historyRepo.record('px', Number.POSITIVE_INFINITY)).toBe(false)
    // 字符串一律非 number -> false(纯数值语义, 不再提取)
    expect(historyRepo.record('px', 'abc' as unknown as number)).toBe(false)
    expect(historyRepo.record('px', '已过期' as unknown as number)).toBe(false)
    expect(historyRepo.record('px', '12abc' as unknown as number)).toBe(false)
    expect(historyRepo.record('px', '92.05G' as unknown as number)).toBe(false)

    const ok = historyRepo.record('px', 7) // 不传时间
    expect(ok).toBe(true)
    const latest = historyRepo.latest('px')
    expect(latest?.v).toBe(7)
    expect(new Date(latest!.t).toString()).not.toBe('Invalid Date')
  })

  it('纯数值语义: 字符串永不入库/不带 text; number 源点只含 {v,t}', () => {
    const pid = 'pstr'
    // 字符串(即使含可提取数字)一律拒写, 历史保持纯数值
    expect(historyRepo.record(pid, '92.05G' as unknown as number)).toBe(false)
    expect(historyRepo.record(pid, '12abc' as unknown as number)).toBe(false)
    expect(historyRepo.latest(pid)).toBeNull()
    // number 源不带 text
    historyRepo.record(pid, 5, '2026-01-02T00:00:04.000Z')
    expect(historyRepo.latest(pid)).toEqual({ v: 5, t: '2026-01-02T00:00:04.000Z' })
    expect(historyRepo.get(pid)).toEqual([{ v: 5, t: '2026-01-02T00:00:04.000Z' }])
  })

  it('每平台最多保留 2000 点 (裁掉最旧)', async () => {
    const pid = 'cap'
    for (let i = 0; i < 2005; i++) {
      const t = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString()
      historyRepo.record(pid, i, t)
      if (i === 2004) await Promise.resolve()
    }
    const points = historyRepo.get(pid)
    expect(points.length).toBe(2000)
    // 最旧的 5 点被裁掉
    expect(points[0]!.t).toBe(new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 5)).toISOString())
    expect(points.at(-1)!.t).toBe(new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 2004)).toISOString())
  })

  it('insertMany/countAll/countByPlatform/removeMany 迁移辅助', () => {
    historyRepo.removeMany(['m1', 'm2'])
    const n = historyRepo.insertMany([
      { platformId: 'm1', time: '2026-02-01T00:00:00.000Z', value: 1 },
      { platformId: 'm1', time: '2026-02-01T00:00:01.000Z', value: 2 },
      { platformId: 'm2', time: '2026-02-01T00:00:02.000Z', value: 3 },
    ])
    expect(n).toBe(3)
    expect(historyRepo.countByPlatform().get('m1')).toBe(2)
    expect(historyRepo.get('m1')).toEqual([
      { v: 1, t: '2026-02-01T00:00:00.000Z' },
      { v: 2, t: '2026-02-01T00:00:01.000Z' },
    ])
    historyRepo.removeMany(['m1', 'm2'])
    expect(historyRepo.countByPlatform().has('m1')).toBe(false)
  })

  it('同刻时间点按插入顺序稳定排序', () => {
    const pid = 'ties'
    const t = '2026-03-01T00:00:00.000Z'
    historyRepo.record(pid, 100, t)
    historyRepo.record(pid, 200, t)
    expect(historyRepo.get(pid).map((x) => x.v)).toEqual([100, 200])
    expect(historyRepo.latest(pid)?.v).toBe(200)
  })
})
