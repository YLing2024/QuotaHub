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
  QUOTAHUB_TOKEN: z.string().trim().default(''),
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
  // ---- BFF SSO 配置 (认证中心地址等私有信息一律走 env, 源码不硬编码) ----
  // 授权/令牌/用户信息/撤销端点所在 issuer; 生产必须覆盖为真实认证中心
  QUOTAHUB_SSO_ISSUER: z.string().trim().default('https://auth.example.com'),
  QUOTAHUB_SSO_CLIENT_ID: z.string().trim().min(1).default('quotahub'),
  // 回调地址: 留空则按请求 Host/X-Forwarded-Proto 推导, 生产建议显式固定(须与认证中心注册精确一致)
  QUOTAHUB_SSO_REDIRECT_URI: z.string().trim().optional(),
  // client_secret 存放文件与键名 (文件 0600; 只读不打印不提交)
  QUOTAHUB_SSO_CLIENT_SECRET_FILE: z.string().trim().default('/root/.sso_clients.env'),
  QUOTAHUB_SSO_CLIENT_SECRET_KEY: z.string().trim().min(1).default('QUOTAHUB_CLIENT_SECRET'),
  QUOTAHUB_SSO_COOKIE_NAME: z.string().trim().min(1).default('__Host-quotahub_session'),
})

export interface Config {
  port: number
  host: string
  token: string
  dataDir: string
  staticDir: string | null
  scriptTimeoutMs: number
  allowPrivate: boolean
  ssoIssuer: string
  ssoClientId: string
  ssoRedirectUri: string | null
  ssoClientSecretFile: string
  ssoClientSecretKey: string
  ssoCookieName: string
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
    QUOTAHUB_TOKEN: env.QUOTAHUB_TOKEN,
    QUOTAHUB_DATA_DIR: env.QUOTAHUB_DATA_DIR,
    QUOTAHUB_STATIC_DIR: env.QUOTAHUB_STATIC_DIR,
    QUOTAHUB_SCRIPT_TIMEOUT_MS: env.QUOTAHUB_SCRIPT_TIMEOUT_MS,
    QUOTAHUB_ALLOW_PRIVATE: env.QUOTAHUB_ALLOW_PRIVATE,
    QUOTAHUB_SSO_ISSUER: env.QUOTAHUB_SSO_ISSUER,
    QUOTAHUB_SSO_CLIENT_ID: env.QUOTAHUB_SSO_CLIENT_ID,
    QUOTAHUB_SSO_REDIRECT_URI: env.QUOTAHUB_SSO_REDIRECT_URI,
    QUOTAHUB_SSO_CLIENT_SECRET_FILE: env.QUOTAHUB_SSO_CLIENT_SECRET_FILE,
    QUOTAHUB_SSO_CLIENT_SECRET_KEY: env.QUOTAHUB_SSO_CLIENT_SECRET_KEY,
    QUOTAHUB_SSO_COOKIE_NAME: env.QUOTAHUB_SSO_COOKIE_NAME,
  })
  const repoRoot = findRepoRootFromModule()
  return {
    port: parsed.PORT,
    host: parsed.HOST,
    token: parsed.QUOTAHUB_TOKEN,
    dataDir: resolveDataDir(repoRoot, parsed.QUOTAHUB_DATA_DIR),
    staticDir: resolveStaticDir(repoRoot, parsed.QUOTAHUB_STATIC_DIR),
    scriptTimeoutMs: parsed.QUOTAHUB_SCRIPT_TIMEOUT_MS,
    allowPrivate: parsed.QUOTAHUB_ALLOW_PRIVATE,
    ssoIssuer: parsed.QUOTAHUB_SSO_ISSUER.replace(/\/+$/, ''),
    ssoClientId: parsed.QUOTAHUB_SSO_CLIENT_ID,
    ssoRedirectUri: parsed.QUOTAHUB_SSO_REDIRECT_URI?.trim() || null,
    ssoClientSecretFile: parsed.QUOTAHUB_SSO_CLIENT_SECRET_FILE,
    ssoClientSecretKey: parsed.QUOTAHUB_SSO_CLIENT_SECRET_KEY,
    ssoCookieName: parsed.QUOTAHUB_SSO_COOKIE_NAME,
  }
}

// 全局单例: 进程启动时解析一次
export const config: Config = loadConfig()

export function ensureDataDir(dir: string = config.dataDir): void {
  fs.mkdirSync(dir, { recursive: true })
}
