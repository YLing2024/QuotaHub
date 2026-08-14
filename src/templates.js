const TEMPLATES = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    request: {
      method: 'GET',
      url: 'https://api.deepseek.com/user/balance',
      headers: { Authorization: 'Bearer {{apiKey}}' },
    },
    response: { path: 'balance_infos[0].total_balance', unit: 'CNY' },
    note: '余额与可用余额',
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    request: {
      method: 'GET',
      url: 'https://api.moonshot.cn/v1/users/me/balance',
      headers: { Authorization: 'Bearer {{apiKey}}' },
    },
    response: { path: 'data.available_balance', unit: 'CNY' },
    note: '可用余额',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    request: {
      method: 'GET',
      url: 'https://openrouter.ai/api/v1/auth/key',
      headers: { Authorization: 'Bearer {{apiKey}}' },
    },
    response: { path: 'data.limit', unit: 'USD' },
    note: '密钥额度上限',
  },
  {
    id: 'zhipu',
    name: '智谱 AI',
    request: {
      method: 'GET',
      url: 'https://open.bigmodel.cn/api/paas/v4/query/balance',
      headers: { Authorization: 'Bearer {{apiKey}}' },
    },
    response: { path: 'data.total_balance', unit: 'CNY' },
    note: '总余额',
  },
  {
    id: 'custom',
    name: '自定义',
    request: {
      method: 'GET',
      url: '',
      headers: { Authorization: 'Bearer {{apiKey}}' },
    },
    response: { path: '', unit: 'USD' },
    note: '完全自定义请求与响应解析',
  },
]

function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || null
}

function toPublicTemplate(t) {
  return {
    id: t.id,
    name: t.name,
    request: { ...t.request, headers: { ...t.request.headers } },
    response: { ...t.response },
    note: t.note,
  }
}

module.exports = { TEMPLATES, getTemplate, toPublicTemplate }
