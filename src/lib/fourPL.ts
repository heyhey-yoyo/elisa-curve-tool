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

export interface FitResult {
  params: FourPLParams
  sse: number
  rmse: number
  rSquared: number
  residuals: number[]
  fitted: number[]
  iterations: number
  converged: boolean
  reason: FitReason
}

export interface StandardPoint {
  conc: number
  od: number
}

/** 4PL 正向函数 */
export function fourPL(x: number, p: FourPLParams): number {
  return p.d + (p.a - p.d) / (1 + Math.pow(x / p.c, p.b))
}

/** 4PL 反函数: 由 OD 求浓度；超出渐近线区间返回 null */
export function fourPLInverse(y: number, p: FourPLParams): number | null {
  const ratio = (p.a - p.d) / (y - p.d) - 1
  if (!isFinite(ratio) || ratio <= 0) return null
  const x = p.c * Math.pow(ratio, 1 / p.b)
  return isFinite(x) ? x : null
}

/**
 * 标准品输入签名：浓度 / OD / 空白值任一变化都会改变签名。
 * 用于判断旧拟合结果是否已失效（签名不一致即失效，需重新拟合）。
 */
export function standardsSignature(points: StandardPoint[], blank: number): string {
  return JSON.stringify({ blank, pts: points.map((p) => [p.conc, p.od]) })
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

/** 模型（q = [a, logB, logC, d]），与 fourPL 完全一致：y = d + (a-d)/(1+(x/c)^b) */
function model(logX: number, q: [number, number, number, number]): number {
  const [a, logB, logC, d] = q
  const t = Math.exp(Math.exp(logB) * (logX - logC))
  return d + (a - d) / (1 + t)
}

function toParams(q: [number, number, number, number]): FourPLParams {
  return { a: q[0], b: Math.exp(q[1]), c: Math.exp(q[2]), d: q[3] }
}

/** 有限差分雅可比 */
function jacobian(logXs: number[], q: [number, number, number, number]): number[][] {
  const J: number[][] = []
  const eps = 1e-6
  for (const lx of logXs) {
    const row: number[] = []
    for (let k = 0; k < 4; k++) {
      const step = Math.abs(q[k]) * eps + 1e-8
      const q2 = [...q] as [number, number, number, number]
      q2[k] += step
      row.push((model(lx, q2) - model(lx, q)) / step)
    }
    J.push(row)
  }
  return J
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
  const valid = points.filter((p) => p.conc > 0 && isFinite(p.od))
  // 检查不同浓度的数量，复孔不能当作新的浓度水平
  const uniqueConcs = new Set(valid.map((p) => p.conc))
  if (uniqueConcs.size < 5) return null

  const logXs = valid.map((p) => Math.log(p.conc))
  const ys = valid.map((p) => p.od)

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
      const J = jacobian(logXs, q)
      const JtJ: number[][] = Array.from({ length: 4 }, () => [0, 0, 0, 0])
      const Jtr: number[] = [0, 0, 0, 0]
      for (let i = 0; i < logXs.length; i++) {
        const r = ys[i] - model(logXs[i], q)
        for (let m = 0; m < 4; m++) {
          Jtr[m] += J[i][m] * r
          for (let n = 0; n < 4; n++) JtJ[m][n] += J[i][m] * J[i][n]
        }
      }
      let stepped = false
      let sawSingular = false
      let done = false
      for (let tries = 0; tries < 60; tries++) {
        const A = JtJ.map((row, m) => row.map((v, n) => (m === n ? v * (1 + lambda) : v)))
        const delta = solve4(A, Jtr)
        if (!delta) {
          sawSingular = true
          lambda *= 10
          if (lambda > 1e15) break
          continue
        }
        const qNew = q.map((v, k) => v + delta[k]) as [number, number, number, number]
        const sNew = sse(qNew)
        if (!isFinite(sNew)) {
          lambda *= 10
          if (lambda > 1e15) break
          continue
        }
        const rel = (current - sNew) / (current + 1e-12)
        if (sNew <= current && rel < 1e-10) {
          // 改善已低于误差阈值，达到收敛容差
          q = qNew
          current = sNew
          reason = 'tolerance'
          done = true
          break
        }
        if (sNew < current) {
          q = qNew
          current = sNew
          lambda = Math.max(lambda / 5, 1e-12)
          stepped = true
          break
        }
        lambda *= 10
        if (lambda > 1e15) break
      }
      if (done) break
      if (!stepped) {
        reason = sawSingular ? 'singular' : 'no-improvement'
        break
      }
    }
    return { q, sse: current, iter: iter + 1, reason }
  }

  // 多起点：自动初值 + 不同 c 位置 × 两个曲线方向 × 不同斜率（b 恒正）
  const g = initialGuess(valid)
  const ods = valid.map((p) => p.od)
  const minOD = Math.min(...ods)
  const maxOD = Math.max(...ods)
  const logConcs = valid.map((p) => Math.log(p.conc))
  const lo = Math.min(...logConcs)
  const hi = Math.max(...logConcs)

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
  let totalIter = 0
  for (const s of starts) {
    const { q, sse: s2, iter: it, reason } = lmRun(s)
    totalIter += it
    if (s2 < bestSSE) {
      bestSSE = s2
      bestQ = q
      bestReason = reason
    }
  }
  if (!bestQ) return null

  const params = toParams(bestQ)
  const fitted = valid.map((p) => fourPL(p.conc, params))
  const residuals = valid.map((p, i) => p.od - fitted[i])
  const meanY = ys.reduce((s, v) => s + v, 0) / ys.length
  const ssTot = ys.reduce((s, v) => s + (v - meanY) ** 2, 0)
  const rSquared = ssTot > 0 ? 1 - bestSSE / ssTot : 1

  return {
    params,
    sse: bestSSE,
    rmse: Math.sqrt(bestSSE / valid.length),
    rSquared,
    residuals,
    fitted,
    iterations: totalIter,
    converged: bestReason === 'tolerance',
    reason: bestReason,
  }
}

/** 生成用于绘图的平滑曲线点（对数等距） */
export function curvePoints(p: FourPLParams, minConc: number, maxConc: number, n = 200) {
  const pts: { conc: number; od: number }[] = []
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
