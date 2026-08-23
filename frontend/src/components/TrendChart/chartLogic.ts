// 趋势图纯逻辑: 几何映射/窗口筛选/命中判定/拖拽夹紧/密集点自适应
// 抽成纯函数便于单元测试 (语义与旧 app.js 逐行等价)

export interface SamplePoint {
  v: number
  t: string
}

export interface PreviewGeo {
  t0: number
  t1: number
  span: number
  padX: number
  innerW: number
  cssW: number
  xOfTs(ts: number): number
  tsOfX(px: number): number
}

// 全量时间轴几何映射(像素 <-> ms), 供预览绘制与拖拽共用
export function buildPreviewGeo(points: SamplePoint[], cssW: number): PreviewGeo | null {
  if (!points.length || cssW <= 0) return null
  const times = points.map((p) => new Date(p.t).getTime())
  const t0 = Math.min(...times)
  const t1 = Math.max(...times)
  const padX = 6
  const innerW = Math.max(1, cssW - padX * 2)
  const span = Math.max(1, t1 - t0)
  return {
    t0,
    t1,
    span,
    padX,
    innerW,
    cssW,
    xOfTs: (ts) => padX + ((ts - t0) / span) * innerW,
    tsOfX: (px) =>
      t0 + ((Math.min(Math.max(px, padX), cssW - padX) - padX) / innerW) * span,
  }
}

// 最小窗口宽度: 2 个采样点间隔 与 总宽 2% 取较小约束
export function minWindowMs(pointCount: number, span: number): number {
  const twoPts = pointCount > 1 ? span / (pointCount - 1) : span
  return Math.min(twoPts, span * 0.02)
}

// 主图取数按窗口区间筛选: 取 t>=start 的最小索引 到 t<=end 的最大索引(宁多勿截断)
export function filterPointsByWindow(
  points: SamplePoint[],
  winStart: number,
  winEnd: number,
): SamplePoint[] {
  if (!points.length) return points
  const times = points.map((p) => new Date(p.t).getTime())
  let lo = -1
  for (let i = 0; i < times.length; i++) {
    if (times[i] >= winStart) {
      lo = i
      break
    }
  }
  let hi = -1
  for (let i = times.length - 1; i >= 0; i--) {
    if (times[i] <= winEnd) {
      hi = i
      break
    }
  }
  if (lo === -1 || hi === -1 || hi < lo) return []
  return points.slice(lo, hi + 1)
}

export type PreviewHitMode = 'l' | 'r' | 'pan' | ''

// 命中判定: 左右边缘(容差内) -> 边缘拖拽; 窗口内部 -> 整体平移; 两端重合时取较近侧
export const PREVIEW_HIT_TOLERANCE = 7

export function previewHitMode(px: number, xs: number, xe: number): PreviewHitMode {
  const tol = PREVIEW_HIT_TOLERANCE
  if (Math.abs(px - xs) <= tol && Math.abs(px - xe) <= tol) {
    return px > (xs + xe) / 2 ? 'r' : 'l'
  }
  if (Math.abs(px - xs) <= tol) return 'l'
  if (Math.abs(px - xe) <= tol) return 'r'
  if (px > xs && px < xe) return 'pan'
  return ''
}

// 平移后窗口起点夹紧到 [t0, t1-winW]
export function clampPanStart(s: number, winW: number, t0: number, t1: number): number {
  let start = s
  if (start < t0) start = t0
  if (start + winW > t1) start = t1 - winW
  return start
}

// 左端拖拽: 夹紧 [t0, winEnd-minWin]
export function clampLeftEdge(ts: number, t0: number, winEnd: number, minWin: number): number {
  return Math.min(Math.max(ts, t0), winEnd - minWin)
}

// 右端拖拽: 夹紧 [winStart+minWin, t1]
export function clampRightEdge(ts: number, t1: number, winStart: number, minWin: number): number {
  return Math.max(Math.min(ts, t1), winStart + minWin)
}

// 密集点渲染自适应: 按相邻点 X 像素间距收敛点半径/白描边
// dx<=DENSE 只画线不画点(白描边先消失), >=SPARSE 满尺寸点(5px + 2px 白描边)
export const DENSE_DX = 5
export const SPARSE_DX = 10

export function densityT(dx: number): number {
  return Math.min(1, Math.max(0, (dx - DENSE_DX) / (SPARSE_DX - DENSE_DX)))
}

// Y 轴域: 极值外扩 10%(等值时以 10% 幅度或 1 展开再外扩)
export function yDomain(values: number[]): { min: number; max: number } {
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (min === max) {
    const span = Math.abs(min) * 0.1 || 1
    min -= span
    max += span
  }
  const padScale = (max - min) * 0.1 || 1
  return { min: min - padScale, max: max + padScale }
}

// Y 轴刻度值格式统一: 按刻度步长取小数位
export function tickDecimals(step: number): number {
  return step >= 1 ? 0 : step >= 0.1 ? 1 : 2
}
