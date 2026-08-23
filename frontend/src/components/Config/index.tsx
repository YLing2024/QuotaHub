// 平台配置页: 快速配置(预设系统) + 添加平台表单(CodeMirror) + 导入/导出 + 已配置平台表格
// 语义与旧 app.js 平台配置 tab 一致

import { useEffect, useRef, useState } from 'react'
import type { HttpMethod, Platform, Preset } from '@/types'
import {
  createPlatform,
  deletePlatform,
  deletePreset,
  exportConfig,
  fetchPlatformBalance,
  reorderPlatforms,
  resetPreset,
  testPlatform,
  updatePlatform,
  validatePlatformConfig,
} from '@/api/endpoints'
import { useStore } from '@/store/useStore'
import { DEFAULT_HANDLER, fmt, formatValue, resolveHandler } from '@/lib/format'
import CodeEditor from './CodeEditor'
import UsePresetModal, { type PresetFill } from './UsePresetModal'
import EditPresetModal from './EditPresetModal'
import TransferModal, { type TransferRequest } from '@/components/Transfer/TransferModal'

const DEFAULT_HEADERS = '{\n  "Authorization": "Bearer 你的密钥"\n}'

interface FormState {
  name: string
  homepage: string
  method: HttpMethod
  bodyText: string
  url: string
  headersText: string
  handlerText: string
  prefix: string
  suffix: string
}

const EMPTY_FORM: FormState = {
  name: '',
  homepage: '',
  method: 'GET',
  bodyText: '',
  url: '',
  headersText: DEFAULT_HEADERS,
  handlerText: DEFAULT_HANDLER,
  prefix: '',
  suffix: '',
}

function fillFormState(p: Platform): FormState {
  // display 兼容回退: 旧配置 response.prefix/suffix
  const d = p.display ?? (p.response ? { prefix: p.response.prefix || '', suffix: p.response.suffix || '' } : undefined)
  return {
    name: p.name || '',
    homepage: p.url || '',
    method: p.request?.method || 'GET',
    url: p.request?.url || '',
    headersText: JSON.stringify(p.request?.headers || {}, null, 2),
    bodyText:
      p.request?.body != null && (typeof p.request.body !== 'object' || Object.keys(p.request.body).length > 0)
        ? JSON.stringify(p.request.body)
        : '',
    handlerText: resolveHandler(p),
    prefix: d?.prefix || '',
    suffix: d?.suffix || '',
  }
}

