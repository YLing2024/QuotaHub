import path from 'node:path'
import Database from 'better-sqlite3'
import { config, ensureDataDir } from '../config.js'

// better-sqlite3 连接 (进程内单例); 监控数据存 <dataDir>/monitor.db

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    ensureDataDir()
    db = new Database(path.join(config.dataDir, 'monitor.db'))
    // WAL: 读写并发更好; NORMAL 同步级别在可接受持久性下性能更佳
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
  }
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
