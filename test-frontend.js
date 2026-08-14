const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')

const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
const appJs = fs.readFileSync(path.join(__dirname, 'public', 'js', 'app.js'), 'utf8')

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost:3000' })
const { window } = dom

window.fetch = async (url, opts) => {
  if (url === '/api/presets') {
    return new Response(JSON.stringify([
      { id: 'newapi', name: 'NEWAPI', builtin: true, fields: [{ key: 'baseUrl', label: '请求地址', placeholder: 'x' }], method: 'GET', urlTemplate: '{{baseUrl}}/api/user/self', headersTemplate: {}, extractorTemplate: 'function (data) { return 1 }' },
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return new Response(JSON.stringify({ platforms: [], updatedAt: null }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

window.confirm = () => true

window.CodeMirror = {
  fromTextArea: (ta, opts) => ({
    setValue: (v) => { ta._value = v },
    getValue: () => ta._value || ta.value || '',
  }),
}

window.eval(appJs)
dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  await wait(200)
  const doc = window.document

  const card = doc.querySelector('.quick-card')
  console.log('预设卡片渲染:', card ? `OK (${card.querySelector('.quick-card__name').textContent})` : 'FAIL 未渲染')

  const presetModal = doc.getElementById('preset-modal')
  console.log('点击前 preset-modal 是否打开:', presetModal.classList.contains('is-open'))

  doc.getElementById('btn-add-preset').click()
  await wait(50)
  console.log('点击添加预设后是否打开:', presetModal.classList.contains('is-open'), '| 标题:', doc.getElementById('preset-modal-title').textContent)

  doc.getElementById('use-cancel').click()
  card.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await wait(50)
  const useModal = doc.getElementById('use-modal')
  console.log('点击预设卡片后 use-modal 是否打开:', useModal.classList.contains('is-open'), '| 标题:', doc.getElementById('use-modal-title').textContent)

  const errors = []
  window.addEventListener('error', (e) => errors.push(e.message))
  await wait(50)
  console.log('运行时错误:', errors.length ? errors.join('; ') : '无')
})().catch((e) => { console.error('测试崩溃:', e); process.exit(1) })
