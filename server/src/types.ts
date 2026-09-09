// 领域类型: 平台 / 预设 / 设置 / 采样点 / 日志

export type HttpMethod = 'GET' | 'POST'

// 已弃用: prefix/suffix 拼接机制已废除, 展示改为 format 渲染函数。
// 类型定义保留仅为旧导出文件(含 display / response.prefix/suffix)导入兼容,
// 该字段只留在存储中, 不参与渲染、不再被导出。
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

// 已弃用: prefix/suffix 不再参与展示, 保留仅为导入兼容(旧导出文件仍能导入, 字段不报错)
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
  // 显示格式函数: JS 函数源码字符串, 入参 = handler 返回的数值, 返回最终展示字符串。
  // 后端在 vm 沙箱实时渲染(与 handler 同级安全边界); 空/未配置时卡片回退默认 fmt(value)。
  format?: string
  response?: LegacyResponse
  // 已弃用: 仅导入兼容保留, 不渲染/不导出
  display?: DisplayConfig
  url?: string
  createdAt: string
}

// 对外输出的平台(不携带已弃用的 display; format 正常带出; response.prefix/suffix 由 toPublic 剔除)
export type PublicPlatform = Omit<Platform, 'display'>

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

// 历史采样点(纯数值, 与旧 history.json 的 {v,t} 形状保持一致; 展示文本由 format 实时渲染)
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

// 面板卡片数据(最新值取自历史采样最新点; value=最新数值, text=format 渲染结果。无 format/渲染失败 -> text=null)
export interface BalanceCard {
  id: string
  name: string
  url?: string
  value: number | null
  text: string | null
  error: string | null
  fetchedAt: string | null
}

// 抓取结果: handler 必须返回有限数字(纯数值语义, 不做字符串展示/提取)
export interface FetchResult {
  value: number
}
