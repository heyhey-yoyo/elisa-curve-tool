/**
 * 四参数 Logistic (4PL) 曲线拟合引擎
 *
 * 模型: y = d + (a - d) / (1 + (x / c)^b)
 *   a — 低浓度端响应（x→0 时的响应）
 *   d — 高浓度端响应（x→∞ 时的响应）
 *   b — 曲线陡峭程度（Hill 斜率，约定恒为正值）
 *   c — EC50（半最大效应浓度，约定恒为正值）
 *
 * 曲线方向不由 b 的正负表示，而由 a 与 d 的大小关系决定：
 *   a > d — 降低曲线；a < d — 升高曲线
 *
 * 采用 Levenberg-Marquardt 算法在对数浓度空间拟合，内部参数为
 * [a, logB, logC, d]，通过对数参数化保证 b > 0、c > 0，支持复孔。
 */

export interface FourPLParams {
  a: number
  b: number
  c: number
  d: number
}

/** 拟合结束原因 */
export type FitReason =
  | 'tolerance' // 达到误差阈值，正常收敛
  | 'max-iterations' // 达到最大迭代次数
  | 'singular' // 矩阵奇异，无法求解
  | 'no-improvement' // 多次迭代仍无改善

/** EC50 相对标准品浓度范围的位置 */
export type EC50Location =
  | 'inside-standard-range' // EC50 落在 [minC, maxC] 内
  | 'outside-standard-range' // EC50 在扩展范围 [minC²/maxC, maxC²/minC] 内，但超出标准范围
  | 'extreme' // EC50 超出扩展范围，曲线在实测区间内接近直线

export interface FitDiagnostics {
  /** EC50 与实验取样范围的关系 */
  ec50Location: EC50Location
  /** 驻点处近似 Hessian (JᵀJ) 是否接近奇异（参数可辨识性存疑） */
  jacobianRankDeficient: boolean
}

export interface FitResult {
  params: FourPLParams
  sse: number
  rmse: number
  rSquared: number
  residuals: number[]
  fitted: number[]
  converged: boolean
  reason: FitReason
  /** 拟合质量诊断（拟合后评价，不参与优化过程） */
  diagnostics: FitDiagnostics
}

export interface StandardPoint {
  conc: number
  od: number
}

/**
 * 4PL 正向函数。
 * 使用与内部 model() 相同的分支 Logistic，避免 Math.pow 在极端 b/c 下溢出/下溢/NaN。
 */
export function fourPL(x: number, p: FourPLParams): number {
  const s = p.b * (Math.log(x) - Math.log(p.c))
  if (!isFinite(s)) {
    if (Number.isNaN(s)) return (p.a + p.d) / 2
    return s > 0 ? p.d : p.a
  }
  let w: number
  if (s >= 0) {
    w = Math.exp(-s) / (1 + Math.exp(-s))
  } else {
    w = 1 / (1 + Math.exp(s))
  }
  return p.d + (p.a - p.d) * w
}

/** 4PL 反函数: 由 OD 求浓度；超出渐近线区间返回 null */
export function fourPLInverse(y: number, p: FourPLParams): number | null {
  // 与 (a-d)/(y-d) - 1 等价的写法，避免 y 接近 a 时的灾难性抵消
  const ratio = (p.a - y) / (y - p.d)
  if (!isFinite(ratio) || ratio <= 0) return null
  const x = p.c * Math.pow(ratio, 1 / p.b)
  return isFinite(x) ? x : null
}

