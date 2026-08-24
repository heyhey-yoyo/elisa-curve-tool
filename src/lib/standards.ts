/**
 * 标准品数据处理。
 *
 * deriveStandardPoints — 从 StdRow[] 提取标准品数据点与空白值。
 * validateStandards    — 校验标准品浓度是否足够拟合。
 */

import type { StandardPoint } from './fourPL'
import { parseNumber } from './parsing'

export interface StdRow {
  conc: string
  od: string
}

export interface StandardPointsResult {
  pts: StandardPoint[]
  blank: number
}

/** 从用户输入的标准品行中提取数据点（已做空白校正） */
export function deriveStandardPoints(stds: StdRow[], blankSub: boolean): StandardPointsResult {
  const rows = stds
    .map((r) => ({ conc: parseNumber(r.conc), od: parseNumber(r.od) }))
    .filter((r): r is { conc: number; od: number } => r.conc !== null && r.od !== null)

  const blankRow = rows.find((r) => r.conc === 0)
  const blank = blankSub && blankRow ? blankRow.od : 0
  const pts = rows.filter((r) => r.conc > 0).map((r) => ({ conc: r.conc, od: r.od - blank }))

  return { pts, blank }
}

/** 校验标准品：返回错误文本；通过则返回 null */
export function validateStandards(pts: StandardPoint[]): string | null {
  const uniqueConcs = new Set(pts.map((p) => p.conc))
  if (uniqueConcs.size < 5) {
    return '至少需要 5 个不同的标准品浓度（重复孔不算作新的浓度水平）。'
  }

  // OD 完全没有变化时，4PL 的上下渐近线重合，反函数无法计算任何浓度。
  // 在进入优化器前明确拒绝，避免页面把 R²=NaN 的退化结果显示为成功拟合。
  const ods = pts.map((p) => p.od)
  if (Math.max(...ods) === Math.min(...ods)) {
    return '标准品 OD 全部相同，缺少可用于拟合的响应变化。请检查标准品配制、读板结果或数据录入。'
  }
  return null
}

/** 逐行校验标准品输入：只静默跳过双空行，其他问题返回具体错误 */
export function validateStandardRows(stds: StdRow[], blankSub: boolean): string | null {
  let blankCount = 0

  for (let i = 0; i < stds.length; i++) {
    const { conc, od } = stds[i]
    const row = `第 ${i + 1} 行`
    const concTrim = conc.trim()
    const odTrim = od.trim()
    const concEmpty = concTrim === ''
    const odEmpty = odTrim === ''

    // 双空行：用户尚未填写，静默跳过
    if (concEmpty && odEmpty) continue

    // 仅填了一项
    if (concEmpty && !odEmpty) return `${row}：仅填写了 OD，未填写浓度`
    if (!concEmpty && odEmpty) return `${row}：仅填写了浓度，未填写 OD`

    // 两项都填了，检查是否可解析（统一使用 parseNumber，与数据层校验一致）
    const concNum = parseNumber(concTrim)
    const odNum = parseNumber(odTrim)
    if (concNum === null) return `${row}：浓度「${concTrim}」格式无效，请输入有效数字`
    if (odNum === null) return `${row}：OD「${odTrim}」格式无效，请输入有效数字`

    // 负数检查
    if (concNum < 0) return `${row}：浓度不能为负数（当前为 ${concNum}）`
    if (odNum < 0) return `${row}：OD 不能为负数（当前为 ${odNum}）`

    // 统计空白行（浓度为 0）
    if (concNum === 0) blankCount++
  }

  // 多条 blank
  if (blankCount > 1) return '存在多条浓度为 0 的行，blank 只能填写一行'

  // 开启空白校正但未填 blank
  if (blankSub && blankCount === 0) return '已启用空白孔校正，但未找到浓度为 0 的标准品行'

  return null
}
