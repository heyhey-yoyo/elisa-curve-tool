/**
 * 严格数字解析。
 *
 * parseNumber — 空字符串返回 null，非法 / 不完整输入（如 "100abc"）返回 null。
 * parseDil   — 空字符串默认 1，非法非空返回 null。
 */

/** 严格解析数字字符串：空 / 非法 → null */
export function parseNumber(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const v = Number(t)
  return isFinite(v) ? v : null
}

/** 解析稀释倍数：空 → 默认 1，非法非空 → null */
export function parseDil(s: string): number | null {
  const t = s.trim()
  if (t === '') return 1
  const v = Number(t)
  return isFinite(v) && v > 0 ? v : null
}
