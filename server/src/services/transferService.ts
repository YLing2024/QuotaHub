import crypto from 'node:crypto'
import { platformRepo, presetRepo } from '../repositories/index.js'
import { validatePreset } from './presetService.js'
import { logService } from './logService.js'
import type { Platform, Preset } from '../types.js'

// 配置导入导出业务逻辑 (等价迁移自 src/routes/transfer.js)

export interface ExportPayload {
  type: 'quotahub-config'
  version: number
  exportedAt: string
  platforms: Platform[]
  presets: Preset[]
}

// 导出完整配置: 全部平台 + 用户预设(不含抓取结果余额)
function exportConfig(): ExportPayload {
  const payload: ExportPayload = {
    type: 'quotahub-config',
    version: 1,
    exportedAt: new Date().toISOString(),
    platforms: platformRepo.getAll(),
    presets: presetRepo.getAll(),
  }
  logService.log(
    'export',
    `导出配置: ${payload.platforms.length} 个平台、${payload.presets.length} 个预设`,
    {
      meta: {
        platforms: payload.platforms.length,
        presets: payload.presets.length,
      },
    },
  )
  return payload
}

interface ImportResult {
  ok: true
  platforms: number
  presets: number
  errors: string[]
}

function isPlatformLike(obj: unknown): boolean {
  const o = obj as Record<string, unknown> | null
  return Boolean(
    o &&
      typeof o === 'object' &&
      typeof o.name === 'string' &&
      o.request &&
      typeof o.request === 'object' &&
      typeof (o.request as Record<string, unknown>).url === 'string',
  )
}

function isPresetLike(obj: unknown): boolean {
  const o = obj as Record<string, unknown> | null
  return Boolean(
    o &&
      typeof o === 'object' &&
      typeof o.name === 'string' &&
      Array.isArray(o.fields) &&
      typeof o.urlTemplate === 'string' &&
      typeof o.extractorTemplate === 'string',
  )
}

function sanitizePlatform(raw: unknown, fallbackId: string): Platform {
  const p = (raw ?? {}) as Record<string, unknown>
  const req = (p.request ?? {}) as Record<string, unknown>
  const display = (p.display ?? {}) as Record<string, unknown>
  return {
    id: typeof p.id === 'string' && p.id ? p.id : fallbackId,
    name: String(p.name || '未命名平台').trim(),
    request: {
      method: req.method === 'POST' ? 'POST' : 'GET',
      url: String(req.url ?? ''),
      headers:
        req.headers && typeof req.headers === 'object' && !Array.isArray(req.headers)
          ? (req.headers as Record<string, string>)
          : {},
      ...(req.body !== undefined ? { body: req.body } : {}),
    },
    handler: typeof p.handler === 'string' ? p.handler : '',
    extractor: typeof p.extractor === 'string' ? p.extractor : '',
    parse: typeof p.parse === 'string' ? p.parse : '',
    ...(p.response && typeof p.response === 'object' ? { response: p.response } : {}),
    display: {
      prefix: String(display.prefix || '')
        .trim()
        .slice(0, 20),
      suffix: String(display.suffix || '')
        .trim()
        .slice(0, 20),
    },
    createdAt:
      typeof p.createdAt === 'string' && p.createdAt ? p.createdAt : new Date().toISOString(),
  } as Platform
}

// 导入校验: 处理函数必须存在; 凭据不能是脱敏占位符(否则存库即损坏)
function assertImportablePlatform(p: Platform): void {
  if (
    !p.handler.trim() &&
    !p.extractor.trim() &&
    !p.parse.trim() &&
    !(p.response && p.response.path)
  ) {
    throw new Error('缺少处理函数')
  }
  for (const [k, v] of Object.entries(p.request.headers)) {
    if (v === '********') {
      throw new Error(`请求头 ${k} 是脱敏占位符，请使用完整导出（含真实凭据）的 JSON 导入`)
    }
  }
}

// 导入: 支持三种格式
//   1. 完整配置: { type:'quotahub-config', platforms:[...], presets:[...] }
//   2. 单个平台: { name, request:{url,...}, extractor?, parse? }
//   3. 单个预设: { name, fields, urlTemplate, headersTemplate, extractorTemplate }
// 按 id upsert(存在则覆盖, 不存在则新增), 单项失败不影响其他项
function importConfig(bodyRaw: unknown): ImportResult {
  const body = (bodyRaw ?? {}) as Record<string, unknown>

  let platforms: unknown[] | null = null
  let presets: unknown[] | null = null
  if (Array.isArray(body.platforms) || Array.isArray(body.presets)) {
    platforms = Array.isArray(body.platforms) ? body.platforms : null
    presets = Array.isArray(body.presets) ? body.presets : null
  } else if (isPlatformLike(body)) {
    platforms = [body]
  } else if (isPresetLike(body)) {
    presets = [body]
  } else {
    throw Object.assign(
      new Error(
        '无法识别的配置格式: 需要完整配置(含 platforms/presets 数组)、单个平台或单个预设的 JSON',
      ),
      { status: 400 },
    )
  }

  const result: ImportResult = { ok: true, platforms: 0, presets: 0, errors: [] }

  if (platforms) {
    const list = platformRepo.getAll()
    for (const raw of platforms) {
      try {
        if (!raw || typeof raw !== 'object') throw new Error('条目不是对象')
        const p = sanitizePlatform(raw, crypto.randomUUID())
        if (!p.name) throw new Error('平台名称不能为空')
        if (!p.request.url) throw new Error('缺少请求 URL')
        assertImportablePlatform(p)
        const idx = list.findIndex((x) => x.id === p.id)
        if (idx === -1) list.push(p)
        else list[idx] = { ...list[idx], ...p }
        result.platforms++
      } catch (e) {
        const name = (raw as Record<string, unknown> | null)?.name
        result.errors.push(`平台「${(name as string) || '?'}」: ${(e as Error).message}`)
      }
    }
    platformRepo.saveAll(list)
  }

  if (presets) {
    const user = presetRepo.getAll()
    for (const raw of presets) {
      try {
        if (!raw || typeof raw !== 'object') throw new Error('条目不是对象')
        const preset = validatePreset(raw)
        const r = raw as Record<string, unknown>
        const id = typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID()
        const idx = user.findIndex((x) => x.id === id)
        const item = { id, ...preset }
        if (idx === -1) user.push(item)
        else user[idx] = { ...user[idx], ...item }
        result.presets++
      } catch (e) {
        const name = (raw as Record<string, unknown> | null)?.name
        result.errors.push(`预设「${(name as string) || '?'}」: ${(e as Error).message}`)
      }
    }
    presetRepo.saveAll(user)
  }

  logService.log(
    'import',
    `导入配置: ${result.platforms} 个平台、${result.presets} 个预设${result.errors.length ? ` (跳过 ${result.errors.length} 项)` : ''}`,
    {
      meta: {
        platforms: result.platforms,
        presets: result.presets,
        skipped: result.errors.length,
      },
    },
  )

  return result
}

export const transferService = { exportConfig, importConfig }
