import path from 'node:path'
import { config } from '../config.js'
import { readJson, writeJsonAtomic } from '../lib/storage.js'
import type { Preset } from '../types.js'

// 预设模板数据访问 (JSON, 原子写); 仅存用户预设/对内置预设的覆盖

export function presetsFile(): string {
  return path.join(config.dataDir, 'presets.json')
}

export function getAll(): Preset[] {
  const list = readJson<Preset[]>(presetsFile(), [])
  return Array.isArray(list) ? list : []
}

export function saveAll(list: Preset[]): void {
  writeJsonAtomic(presetsFile(), list)
}
