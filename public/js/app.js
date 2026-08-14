const API = '/api/platforms'

async function api(path, options) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

document.addEventListener('DOMContentLoaded', () => {
  /* ---------- Tabs ---------- */

  const nav = document.getElementById('tab-nav')
  const switchTab = (name) => {
    document.querySelectorAll('.header__link').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.tab === name)
    })
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.classList.toggle('is-active', tab.id === `tab-${name}`)
    })
    sessionStorage.setItem('quotahub-tab', name)
  }
  const savedTab = sessionStorage.getItem('quotahub-tab')
  if (savedTab && (savedTab === 'dashboard' || savedTab === 'config')) {
    switchTab(savedTab)
  }
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('.header__link')
    if (btn) switchTab(btn.dataset.tab)
  })

  /* ---------- 监控面板 ---------- */

  const grid = document.getElementById('platform-grid')
  const lastUpdate = document.getElementById('last-update')
  const btnRefresh = document.getElementById('btn-refresh')

  const fmt = (v) => {
    if (v == null) return '—'
    const n = Number(v)
    if (Number.isNaN(n)) return v
    return n % 1 === 0 ? n.toString() : n.toFixed(2)
  }

  const renderDashboard = (data) => {
    lastUpdate.textContent = `LAST UPDATE — ${data.updatedAt ? new Date(data.updatedAt).toLocaleString('zh-CN') : '—'}`
    const items = data.platforms || []
    grid.innerHTML = items.length
      ? items.map((p) => `
          <article class="card ${p.balance == null ? 'card--empty' : ''} ${p.error ? 'card--error' : ''}">
            <div class="card__top">
              <span class="card__platform">${p.name}</span>
              <span class="card__tag ${p.error ? 'tag--warn' : ''}">${p.error ? '获取失败' : p.balance == null ? '待获取' : '已获取'}</span>
            </div>
            <div class="card__balance">
              <span class="card__affix">${p.prefix}</span>${fmt(p.balance)}<span class="card__affix">${p.suffix}</span>
            </div>
            <div class="card__foot ${p.error ? 'card__foot--error' : ''}">${p.error || (p.fetchedAt ? `获取于 ${new Date(p.fetchedAt).toLocaleString('zh-CN')}` : '尚未获取')}</div>
          </article>`
        ).join('')
      : '<div class="card card--empty"><div class="card__platform">尚未配置平台</div></div>'
  }

  const loadDashboard = async () => {
    try {
      renderDashboard(await api('/balances'))
    } catch (e) {
      renderDashboard({ platforms: [] })
    }
  }

  btnRefresh.addEventListener('click', async () => {
    btnRefresh.disabled = true
    btnRefresh.textContent = '刷新中…'
    try {
      await api('/refresh', { method: 'POST' })
      await loadDashboard()
    } catch (e) {
      lastUpdate.textContent = `LAST UPDATE — 刷新失败: ${e.message}`
    } finally {
      btnRefresh.disabled = false
      btnRefresh.textContent = '立即刷新'
    }
  })

  /* ---------- 平台配置 ---------- */

  const form = document.getElementById('platform-form')
  const formMsg = document.getElementById('form-msg')
  const btnSave = document.getElementById('btn-save')
  const btnCancelEdit = document.getElementById('btn-cancel-edit')
  let editingId = null
  let platformsCache = []

  const setEditing = (id, name) => {
    editingId = id
    btnSave.textContent = id ? '更新配置' : '保存配置'
    btnCancelEdit.hidden = !id
    setMsg(id ? `正在编辑：${name}` : '')
  }

  const switchPreset = (name) => {
    preset = name
    document.querySelectorAll('.preset-tab').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.preset === name)
    })
    document.querySelectorAll('.preset-panel').forEach((panel) => {
      panel.classList.toggle('is-active', panel.dataset.panel === name)
    })
  }

  document.getElementById('preset-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.preset-tab')
    if (btn) switchPreset(btn.dataset.preset)
  })

  const fillForm = (p) => {
    switchPreset(p.preset === 'newapi' ? 'newapi' : 'custom')
    if (p.preset === 'newapi') {
      const headers = p.request.headers || {}
      const base = (p.request.url || '').replace(/\/api\/user\/self$/, '')
      document.getElementById('n-name').value = p.name || ''
      document.getElementById('n-base').value = base
      document.getElementById('n-user').value = headers['New-Api-User'] || ''
      document.getElementById('n-token').value = (headers.Authorization || '').replace(/^Bearer\s+/i, '')
      document.getElementById('n-divider').value = p.response && p.response.divider ? p.response.divider : '500000'
      document.getElementById('n-prefix').value = (p.response && p.response.prefix) || ''
      document.getElementById('n-suffix').value = (p.response && p.response.suffix) || ''
    } else {
      document.getElementById('f-name').value = p.name || ''
      methodSelect.value = p.request.method || 'GET'
      document.getElementById('f-base').value = p.request.url || ''
      document.getElementById('f-headers').value = JSON.stringify(p.request.headers || {}, null, 0)
      document.getElementById('f-body').value = p.request.body ? JSON.stringify(p.request.body) : ''
      document.getElementById('f-path').value = (p.response && p.response.path) || ''
      document.getElementById('f-prefix').value = (p.response && p.response.prefix) || ''
      document.getElementById('f-suffix').value = (p.response && p.response.suffix) || ''
      toggleBody()
    }
    form.scrollIntoView({ behavior: 'smooth' })
  }

  const setMsg = (text, isError) => {
    formMsg.textContent = text
    formMsg.classList.toggle('is-error', Boolean(isError))
  }

  const bodyInput = document.getElementById('f-body')
  const methodSelect = document.getElementById('f-method')

  const toggleBody = () => {
    bodyInput.disabled = methodSelect.value !== 'POST'
  }
  methodSelect.addEventListener('change', toggleBody)
  toggleBody()

  const readForm = () => {
    if (preset === 'newapi') {
      const base = document.getElementById('n-base').value.trim().replace(/\/+$/, '')
      const userId = document.getElementById('n-user').value.trim()
      const token = document.getElementById('n-token').value.trim()
      const divider = Number(document.getElementById('n-divider').value)
      if (!base) throw new Error('请填写请求地址')
      if (!token) throw new Error('请填写访问令牌')
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'cc-switch/1.0',
      }
      if (userId) headers['New-Api-User'] = userId
      return {
        name: document.getElementById('n-name').value,
        preset: 'newapi',
        request: {
          method: 'GET',
          url: `${base}/api/user/self`,
          headers,
        },
        response: {
          path: 'data.quota',
          divider: divider > 0 ? divider : undefined,
          prefix: document.getElementById('n-prefix').value,
          suffix: document.getElementById('n-suffix').value,
        },
      }
    }

    let headers = {}
    try {
      headers = JSON.parse(document.getElementById('f-headers').value || '{}')
    } catch {
      throw new Error('请求头必须是合法 JSON')
    }
    const bodyText = bodyInput.value.trim()
    let body
    if (bodyText) {
      try {
        body = JSON.parse(bodyText)
      } catch {
        throw new Error('请求体必须是合法 JSON')
      }
    }
    return {
      name: document.getElementById('f-name').value,
      preset: 'custom',
      request: {
        method: methodSelect.value,
        url: document.getElementById('f-base').value,
        headers,
        body,
      },
      response: {
        path: document.getElementById('f-path').value,
        prefix: document.getElementById('f-prefix').value,
        suffix: document.getElementById('f-suffix').value,
      },
    }
  }

  const btnValidate = document.getElementById('btn-validate')
  btnValidate.addEventListener('click', async () => {
    setMsg('验证中…')
    btnValidate.disabled = true
    let payload
    try {
      payload = readForm()
    } catch (err) {
      setMsg(err.message, true)
      btnValidate.disabled = false
      return
    }
    try {
      const r = await api('/validate', { method: 'POST', body: JSON.stringify(payload) })
      if (r.ok) {
        const affix = `${r.value} ${payload.response.prefix || ''}${payload.response.suffix || ''}`.trim()
        setMsg(`验证成功: ${affix}`)
      } else {
        setMsg(`验证失败: ${r.error}`, true)
      }
    } catch (err) {
      setMsg(`验证失败: ${err.message}`, true)
    } finally {
      btnValidate.disabled = false
    }
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    setMsg('')
    let payload
    try {
      payload = readForm()
    } catch (err) {
      setMsg(err.message, true)
      return
    }
    try {
      const url = editingId ? `/${editingId}` : '/'
      const method = editingId ? 'PUT' : 'POST'
      const saved = await api(url, { method, body: JSON.stringify(payload) })
      setMsg(editingId ? `已更新: ${saved.name}` : `已保存: ${saved.name}`)
      setEditing(null)
      form.reset()
      toggleBody()
      switchPreset('newapi')
      await loadPlatforms()
      await loadDashboard()
    } catch (err) {
      setMsg(`保存失败: ${err.message}`, true)
    }
  })

  btnCancelEdit.addEventListener('click', () => {
    setEditing(null)
    form.reset()
    toggleBody()
    switchPreset('newapi')
    setMsg('')
  })

  const tbody = document.getElementById('platform-table-body')
  const tplCount = document.querySelector('.section__note')

  const renderPlatforms = (list) => {
    tplCount.textContent = `CONFIGURED · ${list.length}`
    if (!list.length) {
      tbody.innerHTML = '<tr class="table__empty"><td colspan="6">尚未配置任何平台</td></tr>'
      return
    }
    tbody.innerHTML = list.map((p) => `
      <tr data-id="${p.id}">
        <td>${p.name}</td>
        <td><span class="tag ${p.preset === 'newapi' ? 'tag--on' : ''}">${(p.preset || 'custom').toUpperCase()}</span></td>
        <td>${p.request.url || '—'}</td>
        <td>${p.response.prefix || '—'}</td>
        <td>${p.response.suffix || '—'}</td>
        <td>
          <button class="table__action" data-act="edit">编辑</button>
          <button class="table__action" data-act="test">测试连接</button>
          <button class="table__action" data-act="fetch">获取余额</button>
          <button class="table__action table__action--danger" data-act="delete">删除</button>
          <span class="table__msg" data-msg></span>
        </td>
      </tr>
    `).join('')
  }

  const loadPlatforms = async () => {
    try {
      platformsCache = await api('')
      renderPlatforms(platformsCache)
    } catch (e) {
      tbody.innerHTML = `<tr class="table__empty"><td colspan="6">加载失败: ${e.message}</td></tr>`
    }
  }

  tbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('.table__action')
    if (!btn) return
    const row = btn.closest('tr')
    const id = row.dataset.id
    const msgEl = row.querySelector('[data-msg]')
    msgEl.textContent = ''
    msgEl.classList.remove('is-error')

    if (btn.dataset.act === 'edit') {
      const p = platformsCache.find((x) => x.id === id)
      if (p) {
        fillForm(p)
        setEditing(id, p.name)
        switchTab('config')
      }
      return
    }

    try {
      if (btn.dataset.act === 'test') {
        msgEl.textContent = '测试中…'
        const r = await api(`/${id}/test`, { method: 'POST' })
        msgEl.textContent = r.ok ? `成功: ${fmt(r.value)}` : `失败: ${r.error}`
        if (!r.ok) msgEl.classList.add('is-error')
      } else if (btn.dataset.act === 'fetch') {
        msgEl.textContent = '获取中…'
        const r = await api(`/${id}/fetch`, { method: 'POST' })
        msgEl.textContent = r.ok ? `已获取: ${fmt(r.value)}` : `失败: ${r.error}`
        if (!r.ok) msgEl.classList.add('is-error')
        await loadDashboard()
      } else if (btn.dataset.act === 'delete') {
        if (!confirm(`确定删除平台「${row.firstElementChild.textContent}」？`)) return
        await api(`/${id}`, { method: 'DELETE' })
        await loadPlatforms()
        await loadDashboard()
      }
    } catch (err) {
      msgEl.textContent = err.message
      msgEl.classList.add('is-error')
    }
  })

  loadPlatforms()
  loadDashboard()
})