/** 自动初始值估计（b 恒为正，曲线方向由 a、d 的大小关系决定） */
function initialGuess(points: StandardPoint[]): FourPLParams {
  const sorted = [...points].sort((s, t) => s.conc - t.conc)
  const ods = sorted.map((p) => p.od)
  const minOD = Math.min(...ods)
  const maxOD = Math.max(...ods)

  // 判断曲线方向：低浓度端 OD 更高 → a > d（降低曲线），反之为升高曲线
  const lowEnd = ods[0]
  const highEnd = ods[ods.length - 1]
  const descending = lowEnd > highEnd

  const a = descending ? maxOD : minOD
  const d = descending ? minOD : maxOD
  const mid = (a + d) / 2

  // 找最接近中间响应的浓度作为 c 的初始值
  let c = sorted[Math.floor(sorted.length / 2)].conc
  let best = Infinity
  for (const p of sorted) {
    const dist = Math.abs(p.od - mid)
    if (dist < best) {
      best = dist
      c = p.conc
    }
  }
  return { a, b: 1, c: c > 0 ? c : 1, d }
}

/**
 * 数值稳定的 4PL 模型计算。
 * q = [a, logB, logC, d]，其中 b = exp(logB) > 0, c = exp(logC) > 0。
 *
 * 令 s = b × (logX − logC)，则 y = d + (a − d) / (1 + exp(s))。
 * 使用分支避免 exp(s) 上溢 / 下溢导致的 NaN：
 *   s ≥ 0 → w = exp(−s) / (1 + exp(−s))
 *   s < 0 → w = 1 / (1 + exp(s))
 *   s = NaN（b = Infinity 且 logX = logC 时出现）→ 返回 (a+d)/2
 */
function model(logX: number, q: [number, number, number, number]): number {
  const [a, logB, logC, d] = q
  const b = Math.exp(logB)
  const s = b * (logX - logC)

  if (!isFinite(s)) {
    // s = NaN（0 × Infinity：b 无限且恰好在 EC50 处）→ 曲线中点
    // s = ±Infinity（b 极大且不在 EC50 处）→ 上述分支自然处理
    if (Number.isNaN(s)) return (a + d) / 2
    return s > 0 ? d : a
  }

  let w: number
  if (s >= 0) {
    w = Math.exp(-s) / (1 + Math.exp(-s))
  } else {
    w = 1 / (1 + Math.exp(s))
  }
  return d + (a - d) * w
}

/**
 * 同时计算模型值与解析梯度（对 q 各分量的偏导数）。
 * 返回 [y, ∂y/∂a, ∂y/∂(logB), ∂y/∂(logC), ∂y/∂d]。
 *
 * 梯度公式（令 w = 1/(1+exp(s)), s = b×(logX−logC)）：
 *   ∂y/∂a = w
 *   ∂y/∂d = 1 − w
 *   ∂y/∂(logB) = −(a−d) × w(1−w) × s
 *   ∂y/∂(logC) = (a−d) × w(1−w) × b
 *
 * w(1−w) 通过 exp(−|s|)/(1+exp(−|s|))² 稳定计算，避免 0×∞ = NaN。
 */
function modelWithGrad(
  logX: number,
  q: [number, number, number, number],
): [number, number, number, number, number] {
  const [a, logB, logC, d] = q
  const b = Math.exp(logB)
  const s = b * (logX - logC)

  if (!isFinite(s)) {
    if (Number.isNaN(s)) {
      // b = Infinity 且恰在 EC50 处：y = (a+d)/2，梯度 w.r.t. logB/logC 无定义，设 0
      return [(a + d) / 2, 0.5, 0, 0, 0.5]
    }
    // s = ±Infinity：处于渐近线，所有导数为 0
    if (s > 0) return [d, 0, 0, 0, 1]
    return [a, 1, 0, 0, 0]
  }

  // |s| 极大时 w(1−w) 在双精度下已退化为 0，直接设导数为零，避免无效计算
  if (Math.abs(s) > 700) {
    if (s > 0) return [d, 0, 0, 0, 1]
    return [a, 1, 0, 0, 0]
  }

  let w: number, w1mw: number // w(1−w)
  if (s >= 0) {
    const es = Math.exp(-s) // es ∈ (0, 1]
    const denom = 1 + es
    w = es / denom
    w1mw = es / (denom * denom)
  } else {
    const es = Math.exp(s) // es ∈ (0, 1)
    const denom = 1 + es
    w = 1 / denom
    w1mw = es / (denom * denom)
  }

  const y = d + (a - d) * w
  const da = w
  const dd = 1 - w
  const dlogB = -(a - d) * w1mw * s
  const dlogC = (a - d) * w1mw * b

  return [y, da, dlogB, dlogC, dd]
}

