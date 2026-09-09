import crypto from 'node:crypto'
import { platformRepo } from '../repositories/index.js'
import type { Platform, PlatformRequest, PublicPlatform } from '../types.js'

// 平台配置业务逻辑 (等价迁移自 src/routes/platforms.js 的纯数据部分)

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// 对外输出: 剔除已弃用的 display; response 内剔除 prefix/suffix(legacy 仅存库, 不渲染不导出)
export function toPublic(p: Platform): PublicPlatform {
  const out = { ...p } as Platform
  delete out.display
  if (out.response && typeof out.response === 'object') {
    const res = { ...(out.response as Record<string, unknown>) }
    delete res.prefix
    delete res.suffix
    out.response = Object.keys(res).length ? res : undefined
  }
  return out as PublicPlatform
}

// 部分更新: 只覆盖请求中出现的字段 (display 已弃用, 忽略 body.display, 不动已存 legacy)
function pickConfig(body: Record<string, unknown>): Partial<Platform> {
  const cfg: Record<string, unknown> = {}
  if (body.name !== undefined) cfg.name = String(body.name).trim()
  if (body.request !== undefined) cfg.request = body.request
  if (body.handler !== undefined) {
    // 单函数模型: 保存 handler 时清掉旧字段(parse/extractor), 完成迁移
    cfg.handler = body.handler
    cfg.extractor = ''
    cfg.parse = ''
  } else {
    if (body.extractor !== undefined) cfg.extractor = body.extractor
    if (body.parse !== undefined) cfg.parse = body.parse
  }
  if (body.url !== undefined) cfg.url = String(body.url).trim().slice(0, 500)
  return cfg
}

function rawObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function normalizePlatform(body: Record<string, unknown>): Platform {
  return {
    id: crypto.randomUUID(),
    name: (body.name as string) || '未命名平台',
    // 与旧实现一致: 默认值 + 原样展开用户请求配置
    request: { method: 'GET', url: '', headers: {}, ...rawObject(body.request) } as PlatformRequest,
    handler: (body.handler as string) || '',
    extractor: (body.extractor as string) || '',
    parse: (body.parse as string) || '',
    url: String(body.url ?? '')
      .trim()
      .slice(0, 500),
    createdAt: new Date().toISOString(),
  }
}

// 至少需要一个处理/提取函数, 否则抓取必然失败
export function assertHasHandler(p: Pick<Platform, 'handler' | 'extractor' | 'parse'>): void {
  if (
    !String(p.handler ?? '').trim() &&
    !String(p.extractor ?? '').trim() &&
    !String(p.parse ?? '').trim()
  ) {
    throw new HttpError(400, '需要配置处理函数（或旧的提取/解析函数）')
  }
}

export function findIndex(list: Platform[], id: string): number {
  return list.findIndex((p) => p.id === id)
}

export function requirePlatform(list: Platform[], id: string): Platform {
  const idx = findIndex(list, id)
  if (idx === -1) throw new HttpError(404, '平台不存在')
  return list[idx]!
}

export function listPlatforms(): PublicPlatform[] {
  return platformRepo.getAll().map(toPublic)
}

export function createPlatform(body: Record<string, unknown>): PublicPlatform {
  const platform = normalizePlatform(body ?? {})
  assertHasHandler(platform)
  const list = platformRepo.getAll()
  list.push(platform)
  platformRepo.saveAll(list)
  return toPublic(platform)
}

export function updatePlatform(id: string, body: Record<string, unknown>): PublicPlatform {
  const list = platformRepo.getAll()
  const idx = findIndex(list, id)
  if (idx === -1) throw new HttpError(404, '平台不存在')
  const old = list[idx]
  if (!old) throw new HttpError(404, '平台不存在')
  const patch = pickConfig(body ?? {})
  const next = { ...old, ...patch } as Platform
  assertHasHandler(next)
  list[idx] = next
  platformRepo.saveAll(list)
  return toPublic(next)
}

export function deletePlatform(id: string): Platform {
  const list = platformRepo.getAll()
  const idx = findIndex(list, id)
  if (idx === -1) throw new HttpError(404, '平台不存在')
  const removed = list[idx]
  if (!removed) throw new HttpError(404, '平台不存在')
  list.splice(idx, 1)
  platformRepo.saveAll(list)
  return removed
}

// 排序: ids 必须是现有平台 id 的完整排列
export function reorderPlatforms(ids: unknown): void {
  if (!Array.isArray(ids)) throw new HttpError(400, '需要 ids 数组')
  const list = platformRepo.getAll()
  if (ids.length !== list.length) throw new HttpError(400, 'ids 数量与现有平台不匹配')
  const byId = new Map(list.map((p) => [p.id, p]))
  const seen = new Set<string>()
  for (const id of ids) {
    if (!byId.has(id)) throw new HttpError(400, `未知平台 id: ${String(id)}`)
    if (seen.has(id)) throw new HttpError(400, 'ids 包含重复项')
    seen.add(id)
  }
  platformRepo.saveAll(
    ids.map((id) => byId.get(String(id)) as Platform),
  )
}

// 折线图视图: {id, name, points:[{v,t}...] 时间升序}
export function historyView(
  id: string,
  points: Array<{ v: number; t: string }>,
): { id: string; name: string; points: Array<{ v: number; t: string }> } {
  const list = platformRepo.getAll()
  const idx = findIndex(list, id)
  if (idx === -1) throw new HttpError(404, '平台不存在')
  const p = list[idx]
  if (!p) throw new HttpError(404, '平台不存在')
  return { id, name: p.name, points }
}

export const platformService = {
  toPublic,
  normalizePlatform,
  assertHasHandler,
  requirePlatform,
  listPlatforms,
  createPlatform,
  updatePlatform,
  deletePlatform,
  reorderPlatforms,
  historyView,
}
