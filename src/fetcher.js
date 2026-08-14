const TIMEOUT_MS = 15000

function resolvePath(obj, pathExpr) {
  const segments = String(pathExpr)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  let cur = obj
  for (const seg of segments) {
    if (cur == null) return undefined
    cur = cur[seg]
  }
  return cur
}

function toNumber(v) {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,\s¥$元]/g, ''))
    return Number.isNaN(n) ? v : n
  }
  return v
}

function buildBody(request) {
  if (!request.body) return undefined
  return typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
}

async function fetchBalance(platform) {
  const { request } = platform
  if (!request || !request.url) {
    throw new Error('未配置请求 URL')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let res
  try {
    res = await fetch(request.url, {
      method: request.method || 'GET',
      headers: request.headers || {},
      body: buildBody(request),
      signal: controller.signal,
    })
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? `请求超时 (${TIMEOUT_MS}ms)` : `请求失败: ${err.message}`)
  } finally {
    clearTimeout(timer)
  }

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`)
  }

  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('响应不是有效 JSON')
  }

  const { response } = platform
  if (!response || !response.path) {
    return { value: data, unit: (response && response.unit) || '' }
  }

  const raw = resolvePath(data, response.path)
  if (raw === undefined) {
    throw new Error(`响应中未找到路径: ${response.path}`)
  }
  return { value: toNumber(raw), unit: (response && response.unit) || '' }
}

module.exports = { fetchBalance, resolvePath }
