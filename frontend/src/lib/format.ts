// 展示格式化工具 (语义与旧 app.js 一致)

import type { Platform } from '@/types'

export const fmt = (v: unknown): string => {
  if (v == null) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'number' && Number.isNaN(v)) return String(v)
  const n = Number(v)
  if (Number.isNaN(n)) return String(v)
  return n % 1 === 0 ? n.toString() : n.toFixed(2)
}

export const formatValue = (v: unknown): string => {
  if (v === undefined || v === null) return '（无返回值）'
  if (typeof v === 'object') return JSON.stringify(v, null, 2)
  if (typeof v === 'number' && Number.isNaN(v)) return '（NaN，请检查提取函数）'
  return String(v)
}

// 模板渲染: {{key}} 仅在对应变量非空时替换, 否则保留占位符
export function renderTemplate<T>(tpl: T, vars: Record<string, string>): T {
  if (typeof tpl === 'string') {
    return tpl.replace(/\{\{(\w+)\}\}/g, (m, k: string) =>
      vars[k] !== undefined && vars[k] !== '' ? vars[k] : m,
    ) as T
  }
  if (Array.isArray(tpl)) return tpl.map((x) => renderTemplate(x, vars)) as T
  if (tpl && typeof tpl === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(tpl as Record<string, unknown>)) {
      out[k] = renderTemplate(v, vars)
    }
    return out as T
  }
  return tpl
}

export const DEFAULT_HANDLER = 'function (raw) {\n  return JSON.parse(raw).balance\n}'

// 处理函数展示: 新模型直接取 handler; 旧配置(parse/extractor)自动生成等效合并版
export function buildHandler(p: Platform): string {
  if (p.handler) return p.handler
  const lines: string[] = []
  if (p.parse) {
    lines.push(`var data = (${String(p.parse).trim()})(raw)`)
  } else {
    lines.push('var data = JSON.parse(raw)')
  }
  if (p.extractor) {
    lines.push(`return (${String(p.extractor).trim()})(data)`)
  } else {
    lines.push('return data')
  }
  return `function (raw) {\n  ${lines.join('\n  ')}\n}`
}

// 更旧的 response.path 配置 → 等效处理函数
export function handlerFromLegacyResponse(
  response: { path?: string; divider?: number } | undefined,
): string | null {
  if (!response || !response.path) return null
  const path = response.path
  const expr = /^(data\.|data\[)/.test(path) ? path : `data.${path}`
  return `function (raw) {\n  var data = JSON.parse(raw)\n  return ${expr}${response.divider ? ' / ' + response.divider : ''}\n}`
}

// 平台展示用处理函数: handler > parse/extractor 合成 > response.path > 默认
export function resolveHandler(p: Platform): string {
  if (p.handler) return p.handler
  if (p.parse || p.extractor) return buildHandler(p)
  return handlerFromLegacyResponse(p.response) ?? DEFAULT_HANDLER
}
