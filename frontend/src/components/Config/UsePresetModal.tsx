// 预设使用(快速配置)弹窗: 填写字段 → 渲染模板 → 生成请求配置与处理函数填入表单
// 语义与旧 app.js use-modal 一致(校验错误显示在表单消息区)

import { useState } from 'react'
import type { Preset } from '@/types'
import { renderTemplate } from '@/lib/format'

export interface PresetFill {
  url: string
  headersText: string
  handlerText: string
}

interface Props {
  preset: Preset
  onConfirm(fill: PresetFill): void
  onCancel(): void
  /** 校验失败提示(与旧版一致走表单消息区) */
  onError(msg: string): void
}

export default function UsePresetModal({ preset, onConfirm, onCancel, onError }: Props) {
  const [vars, setVars] = useState<Record<string, string>>(() =>
    Object.fromEntries(preset.fields.map((f) => [f.key, ''])),
  )

  const setVar = (key: string, value: string) => {
    setVars((prev) => ({ ...prev, [key]: value }))
  }

  const confirm = () => {
    const filled: Record<string, string> = {}
    for (const f of preset.fields) filled[f.key] = (vars[f.key] ?? '').trim()
    const missingUrl = preset.fields.find((f) => /url/i.test(f.key) && !filled[f.key])
    if (missingUrl) {
      onError(`请填写 ${missingUrl.label}`)
      return
    }

    const url = renderTemplate(preset.urlTemplate, filled)
    const headers = renderTemplate(preset.headersTemplate, filled)
    for (const k of Object.keys(headers)) {
      if (String(headers[k]).trim() === '') delete headers[k]
    }
    // 预设的提取函数模板以 JSON 解析后的 data 为输入, 使用时包一层 JSON.parse 生成处理函数
    const extractor = renderTemplate(preset.extractorTemplate, filled)
    const handlerText = `function (raw) {\n  var data = JSON.parse(raw)\n  return (${extractor.trim()})(data)\n}`
    onConfirm({ url, headersText: JSON.stringify(headers, null, 2), handlerText })
  }

  return (
    <div
      className="modal is-open"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="modal__box">
        <div className="modal__head">
          <span className="modal__title">{preset.name} 快速配置</span>
          <button type="button" className="modal__close" onClick={onCancel}>
            ×
          </button>
        </div>
        <p className="modal__desc">填写后自动生成请求配置与提取函数</p>
        {preset.fields.map((f) => (
          <div className="modal__field" key={f.key}>
            <label className="field__label" htmlFor={`uf-${f.key}`}>
              {f.label}
            </label>
            <input
              className="field__input"
              id={`uf-${f.key}`}
              placeholder={f.placeholder || ''}
              value={vars[f.key] ?? ''}
              onChange={(e) => setVar(f.key, e.target.value)}
            />
          </div>
        ))}
        <div className="modal__actions">
          <button type="button" className="btn" onClick={confirm}>
            填入配置
          </button>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
