const fs = require('fs')
const path = require('path')

const DATA_DIR = process.env.QUOTAHUB_DATA_DIR || path.join(__dirname, '..', 'data')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

const DEFAULTS = {
  // 自动采集间隔(秒), 0 表示关闭自动采集
  collectIntervalSeconds: 0,
}

let settings = { ...DEFAULTS }

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      settings = { ...DEFAULTS, ...raw }
    }
  } catch {
    settings = { ...DEFAULTS }
  }
}

function persist() {
  ensureDir()
  const tmp = `${SETTINGS_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2))
  fs.renameSync(tmp, SETTINGS_FILE)
}

function getSettings() {
  return { ...settings }
}

// 校验并合并设置; 返回更新后的设置对象
function updateSettings(patch) {
  const p = patch && typeof patch === 'object' ? patch : {}
  if (p.collectIntervalSeconds !== undefined) {
    const n = Number(p.collectIntervalSeconds)
    settings.collectIntervalSeconds =
      Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 86400) : DEFAULTS.collectIntervalSeconds
  }
  persist()
  return { ...settings }
}

load()

module.exports = { getSettings, updateSettings, DEFAULTS }
