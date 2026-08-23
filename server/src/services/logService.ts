import { logRepo } from '../repositories/index.js'
import type { LogEntry, LogOptions } from '../types.js'

// 操作日志业务逻辑: 组装条目 + 委托 repo 持久化

function log(action: string, detail: string | null | undefined, opts: LogOptions = {}): LogEntry {
  const entry: LogEntry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toISOString(),
    action: String(action || 'unknown'),
    detail: String(detail == null ? '' : detail),
    platformId: opts.platformId ?? null,
    platformName: opts.platformName ?? null,
    ...(opts.meta && typeof opts.meta === 'object' ? { meta: opts.meta } : {}),
  }
  logRepo.append(entry)
  return entry
}

function list(limit = 200): LogEntry[] {
  return logRepo.list(limit)
}

function total(): number {
  return logRepo.total()
}

function clear(): void {
  logRepo.clear()
}

export const logService = { log, list, total, clear }
