import { getDb } from './connection.js'

// DDL 初始化: history_samples 表 + 索引
// 设计约定: 不单独存当前 balance, 面板最新值 = 本表该平台最新一条采样点

export const MAX_POINTS_PER_PLATFORM = 2000

export function initSchema(db = getDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS history_samples (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL,
      time        TEXT NOT NULL,
      value       REAL NOT NULL
    )
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_history_platform_time ON history_samples(platform_id, time)',
  )
}
