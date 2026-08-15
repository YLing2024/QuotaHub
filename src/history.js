const fs = require('fs')
const path = require('path')

const DATA_DIR = process.env.QUOTAHUB_DATA_DIR || path.join(__dirname, '..', 'data')
const HISTORY_FILE = path.join(DATA_DIR, 'history.json')

// 每个平台最多保留的余额采样点数量
const MAX_POINTS = 2000

let history = {}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) history = raw
  } catch {
    history = {}
  }
}

function persist() {
  ensureDir()
  const tmp = `${HISTORY_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(history, null, 2))
  fs.renameSync(tmp, HISTORY_FILE)
}

// 记录一次成功的余额采样; value 必须为有效数值
function record(platformId, value, fetchedAt) {
  const num = Number(value)
  if (!platformId || !Number.isFinite(num)) return
  const arr = history[platformId] || []
  arr.push({ v: num, t: fetchedAt || new Date().toISOString() })
  if (arr.length > MAX_POINTS) arr.splice(0, arr.length - MAX_POINTS)
  history[platformId] = arr
  try {
    persist()
  } catch (e) {
    console.error(`[history] 写入历史失败: ${e.message}`)
  }
}

function get(platformId) {
  return history[platformId] || []
}

function remove(platformId) {
  if (history[platformId]) {
    delete history[platformId]
    try {
      persist()
    } catch (e) {
      console.error(`[history] 删除历史失败: ${e.message}`)
    }
  }
}

load()

module.exports = { record, get, remove }
