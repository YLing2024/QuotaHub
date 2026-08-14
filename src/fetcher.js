const vm = require('vm')
const net = require('net')
const dns = require('dns').promises

const TIMEOUT_MS = 15000

// 沙箱脚本执行时长上限(解析函数/提取函数/JS 响应求值统一生效)。
// 可用环境变量 QUOTAHUB_SCRIPT_TIMEOUT_MS 调整, 限制在 100ms ~ 30s 之间。
const rawScriptTimeout = Number(process.env.QUOTAHUB_SCRIPT_TIMEOUT_MS)
const EXTRACT_TIMEOUT_MS = Number.isFinite(rawScriptTimeout) && rawScriptTimeout > 0
  ? Math.min(Math.max(Math.floor(rawScriptTimeout), 100), 30000)
  : 2000

// 默认禁止访问环回/内网/云元数据地址(SSRF); 需要监控内网平台时设 QUOTAHUB_ALLOW_PRIVATE=1
const ALLOW_PRIVATE = process.env.QUOTAHUB_ALLOW_PRIVATE === '1'

// 黑名单/白名单仅为纵深防御, 真正的安全边界是 vm realm 隔离(见 runExtractor)
const FORBIDDEN_FN = /\b(new\s+Function|Function\s*\()/
const FORBIDDEN = /\b(require|import\s*\(|import\b|process|module|exports|globalThis|\bglobal\b|window|document|fetch|XMLHttpRequest|WebSocket|\beval\b|constructor|__proto__|prototype|child_process|exec|spawn|node:|\bthis\b|setPrototypeOf|getPrototypeOf|defineProperty|defineProperties|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__|Reflect|Proxy)/i

// 解码 \uXXXX 转义后再做词法检查, 堵住 data.\u0063onstructor 这类绕过
function decodeUnicodeEscapes(code) {
  return code.replace(/\\u([0-9a-fA-F]{4})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)))
}

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
    .replace(/`(?:\\.|[^`\\])*`/g, (m) => {
      const exprs = [...m.matchAll(/\$\{([\s\S]*?)\}/g)].map((x) => x[1])
      return exprs.length ? exprs.join(' ; ') : '``'
    })

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
    let idx = -1
    let propOnly = true
    while ((idx = stripped.indexOf(t, idx + 1)) !== -1) {
      const before = stripped.slice(0, idx).trimEnd()
      const prevChar = before ? before[before.length - 1] : ''
      if (!(prevChar === '.' || prevChar === '[' || prevChar === ']' || prevChar === ',')) {
        propOnly = false
        break
      }
    }
    if (propOnly) continue
    throw new Error(`使用了白名单外的标识符: ${t}`)
  }
}

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

function isPrivateIp(ip) {
  const parts = ip.split('.').map(Number)
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n))) {
    const [a, b] = parts
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    if (a === 169 && b === 254) return true // 云元数据 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a >= 224) return true // 组播/保留
    return false
  }
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice(7))
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // ULA
  if (/^fe[89ab]/.test(lower)) return true // 链路本地 fe80::/10
  if (lower.startsWith('ff')) return true // 组播
  return false
}

// SSRF 防护: 仅允许 http/https; 默认拒绝环回/内网/云元数据地址
async function assertPublicUrl(url) {
  let u
  try {
    u = new URL(url)
  } catch {
    throw new Error('请求 URL 无效')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('仅支持 http/https 请求')
  }
  if (ALLOW_PRIVATE) return

  const deny = '目标地址为环回/内网地址，已阻止 (设置 QUOTAHUB_ALLOW_PRIVATE=1 可放开)'
  const host = u.hostname
  if (host === 'localhost' || host === 'localhost.localdomain' || host.endsWith('.localhost')) {
    throw new Error(deny)
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error(deny)
    return
  }
  let ips = []
  try {
    ips = await dns.lookup(host, { all: true, verbatim: true })
  } catch {
    // 域名解析失败交给后续 fetch 报错
  }
  for (const { address } of ips) {
    if (isPrivateIp(address)) throw new Error(deny)
  }
}

// 部分接口(opencode 等)返回 JS 赋值表达式而非 JSON:
// 去掉 ";0x...;" 长度前缀后在 vm 沙箱中求值取回对象, 与提取函数同等安全边界(无宿主对象 + 超时)
function evalJsResponse(text) {
  const code = String(text).trim().replace(/^;0x[0-9a-f]+;/, '')
  if (!code) throw new Error('响应不是有效 JSON')
  const sandbox = Object.create(null)
  vm.createContext(sandbox)
  try {
    // self 与 $R 指向同一对象, 兼容 $R 赋值式 RPC 协议
    vm.runInNewContext('self = {}; $R = self.$R = {}', sandbox, { timeout: EXTRACT_TIMEOUT_MS })
    const value = vm.runInNewContext(code, sandbox, { timeout: EXTRACT_TIMEOUT_MS })
    if (value === undefined) throw new Error('响应求值结果为空')
    return value
  } catch (e) {
    if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      throw new Error('响应求值超时')
    }
    throw new Error(`响应不是有效 JSON/JS: ${e.message}`)
  }
}

// 解析函数(parse): 平台开放给生态开发者的"安全 eval"入口。
// 在干净 vm 上下文(无宿主对象)中执行, 开发者可在函数内直接用标准 eval/Function
// 处理任何响应格式 —— eval 是 vm 内建, 其构造链只能到达 vm 内部, 无法触达宿主
// (process/require/fs 等), 与提取函数同一套安全边界。
function runParse(raw, src) {
  const code = String(src || '').trim()
  if (!code) throw new Error('未配置解析函数')
  // raw 是原始字符串(原始值, 无 constructor 链), 放入沙箱全局供解析代码引用
  const sandbox = Object.assign(Object.create(null), { raw: String(raw) })
  vm.createContext(sandbox)
  try {
    return vm.runInNewContext(`(${code})(raw)`, sandbox, { timeout: EXTRACT_TIMEOUT_MS })
  } catch (e) {
    if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      throw new Error(`解析函数执行超时 (${EXTRACT_TIMEOUT_MS}ms)`)
    }
    throw new Error(`解析函数执行失败: ${e.message}`)
  }
}

function runExtractor(src, data) {
  const code = String(src || '').trim()
  if (!code) throw new Error('未配置提取函数')

  // 纵深防御: 对解码 unicode 转义后的源码做黑名单 + 白名单检查
  const checked = decodeUnicodeEscapes(code)
  let bad = null
  const fnHit = FORBIDDEN_FN.exec(checked)
  const hit = FORBIDDEN.exec(checked)
  if (fnHit) bad = fnHit[0]
  else if (hit) bad = hit[0]
  if (bad) {
    throw new Error(`提取函数包含禁止的 API: ${bad}`)
  }
  checkTopLevelWhitelist(checked)

  // 安全边界: 沙箱中绝不注入任何宿主 realm 的对象。
  // 宿主对象(如 data.constructor)会指向宿主 Function 构造函数, 可借此逃逸到宿主全局。
  // 这里上下文为空, 自带 vm realm 的内建对象(Math/JSON/Object...);
  // data 以 JSON 字面量注入, 是 vm realm 的对象, 其 constructor 链只能到达 vm 内部。
  const sandbox = Object.create(null)
  vm.createContext(sandbox)
  try {
    let dataJson = 'null'
    try {
      dataJson = JSON.stringify(data) ?? 'null'
    } catch {
      // 循环引用/非序列化值: 降级为 null
    }
    vm.runInNewContext(`data = ${dataJson}`, sandbox, { timeout: EXTRACT_TIMEOUT_MS })
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

  await assertPublicUrl(request.url)

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

  // 响应体大小限制: 防止恶意服务器返回超大 JS/JSON 造成内存 DoS
  const MAX_RESPONSE_BYTES = 1024 * 1024 // 1MB
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > MAX_RESPONSE_BYTES) {
    throw new Error(`响应过大 (${declared} 字节, 上限 1MB)`)
  }

  const text = await res.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error('响应过大 (超过 1MB)')
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`)
  }

  let value
  if (platform.handler) {
    // 单函数模型: 处理函数(raw => 余额值), 一个函数搞定解析+提取
    value = runParse(text, platform.handler)
  } else if (platform.extractor || platform.parse) {
    // 旧模型兼容: 解析(parse/内置 JSON/JS 求值) -> 提取(extractor)
    let data
    if (platform.parse) {
      data = runParse(text, platform.parse)
    } else {
      try {
        data = JSON.parse(text)
      } catch {
        data = evalJsResponse(text)
      }
    }
    if (platform.extractor) {
      value = runExtractor(platform.extractor, data)
    } else {
      value = data
    }
  } else if (platform.response && platform.response.path) {
    let data
    try {
      data = JSON.parse(text)
    } catch {
      data = evalJsResponse(text)
    }
    value = resolvePath(data, platform.response.path)
    if (value !== undefined && Number(platform.response.divider)) {
      value = toNumber(value) / Number(platform.response.divider)
    }
  } else {
    throw new Error('未配置处理函数')
  }
  if (value === undefined) throw new Error('处理函数未返回余额')

  return { value: toNumber(value) }
}

module.exports = { fetchBalance, resolvePath, runExtractor, runParse, evalJsResponse, EXTRACT_TIMEOUT_MS }
