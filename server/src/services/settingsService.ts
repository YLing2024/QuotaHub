import { settingsRepo } from '../repositories/index.js'
import type { Settings } from '../types.js'

// 设置业务逻辑 (等价迁移自 src/settings.js)
// collectIntervalSeconds: 数字且 >= 0 时取 floor 并钳制到 86400; 否则回退默认值

export const DEFAULTS: Settings = settingsRepo.DEFAULT_SETTINGS

function getSettings(): Settings {
  return settingsRepo.get()
}

// 校验并合并设置; 返回更新后的设置对象
function updateSettings(patch: unknown): Settings {
  const p = (patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}) as Record<
    string,
    unknown
  >
  const current = settingsRepo.get()
  if (p.collectIntervalSeconds !== undefined) {
    const n = Number(p.collectIntervalSeconds)
    const valid = Number.isFinite(n) && n >= 0
    current.collectIntervalSeconds = valid
      ? Math.min(Math.floor(n), 86400)
      : DEFAULTS.collectIntervalSeconds
  }
  settingsRepo.save(current)
  return { ...current }
}

export const settingsService = { getSettings, updateSettings, DEFAULTS }
