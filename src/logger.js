const fs = require('fs')
const path = require('path')

const DATA_DIR = process.env.QUOTAHUB_DATA_DIR || path.join(__dirname, '..', 'data')
const LOGS_FILE = path.join(DATA_DIR, 'logs.json')

// 内存环形缓冲上限; 同时持久化到磁盘, 重启后恢复
const MAX_LOGS = 2000

let logs = []

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8'))
    if (Array.isArray(raw)) {
      logs = raw.slice(-MAX_LOGS)
    }
  } catch {
    logs = []
  }
}

function persist() {
  ensureDir()
  const tmp = `${LOGS_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(logs, null, 2))
  fs.renameSync(tmp, LOGS_FILE)
}

// action: create/update/delete/fetch/refresh/test/reorder/import/export/
//          settings/clear-logs/unknown
function log(action, detail, opts = {}) {
  const entry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toISOString(),
    action: String(action || 'unknown'),
    detail: String(detail == null ? '' : detail),
    platformId: opts.platformId || null,
    platformName: opts.platformName || null,
    ...(opts.meta && typeof opts.meta === 'object' ? { meta: opts.meta } : {}),
  }
  logs.push(entry)
  if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS)
  try {
    persist()
  } catch (e) {
    console.error(`[logger] 写入日志失败: ${e.message}`)
  }
  return entry
}

function list(limit = 200) {
  const n = Math.min(Math.max(Number(limit) || 200, 1), MAX_LOGS)
  return logs.slice(-n).reverse() // 最新的在前
}

function clear() {
  logs = []
  try {
    persist()
  } catch (e) {
    console.error(`[logger] 清空日志失败: ${e.message}`)
  }
}

load()

module.exports = { log, list, clear, MAX_LOGS }
