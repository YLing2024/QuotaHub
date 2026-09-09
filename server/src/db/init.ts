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
      value       REAL NOT NULL,
      value_text  TEXT
    )
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_history_platform_time ON history_samples(platform_id, time)',
  )
  // 老库幂等迁移: history_samples 缺 value_text 列则补齐(仅字符串源平台非 NULL, 展示快照)
  const cols = db.prepare('PRAGMA table_info(history_samples)').all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'value_text')) {
    db.exec('ALTER TABLE history_samples ADD COLUMN value_text TEXT')
  }
}
