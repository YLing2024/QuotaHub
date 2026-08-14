const crypto = require('crypto')
const express = require('express')
const store = require('../store')
const { getTemplate } = require('../templates')
const { fetchBalance } = require('../fetcher')

const router = express.Router()

function maskKey(key) {
  if (!key) return ''
  return `${key.slice(0, 3)}••••${key.slice(-4)}`
}

function toPublic(p) {
  const { apiKey, ...rest } = p
  return { ...rest, apiKeyMasked: maskKey(apiKey) }
}

function pickConfig(body) {
  const cfg = {}
  if (body.name !== undefined) cfg.name = String(body.name).trim()
  if (body.template !== undefined) cfg.template = body.template
  if (body.request !== undefined) cfg.request = body.request
  if (body.response !== undefined) cfg.response = body.response
  if (body.threshold !== undefined) cfg.threshold = body.threshold
  if (body.enabled !== undefined) cfg.enabled = Boolean(body.enabled)
  if (body.currency !== undefined) cfg.currency = body.currency
  return cfg
}

function normalizePlatform(body) {
  const tmpl = body.template ? getTemplate(body.template) : null
  const request = {
    method: 'GET',
    url: '',
    headers: { Authorization: 'Bearer {{apiKey}}' },
    ...(tmpl ? tmpl.request : {}),
    ...(body.request || {}),
  }
  const response = {
    path: '',
    unit: 'USD',
    ...(tmpl ? tmpl.response : {}),
    ...(body.response || {}),
  }
  return {
    id: crypto.randomUUID(),
    name: body.name || (tmpl ? tmpl.name : '未命名平台'),
    template: body.template || 'custom',
    request,
    response,
    apiKey: body.apiKey || '',
    threshold: body.threshold ?? 10,
    enabled: body.enabled !== false,
    currency: response.unit || 'USD',
    createdAt: new Date().toISOString(),
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

router.get('/templates', (req, res) => {
  const { TEMPLATES, toPublicTemplate } = require('../templates')
  res.json(TEMPLATES.map(toPublicTemplate))
})

router.get('/', (req, res) => {
  res.json(store.getPlatforms().map(toPublic))
})

router.post('/', (req, res) => {
  const platform = normalizePlatform(req.body || {})
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
  if (req.body && req.body.apiKey && !req.body.apiKey.includes('••••')) {
    patch.apiKey = req.body.apiKey
  }
  const updated = { ...old, ...patch }
  if (updated.currency === undefined) {
    updated.currency = (updated.response && updated.response.unit) || 'USD'
  }
  list[idx] = updated
  store.savePlatforms(list)
  res.json(toPublic(updated))
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
  if (!list[idx].enabled) {
    return res.status(400).json({ error: '平台已停用' })
  }

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
    res.status(502).json({ ok: false, error: e.message })
  }
})

router.post('/refresh', async (req, res) => {
  const list = store.getPlatforms().filter((p) => p.enabled)
  const balances = store.getBalances()
  const results = []
  for (const p of list) {
    try {
      const result = await fetchBalance(p)
      balances[p.id] = { ...result, fetchedAt: new Date().toISOString() }
      results.push({ id: p.id, ok: true, ...result })
    } catch (e) {
      results.push({ id: p.id, ok: false, error: e.message })
    }
  }
  store.saveBalances(balances)
  res.json({ ok: true, results })
})

router.get('/balances', (req, res) => {
  const balances = store.getBalances()
  const platforms = store.getPlatforms()
  const data = platforms.map((p) => ({
    id: p.id,
    name: p.name,
    enabled: p.enabled,
    currency: p.currency || (p.response && p.response.unit) || 'USD',
    threshold: p.threshold,
    balance: balances[p.id] ? balances[p.id].value : null,
    unit: balances[p.id] ? balances[p.id].unit : '',
    fetchedAt: balances[p.id] ? balances[p.id].fetchedAt : null,
  }))
  res.json({ updatedAt: new Date().toISOString(), platforms: data })
})

module.exports = router
