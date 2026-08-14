const crypto = require('crypto')
const express = require('express')
const store = require('../store')

const router = express.Router()

const BUILTIN = [
  {
    id: 'newapi',
    name: 'NEWAPI',
    fields: [
      { key: 'baseUrl', label: '请求地址（Base URL）', placeholder: 'https://your-newapi.example.com' },
      { key: 'token', label: '访问令牌', placeholder: 'sk-你的访问令牌' },
      { key: 'userId', label: '用户 ID（可留空）', placeholder: '留空则不发送 New-Api-User 头' },
    ],
    method: 'GET',
    urlTemplate: '{{baseUrl}}/api/user/self',
    headersTemplate: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer {{token}}',
      'User-Agent': 'cc-switch/1.0',
      'New-Api-User': '{{userId}}',
    },
    extractorTemplate: 'function (data) {\n  return data.data.quota / 500000\n}',
  },
]

function isBuiltinId(id) {
  return BUILTIN.some((b) => b.id === id)
}

function validatePreset(body) {
  if (!body || !String(body.name || '').trim()) throw new Error('预设名称不能为空')
  if (!Array.isArray(body.fields) || !body.fields.length) throw new Error('至少需要一个字段')
  for (const f of body.fields) {
    if (!f || !String(f.key || '').trim()) throw new Error('字段 key 不能为空')
    if (!/^[\w-]+$/.test(String(f.key).trim())) throw new Error('字段 key 只能包含字母、数字、下划线、连字符')
    if (!String(f.label || '').trim()) throw new Error('字段 label 不能为空')
  }
  if (!String(body.urlTemplate || '').trim()) throw new Error('URL 模板不能为空')
  let headers = {}
  try {
    headers = typeof body.headersTemplate === 'string' ? JSON.parse(body.headersTemplate) : body.headersTemplate
  } catch {
    throw new Error('请求头模板必须是合法 JSON')
  }
  if (typeof headers !== 'object' || Array.isArray(headers)) throw new Error('请求头模板必须是 JSON 对象')
  if (!String(body.extractorTemplate || '').trim()) throw new Error('提取函数模板不能为空')
  return {
    name: String(body.name).trim(),
    fields: body.fields.map((f) => ({
      key: String(f.key).trim(),
      label: String(f.label).trim(),
      placeholder: String(f.placeholder || '').trim(),
    })),
    method: body.method === 'POST' ? 'POST' : 'GET',
    urlTemplate: String(body.urlTemplate).trim(),
    headersTemplate: headers,
    extractorTemplate: String(body.extractorTemplate),
  }
}

function getUserPresets() {
  return store.getPresets()
}

function saveUserPresets(list) {
  store.savePresets(list)
}

router.get('/', (req, res) => {
  const user = getUserPresets()
  const merged = BUILTIN.map((b) => {
    const edited = user.find((p) => p.id === b.id)
    return edited ? { ...b, ...edited, builtin: true, edited: true } : { ...b, builtin: true }
  })
  for (const p of user) {
    if (!isBuiltinId(p.id)) merged.push({ ...p, builtin: false })
  }
  res.json(merged)
})

router.post('/', (req, res) => {
  try {
    const preset = validatePreset(req.body)
    const user = getUserPresets()
    const item = {
      id: crypto.randomUUID(),
      ...preset,
      createdAt: new Date().toISOString(),
    }
    user.push(item)
    saveUserPresets(user)
    res.status(201).json({ ...item, builtin: false })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

router.put('/:id', (req, res) => {
  try {
    const preset = validatePreset(req.body)
    const user = getUserPresets()
    const idx = user.findIndex((p) => p.id === req.params.id)
    if (idx === -1) {
      user.push({ id: req.params.id, ...preset })
    } else {
      user[idx] = { ...user[idx], ...preset }
    }
    saveUserPresets(user)
    res.json({ id: req.params.id, ...preset, builtin: isBuiltinId(req.params.id) })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

router.delete('/:id', (req, res) => {
  if (isBuiltinId(req.params.id)) {
    return res.status(400).json({ error: '内置预设使用重置恢复默认，不能删除' })
  }
  const user = getUserPresets()
  const next = user.filter((p) => p.id !== req.params.id)
  saveUserPresets(next)
  res.status(204).end()
})

router.post('/:id/reset', (req, res) => {
  if (!isBuiltinId(req.params.id)) {
    return res.status(400).json({ error: '仅内置预设支持重置' })
  }
  const user = getUserPresets()
  saveUserPresets(user.filter((p) => p.id !== req.params.id))
  const def = BUILTIN.find((b) => b.id === req.params.id)
  res.json({ ...def, builtin: true })
})

module.exports = router
module.exports.validatePreset = validatePreset
