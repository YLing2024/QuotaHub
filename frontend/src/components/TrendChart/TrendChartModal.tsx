// 余额趋势图弹窗 —— canvas 手绘折线图, 完整移植旧 app.js 全部交互:
// - 工具栏时间范围档位(24小时/7天/30天/一年/所有/自定义): 切换时预览条与主图整条换到该区间
// - 时间预览条: 时间轴 = 当前档位区间(100% 即该区间), 拖两端在区间内收窄/拖内部平移
// - 主图 hover 十字线 + tooltip(值+时间)
// - 主图拖动平移联动预览条
// - 触屏移动端(Pointer Events 统一鼠标/触摸/笔)
// - 密集点渲染自适应(按相邻点 X 像素间距收敛点半径/白描边)
// 纯逻辑在 chartLogic.ts (可单测), 本文件只做绘制与交互编排

import { useEffect, useRef, useState } from 'react'
import { getHistory } from '@/api/endpoints'
import { fmtAuto } from '@/lib/format'
import type { SamplePoint } from '@/types'
import {
  buildRangeGeo,
  clampLeftEdge,
  clampPanStart,
  clampRightEdge,
  clampWindow,
  densityT,
  filterPointsByWindow,
  minWindowMs,
  parseLocalInputValue,
  presetWindow,
  previewHitMode,
  tickDecimals,
  toLocalInputValue,
  yDomain,
  type PreviewGeo,
  type PreviewHitMode,
  type RangePreset,
  type TimeWindow,
} from './chartLogic'

// 触摸拖动判定阈值(px): 位移未超过视为"查看信息"(十字线跟随), 超过转为平移
const TOUCH_PAN_THRESHOLD = 6

// 工具栏时间范围档位(24小时/7天/30天/一年/所有/自定义)
const RANGE_PRESETS: Array<{ key: RangePreset; label: string }> = [
  { key: 'h24', label: '24小时' },
  { key: 'd7', label: '7天' },
  { key: 'd30', label: '30天' },
  { key: 'year', label: '一年' },
  { key: 'all', label: '所有' },
  { key: 'custom', label: '自定义' },
]

// 打开弹窗的默认档位
const DEFAULT_PRESET: RangePreset = 'd30'
// 画布字体: 跟随 Swiss 设计系统(latin 子集自托管, CJK 回退系统栈)
const FONT_STACK = '"Inter", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif'
const MONO_STACK = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace'

// Swiss palette constants (light/dark 共用结构, 取值与 CSS 变量一致)
// 读取时机: 每次渲染时基于主题取色, 保证深色模式图表同步
function readThemeColor(darkKey: string, lightKey: string): string {
  const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  return dark ? darkKey : lightKey
}
const LINE_COLOR = () => readThemeColor('#c77c1f', '#a05b0c')
const ACCENT_FADE = () => readThemeColor('rgba(199, 124, 31, 0.14)', 'rgba(160, 91, 12, 0.1)')
const AXIS_TICK = () => readThemeColor('#746e66', '#9b958d')
const GRID_LINE = () => readThemeColor('rgba(239,234,227,0.16)', 'rgba(23,21,18,0.16)')
const AXIS_BASE = () => readThemeColor('rgba(239,234,227,0.3)', 'rgba(23,21,18,0.3)')
const TEXT_MUTED = () => readThemeColor('#a29b92', '#6f6a63')
const TEXT_DIM = () => readThemeColor('#746e66', '#9b958d')
const TEXT_FG = () => readThemeColor('#efeae3', '#171512')
const SURFACE = () => readThemeColor('#191715', '#fbfaf8')
const CROSSHAIR = () => readThemeColor('rgba(239,234,227,0.45)', 'rgba(23,21,18,0.35)')
const OVERLAY_MASK = () => readThemeColor('rgba(239,234,227,0.25)', 'rgba(23,21,18,0.28)')
const DIM_LINE = () => readThemeColor('rgba(174,166,155,0.55)', 'rgba(138,138,138,0.95)')
const HANDLE = () => readThemeColor('#efeae3', '#171512')

