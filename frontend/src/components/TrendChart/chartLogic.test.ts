import { describe, expect, it } from 'vitest'
import {
  buildPreviewGeo,
  clampLeftEdge,
  clampPanStart,
  clampRightEdge,
  densityT,
  DENSE_DX,
  SPARSE_DX,
  filterPointsByWindow,
  minWindowMs,
  previewHitMode,
  tickDecimals,
  yDomain,
  type SamplePoint,
} from './chartLogic'

// 构造等间隔采样点: t 从 base 开始每 step ms 一个
function pts(n: number, step = 60_000, vFn?: (i: number) => number): SamplePoint[] {
  const base = Date.UTC(2026, 0, 1)
  return Array.from({ length: n }, (_, i) => ({
    v: vFn ? vFn(i) : i,
    t: new Date(base + i * step).toISOString(),
  }))
}

describe('buildPreviewGeo', () => {
  it('空数据返回 null', () => {
    expect(buildPreviewGeo([], 600)).toBeNull()
  })

  it('xOfTs/tsOfX 互逆且两端对齐 padX', () => {
    const points = pts(3)
    const geo = buildPreviewGeo(points, 612)!
    expect(geo.t0).toBe(Date.parse(points[0].t))
    expect(geo.t1).toBe(Date.parse(points[2].t))
    expect(geo.xOfTs(geo.t0)).toBeCloseTo(6)
    expect(geo.xOfTs(geo.t1)).toBeCloseTo(606)
    // 往返映射(边缘夹紧内)
    const mid = (geo.t0 + geo.t1) / 2
    expect(geo.tsOfX(geo.xOfTs(mid))).toBeCloseTo(mid)
  })

  it('tsOfX 超出画布时夹紧到 [padX, cssW-padX]', () => {
    const geo = buildPreviewGeo(pts(2), 600)!
    expect(geo.tsOfX(-50)).toBe(geo.t0)
    expect(geo.tsOfX(9999)).toBe(geo.t1)
  })

  it('单点/零跨度时 span 兜底为 1', () => {
    const p = pts(1)
    const geo = buildPreviewGeo(p, 600)!
    expect(geo.span).toBe(1)
  })
})

describe('minWindowMs', () => {
  it('两点间隔小于总宽 2% 时取间隔', () => {
    // 10 点, span=9*100=900, 两点间隔=100, 2%*900=18 → 取 18? 不: min(100,18)=18
    expect(minWindowMs(10, 900)).toBe(18)
  })
  it('两点间隔大于总宽 2% 时取 2%', () => {
    // 3 点, span=2000, 间隔=1000, 2%=40 → 取 40
    expect(minWindowMs(3, 2000)).toBe(40)
  })
  it('单点时退化为 span', () => {
    expect(minWindowMs(1, 500)).toBe(Math.min(500, 10))
  })
})

describe('filterPointsByWindow', () => {
  const data = pts(5) // t0..t4 等距

  it('全窗口返回全部', () => {
    const t0 = Date.parse(data[0].t)
    const t4 = Date.parse(data[4].t)
    expect(filterPointsByWindow(data, t0, t4)).toHaveLength(5)
  })

  it('闭区间: 边界上的点被包含(宁多勿截断)', () => {
    const t1 = Date.parse(data[1].t)
    const t3 = Date.parse(data[3].t)
    const got = filterPointsByWindow(data, t1, t3)
    expect(got.map((p) => p.v)).toEqual([1, 2, 3])
  })

  it('窗口边界落在间隙中时取外侧相邻点', () => {
    const t15 = (Date.parse(data[1].t) + Date.parse(data[2].t)) / 2
    const t35 = (Date.parse(data[3].t) + Date.parse(data[4].t)) / 2
    expect(filterPointsByWindow(data, t15, t35).map((p) => p.v)).toEqual([2, 3])
  })

  it('完全不相交返回空数组', () => {
    const far = Date.parse(data[4].t) + 999_999
    expect(filterPointsByWindow(data, far, far + 1)).toEqual([])
  })

  it('空输入返回空', () => {
    expect(filterPointsByWindow([], 0, 1)).toEqual([])
  })
})

