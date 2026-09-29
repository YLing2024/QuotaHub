import crypto from 'node:crypto'
import { config } from '../config.js'
import { userRepo, sessionRepo } from '../repositories/index.js'

// builtin 认证模式业务逻辑: 口令哈希、会话、首启引导、登录失败限速。
// 口令哈希只用 node:crypto scrypt, 不引入新依赖。

const SCRYPT_KEYLEN = 64
// 用户不存在时也跑一次 scrypt, 避免用响应时间枚举账号
const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(SCRYPT_KEYLEN * 2)}`

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[1]!, 'hex')
    expected = Buffer.from(parts[2]!, 'hex')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false
  const actual = crypto.scryptSync(password, salt, expected.length)
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

// 首启引导: users 为空时创建管理员; 已存在用户绝不覆盖口令。
// 返回是否新建, 便于入口打印提示。
export function ensureSeedAdmin(): boolean {
  if (userRepo.count() > 0) return false
  const username = config.adminUser
  let password = config.adminPassword
  let generated = false
  if (!password) {
    password = crypto.randomBytes(12).toString('base64url')
    generated = true
  }
  userRepo.insert(username, hashPassword(password), new Date().toISOString())
  console.log(`已创建管理员账号「${username}」`)
  if (generated) {
    console.log('------------------------------------------------------------')
    console.log(`初始口令: ${password}`)
    console.log('此口令只在本次启动打印一次，请立即保存。')
    console.log('------------------------------------------------------------')
  } else {
    console.log('初始口令取自 QUOTAHUB_ADMIN_PASSWORD。')
  }
  return true
}

export interface Session {
  token: string
  username: string
  expiresAt: string
}

export function createSession(username: string): Session {
  const now = Date.now()
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(now + config.sessionTtlSeconds * 1000).toISOString()
  sessionRepo.insert({
    token,
    username,
    created_at: new Date(now).toISOString(),
    expires_at: expiresAt,
  })
  return { token, username, expiresAt }
}

// 命中即通过并滑动续期; 过期/不存在返回 null
export function verifySession(token: string | null): { name: string } | null {
  if (!token) return null
  const row = sessionRepo.findValid(token, new Date().toISOString())
  if (!row) return null
  const expiresAt = new Date(Date.now() + config.sessionTtlSeconds * 1000).toISOString()
  sessionRepo.touch(token, expiresAt)
  return { name: row.username }
}

export function login(username: string, password: string): Session | null {
  const user = userRepo.findByUsername(username)
  if (!user) {
    verifyPassword(password, DUMMY_HASH)
    return null
  }
  if (!verifyPassword(password, user.password_hash)) return null
  return createSession(user.username)
}

export function logout(token: string | null): void {
  if (token) sessionRepo.remove(token)
}

export function sessionTtlSeconds(): number {
  return config.sessionTtlSeconds
}

// ---- 登录失败限速 (内存, 按 IP) ----
// 连续失败 MAX_FAILURES 次锁 LOCK_MS; 锁定期内返回剩余秒数。

const MAX_FAILURES = 5
const LOCK_MS = 15 * 60 * 1000

interface Attempt {
  failures: number
  lockedUntil: number
}

const attempts = new Map<string, Attempt>()

export function retryAfterSeconds(ip: string): number {
  const a = attempts.get(ip)
  if (!a || a.lockedUntil <= Date.now()) return 0
  return Math.ceil((a.lockedUntil - Date.now()) / 1000)
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now()
  const a = attempts.get(ip) ?? { failures: 0, lockedUntil: 0 }
  a.failures += 1
  if (a.failures >= MAX_FAILURES) {
    a.lockedUntil = now + LOCK_MS
    a.failures = 0
  }
  attempts.set(ip, a)
}

export function resetLoginFailures(ip: string): void {
  attempts.delete(ip)
}

export const authService = {
  hashPassword,
  verifyPassword,
  ensureSeedAdmin,
  createSession,
  verifySession,
  login,
  logout,
  sessionTtlSeconds,
  retryAfterSeconds,
  recordLoginFailure,
  resetLoginFailures,
}
