// 前端类型: 镜像后端 API 输出

export type HttpMethod = 'GET' | 'POST'

export interface DisplayConfig {
  prefix: string
  suffix: string
}

export interface PlatformRequest {
  method: HttpMethod
  url: string
  headers: Record<string, string>
  body?: unknown
}

// 旧数据兼容字段: response.prefix/suffix -> display 迁移用
export interface LegacyResponse {
  path?: string
  divider?: number
  prefix?: string
  suffix?: string
}

export interface Platform {
  id: string
  name: string
  request: PlatformRequest
  handler: string
  extractor?: string
  parse?: string
  response?: LegacyResponse
  display: DisplayConfig
  url?: string
  createdAt: string
}

export interface PresetField {
  key: string
  label: string
  placeholder?: string
}

export interface Preset {
  id: string
  name: string
  fields: PresetField[]
  method: HttpMethod
  urlTemplate: string
  headersTemplate: Record<string, string>
  extractorTemplate: string
  createdAt?: string
  builtin: boolean
  edited?: boolean
}

export interface Settings {
  collectIntervalSeconds: number
}

export interface SamplePoint {
  v: number
  t: string
}

export interface LogEntry {
  id: string
  time: string
  action: string
  detail: string
  platformId: string | null
  platformName: string | null
  meta?: Record<string, unknown>
}

export interface BalanceCard {
  id: string
  name: string
  url?: string
  display: DisplayConfig
  balance: number | null
  error: string | null
  fetchedAt: string | null
}

export interface DashboardData {
  updatedAt: string
  platforms: BalanceCard[]
}

export interface HistoryView {
  id: string
  name: string
  points: SamplePoint[]
}

export interface ExportPayload {
  type: string
  version: number
  exportedAt: string
  platforms: Platform[]
  presets: Preset[]
}

export interface ImportResult {
  ok: boolean
  platforms: number
  presets: number
  errors: string[]
}

export interface RefreshResult {
  ok: boolean
  results: Array<{ id: string; ok: true; value: number } | { id: string; ok: false; error: string }>
}

export interface TestResult {
  ok: boolean
  value?: number
  error?: string
}
