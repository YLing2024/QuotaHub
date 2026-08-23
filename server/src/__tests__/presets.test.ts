import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

process.env.QUOTAHUB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-presets-'))

const { presetService } = await import('../services/presetService.js')
const { closeDb } = await import('../db/connection.js')

afterAll(() => {
  closeDb()
})

const validPreset = {
  name: '我的预设',
  fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'sk-xxx' }],
  method: 'GET',
  urlTemplate: '{{baseUrl}}/balance',
  headersTemplate: { Authorization: 'Bearer {{apiKey}}' },
  extractorTemplate: 'function (data) { return data.balance }',
}

describe('presetService.validatePreset (旧版逐条校验信息)', () => {
  it.each([
    [{}, '预设名称不能为空'],
    [{ name: 'x' }, '至少需要一个字段'],
    [{ ...validPreset, fields: [{ label: 'L' }] }, '字段 key 不能为空'],
    [{ ...validPreset, fields: [{ key: 'bad key!', label: 'L' }] }, '字段 key 只能包含字母、数字、下划线、连字符'],
    [{ ...validPreset, fields: [{ key: 'k' }] }, '字段 label 不能为空'],
    [{ ...validPreset, urlTemplate: '' }, 'URL 模板不能为空'],
    [{ ...validPreset, headersTemplate: '{invalid' }, '请求头模板必须是合法 JSON'],
    [{ ...validPreset, headersTemplate: '[1,2]' }, '请求头模板必须是 JSON 对象'],
    [{ ...validPreset, extractorTemplate: '' }, '提取函数模板不能为空'],
  ])('%j -> "%s"', (body, message) => {
    expect(() => presetService.validatePreset(body)).toThrow(message)
  })

  it('合法预设规范化输出', () => {
    const p = presetService.validatePreset({
      ...validPreset,
      name: '  空格名  ',
      fields: [{ key: ' k ', label: ' L ', placeholder: ' ph '}],
      headersTemplate: '{"Authorization":"Bearer {{t}}"}', // JSON 字符串也可
    })
    expect(p.name).toBe('空格名')
    expect(p.fields[0]).toEqual({ key: 'k', label: 'L', placeholder: 'ph' })
    expect(p.headersTemplate).toEqual({ Authorization: 'Bearer {{t}}' })
    expect(p.method).toBe('GET')
  })

  it('method 非 POST 一律归一为 GET', () => {
    expect(presetService.validatePreset({ ...validPreset, method: 'PUT' }).method).toBe('GET')
    expect(presetService.validatePreset({ ...validPreset, method: 'POST' }).method).toBe('POST')
  })
})

describe('presetService CRUD + 内置合并', () => {
  it('内置预设(newapi/deepseek)始终可见且 builtin=true', () => {
    const list = presetService.listPresets()
    const ids = list.map((p) => p.id)
    expect(ids).toContain('newapi')
    expect(ids).toContain('deepseek')
    for (const b of list.filter((p) => presetService.isBuiltinId(p.id))) {
      expect(b.builtin).toBe(true)
      expect(b.edited).toBeUndefined()
    }
  })

  it('createPreset 返回带 uuid/createdAt 的用户预设', () => {
    const item = presetService.createPreset(validPreset)
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(item.createdAt).toBeTruthy()
    expect(item.builtin).toBe(false)
    // 出现在列表尾部
    const list = presetService.listPresets()
    expect(list.at(-1)?.id).toBe(item.id)
    expect(list.at(-1)?.builtin).toBe(false)
  })

  it('编辑内置预设 -> merged 标记 edited; reset 恢复默认', () => {
    presetService.upsertPreset('deepseek', { ...validPreset, name: 'DeepSeek 改' })
    let merged = presetService.listPresets().find((p) => p.id === 'deepseek')
    expect(merged?.name).toBe('DeepSeek 改')
    expect(merged?.builtin).toBe(true)
    expect(merged?.edited).toBe(true)

    const def = presetService.resetPreset('deepseek')
    expect(def.name).toBe('DeepSeek')
    expect(def.extractorTemplate).toContain('total_balance')
    merged = presetService.listPresets().find((p) => p.id === 'deepseek')
    expect(merged?.name).toBe('DeepSeek')
    expect(merged?.edited).toBeUndefined()

    // 用户自定义不可重置
    expect(() => presetService.resetPreset('no-such')).toThrow('仅内置预设支持重置')
  })

  it('upsertPreset 不存在则创建(自定义 id)', () => {
    const item = presetService.upsertPreset('my-custom-id', validPreset)
    expect(item.builtin).toBe(false)
    expect(presetService.listPresets().some((p) => p.id === 'my-custom-id')).toBe(true)
    // 再次 upsert 更新
    presetService.upsertPreset('my-custom-id', { ...validPreset, name: '改名' })
    expect(presetService.listPresets().find((p) => p.id === 'my-custom-id')?.name).toBe('改名')
  })

  it('deletePreset 内置禁止删除; 自定义可删除', () => {
    try {
      presetService.deletePreset('newapi')
      throw new Error('should not reach')
    } catch (e) {
      expect((e as Error).message).toBe('内置预设使用重置恢复默认，不能删除')
      expect((e as { status?: number }).status).toBe(400)
    }
    presetService.deletePreset('my-custom-id')
    expect(presetService.listPresets().some((p) => p.id === 'my-custom-id')).toBe(false)
  })
})
