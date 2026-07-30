import { describe, it, expect } from 'vitest'
import {
  fourPL,
  fourPLInverse,
  fitFourPL,
  standardsSignature,
  type FourPLParams,
  type StandardPoint,
} from './fourPL'

/** 可复现的伪随机数（[-0.5, 0.5)） */
const makeRand = () => {
  let seed = 42
  return () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 - 0.5
}

/** 由已知参数生成标准品数据，可加噪声、可设复孔数 */
function makeCurve(p: FourPLParams, concs: number[], noise = 0, reps = 1): StandardPoint[] {
  const rand = makeRand()
  return concs.flatMap((conc) =>
    Array.from({ length: reps }, () => ({ conc, od: fourPL(conc, p) + rand() * noise })),
  )
}

const DESCENDING: FourPLParams = { a: 2.5, b: 1.2, c: 50, d: 0.05 } // 降低曲线：a > d
const ASCENDING: FourPLParams = { a: 0.05, b: 1.1, c: 30, d: 2.2 } // 升高曲线：a < d
const CONCS = [1.37, 4.12, 12.35, 37.04, 111.1, 333.3, 1000]

describe('fourPL / fourPLInverse', () => {
  it('反函数往返：fourPLInverse(fourPL(x)) ≈ x（降低曲线）', () => {
    for (const x of CONCS) {
      const back = fourPLInverse(fourPL(x, DESCENDING), DESCENDING)
      expect(back).not.toBeNull()
      expect(back!).toBeCloseTo(x, 6)
    }
  })

  it('反函数往返：fourPLInverse(fourPL(x)) ≈ x（升高曲线）', () => {
    for (const x of CONCS) {
      const back = fourPLInverse(fourPL(x, ASCENDING), ASCENDING)
      expect(back).not.toBeNull()
      expect(back!).toBeCloseTo(x, 6)
    }
  })

  it('超出曲线范围的 OD 返回 null（高于上渐近线 / 低于下渐近线 / 恰好等于渐近线）', () => {
    expect(fourPLInverse(DESCENDING.a + 0.5, DESCENDING)).toBeNull()
    expect(fourPLInverse(DESCENDING.d - 0.01, DESCENDING)).toBeNull()
    expect(fourPLInverse(DESCENDING.d, DESCENDING)).toBeNull()
    expect(fourPLInverse(DESCENDING.a, DESCENDING)).toBeNull()
  })
})

