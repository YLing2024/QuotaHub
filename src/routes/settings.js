const express = require('express')
const settings = require('../settings')
const logger = require('../logger')
const monitor = require('../monitor')

const router = express.Router()

router.get('/', (req, res) => {
  res.json(settings.getSettings())
})

router.put('/', (req, res) => {
  const before = settings.getSettings()
  const next = settings.updateSettings(req.body || {})
  monitor.reschedule()
  const interval = next.collectIntervalSeconds
  if (before.collectIntervalSeconds !== interval) {
    logger.log('settings', `自动采集间隔设置为 ${interval} 秒${interval === 0 ? '（已关闭）' : ''}`, {
      meta: { from: before.collectIntervalSeconds, to: interval },
    })
  }
  res.json(next)
})

module.exports = router
