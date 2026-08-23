// 预设编辑弹窗: 名称/交互式字段行/方法/URL模板/请求头模板(CodeMirror)/提取函数模板(CodeMirror)
// 内置预设支持"重置为默认"; 语义与旧 app.js preset-modal 一致

import { useMemo, useState } from 'react'
import type { HttpMethod, Preset } from '@/types'
import { createPreset, resetPreset, updatePreset } from '@/api/endpoints'
import CodeEditor from './CodeEditor'

const DEFAULT_HEADERS_TEMPLATE = '{\n  "Authorization": "Bearer {{token}}"\n}'
const DEFAULT_EXTRACTOR_TEMPLATE = 'function (data) {\n  return data.balance\n}'

interface FieldRow {
  key: string
  label: string
  placeholder: string
}

interface Props {
  preset: Preset | null // null = 新增模式
  onClose(): void
  /** 消息提示(与旧版一致走表单消息区): 校验失败/保存结果/重置提示 */
  onNotify(msg: string, isError?: boolean): void
  /** 预设成功保存后回调(父级刷新预设列表) */
  onSaved(): void
}

function rowsFromFields(fields: Preset['fields'] | undefined): FieldRow[] {
  const list: Preset['fields'] =
    fields && fields.length ? fields : ([{ key: '', label: '', placeholder: '' }] as Preset['fields'])
  return list.map((f) => ({
    key: f.key || '',
    label: f.label || '',
    placeholder: f.placeholder || '',
  }))
}