describe('fitFourPL', () => {
  it('拟合降低曲线：还原参数，b > 0、c > 0，收敛原因为 tolerance', () => {
    const res = fitFourPL(makeCurve(DESCENDING, CONCS, 0.02, 2))
    expect(res).not.toBeNull()
    expect(res!.converged).toBe(true)
    expect(res!.reason).toBe('tolerance')
    expect(res!.rSquared).toBeGreaterThan(0.999)
    expect(res!.params.b).toBeGreaterThan(0)
    expect(res!.params.c).toBeGreaterThan(0)
    expect(res!.params.c).toBeCloseTo(DESCENDING.c, -1) // EC50 误差 < 10%
    expect(res!.params.a).toBeGreaterThan(res!.params.d)
    expect(res!.rmse).toBeGreaterThan(0)
    expect(res!.sse).toBeCloseTo(res!.rmse ** 2 * CONCS.length * 2, 6)
  })

  it('拟合升高曲线（a < d）：不依赖负的 b 表示方向', () => {
    const res = fitFourPL(makeCurve(ASCENDING, CONCS, 0.02, 2))
    expect(res).not.toBeNull()
    expect(res!.converged).toBe(true)
    expect(res!.rSquared).toBeGreaterThan(0.999)
    expect(res!.params.b).toBeGreaterThan(0)
    expect(res!.params.a).toBeLessThan(res!.params.d)
    expect(res!.params.c).toBeCloseTo(ASCENDING.c, -1)
  })

  it('无噪声数据可精确还原参数', () => {
    const res = fitFourPL(makeCurve(DESCENDING, CONCS))
    expect(res).not.toBeNull()
    expect(res!.converged).toBe(true)
    expect(res!.params.c).toBeCloseTo(DESCENDING.c, 4)
    expect(res!.params.b).toBeCloseTo(DESCENDING.b, 3)
  })

  it('少于 5 个不同浓度时返回 null（4 个浓度 × 3 复孔 = 12 个点也不行）', () => {
    const pts = [10, 50, 200, 1000].flatMap((conc) =>
      Array.from({ length: 3 }, () => ({ conc, od: 1 + conc / 2000 })),
    )
    expect(fitFourPL(pts)).toBeNull()
  })

  it('复孔保留参与拟合：5 个浓度 × 3 复孔可以正常拟合', () => {
    const res = fitFourPL(makeCurve(DESCENDING, CONCS.slice(0, 5), 0.02, 3))
    expect(res).not.toBeNull()
    expect(res!.converged).toBe(true)
    expect(res!.residuals).toHaveLength(15)
  })

  it('无法收敛：完全平坦的数据（b、c 不可辨识）报 singular 且 converged 为 false', () => {
    const res = fitFourPL(CONCS.map((conc) => ({ conc, od: 1 })))
    expect(res).not.toBeNull()
    expect(res!.converged).toBe(false)
    expect(res!.reason).toBe('singular')
  })

  it('超宽范围的阶跃数据：可用大斜率通过阶跃，应能收敛但 R² 较低', () => {
    const pts = [1e-3, 1e-1, 1e1, 1e3, 1e5].map((conc) => ({ conc, od: conc < 1 ? 3 : 0.001 }))
    const res = fitFourPL(pts)
    expect(res).not.toBeNull()
    // 去掉 logC 硬边界后，优化器可用大斜率（b 很大）逼近阶跃，应正常收敛
    expect(res!.converged).toBe(true)
    expect(res!.reason).toBe('tolerance')
    // 阶跃毕竟不是真正的 S 形，R² 不会特别高
    expect(res!.rSquared).toBeLessThan(0.999)
  })

  it('浅斜率曲线（b≈0.32，采样未覆盖两端）正常收敛，EC50 位置通过诊断字段报告', () => {
    const res = fitFourPL(makeCurve({ a: 2.0, b: 0.32, c: 50, d: 0.1 }, [0.38, 3.8, 38, 380, 1810]))
    expect(res).not.toBeNull()
    expect(res!.converged).toBe(true)
    expect(res!.reason).toBe('tolerance')
    expect(res!.rSquared).toBeGreaterThan(0.999)
    // 无噪声数据应精确还原参数，EC50 应在标准浓度范围内
    expect(res!.diagnostics.ec50Location).toBe('inside-standard-range')
    expect(res!.params.c).toBeCloseTo(50, -1)
  })

  it('诊断字段：EC50 在标准范围外时 ec50Location 报告异常', () => {
    // EC50=5000，但标准品只覆盖 1–200（5 个浓度满足最低要求）
    const res = fitFourPL(makeCurve({ a: 2.0, b: 1.0, c: 5000, d: 0.1 }, [1, 5, 20, 80, 200]))
    expect(res).not.toBeNull()
    expect(res!.converged).toBe(true)
    const loc = res!.diagnostics.ec50Location
    // EC50=5000 远超 maxC=200，应在扩展范围之外
    expect(loc === 'outside-standard-range' || loc === 'extreme').toBe(true)
  })

  it('极小 OD 尺度（1e-7）下经 OD 归一化仍正常收敛', () => {
    const res = fitFourPL(makeCurve({ a: 2e-7, b: 1.2, c: 50, d: 5e-9 }, CONCS))
    expect(res).not.toBeNull()
    expect(res!.converged).toBe(true)
    expect(res!.params.c).toBeCloseTo(50, 0)
  })
})

describe('standardsSignature（标准品修改后拟合失效）', () => {
  const pts: StandardPoint[] = [
    { conc: 1, od: 2 },
    { conc: 10, od: 1 },
  ]

  it('相同输入签名一致', () => {
    expect(standardsSignature(pts, 0.05)).toBe(standardsSignature(pts, 0.05))
  })

  it('修改浓度 / OD / 空白值、增删数据点后签名均改变', () => {
    const base = standardsSignature(pts, 0.05)
    expect(standardsSignature([{ conc: 2, od: 2 }, { conc: 10, od: 1 }], 0.05)).not.toBe(base)
    expect(standardsSignature([{ conc: 1, od: 2.1 }, { conc: 10, od: 1 }], 0.05)).not.toBe(base)
    expect(standardsSignature(pts, 0.06)).not.toBe(base)
    expect(standardsSignature([...pts, { conc: 100, od: 0.5 }], 0.05)).not.toBe(base)
    expect(standardsSignature(pts.slice(1), 0.05)).not.toBe(base)
  })
})
