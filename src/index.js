const path = require('path')
const express = require('express')
const platformsRouter = require('./routes/platforms')
const presetsRouter = require('./routes/presets')
const transferRouter = require('./routes/transfer')
const { EXTRACT_TIMEOUT_MS } = require('./fetcher')

const app = express()
const PORT = process.env.PORT || 3000
// 默认只绑定回环地址; 需要局域网访问时显式设置 HOST=0.0.0.0 (并建议配置 QUOTAHUB_TOKEN)
const HOST = process.env.HOST || '127.0.0.1'
const TOKEN = process.env.QUOTAHUB_TOKEN || ''

app.use(express.json())
app.use(express.static(path.join(__dirname, '..', 'public')))

// 可选鉴权: 设置 QUOTAHUB_TOKEN 后, /api/* 需要 Authorization: Bearer <token>
app.use('/api', (req, res, next) => {
  if (!TOKEN) return next()
  const auth = req.headers.authorization || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const headerToken = req.headers['x-quotahub-token']
  if (bearer === TOKEN || headerToken === TOKEN) return next()
  res.status(401).json({ error: '未授权: 缺少或错误的访问令牌' })
})

app.use('/api/platforms', platformsRouter)
app.use('/api/presets', presetsRouter)
app.use('/api', transferRouter)

app.listen(PORT, HOST, () => {
  console.log(`QuotaHub 已启动: http://${HOST}:${PORT}${TOKEN ? ' (已启用令牌鉴权)' : ''}`)
  console.log(`沙箱脚本超时: ${EXTRACT_TIMEOUT_MS}ms (QUOTAHUB_SCRIPT_TIMEOUT_MS 可调)`)
})
