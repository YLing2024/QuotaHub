// 导入 / 导出弹窗: 复制粘贴 JSON + 自动识别格式(完整配置/单个平台/单个预设)
// 语义与旧 app.js transfer-modal 一致

import { useRef, useState } from 'react'
import { importConfig } from '@/api/endpoints'
import { classifyConfig, KIND_NAME, type ConfigKind } from './classify'

export interface TransferRequest {
  mode: 'export' | 'import'
  title: string
  desc: string
  /** export 内容文本或 import 初始粘贴文本 */
  text?: string
  /** import 模式期望格式(仅提示用, 其他格式仍可导入) */
  expectedKind?: ConfigKind | null
}

interface Props {
  request: TransferRequest
  onClose(): void
  /** 导入成功后回调(父级负责提示与刷新列表) */
  onImported(summary: string): void
}

interface DetectState {
  text: string
  cls: '' | 'is-error' | 'is-warn'
}

function detectOf(text: string, expected: ConfigKind | null | undefined): DetectState {
  const trimmed = text.trim()
  if (!trimmed) return { text: '', cls: '' }
  let obj: unknown
  try {
    obj = JSON.parse(trimmed)
  } catch {
    return { text: '✗ 不是合法 JSON', cls: 'is-error' }
  }
  const hit = classifyConfig(obj)
  if (!hit) {
    return {
      text: '✗ 无法识别的配置格式（需要完整配置、单个平台或单个预设的 JSON）',
      cls: 'is-error',
    }
  }
  if (expected && expected !== hit.kind) {
    return {
      text: `⚠ 识别为${hit.label}，与期望的「${KIND_NAME[expected]}」不符，仍可导入`,
      cls: 'is-warn',
    }
  }
  return { text: `✓ 识别为${hit.label}`, cls: '' }
}

export default function TransferModal({ request, onClose, onImported }: Props) {
  const isExport = request.mode === 'export'
  const [text, setText] = useState(request.text ?? '')
  const [detect, setDetect] = useState<DetectState>(() =>
    detectOf(request.text ?? '', request.expectedKind),
  )
  const [result, setResult] = useState<{ text: string; error?: boolean }>({ text: '' })
  const [copied, setCopied] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const onTextChange = (value: string) => {
    setText(value)
    setDetect(detectOf(value, request.expectedKind))
  }

  const doCopy = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
      } else if (textareaRef.current) {
        textareaRef.current.select()
        document.execCommand('copy')
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setResult({ text: '复制失败，请手动全选复制', error: true })
    }
  }

  const doImport = async () => {
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      setResult({ text: '导入失败: 不是合法 JSON', error: true })
      return
    }
    if (!classifyConfig(payload)) {
      setResult({
        text: '导入失败: 无法识别的配置格式（需要完整配置、单个平台或单个预设的 JSON）',
        error: true,
      })
      return
    }
    try {
      const r = await importConfig(payload)
      const skipped =
        r.errors && r.errors.length ? `；跳过 ${r.errors.length} 项: ${r.errors.join('; ')}` : ''
      const msg = `导入完成: ${r.platforms} 个平台、${r.presets} 个预设${skipped}`
      onImported(msg)
    } catch (e) {
      setResult({ text: `导入失败: ${(e as Error).message}`, error: true })
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
          <span className="modal__title">{request.title}</span>
          <button type="button" className="modal__close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="modal__desc">{request.desc}</p>
        <p className={`modal__desc ${detect.cls}`}>{detect.text}</p>
        <div className="modal__field">
          <textarea
            ref={textareaRef}
            className="field__code field__input--area transfer-text"
            rows={14}
            spellCheck={false}
            placeholder="粘贴完整配置（含 platforms / presets）、单个平台或单个预设的 JSON…"
            readOnly={isExport}
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
          />
        </div>
        <div className="modal__actions">
          {isExport ? (
            <button type="button" className="btn" onClick={() => void doCopy()}>
              {copied ? '已复制 ✓' : '一键复制'}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => void doImport()}>
              确认导入
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            关闭
          </button>
          <span className={`form__msg${result.error ? ' is-error' : ''}`}>{result.text}</span>
        </div>
      </div>
    </div>
  )
}
