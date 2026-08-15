const express = require('express')
const logger = require('../logger')

const router = express.Router()

// 操作日志列表, ?limit= 控制条数(1~2000, 默认 200)
router.get('/', (req, res) => {
  const limit = Number(req.query.limit) || 200
  res.json({ logs: logger.list(limit), total: logger.list(100000).length })
})

router.delete('/', (req, res) => {
  logger.clear()
  logger.log('clear-logs', '操作日志已清空')
  res.status(204).end()
})

module.exports = router
