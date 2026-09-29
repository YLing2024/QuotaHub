import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// env 读取 + Zod 校验; 非法输入给出明确错误, 缺省给默认值
const envSchema = z.object({
  PORT: z.coerce
    .number({ error: 'PORT 必须是数字' })
    .int('PORT 必须是整数')
    .min(1, 'PORT 范围 1~65535')
    .max(65535, 'PORT 范围 1~65535')
    .default(3000),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  QUOTAHUB_DATA_DIR: z.string().trim().optional(),
  QUOTAHUB_STATIC_DIR: z.string().trim().optional(),
  // 沙箱脚本超时: 100ms ~ 30s, 默认 2000 (与旧 fetcher.js 行为一致)
  QUOTAHUB_SCRIPT_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number(v)
      return Number.isFinite(n) && n > 0 ? Math.min(Math.max(Math.floor(n), 100), 30000) : 2000
    }),
  // =1 时允许请求内网/环回地址 (SSRF 防护例外)
  QUOTAHUB_ALLOW_PRIVATE: z
    .string()
    .optional()
    .transform((v) => v === '1'),
  // 认证模式: builtin(默认, 自带账号) / sso(关闭自带口令, 只认 X-Auth-User)。
  // 未设置或取值非法一律回退 builtin。
  AUTH_MODE: z
    .string()
    .optional()
    .transform((v) => (v === 'sso' ? 'sso' : 'builtin')),
  // 首次启动引导创建的管理员用户名与口令(口令留空则随机生成并打印一次)
  QUOTAHUB_ADMIN_USER: z.string().trim().min(1).default('admin'),
  QUOTAHUB_ADMIN_PASSWORD: z.string().optional(),
  // 会话 TTL(小时), 默认 12; 非法/非正数回退 12, 上限 30 天
  QUOTAHUB_SESSION_TTL_HOURS: z
    .string()
    .optional()
    .transform((v) => {
      const n = Number(v)
      return Number.isFinite(n) && n > 0 ? Math.min(n, 720) : 12
    }),
})

export type AuthMode = 'builtin' | 'sso'

export interface Config {
  port: number
  host: string
  dataDir: string
  staticDir: string | null
  scriptTimeoutMs: number
  allowPrivate: boolean
  authMode: AuthMode
  adminUser: string
  // 未设置时为 null: 首次启动随机生成并打印一次
  adminPassword: string | null
  sessionTtlSeconds: number
}

// 从 startDir 向上查找包含 package.json 且 name 为 quotahub 的目录 (仓库根)
function findRepoRoot(startDir: string): string | null {
  let cur = startDir
  for (;;) {
    try {
      const pkgFile = path.join(cur, 'package.json')
      const raw = JSON.parse(fs.readFileSync(pkgFile, 'utf8')) as { name?: string }
      if (raw && raw.name === 'quotahub') return cur
    } catch {
      // 无 package.json 或解析失败, 继续向上
    }
    const parent = path.dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

function findRepoRootFromModule(): string {
  return findRepoRoot(moduleDir) ?? process.cwd()
}

// 数据目录: 默认 <仓库根>/data; QUOTAHUB_DATA_DIR 可覆盖(相对路径按 CWD 解析)
function resolveDataDir(repoRoot: string, override: string | undefined): string {
  if (override) return path.resolve(process.cwd(), override)
  return path.join(repoRoot, 'data')
}

// 静态前端目录: QUOTAHUB_STATIC_DIR 可覆盖; 默认 <仓库根>/public (存在才启用)
function resolveStaticDir(repoRoot: string, override: string | undefined): string | null {
  if (override) {
    const p = path.resolve(process.cwd(), override)
    return fs.existsSync(p) ? p : null
  }
  const fallback = path.join(repoRoot, 'public')
  return fs.existsSync(fallback) ? fallback : null
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse({
    PORT: env.PORT,
    HOST: env.HOST,
    QUOTAHUB_DATA_DIR: env.QUOTAHUB_DATA_DIR,
    QUOTAHUB_STATIC_DIR: env.QUOTAHUB_STATIC_DIR,
    QUOTAHUB_SCRIPT_TIMEOUT_MS: env.QUOTAHUB_SCRIPT_TIMEOUT_MS,
    QUOTAHUB_ALLOW_PRIVATE: env.QUOTAHUB_ALLOW_PRIVATE,
    AUTH_MODE: env.AUTH_MODE,
    QUOTAHUB_ADMIN_USER: env.QUOTAHUB_ADMIN_USER,
    QUOTAHUB_ADMIN_PASSWORD: env.QUOTAHUB_ADMIN_PASSWORD,
    QUOTAHUB_SESSION_TTL_HOURS: env.QUOTAHUB_SESSION_TTL_HOURS,
  })
  const repoRoot = findRepoRootFromModule()
  return {
    port: parsed.PORT,
    host: parsed.HOST,
    dataDir: resolveDataDir(repoRoot, parsed.QUOTAHUB_DATA_DIR),
    staticDir: resolveStaticDir(repoRoot, parsed.QUOTAHUB_STATIC_DIR),
    scriptTimeoutMs: parsed.QUOTAHUB_SCRIPT_TIMEOUT_MS,
    allowPrivate: parsed.QUOTAHUB_ALLOW_PRIVATE,
    authMode: parsed.AUTH_MODE,
    adminUser: parsed.QUOTAHUB_ADMIN_USER,
    adminPassword: parsed.QUOTAHUB_ADMIN_PASSWORD ? parsed.QUOTAHUB_ADMIN_PASSWORD : null,
    sessionTtlSeconds: Math.round(parsed.QUOTAHUB_SESSION_TTL_HOURS * 3600),
  }
}

// 全局单例: 进程启动时解析一次
export const config: Config = loadConfig()

export function ensureDataDir(dir: string = config.dataDir): void {
  fs.mkdirSync(dir, { recursive: true })
}
