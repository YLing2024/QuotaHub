import { config, ensureDataDir } from './config.js'
import { initSchema } from './db/init.js'
import { closeDb } from './db/connection.js'
import { createApp } from './app.js'
import { monitorService } from './services/monitorService.js'
import { settingsService } from './services/settingsService.js'
import { logService } from './services/logService.js'
import { authService } from './services/authService.js'
import { EXTRACT_TIMEOUT_MS } from './lib/fetcher.js'

// 入口: 初始化 DB schema -> 认证模式/首启引导 -> 组装 app -> 起服务 -> 启动定时采集

ensureDataDir()
initSchema()

// 启动时打印一行当前认证模式; builtin 下 users 为空时创建管理员(口令仅打印一次)
console.log(`认证模式: ${config.authMode}`)
if (config.authMode === 'builtin') {
  authService.ensureSeedAdmin()
}

const app = createApp()
const server = app.listen(config.port, config.host, () => {
  console.log(`QuotaHub 已启动: http://${config.host}:${config.port}`)
  console.log(`沙箱脚本超时: ${EXTRACT_TIMEOUT_MS}ms (QUOTAHUB_SCRIPT_TIMEOUT_MS 可调)`)
  const interval = settingsService.getSettings().collectIntervalSeconds
  console.log(
    `自动采集: ${interval > 0 ? `每 ${interval} 秒采集一次` : '已关闭 (在设置中配置间隔开启)'}`,
  )
  if (interval > 0) monitorService.start()
  logService.log('start', 'QuotaHub 已启动')
})

// 优雅退出: 停止调度、关闭 SQLite 连接
function shutdown(signal: string): void {
  console.log(`收到 ${signal}, 正在退出...`)
  monitorService.stop()
  server.close(() => {
    closeDb()
    process.exit(0)
  })
  setTimeout(() => {
    closeDb()
    process.exit(0)
  }, 3000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
