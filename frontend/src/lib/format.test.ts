import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HANDLER,
  buildHandler,
  fmt,
  formatValue,
  renderTemplate,
  resolveHandler,
} from './format'
import type { Platform } from '@/types'

const basePlatform = (over: Partial<Platform>): Platform => ({
  id: 'id1',
  name: 'P',
  request: { method: 'GET', url: 'https://api.example.com', headers: {} },
  handler: '',
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
})

describe('fmt', () => {
  it('null/undefined → —', () => {
    expect(fmt(null)).toBe('—')
    expect(fmt(undefined)).toBe('—')
  })
  it('整数不带小数, 小数保留两位', () => {
    expect(fmt(8)).toBe('8')
    expect(fmt(8.5)).toBe('8.50')
    expect(fmt(18.000001)).toBe('18.00')
  })
  it('数字字符串走数值格式化', () => {
    expect(fmt('12')).toBe('12')
    expect(fmt('3.14159')).toBe('3.14')
  })
  it('非数字字符串原样返回', () => {
    expect(fmt('abc')).toBe('abc')
  })
  it('对象 JSON 序列化', () => {
    expect(fmt({ a: 1 })).toBe('{"a":1}')
  })
})

describe('formatValue', () => {
  it('空值提示', () => {
    expect(formatValue(undefined)).toBe('（无返回值）')
    expect(formatValue(null)).toBe('（无返回值）')
  })
  it('NaN 提示检查提取函数', () => {
    expect(formatValue(Number.NaN)).toBe('（NaN，请检查提取函数）')
  })
  it('对象缩进序列化', () => {
    expect(formatValue({ a: 1 })).toBe('{\n  "a": 1\n}')
  })
  it('数值与字符串', () => {
    expect(formatValue(12.5)).toBe('12.5')
    expect(formatValue('ok')).toBe('ok')
  })
})

describe('renderTemplate', () => {
  it('替换非空变量', () => {
    expect(renderTemplate('{{baseUrl}}/api/user/self', { baseUrl: 'https://x.io' })).toBe(
      'https://x.io/api/user/self',
    )
  })
  it('空/缺失变量保留占位符', () => {
    expect(renderTemplate('{{a}}-{{b}}', { a: '' })).toBe('{{a}}-{{b}}')
    expect(renderTemplate('{{missing}}', {})).toBe('{{missing}}')
  })
  it('深度对象与数组递归渲染', () => {
    const out = renderTemplate(
      { url: '{{u}}', list: ['{{v}}'], keep: 1 },
      { u: 'U', v: 'V' },
    )
    expect(out).toEqual({ url: 'U', list: ['V'], keep: 1 })
  })
})

describe('buildHandler / resolveHandler', () => {
  it('优先使用 handler', () => {
    const p = basePlatform({ handler: 'function (raw) { return 1 }', parse: 'x', extractor: 'y' })
    expect(resolveHandler(p)).toBe('function (raw) { return 1 }')
  })

  it('parse+extractor 合成等效处理函数', () => {
    const p = basePlatform({ parse: '(s)=>JSON.parse(s)', extractor: '(d)=>d.balance' })
    expect(buildHandler(p)).toBe(
      'function (raw) {\n  var data = ((s)=>JSON.parse(s))(raw)\n  return ((d)=>d.balance)(data)\n}',
    )
  })

  it('仅 extractor 时默认 JSON.parse', () => {
    const p = basePlatform({ extractor: '(d)=>d.b' })
    expect(buildHandler(p)).toContain('var data = JSON.parse(raw)')
    expect(buildHandler(p)).toContain('return ((d)=>d.b)(data)')
  })

  it('更旧的 response.path 配置生成等效处理函数', () => {
    const p = basePlatform({ response: { path: 'data.balance', divider: 2 } as never })
    expect(resolveHandler(p)).toBe(
      'function (raw) {\n  var data = JSON.parse(raw)\n  return data.balance / 2\n}',
    )
  })

  it('response.path 自动补 data. 前缀', () => {
    const p = basePlatform({ response: { path: 'balance' } as never })
    expect(resolveHandler(p)).toContain('return data.balance\n')
  })

  it('path 已带 data. 或 data[ 前缀时不重复补', () => {
    const p1 = basePlatform({ response: { path: 'data.a.b' } as never })
    expect(resolveHandler(p1)).toContain('return data.a.b\n')
    const p2 = basePlatform({ response: { path: 'data["k"]' } as never })
    expect(resolveHandler(p2)).toContain('return data["k"]\n')
  })

  it('什么都没有时回退默认处理函数', () => {
    expect(resolveHandler(basePlatform({}))).toBe(DEFAULT_HANDLER)
    expect(DEFAULT_HANDLER).toBe('function (raw) {\n  return JSON.parse(raw).balance\n}')
  })
})
