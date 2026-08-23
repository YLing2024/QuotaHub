// 领域类型: 平台 / 预设 / 设置 / 采样点 / 日志

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
  extractor: string
  parse: string
  response?: LegacyResponse
  display?: DisplayConfig
  url?: string
  createdAt: string
}

// 对外输出的平台(含 display 兼容回退)
export interface PublicPlatform extends Omit<Platform, 'display'> {
  display: DisplayConfig
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
}

export interface BuiltinPreset {
  id: string
  name: string
  fields: PresetField[]
  method: HttpMethod
  urlTemplate: string
  headersTemplate: Record<string, string>
  extractorTemplate: string
}

export interface Settings {
  collectIntervalSeconds: number
}

// 历史采样点(与旧 history.json 的 {v,t} 形状保持一致)
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

export interface LogOptions {
  platformId?: string
  platformName?: string
  meta?: Record<string, unknown>
}

// 面板卡片数据(最新值取自历史采样最新点)
export interface BalanceCard {
  id: string
  name: string
  url?: string
  display: DisplayConfig
  balance: number | null
  error: string | null
  fetchedAt: string | null
}

// 抓取结果
export interface FetchResult {
  value: number
}
