// 全局状态 (Zustand): 跨 Tab 共享的面板/平台/预设/设置数据与加载动作
// 语义对齐旧 monolith: 保存平台后联动刷新面板等

import { create } from 'zustand'
import type { DashboardData, Platform, Preset, Settings } from '@/types'
import {
  getBalances,
  listPlatforms,
  listPresets,
  getSettings,
} from '@/api/endpoints'

const DEFAULT_SETTINGS: Settings = { collectIntervalSeconds: 0 }

export function formatLastUpdate(updatedAt: string | null | undefined): string {
  return `LAST UPDATE — ${updatedAt ? new Date(updatedAt).toLocaleString('zh-CN') : '—'}`
}

interface AppState {
  dashboard: DashboardData
  lastUpdateText: string
  platforms: Platform[]
  presets: Preset[]
  settings: Settings
  loadDashboard(): Promise<void>
  setLastUpdateError(msg: string): void
  loadPlatforms(): Promise<void>
  setPlatforms(list: Platform[]): void
  loadPresets(): Promise<void>
  loadSettings(): Promise<void>
  applySettings(next: Settings): void
}

export const useStore = create<AppState>((set) => ({
  dashboard: { updatedAt: '', platforms: [] },
  lastUpdateText: formatLastUpdate(null),
  platforms: [],
  presets: [],
  settings: DEFAULT_SETTINGS,

  loadDashboard: async () => {
    try {
      const data = await getBalances()
      set({
        dashboard: { updatedAt: data.updatedAt || '', platforms: data.platforms || [] },
        lastUpdateText: formatLastUpdate(data.updatedAt),
      })
    } catch {
      // 与旧行为一致: 失败时面板按空数据处理
      set({ dashboard: { updatedAt: '', platforms: [] }, lastUpdateText: formatLastUpdate(null) })
    }
  },

  setLastUpdateError: (msg) => set({ lastUpdateText: `LAST UPDATE — ${msg}` }),

  loadPlatforms: async () => {
    try {
      set({ platforms: await listPlatforms() })
    } catch {
      set({ platforms: [] })
    }
  },

  // 乐观排序: 失败时由调用方回滚(loadPlatforms)
  setPlatforms: (list) => set({ platforms: list }),

  loadPresets: async () => {
    try {
      set({ presets: await listPresets() })
    } catch {
      set({ presets: [] })
    }
  },

  loadSettings: async () => {
    try {
      const s = await getSettings()
      set({
        settings:
          s && Number(s.collectIntervalSeconds) >= 0
            ? { collectIntervalSeconds: Number(s.collectIntervalSeconds) }
            : DEFAULT_SETTINGS,
      })
    } catch {
      set({ settings: DEFAULT_SETTINGS })
    }
  },

  applySettings: (next) => set({ settings: next }),
}))
