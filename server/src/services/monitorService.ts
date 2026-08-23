import { historyRepo, platformRepo, settingsRepo } from '../repositories/index.js'
import { fetchBalance } from '../lib/fetcher.js'
import { logService } from './logService.js'
import { toPublic } from './platformService.js'
import type { BalanceCard, Platform, PublicPlatform } from '../types.js'

// 采集监控业务逻辑: fetcher -> 写 history_samples; 维护"最近一次失败"运行时状态
// 设计约定: 不单独持久化当前 balance, 面板最新值 = 历史采样最新点

interface LastError {
  error: string
  fetchedAt: string
}

const lastErrors = new Map<string, LastError>()

let timer: NodeJS.Timeout | null = null
let running = false

export interface FetchOutcome {
  ok: boolean
  value?: number
  error?: string
  fetchedAt?: string
}

// 单平台抓取并记录: 成功 -> 写采样点并清除错误态; 失败 -> 记录运行时错误态
async function collect(p: Platform): Promise<FetchOutcome> {
  try {
    const result = await fetchBalance(p)
    const fetchedAt = new Date().toISOString()
    historyRepo.record(p.id, result.value, fetchedAt)
    lastErrors.delete(p.id)
    return { ok: true, value: result.value, fetchedAt }
  } catch (e) {
    const err = (e as Error).message ?? String(e)
    lastErrors.set(p.id, { error: err, fetchedAt: new Date().toISOString() })
    return { ok: false, error: err }
  }
}

// POST /api/platforms/:id/fetch
async function fetchOne(id: string): Promise<FetchOutcome> {
  const list = platformRepo.getAll()
  const p = list.find((x) => x.id === id)
  if (!p) throw Object.assign(new Error('平台不存在'), { status: 404 })

  const outcome = await collect(p)
  if (outcome.ok) {
    logService.log('fetch', `获取「${p.name}」余额成功: ${outcome.value}`, {
      platformId: p.id,
      platformName: p.name,
      meta: { value: outcome.value },
    })
  } else {
    logService.log('fetch', `获取「${p.name}」余额失败: ${outcome.error}`, {
      platformId: p.id,
      platformName: p.name,
      meta: { error: outcome.error },
    })
  }
  return outcome
}

// POST /api/platforms/refresh: 顺序抓取全部平台(与旧行为一致), 汇总结果
async function refreshAll(): Promise<{ ok: true; results: Array<Record<string, unknown>> }> {
  const list = platformRepo.getAll()
  const results: Array<Record<string, unknown>> = []
  let ok = 0
  let fail = 0
  for (const p of list) {
    const outcome = await collect(p)
    if (outcome.ok) {
      results.push({ id: p.id, ok: true, value: outcome.value })
      ok++
    } else {
      results.push({ id: p.id, ok: false, error: outcome.error })
      fail++
    }
  }
  logService.log('refresh', `手动刷新完成: 成功 ${ok} 个, 失败 ${fail} 个`, {
    meta: { ok, fail },
  })
  return { ok: true, results }
}

// 定时采集一轮 (monitor.runOnce 等价)
async function runOnce(reason?: string): Promise<void> {
  if (running) return
  running = true
  try {
    const list = platformRepo.getAll()
    if (!list.length) return
    let ok = 0
    let fail = 0
    for (const p of list) {
      const outcome = await collect(p)
      if (outcome.ok) ok++
      else fail++
    }
    logService.log('fetch', `自动采集完成: 成功 ${ok} 个, 失败 ${fail} 个`, {
      meta: { reason: reason || 'schedule', ok, fail },
    })
  } finally {
    running = false
  }
}

function schedule(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  const sec = Number(settingsRepo.get().collectIntervalSeconds) || 0
  if (sec > 0) {
    timer = setInterval(() => {
      void runOnce('schedule')
    }, sec * 1000)
  }
}

// 根据设置启动定时采集调度器(默认 0 秒 = 关闭)
function start(): void {
  schedule()
}

// 设置变更后重新排程
function reschedule(): void {
  schedule()
}

function stop(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

// 面板数据 GET /api/platforms/balances:
// 最新值 = 历史采样最新点; 仅当失败发生在最新采样之后才显示错误
function buildDashboard(): { updatedAt: string; platforms: BalanceCard[] } {
  const platforms = platformRepo.getAll()
  const data = platforms.map((p) => {
    const pub: PublicPlatform = toPublic(p)
    const latestPoint = historyRepo.latest(p.id)
    const err = lastErrors.get(p.id)
    let balance: number | null = null
    let error: string | null = null
    let fetchedAt: string | null = null
    if (err && (!latestPoint || err.fetchedAt > latestPoint.t)) {
      error = err.error
      fetchedAt = err.fetchedAt
    } else if (latestPoint) {
      balance = latestPoint.v
      fetchedAt = latestPoint.t
    }
    return {
      id: p.id,
      name: p.name,
      url: p.url,
      display: pub.display,
      balance,
      error,
      fetchedAt,
    }
  })
  return { updatedAt: new Date().toISOString(), platforms: data }
}

export const monitorService = {
  collect,
  fetchOne,
  refreshAll,
  runOnce,
  start,
  reschedule,
  stop,
  buildDashboard,
}
