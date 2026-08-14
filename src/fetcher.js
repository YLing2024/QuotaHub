const vm = require('vm')

const TIMEOUT_MS = 15000
const EXTRACT_TIMEOUT_MS = 2000

const FORBIDDEN_FN = /\b(new\s+Function|Function\s*\()/
const FORBIDDEN = /\b(require|import\s*\(|import\b|process|module|exports|globalThis|\bglobal\b|window|document|fetch|XMLHttpRequest|WebSocket|\beval\b|constructor|__proto__|prototype|child_process|exec|spawn|node:)/i

const ALLOWED_TOP_LEVEL = new Set([
  'data',
  'Math',
  'Number',
  'JSON',
  'Object',
  'Array',
  'String',
  'Boolean',
  'Date',
  'RegExp',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'Infinity',
  'NaN',
  'undefined',
  'arguments',
  'function',
  'return',
  'var',
  'let',
  'const',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'throw',
  'try',
  'catch',
  'finally',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'this',
  'true',
  'false',
  'null',
  'yield',
  'await',
  'async',
  'class',
  'extends',
  'super',
  'static',
  'get',
  'set',
])

function checkTopLevelWhitelist(code) {
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n\r]*/g, ' ')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')

  const declared = new Set()
  for (const m of stripped.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) {
    declared.add(m[1])
  }
  for (const m of stripped.matchAll(/function\s*\(([^)]*)\)/g)) {
    m[1].split(',').forEach((p) => {
      const n = p.trim().match(/[A-Za-z_$][\w$]*/)
      if (n) declared.add(n[0])
    })
  }
  for (const m of stripped.matchAll(/\(([^)]*)\)\s*=>/g)) {
    m[1].split(',').forEach((p) => {
      const n = p.trim().match(/[A-Za-z_$][\w$]*/)
      if (n) declared.add(n[0])
    })
  }
  for (const m of stripped.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) {
    declared.add(m[1])
  }

  const tokens = stripped.match(/[A-Za-z_$][\w$]*/g) || []
  for (const t of tokens) {
    if (ALLOWED_TOP_LEVEL.has(t) || declared.has(t)) continue
    const idx = stripped.indexOf(t)
    const before = stripped.slice(0, idx).trimEnd()
    const prevChar = before ? before[before.length - 1] : ''
    if (prevChar === '.' || prevChar === '[' || prevChar === ']' || prevChar === ',') {
      continue
    }
    throw new Error(`使用了白名单外的标识符: ${t}`)
  }
}

const SANDBOX_API = Object.freeze({
  Math: Object.freeze(Math),
  Number,
  JSON,
  Object,
  Array,
  String,
  Boolean,
  Date,
  RegExp,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  Infinity,
  NaN,
  undefined,
})

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

function runExtractor(src, data) {
  const code = String(src || '').trim()
  if (!code) throw new Error('未配置提取函数')
  let bad = null
  const fnHit = FORBIDDEN_FN.exec(code)
  const hit = FORBIDDEN.exec(code)
  if (fnHit) bad = fnHit[0]
  else if (hit) bad = hit[0]
  if (bad) {
    throw new Error(`提取函数包含禁止的 API: ${bad}`)
  }
  checkTopLevelWhitelist(code)

  const sandbox = Object.assign(Object.create(null), SANDBOX_API, { data })
  vm.createContext(sandbox)
  try {
    return vm.runInNewContext(`(${code})(data)`, sandbox, { timeout: EXTRACT_TIMEOUT_MS })
  } catch (e) {
    if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      throw new Error(`提取函数执行超时 (${EXTRACT_TIMEOUT_MS}ms)`)
    }
    throw new Error(`提取函数执行失败: ${e.message}`)
  }
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
      body: request.body ? JSON.stringify(request.body) : undefined,
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

  let value
  if (platform.extractor) {
    value = runExtractor(platform.extractor, data)
  } else if (platform.response && platform.response.path) {
    value = resolvePath(data, platform.response.path)
    if (value !== undefined && Number(platform.response.divider)) {
      value = toNumber(value) / Number(platform.response.divider)
    }
  } else {
    throw new Error('未配置提取函数')
  }
  if (value === undefined) throw new Error('提取函数未返回余额')

  return { value: toNumber(value) }
}

module.exports = { fetchBalance, resolvePath, runExtractor }
