import { useEffect, useState } from 'react'
import type { BalanceCard } from '@/types'
import { fmt, runFormatOnClient } from '@/lib/format'
import { useStore } from '@/store/useStore'
import { fetchPlatformBalance, refreshAllPlatforms, updateSettings } from '@/api/endpoints'
import TrendChartModal from '@/components/TrendChart/TrendChartModal'

const MAX_INTERVAL = 86400

function BalanceCardView({
  p,
  refreshing,
  onRefresh,
  onOpenChart,
}: {
  p: BalanceCard
  refreshing: boolean
  onRefresh(): void
  onOpenChart(id: string, name: string): void
}) {
  const title = p.url ? (
    <a className="card__platform" href={p.url} target="_blank" rel="noopener noreferrer" title={p.name}>
      {p.name}
    </a>
  ) : (
    <span className="card__platform">{p.name}</span>
  )
  const text = p.value != null && p.format ? runFormatOnClient(p.format, p.value) : null
  const isEmpty = p.value == null && text == null
  const balanceText = text ?? (p.value != null ? fmt(p.value) : '—')
  return (
    <article
      className={`card${isEmpty ? ' card--empty' : ''}${p.error ? ' card--error' : ''}`}
    >
      <div className="card__top">
        {title}
        <span className="card__top-right">
          <button
            type="button"
            className="card__refresh"
            disabled={refreshing}
            onClick={onRefresh}
            title="刷新此平台"
            aria-label="刷新此平台"
          >
            {refreshing ? '…' : '↻'}
          </button>
          {p.value != null && (
            <button
              type="button"
              className="card__chart"
              onClick={() => onOpenChart(p.id, p.name)}
              title="查看余额变化趋势"
              aria-label="查看余额变化趋势"
            >
              📊
            </button>
          )}
        </span>
      </div>
      <div className="card__balance">{balanceText}</div>
      <div className={`card__foot${p.error ? ' card__foot--error' : ''}`}>
        {p.error || (p.fetchedAt ? `获取于 ${new Date(p.fetchedAt).toLocaleString('zh-CN')}` : '尚未获取')}
      </div>
    </article>
  )
}

export default function DashboardTab() {
  const dashboard = useStore((s) => s.dashboard)
  const lastUpdateText = useStore((s) => s.lastUpdateText)
  const settings = useStore((s) => s.settings)
  const loadDashboard = useStore((s) => s.loadDashboard)
  const setLastUpdateError = useStore((s) => s.setLastUpdateError)
  const loadSettings = useStore((s) => s.loadSettings)
  const applySettings = useStore((s) => s.applySettings)

  const [refreshing, setRefreshing] = useState(false)
  // 单卡片刷新中集合 (按钮显示 … 并禁用)
  const [cardRefreshing, setCardRefreshing] = useState<Set<string>>(new Set())
  const [chart, setChart] = useState<{ id: string; name: string } | null>(null)

  // 自动采集设置本地态
  const [intervalText, setIntervalText] = useState('0')
  const [collectMsg, setCollectMsg] = useState<{ text: string; error?: boolean }>({ text: '' })
  const [savingCollect, setSavingCollect] = useState(false)

  useEffect(() => {
    void loadDashboard()
    void loadSettings()
  }, [loadDashboard, loadSettings])

  // 已保存的采集间隔变化时回填输入框(渲染期调整, 替代 effect 同步)
  const [savedSec, setSavedSec] = useState(settings.collectIntervalSeconds)
  if (savedSec !== settings.collectIntervalSeconds) {
    setSavedSec(settings.collectIntervalSeconds)
    setIntervalText(String(settings.collectIntervalSeconds))
  }

  const sec = settings.collectIntervalSeconds

  const doRefreshAll = async () => {
    setRefreshing(true)
    try {
      await refreshAllPlatforms()
      await loadDashboard()
    } catch (e) {
      setLastUpdateError(`刷新失败: ${(e as Error).message}`)
    } finally {
      setRefreshing(false)
    }
  }

  const refreshCard = async (id: string) => {
    setCardRefreshing((prev) => new Set(prev).add(id))
    try {
      await fetchPlatformBalance(id)
      await loadDashboard()
    } catch (e) {
      setLastUpdateError(`刷新失败: ${(e as Error).message}`)
    } finally {
      setCardRefreshing((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const saveCollect = async () => {
    const raw = Number(intervalText)
    const value = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : null
    if (value === null) {
      setCollectMsg({ text: '请输入大于等于 0 的整数', error: true })
      return
    }
    if (value > MAX_INTERVAL) {
      setCollectMsg({ text: '间隔不能超过 86400 秒（1 天）', error: true })
      return
    }
    setSavingCollect(true)
    setCollectMsg({ text: '保存中…' })
    try {
      const next = await updateSettings({ collectIntervalSeconds: value })
      applySettings(next)
      setCollectMsg({ text: value === 0 ? '已关闭自动采集' : `已设置每 ${value} 秒采集一次` })
    } catch (e) {
      setCollectMsg({ text: `保存失败: ${(e as Error).message}`, error: true })
    } finally {
      setSavingCollect(false)
    }
  }

  const items = dashboard.platforms || []

  return (
    <>
      <section className="hero">
        <div className="hero__meta">LLM PLATFORM · BALANCE MONITOR</div>
        <h2 className="hero__title">LLM 平台余额监控</h2>
        <div className="hero__line" />
        <p className="hero__desc">
          统一查看各 LLM 平台的配额与余额。
          <br />
          在「平台配置」中接入平台后，可手动获取余额。
        </p>
      </section>

      <section className="section">
        <div className="section__head">
          <h3 className="section__title">平台余额总览</h3>
          <div className="section__head-actions">
            <span className="section__note">{lastUpdateText}</span>
            <span className="section__note">
              {sec > 0 ? `自动采集 · 每 ${sec} 秒` : '自动采集 · 关闭'}
            </span>
          </div>
        </div>
        <div className="section__actions">
          <button type="button" className="btn" disabled={refreshing} onClick={() => void doRefreshAll()}>
            {refreshing ? '刷新中…' : '立即刷新'}
          </button>
        </div>
        <div className="grid">
          {items.length
            ? items.map((p) => (
                <BalanceCardView
                  key={p.id}
                  p={p}
                  refreshing={cardRefreshing.has(p.id)}
                  onRefresh={() => void refreshCard(p.id)}
                  onOpenChart={(id, name) => setChart({ id, name })}
                />
              ))
            : (
                <div className="card card--empty">
                  <div className="card__platform">尚未配置平台</div>
                </div>
              )}
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h3 className="section__title">自动采集</h3>
          <span className="section__note">AUTO COLLECTION</span>
        </div>
        <p className="section__desc">
          配置每隔多久自动采集一次所有平台余额，采集结果会写入余额历史（折线图数据源）。0 秒表示关闭自动采集。
        </p>
        <div className="collect-row">
          <label className="field__label" htmlFor="collect-interval">
            采集间隔（秒）
          </label>
          <input
            className="field__input collect-row__input"
            id="collect-interval"
            type="number"
            min={0}
            step={1}
            placeholder="0"
            value={intervalText}
            onChange={(e) => setIntervalText(e.target.value)}
          />
          <button type="button" className="btn btn--ghost" disabled={savingCollect} onClick={() => void saveCollect()}>
            保存
          </button>
          <span className={`form__msg${collectMsg.error ? ' is-error' : ''}`}>{collectMsg.text}</span>
        </div>
      </section>

      {chart && (
        <TrendChartModal id={chart.id} name={chart.name} onClose={() => setChart(null)} />
      )}
    </>
  )
}
