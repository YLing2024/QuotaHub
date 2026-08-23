import path from 'node:path'
import fs from 'node:fs'
import { config } from '../config.js'
import { writeJsonAtomic } from '../lib/storage.js'
import type { Settings } from '../types.js'

// 设置数据访问 (JSON, 原子写)

export const DEFAULT_SETTINGS: Settings = {
  // 自动采集间隔(秒), 0 表示关闭自动采集
  collectIntervalSeconds: 0,
}

export function settingsFile(): string {
  return path.join(config.dataDir, 'settings.json')
}

export function get(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Partial<Settings>
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return { ...DEFAULT_SETTINGS, ...raw }
    }
  } catch {
    // 文件不存在/损坏 -> 默认
  }
  return { ...DEFAULT_SETTINGS }
}

export function save(settings: Settings): void {
  writeJsonAtomic(settingsFile(), settings)
}
