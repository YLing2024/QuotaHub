import crypto from 'node:crypto'
import fs from 'node:fs'
import { config } from '../config.js'

// BFF 模式 SSO 服务: state/PKCE 与站内会话全部存进程内 Map (不引 Redis / 不新增依赖)。
// 换来的 token 只留在服务端, 绝不发给前端。

const STATE_TTL_MS = 10 * 60 * 1000 // 授权 state / PKCE verifier 10 分钟
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 站内会话 7 天滑动

interface PendingAuth {
  verifier: string
  createdAt: number
}

interface StoredSession {
  sub: string
  name: string
  role: string
  accessToken: string
  refreshToken: string
  exp: number
  createdAt: number
  lastSeen: number
}

export interface SessionUser {
  sub: string
  name: string
  role: string
}

export interface TokenSet {
  accessToken: string
  refreshToken: string
  idToken: string
  exp: number
}

// state -> { verifier }, sid 的 sha256 -> 会话。均为进程内, 重启即失效(预期)。
const pendingAuth = new Map<string, PendingAuth>()
const sessions = new Map<string, StoredSession>()

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

// 惰性清理过期项, 保证 Map 不无限增长
export function sweep(now: number = Date.now()): void {
  for (const [state, pending] of pendingAuth) {
    if (now - pending.createdAt > STATE_TTL_MS) pendingAuth.delete(state)
  }
  for (const [key, session] of sessions) {
    if (now - session.lastSeen > SESSION_TTL_MS) sessions.delete(key)
  }
}

const sweepTimer = setInterval(() => sweep(), 60_000)
sweepTimer.unref()

// ---- 授权请求: 生成 state + PKCE S256 challenge ----
export function createAuthRequest(now: number = Date.now()): { state: string; challenge: string } {
  sweep(now)
  const state = crypto.randomBytes(16).toString('hex')
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  pendingAuth.set(state, { verifier, createdAt: now })
  return { state, challenge }
}

// 一次性消费 state: 命中删掉并返回 verifier; 未命中返回 null
export function consumeAuthState(state: string, now: number = Date.now()): string | null {
  sweep(now)
  if (!state) return null
  const pending = pendingAuth.get(state)
  if (!pending) return null
  pendingAuth.delete(state)
  if (now - pending.createdAt > STATE_TTL_MS) return null
  return pending.verifier
}

export function buildAuthorizeUrl(redirectUri: string, state: string, challenge: string): string {
  const params = new URLSearchParams({
    client_id: config.ssoClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  return `${config.ssoIssuer}/authorize?${params.toString()}`
}

// ---- client_secret: 从 0600 文件读取, 绝不写日志/返回前端 ----
let cachedSecret: string | null = null

export function readClientSecret(): string {
  if (cachedSecret !== null) return cachedSecret
  try {
    const raw = fs.readFileSync(config.ssoClientSecretFile, 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      if (trimmed.slice(0, eq).trim() !== config.ssoClientSecretKey) continue
      cachedSecret = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
      return cachedSecret
    }
  } catch {
    // 文件不存在或不可读 -> 视为未配置, 不抛出(避免泄漏路径信息)
  }
  cachedSecret = ''
  return cachedSecret
}

// ---- 用授权码换 token (client_secret_post) ----
export async function exchangeCode(input: {
  code: string
  redirectUri: string
  verifier: string
}): Promise<TokenSet> {
  const secret = readClientSecret()
  if (!secret) throw new Error('SSO 客户端密钥未配置')
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: config.ssoClientId,
    client_secret: secret,
    code_verifier: input.verifier,
  })
  const res = await fetch(`${config.ssoIssuer}/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`令牌端点返回 ${res.status}`)
  const data = (await res.json()) as Record<string, unknown>
  const accessToken = typeof data.access_token === 'string' ? data.access_token : ''
  if (!accessToken) throw new Error('令牌响应缺少 access_token')
  const expiresIn = Number(data.expires_in)
  return {
    accessToken,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : '',
    idToken: typeof data.id_token === 'string' ? data.id_token : '',
    exp: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3600_000),
  }
}

// ---- 取用户信息: 优先 /userinfo, 失败回退 id_token 载荷 ----
export async function fetchProfile(
  accessToken: string,
  idToken: string,
): Promise<SessionUser> {
  try {
    const res = await fetch(`${config.ssoIssuer}/userinfo`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>
      const sub = stringField(data.sub) || decodeIdTokenSub(idToken)
      if (sub) {
        return {
          sub,
          name: stringField(data.name) || stringField(data.preferred_username) || sub,
          role: stringField(data.role) || 'user',
        }
      }
    }
  } catch {
    // 忽略, 走 id_token 回退
  }
  const sub = decodeIdTokenSub(idToken) || 'unknown'
  return { sub, name: sub, role: 'user' }
}

function stringField(v: unknown): string {
  return typeof v === 'string' && v.trim() ? v.trim() : ''
}

function decodeIdTokenSub(idToken: string): string {
  const parts = idToken.split('.')
  if (parts.length < 2) return ''
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1] as string, 'base64url').toString('utf8'),
    ) as Record<string, unknown>
    return stringField(payload.sub) || stringField(payload.preferred_username)
  } catch {
    return ''
  }
}

// ---- 站内会话 ----
export function createSession(input: {
  sub: string
  name: string
  role: string
  accessToken: string
  refreshToken: string
  exp: number
}): string {
  sweep()
  const sid = crypto.randomBytes(32).toString('hex')
  const now = Date.now()
  sessions.set(sha256Hex(sid), {
    sub: input.sub,
    name: input.name,
    role: input.role,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    exp: input.exp,
    createdAt: now,
    lastSeen: now,
  })
  return sid
}

// 读会话(滑动 TTL): 返回身份信息; 无效/过期返回 null
export function getSession(sid: string, now: number = Date.now()): SessionUser | null {
  if (!sid) return null
  sweep(now)
  const key = sha256Hex(sid)
  const session = sessions.get(key)
  if (!session) return null
  session.lastSeen = now
  return { sub: session.sub, name: session.name, role: session.role }
}

// 删除会话并返回其 token (供 /revoke 使用)
export function destroySession(sid: string): StoredSession | null {
  if (!sid) return null
  const key = sha256Hex(sid)
  const session = sessions.get(key) ?? null
  sessions.delete(key)
  return session
}

// ---- 撤销 token (best-effort, 失败不影响登出) ----
export async function revokeSession(session: StoredSession | null): Promise<void> {
  if (!session) return
  const token = session.refreshToken || session.accessToken
  if (!token) return
  const secret = readClientSecret()
  try {
    const body = new URLSearchParams({
      token,
      token_type_hint: session.refreshToken ? 'refresh_token' : 'access_token',
      client_id: config.ssoClientId,
    })
    if (secret) body.set('client_secret', secret)
    await fetch(`${config.ssoIssuer}/revoke`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    // 撤销失败不阻塞登出
  }
}

export const ssoService = {
  createAuthRequest,
  consumeAuthState,
  buildAuthorizeUrl,
  exchangeCode,
  fetchProfile,
  createSession,
  getSession,
  destroySession,
  revokeSession,
  readClientSecret,
  sweep,
}
