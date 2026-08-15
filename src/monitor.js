const settings = require('./settings')
const logger = require('./logger')
const store = require('./store')
const { fetchBalance } = require('./fetcher')
const history = require('./history')

// 定时采集调度器: 根据设置的 collectIntervalSeconds 周期刷新全部平台余额
let timer = null
let running = false

async function runOnce(reason) {
  if (running) return
  running = true
  const list = store.getPlatforms()
  if (!list.length) {
    running = false
    return
  }
  const platforms = list
  const balances = store.getBalances()
  let ok = 0
  let fail = 0
  for (const p of platforms) {
    try {
      const result = await fetchBalance(p)
      const fetchedAt = new Date().toISOString()
      balances[p.id] = { ...result, fetchedAt }
      history.record(p.id, result.value, fetchedAt)
      ok++
    } catch (e) {
      balances[p.id] = { error: e.message, fetchedAt: new Date().toISOString() }
      fail++
    }
  }
  store.saveBalances(balances)
  logger.log('fetch', `自动采集完成: 成功 ${ok} 个, 失败 ${fail} 个`, {
    meta: { reason: reason || 'schedule', ok, fail },
  })
  running = false
}

function schedule() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  const sec = Number(settings.getSettings().collectIntervalSeconds) || 0
  if (sec > 0) {
    timer = setInterval(() => runOnce('schedule'), sec * 1000)
  }
}

function start() {
  schedule()
}

// 设置变更后重新排程
function reschedule() {
  schedule()
}

module.exports = { start, reschedule, runOnce }
