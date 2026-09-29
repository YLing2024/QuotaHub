import { getDb } from '../db/connection.js'

// 账号数据访问 (SQLite users 表); 仅供 builtin 认证模式使用

export interface UserRow {
  id: number
  username: string
  password_hash: string
  created_at: string
}

export function count(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
  return row.n
}

export function findByUsername(username: string): UserRow | undefined {
  return getDb()
    .prepare('SELECT id, username, password_hash, created_at FROM users WHERE username = ?')
    .get(username) as UserRow | undefined
}

export function insert(username: string, passwordHash: string, createdAt: string): void {
  getDb()
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, passwordHash, createdAt)
}
