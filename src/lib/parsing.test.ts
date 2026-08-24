import { describe, it, expect } from 'vitest'
import { parseNumber, parseDil } from './parsing'

describe('parseNumber', () => {
  it('空字符串返回 null', () => {
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('  ')).toBeNull()
  })

  it('合法十进制数字正常解析', () => {
    expect(parseNumber('100')).toBe(100)
    expect(parseNumber('0.5')).toBe(0.5)
    expect(parseNumber('-1.5')).toBe(-1.5)
    expect(parseNumber('1.5e3')).toBe(1500)
    expect(parseNumber('1e-3')).toBe(0.001)
    expect(parseNumber('.5')).toBe(0.5)
    expect(parseNumber('+0.5')).toBe(0.5)
  })

  it('拒绝非十进制格式（0x/0b/0o）', () => {
    expect(parseNumber('0x10')).toBeNull()
    expect(parseNumber('0b10')).toBeNull()
    expect(parseNumber('0o10')).toBeNull()
  })

  it('拒绝部分解析的脏字符串', () => {
    expect(parseNumber('100abc')).toBeNull()
    expect(parseNumber('abc')).toBeNull()
    expect(parseNumber('1.2.3')).toBeNull()
  })

  it('拒绝 Infinity', () => {
    expect(parseNumber('Infinity')).toBeNull()
    expect(parseNumber('-Infinity')).toBeNull()
  })
})

describe('parseDil', () => {
  it('空字符串默认 1', () => {
    expect(parseDil('')).toBe(1)
    expect(parseDil('  ')).toBe(1)
  })

  it('合法正数解析', () => {
    expect(parseDil('2')).toBe(2)
    expect(parseDil('0.5')).toBe(0.5)
    expect(parseDil('10')).toBe(10)
  })

  it('非法非空返回 null', () => {
    expect(parseDil('abc')).toBeNull()
    expect(parseDil('-1')).toBeNull()
    expect(parseDil('0')).toBeNull()
    expect(parseDil('0x10')).toBeNull()
  })
})
