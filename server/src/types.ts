// 领域类型: 平台 / 预设 / 设置 / 采样点 / 日志

export type HttpMethod = 'GET' | 'POST'

// 已弃用: prefix/suffix 拼接机制已废除, 展示改为 handler 直接返回字符串。
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
  response?: LegacyResponse
  // 已弃用: 仅导入兼容保留, 不渲染/不导出
  display?: DisplayConfig
  url?: string
  createdAt: string
}

// 对外输出的平台(不携带已弃用的 display; response.prefix/suffix 由 toPublic 剔除)
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

// 历史采样点(与旧 history.json 的 {v,t} 形状保持一致; text 为字符串源平台的展示快照)
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

export interface LogOptions {
  platformId?: string
  platformName?: string
  meta?: Record<string, unknown>
}

// 面板卡片数据(最新值取自历史采样最新点; value=可绘图最新数值, text=最新展示文本。
// 纯数字源: 仅 value; 字符串源(可提取数字): value+text 并存; 纯文本/无值: 均 null)
export interface BalanceCard {
  id: string
  name: string
  url?: string
  value: number | null
  text: string | null
  error: string | null
  fetchedAt: string | null
}

// 抓取结果: handler 可返回任意字符串用于展示(纯文本也算成功), 不再只限数字
export interface FetchResult {
  value: number | string
}
