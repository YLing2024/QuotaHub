const crypto = require('crypto')
const express = require('express')
const store = require('../store')
const { fetchBalance } = require('../fetcher')

const router = express.Router()

function toPublic(p) {
  return { ...p }
}

function pickConfig(body) {
  const cfg = {}
  if (body.name !== undefined) cfg.name = String(body.name).trim()
  if (body.preset !== undefined) cfg.preset = body.preset
  if (body.request !== undefined) cfg.request = body.request
  if (body.response !== undefined) cfg.response = body.response
  return cfg
}

function normalizePlatform(body) {
  return {
    id: crypto.randomUUID(),
    name: body.name || '未命名平台',
    preset: body.preset || 'custom',
    request: {
      method: 'GET',
      url: '',
      headers: {},
      ...(body.request || {}),
    },
    response: {
      path: '',
      prefix: '',
      suffix: '',
      ...(body.response || {}),
    },
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
  list[idx] = { ...old, ...patch }
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
    prefix: (p.response && p.response.prefix) || '',
    suffix: (p.response && p.response.suffix) || '',
    balance: balances[p.id] ? balances[p.id].value : null,
    fetchedAt: balances[p.id] ? balances[p.id].fetchedAt : null,
  }))
  res.json({ updatedAt: new Date().toISOString(), platforms: data })
})

module.exports = router
