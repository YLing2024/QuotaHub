import crypto from 'node:crypto'
import { presetRepo } from '../repositories/index.js'
import type { BuiltinPreset, HttpMethod, Preset } from '../types.js'

// 预设系统业务逻辑 (等价迁移自 src/routes/presets.js)

export const BUILTIN_PRESETS: BuiltinPreset[] = [
  {
    id: 'newapi',
    name: 'NEWAPI',
    fields: [
      { key: 'baseUrl', label: '请求地址（Base URL）', placeholder: 'https://your-newapi.example.com' },
      { key: 'token', label: '访问令牌', placeholder: 'sk-你的访问令牌' },
      { key: 'userId', label: '用户 ID（可留空）', placeholder: '留空则不发送 New-Api-User 头' },
    ],
    method: 'GET',
    urlTemplate: '{{baseUrl}}/api/user/self',
    headersTemplate: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer {{token}}',
      'User-Agent': 'cc-switch/1.0',
      'New-Api-User': '{{userId}}',
    },
    extractorTemplate: 'function (data) {\n  return data.data.quota / 500000\n}',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'sk-你的 API Key' }],
    method: 'GET',
    urlTemplate: 'https://api.deepseek.com/user/balance',
    headersTemplate: {
      Accept: 'application/json',
      Authorization: 'Bearer {{apiKey}}',
    },
    extractorTemplate:
      'function (data) {\n  var infos = data.balance_infos\n  if (!infos || !infos.length) return null\n  return infos[0].total_balance\n}',
  },
]

export function isBuiltinId(id: string): boolean {
  return BUILTIN_PRESETS.some((b) => b.id === id)
}

// 校验并规范化预设; 失败抛出带用户可读 message 的错误
export function validatePreset(body: unknown): Omit<Preset, 'id' | 'createdAt'> {
  const b = (body ?? {}) as Record<string, unknown>
  const name = String(b.name ?? '')
  if (!name.trim()) throw new Error('预设名称不能为空')
  const rawFields = b.fields
  if (!Array.isArray(rawFields) || rawFields.length === 0) throw new Error('至少需要一个字段')
  for (const f of rawFields) {
    const field = (f ?? {}) as Record<string, unknown>
    if (!String(field.key ?? '').trim()) throw new Error('字段 key 不能为空')
    if (!/^[\w-]+$/.test(String(field.key).trim())) throw new Error('字段 key 只能包含字母、数字、下划线、连字符')
    if (!String(field.label ?? '').trim()) throw new Error('字段 label 不能为空')
  }
  const urlTemplate = String(b.urlTemplate ?? '')
  if (!urlTemplate.trim()) throw new Error('URL 模板不能为空')
  let headers: unknown
  try {
    headers = typeof b.headersTemplate === 'string' ? JSON.parse(b.headersTemplate) : b.headersTemplate
  } catch {
    throw new Error('请求头模板必须是合法 JSON')
  }
  if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) {
    throw new Error('请求头模板必须是 JSON 对象')
  }
  const extractorTemplate = String(b.extractorTemplate ?? '')
  if (!extractorTemplate.trim()) throw new Error('提取函数模板不能为空')
  return {
    name: name.trim(),
    fields: (rawFields as Array<Record<string, unknown>>).map((f) => ({
      key: String(f.key).trim(),
      label: String(f.label).trim(),
      placeholder: String(f.placeholder ?? '').trim(),
    })),
    method: (b.method === 'POST' ? 'POST' : 'GET') as HttpMethod,
    urlTemplate: urlTemplate.trim(),
    headersTemplate: headers as Record<string, string>,
    extractorTemplate,
  }
}

// 合并输出: 内置在前(含用户覆盖标记), 用户自定义在后
export function listPresets(): Array<Partial<Preset> & { builtin: boolean; edited?: boolean }> {
  const user = presetRepo.getAll()
  const merged = BUILTIN_PRESETS.map((b) => {
    const edited = user.find((p) => p.id === b.id)
    return edited ? { ...b, ...edited, builtin: true, edited: true } : { ...b, builtin: true }
  })
  for (const p of user) {
    if (!isBuiltinId(p.id)) merged.push({ ...p, builtin: false })
  }
  return merged
}

export function createPreset(body: unknown): Preset & { builtin: false } {
  const preset = validatePreset(body)
  const user = presetRepo.getAll()
  const item: Preset = {
    id: crypto.randomUUID(),
    ...preset,
    createdAt: new Date().toISOString(),
  }
  user.push(item)
  presetRepo.saveAll(user)
  return { ...item, builtin: false }
}

// upsert: 不存在则创建 (内置 id 也允许覆盖保存)
export function upsertPreset(
  id: string,
  body: unknown,
): Preset & { builtin: boolean } {
  const preset = validatePreset(body)
  const user = presetRepo.getAll()
  const idx = user.findIndex((p) => p.id === id)
  if (idx === -1) {
    user.push({ id, ...preset })
  } else {
    const existing = user[idx]
    if (existing) user[idx] = { ...existing, ...preset }
  }
  presetRepo.saveAll(user)
  return { id, ...preset, builtin: isBuiltinId(id) }
}

// 返回 null 表示允许删除; 抛错表示禁止删除内置预设
export function deletePreset(id: string): void {
  if (isBuiltinId(id)) {
    throw Object.assign(new Error('内置预设使用重置恢复默认，不能删除'), { status: 400 })
  }
  const user = presetRepo.getAll()
  presetRepo.saveAll(user.filter((p) => p.id !== id))
}

// 仅内置预设支持重置
export function resetPreset(id: string): BuiltinPreset {
  if (!isBuiltinId(id)) {
    throw Object.assign(new Error('仅内置预设支持重置'), { status: 400 })
  }
  const user = presetRepo.getAll()
  presetRepo.saveAll(user.filter((p) => p.id !== id))
  return BUILTIN_PRESETS.find((b) => b.id === id)!
}

export const presetService = {
  BUILTIN_PRESETS,
  isBuiltinId,
  validatePreset,
  listPresets,
  createPreset,
  upsertPreset,
  deletePreset,
  resetPreset,
}
