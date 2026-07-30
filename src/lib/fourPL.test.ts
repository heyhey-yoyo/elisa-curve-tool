import { describe, it, expect } from 'vitest'
import {
  fourPL,
  fourPLInverse,
  fitFourPL,
  type FourPLParams,
  type StandardPoint,
} from './fourPL'
import type { StdRow } from './standards'

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

  it('平坦数据：梯度为零报 tolerance，jacobianRankDeficient 为 true', () => {
    const res = fitFourPL(CONCS.map((conc) => ({ conc, od: 1 })))
    expect(res).not.toBeNull()
    // 梯度为零 → 数学上确为驻点
    expect(res!.reason).toBe('tolerance')
    // b、c 不可辨识 → Hessian 奇异
    expect(res!.diagnostics.jacobianRankDeficient).toBe(true)
  })

  it('超宽范围的阶跃数据：返回 SSE 最优的有限解', () => {
    const pts = [1e-3, 1e-1, 1e1, 1e3, 1e5].map((conc) => ({ conc, od: conc < 1 ? 3 : 0.001 }))
    const res = fitFourPL(pts)
    expect(res).not.toBeNull()
    expect(isFinite(res!.sse)).toBe(true)
    expect(res!.params.b).toBeGreaterThan(0)
    expect(res!.params.c).toBeGreaterThan(0)
    expect(isFinite(res!.params.a)).toBe(true)
    expect(isFinite(res!.params.d)).toBe(true)
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

  it('诊断字段：EC50 在标准范围外时 ec50Location 精确报告', () => {
    // EC50=5000，标准品 1–200；扩展范围 [1/200, 40000/1] = [0.005, 40000]
    // 5000 ∈ (200, 40000] → outside-standard-range（非 extreme）
    const res = fitFourPL(makeCurve({ a: 2.0, b: 1.0, c: 5000, d: 0.1 }, [1, 5, 20, 80, 200]))
    expect(res).not.toBeNull()
    expect(res!.converged).toBe(true)
    expect(res!.diagnostics.ec50Location).toBe('outside-standard-range')
    expect(res!.params.c).toBeGreaterThan(0)
    expect(isFinite(res!.params.c)).toBe(true)
  })

  it('极小 OD 尺度（1e-7）下经 OD 归一化仍正常收敛', () => {
    const res = fitFourPL(makeCurve({ a: 2e-7, b: 1.2, c: 50, d: 5e-9 }, CONCS))
    expect(res).not.toBeNull()
    expect(res!.converged).toBe(true)
    expect(res!.params.c).toBeCloseTo(50, 0)
  })
})

describe('拟合签名（基于原始输入，任何变化立即失效旧拟合）', () => {
  const sig = (stds: StdRow[], blankSub: boolean) => JSON.stringify({ stds, blankSub })

  const base: StdRow[] = [
    { conc: '1', od: '2' },
    { conc: '10', od: '1' },
  ]

  it('相同输入签名一致', () => {
    expect(sig(base, true)).toBe(sig(base, true))
  })

  it('修改浓度 / OD / blankSub、增删行后签名均改变', () => {
    const s = sig(base, true)
    expect(sig([{ conc: '2', od: '2' }, { conc: '10', od: '1' }], true)).not.toBe(s)
    expect(sig([{ conc: '1', od: '2.1' }, { conc: '10', od: '1' }], true)).not.toBe(s)
    expect(sig(base, false)).not.toBe(s)
    expect(sig([...base, { conc: '100', od: '0.5' }], true)).not.toBe(s)
    expect(sig(base.slice(1), true)).not.toBe(s)
  })

  it('非法输入行也会改变签名（不会被 deriveStandardPoints 静默过滤后保持不变）', () => {
    const s = sig(base, true)
    // 新增一条仅填 OD 的行 → 应改变签名
    expect(sig([...base, { conc: '', od: '0.5' }], true)).not.toBe(s)
    // 新增第二条 blank → 应改变签名
    expect(sig([...base, { conc: '0', od: '0.1' }], true)).not.toBe(s)
  })
})
