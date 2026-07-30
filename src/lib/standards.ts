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
  return null
}
