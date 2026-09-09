// 前端类型: 镜像后端 API 输出

export type HttpMethod = 'GET' | 'POST'

// 已弃用: prefix/suffix 拼接机制已废除(handler 直接返回字符串展示)。
// 类型保留仅为旧导出文件(含 display / response.prefix/suffix)导入兼容。
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

// 已弃用: prefix/suffix 不再参与展示, 保留仅为导入兼容
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
  // 已弃用: 仅导入兼容保留, 不渲染/不导出
  display?: DisplayConfig
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
  text?: string | null
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

// 面板卡片(与后端一致: value=可绘图最新数值, text=最新展示文本。字符串源平台两者可并存, 纯文本均 null)
export interface BalanceCard {
  id: string
  name: string
  url?: string
  value: number | null
  text: string | null
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
  results: Array<{ id: string; ok: true; value: number | string } | { id: string; ok: false; error: string }>
}

export interface TestResult {
  ok: boolean
  value?: number | string
  error?: string
}