interface ChartView {
  pts: SamplePoint[]
  times: number[]
  pad: { l: number; r: number; t: number; b: number }
  w: number
  h: number
  x(i: number): number
  y(v: number): number
  dotR: number
  inPlotX(px: number): boolean
  nearestIdx(px: number): number
}

// 主图按住平移拖拽状态
interface PanDragState {
  startX: number
  clientX0: number
  winStart0: number
  winW: number
  rectLeft: number
  py: number
  panning: boolean
}

// 预览条拖拽状态: 边缘拖拽或整体平移
interface PreviewDragState {
  mode: 'l' | 'r' | 'pan'
  lastTs: number | null
  minWin: number
}

interface Props {
  id: string
  name: string
  onClose(): void
}

export default function TrendChartModal({ id, name, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const statsRef = useRef<HTMLSpanElement>(null)

  // ---- 时间范围档位(React 层) ----
  const [preset, setPreset] = useState<RangePreset>(DEFAULT_PRESET)
  // 数据域(全量采样点的时间跨度), 供档位计算与自定义输入上下限
  const [domain, setDomain] = useState<TimeWindow | null>(null)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [customError, setCustomError] = useState('')

  // 图表闭包态(绘制/拖拽)暴露的命令: 应用区间 / 读取当前窗口
  const chartApiRef = useRef<{
    applyWindow(start: number, end: number): void
    getWindow(): TimeWindow
  } | null>(null)

  // 弹窗打开期间锁定 body 滚动，关闭/卸载时恢复
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current!
    const preview = previewRef.current!
    const stats = statsRef.current!

    // ---- 可变交互态(与旧实现一致, 存于闭包避免 React 重渲染打断拖拽) ----
    let points: SamplePoint[] = []
    // 主图窗口边界(ms 时间戳) —— 即预览条上被选中的那一段
    let winStart = 0
    let winEnd = 0
    // 预览条自身的时间轴范围(当前档位选定的区间): 预览条 100% 覆盖的就是它,
    // 切档位时整条一起换(不再固定显示全量历史)
    let rngStart = 0
    let rngEnd = 0
    // 主图 hover: 十字线所在 x(css 像素), null = 不显示
    let hoverX: number | null = null
    // 主图最近一次渲染的几何视图, hover 命中与拖拽判定共用
    let view: ChartView | null = null
    let panDrag: PanDragState | null = null
    let previewDrag: PreviewDragState | null = null
    let previewHover: PreviewHitMode = ''
    let rafId = 0
    let docCleanup: (() => void) | null = null

    // 供 React 层(档位按钮/自定义输入)驱动的命令接口:
    // 应用区间 = 预览条时间轴与主图窗口一起换成该区间(预览条 100% 即此区间) + 重绘
    const applyWindow = (start: number, end: number) => {
      rngStart = start
      rngEnd = end
      winStart = start
      winEnd = end
      hoverX = null
      drawChart()
    }
    chartApiRef.current = {
      applyWindow,
      getWindow: () => ({ start: winStart, end: winEnd }),
    }

    const scheduleRenderCharts = () => {
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        drawChart()
      })
    }

    // 通用拖拽: document 上挂一次 pointermove/pointerup/pointercancel, 松开自动解绑(预览条与主图平移共用)
    // 统一 Pointer Events 后鼠标/触摸/笔共用一套逻辑; pointerId 过滤多指干扰
    const beginDocDrag = (
      onMove: (ev: PointerEvent) => void,
      onUp: (ev: PointerEvent) => void,
      pointerId: number | null = null,
    ) => {
      const move = (ev: PointerEvent) => {
        ev.preventDefault()
        if (pointerId != null && ev.pointerId !== pointerId) return
        onMove(ev)
      }
      const detach = () => {
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        document.removeEventListener('pointercancel', up)
        docCleanup = null
      }
      const up = (ev: PointerEvent) => {
        detach()
        onUp(ev)
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
      document.addEventListener('pointercancel', up)
      docCleanup = detach
    }

    // 预览条窗口拖拽应用(夹紧逻辑在 chartLogic 纯函数)
    const applyPreviewDrag = (px: number, geo: PreviewGeo) => {
      if (!previewDrag) return
      const ts = geo.tsOfX(px)
      const winW = winEnd - winStart
      if (previewDrag.mode === 'pan') {
        if (previewDrag.lastTs == null) {
          previewDrag.lastTs = ts
          return
        }
        const s = clampPanStart(winStart + (ts - previewDrag.lastTs), winW, geo.t0, geo.t1)
        previewDrag.lastTs = ts
        winStart = s
        winEnd = s + winW
      } else if (previewDrag.mode === 'l') {
        winStart = clampLeftEdge(ts, geo.t0, winEnd, previewDrag.minWin)
      } else {
        winEnd = clampRightEdge(ts, geo.t1, winStart, previewDrag.minWin)
      }
    }

    // 主图 hover 覆盖层: 垂直十字线(浅灰虚线) + 当前点加重 + 白底 tooltip(值/时间)
    function drawChartHover(ctx: CanvasRenderingContext2D) {
      if (!view || hoverX == null || !view.inPlotX(hoverX)) return
      const { pad, w, h } = view
      const idx = view.nearestIdx(hoverX)
      const p = view.pts[idx]
      const vx = view.x(idx)
      const vy = view.y(p.v)

      ctx.save()
      ctx.strokeStyle = CROSSHAIR()
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(Math.round(vx) + 0.5, pad.t)
      ctx.lineTo(Math.round(vx) + 0.5, pad.t + h)
      ctx.stroke()
      ctx.restore()

      ctx.fillStyle = LINE_COLOR()
      ctx.strokeStyle = SURFACE()
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(vx, vy, (view.dotR || 3) + 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      const valText = fmtAuto(p.v)
      const timeText = new Date(new Date(p.t).getTime()).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      ctx.font = `bold 12px ${FONT_STACK}`
      const valW = ctx.measureText(valText).width
      ctx.font = `11px ${FONT_STACK}`
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
      ctx.fillStyle = SURFACE()
      ctx.strokeStyle = SURFACE()
      ctx.lineWidth = 2
      ctx.fillRect(bx, by, bw, bh)
      ctx.strokeRect(bx, by, bw, bh)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = TEXT_FG()
      ctx.font = `bold 12px ${FONT_STACK}`
      ctx.fillText(valText, bx + 8, by + 12)
      ctx.fillStyle = TEXT_MUTED()
      ctx.font = `11px ${MONO_STACK}`
      ctx.fillText(timeText, bx + 8, by + 26)
    }

    // 主图绘制(syncPreview=false 时仅刷新 hover 十字线层)
    function drawChart(syncPreview = true) {
      if (syncPreview) drawChartPreview()
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      const cssW = canvas.clientWidth || 600
      const cssH = canvas.clientHeight || 320
      canvas.width = cssW * dpr
      canvas.height = cssH * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)

      const pts = filterPointsByWindow(points, winStart, winEnd)
      const pad = { l: 64, r: 24, t: 30, b: 46 }
      const w = cssW - pad.l - pad.r
      const h = cssH - pad.t - pad.b

      // 空态
      if (!pts.length) {
        view = null
        ctx.fillStyle = TEXT_DIM()
        ctx.font = `13px ${FONT_STACK}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(
          points.length ? '当前窗口内无采样点' : '暂无余额历史数据（获取余额后自动记录采样点）',
          cssW / 2,
          cssH / 2,
        )
        stats.textContent = '暂无数据'
        return
      }

      const values = pts.map((p) => p.v)
      const times = pts.map((p) => new Date(p.t).getTime())
      const domain = yDomain(values)

      const x = (i: number) => pad.l + (times.length === 1 ? w / 2 : (i / (times.length - 1)) * w)
      const y = (v: number) =>
        pad.t + h - ((v - domain.min) / (domain.max - domain.min)) * h

      view = {
        pts,
        times,
        pad,
        w,
        h,
        x,
        y,
        dotR: 0,
        inPlotX: (px) => px >= pad.l && px <= pad.l + w,
        nearestIdx: (px) =>
          times.length === 1
            ? 0
            : Math.max(
                0,
                Math.min(times.length - 1, Math.round(((px - pad.l) / w) * (times.length - 1))),
              ),
      }

      // Y 轴刻度值格式统一: 按刻度步长取小数位
      const tickCount = 5
      const tickStep = (domain.max - domain.min) / tickCount
      const decimals = tickDecimals(tickStep)
      const fmtTick = (v: number) => v.toFixed(decimals)

      // 网格线 + Y 轴短刻度线 + 右对齐刻度标签
      ctx.font = `12px ${FONT_STACK}`
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      for (let i = 0; i <= tickCount; i++) {
        const tv = domain.max - ((domain.max - domain.min) / tickCount) * i
        const ty = Math.round(pad.t + (h / tickCount) * i) + 0.5
        ctx.strokeStyle = GRID_LINE()
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(pad.l, ty)
        ctx.lineTo(pad.l + w, ty)
        ctx.stroke()
        ctx.strokeStyle = AXIS_TICK()
        ctx.beginPath()
        ctx.moveTo(pad.l - 6, ty)
        ctx.lineTo(pad.l, ty)
        ctx.stroke()
        ctx.fillStyle = TEXT_MUTED()
        ctx.fillText(fmtTick(tv), pad.l - 10, ty)
      }

      // 坐标轴基线(左/下细灰线)
      ctx.strokeStyle = AXIS_BASE()
      ctx.beginPath()
      ctx.moveTo(Math.round(pad.l) + 0.5, pad.t)
      ctx.lineTo(Math.round(pad.l) + 0.5, pad.t + h)
      ctx.lineTo(pad.l + w, pad.t + h)
      ctx.stroke()

      // X 轴时间刻度: 按最小像素间距自适应刻度数, 标签不重叠; 两端锚定防裁切
      let xTickCount = Math.min(6, times.length)
      while (xTickCount > 2 && w / (xTickCount - 1) < 90) xTickCount--
      ctx.font = `12px ${MONO_STACK}`
      ctx.fillStyle = TEXT_MUTED()
      ctx.textBaseline = 'top'
      for (let i = 0; i < xTickCount; i++) {
        const idx = xTickCount === 1 ? 0 : Math.round((i / (xTickCount - 1)) * (times.length - 1))
        const tx = x(idx)
        const label = new Date(times[idx]).toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
        ctx.strokeStyle = AXIS_TICK()
        ctx.beginPath()
        ctx.moveTo(Math.round(tx) + 0.5, pad.t + h)
        ctx.lineTo(Math.round(tx) + 0.5, pad.t + h + 4)
        ctx.stroke()
        ctx.textAlign = i === 0 ? 'left' : i === xTickCount - 1 ? 'right' : 'center'
        const lx = i === 0 ? pad.l : i === xTickCount - 1 ? pad.l + w : tx
        ctx.fillText(label, lx, pad.t + h + 10)
      }

      // 面积填充(先画, 克制的琥珀渐变)
      const gradient = ctx.createLinearGradient(0, pad.t, 0, pad.t + h)
      gradient.addColorStop(0, ACCENT_FADE())
      gradient.addColorStop(1, 'rgba(160, 91, 12, 0)')
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
      ctx.strokeStyle = LINE_COLOR()
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

      // 数据点: 按相邻点 X 像素间距 dx 连续自适应——越密集点半径与描边越向 0 收敛,
      // dx <= DENSE_DX 只画折线不画点, 避免密集描边盖住琥珀折线
      const dx = pts.length > 1 ? w / (pts.length - 1) : Infinity
      const t = densityT(dx)
      const dotR = 5 * t
      const strokeW = 2 * t
      view.dotR = dotR
      if (dotR >= 1) {
        ctx.fillStyle = LINE_COLOR()
        if (strokeW > 0) {
          ctx.strokeStyle = SURFACE()
          ctx.lineWidth = strokeW
        }
        pts.forEach((p, i) => {
          ctx.beginPath()
          ctx.arc(x(i), y(p.v), dotR, 0, Math.PI * 2)
          ctx.fill()
          if (strokeW > 0) ctx.stroke()
        })
      }

      // 首/末值标注: surface 底小块 + 同色描边外扩, 数字加粗清晰
      const labelAt = (idx: number, align: 'left' | 'right') => {
        const p = pts[idx]
        const vx = x(idx)
        const vy = y(p.v)
        const text = fmtAuto(p.v)
        ctx.font = `bold 12px ${FONT_STACK}`
        const tw = ctx.measureText(text).width
        const bw = Math.ceil(tw) + 12
        const bh = 18
        let bx = align === 'left' ? vx - 6 : vx - bw + 6
        bx = Math.max(pad.l, Math.min(bx, pad.l + w - bw))
        const above = vy - bh - 10 >= pad.t
        const by = above ? vy - bh - 10 : vy + 8
        ctx.fillStyle = SURFACE()
        ctx.strokeStyle = SURFACE()
        ctx.lineWidth = 2
        ctx.fillRect(bx, by, bw, bh)
        ctx.strokeRect(bx, by, bw, bh)
        ctx.fillStyle = TEXT_FG()
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

      // 统计摘要(涨跌)
      const first = pts[0].v
      const lastV = pts[pts.length - 1].v
      const diff = lastV - first
      const diffPct = first !== 0 ? (diff / Math.abs(first)) * 100 : 0
      const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→'
      stats.textContent = `${pts.length} 个采样点 · ${arrow} ${diff >= 0 ? '+' : ''}${fmtAuto(diff)} (${diffPct >= 0 ? '+' : ''}${fmtAuto(diffPct)}%)`
    }

    // 预览条: 当前区间(档位选定的时间范围)迷你折线 + 区间内窗口选择
    // 预览条自身的时间轴 = 选定区间(100% 即该区间), 未选中段灰化 / 选中段琥珀 + 边缘手柄
    function drawChartPreview() {
      const ctx = preview.getContext('2d')
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      const cssW = preview.clientWidth || 600
      const cssH = preview.clientHeight || 52
      preview.width = cssW * dpr
      preview.height = cssH * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)

      const rangePts = filterPointsByWindow(points, rngStart, rngEnd)
      const geo = buildRangeGeo(rngStart, rngEnd, cssW)
      if (!geo || !rangePts.length) {
        ctx.fillStyle = TEXT_DIM()
        ctx.font = `12px ${FONT_STACK}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('暂无数据', cssW / 2, cssH / 2)
        return
      }

      const times = rangePts.map((p) => new Date(p.t).getTime())
      const values = rangePts.map((p) => p.v)
      let vmin = Math.min(...values)
      let vmax = Math.max(...values)
      if (vmin === vmax) {
        const s = Math.abs(vmin) * 0.1 || 1
        vmin -= s
        vmax += s
      }
      const padY = 8
      const yOfV = (v: number) => padY + (cssH - padY * 2) * (1 - (v - vmin) / (vmax - vmin))
      const strokeAll = (color: string, width: number) => {
        ctx.strokeStyle = color
        ctx.lineWidth = width
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.beginPath()
        rangePts.forEach((p, i) => {
          const px = geo.xOfTs(times[i])
          const py = yOfV(p.v)
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        })
        ctx.stroke()
      }

      const xs = geo.xOfTs(winStart)
      const xe = geo.xOfTs(winEnd)

      // 未选中区域灰化: 半透明遮罩 + 该段折线重描为灰; 选中段保持琥珀
      // 窗口 = 整个区间(刚切档位)时两端都不灰化 → 预览条 100% 高亮
      const hasLeft = winStart > geo.t0
      const hasRight = winEnd < geo.t1
      ctx.fillStyle = OVERLAY_MASK()
      if (hasLeft) ctx.fillRect(0, 0, xs, cssH)
      if (hasRight) ctx.fillRect(xe, 0, cssW - xe, cssH)
      if (hasLeft || hasRight) {
        ctx.save()
        ctx.beginPath()
        if (hasLeft) ctx.rect(0, 0, xs, cssH)
        if (hasRight) ctx.rect(xe, 0, cssW - xe, cssH)
        ctx.clip()
        strokeAll(DIM_LINE(), 1.5)
        ctx.restore()
      }
      ctx.save()
      ctx.beginPath()
      ctx.rect(xs, 0, Math.max(0, xe - xs), cssH)
      ctx.clip()
      strokeAll(LINE_COLOR(), 1.5)
      ctx.restore()

      // 选中窗口高亮: 细描边框
      ctx.strokeStyle = HANDLE()
      ctx.lineWidth = 1
      ctx.strokeRect(xs + 0.5, 0.5, Math.max(1, xe - xs - 1), cssH - 1)

      // 左右拖动手柄条(5px), hover 变琥珀提示可拖
      const hw = 5
      ctx.fillStyle =
        previewHover === 'l' || previewDrag?.mode === 'l' ? LINE_COLOR() : HANDLE()
      ctx.fillRect(xs, 0, hw, cssH)
      ctx.fillStyle =
        previewHover === 'r' || previewDrag?.mode === 'r' ? LINE_COLOR() : HANDLE()
      ctx.fillRect(xe - hw, 0, hw, cssH)

      // 光标跟随命中区域
      if (!previewDrag) {
        preview.style.cursor =
          previewHover === 'l' || previewHover === 'r'
            ? 'col-resize'
            : previewHover === 'pan'
              ? 'grab'
              : 'default'
      } else {
        preview.style.cursor = previewDrag.mode === 'pan' ? 'grabbing' : 'col-resize'
      }
    }

    // ---- 预览条交互 ----

    const previewRectLeft = () => preview.getBoundingClientRect().left

    const onPreviewPointerDown = (e: PointerEvent) => {
      if (e.isPrimary === false) return
      const rangePts = filterPointsByWindow(points, rngStart, rngEnd)
      const geo = buildRangeGeo(rngStart, rngEnd, preview.clientWidth || 600)
      if (!geo || rangePts.length < 2) return
      const px = e.clientX - previewRectLeft()
      const mode = previewHitMode(px, geo.xOfTs(winStart), geo.xOfTs(winEnd))
      if (!mode) return
      e.preventDefault()
      // 最小窗口与区间内采样点间隔挂钩(保证窗口内至少 2 个采样点)
      previewDrag = { mode, lastTs: null, minWin: minWindowMs(rangePts.length, geo.span) }
      beginDocDrag(
        (ev) => {
          applyPreviewDrag(ev.clientX - previewRectLeft(), geo)
          scheduleRenderCharts()
        },
        () => {
          previewDrag = null
          drawChart()
        },
        e.pointerId,
      )
    }

    // hover 反馈: 光标形态 + 手柄变色
    const onPreviewMouseMove = (e: MouseEvent) => {
      if (previewDrag) return
      const geo = buildRangeGeo(rngStart, rngEnd, preview.clientWidth || 600)
      if (!geo) return
      const px = e.clientX - previewRectLeft()
      const hit = previewHitMode(px, geo.xOfTs(winStart), geo.xOfTs(winEnd))
      if (hit !== previewHover) {
        previewHover = hit
        drawChartPreview()
      }
    }

    const onPreviewMouseLeave = () => {
      if (!previewDrag && previewHover) {
        previewHover = ''
        drawChartPreview()
      }
    }

    // ---- 主图交互 ----

    const canvasRectLeft = () => canvas.getBoundingClientRect().left

    // 未按下移动 = 十字线跟随; 仅绘图区触发, 空态无数据不显示
    const onCanvasMouseMove = (e: MouseEvent) => {
      if (panDrag) return
      const px = e.clientX - canvasRectLeft()
      const inside = Boolean(view && view.inPlotX(px))
      const nextX = inside ? px : null
      if (nextX !== hoverX) {
        hoverX = nextX
        drawChart(false)
      }
      canvas.style.cursor = inside ? 'crosshair' : 'default'
    }

    const onCanvasMouseLeave = () => {
      if (panDrag) return
      if (hoverX != null) {
        hoverX = null
        drawChart(false)
      }
      canvas.style.cursor = 'default'
    }

    // 主图按住平移(鼠标) / 触摸查看+平移(触摸):
    // 鼠标按下即平移; 触摸先显示该点十字线/tooltip, 拖动超阈值后隐藏十字线转平移
    const onCanvasPointerDown = (e: PointerEvent) => {
      const v = view
      if (!v || e.isPrimary === false || points.length < 2) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const rectLeft = canvasRectLeft()
      const px = e.clientX - rectLeft
      const py = e.clientY - canvas.getBoundingClientRect().top
      // 只在绘图区内起拖
      if (!v.inPlotX(px) || py < v.pad.t || py > v.pad.t + v.h) return
      // 平移夹紧基准 = 预览条当前区间(档位选定的范围), 主图拖动不会越出该区间
      const geo = buildRangeGeo(rngStart, rngEnd, preview.clientWidth || 600)
      if (!geo) return
      e.preventDefault()
      const winW0 = winEnd - winStart
      const isMouse = e.pointerType === 'mouse'
      panDrag = {
        startX: px,
        clientX0: e.clientX,
        winStart0: winStart,
        winW: winW0,
        rectLeft,
        py,
        panning: isMouse,
      }
      // 鼠标拖动不显示十字线; 触摸按下立即给出该点十字线+tooltip 反馈
      hoverX = isMouse ? null : px
      if (!isMouse) drawChart(false)
      canvas.style.cursor = isMouse ? 'grabbing' : 'crosshair'

      beginDocDrag(
        (ev) => {
          if (!panDrag || !view) return
          const dx = ev.clientX - panDrag.clientX0
          if (!panDrag.panning) {
            // 触摸未超阈值: 十字线跟随手指(等效 hover), 不平移
            const hpx = ev.clientX - panDrag.rectLeft
            const nextX = view.inPlotX(hpx) ? hpx : null
            if (nextX !== hoverX) {
              hoverX = nextX
              drawChart(false)
            }
            if (Math.hypot(dx, ev.clientY - panDrag.py) < TOUCH_PAN_THRESHOLD) return
            panDrag.panning = true
            hoverX = null
            canvas.style.cursor = 'grabbing'
          }
          // 主图拖动 = 抓内容: 手指右移(dx>0) → 窗口左移 → 内容右移(看更早)
          let s = panDrag.winStart0 - dx * (panDrag.winW / view.w)
          if (s < geo.t0) s = geo.t0
          if (s + panDrag.winW > geo.t1) s = geo.t1 - panDrag.winW
          if (s !== winStart) {
            winStart = s
            winEnd = s + panDrag.winW
            scheduleRenderCharts()
          }
        },
        () => {
          panDrag = null
          hoverX = null
          canvas.style.cursor = 'default'
          drawChart()
        },
        e.pointerId,
      )
    }

    preview.addEventListener('pointerdown', onPreviewPointerDown)
    preview.addEventListener('mousemove', onPreviewMouseMove)
    preview.addEventListener('mouseleave', onPreviewMouseLeave)
    canvas.addEventListener('mousemove', onCanvasMouseMove)
    canvas.addEventListener('mouseleave', onCanvasMouseLeave)
    canvas.addEventListener('pointerdown', onCanvasPointerDown)

    // ---- 数据加载 ----

    const load = async () => {
      stats.textContent = '加载中…'
      try {
        const data = await getHistory(id)
        // 按时间升序排序后重置预览窗口为全选
        points = ((data && data.points) || [])
          .slice()
          .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
        const times = points.map((p) => new Date(p.t).getTime())
        const t0 = times.length ? Math.min(...times) : 0
        const t1 = times.length ? Math.max(...times) : 0
        // 打开弹窗默认落在默认档(数据不足该跨度时自动退化为全长);
        // 数据域交给 React 层(档位按钮可用性 + 自定义输入上下限)
        const win = times.length
          ? presetWindow(DEFAULT_PRESET, t0, t1, Date.now())
          : { start: 0, end: 0 }
        winStart = win.start
        winEnd = win.end
        rngStart = win.start
        rngEnd = win.end
        setDomain(times.length ? { start: t0, end: t1 } : null)
        setPreset(DEFAULT_PRESET)
        setCustomError('')
        setCustomStart(times.length ? toLocalInputValue(win.start) : '')
        setCustomEnd(times.length ? toLocalInputValue(win.end) : '')
        // 弹窗可见后 canvas 才有尺寸, 重绘一次
        requestAnimationFrame(() => drawChart())
      } catch (err) {
        points = []
        winStart = 0
        winEnd = 0
        rngStart = 0
        rngEnd = 0
        setDomain(null)
        setPreset(DEFAULT_PRESET)
        setCustomError('')
        setCustomStart('')
        setCustomEnd('')
        stats.textContent = `加载失败: ${(err as Error).message}`
        drawChart()
      }
    }
    void load()

    return () => {
      preview.removeEventListener('pointerdown', onPreviewPointerDown)
      preview.removeEventListener('mousemove', onPreviewMouseMove)
      preview.removeEventListener('mouseleave', onPreviewMouseLeave)
      canvas.removeEventListener('mousemove', onCanvasMouseMove)
      canvas.removeEventListener('mouseleave', onCanvasMouseLeave)
      canvas.removeEventListener('pointerdown', onCanvasPointerDown)
      if (rafId) cancelAnimationFrame(rafId)
      docCleanup?.()
      chartApiRef.current = null
    }
  }, [id])

  // ---- 时间范围档位(React 层): 预设 = 计算窗口并交给图表闭包应用 ----

  const selectPreset = (key: RangePreset) => {
    if (!domain) return
    if (key === 'custom') {
      // 自定义档: 以当前窗口为准(预览条整条切到该窗口), 输入框回填供微调
      const win = chartApiRef.current?.getWindow()
      if (win) {
        chartApiRef.current?.applyWindow(win.start, win.end)
        setCustomStart(toLocalInputValue(win.start))
        setCustomEnd(toLocalInputValue(win.end))
      }
      setCustomError('')
      setPreset('custom')
      return
    }
    const win = presetWindow(key, domain.start, domain.end, Date.now())
    chartApiRef.current?.applyWindow(win.start, win.end)
    setCustomError('')
    setPreset(key)
  }

  const applyCustomRange = () => {
    if (!domain) return
    const start = parseLocalInputValue(customStart)
    const end = parseLocalInputValue(customEnd)
    if (start == null || end == null) {
      setCustomError('请填写完整的起止时间')
      return
    }
    if (start >= end) {
      setCustomError('起始时间需早于结束时间')
      return
    }
    // 夹紧到数据域; 完全落在域外会塌缩成空窗口 → 提示无数据
    const win = clampWindow({ start, end }, domain.start, domain.end)
    if (win.end <= win.start) {
      setCustomError('所选区间内没有采样数据')
      return
    }
    chartApiRef.current?.applyWindow(win.start, win.end)
    setCustomError('')
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
          <span className="modal__title">余额变化趋势 — {name}</span>
          <button type="button" className="modal__close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="chart-toolbar">
          <div className="chart-range" role="group" aria-label="时间范围">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`chart-range__btn${preset === p.key ? ' is-active' : ''}`}
                aria-pressed={preset === p.key}
                disabled={!domain}
                onClick={() => selectPreset(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <span ref={statsRef} className="form__msg chart-stats" />
        </div>
        {preset === 'custom' && domain && (
          <div className="chart-custom">
            <label className="chart-custom__field">
              <span className="chart-custom__label">起</span>
              <input
                type="datetime-local"
                className="chart-custom__input"
                value={customStart}
                min={toLocalInputValue(domain.start)}
                max={toLocalInputValue(domain.end)}
                onChange={(e) => {
                  setCustomStart(e.target.value)
                  setCustomError('')
                }}
              />
            </label>
            <label className="chart-custom__field">
              <span className="chart-custom__label">止</span>
              <input
                type="datetime-local"
                className="chart-custom__input"
                value={customEnd}
                min={toLocalInputValue(domain.start)}
                max={toLocalInputValue(domain.end)}
                onChange={(e) => {
                  setCustomEnd(e.target.value)
                  setCustomError('')
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn--ghost chart-custom__apply"
              onClick={applyCustomRange}
            >
              应用
            </button>
            {customError ? <span className="chart-custom__msg">{customError}</span> : null}
          </div>
        )}
        <div className="chart-wrap">
          <canvas ref={canvasRef} className="chart-canvas" />
        </div>
        <div className="chart-preview-wrap" title="拖动窗口两端或内部，选择主图时间范围">
          <canvas ref={previewRef} className="chart-preview" />
        </div>
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
