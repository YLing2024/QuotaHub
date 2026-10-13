// CodeMirror 6 编辑器封装 (替代旧 CodeMirror 5 vendor)
// mode: 'json' → @codemirror/lang-json; 'js' → javascript。支持 Mod-Enter 快捷键(触发验证)与只读
// 编辑器本体保留(主题取 CodeMirror 默认), 仅外层容器换 antd 外观(边框/圆角取自 theme token)。

import { useMemo } from 'react'
import { theme } from 'antd'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { EditorState, Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'

interface Props {
  value: string
  onChange?(value: string): void
  mode?: 'js' | 'json'
  readOnly?: boolean
  placeholder?: string
  onModEnter?: () => void
}

export default function CodeEditor({ value, onChange, mode = 'json', readOnly, placeholder, onModEnter }: Props) {
  const { token } = theme.useToken()
  const extensions = useMemo(() => {
    const list: Extension[] = [mode === 'json' ? json() : javascript()]
    if (onModEnter && !readOnly) {
      list.push(
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                onModEnter()
                return true
              },
            },
          ]),
        ),
      )
    }
    if (readOnly) list.push(EditorState.readOnly.of(true))
    return list
  }, [mode, readOnly, onModEnter])

  return (
    <div
      style={{
        border: `1px solid ${readOnly ? token.colorBorderSecondary : token.colorBorder}`,
        borderRadius: token.borderRadius,
        overflow: 'hidden',
      }}
    >
      <CodeMirror
        value={value}
        height="auto"
        placeholder={placeholder}
        extensions={extensions}
        editable={!readOnly}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          autocompletion: false,
          highlightActiveLine: !readOnly,
          searchKeymap: false,
        }}
        onChange={(v) => onChange?.(v)}
      />
    </div>
  )
}
