// 值语义工具: 从 handler 返回值中提取用于历史入库存图的数值
// 取舍(两步, 不做更激进的逐 token 剥离):
//   1. 直接是数字字符串 -> 原样转数字(如 '-3.5'、'1.2e5')
//   2. 剥掉所有非数字字符(小数点/负号/科学计数法保留)再转 —— 覆盖常见真实形态:
//      '92.05G' -> 92.05、'20.60%' -> 20.6、'¥1,234.56元' -> 1234.56、'$8.51 元' -> 8.51
//   纯文本('已过期'、'N/A'、'abc') -> null(不入历史, 只作展示)
// 注意: 此语义下 '12abc' 会被提取为 12(较旧 repo 的"乱字符串不写库"更宽容, 属有意变更)

export function extractNumeric(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  let n = Number(s)
  if (Number.isFinite(n)) return n
  // 剥掉所有非数字相关字符(小数点/负号/科学计数法保留)再转 —— 覆盖常见真实形态:
  //   '92.05G' -> 92.05、'20.60%' -> 20.6、'¥1,234.56元' -> 1234.56、'$8.51 元' -> 8.51
  // 剥后无任何数字字符(纯文本如 '已过期'/'N/A'/'abc') -> null(避免 Number('') === 0 的假阳性)
  const stripped = s.replace(/[^0-9.eE+-]/g, '')
  if (!/[0-9]/.test(stripped)) return null
  n = Number(stripped)
  if (Number.isFinite(n)) return n
  return null
}
