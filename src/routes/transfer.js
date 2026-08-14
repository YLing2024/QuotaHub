const crypto = require('crypto')
const express = require('express')
const store = require('../store')
const { validatePreset } = require('./presets')

const router = express.Router()

// 导出完整配置: 全部平台 + 用户预设(不含抓取结果余额)
router.get('/export', (req, res) => {
  res.json({
    type: 'quotahub-config',
    version: 1,
    exportedAt: new Date().toISOString(),
    platforms: store.getPlatforms(),
    presets: store.getPresets(),
  })
})

function isPlatformLike(obj) {
  return Boolean(
    obj && typeof obj === 'object' &&
    typeof obj.name === 'string' &&
    obj.request && typeof obj.request === 'object' &&
    typeof obj.request.url === 'string'
  )
}

function isPresetLike(obj) {
  return Boolean(
    obj && typeof obj === 'object' &&
    typeof obj.name === 'string' &&
    Array.isArray(obj.fields) &&
    typeof obj.urlTemplate === 'string' &&
    typeof obj.extractorTemplate === 'string'
  )
}

function sanitizePlatform(raw, fallbackId) {
  const p = raw || {}
  const req = p.request || {}
  return {
    id: typeof p.id === 'string' && p.id ? p.id : fallbackId,
    name: String(p.name || '未命名平台').trim(),
    request: {
      method: req.method === 'POST' ? 'POST' : 'GET',
      url: String(req.url || ''),
      headers: (req.headers && typeof req.headers === 'object' && !Array.isArray(req.headers)) ? req.headers : {},
      ...(req.body !== undefined ? { body: req.body } : {}),
    },
    handler: typeof p.handler === 'string' ? p.handler : '',
    extractor: typeof p.extractor === 'string' ? p.extractor : '',
    parse: typeof p.parse === 'string' ? p.parse : '',
    ...(p.response && typeof p.response === 'object' ? { response: p.response } : {}),
    display: {
      prefix: String((p.display && p.display.prefix) || '').trim().slice(0, 20),
      suffix: String((p.display && p.display.suffix) || '').trim().slice(0, 20),
    },
    createdAt: typeof p.createdAt === 'string' && p.createdAt ? p.createdAt : new Date().toISOString(),
  }
}

// 导入校验: 处理函数必须存在; 凭据不能是脱敏占位符(否则存库即损坏)
function assertImportablePlatform(p) {
  if (!p.handler.trim() && !p.extractor.trim() && !p.parse.trim() && !(p.response && p.response.path)) {
    throw new Error('缺少处理函数')
  }
  for (const [k, v] of Object.entries(p.request.headers)) {
    if (v === '********') {
      throw new Error(`请求头 ${k} 是脱敏占位符，请使用完整导出（含真实凭据）的 JSON 导入`)
    }
  }
}

// 导入: 支持三种格式
//   1. 完整配置: { type:'quotahub-config', platforms:[...], presets:[...] }
//   2. 单个平台: { name, request:{url,...}, extractor?, parse? }
//   3. 单个预设: { name, fields, urlTemplate, headersTemplate, extractorTemplate }
// 按 id upsert(存在则覆盖, 不存在则新增), 单项失败不影响其他项
router.post('/import', (req, res) => {
  const body = req.body || {}

  let platforms = null
  let presets = null
  if (Array.isArray(body.platforms) || Array.isArray(body.presets)) {
    platforms = Array.isArray(body.platforms) ? body.platforms : null
    presets = Array.isArray(body.presets) ? body.presets : null
  } else if (isPlatformLike(body)) {
    platforms = [body]
  } else if (isPresetLike(body)) {
    presets = [body]
  } else {
    return res.status(400).json({
      error: '无法识别的配置格式: 需要完整配置(含 platforms/presets 数组)、单个平台或单个预设的 JSON',
    })
  }

  const result = { ok: true, platforms: 0, presets: 0, errors: [] }

  if (platforms) {
    const list = store.getPlatforms()
    for (const raw of platforms) {
      try {
        if (!raw || typeof raw !== 'object') throw new Error('条目不是对象')
        const p = sanitizePlatform(raw, crypto.randomUUID())
        if (!p.name) throw new Error('平台名称不能为空')
        if (!p.request.url) throw new Error('缺少请求 URL')
        assertImportablePlatform(p)
        const idx = list.findIndex((x) => x.id === p.id)
        if (idx === -1) list.push(p)
        else list[idx] = { ...list[idx], ...p }
        result.platforms++
      } catch (e) {
        result.errors.push(`平台「${(raw && raw.name) || '?'}」: ${e.message}`)
      }
    }
    store.savePlatforms(list)
  }

  if (presets) {
    const user = store.getPresets()
    for (const raw of presets) {
      try {
        if (!raw || typeof raw !== 'object') throw new Error('条目不是对象')
        const preset = validatePreset(raw)
        const id = typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID()
        const idx = user.findIndex((x) => x.id === id)
        const item = { id, ...preset }
        if (idx === -1) user.push(item)
        else user[idx] = { ...user[idx], ...item }
        result.presets++
      } catch (e) {
        result.errors.push(`预设「${(raw && raw.name) || '?'}」: ${e.message}`)
      }
    }
    store.savePresets(user)
  }

  res.json(result)
})

module.exports = router
