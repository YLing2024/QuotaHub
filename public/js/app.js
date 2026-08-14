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
          return `
          <article class="card ${p.balance == null ? 'card--empty' : ''} ${p.error ? 'card--error' : ''}">
            <div class="card__top">
              <span class="card__platform">${escapeHtml(p.name)}</span>
              <span class="card__tag ${p.error ? 'tag--warn' : ''}">${p.error ? '获取失败' : p.balance == null ? '待获取' : '已获取'}</span>
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
      // 编辑已保存平台时, 表单里是掩码值(********): 后端会用保存的真实值回填再发请求
      if (editingId) payload.maskedFrom = editingId
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

  loadPresets()
  loadPlatforms()
  loadDashboard()
})