function toParams(q: [number, number, number, number]): FourPLParams {
  return { a: q[0], b: Math.exp(q[1]), c: Math.exp(q[2]), d: q[3] }
}

/** 高斯消元解 4x4 线性方程组 */
function solve4(A: number[][], b: number[]): number[] | null {
  const n = 4
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    if (Math.abs(M[piv][col]) < 1e-12) return null
    ;[M[col], M[piv]] = [M[piv], M[col]]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r][col] / M[col][col]
      for (let c2 = col; c2 <= n; c2++) M[r][c2] -= f * M[col][c2]
    }
  }
  return M.map((row, i) => row[n] / M[i][i])
}

/**
 * 拟合 4PL 曲线（Levenberg-Marquardt，多起点重启取最优）
 * points: 标准品数据点（浓度 > 0，可含复孔，每个 OD 独立参与拟合）
 * 要求至少 5 个不同的浓度水平（复孔不计入），否则返回 null。
 */
export function fitFourPL(points: StandardPoint[]): FitResult | null {
  const valid = points.filter((p) => isFinite(p.conc) && p.conc > 0 && isFinite(p.od))
  // 检查不同浓度的数量，复孔不能当作新的浓度水平
  const uniqueConcs = new Set(valid.map((p) => p.conc))
  if (uniqueConcs.size < 5) return null

  // 将 OD 归一化到 O(1) 量级再拟合，避免 OD 尺度过小 / 过大导致数值问题。
  // 4PL 对 a、d 是线性的，拟合结束后将 a、d 按比例还原即可（b、c 不受影响）
  const yScale = Math.max(...valid.map((p) => Math.abs(p.od)), 1e-300)
  const scaled = valid.map((p) => ({ conc: p.conc, od: p.od / yScale }))

  const logXs = scaled.map((p) => Math.log(p.conc))
  const ys = scaled.map((p) => p.od)
  const lo = Math.min(...logXs)
  const hi = Math.max(...logXs)

  const sse = (qq: [number, number, number, number]) => {
    let s = 0
    for (let i = 0; i < logXs.length; i++) {
      const r = ys[i] - model(logXs[i], qq)
      s += r * r
    }
    return s
  }

  /** 单次 LM 迭代，返回参数、SSE、迭代次数与结束原因 */
  const lmRun = (
    q0: [number, number, number, number],
  ): { q: [number, number, number, number]; sse: number; iter: number; reason: FitReason } => {
    let q = [...q0] as [number, number, number, number]
    let lambda = 1e-3
    let current = sse(q)
    let reason: FitReason = 'max-iterations'
    let iter = 0
    const maxIter = 500
    for (iter = 0; iter < maxIter; iter++) {
      const JtJ: number[][] = Array.from({ length: 4 }, () => [0, 0, 0, 0])
      const Jtr: number[] = [0, 0, 0, 0]
      for (let i = 0; i < logXs.length; i++) {
        const [yHat, da, dlogB, dlogC, dd] = modelWithGrad(logXs[i], q)
        const r = ys[i] - yHat
        const g = [da, dlogB, dlogC, dd]
        for (let m = 0; m < 4; m++) {
          Jtr[m] += g[m] * r
          for (let n = 0; n < 4; n++) JtJ[m][n] += g[m] * g[n]
        }
      }
      // 梯度收敛判据（无量纲）：梯度足够小即为驻点，不要求 JᵀJ 可解。
      // 参数是否可辨识由 diagnostics.jacobianRankDeficient 单独报告。
      // 阈值取相对估计与绝对下限的最大值，防止完美拟合（SSE≈0）时判据失效
      const gradInf = Math.max(Math.abs(Jtr[0]), Math.abs(Jtr[1]), Math.abs(Jtr[2]), Math.abs(Jtr[3]))
      const diagMax = Math.max(JtJ[0][0], JtJ[1][1], JtJ[2][2], JtJ[3][3])
      const gradTol = Math.max(1e-12, 1e-6 * Math.sqrt(diagMax * current + 1e-300))
      if (gradInf <= gradTol) {
        reason = 'tolerance'
        break
      }
      let stepped = false
      // 内层循环最终的退出原因（奇异 / 无改善），用于准确报告 reason
      let innerExit: FitReason = 'no-improvement'
      for (let tries = 0; tries < 60; tries++) {
        const A = JtJ.map((row, m) => row.map((v, n) => (m === n ? v * (1 + lambda) : v)))
        const delta = solve4(A, Jtr)
        if (!delta) {
          lambda *= 10
          if (lambda > 1e15) {
            innerExit = 'singular'
            break
          }
          continue
        }
        const qNew = q.map((v, k) => v + delta[k]) as [number, number, number, number]
        const sNew = sse(qNew)
        if (!isFinite(sNew)) {
          lambda *= 10
          if (lambda > 1e15) break
          continue
        }
        if (sNew < current) {
          // 只要 SSE 下降就接受步长；tolerance 仅由外层梯度判据决定，
          // 不通过增大阻尼人工制造小步长来伪装收敛
          q = qNew
          current = sNew
          lambda = Math.max(lambda / 5, 1e-12)
          stepped = true
          break
        }
        lambda *= 10
        if (lambda > 1e15) break
      }
      if (!stepped) {
        reason = innerExit
        break
      }
    }
    return { q, sse: current, iter: iter + 1, reason }
  }

  // 多起点：自动初值 + 不同 c 位置 × 两个曲线方向 × 不同斜率（b 恒正）
  const g = initialGuess(scaled)
  const ods = scaled.map((p) => p.od)
  const minOD = Math.min(...ods)
  const maxOD = Math.max(...ods)

  const starts: [number, number, number, number][] = [
    [g.a, Math.log(g.b), Math.log(g.c), g.d],
  ]
  for (const frac of [0.2, 0.5, 0.8]) {
    const logC = lo + (hi - lo) * frac
    for (const [a, d] of [[maxOD, minOD], [minOD, maxOD]] as [number, number][]) {
      for (const b of [0.5, 1, 1.5, 2]) {
        starts.push([a, Math.log(b), logC, d])
      }
    }
  }

  let bestQ: [number, number, number, number] | null = null
  let bestSSE = Infinity
  let bestReason: FitReason = 'no-improvement'
  const runs = starts.map((s) => lmRun(s))

  // 在所有参数有限、SSE 有限的运行中选 SSE 最小的，诚实保留其 reason
  for (const { q, sse: s2, reason } of runs) {
    if (!isFinite(s2)) continue
    const p = toParams(q)
    if (!isFinite(p.a) || !isFinite(p.b) || !isFinite(p.c) || !isFinite(p.d)) continue
    if (p.b <= 0 || p.c <= 0) continue
    if (s2 < bestSSE) {
      bestSSE = s2
      bestQ = q
      bestReason = reason
    }
  }
  if (!bestQ) return null

  // 还原 OD 归一化：a、d 按比例缩回原始量级，SSE / RMSE 同步还原
  const fittedParams = toParams(bestQ)
  const params: FourPLParams = { ...fittedParams, a: fittedParams.a * yScale, d: fittedParams.d * yScale }
  const sseFinal = bestSSE * yScale * yScale
  const fitted = valid.map((p) => fourPL(p.conc, params))
  const residuals = valid.map((p, i) => p.od - fitted[i])
  const meanY = valid.reduce((s, p) => s + p.od, 0) / valid.length
  const ssTot = valid.reduce((s, p) => s + (p.od - meanY) ** 2, 0)
  // 响应无变异（SST = 0）时 R² 在数学上无定义，返回 NaN 而非误导性的 1
  const rSquared = ssTot > 0 ? 1 - sseFinal / ssTot : NaN

  // 拟合后诊断：EC50 相对标准品浓度的位置（仅评价，不参与优化）
  const minConc = Math.min(...valid.map((p) => p.conc))
  const maxConc = Math.max(...valid.map((p) => p.conc))
  const extendedLo = (minConc * minConc) / maxConc // = minC² / maxC
  const extendedHi = (maxConc * maxConc) / minConc // = maxC² / minC
  const ec50 = params.c
  let ec50Location: EC50Location
  if (ec50 >= minConc && ec50 <= maxConc) {
    ec50Location = 'inside-standard-range'
  } else if (ec50 >= extendedLo && ec50 <= extendedHi) {
    ec50Location = 'outside-standard-range'
  } else {
    ec50Location = 'extreme'
  }
  // 在最优解处评估近似 Hessian 是否接近奇异（参数可辨识性诊断）
  const JtJFinal: number[][] = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]
  for (let i = 0; i < logXs.length; i++) {
    const [, da, dlogB, dlogC, dd] = modelWithGrad(logXs[i], bestQ)
    const g = [da, dlogB, dlogC, dd]
    for (let m = 0; m < 4; m++) {
      for (let n = 0; n < 4; n++) JtJFinal[m][n] += g[m] * g[n]
    }
  }
  const jacobianRankDeficient = solve4(JtJFinal, [0, 0, 0, 0]) === null

  const diagnostics: FitDiagnostics = { ec50Location, jacobianRankDeficient }

  return {
    params,
    sse: sseFinal,
    rmse: Math.sqrt(sseFinal / valid.length),
    rSquared,
    residuals,
    fitted,
    converged: bestReason === 'tolerance',
    reason: bestReason,
    diagnostics,
  }
}

