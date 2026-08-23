import { useCallback, useEffect, useState } from 'react'
import type { LogEntry } from '@/types'
import { clearLogs, getLogs } from '@/api/endpoints'

const ACTION_LABEL: Record<string, string> = {
  create: '新增平台',
  update: '更新平台',
  delete: '删除平台',
  fetch: '获取余额',
  refresh: '手动刷新',
  test: '测试连接',
  reorder: '平台排序',
  import: '导入配置',
  export: '导出配置',
  settings: '设置变更',
  'clear-logs': '清空日志',
  start: '系统启动',
  unknown: '其他',
}

function LogItem({ l }: { l: LogEntry }) {
  const platform = l.platformName ? (
    <>
      {' · '}
      <span className="log__platform">{l.platformName}</span>
    </>
  ) : null
  const meta =
    l.meta && typeof l.meta === 'object' && Object.keys(l.meta).length ? (
      <span className="log__meta">{JSON.stringify(l.meta)}</span>
    ) : null
  return (
    <div className="log-item">
      <span className="log__time">{new Date(l.time).toLocaleString('zh-CN')}</span>
      <span className={`log__action log__action--${l.action}`}>
        {ACTION_LABEL[l.action] || l.action}
      </span>
      <span className="log__detail">
        {l.detail || ''}
        {platform}
      </span>
      {meta}
    </div>
  )
}

export default function LogsTab({ active }: { active: boolean }) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await getLogs(500)
      setLogs(data.logs || [])
      setTotal(data.total != null ? data.total : (data.logs || []).length)
      setError('')
    } catch (e) {
      setError(`加载失败: ${(e as Error).message}`)
    }
  }, [])

  // 与旧版一致: 每次切到日志 tab 时加载
  useEffect(() => {
    if (active) void load()
  }, [active, load])

  const clearAll = async () => {
    if (!window.confirm('确定清空所有操作日志？此操作不可撤销。')) return
    try {
      await clearLogs()
      await load()
    } catch (e) {
      window.alert(`清空失败: ${(e as Error).message}`)
    }
  }

  return (
    <>
      <section className="hero hero--small">
        <div className="hero__meta">OPERATION · LOGS</div>
        <h2 className="hero__title">操作日志</h2>
        <div className="hero__line" />
        <p className="hero__desc">
          记录平台增删改、余额获取、导入导出、设置变更等操作。
          <br />
          日志持久化保存，最多保留最近 2000 条。
        </p>
      </section>

      <section className="section">
        <div className="section__head">
          <h3 className="section__title">日志列表</h3>
          <div className="section__head-actions">
            <span className="section__note">LOGS · {total}</span>
            <button type="button" className="btn btn--ghost" onClick={() => void load()}>
              刷新
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--danger"
              onClick={() => void clearAll()}
            >
              清空日志
            </button>
          </div>
        </div>
        <div className="log-list">
          {error ? (
            <div className="log-empty">{error}</div>
          ) : logs.length ? (
            logs.map((l) => <LogItem key={l.id} l={l} />)
          ) : (
            <div className="log-empty">暂无操作日志</div>
          )}
        </div>
      </section>
    </>
  )
}
