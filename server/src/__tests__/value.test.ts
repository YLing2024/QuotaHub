import { describe, expect, it } from 'vitest'
import { extractNumeric } from '../lib/value.js'

// extractNumeric 纯函数测试 (字符串展示 -> 历史入库数值提取)
describe('extractNumeric', () => {
  it('number 原样(有限), 非有限/null/非字符串 -> null', () => {
    expect(extractNumeric(92.05)).toBe(92.05)
    expect(extractNumeric(-3.5)).toBe(-3.5)
    expect(extractNumeric(Number.NaN)).toBeNull()
    expect(extractNumeric(Number.POSITIVE_INFINITY)).toBeNull()
    expect(extractNumeric(null)).toBeNull()
    expect(extractNumeric(undefined)).toBeNull()
    expect(extractNumeric({})).toBeNull()
  })

  it('直接是数字字符串', () => {
    expect(extractNumeric('1.2e5')).toBe(120000)
    expect(extractNumeric('-3.5')).toBe(-3.5)
    expect(extractNumeric('  42 ')).toBe(42)
  })

  it('剥非数字字符后提取(流量/百分比/货币/千分位)', () => {
    expect(extractNumeric('92.05G')).toBe(92.05)
    expect(extractNumeric('20.60%')).toBe(20.6)
    expect(extractNumeric('¥1,234.56元')).toBe(1234.56)
    expect(extractNumeric('$8.51 元')).toBe(8.51)
    expect(extractNumeric('28.12元')).toBe(28.12)
    expect(extractNumeric('7.37G')).toBe(7.37)
  })

  it('纯文本/空串 -> null', () => {
    expect(extractNumeric('已过期')).toBeNull()
    expect(extractNumeric('N/A')).toBeNull()
    expect(extractNumeric('abc')).toBeNull()
    expect(extractNumeric('')).toBeNull()
    expect(extractNumeric('   ')).toBeNull()
  })
})
