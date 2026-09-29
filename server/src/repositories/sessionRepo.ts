import { getDb } from '../db/connection.js'

// 会话数据访问 (SQLite sessions 表); token 为随机 hex 主键, expires_at 为 UTC ISO 字符串

export interface SessionRow {
  token: string
  username: string
  created_at: string
  expires_at: string
}

export function insert(row: SessionRow): void {
  getDb()
    .prepare(
      'INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)',
    )
    .run(row.token, row.username, row.created_at, row.expires_at)
}

// 命中且未过期才返回 (nowIso 与 expires_at 同为 UTC ISO, 字典序即时间序)
export function findValid(token: string, nowIso: string): SessionRow | undefined {
  return getDb()
    .prepare('SELECT token, username, created_at, expires_at FROM sessions WHERE token = ? AND expires_at > ?')
    .get(token, nowIso) as SessionRow | undefined
}

export function touch(token: string, expiresAt: string): void {
  getDb().prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(expiresAt, token)
}

export function remove(token: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function removeExpired(nowIso: string): void {
  getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso)
}