describe('previewHitMode', () => {
  it('左右容差(7px)内命中手柄', () => {
    expect(previewHitMode(100 - 7, 100, 300)).toBe('l')
    expect(previewHitMode(100 - 8, 100, 300)).toBe('')
    expect(previewHitMode(300 + 7, 100, 300)).toBe('r')
    expect(previewHitMode(300 + 8, 100, 300)).toBe('')
  })

  it('两端重合(极窄窗口)时按中点分侧', () => {
    // xs=xe=200: px=196 在中点左侧 → l; px=204 → r
    expect(previewHitMode(196, 200, 200)).toBe('l')
    expect(previewHitMode(204, 200, 200)).toBe('r')
  })

  it('窗口内部命中 pan, 外部为空', () => {
    expect(previewHitMode(150, 100, 300)).toBe('pan')
    expect(previewHitMode(50, 100, 300)).toBe('')
    expect(previewHitMode(350, 100, 300)).toBe('')
  })
})

describe('拖拽夹紧', () => {
  it('clampPanStart: 夹紧到 [t0, t1-winW]', () => {
    expect(clampPanStart(-50, 100, 0, 1000)).toBe(0)
    expect(clampPanStart(950, 100, 0, 1000)).toBe(900)
    expect(clampPanStart(400, 100, 0, 1000)).toBe(400)
  })

  it('clampLeftEdge: 夹紧到 [t0, winEnd-minWin]', () => {
    expect(clampLeftEdge(-10, 0, 500, 20)).toBe(0)
    expect(clampLeftEdge(480, 0, 500, 20)).toBe(480) // winEnd-minWin
    expect(clampLeftEdge(999, 0, 500, 20)).toBe(480)
    expect(clampLeftEdge(250, 0, 500, 20)).toBe(250)
  })

  it('clampRightEdge: 夹紧到 [winStart+minWin, t1]', () => {
    expect(clampRightEdge(2000, 1000, 0, 20)).toBe(1000)
    expect(clampRightEdge(5, 1000, 0, 20)).toBe(20)
    expect(clampRightEdge(700, 1000, 0, 20)).toBe(700)
  })
})

describe('densityT 密集点自适应', () => {
  it('阈值常量与旧实现一致', () => {
    expect(DENSE_DX).toBe(5)
    expect(SPARSE_DX).toBe(10)
  })
  it('dx<=DENSE 收敛为 0(只画线), dx>=SPARSE 满尺寸', () => {
    expect(densityT(3)).toBe(0)
    expect(densityT(DENSE_DX)).toBe(0)
    expect(densityT(SPARSE_DX)).toBe(1)
    expect(densityT(50)).toBe(1)
  })
  it('中间线性插值', () => {
    expect(densityT(7.5)).toBeCloseTo(0.5)
  })
})

describe('yDomain', () => {
  it('极值外扩 10%', () => {
    const { min, max } = yDomain([0, 100])
    expect(min).toBeCloseTo(-10)
    expect(max).toBeCloseTo(110)
  })

  it('等值时以 10% 幅度展开再外扩 10%', () => {
    // span=50*0.1=5 → [45,55]; 再外扩 (10)*0.1=1 → [44,56]
    const { min, max } = yDomain([50, 50])
    expect(min).toBeCloseTo(44)
    expect(max).toBeCloseTo(56)
  })

  it('零值等值时以 1 展开再外扩', () => {
    const { min, max } = yDomain([0, 0])
    expect(min).toBeLessThan(0)
    expect(max).toBeGreaterThan(0)
  })
})

describe('tickDecimals', () => {
  it('按步长档位取小数位', () => {
    expect(tickDecimals(1)).toBe(0)
    expect(tickDecimals(5)).toBe(0)
    expect(tickDecimals(0.5)).toBe(1)
    expect(tickDecimals(0.09)).toBe(2)
    expect(tickDecimals(0.01)).toBe(2)
  })
})
