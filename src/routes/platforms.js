const crypto = require('crypto')
const express = require('express')
const store = require('../store')
const { fetchBalance } = require('../fetcher')

const router = express.Router()

function toPublic(p) {
  const out = { ...p }
  // 旧数据迁移: response.prefix/suffix -> display
  out.display = out.display || {
    prefix: (p.response && p.response.prefix) || '',
    suffix: (p.response && p.response.suffix) || '',
  }
  return out
}

function pickDisplay(body) {
  const src = (body && body.display) || {}
  return {
    prefix: String(src.prefix || '').trim().slice(0, 20),
    suffix: String(src.suffix || '').trim().slice(0, 20),
  }
}

function pickConfig(body) {
  const cfg = {}
  if (body.name !== undefined) cfg.name = String(body.name).trim()
  if (body.request !== undefined) cfg.request = body.request
  if (body.handler !== undefined) {
    // 单函数模型: 保存 handler 时清掉旧字段(parse/extractor), 完成迁移
    cfg.handler = body.handler
    cfg.extractor = ''
    cfg.parse = ''
  } else {
    if (body.extractor !== undefined) cfg.extractor = body.extractor
    if (body.parse !== undefined) cfg.parse = body.parse
  }
  if (body.display !== undefined) cfg.display = pickDisplay(body)
  return cfg
}

function normalizePlatform(body) {
  return {
    id: crypto.randomUUID(),
    name: body.name || '未命名平台',
    request: {
      method: 'GET',
      url: '',
      headers: {},
      ...(body.request || {}),
    },
    handler: body.handler || '',
    extractor: body.extractor || '',
    parse: body.parse || '',
    display: pickDisplay(body),
    createdAt: new Date().toISOString(),
  }
}

// 至少需要一个处理/提取函数, 否则抓取必然失败
function assertHasHandler(p) {
  if (!String(p.handler || '').trim() && !String(p.extractor || '').trim() && !String(p.parse || '').trim()) {
    const err = new Error('需要配置处理函数（或旧的提取/解析函数）')
    err.status = 400
    throw err
  }
}

function findOr404(list, id) {
  const idx = list.findIndex((p) => p.id === id)
  if (idx === -1) {
    const err = new Error('平台不存在')
    err.status = 404
    return { idx: -1, err }
  }
  return { idx, err: null }
}

router.get('/', (req, res) => {
  res.json(store.getPlatforms().map(toPublic))
})

// 平台排序: ids 必须是现有平台 id 的完整排列(同时影响监控面板卡片顺序)
// 注意: 必须注册在 put('/:id') 之前, 否则会被 /:id 捕获
router.put('/reorder', (req, res) => {
  const ids = req.body && req.body.ids
  if (!Array.isArray(ids)) {
    return res.status(400).json({ error: '需要 ids 数组' })
  }
  const list = store.getPlatforms()
  if (ids.length !== list.length) {
    return res.status(400).json({ error: 'ids 数量与现有平台不匹配' })
  }
  const byId = new Map(list.map((p) => [p.id, p]))
  const seen = new Set()
  for (const id of ids) {
    if (!byId.has(id)) return res.status(400).json({ error: `未知平台 id: ${id}` })
    if (seen.has(id)) return res.status(400).json({ error: 'ids 包含重复项' })
    seen.add(id)
  }
  store.savePlatforms(ids.map((id) => byId.get(id)))
  res.json({ ok: true })
})

router.post('/', (req, res) => {
  const platform = normalizePlatform(req.body || {})
  try {
    assertHasHandler(platform)
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message })
  }
  const list = store.getPlatforms()
  list.push(platform)
  store.savePlatforms(list)
  res.status(201).json(toPublic(platform))
})

router.put('/:id', (req, res) => {
  const list = store.getPlatforms()
  const { idx, err } = findOr404(list, req.params.id)
  if (err) return res.status(err.status).json({ error: err.message })

  const old = list[idx]
  const patch = pickConfig(req.body || {})
  list[idx] = { ...old, ...patch }
  try {
    assertHasHandler(list[idx])
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message })
  }
  store.savePlatforms(list)
  res.json(toPublic(list[idx]))
})

router.delete('/:id', (req, res) => {
  const list = store.getPlatforms()
  const { idx, err } = findOr404(list, req.params.id)
  if (err) return res.status(err.status).json({ error: err.message })
  const [removed] = list.splice(idx, 1)
  store.savePlatforms(list)

  const balances = store.getBalances()
  delete balances[removed.id]
  store.saveBalances(balances)
  res.status(204).end()
})

router.post('/validate', async (req, res) => {
  const body = req.body || {}
  try {
    const result = await fetchBalance(body)
    res.json({ ok: true, ...result })
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message })
  }
})

router.post('/:id/test', async (req, res) => {
  const list = store.getPlatforms()
  const { idx, err } = findOr404(list, req.params.id)
  if (err) return res.status(err.status).json({ error: err.message })

  try {
    const result = await fetchBalance(list[idx])
    res.json({ ok: true, ...result, testedAt: new Date().toISOString() })
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message })
  }
})

router.post('/:id/fetch', async (req, res) => {
  const list = store.getPlatforms()
  const { idx, err } = findOr404(list, req.params.id)
  if (err) return res.status(err.status).json({ error: err.message })

  try {
    const result = await fetchBalance(list[idx])
    const balances = store.getBalances()
    balances[list[idx].id] = {
      ...result,
      fetchedAt: new Date().toISOString(),
    }
    store.saveBalances(balances)
    res.json({ ok: true, ...result, fetchedAt: balances[list[idx].id].fetchedAt })
  } catch (e) {
    const balances = store.getBalances()
    balances[list[idx].id] = { error: e.message, fetchedAt: new Date().toISOString() }
    store.saveBalances(balances)
    res.status(502).json({ ok: false, error: e.message })
  }
})

router.post('/refresh', async (req, res) => {
  const list = store.getPlatforms()
  const balances = store.getBalances()
  const results = []
  for (const p of list) {
    try {
      const result = await fetchBalance(p)
      balances[p.id] = { ...result, fetchedAt: new Date().toISOString() }
      results.push({ id: p.id, ok: true, ...result })
    } catch (e) {
      balances[p.id] = { error: e.message, fetchedAt: new Date().toISOString() }
      results.push({ id: p.id, ok: false, error: e.message })
    }
  }
  store.saveBalances(balances)
  res.json({ ok: true, results })
})

router.get('/balances', (req, res) => {
  const balances = store.getBalances()
  const platforms = store.getPlatforms()
  const data = platforms.map((p) => {
    const b = balances[p.id]
    return {
      id: p.id,
      name: p.name,
      display: toPublic(p).display,
      balance: b ? b.value : null,
      error: b ? b.error : null,
      fetchedAt: b ? b.fetchedAt : null,
    }
  })
  res.json({ updatedAt: new Date().toISOString(), platforms: data })
})

module.exports = router
