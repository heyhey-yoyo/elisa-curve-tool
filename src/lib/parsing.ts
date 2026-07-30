/**
 * 严格数字解析。
 *
 * parseNumber — 空字符串返回 null，非法 / 不完整输入（如 "100abc"）返回 null。
 * parseDil   — 空字符串默认 1，非法非空返回 null。
 */

/** 仅接受十进制数字格式（拒绝 0x/0b/0o 等 JavaScript Number 的隐式进制） */
const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

/** 严格解析数字字符串：空 / 非法 / 非十进制 → null */
export function parseNumber(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  if (!DECIMAL_NUMBER.test(t)) return null
  const v = Number(t)
  return isFinite(v) ? v : null
}

/** 解析稀释倍数：空 → 默认 1，非法非空 → null（复用 parseNumber 保证校验一致） */
export function parseDil(s: string): number | null {
  const t = s.trim()
  if (t === '') return 1
  const v = parseNumber(t)
  if (v === null) return null
  return v > 0 ? v : null
}
