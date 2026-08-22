const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[c]))

async function api(path, options) {
  const token = localStorage.getItem('quotahub-token') || ''
  const headers = { 'Content-Type': 'application/json', ...(options && options.headers) }
  if (token) headers.Authorization = `Bearer ${token}`
  let res = await fetch(path, { ...options, headers })
  if (res.status === 401) {
    const input = prompt('此服务需要访问令牌，请输入（仅保存在本浏览器）')
    if (input) {
      localStorage.setItem('quotahub-token', input.trim())
      headers.Authorization = `Bearer ${input.trim()}`
      res = await fetch(path, { ...options, headers })
    }
  }
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.__quotahubInit) return
  window.__quotahubInit = true

  /* ---------- Tabs ---------- */

  const nav = document.getElementById('tab-nav')
  let cmReady = false
  function refreshCodeMirrors() {
    if (!cmReady) return
    for (const ed of [headerEditor, handlerEditor, verifyEditor]) {
      if (ed && typeof ed.refresh === 'function') ed.refresh()
    }
  }
  const switchTab = (name) => {
    document.querySelectorAll('.header__link').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.tab === name)
    })
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.classList.toggle('is-active', tab.id === `tab-${name}`)
    })
    // 编辑器初始化的容器是隐藏的(display:none), 切到可见后需要重绘
    if (name === 'config') refreshCodeMirrors()
    sessionStorage.setItem('quotahub-tab', name)
  }
  const savedTab = sessionStorage.getItem('quotahub-tab')
  if (savedTab && ['dashboard', 'config', 'logs'].includes(savedTab)) {
    switchTab(savedTab)
  }
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('.header__link')
    if (btn) {
      switchTab(btn.dataset.tab)
      if (btn.dataset.tab === 'logs') loadLogs()
    }
  })

  /* ---------- 监控面板 ---------- */

  const grid = document.getElementById('platform-grid')
  const lastUpdate = document.getElementById('last-update')
  const btnRefresh = document.getElementById('btn-refresh')

  const fmt = (v) => {
    if (v == null) return '—'
    if (typeof v === 'object') return JSON.stringify(v)
    const n = Number(v)
    if (Number.isNaN(n)) return v
    return n % 1 === 0 ? n.toString() : n.toFixed(2)
  }

  const formatValue = (v) => {
    if (v === undefined || v === null) return '（无返回值）'
    if (typeof v === 'object') return JSON.stringify(v, null, 2)
    if (typeof v === 'number' && Number.isNaN(v)) return '（NaN，请检查提取函数）'
    return String(v)
  }

  const renderDashboard = (data) => {
    lastUpdate.textContent = `LAST UPDATE — ${data.updatedAt ? new Date(data.updatedAt).toLocaleString('zh-CN') : '—'}`
    const items = data.platforms || []
    grid.innerHTML = items.length
      ? items.map((p) => {
          const d = p.display || {}
          const affix = (t) => (t ? `<span class="card__affix">${escapeHtml(t)}</span>` : '')
          const balanceHtml = p.balance == null ? '—' : `${affix(d.prefix)}${fmt(p.balance)}${affix(d.suffix)}`
          const titleHtml = p.url
            ? `<a class="card__platform" href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</a>`
            : `<span class="card__platform">${escapeHtml(p.name)}</span>`
          const refreshBtn = `<button class="card__refresh" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}" title="刷新此平台" aria-label="刷新此平台">↻</button>`
          const chartBtn = p.balance == null
            ? ''
            : `<button class="card__chart" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}" title="查看余额变化趋势" aria-label="查看余额变化趋势">📊</button>`
          return `
          <article class="card ${p.balance == null ? 'card--empty' : ''} ${p.error ? 'card--error' : ''}">
            <div class="card__top">
              ${titleHtml}
              <span class="card__top-right">
                ${refreshBtn}
                ${chartBtn}
              </span>
            </div>
            <div class="card__balance">${balanceHtml}</div>
            <div class="card__foot ${p.error ? 'card__foot--error' : ''}">${escapeHtml(p.error || (p.fetchedAt ? `获取于 ${new Date(p.fetchedAt).toLocaleString('zh-CN')}` : '尚未获取'))}</div>
          </article>`
        }).join('')
      : '<div class="card card--empty"><div class="card__platform">尚未配置平台</div></div>'
  }

  const loadDashboard = async () => {
    try {
      renderDashboard(await api('/api/platforms/balances'))
    } catch (e) {
      renderDashboard({ platforms: [] })
    }
  }

  btnRefresh.addEventListener('click', async () => {
    btnRefresh.disabled = true
    btnRefresh.textContent = '刷新中…'
    try {
      await api('/api/platforms/refresh', { method: 'POST' })
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

  const handlerEditor = CodeMirror.fromTextArea(document.getElementById('f-handler'), {
    lineNumbers: true,
    mode: 'javascript',
    extraKeys: { 'Ctrl-Enter': () => document.getElementById('btn-validate').click() },
  })

  const verifyEditor = CodeMirror.fromTextArea(document.getElementById('verify-output'), {
    lineNumbers: true,
    mode: { name: 'javascript', json: true },
    readOnly: true,
  })

  cmReady = true

  /* ---------- 快速配置预设 ---------- */

  const quickGrid = document.getElementById('quick-grid')
  let presets = []

  const render = (tpl, vars) => {
    if (typeof tpl === 'string') {
      return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== '' ? vars[k] : m))
    }
    if (Array.isArray(tpl)) return tpl.map((x) => render(x, vars))
    if (tpl && typeof tpl === 'object') {
      const out = {}
      for (const [k, v] of Object.entries(tpl)) out[k] = render(v, vars)
      return out
    }
    return tpl
  }

  const loadPresets = async () => {
    presets = await api('/api/presets')
    quickGrid.innerHTML = presets.map((p) => `
      <div class="quick-card" data-id="${escapeHtml(p.id)}">
        <div class="quick-card__head">
          <span class="quick-card__name">${escapeHtml(p.name)}</span>
          ${p.builtin ? '<span class="quick-card__badge">内置</span>' : ''}
        </div>
        <span class="quick-card__desc">${escapeHtml(p.fields.map((f) => f.label).join(' · '))}</span>
        <div class="quick-card__ops">
          <button type="button" class="table__action" data-op="edit">编辑</button>
          <button type="button" class="table__action" data-op="export">导出</button>
          ${p.builtin ? '<button type="button" class="table__action" data-op="reset">重置默认</button>' : '<button type="button" class="table__action table__action--danger" data-op="delete">删除</button>'}
        </div>
      </div>
    `).join('')
  }

  quickGrid.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-op]')
    const card = e.target.closest('.quick-card')
    if (!card) return
    const preset = presets.find((p) => p.id === card.dataset.id)
    if (!preset) return

    if (!btn) {
      openUseModal(preset)
      return
    }
    if (btn.dataset.op === 'edit') {
      openEditModal(preset)
    } else if (btn.dataset.op === 'export') {
      openTransferModal('export', `导出预设：${preset.name}`, '复制以下 JSON 即可分享或备份', JSON.stringify(preset, null, 2))
    } else if (btn.dataset.op === 'reset') {
      const def = await api(`/api/presets/${preset.id}/reset`, { method: 'POST' })
      await loadPresets()
      setMsg(`已重置 ${def.name} 为默认配置`)
    } else if (btn.dataset.op === 'delete') {
      if (!confirm(`确定删除预设「${preset.name}」？`)) return
      await api(`/api/presets/${preset.id}`, { method: 'DELETE' })
      await loadPresets()
    }
  })

  /* ---------- 预设使用弹窗 ---------- */

  const useModal = document.getElementById('use-modal')
  const useFields = document.getElementById('use-fields')
  let activePreset = null

  const openModal = (el) => el.classList.add('is-open')
  const closeModal = (el) => el.classList.remove('is-open')

  const openUseModal = (preset) => {
    activePreset = preset
    document.getElementById('use-modal-title').textContent = `${preset.name} 快速配置`
    useFields.innerHTML = preset.fields.map((f) => `
      <div class="modal__field">
        <label class="field__label" for="uf-${escapeHtml(f.key)}">${escapeHtml(f.label)}</label>
        <input class="field__input" id="uf-${escapeHtml(f.key)}" placeholder="${escapeHtml(f.placeholder || '')}">
      </div>
    `).join('')
    openModal(useModal)
  }

  document.getElementById('use-close').addEventListener('click', () => closeModal(useModal))
  document.getElementById('use-cancel').addEventListener('click', () => closeModal(useModal))
  useModal.addEventListener('click', (e) => {
    if (e.target === useModal) closeModal(useModal)
  })

  document.getElementById('use-confirm').addEventListener('click', () => {
    const preset = activePreset
    if (!preset) return
    const vars = {}
    for (const f of preset.fields) {
      vars[f.key] = document.getElementById(`uf-${f.key}`).value.trim()
    }
    if (preset.fields.some((f) => /url/i.test(f.key) && !vars[f.key])) {
      return setMsg(`请填写 ${preset.fields.find((f) => /url/i.test(f.key)).label}`, true)
    }

    const url = render(preset.urlTemplate, vars)
    const headers = render(preset.headersTemplate, vars)
    for (const k of Object.keys(headers)) {
      if (String(headers[k]).trim() === '') delete headers[k]
    }
    // 预设的提取函数模板以 JSON 解析后的 data 为输入, 使用时包一层 JSON.parse 生成处理函数
    const extractor = render(preset.extractorTemplate, vars)
    const handler = `function (raw) {\n  var data = JSON.parse(raw)\n  return (${extractor.trim()})(data)\n}`

    document.getElementById('f-url').value = url
    headerEditor.setValue(JSON.stringify(headers, null, 2))
    handlerEditor.setValue(handler)
    closeModal(useModal)
    setMsg(`已填入 ${preset.name} 配置，可修改后保存`)
    document.getElementById('f-url').scrollIntoView({ behavior: 'smooth', block: 'center' })
  })

  /* ---------- 预设编辑弹窗 ---------- */

  const presetModal = document.getElementById('preset-modal')
  let editingPresetId = null

  const peHeadersEditor = CodeMirror.fromTextArea(document.getElementById('pe-headers'), {
    lineNumbers: true,
    mode: { name: 'javascript', json: true },
  })

  const peExtractorEditor = CodeMirror.fromTextArea(document.getElementById('pe-extractor'), {
    lineNumbers: true,
    mode: 'javascript',
  })

  /* ---------- 预设字段交互式编辑 ---------- */

  const fieldsList = document.getElementById('pe-fields-list')

  const makeFieldRow = (f = {}) => {
    const row = document.createElement('div')
    row.className = 'pe-field-row'
    row.innerHTML = `
      <input class="field__input" data-k="key" value="${escapeHtml(f.key || '')}" placeholder="字段 key，如 baseUrl">
      <input class="field__input" data-k="label" value="${escapeHtml(f.label || '')}" placeholder="显示名称，如 请求地址">
      <input class="field__input" data-k="placeholder" value="${escapeHtml(f.placeholder || '')}" placeholder="输入提示（可留空）">
      <button type="button" class="table__action table__action--danger" data-k="del">删除</button>
    `
    row.querySelector('[data-k="del"]').addEventListener('click', () => row.remove())
    return row
  }

  const renderFieldRows = (fields) => {
    fieldsList.innerHTML = ''
    const list = fields && fields.length ? fields : [{}]
    for (const f of list) fieldsList.appendChild(makeFieldRow(f))
  }

  // 收集当前所有字段行; 全空的行自动忽略
  const collectFieldRows = () => {
    const fields = []
    for (const row of fieldsList.querySelectorAll('.pe-field-row')) {
      const key = row.querySelector('[data-k="key"]').value.trim()
      const label = row.querySelector('[data-k="label"]').value.trim()
      const placeholder = row.querySelector('[data-k="placeholder"]').value.trim()
      if (!key && !label && !placeholder) continue
      fields.push({ key, label, placeholder })
    }
    return fields
  }

  document.getElementById('pe-field-add').addEventListener('click', () => {
    fieldsList.appendChild(makeFieldRow())
    fieldsList.lastElementChild.querySelector('[data-k="key"]').focus()
  })

  const openEditModal = (preset) => {
    editingPresetId = preset ? preset.id : null
    document.getElementById('preset-modal-title').textContent = preset ? `编辑预设：${preset.name}` : '添加预设'
    document.getElementById('pe-name').value = preset ? preset.name : ''
    renderFieldRows(preset ? preset.fields : [])
    document.getElementById('pe-method').value = preset ? preset.method : 'GET'
    document.getElementById('pe-url').value = preset ? preset.urlTemplate : ''
    peHeadersEditor.setValue(preset ? JSON.stringify(preset.headersTemplate, null, 2) : '{\n  "Authorization": "Bearer {{token}}"\n}')
    peExtractorEditor.setValue(preset ? preset.extractorTemplate : 'function (data) {\n  return data.balance\n}')
    document.getElementById('pe-reset').hidden = !(preset && preset.builtin)
    // 弹窗从 display:none 变为可见, 编辑器需要重绘
    for (const ed of [peHeadersEditor, peExtractorEditor]) {
      if (ed && typeof ed.refresh === 'function') ed.refresh()
    }
    openModal(presetModal)
  }

  document.getElementById('pe-save').addEventListener('click', async () => {
    const fields = collectFieldRows()
    const missing = fields.find((f) => !f.key || !f.label)
    if (missing) {
      return setMsg(`字段缺少${!missing.key ? ' key' : '显示名称'}`, true)
    }
    if (!fields.length) {
      return setMsg('至少需要一个字段', true)
    }
    if (new Set(fields.map((f) => f.key)).size !== fields.length) {
      return setMsg('字段 key 不能重复', true)
    }
    let headers
    try {
      headers = JSON.parse(peHeadersEditor.getValue() || '{}')
    } catch {
      return setMsg('请求头模板必须是合法 JSON', true)
    }
    const payload = {
      name: document.getElementById('pe-name').value,
      fields,
      method: document.getElementById('pe-method').value,
      urlTemplate: document.getElementById('pe-url').value,
      headersTemplate: headers,
      extractorTemplate: peExtractorEditor.getValue(),
    }
    try {
      if (editingPresetId) {
        await api(`/api/presets/${editingPresetId}`, { method: 'PUT', body: JSON.stringify(payload) })
        setMsg('预设已更新')
      } else {
        await api('/api/presets', { method: 'POST', body: JSON.stringify(payload) })
        setMsg('预设已添加')
      }
      closeModal(presetModal)
      await loadPresets()
    } catch (err) {
      setMsg(`保存失败: ${err.message}`, true)
    }
  })

  document.getElementById('pe-reset').addEventListener('click', async () => {
    if (!editingPresetId) return
    const def = await api(`/api/presets/${editingPresetId}/reset`, { method: 'POST' })
    openEditModal(def)
    setMsg('已重置为默认配置，可修改后保存')
  })

  document.getElementById('preset-close').addEventListener('click', () => closeModal(presetModal))
  document.getElementById('pe-cancel').addEventListener('click', () => closeModal(presetModal))
  presetModal.addEventListener('click', (e) => {
    if (e.target === presetModal) closeModal(presetModal)
  })

  document.getElementById('btn-add-preset').addEventListener('click', () => openEditModal(null))

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
      url: document.getElementById('f-homepage').value.trim(),
      request: {
        method: methodSelect.value,
        url: document.getElementById('f-url').value,
        headers,
        body,
      },
      handler: handlerEditor.getValue(),
      display: {
        prefix: document.getElementById('f-prefix').value.trim(),
        suffix: document.getElementById('f-suffix').value.trim(),
      },
    }
  }

  /* ---------- 表单回填 ---------- */

  const DEFAULT_HANDLER = 'function (raw) {\n  return JSON.parse(raw).balance\n}'

  // 处理函数展示: 新模型直接取 handler; 旧配置(parse/extractor)自动生成等效合并版
  const buildHandler = (p) => {
    if (p.handler) return p.handler
    const lines = []
    if (p.parse) {
      lines.push(`var data = (${String(p.parse).trim()})(raw)`)
    } else {
      lines.push('var data = JSON.parse(raw)')
    }
    if (p.extractor) {
      lines.push(`return (${String(p.extractor).trim()})(data)`)
    } else {
      lines.push('return data')
    }
    return `function (raw) {\n  ${lines.join('\n  ')}\n}`
  }

  const clearForm = () => {
    form.reset()
    headerEditor.setValue('{\n  "Authorization": "Bearer 你的密钥"\n}')
    handlerEditor.setValue(DEFAULT_HANDLER)
    toggleBody()
  }

  const fillForm = (p) => {
    document.getElementById('f-name').value = p.name || ''
    document.getElementById('f-homepage').value = p.url || ''
    methodSelect.value = (p.request && p.request.method) || 'GET'
    document.getElementById('f-url').value = (p.request && p.request.url) || ''
    headerEditor.setValue(JSON.stringify((p.request && p.request.headers) || {}, null, 2))
    bodyInput.value = p.request && p.request.body ? JSON.stringify(p.request.body) : ''
    toggleBody()
    const d = p.display || (p.response && { prefix: p.response.prefix, suffix: p.response.suffix }) || {}
    document.getElementById('f-prefix').value = d.prefix || ''
    document.getElementById('f-suffix').value = d.suffix || ''
    handlerEditor.setValue(
      p.handler ||
      (p.parse || p.extractor
        ? buildHandler(p)
        : p.response && p.response.path
          ? (() => {
              const path = p.response.path
              const expr = /^(data\.|data\[)/.test(path) ? path : `data.${path}`
              return `function (raw) {\n  var data = JSON.parse(raw)\n  return ${expr}${p.response.divider ? ' / ' + p.response.divider : ''}\n}`
            })()
          : DEFAULT_HANDLER)
    )
  }

  /* ---------- 验证 ---------- */

  const btnValidate = document.getElementById('btn-validate')
  btnValidate.addEventListener('click', async () => {
    setMsg('验证中…')
    verifyEditor.setValue('验证中…')
    btnValidate.disabled = true
    let payload
    try {
      payload = readForm()
    } catch (err) {
      setMsg(err.message, true)
      verifyEditor.setValue(`配置错误：${err.message}`)
      btnValidate.disabled = false
      return
    }
    try {
      const r = await api('/api/platforms/validate', { method: 'POST', body: JSON.stringify(payload) })
      if (r.ok) {
        verifyEditor.setValue(formatValue(r.value))
        setMsg('验证成功')
      } else {
        verifyEditor.setValue(`请求失败：${r.error}`)
        setMsg('验证失败', true)
      }
    } catch (err) {
      verifyEditor.setValue(`验证失败：${err.message}`)
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
      const saved = await api(`/api/platforms${url}`, { method, body: JSON.stringify(payload) })
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

  /* ---------- 导入 / 导出 ---------- */

  const transferModal = document.getElementById('transfer-modal')
  const transferText = document.getElementById('transfer-text')
  const transferCopy = document.getElementById('transfer-copy')
  const transferConfirm = document.getElementById('transfer-confirm')
  const transferResult = document.getElementById('transfer-result')
  const transferDetect = document.getElementById('transfer-detect')
  let transferExpected = null // import 模式期望格式: full / platform / preset / null

  const KIND_NAME = { full: '完整配置', platform: '单个平台', preset: '单个预设' }

  // 自动识别粘贴内容: 完整配置 / 单个平台 / 单个预设
  const classifyConfig = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
    if (Array.isArray(obj.platforms) || Array.isArray(obj.presets)) {
      return { kind: 'full', label: `完整配置：${(obj.platforms || []).length} 个平台、${(obj.presets || []).length} 个预设` }
    }
    if (typeof obj.name === 'string' && obj.request && typeof obj.request.url === 'string') {
      return { kind: 'platform', label: `单个平台「${obj.name}」` }
    }
    if (typeof obj.name === 'string' && Array.isArray(obj.fields) && typeof obj.urlTemplate === 'string' && typeof obj.extractorTemplate === 'string') {
      return { kind: 'preset', label: `单个预设「${obj.name}」` }
    }
    return null
  }

  const updateDetect = () => {
    const text = transferText.value.trim()
    transferDetect.classList.remove('is-error')
    if (!text) {
      transferDetect.textContent = ''
      return
    }
    let obj
    try {
      obj = JSON.parse(text)
    } catch {
      transferDetect.textContent = '✗ 不是合法 JSON'
      transferDetect.classList.add('is-error')
      return
    }
    const hit = classifyConfig(obj)
    if (!hit) {
      transferDetect.textContent = '✗ 无法识别的配置格式（需要完整配置、单个平台或单个预设的 JSON）'
      transferDetect.classList.add('is-error')
    } else if (transferExpected && transferExpected !== hit.kind) {
      transferDetect.textContent = `⚠ 识别为${hit.label}，与期望的「${KIND_NAME[transferExpected]}」不符，仍可导入`
    } else {
      transferDetect.textContent = `✓ 识别为${hit.label}`
    }
  }

  const openTransferModal = (mode, title, desc, text, expectedKind) => {
    transferExpected = mode === 'import' ? (expectedKind || null) : null
    document.getElementById('transfer-modal-title').textContent = title
    document.getElementById('transfer-modal-desc').textContent = desc
    transferText.value = text || ''
    transferText.readOnly = mode === 'export'
    transferCopy.hidden = mode !== 'export'
    transferConfirm.hidden = mode !== 'import'
    transferResult.textContent = ''
    transferResult.classList.remove('is-error')
    updateDetect()
    openModal(transferModal)
  }
  const closeTransferModal = () => closeModal(transferModal)

  transferText.addEventListener('input', updateDetect)

  document.getElementById('transfer-close').addEventListener('click', closeTransferModal)
  document.getElementById('transfer-cancel').addEventListener('click', closeTransferModal)
  transferModal.addEventListener('click', (e) => {
    if (e.target === transferModal) closeTransferModal()
  })

  transferCopy.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(transferText.value)
      } else {
        transferText.select()
        document.execCommand('copy')
      }
      const old = transferCopy.textContent
      transferCopy.textContent = '已复制 ✓'
      setTimeout(() => { transferCopy.textContent = old }, 1500)
    } catch {
      transferResult.textContent = '复制失败，请手动全选复制'
      transferResult.classList.add('is-error')
    }
  })

  transferConfirm.addEventListener('click', async () => {
    let payload
    try {
      payload = JSON.parse(transferText.value)
    } catch {
      transferResult.textContent = '导入失败: 不是合法 JSON'
      transferResult.classList.add('is-error')
      return
    }
    if (!classifyConfig(payload)) {
      transferResult.textContent = '导入失败: 无法识别的配置格式（需要完整配置、单个平台或单个预设的 JSON）'
      transferResult.classList.add('is-error')
      return
    }
    try {
      const r = await api('/api/import', { method: 'POST', body: JSON.stringify(payload) })
      const skipped = r.errors && r.errors.length ? `；跳过 ${r.errors.length} 项: ${r.errors.join('; ')}` : ''
      const msg = `导入完成: ${r.platforms} 个平台、${r.presets} 个预设${skipped}`
      closeTransferModal()
      setTransferMsg(msg)
      await loadPlatforms()
      await loadPresets()
      await loadDashboard()
    } catch (err) {
      transferResult.textContent = `导入失败: ${err.message}`
      transferResult.classList.add('is-error')
    }
  })

  const transferMsg = document.getElementById('transfer-msg')
  const setTransferMsg = (text, isError) => {
    transferMsg.textContent = text
    transferMsg.classList.toggle('is-error', Boolean(isError))
  }

  document.getElementById('btn-export-all').addEventListener('click', async () => {
    try {
      const data = await api('/api/export')
      openTransferModal(
        'export',
        '导出完整配置',
        `共 ${data.platforms.length} 个平台、${data.presets.length} 个预设，复制以下 JSON 即可备份或分享`,
        JSON.stringify(data, null, 2)
      )
    } catch (e) {
      setTransferMsg(`导出失败: ${e.message}`, true)
    }
  })

  // 通用导入入口: 支持三种格式
  document.getElementById('btn-import').addEventListener('click', () => {
    openTransferModal('import', '导入配置', '支持完整配置、单个平台、单个预设的 JSON（可由任何「导出」按钮得到），粘贴后自动识别，点击「确认导入」', '', null)
  })
  // 预设区专用导入入口
  document.getElementById('btn-import-preset').addEventListener('click', () => {
    openTransferModal('import', '导入预设', '粘贴单个预设的 JSON（可由预设卡片的「导出」得到），点击「确认导入」', '', 'preset')
  })
  // 平台区专用导入入口
  document.getElementById('btn-import-platform').addEventListener('click', () => {
    openTransferModal('import', '导入平台', '粘贴单个平台的 JSON（可由「已配置平台」表格的「导出」得到），点击「确认导入」', '', 'platform')
  })

  /* ---------- 平台表格 ---------- */

  const tbody = document.getElementById('platform-table-body')
  const tplCount = document.getElementById('platform-count')

  const renderPlatforms = (list) => {
    tplCount.textContent = `CONFIGURED · ${list.length}`
    if (!list.length) {
      tbody.innerHTML = '<tr class="table__empty"><td colspan="3">尚未配置任何平台</td></tr>'
      return
    }
    tbody.innerHTML = list.map((p) => {
      const url = (p.request && p.request.url) || '—'
      return `
      <tr data-id="${escapeHtml(p.id)}">
        <td>${escapeHtml(p.name)}</td>
        <td class="table__url" title="${escapeHtml(url)}">${escapeHtml(url)}</td>
        <td>
          <button class="table__action" data-act="up" title="上移">↑</button>
          <button class="table__action" data-act="down" title="下移">↓</button>
          <button class="table__action" data-act="edit">编辑</button>
          <button class="table__action" data-act="export">导出</button>
          <button class="table__action" data-act="test">测试连接</button>
          <button class="table__action" data-act="fetch">获取余额</button>
          <button class="table__action table__action--danger" data-act="delete">删除</button>
          <span class="table__msg" data-msg></span>
        </td>
      </tr>
    `
    }).join('')
  }

  const loadPlatforms = async () => {
    try {
      platformsCache = await api('/api/platforms')
      renderPlatforms(platformsCache)
    } catch (e) {
      tbody.innerHTML = `<tr class="table__empty"><td colspan="3">加载失败: ${escapeHtml(e.message)}</td></tr>`
    }
  }

  const movePlatform = async (id, dir) => {
    const idx = platformsCache.findIndex((x) => x.id === id)
    const swap = idx + dir
    if (idx === -1 || swap < 0 || swap >= platformsCache.length) return
    const next = [...platformsCache]
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    platformsCache = next
    renderPlatforms(next)
    try {
      await api('/api/platforms/reorder', { method: 'PUT', body: JSON.stringify({ ids: next.map((p) => p.id) }) })
      await loadDashboard()
    } catch (err) {
      setMsg(`排序失败: ${err.message}`, true)
      await loadPlatforms()
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

    if (btn.dataset.act === 'up') {
      movePlatform(id, -1)
      return
    }
    if (btn.dataset.act === 'down') {
      movePlatform(id, 1)
      return
    }
    if (btn.dataset.act === 'edit') {
      const p = platformsCache.find((x) => x.id === id)
      if (p) {
        fillForm(p)
        setEditing(id, p.name)
        switchTab('config')
        // 编辑后自动滚动到表单, 不用手动上滑
        if (typeof form.scrollIntoView === 'function') {
          form.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }
      return
    }
    if (btn.dataset.act === 'export') {
      const p = platformsCache.find((x) => x.id === id)
      if (p) openTransferModal('export', `导出平台：${p.name}`, '复制以下 JSON 即可分享或备份', JSON.stringify(p, null, 2))
      return
    }

    try {
      if (btn.dataset.act === 'test') {
        msgEl.textContent = '测试中…'
        const r = await api(`/api/platforms/${id}/test`, { method: 'POST' })
        msgEl.textContent = r.ok ? `成功: ${fmt(r.value)}` : `失败: ${r.error}`
        if (!r.ok) msgEl.classList.add('is-error')
      } else if (btn.dataset.act === 'fetch') {
        msgEl.textContent = '获取中…'
        const r = await api(`/api/platforms/${id}/fetch`, { method: 'POST' })
        msgEl.textContent = r.ok ? `已获取: ${fmt(r.value)}` : `失败: ${r.error}`
        if (!r.ok) msgEl.classList.add('is-error')
        await loadDashboard()
      } else if (btn.dataset.act === 'delete') {
        if (!confirm(`确定删除平台「${row.firstElementChild.textContent}」？`)) return
        await api(`/api/platforms/${id}`, { method: 'DELETE' })
        await loadPlatforms()
        await loadDashboard()
      }
    } catch (err) {
      msgEl.textContent = err.message
      msgEl.classList.add('is-error')
    }
  })

  /* ---------- 余额折线图 ---------- */

  const chartModal = document.getElementById('chart-modal')
  const chartCanvas = document.getElementById('chart-canvas')
  const chartPreview = document.getElementById('chart-preview')
  const chartStats = document.getElementById('chart-stats')
  let chartPlatformId = null
  let chartPlatformName = ''
  let chartPoints = []
  // 预览条窗口边界(全量时间轴上的 ms 时间戳), 打开弹窗时默认全选
  let chartWinStart = 0
  let chartWinEnd = 0
  // 主图 hover: 十字线所在 x(css 像素), null = 不显示
  let chartHoverX = null
  // 主图按住平移拖拽状态: { startX, winStart0, winW, rectLeft } 或 null
  let chartPanDrag = null

  const closeChart = () => {
    // 关闭时清理主图 hover/拖拽态, 避免下次打开残留十字线
    chartHoverX = null
    chartPanDrag = null
    closeModal(chartModal)
  }
  document.getElementById('chart-close').addEventListener('click', closeChart)
  document.getElementById('chart-cancel').addEventListener('click', closeChart)
  chartModal.addEventListener('click', (e) => {
    if (e.target === chartModal) closeChart()
  })
  /* ---------- 预览条: 全量时间缩略图 + 窗口选择 ---------- */

  // 全量时间轴几何映射(像素 <-> ms), 供预览绘制与拖拽共用
  const previewGeo = () => {
    if (!chartPoints.length) return null
    const cssW = chartPreview.clientWidth || 600
    const times = chartPoints.map((p) => new Date(p.t).getTime())
    const t0 = Math.min(...times)
    const t1 = Math.max(...times)
    const padX = 6
    const innerW = Math.max(1, cssW - padX * 2)
    const span = Math.max(1, t1 - t0)
    return {
      t0,
      t1,
      span,
      xOfTs: (ts) => padX + ((ts - t0) / span) * innerW,
      tsOfX: (px) => t0 + ((Math.min(Math.max(px, padX), cssW - padX) - padX) / innerW) * span,
    }
  }

  // 最小窗口宽度: 2 个采样点间隔 与 总宽 2% 取较小约束
  const minWindowMs = (geo) => {
    const n = chartPoints.length
    const twoPts = n > 1 ? geo.span / (n - 1) : geo.span
    return Math.min(twoPts, geo.span * 0.02)
  }

  // 主图取数改为按窗口区间筛选: 取 t>=start 的最小索引 到 t<=end 的最大索引(宁多勿截断)
  const filterPoints = (points) => {
    if (!points.length) return points
    const times = points.map((p) => new Date(p.t).getTime())
    let lo = -1
    for (let i = 0; i < times.length; i++) {
      if (times[i] >= chartWinStart) { lo = i; break }
    }
    let hi = -1
    for (let i = times.length - 1; i >= 0; i--) {
      if (times[i] <= chartWinEnd) { hi = i; break }
    }
    if (lo === -1 || hi === -1 || hi < lo) return []
    return points.slice(lo, hi + 1)
  }

  // 预览条拖拽状态: { mode: 'l'|'r'|'pan', lastTs, minWin }
  let previewDrag = null
  let previewHover = ''
  let previewRaf = 0

  // 拖动过程 rAF 节流重绘(drawChart 内部会同步刷新预览条)
  const scheduleRenderCharts = () => {
    if (previewRaf) return
    previewRaf = requestAnimationFrame(() => {
      previewRaf = 0
      drawChart()
    })
  }

  const applyPreviewDrag = (px, geo) => {
    const ts = geo.tsOfX(px)
    const winW = chartWinEnd - chartWinStart
    if (previewDrag.mode === 'pan') {
      if (previewDrag.lastTs == null) {
        previewDrag.lastTs = ts
        return
      }
      let s = chartWinStart + (ts - previewDrag.lastTs)
      previewDrag.lastTs = ts
      if (s < geo.t0) s = geo.t0
      if (s + winW > geo.t1) s = geo.t1 - winW
      chartWinStart = s
      chartWinEnd = s + winW
    } else if (previewDrag.mode === 'l') {
      chartWinStart = Math.min(Math.max(ts, geo.t0), chartWinEnd - previewDrag.minWin)
    } else {
      chartWinEnd = Math.max(Math.min(ts, geo.t1), chartWinStart + previewDrag.minWin)
    }
  }

  // 命中判定: 左右边缘(容差内) -> 边缘拖拽; 窗口内部 -> 整体平移
  const previewHitMode = (px, geo) => {
    const xs = geo.xOfTs(chartWinStart)
    const xe = geo.xOfTs(chartWinEnd)
    const tol = 7
    if (Math.abs(px - xs) <= tol && Math.abs(px - xe) <= tol) {
      return px > (xs + xe) / 2 ? 'r' : 'l'
    }
    if (Math.abs(px - xs) <= tol) return 'l'
    if (Math.abs(px - xe) <= tol) return 'r'
    if (px > xs && px < xe) return 'pan'
    return ''
  }

  // 通用拖拽: document 上挂一次 pointermove/pointerup/pointercancel, 松开自动解绑(预览条与主图平移共用)
  // 统一 Pointer Events 后鼠标/触摸/笔共用一套逻辑; pointerId 过滤多指干扰
  const beginDocDrag = (onMove, onUp, pointerId = null) => {
    const move = (ev) => { ev.preventDefault?.(); if (pointerId != null && ev.pointerId !== pointerId) return; onMove(ev) }
    const up = (ev) => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', up)
      onUp(ev)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', up)
  }

  // 起拖统一 Pointer Events(pointerdown), 触屏与鼠标共用; preventDefault 阻止触摸滚动
  chartPreview.addEventListener('pointerdown', (e) => {
    if (e.isPrimary === false) return
    const geo = previewGeo()
    if (!geo || chartPoints.length < 2) return
    const px = e.clientX - chartPreview.getBoundingClientRect().left
    const mode = previewHitMode(px, geo)
    if (!mode) return
    e.preventDefault()
    previewDrag = { mode, lastTs: null, minWin: minWindowMs(geo) }

    beginDocDrag(
      (ev) => {
        if (!previewDrag) return
        applyPreviewDrag(ev.clientX - chartPreview.getBoundingClientRect().left, geo)
        scheduleRenderCharts()
      },
      () => {
        previewDrag = null
        drawChart()
      },
      e.pointerId
    )
  })

  // hover 反馈: 光标形态 + 手柄变色(存 hover 态, 重绘预览时使用)
  chartPreview.addEventListener('mousemove', (e) => {
    if (previewDrag) return
    const geo = previewGeo()
    if (!geo) return
    const px = e.clientX - chartPreview.getBoundingClientRect().left
    const hit = previewHitMode(px, geo)
    if (hit !== previewHover) {
      previewHover = hit
      drawChartPreview()
    }
  })

  chartPreview.addEventListener('mouseleave', () => {
    if (!previewDrag && previewHover) {
      previewHover = ''
      drawChartPreview()
    }
  })

  // 主图最近一次渲染的几何视图(pts/times/pad/x/y 映射), hover 命中与拖拽判定共用
  let chartView = null

  function drawChart(syncPreview = true) {
    // 预览条与主图始终同步重绘(仅 hover 十字线刷新时传 false 跳过)
    if (syncPreview) drawChartPreview()
    const ctx = chartCanvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const cssW = chartCanvas.clientWidth || 600
    const cssH = chartCanvas.clientHeight || 320
    chartCanvas.width = cssW * dpr
    chartCanvas.height = cssH * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const pts = filterPoints(chartPoints)
    const pad = { l: 64, r: 24, t: 30, b: 46 }
    const w = cssW - pad.l - pad.r
    const h = cssH - pad.t - pad.b

    // 空态
    if (!pts.length) {
      chartView = null
      ctx.fillStyle = '#888'
      ctx.font = '13px "Helvetica Neue", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(chartPoints.length ? '当前窗口内无采样点' : '暂无余额历史数据（获取余额后自动记录采样点）', cssW / 2, cssH / 2)
      chartStats.textContent = '暂无数据'
      return
    }

    const values = pts.map((p) => p.v)
    const times = pts.map((p) => new Date(p.t).getTime())
    let min = Math.min(...values)
    let max = Math.max(...values)
    if (min === max) { const span = Math.abs(min) * 0.1 || 1; min -= span; max += span }
    // 留白
    const padScale = (max - min) * 0.1 || 1
    min -= padScale
    max += padScale

    const x = (i) => pad.l + (times.length === 1 ? w / 2 : (i / (times.length - 1)) * w)
    const y = (v) => pad.t + h - ((v - min) / (max - min)) * h

    // 缓存视图几何: hover 十字线命中与主图平移换算共用同一映射
    chartView = {
      pts, times, pad, w, h,
      x,
      y,
      inPlotX: (px) => px >= pad.l && px <= pad.l + w,
      nearestIdx: (px) => times.length === 1
        ? 0
        : Math.max(0, Math.min(times.length - 1, Math.round(((px - pad.l) / w) * (times.length - 1)))),
    }

    // Y 轴刻度值格式统一: 按刻度步长取小数位, 保证 5 个刻度等宽对齐
    const tickCount = 5
    const tickStep = (max - min) / tickCount
    const decimals = tickStep >= 1 ? 0 : tickStep >= 0.1 ? 1 : 2
    const fmtTick = (v) => v.toFixed(decimals)

    // 网格线(#e8e8e8 可见不喧宾) + Y 轴短刻度线 + 右对齐刻度标签
    ctx.font = '12px "Helvetica Neue", sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let i = 0; i <= tickCount; i++) {
      const tv = max - ((max - min) / tickCount) * i
      const ty = Math.round(pad.t + (h / tickCount) * i) + 0.5
      ctx.strokeStyle = '#e8e8e8'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(pad.l, ty)
      ctx.lineTo(pad.l + w, ty)
      ctx.stroke()
      // Y 轴短刻度线
      ctx.strokeStyle = '#b3b3b3'
      ctx.beginPath()
      ctx.moveTo(pad.l - 6, ty)
      ctx.lineTo(pad.l, ty)
      ctx.stroke()
      ctx.fillStyle = '#888'
      ctx.fillText(fmtTick(tv), pad.l - 10, ty)
    }

    // 坐标轴基线(左/下细灰线, Swiss 结构感)
    ctx.strokeStyle = '#d9d9d9'
    ctx.beginPath()
    ctx.moveTo(Math.round(pad.l) + 0.5, pad.t)
    ctx.lineTo(Math.round(pad.l) + 0.5, pad.t + h)
    ctx.lineTo(pad.l + w, pad.t + h)
    ctx.stroke()

    // X 轴时间刻度: 按最小像素间距自适应刻度数, 标签不重叠; 两端锚定防裁切
    let xTickCount = Math.min(6, times.length)
    while (xTickCount > 2 && w / (xTickCount - 1) < 90) xTickCount--
    ctx.font = '12px "Helvetica Neue", sans-serif'
    ctx.fillStyle = '#888'
    ctx.textBaseline = 'top'
    for (let i = 0; i < xTickCount; i++) {
      const idx = xTickCount === 1 ? 0 : Math.round((i / (xTickCount - 1)) * (times.length - 1))
      const tx = x(idx)
      const label = new Date(times[idx]).toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      })
      // 刻度小竖线
      ctx.strokeStyle = '#b3b3b3'
      ctx.beginPath()
      ctx.moveTo(Math.round(tx) + 0.5, pad.t + h)
      ctx.lineTo(Math.round(tx) + 0.5, pad.t + h + 4)
      ctx.stroke()
      ctx.textAlign = i === 0 ? 'left' : i === xTickCount - 1 ? 'right' : 'center'
      const lx = i === 0 ? pad.l : i === xTickCount - 1 ? pad.l + w : tx
      ctx.fillText(label, lx, pad.t + h + 10)
    }

    // 面积填充(先画, 克制的淡红渐变, 不压数据线)
    const gradient = ctx.createLinearGradient(0, pad.t, 0, pad.t + h)
    gradient.addColorStop(0, 'rgba(228, 0, 43, 0.11)')
    gradient.addColorStop(1, 'rgba(228, 0, 43, 0)')
    ctx.beginPath()
    pts.forEach((p, i) => {
      const px = x(i)
      const py = y(p.v)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.lineTo(x(pts.length - 1), pad.t + h)
    ctx.lineTo(x(0), pad.t + h)
    ctx.closePath()
    ctx.fillStyle = gradient
    ctx.fill()

    // 折线
    ctx.strokeStyle = '#e4002b'
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    pts.forEach((p, i) => {
      const px = x(i)
      const py = y(p.v)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.stroke()

    // 数据点: 白描边圆点与线条分离; 按相邻点 X 像素间距 dx 连续自适应——
    // 越密集点半径与白描边越向 0 收敛(白描边先消失), dx <= DENSE_DX 只画折线不画点,
    // 避免密集白描边连成一片盖住红色折线(红线始终清晰)
    const dx = pts.length > 1 ? w / (pts.length - 1) : Infinity
    const DENSE_DX = 5   // 密集阈值: 相邻点间距 <= 5px 时不画点
    const SPARSE_DX = 10 // 稀疏阈值: 间距 >= 10px 时满尺寸点(5px + 2px 白描边)
    const densityT = Math.min(1, Math.max(0, (dx - DENSE_DX) / (SPARSE_DX - DENSE_DX)))
    const dotR = 5 * densityT
    const strokeW = 2 * densityT
    chartView.dotR = dotR
    if (dotR >= 1) {
      ctx.fillStyle = '#e4002b'
      if (strokeW > 0) {
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = strokeW
      }
      pts.forEach((p, i) => {
        ctx.beginPath()
        ctx.arc(x(i), y(p.v), dotR, 0, Math.PI * 2)
        ctx.fill()
        if (strokeW > 0) ctx.stroke()
      })
    }

    // 首/末值标注: 白底小块 + 2px 白描边(外扩压住折线/网格), 数字加粗清晰
    const labelAt = (idx, align) => {
      const p = pts[idx]
      const vx = x(idx)
      const vy = y(p.v)
      const text = fmt(p.v)
      ctx.font = 'bold 12px "Helvetica Neue", sans-serif'
      const tw = ctx.measureText(text).width
      const bw = Math.ceil(tw) + 12
      const bh = 18
      let bx = align === 'left' ? vx - 6 : vx - bw + 6
      bx = Math.max(pad.l, Math.min(bx, pad.l + w - bw))
      const above = vy - bh - 10 >= pad.t
      const by = above ? vy - bh - 10 : vy + 8
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.fillRect(bx, by, bw, bh)
      ctx.strokeRect(bx, by, bw, bh)
      ctx.fillStyle = '#111'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, bx + 6, by + bh / 2 + 0.5)
    }
    if (pts.length > 1) {
      labelAt(0, 'left')
      labelAt(pts.length - 1, 'right')
    }

    // hover 十字线 + tooltip 覆盖层(最后绘制, 盖在标注之上)
    drawChartHover(ctx)

    // 统计摘要
    const first = pts[0].v
    const lastV = pts[pts.length - 1].v
    const diff = lastV - first
    const diffPct = first !== 0 ? (diff / Math.abs(first)) * 100 : 0
    const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→'
    chartStats.textContent = `${pts.length} 个采样点 · ${arrow} ${diff >= 0 ? '+' : ''}${fmt(diff)} (${diffPct >= 0 ? '+' : ''}${fmt(diffPct)}%)`
  }

  // 主图 hover 覆盖层: 垂直十字线(浅灰虚线) + 当前点加重 + 白底 tooltip(值/时间)
  function drawChartHover(ctx) {
    const view = chartView
    if (!view || chartHoverX == null || !view.inPlotX(chartHoverX)) return
    const { pad, w, h } = view
    const idx = view.nearestIdx(chartHoverX)
    const p = view.pts[idx]
    const vx = view.x(idx)
    const vy = view.y(p.v)

    // 十字竖线: 浅灰细虚线, 只贯穿绘图区
    ctx.save()
    ctx.strokeStyle = '#c9c9c9'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(Math.round(vx) + 0.5, pad.t)
    ctx.lineTo(Math.round(vx) + 0.5, pad.t + h)
    ctx.stroke()
    ctx.restore()

    // 当前点加重高亮(白描边更宽, 与普通点区分)
    ctx.fillStyle = '#e4002b'
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(vx, vy, (view.dotR || 3) + 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // tooltip: 值(bold) + 时间(MM/DD HH:mm) 两行白底块, 超出绘图区自动收回
    const valText = fmt(p.v)
    const timeText = new Date(new Date(p.t).getTime()).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
    ctx.font = 'bold 12px "Helvetica Neue", sans-serif'
    const valW = ctx.measureText(valText).width
    ctx.font = '11px "Helvetica Neue", sans-serif'
    const timeW = ctx.measureText(timeText).width
    const bw = Math.ceil(Math.max(valW, timeW)) + 16
    const bh = 36
    let bx = vx - bw / 2
    bx = Math.max(pad.l, Math.min(bx, pad.l + w - bw))
    let by = vy - bh - 10
    if (by < pad.t) {
      by = vy + 10
      if (by + bh > pad.t + h) by = Math.max(pad.t, pad.t + h - bh)
    }
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.fillRect(bx, by, bw, bh)
    ctx.strokeRect(bx, by, bw, bh)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#111111'
    ctx.font = 'bold 12px "Helvetica Neue", sans-serif'
    ctx.fillText(valText, bx + 8, by + 12)
    ctx.fillStyle = '#888888'
    ctx.font = '11px "Helvetica Neue", sans-serif'
    ctx.fillText(timeText, bx + 8, by + 26)
  }

  // 主图 hover: 未按下移动 = 十字线跟随; 仅绘图区触发, 空态无数据不显示
  chartCanvas.addEventListener('mousemove', (e) => {
    if (chartPanDrag) return
    const view = chartView
    const px = e.clientX - chartCanvas.getBoundingClientRect().left
    const inside = Boolean(view && view.inPlotX(px))
    const nextX = inside ? px : null
    if (nextX !== chartHoverX) {
      chartHoverX = nextX
      drawChart(false)
    }
    chartCanvas.style.cursor = inside ? 'crosshair' : 'default'
  })

  chartCanvas.addEventListener('mouseleave', () => {
    if (chartPanDrag) return
    if (chartHoverX != null) {
      chartHoverX = null
      drawChart(false)
    }
    chartCanvas.style.cursor = 'default'
  })

  // 触摸拖动判定阈值(px): 位移未超过视为"查看信息"(十字线跟随), 超过转为平移
  const TOUCH_PAN_THRESHOLD = 6

  // 主图按住平移(鼠标) / 触摸查看+平移(触摸): 统一 Pointer Events
  // 鼠标按下即平移(保持原行为); 触摸先显示该点十字线/tooltip, 拖动超阈值后隐藏十字线转平移
  chartCanvas.addEventListener('pointerdown', (e) => {
    const view = chartView
    if (!view || e.isPrimary === false || chartPoints.length < 2) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const rect = chartCanvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    // 只在绘图区内起拖; 单击不动不产生平移(delta=0 直接跳过重绘)
    if (!view.inPlotX(px) || py < view.pad.t || py > view.pad.t + view.h) return
    const geo = previewGeo()
    if (!geo) return
    e.preventDefault()
    const winW0 = chartWinEnd - chartWinStart
    const isMouse = e.pointerType === 'mouse'
    chartPanDrag = {
      startX: px,
      clientX0: e.clientX,
      winStart0: chartWinStart,
      winW: winW0,
      rectLeft: rect.left,
      panning: isMouse,
    }
    // 鼠标拖动不显示十字线; 触摸按下立即给出该点的十字线+tooltip 反馈
    chartHoverX = isMouse ? null : px
    if (!isMouse) drawChart(false)
    chartCanvas.style.cursor = isMouse ? 'grabbing' : 'crosshair'

    beginDocDrag(
      (ev) => {
        if (!chartPanDrag) return
        const dx = ev.clientX - chartPanDrag.clientX0
        if (!chartPanDrag.panning) {
          // 触摸未超阈值: 十字线跟随手指(等效 hover), 不平移
          const hpx = ev.clientX - chartPanDrag.rectLeft
          const nextX = view.inPlotX(hpx) ? hpx : null
          if (nextX !== chartHoverX) {
            chartHoverX = nextX
            drawChart(false)
          }
          if (Math.hypot(dx, ev.clientY - py) < TOUCH_PAN_THRESHOLD) return
          chartPanDrag.panning = true
          chartHoverX = null
          chartCanvas.style.cursor = 'grabbing'
        }
        let s = chartPanDrag.winStart0 + dx * (chartPanDrag.winW / view.w)
        if (s < geo.t0) s = geo.t0
        if (s + chartPanDrag.winW > geo.t1) s = geo.t1 - chartPanDrag.winW
        if (s !== chartWinStart) {
          chartWinStart = s
          chartWinEnd = s + chartPanDrag.winW
          scheduleRenderCharts()
        }
      },
      () => {
        chartPanDrag = null
        chartHoverX = null
        chartCanvas.style.cursor = 'default'
        drawChart()
      },
      e.pointerId
    )
  })

  // 预览条: 全量历史迷你折线 + 窗口遮罩(未选中灰化 / 选中高亮+边缘手柄)
  function drawChartPreview() {
    const ctx = chartPreview.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const cssW = chartPreview.clientWidth || 600
    const cssH = chartPreview.clientHeight || 52
    chartPreview.width = cssW * dpr
    chartPreview.height = cssH * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const geo = previewGeo()
    if (!geo) {
      ctx.fillStyle = '#888'
      ctx.font = '12px "Helvetica Neue", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('暂无数据', cssW / 2, cssH / 2)
      return
    }

    // 全量迷你折线(红线, 无网格无刻度); 灰化段复用同一路径重描
    const times = chartPoints.map((p) => new Date(p.t).getTime())
    const values = chartPoints.map((p) => p.v)
    let vmin = Math.min(...values)
    let vmax = Math.max(...values)
    if (vmin === vmax) { const s = Math.abs(vmin) * 0.1 || 1; vmin -= s; vmax += s }
    const padY = 8
    const yOfV = (v) => padY + (cssH - padY * 2) * (1 - (v - vmin) / (vmax - vmin))
    const strokeAll = (color, width) => {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      chartPoints.forEach((p, i) => {
        const px = geo.xOfTs(times[i])
        const py = yOfV(p.v)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
      ctx.stroke()
    }

    const xs = geo.xOfTs(chartWinStart)
    const xe = geo.xOfTs(chartWinEnd)

    // 未选中区域灰化: 半透明灰遮罩 + 该段折线重描为灰(仍可见不消失); 选中段保持鲜红
    const hasLeft = xs > 0
    const hasRight = xe < cssW
    ctx.fillStyle = 'rgba(17, 17, 17, 0.28)'
    if (hasLeft) ctx.fillRect(0, 0, xs, cssH)
    if (hasRight) ctx.fillRect(xe, 0, cssW - xe, cssH)
    if (hasLeft || hasRight) {
      ctx.save()
      ctx.beginPath()
      if (hasLeft) ctx.rect(0, 0, xs, cssH)
      if (hasRight) ctx.rect(xe, 0, cssW - xe, cssH)
      ctx.clip()
      strokeAll('rgba(138, 138, 138, 0.95)', 1.5)
      ctx.restore()
    }
    ctx.save()
    ctx.beginPath()
    ctx.rect(xs, 0, Math.max(0, xe - xs), cssH)
    ctx.clip()
    strokeAll('#e4002b', 1.5)
    ctx.restore()

    // 选中窗口高亮: 细黑描边框
    ctx.strokeStyle = '#111111'
    ctx.lineWidth = 1
    ctx.strokeRect(xs + 0.5, 0.5, Math.max(1, xe - xs - 1), cssH - 1)

    // 左右拖动手柄条(4~6px), hover 变红提示可拖
    const hw = 5
    ctx.fillStyle = previewHover === 'l' || previewDrag?.mode === 'l' ? '#e4002b' : '#111111'
    ctx.fillRect(xs, 0, hw, cssH)
    ctx.fillStyle = previewHover === 'r' || previewDrag?.mode === 'r' ? '#e4002b' : '#111111'
    ctx.fillRect(xe - hw, 0, hw, cssH)

    // 光标跟随命中区域
    if (!previewDrag) {
      chartPreview.style.cursor = previewHover === 'l' || previewHover === 'r'
        ? 'col-resize'
        : previewHover === 'pan' ? 'grab' : 'default'
    } else {
      chartPreview.style.cursor = previewDrag.mode === 'pan' ? 'grabbing' : 'col-resize'
    }
  }

  const openChart = async (id, name) => {
    chartPlatformId = id
    chartPlatformName = name
    document.getElementById('chart-modal-title').textContent = `余额变化趋势 — ${name}`
    chartStats.textContent = '加载中…'
    openModal(chartModal)
    try {
      const data = await api(`/api/platforms/${id}/history`)
      // 按时间升序排序后重置预览窗口为全选
      chartPoints = ((data && data.points) || [])
        .slice()
        .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
      const times = chartPoints.map((p) => new Date(p.t).getTime())
      chartWinStart = times.length ? Math.min(...times) : 0
      chartWinEnd = times.length ? Math.max(...times) : 0
      // 弹窗可见后 canvas 才有尺寸, 重绘一次
      requestAnimationFrame(() => drawChart())
    } catch (e) {
      chartPoints = []
      chartWinStart = 0
      chartWinEnd = 0
      chartStats.textContent = `加载失败: ${e.message}`
      drawChart()
    }
  }

  const refreshPlatform = async (id, name) => {
    const btn = grid.querySelector(`.card__refresh[data-id="${CSS.escape(id)}"]`)
    if (btn) {
      btn.disabled = true
      btn.textContent = '…'
    }
    try {
      await api(`/api/platforms/${id}/fetch`, { method: 'POST' })
      await loadDashboard()
    } catch (e) {
      lastUpdate.textContent = `LAST UPDATE — 刷新失败: ${e.message}`
      if (btn) {
        btn.disabled = false
        btn.textContent = '↻'
      }
    }
  }

  // 事件委托: 卡片上的折线图 / 独立刷新按钮
  grid.addEventListener('click', (e) => {
    const refreshBtn = e.target.closest('.card__refresh')
    if (refreshBtn) {
      refreshPlatform(refreshBtn.dataset.id, refreshBtn.dataset.name)
      return
    }
    const btn = e.target.closest('.card__chart')
    if (!btn) return
    openChart(btn.dataset.id, btn.dataset.name)
  })

  /* ---------- 操作日志 ---------- */

  const logList = document.getElementById('log-list')
  const logCount = document.getElementById('log-count')

  const ACTION_LABEL = {
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

  const renderLogs = (data) => {
    const logs = (data && data.logs) || []
    const total = data && data.total != null ? data.total : logs.length
    logCount.textContent = `LOGS · ${total}`
    if (!logs.length) {
      logList.innerHTML = '<div class="log-empty">暂无操作日志</div>'
      return
    }
    logList.innerHTML = logs.map((l) => {
      const detail = escapeHtml(l.detail || '')
      const platform = l.platformName ? ` · <span class="log__platform">${escapeHtml(l.platformName)}</span>` : ''
      const meta = l.meta && typeof l.meta === 'object' && Object.keys(l.meta).length
        ? `<span class="log__meta">${escapeHtml(JSON.stringify(l.meta))}</span>`
        : ''
      return `
        <div class="log-item">
          <span class="log__time">${escapeHtml(new Date(l.time).toLocaleString('zh-CN'))}</span>
          <span class="log__action log__action--${escapeHtml(l.action)}">${escapeHtml(ACTION_LABEL[l.action] || l.action)}</span>
          <span class="log__detail">${detail}${platform}</span>
          ${meta}
        </div>`
    }).join('')
  }

  async function loadLogs() {
    try {
      renderLogs(await api('/api/logs?limit=500'))
    } catch (e) {
      logList.innerHTML = `<div class="log-empty">加载失败: ${escapeHtml(e.message)}</div>`
    }
  }

  document.getElementById('btn-refresh-logs').addEventListener('click', loadLogs)

  document.getElementById('btn-clear-logs').addEventListener('click', async () => {
    if (!confirm('确定清空所有操作日志？此操作不可撤销。')) return
    try {
      await api('/api/logs', { method: 'DELETE' })
      await loadLogs()
    } catch (e) {
      alert(`清空失败: ${e.message}`)
    }
  })

  /* ---------- 自动采集设置 ---------- */

  const collectInput = document.getElementById('collect-interval')
  const collectMsg = document.getElementById('collect-msg')
  const monitorStatus = document.getElementById('monitor-status')

  const setMsg2 = (el, text, isError) => {
    el.textContent = text
    el.classList.toggle('is-error', Boolean(isError))
  }

  const applySettingsUi = (settings) => {
    const sec = settings && Number(settings.collectIntervalSeconds) >= 0 ? Number(settings.collectIntervalSeconds) : 0
    collectInput.value = sec
    if (monitorStatus) {
      monitorStatus.textContent = sec > 0
        ? `自动采集 · 每 ${sec} 秒`
        : '自动采集 · 关闭'
    }
  }

  const loadSettings = async () => {
    try {
      applySettingsUi(await api('/api/settings'))
    } catch (e) {
      applySettingsUi({ collectIntervalSeconds: 0 })
    }
  }

  const saveCollect = async (inputEl, msgEl) => {
    const raw = Number(inputEl.value)
    const sec = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : null
    if (sec === null) {
      setMsg2(msgEl, '请输入大于等于 0 的整数', true)
      return
    }
    if (sec > 86400) {
      setMsg2(msgEl, '间隔不能超过 86400 秒（1 天）', true)
      return
    }
    setMsg2(msgEl, '保存中…')
    try {
      const next = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ collectIntervalSeconds: sec }) })
      applySettingsUi(next)
      setMsg2(msgEl, sec === 0 ? '已关闭自动采集' : `已设置每 ${sec} 秒采集一次`)
    } catch (e) {
      setMsg2(msgEl, `保存失败: ${e.message}`, true)
    }
  }

  document.getElementById('btn-save-collect').addEventListener('click', () => saveCollect(collectInput, collectMsg))

  loadPresets()
  loadPlatforms()
  loadDashboard()
  loadSettings()
})