export default function ConfigTab() {
  const platforms = useStore((s) => s.platforms)
  const presets = useStore((s) => s.presets)
  const loadPlatforms = useStore((s) => s.loadPlatforms)
  const setPlatforms = useStore((s) => s.setPlatforms)
  const loadPresets = useStore((s) => s.loadPresets)
  const loadDashboard = useStore((s) => s.loadDashboard)

  // ---- 表单状态 ----
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formMsg, setFormMsg] = useState<{ text: string; error?: boolean }>({ text: '' })
  const notify = (text: string, isError?: boolean) => setFormMsg({ text, error: isError })
  const [validating, setValidating] = useState(false)
  const [verifyText, setVerifyText] = useState('')

  const urlInputRef = useRef<HTMLInputElement>(null)
  const formRef2 = useRef<HTMLFormElement>(null)

  const patchForm = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }))

  const clearForm = () => {
    setForm({ ...EMPTY_FORM })
    setEditingId(null)
  }

  const readPayload = (f: FormState) => {
    let headers: Record<string, string>
    try {
      headers = JSON.parse(f.headersText || '{}')
    } catch {
      throw new Error('请求头必须是合法 JSON')
    }
    const bodyText = f.bodyText.trim()
    let body: unknown
    if (bodyText) {
      try {
        body = JSON.parse(bodyText)
      } catch {
        throw new Error('请求体必须是合法 JSON')
      }
    }
    return {
      name: f.name,
      url: f.homepage.trim(),
      request: { method: f.method, url: f.url, headers, body },
      handler: f.handlerText,
      display: { prefix: f.prefix.trim(), suffix: f.suffix.trim() },
    }
  }

  // ---- 保存 / 取消编辑 / 验证 ----

  const save = async () => {
    notify('')
    let payload: ReturnType<typeof readPayload>
    try {
      payload = readPayload(form)
    } catch (err) {
      notify((err as Error).message, true)
      return
    }
    try {
      const saved = editingId ? await updatePlatform(editingId, payload) : await createPlatform(payload)
      notify(`${editingId ? '已更新' : '已保存'}: ${saved.name}`)
      clearForm()
      await loadPlatforms()
      await loadDashboard()
    } catch (err) {
      notify(`保存失败: ${(err as Error).message}`, true)
    }
  }

  const cancelEdit = () => {
    clearForm()
    notify('')
  }

  const validate = async () => {
    notify('验证中…')
    setVerifyText('验证中…')
    setValidating(true)
    let payload: ReturnType<typeof readPayload>
    try {
      payload = readPayload(form)
    } catch (err) {
      notify((err as Error).message, true)
      setVerifyText(`配置错误：${(err as Error).message}`)
      setValidating(false)
      return
    }
    try {
      const r = await validatePlatformConfig(payload)
      if (r.ok) {
        setVerifyText(formatValue(r.value))
        notify('验证成功')
      } else {
        setVerifyText(`请求失败：${r.error}`)
        notify('验证失败', true)
      }
    } catch (err) {
      setVerifyText(`验证失败：${(err as Error).message}`)
      notify(`验证失败: ${(err as Error).message}`, true)
    } finally {
      setValidating(false)
    }
  }

  // ---- 编辑回填(表格「编辑」入口) ----

  const startEdit = (id: string) => {
    const p = platforms.find((x) => x.id === id)
    if (!p) return
    setForm(fillFormState(p))
    setEditingId(id)
    notify(`正在编辑：${p.name}`)
    formRef2.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ---- 预设使用弹窗填入(url/headers/handler 三项, 与旧版一致不动其他字段) ----

  const [usePreset, setUsePreset] = useState<Preset | null>(null)

  const applyPresetFill = (fill: PresetFill) => {
    const name = usePreset?.name ?? ''
    patchForm({ url: fill.url, headersText: fill.headersText, handlerText: fill.handlerText })
    setUsePreset(null)
    notify(`已填入 ${name} 配置，可修改后保存`)
    requestAnimationFrame(() => {
      urlInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  // ---- 预设卡片操作 ----

  const resetBuiltinPreset = async (preset: Preset) => {
    try {
      const def = await resetPreset(preset.id)
      await loadPresets()
      notify(`已重置 ${def.name} 为默认配置`)
    } catch (e) {
      notify(`重置失败: ${(e as Error).message}`, true)
    }
  }

  const deleteCustomPreset = async (preset: Preset) => {
    if (!window.confirm(`确定删除预设「${preset.name}」？`)) return
    try {
      await deletePreset(preset.id)
      await loadPresets()
    } catch (e) {
      notify(`删除失败: ${(e as Error).message}`, true)
    }
  }

  // ---- 预设编辑弹窗 (null=关闭; {preset:null}=新增) ----

  const [presetModal, setPresetModal] = useState<Preset | null | undefined>(undefined)

  // ---- 平台表格操作 ----

  const [rowMsg, setRowMsg] = useState<Record<string, { text: string; error?: boolean }>>({})

  const setRowMessage = (id: string, text: string, isError?: boolean) =>
    setRowMsg((prev) => ({ ...prev, [id]: { text, error: isError } }))

  const movePlatform = async (id: string, dir: -1 | 1) => {
    const idx = platforms.findIndex((x) => x.id === id)
    const swap = idx + dir
    if (idx === -1 || swap < 0 || swap >= platforms.length) return
    const next = [...platforms]
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    setPlatforms(next)
    try {
      await reorderPlatforms(next.map((p) => p.id))
      await loadDashboard()
    } catch (err) {
      notify(`排序失败: ${(err as Error).message}`, true)
      await loadPlatforms()
    }
  }

  const testRow = async (id: string) => {
    setRowMessage(id, '测试中…')
    try {
      const r = await testPlatform(id)
      if (r.ok) setRowMessage(id, `成功: ${fmt(r.value)}`)
      else setRowMessage(id, `失败: ${r.error}`, true)
    } catch (err) {
      setRowMessage(id, (err as Error).message, true)
    }
  }

  const fetchRow = async (id: string) => {
    setRowMessage(id, '获取中…')
    try {
      const r = await fetchPlatformBalance(id)
      if (r.ok) setRowMessage(id, `已获取: ${fmt(r.value)}`)
      else setRowMessage(id, `失败: ${r.error}`, true)
      await loadDashboard()
    } catch (err) {
      setRowMessage(id, (err as Error).message, true)
    }
  }

  const removeRowPlatform = async (id: string, name: string) => {
    if (!window.confirm(`确定删除平台「${name}」？`)) return
    try {
      await deletePlatform(id)
      if (editingId === id) clearForm()
      await loadPlatforms()
      await loadDashboard()
    } catch (err) {
      setRowMessage(id, (err as Error).message, true)
    }
  }

  // ---- 导入导出 ----

  const [transferReq, setTransferReq] = useState<TransferRequest | null>(null)
  const [transferMsg, setTransferMsg] = useState<{ text: string; error?: boolean }>({ text: '' })

  const exportAll = async () => {
    try {
      const data = await exportConfig()
      setTransferReq({
        mode: 'export',
        title: '导出完整配置',
        desc: `共 ${data.platforms.length} 个平台、${data.presets.length} 个预设，复制以下 JSON 即可备份或分享`,
        text: JSON.stringify(data, null, 2),
      })
    } catch (e) {
      setTransferMsg({ text: `导出失败: ${(e as Error).message}`, error: true })
    }
  }

  const onImported = async (summary: string) => {
    setTransferReq(null)
    setTransferMsg({ text: summary })
    await loadPlatforms()
    await loadPresets()
    await loadDashboard()
  }

  // 数据兜底加载(App 已预载, 此处幂等)
  useEffect(() => {
    void loadPresets()
    void loadPlatforms()
  }, [loadPresets, loadPlatforms])

  return (
    <>
      <section className="hero hero--small">
        <div className="hero__meta">PLATFORM · CONFIGURATION</div>
        <h2 className="hero__title">平台配置</h2>
        <div className="hero__line" />
        <p className="hero__desc">
          添加需要监控的 LLM 平台，填写凭据与余额接口信息。
          <br />
          配置保存功能建设中。
        </p>
      </section>

      {/* ========== 快速配置 ========== */}
      <section className="section">
        <div className="section__head">
          <h3 className="section__title">快速配置</h3>
          <div className="section__head-actions">
            <span className="section__note">QUICK SETUP</span>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() =>
                setTransferReq({
                  mode: 'import',
                  title: '导入预设',
                  desc: '粘贴单个预设的 JSON（可由预设卡片的「导出」得到），点击「确认导入」',
                  expectedKind: 'preset',
                })
              }
            >
              导入预设
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setPresetModal(null)}>
              + 添加预设
            </button>
          </div>
        </div>
        <p className="section__desc">
          点击预设卡片生成配置，可在下方表单中再修改；预设本身支持编辑，内置预设可重置为默认
        </p>
        <div className="quick-grid">
          {presets.map((p) => (
            <div
              key={p.id}
              className="quick-card"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('[data-op]')) return
                setUsePreset(p)
              }}
            >
              <div className="quick-card__head">
                <span className="quick-card__name">{p.name}</span>
                {p.builtin && <span className="quick-card__badge">内置</span>}
              </div>
              <span className="quick-card__desc">{p.fields.map((f) => f.label).join(' · ')}</span>
              <div className="quick-card__ops">
                <button type="button" className="table__action" data-op="edit" onClick={() => setPresetModal(p)}>
                  编辑
                </button>
                <button
                  type="button"
                  className="table__action"
                  data-op="export"
                  onClick={() =>
                    setTransferReq({
                      mode: 'export',
                      title: `导出预设：${p.name}`,
                      desc: '复制以下 JSON 即可分享或备份',
                      text: JSON.stringify(p, null, 2),
                    })
                  }
                >
                  导出
                </button>
                {p.builtin ? (
                  <button
                    type="button"
                    className="table__action"
                    data-op="reset"
                    onClick={() => void resetBuiltinPreset(p)}
                  >
                    重置默认
                  </button>
                ) : (
                  <button
                    type="button"
                    className="table__action table__action--danger"
                    data-op="delete"
                    onClick={() => void deleteCustomPreset(p)}
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ========== 添加平台表单 ========== */}
      <section className="section">
        <div className="section__head">
          <h3 className="section__title">添加平台</h3>
          <span className="section__note">NEW PLATFORM</span>
        </div>
        <p className="section__desc">
          懒得手动配置？把本仓库和调用方式丢给 AI，让它按这里的配置格式（请求方法 / URL /
          请求头 / 处理函数）帮你生成平台配置，然后通过下方「导入 / 导出」导入即可。
        </p>

        <form
          ref={formRef2}
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="form__row">
            <div className="field field--wide">
              <label className="field__label" htmlFor="f-name">
                平台名称
              </label>
              <input
                className="field__input"
                id="f-name"
                placeholder="DeepSeek"
                value={form.name}
                onChange={(e) => patchForm({ name: e.target.value })}
              />
            </div>
          </div>
          <div className="form__row">
            <div className="field field--wide">
              <label className="field__label" htmlFor="f-homepage">
                平台主页 URL
              </label>
              <input
                className="field__input"
                id="f-homepage"
                placeholder="https://platform.example.com"
                value={form.homepage}
                onChange={(e) => patchForm({ homepage: e.target.value })}
              />
            </div>
          </div>
          <div className="form__row">
            <div className="field">
              <label className="field__label" htmlFor="f-method">
                请求方法
              </label>
              <select
                className="field__input"
                id="f-method"
                value={form.method}
                onChange={(e) => patchForm({ method: e.target.value as HttpMethod })}
              >
                <option>GET</option>
                <option>POST</option>
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="f-body">
                请求体（JSON，仅 POST）
              </label>
              <input
                className="field__input"
                id="f-body"
                placeholder='{"api_key": "sk-xxx"}'
                disabled={form.method !== 'POST'}
                value={form.bodyText}
                onChange={(e) => patchForm({ bodyText: e.target.value })}
              />
            </div>
          </div>
          <div className="form__row">
            <div className="field field--wide">
              <label className="field__label" htmlFor="f-url">
                请求 URL
              </label>
              <input
                ref={urlInputRef}
                className="field__input"
                id="f-url"
                placeholder="https://api.deepseek.com/user/balance"
                value={form.url}
                onChange={(e) => patchForm({ url: e.target.value })}
              />
            </div>
          </div>
          <div className="form__row">
            <div className="field field--wide">
              <label className="field__label">请求头（JSON）</label>
              <CodeEditor
                value={form.headersText}
                mode="json"
                onChange={(v) => patchForm({ headersText: v })}
                onModEnter={() => void validate()}
              />
            </div>
          </div>
          <div className="form__row">
            <div className="field field--wide">
              <label className="field__label">
                处理函数（raw 为原始响应文本，在函数内自由解析并返回余额数值：JSON 接口用
                JSON.parse(raw)，非 JSON 响应可用 eval）
              </label>
              <CodeEditor
                value={form.handlerText}
                mode="js"
                onChange={(v) => patchForm({ handlerText: v })}
                onModEnter={() => void validate()}
              />
            </div>
          </div>
          <div className="form__row">
            <div className="field">
              <label className="field__label" htmlFor="f-prefix">
                显示前缀
              </label>
              <input
                className="field__input"
                id="f-prefix"
                placeholder="$"
                value={form.prefix}
                onChange={(e) => patchForm({ prefix: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="f-suffix">
                显示后缀
              </label>
              <input
                className="field__input"
                id="f-suffix"
                placeholder="USD"
                value={form.suffix}
                onChange={(e) => patchForm({ suffix: e.target.value })}
              />
            </div>
            <div className="field field--wide">
              <span className="field__label field__label--hint">
                仅影响监控面板显示，例如：$ 8.51 USD
              </span>
            </div>
          </div>
          <div className="form__actions">
            <button type="submit" className="btn">
              {editingId ? '更新配置' : '保存配置'}
            </button>
            {editingId && (
              <button type="button" className="btn btn--ghost" onClick={cancelEdit}>
                取消编辑
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost"
              disabled={validating}
              onClick={() => void validate()}
            >
              验证
            </button>
            <span className={`form__msg${formMsg.error ? ' is-error' : ''}`}>{formMsg.text}</span>
          </div>
          <div className="form__row">
            <div className="field field--wide">
              <label className="field__label">验证输出</label>
              <CodeEditor value={verifyText} mode="json" readOnly />
            </div>
          </div>
        </form>
      </section>

      {/* ========== 导入 / 导出 ========== */}
      <section className="section">
        <div className="section__head">
          <h3 className="section__title">导入 / 导出</h3>
          <span className="section__note">JSON</span>
        </div>
        <p className="section__desc">
          导出完整配置（全部平台 +
          预设）用于备份或迁移；也支持单个平台 / 单个预设的导出与导入。导入时按 id 合并，同名配置会被覆盖。
        </p>
        <div className="section__actions">
          <button type="button" className="btn" onClick={() => void exportAll()}>
            导出完整配置
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() =>
              setTransferReq({
                mode: 'import',
                title: '导入配置',
                desc: '支持完整配置、单个平台、单个预设的 JSON（可由任何「导出」按钮得到），粘贴后自动识别，点击「确认导入」',
              })
            }
          >
            导入配置
          </button>
          <span className={`form__msg${transferMsg.error ? ' is-error' : ''}`}>{transferMsg.text}</span>
        </div>
      </section>

      {/* ========== 已配置平台 ========== */}
      <section className="section">
        <div className="section__head">
          <h3 className="section__title">已配置平台</h3>
          <div className="section__head-actions">
            <span className="section__note">CONFIGURED · {platforms.length}</span>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() =>
                setTransferReq({
                  mode: 'import',
                  title: '导入平台',
                  desc: '粘贴单个平台的 JSON（可由「已配置平台」表格的「导出」得到），点击「确认导入」',
                  expectedKind: 'platform',
                })
              }
            >
              导入平台
            </button>
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>平台</th>
              <th>URL</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {!platforms.length ? (
              <tr className="table__empty">
                <td colSpan={3}>尚未配置任何平台</td>
              </tr>
            ) : (
              platforms.map((p) => {
                const rm = rowMsg[p.id]
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="table__url" title={p.request?.url || ''}>
                      {p.request?.url || '—'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="table__action"
                        title="上移"
                        onClick={() => void movePlatform(p.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="table__action"
                        title="下移"
                        onClick={() => void movePlatform(p.id, 1)}
                      >
                        ↓
                      </button>
                      <button type="button" className="table__action" onClick={() => startEdit(p.id)}>
                        编辑
                      </button>
                      <button
                        type="button"
                        className="table__action"
                        onClick={() =>
                          setTransferReq({
                            mode: 'export',
                            title: `导出平台：${p.name}`,
                            desc: '复制以下 JSON 即可分享或备份',
                            text: JSON.stringify(p, null, 2),
                          })
                        }
                      >
                        导出
                      </button>
                      <button type="button" className="table__action" onClick={() => void testRow(p.id)}>
                        测试连接
                      </button>
                      <button type="button" className="table__action" onClick={() => void fetchRow(p.id)}>
                        获取余额
                      </button>
                      <button
                        type="button"
                        className="table__action table__action--danger"
                        onClick={() => void removeRowPlatform(p.id, p.name)}
                      >
                        删除
                      </button>
                      <span className={`table__msg${rm?.error ? ' is-error' : ''}`}>{rm?.text}</span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </section>

      {/* ========== 弹窗 ========== */}
      {usePreset && (
        <UsePresetModal
          preset={usePreset}
          onError={notify}
          onCancel={() => setUsePreset(null)}
          onConfirm={applyPresetFill}
        />
      )}
      {presetModal !== undefined && (
        <EditPresetModal
          preset={presetModal}
          onClose={() => setPresetModal(undefined)}
          onNotify={notify}
          onSaved={() => void loadPresets()}
        />
      )}
      {transferReq && (
        <TransferModal
          request={transferReq}
          onClose={() => setTransferReq(null)}
          onImported={(summary) => void onImported(summary)}
        />
      )}
    </>
  )
}