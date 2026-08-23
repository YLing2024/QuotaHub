import path from 'node:path'
import fs from 'node:fs'
import { config, ensureDataDir } from '../config.js'
import { writeJsonAtomic } from '../lib/storage.js'
import type { LogEntry } from '../types.js'

// 操作日志数据访问 (JSON): 内存环形缓冲 + 磁盘持久化, 与旧 logger.js 行为一致

export const MAX_LOGS = 2000

let logs: LogEntry[] = []
let loaded = false

function logsFile(): string {
  return path.join(config.dataDir, 'logs.json')
}

export function load(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(logsFile(), 'utf8')) as unknown
    if (Array.isArray(raw)) {
      logs = raw.slice(-MAX_LOGS) as LogEntry[]
    }
  } catch {
    logs = []
  }
  loaded = true
}

function ensureLoaded(): void {
  if (!loaded) load()
}

function persist(): void {
  ensureDataDir()
  writeJsonAtomic(logsFile(), logs)
}

// 追加一条日志并持久化; 失败仅打印不抛出(与旧行为一致)
export function append(entry: LogEntry): void {
  ensureLoaded()
  logs.push(entry)
  if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS)
  try {
    persist()
  } catch (e) {
    console.error(`[logger] 写入日志失败: ${(e as Error).message}`)
  }
}

// 最新在前; limit 钳制在 [1, MAX_LOGS]
export function list(limit = 200): LogEntry[] {
  ensureLoaded()
  const n = Math.min(Math.max(Number(limit) || 200, 1), MAX_LOGS)
  return logs.slice(-n).reverse()
}

export function total(): number {
  ensureLoaded()
  return logs.length
}

export function clear(): void {
  ensureLoaded()
  logs = []
  try {
    persist()
  } catch (e) {
    console.error(`[logger] 清空日志失败: ${(e as Error).message}`)
  }
}
