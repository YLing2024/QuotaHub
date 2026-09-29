import { getDb } from './connection.js'

// DDL 初始化: history_samples 表 + 索引 + builtin 账号/会话表
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
  // builtin 认证模式: 管理员账号 + 会话(新建表, 与业务表互不影响)。
  // expires_at / created_at 为 UTC ISO 字符串, 可直接做字典序比较。
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      username   TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)')
  // 老库幂等迁移: history_samples 缺该列则补齐; 列物理保留供旧数据读取兼容, 新代码不再写入
  const cols = db.prepare('PRAGMA table_info(history_samples)').all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'value_text')) {
    db.exec('ALTER TABLE history_samples ADD COLUMN value_text TEXT')
  }
}
