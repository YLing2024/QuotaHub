#!/usr/bin/env node
// migrate-json-to-sqlite —— 把旧版 JSON 历史(data/history.json)迁到 SQLite(data/monitor.db)
//
// 旧格式: { "<platform_id>": [ { "v": 12.3, "t": "2026-08-15T11:30:05.744Z" }, ... ] }
// 新表:   history_samples(id INTEGER PRIMARY KEY AUTOINCREMENT, platform_id TEXT NOT NULL,
//                         time TEXT NOT NULL, value REAL NOT NULL)
//
// 用法:
//   node scripts/migrate-json-to-sqlite.mjs [--data-dir <dir>] [--db <file>]
//                                           [--force] [--backup] [--help]
//
//   --data-dir <dir>  数据目录(含 history.json), 默认 <仓库根>/data
//   --db <file>       SQLite 文件路径, 默认 <data-dir>/monitor.db
//   --force           目标库已有该平台数据时先清空再迁移(否则跳过, 保证幂等)
//   --backup          迁移前把 history.json 备份为 history.json.backup-<时间戳>
//
// 幂等性: 已存在采样点的平台默认整平台跳过并提示; --force 才覆盖重迁。
// 退出码: 0 成功; 1 失败。

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { createRequire } from 'node:module'

const scriptDir = path.dirname(url.fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')

function parseArgs(argv) {
  const opts = {
    dataDir: null,
    db: null,
    force: false,
    backup: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--data-dir') opts.dataDir = argv[++i]
    else if (a === '--db') opts.db = argv[++i]
    else if (a === '--force') opts.force = true
    else if (a === '--backup') opts.backup = true
    else if (a === '-h' || a === '--help') opts.help = true
    else {
      throw new Error(`未知参数: ${a}`)
    }
  }
  return opts
}

function usage() {
  console.log(`用法:
  node scripts/migrate-json-to-sqlite.mjs [--data-dir <dir>] [--db <file>] [--force] [--backup]

选项:
  --data-dir <dir>  数据目录(含 history.json), 默认 <仓库根>/data
  --db <file>       SQLite 文件路径, 默认 <data-dir>/monitor.db
  --force           目标库已有该平台数据时先清空再迁移(否则跳过, 保证幂等)
  --backup          迁移前把 history.json 备份为 history.json.backup-<时间戳>
  -h, --help        显示本帮助`)
}

// better-sqlite3 安装在 server/node_modules; 依次尝试多个解析起点
function loadBetterSqlite3() {
  const candidates = [
    path.join(repoRoot, 'server', 'package.json'),
    path.join(process.cwd(), 'server', 'package.json'),
    path.join(repoRoot, 'package.json'),
    path.join(process.cwd(), 'package.json'),
  ]
  for (const base of candidates) {
    if (!fs.existsSync(base)) continue
    try {
      const require = createRequire(base)
      return require('better-sqlite3')
    } catch {
      // 尝试下一个候选位置
    }
  }
  console.error('错误: 找不到 better-sqlite3, 请先在 server/ 下执行 `npm install`')
  process.exit(1)
}

const DDL = `
CREATE TABLE IF NOT EXISTS history_samples (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_id TEXT NOT NULL,
  time        TEXT NOT NULL,
  value       REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_platform_time ON history_samples(platform_id, time);
`

function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`参数错误: ${e.message}\n`)
    usage()
    process.exit(1)
  }
  if (opts.help) {
    usage()
    process.exit(0)
  }

  const dataDir = path.resolve(opts.dataDir || path.join(repoRoot, 'data'))
  const historyFile = path.join(dataDir, 'history.json')
  const dbFile = path.resolve(opts.db || path.join(dataDir, 'monitor.db'))

  // 读取旧 JSON
  if (!fs.existsSync(historyFile)) {
    console.error(`错误: 未找到 ${historyFile}, 无可迁移数据`)
    process.exit(1)
  }
  let rawHistory
  try {
    rawHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8'))
  } catch (e) {
    console.error(`错误: history.json 解析失败: ${e.message}`)
    process.exit(1)
  }
  if (!rawHistory || typeof rawHistory !== 'object' || Array.isArray(rawHistory)) {
    console.error('错误: history.json 格式不正确, 期望对象 {platform_id: [{v,t}...]}')
    process.exit(1)
  }

  fs.mkdirSync(path.dirname(dbFile), { recursive: true })
  const Database = loadBetterSqlite3()
  const db = new Database(dbFile)
  db.pragma('journal_mode = WAL')

  try {
    db.exec(DDL)
  } catch (e) {
    console.error(`错误: 初始化表结构失败: ${e.message}`)
    process.exit(1)
  }

  // 迁移前备份(可选)
  if (opts.backup) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupFile = `${historyFile}.backup-${stamp}`
    fs.copyFileSync(historyFile, backupFile)
    console.log(`已备份: ${backupFile}`)
  }

  const countStmt = db.prepare(
    'SELECT COUNT(*) AS c FROM history_samples WHERE platform_id = ?',
  )
  const delStmt = db.prepare('DELETE FROM history_samples WHERE platform_id = ?')
  const insStmt = db.prepare(
    'INSERT INTO history_samples(platform_id, time, value) VALUES (?, ?, ?)',
  )

  const platformIds = Object.keys(rawHistory)
  const stats = []
  let totalInserted = 0
  let totalSkippedPoints = 0

  for (const pid of platformIds) {
    const points = rawHistory[pid]
    if (!Array.isArray(points)) {
      stats.push({ platformId: pid, status: 'skipped(格式非数组)', inserted: 0, invalid: 0 })
      continue
    }

    const existing = countStmt.get(pid).c
    if (existing > 0 && !opts.force) {
      stats.push({
        platformId: pid,
        status: `skipped(库中已有 ${existing} 点, --force 可重迁)`,
        inserted: 0,
        invalid: 0,
      })
      continue
    }

    let inserted = 0
    let invalid = 0
    const run = db.transaction(() => {
      if (existing > 0 && opts.force) delStmt.run(pid)
      for (const p of points) {
        const v = Number(p?.v)
        const t = p?.t
        if (!Number.isFinite(v) || typeof t !== 'string' || !t) {
          invalid++
          continue
        }
        insStmt.run(pid, t, v)
        inserted++
      }
    })
    run()

    stats.push({
      platformId: pid,
      status: existing > 0 ? 'replaced(--force)' : 'migrated',
      inserted,
      invalid,
    })
    totalInserted += inserted
    totalSkippedPoints += invalid
  }
  const grandTotal = db.prepare('SELECT COUNT(*) AS c FROM history_samples').get().c

  // 统计输出
  console.log('')
  console.log('迁移统计:')
  for (const s of stats) {
    const extra =
      s.invalid > 0 ? `, 跳过无效点 ${s.invalid}` : ''
    console.log(`  - ${s.platformId}: ${s.status}${s.inserted ? `, 写入 ${s.inserted} 点` : ''}${extra}`)
  }
  console.log('')
  console.log(
    `完成: 平台 ${stats.length} 个, 本次写入 ${totalInserted} 点, 无效跳过 ${totalSkippedPoints} 点`,
  )
  console.log(`SQLite(${dbFile}) 当前总点数: ${grandTotal}`)

  db.close()
}

main()