export default function EditPresetModal({ preset, onClose, onNotify, onSaved }: Props) {
  const initial = useMemo(
    () => ({
      name: preset ? preset.name : '',
      rows: rowsFromFields(preset?.fields),
      method: (preset ? preset.method : 'GET') as HttpMethod,
      urlTemplate: preset ? preset.urlTemplate : '',
      headersText: preset
        ? JSON.stringify(preset.headersTemplate, null, 2)
        : DEFAULT_HEADERS_TEMPLATE,
      extractorText: preset ? preset.extractorTemplate : DEFAULT_EXTRACTOR_TEMPLATE,
    }),
    [preset],
  )

  const [name, setName] = useState(initial.name)
  const [rows, setRows] = useState<FieldRow[]>(initial.rows)
  const [method, setMethod] = useState<HttpMethod>(initial.method)
  const [urlTemplate, setUrlTemplate] = useState(initial.urlTemplate)
  const [headersText, setHeadersText] = useState(initial.headersText)
  const [extractorText, setExtractorText] = useState(initial.extractorText)

  const editingId = preset?.id ?? null
  const builtin = Boolean(preset?.builtin)

  const setRow = (idx: number, patch: Partial<FieldRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx))
  const addRow = () =>
    setRows((prev) => [...prev, { key: '', label: '', placeholder: '' }])

  const doReset = async () => {
    if (!editingId) return
    try {
      const def = await resetPreset(editingId)
      // 与旧版一致: 用默认定义重开弹窗内容(可继续修改后保存)
      setName(def.name)
      setRows(rowsFromFields(def.fields))
      setMethod(def.method)
      setUrlTemplate(def.urlTemplate)
      setHeadersText(JSON.stringify(def.headersTemplate, null, 2))
      setExtractorText(def.extractorTemplate)
      onNotify('已重置为默认配置，可修改后保存')
    } catch (e) {
      onNotify(`重置失败: ${(e as Error).message}`, true)
    }
  }

  const save = async () => {
    // 全空行自动忽略(与旧 collectFieldRows 一致)
    const fields = rows.filter((r) => r.key.trim() || r.label.trim() || r.placeholder.trim())
    const missing = fields.find((f) => !f.key.trim() || !f.label.trim())
    if (missing) return onNotify(`字段缺少${!missing.key.trim() ? ' key' : '显示名称'}`, true)
    if (!fields.length) return onNotify('至少需要一个字段', true)
    if (new Set(fields.map((f) => f.key.trim())).size !== fields.length) {
      return onNotify('字段 key 不能重复', true)
    }
    let headers: Record<string, string>
    try {
      headers = JSON.parse(headersText || '{}')
    } catch {
      return onNotify('请求头模板必须是合法 JSON', true)
    }

    const payload = {
      name,
      fields: fields.map((f) => ({
        key: f.key.trim(),
        label: f.label.trim(),
        ...(f.placeholder.trim() ? { placeholder: f.placeholder.trim() } : {}),
      })),
      method,
      urlTemplate,
      headersTemplate: headers,
      extractorTemplate: extractorText,
    }

    try {
      if (editingId) {
        await updatePreset(editingId, payload)
        onNotify('预设已更新')
      } else {
        await createPreset(payload)
        onNotify('预设已添加')
      }
      onSaved()
      onClose()
    } catch (e) {
      onNotify(`保存失败: ${(e as Error).message}`, true)
    }
  }

  return (
    <div
      className="modal is-open"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal__box modal__box--wide">
        <div className="modal__head">
          <span className="modal__title">{preset ? `编辑预设：${preset.name}` : '添加预设'}</span>
          <button type="button" className="modal__close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal__field">
          <label className="field__label" htmlFor="pe-name">
            预设名称
          </label>
          <input
            className="field__input"
            id="pe-name"
            placeholder="NEWAPI"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="modal__field">
          <span className="field__label">
            字段（key 与显示名称必填；key 用于 URL / 请求头 / 提取函数模板中的 {'{{key}}'} 替换）
          </span>
          <div className="pe-fields">
            {rows.map((row, idx) => (
              <div className="pe-field-row" key={idx}>
                <input
                  className="field__input"
                  placeholder="字段 key，如 baseUrl"
                  value={row.key}
                  onChange={(e) => setRow(idx, { key: e.target.value })}
                />
                <input
                  className="field__input"
                  placeholder="显示名称，如 请求地址"
                  value={row.label}
                  onChange={(e) => setRow(idx, { label: e.target.value })}
                />
                <input
                  className="field__input"
                  placeholder="输入提示（可留空）"
                  value={row.placeholder}
                  onChange={(e) => setRow(idx, { placeholder: e.target.value })}
                />
                <button
                  type="button"
                  className="table__action table__action--danger"
                  onClick={() => removeRow(idx)}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={addRow}>
            + 添加字段
          </button>
        </div>
        <div className="modal__row">
          <div className="modal__field">
            <label className="field__label" htmlFor="pe-method">
              请求方法
            </label>
            <select
              className="field__input"
              id="pe-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as HttpMethod)}
            >
              <option>GET</option>
              <option>POST</option>
            </select>
          </div>
          <div className="modal__field">
            <label className="field__label" htmlFor="pe-url">
              URL 模板（支持 {'{{字段key}}'}）
            </label>
            <input
              className="field__input"
              id="pe-url"
              placeholder="{{baseUrl}}/api/user/self"
              value={urlTemplate}
              onChange={(e) => setUrlTemplate(e.target.value)}
            />
          </div>
        </div>
        <div className="modal__field">
          <span className="field__label">
            请求头模板（JSON，支持 {'{{字段key}}'}，留空值自动移除）
          </span>
          <CodeEditor value={headersText} mode="json" onChange={setHeadersText} />
        </div>
        <div className="modal__field">
          <span className="field__label">
            提取函数模板（JS，data 为 JSON 解析后的响应；使用时自动包一层 JSON.parse
            生成处理函数，支持 {'{{字段key}}'}）
          </span>
          <CodeEditor value={extractorText} mode="js" onChange={setExtractorText} />
        </div>
        <div className="modal__actions">
          <button type="button" className="btn" onClick={() => void save()}>
            保存预设
          </button>
          {builtin && (
            <button type="button" className="btn btn--ghost" onClick={() => void doReset()}>
              重置为默认
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
