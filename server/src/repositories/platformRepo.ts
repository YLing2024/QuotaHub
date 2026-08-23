import path from 'node:path'
import { config } from '../config.js'
import { readJson, writeJsonAtomic } from '../lib/storage.js'
import type { Platform } from '../types.js'

// 平台配置数据访问 (JSON, 原子写)

export function platformsFile(): string {
  return path.join(config.dataDir, 'platforms.json')
}

export function getAll(): Platform[] {
  const list = readJson<Platform[]>(platformsFile(), [])
  return Array.isArray(list) ? list : []
}

export function saveAll(list: Platform[]): void {
  writeJsonAtomic(platformsFile(), list)
}
