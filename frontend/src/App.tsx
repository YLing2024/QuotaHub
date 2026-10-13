import { useEffect, useState } from 'react'
import { Avatar, Badge, Button, Layout, Menu, Space, Typography, theme } from 'antd'
import DashboardTab from '@/components/Dashboard'
import LogsTab from '@/components/Logs'
import ConfigTab from '@/components/Config'
import LoginPage from '@/components/Auth/LoginPage'
import { useStore } from '@/store/useStore'
import { useAuthStore } from '@/store/useAuthStore'

export type TabName = 'dashboard' | 'config' | 'logs'

const TABS: Array<{ key: TabName; label: string }> = [
  { key: 'dashboard', label: '监控面板' },
  { key: 'config', label: '平台配置' },
  { key: 'logs', label: '操作日志' },
]

const TAB_KEY = 'quotahub-tab'

function initialTab(): TabName {
  const saved = sessionStorage.getItem(TAB_KEY)
  return saved === 'config' || saved === 'logs' ? saved : 'dashboard'
}

export default function App() {
  const { token } = theme.useToken()
  const [tab, setTab] = useState<TabName>(initialTab)

  const ready = useAuthStore((s) => s.ready)
  const mode = useAuthStore((s) => s.mode)
  const user = useAuthStore((s) => s.user)
  const initAuth = useAuthStore((s) => s.init)
  const logout = useAuthStore((s) => s.logout)

  // 启动探测认证模式 + builtin 登录态
  useEffect(() => {
    void initAuth()
  }, [initAuth])

  // sso 模式由前置认证层保证; builtin 需已登录
  const authenticated = mode === 'sso' || !!user

  // 首屏数据预载 (已登录才加载, 避免未登录时无谓的 401)
  useEffect(() => {
    if (!authenticated) return
    const s = useStore.getState()
    void s.loadPresets()
    void s.loadPlatforms()
    void s.loadDashboard()
    void s.loadSettings()
  }, [authenticated])

  if (!ready) return null
  if (mode === 'builtin' && !user) return <LoginPage />

  const switchTab = (name: TabName) => {
    setTab(name)
    sessionStorage.setItem(TAB_KEY, name)
  }

  // 退出按模式分发: builtin 清本地会话, sso 交给前置认证层
  const onLogout = () => {
    if (mode === 'sso') {
      window.location.href = '/_auth/logout'
      return
    }
    void logout()
  }

  return (
    <Layout className="qh-layout">
      <Layout.Header className="qh-header" style={{ background: token.colorBgContainer }}>
        <Space size="middle" align="center">
          <Avatar shape="square" size="large">
            QH
          </Avatar>
          <Typography.Text strong>QuotaHub</Typography.Text>
        </Space>

        <Menu
          mode="horizontal"
          selectedKeys={[tab]}
          items={TABS}
          onClick={({ key }) => switchTab(key as TabName)}
          className="qh-nav"
        />

        <Space size="small" align="center">
          {mode === 'builtin' && user && <Typography.Text>{user.name}</Typography.Text>}
          <Button onClick={onLogout}>退出</Button>
          <Badge status="success" text="系统正常" />
        </Space>
      </Layout.Header>

      <Layout.Content>
        <div className="main">
          <div className={`tab${tab === 'dashboard' ? ' is-active' : ''}`}>
            <DashboardTab />
          </div>
          {/* 平台配置页保持挂载(隐藏), CodeMirror 内容不丢 */}
          <div className={`tab${tab === 'config' ? ' is-active' : ''}`}>
            <ConfigTab />
          </div>
          {/* 日志页保持挂载, 激活时才加载(与旧版点击 tab 时加载一致) */}
          <div className={`tab${tab === 'logs' ? ' is-active' : ''}`}>
            <LogsTab active={tab === 'logs'} />
          </div>
        </div>
      </Layout.Content>

      <Layout.Footer className="qh-footer">
        <Typography.Text type="secondary">QuotaHub © 2026</Typography.Text>
        <Typography.Text type="secondary">Open Source · MIT License</Typography.Text>
      </Layout.Footer>
    </Layout>
  )
}
