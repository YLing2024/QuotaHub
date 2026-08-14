const fs = require('fs')
const path = require('path')

// 数据目录可用 QUOTAHUB_DATA_DIR 覆盖(备份、隔离测试等场景)
const DATA_DIR = process.env.QUOTAHUB_DATA_DIR || path.join(__dirname, '..', 'data')
const PLATFORMS_FILE = path.join(DATA_DIR, 'platforms.json')
const BALANCES_FILE = path.join(DATA_DIR, 'balances.json')
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json')

function ensureFile(file, initial) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(initial, null, 2))
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}

function getPlatforms() {
  ensureFile(PLATFORMS_FILE, [])
  return readJson(PLATFORMS_FILE, [])
}

function savePlatforms(list) {
  ensureFile(PLATFORMS_FILE, [])
  writeJson(PLATFORMS_FILE, list)
}

function getBalances() {
  ensureFile(BALANCES_FILE, {})
  return readJson(BALANCES_FILE, {})
}

function saveBalances(map) {
  ensureFile(BALANCES_FILE, {})
  writeJson(BALANCES_FILE, map)
}

function getPresets() {
  ensureFile(PRESETS_FILE, [])
  return readJson(PRESETS_FILE, [])
}

function savePresets(list) {
  ensureFile(PRESETS_FILE, [])
  writeJson(PRESETS_FILE, list)
}

module.exports = {
  DATA_DIR,
  PLATFORMS_FILE,
  BALANCES_FILE,
  PRESETS_FILE,
  getPlatforms,
  savePlatforms,
  getBalances,
  saveBalances,
  getPresets,
  savePresets,
}
