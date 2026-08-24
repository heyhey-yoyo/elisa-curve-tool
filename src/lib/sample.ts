/**
 * 未知样本浓度计算（纯函数，不依赖 React 状态）。
 *
 * 所有函数接收显式参数，可在页面 useMemo 中直接调用。
 */

import { fourPLInverse, type FitResult } from './fourPL'
import { parseNumber, parseDil } from './parsing'

// ---- 类型 ----

export type SampleStatus = 'valid' | 'below-range' | 'above-range' | 'invalid'

export const SAMPLE_STATUS_TEXT: Record<SampleStatus, string> = {
  valid: '有效',
  'below-range': '低于标准曲线范围',
  'above-range': '高于标准曲线范围',
  invalid: '无法计算',
}

export interface UnkRow {
  name: string
  od: string
  dilution: string
}

export interface PlateCell {
  group: string
  od: string
  dilution: string
}

export interface WellResult {
  /** 样本状态 */
  status: SampleStatus
  /** 曲线反算浓度（未乘稀释倍数） */
  raw: number | null
  /** 最终浓度（raw × 稀释倍数） */
  conc: number | null
  /** 稀释倍数是否非法（非空但解析失败） */
  dilInvalid: boolean
  /** OD 是否非法（非空但解析失败，如 "abc"） */
  odInvalid: boolean
  /** 调整后的 OD（减去空白后） */
  adjOd: number | null
}

// ---- 纯函数 ----

/** 由原始 OD 求曲线上的浓度（仅空白校正，不乘稀释倍数） */
export function computeRawConcentration(
  od: number,
  fit: FitResult | null,
  blankSub: boolean,
  blank: number,
): number | null {
  if (!fit) return null
  const adj = blankSub ? od - blank : od
  return fourPLInverse(adj, fit.params)
}

/** 由曲线浓度（未乘稀释倍数）判断样本状态 */
export function computeSampleStatus(
  raw: number | null,
  minC: number,
  maxC: number,
): SampleStatus {
  if (raw === null) return 'invalid'
  if (raw < minC) return 'below-range'
  if (raw > maxC) return 'above-range'
  return 'valid'
}

/** 计算单个未知样本的完整结果 */
export function computeUnkResult(
  odStr: string,
  dilutionStr: string,
  fit: FitResult | null,
  blankSub: boolean,
  blank: number,
  minC: number,
  maxC: number,
): WellResult {
  const odTrim = odStr.trim()
  const od = parseNumber(odTrim)
  const odInvalid = odTrim !== '' && od === null
  // 稀释倍数校验独立于 OD 和拟合状态
  const df = parseDil(dilutionStr)
  const dilInvalid = dilutionStr.trim() !== '' && df === null
  const adjOd = od !== null && blankSub ? od - blank : od

  if (od === null || !fit) {
    return { status: 'invalid', raw: null, conc: null, dilInvalid, odInvalid, adjOd }
  }

  const raw = computeRawConcentration(od, fit, blankSub, blank)
  const status = computeSampleStatus(raw, minC, maxC)
  const conc = status === 'valid' && raw !== null && df !== null ? raw * df : null

  return { status, raw, conc, dilInvalid, odInvalid, adjOd }
}

/**
 * 计算 96 孔板全部结果矩阵。
 * 返回 8×12 的 WellResult[][]，统一包含浓度、状态和稀释倍数校验结果，
 * 页面、热图和导出均消费同一对象，不再各自重新推导。
 */
export function computePlateResults(
  plate: PlateCell[][],
  fit: FitResult | null,
  blankSub: boolean,
  blank: number,
  minC: number,
  maxC: number,
): WellResult[][] {
  // 与单行映射口径完全一致，直接复用 computeUnkResult，避免逻辑重复
  return plate.map((row) =>
    row.map((cell) => computeUnkResult(cell.od, cell.dilution, fit, blankSub, blank, minC, maxC)),
  )
}

/** 生成图表中未知样本的散点数据（只含落在标准曲线范围内的点） */
export function computeChartUnkDots(
  unkRows: UnkRow[],
  fit: FitResult | null,
  blankSub: boolean,
  blank: number,
  minC: number,
  maxC: number,
): { conc: number; od: number }[] {
  if (!fit) return []
  return unkRows
    .map((u) => {
      const od = parseNumber(u.od)
      if (od === null) return null
      const raw = computeRawConcentration(od, fit, blankSub, blank)
      if (raw === null || raw < minC || raw > maxC) return null
      const adj = blankSub ? od - blank : od
      return { conc: raw, od: adj }
    })
    .filter(Boolean) as { conc: number; od: number }[]
}

/** 生成标准品回算表 */
export interface BackCalcRow {
  conc: number
  od: number
  back: number | null
  recovery: number | null
}

export function computeBackCalc(
  pts: { conc: number; od: number }[],
  fit: FitResult | null,
): BackCalcRow[] {
  if (!fit) return []
  return pts
    .map((p) => {
      const back = fourPLInverse(p.od, fit.params)
      return { ...p, back, recovery: back !== null ? (back / p.conc) * 100 : null }
    })
    .sort((a, b) => b.conc - a.conc)
}