/** 生成用于绘图的平滑曲线点（对数等距）；浓度范围非法时返回空数组 */
export function curvePoints(p: FourPLParams, minConc: number, maxConc: number, n = 200) {
  const pts: { conc: number; od: number }[] = []
  if (!(minConc > 0) || !(maxConc > 0) || maxConc <= minConc) return pts
  const lo = Math.log(minConc)
  const hi = Math.log(maxConc)
  for (let i = 0; i <= n; i++) {
    const conc = Math.exp(lo + ((hi - lo) * i) / n)
    pts.push({ conc, od: fourPL(conc, p) })
  }
  return pts
}

/** 格式化数字，保留合理有效位 */
export function fmt(v: number, sig = 4): string {
  if (!isFinite(v)) return '—'
  if (v === 0) return '0'
  const av = Math.abs(v)
  if (av >= 1e5 || av < 1e-3) return v.toExponential(3)
  return Number(v.toPrecision(sig)).toString()
}

/** 根据四参数生成可读公式字符串 */
export function formula(p: FourPLParams): string {
  return `y = ${fmt(p.d)} + (${fmt(p.a)} − ${fmt(p.d)}) / (1 + (x / ${fmt(p.c)})^${fmt(p.b, 3)})`
}

/** 拟合未收敛原因的中文说明 */
export const FIT_REASON_TEXT: Record<FitReason, string> = {
  tolerance: '达到误差阈值',
  'max-iterations': '达到最大迭代次数',
  singular: '矩阵奇异，无法求解',
  'no-improvement': '多次迭代仍无改善',
}

/** EC50 位置诊断的中文标签 */
export const EC50_LOCATION_TEXT: Record<EC50Location, string> = {
  'inside-standard-range': '',
  'outside-standard-range': 'EC50 在标曲范围外',
  'extreme': 'EC50 严重偏离',
}
