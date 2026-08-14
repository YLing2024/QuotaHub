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
            <div class="card__balance">${fmt(p.balance)}</div>
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

  const setMsg = (text, isError) => {
    formMsg.textContent = text
    formMsg.classList.toggle('is-error', Boolean(isError))
  }

  /* ---------- CodeMirror 编辑器 ---------- */

  const headerEditor = CodeMirror.fromTextArea(document.getElementById('f-headers'), {
    lineNumbers: true,
    mode: { name: 'javascript', json: true },
    extraKeys: { 'Ctrl-Enter': () => document.getElementById('btn-validate').click() },
  })

  const extractorEditor = CodeMirror.fromTextArea(document.getElementById('f-extractor'), {
    lineNumbers: true,
    mode: 'javascript',
    extraKeys: { 'Ctrl-Enter': () => document.getElementById('btn-validate').click() },
  })

  /* ---------- 快速配置预设卡片 ---------- */

  const openPreset = (preset) => {
    if (preset === 'newapi') {
      openModal()
      return
    }
  }

  document.querySelectorAll('.quick-card').forEach((card) => {
    card.addEventListener('click', () => openPreset(card.dataset.preset))
  })

  /* ---------- NEWAPI 快速配置弹窗 ---------- */

  const modal = document.getElementById('newapi-modal')
  const openModal = () => modal.classList.add('is-open')
  const closeModal = () => modal.classList.remove('is-open')

  document.getElementById('btn-newapi').addEventListener('click', openModal)
  document.getElementById('m-close').addEventListener('click', closeModal)
  document.getElementById('m-cancel').addEventListener('click', closeModal)
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal()
  })

  document.getElementById('m-confirm').addEventListener('click', () => {
    const base = document.getElementById('m-base').value.trim().replace(/\/+$/, '')
    const token = document.getElementById('m-token').value.trim()
    const user = document.getElementById('m-user').value.trim()
    if (!base) return setMsg('请填写请求地址', true)
    if (!token) return setMsg('请填写访问令牌', true)

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'cc-switch/1.0',
    }
    if (user) headers['New-Api-User'] = user

    document.getElementById('f-url').value = `${base}/api/user/self`
    headerEditor.setValue(JSON.stringify(headers, null, 2))
    extractorEditor.setValue('function (data) {\n  return data.data.quota / 500000\n}')

    document.getElementById('m-base').value = ''
    document.getElementById('m-token').value = ''
    document.getElementById('m-user').value = ''
    closeModal()
    setMsg('已填入 NEWAPI 配置，可修改后保存')
    document.getElementById('f-url').scrollIntoView({ behavior: 'smooth', block: 'center' })
  })

  /* ---------- 请求体开关 ---------- */

  const bodyInput = document.getElementById('f-body')
  const methodSelect = document.getElementById('f-method')

  const toggleBody = () => {
    bodyInput.disabled = methodSelect.value !== 'POST'
  }
  methodSelect.addEventListener('change', toggleBody)
  toggleBody()

  /* ---------- 表单读取 ---------- */

  const readForm = () => {
    let headers = {}
    try {
      headers = JSON.parse(headerEditor.getValue() || '{}')
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
      request: {
        method: methodSelect.value,
        url: document.getElementById('f-url').value,
        headers,
        body,
      },
      extractor: extractorEditor.getValue(),
    }
  }

  /* ---------- 表单回填 ---------- */

  const clearForm = () => {
    form.reset()
    headerEditor.setValue('{\n  "Authorization": "Bearer 你的密钥"\n}')
    extractorEditor.setValue('function (data) {\n  return data.balance\n}')
    toggleBody()
  }

  const fillForm = (p) => {
    document.getElementById('f-name').value = p.name || ''
    methodSelect.value = (p.request && p.request.method) || 'GET'
    document.getElementById('f-url').value = (p.request && p.request.url) || ''
    headerEditor.setValue(JSON.stringify((p.request && p.request.headers) || {}, null, 2))
    bodyInput.value = p.request && p.request.body ? JSON.stringify(p.request.body) : ''
    toggleBody()
    extractorEditor.setValue(
      p.extractor ||
      (p.response && p.response.path
        ? (() => {
            const path = p.response.path
            const expr = /^(data\.|data\[)/.test(path) ? path : `data.${path}`
            return `function (data) {\n  return ${expr}${p.response.divider ? ' / ' + p.response.divider : ''}\n}`
          })()
        : 'function (data) {\n  return data.balance\n}')
    )
  }

  /* ---------- 验证 ---------- */

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
        setMsg(`验证成功: ${fmt(r.value)}`)
      } else {
        setMsg(`验证失败: ${r.error}`, true)
      }
    } catch (err) {
      setMsg(`验证失败: ${err.message}`, true)
    } finally {
      btnValidate.disabled = false
    }
  })

  /* ---------- 保存 / 更新 ---------- */

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
      clearForm()
      await loadPlatforms()
      await loadDashboard()
    } catch (err) {
      setMsg(`保存失败: ${err.message}`, true)
    }
  })

  btnCancelEdit.addEventListener('click', () => {
    setEditing(null)
    clearForm()
    setMsg('')
  })

  /* ---------- 平台表格 ---------- */

  const tbody = document.getElementById('platform-table-body')
  const tplCount = document.querySelector('.section__note')

  const renderPlatforms = (list) => {
    tplCount.textContent = `CONFIGURED · ${list.length}`
    if (!list.length) {
      tbody.innerHTML = '<tr class="table__empty"><td colspan="3">尚未配置任何平台</td></tr>'
      return
    }
    tbody.innerHTML = list.map((p) => `
      <tr data-id="${p.id}">
        <td>${p.name}</td>
        <td>${(p.request && p.request.url) || '—'}</td>
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
      tbody.innerHTML = `<tr class="table__empty"><td colspan="3">加载失败: ${e.message}</td></tr>`
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
