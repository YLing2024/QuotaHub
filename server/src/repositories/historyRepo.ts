import Database from 'better-sqlite3'
import { getDb } from '../db/connection.js'
import { MAX_POINTS_PER_PLATFORM } from '../db/init.js'
import type { SamplePoint } from '../types.js'

// 历史采样数据访问 (SQLite, 预处理语句防注入)
// 形状与旧 history.json 的 {v,t} 保持一致; 每平台最多保留 MAX_POINTS_PER_PLATFORM 点

interface SampleRow {
  id: number
  platform_id: string
  time: string
  value: number
}

const statements = new Map<string, Database.Statement>()

function stmt(sql: string): Database.Statement {
  let s = statements.get(sql)
  if (!s) {
    s = getDb().prepare(sql)
    statements.set(sql, s)
  }
  return s
}

export function record(platformId: string, value: number, fetchedAt?: string): boolean {
  const num = Number(value)
  if (!platformId || !Number.isFinite(num)) return false
  const t = fetchedAt || new Date().toISOString()
  stmt('INSERT INTO history_samples(platform_id, time, value) VALUES (?, ?, ?)').run(
    platformId,
    t,
    num,
  )
  trim(platformId)
  return true
}

// 只保留最新 MAX_POINTS_PER_PLATFORM 点 (按 time, id 降序), 等价旧 splice 逻辑
export function trim(platformId: string): void {
  stmt(
    `DELETE FROM history_samples
     WHERE platform_id = ?
       AND id NOT IN (
         SELECT id FROM history_samples WHERE platform_id = ?
         ORDER BY time DESC, id DESC LIMIT ?
       )`,
  ).run(platformId, platformId, MAX_POINTS_PER_PLATFORM)
}

// 时间升序返回 (等价旧数组插入顺序)
export function get(platformId: string): SamplePoint[] {
  const rows = stmt(
    'SELECT id, platform_id, time, value FROM history_samples WHERE platform_id = ? ORDER BY time ASC, id ASC',
  ).all(platformId) as SampleRow[]
  return rows.map((r) => ({ v: r.value, t: r.time }))
}

// 最新一个采样点 (面板当前值来源)
export function latest(platformId: string): SamplePoint | null {
  const row = stmt(
    'SELECT id, platform_id, time, value FROM history_samples WHERE platform_id = ? ORDER BY time DESC, id DESC LIMIT 1',
  ).get(platformId) as SampleRow | undefined
  return row ? { v: row.value, t: row.time } : null
}

export function remove(platformId: string): void {
  if (!platformId) return
  stmt('DELETE FROM history_samples WHERE platform_id = ?').run(platformId)
}

export function removeMany(platformIds: string[]): void {
  const del = stmt('DELETE FROM history_samples WHERE platform_id = ?')
  const tx = getDb().transaction((ids: string[]) => {
    for (const id of ids) del.run(id)
  })
  tx(platformIds)
}

// 批量写入 (迁移用); 返回实际写入行数
export function insertMany(rows: Array<{ platformId: string; time: string; value: number }>): number {
  const ins = stmt('INSERT INTO history_samples(platform_id, time, value) VALUES (?, ?, ?)')
  const insert = getDb().transaction(
    (list: Array<{ platformId: string; time: string; value: number }>) => {
      for (const r of list) ins.run(r.platformId, r.time, r.value)
    },
  )
  const before = countAll()
  insert(rows)
  return countAll() - before
}

export function countAll(): number {
  const row = stmt('SELECT COUNT(*) AS c FROM history_samples').get() as { c: number }
  return row.c
}

export function countByPlatform(): Map<string, number> {
  const rows = stmt(
    'SELECT platform_id AS pid, COUNT(*) AS c FROM history_samples GROUP BY platform_id',
  ).all() as Array<{ pid: string; c: number }>
  return new Map(rows.map((r) => [r.pid, r.c]))
}
