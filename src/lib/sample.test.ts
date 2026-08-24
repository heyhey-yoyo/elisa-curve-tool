import { describe, it, expect } from 'vitest'
import { computePlateResults, computeUnkResult, type PlateCell } from './sample'

const makeCell = (od: string, dilution = ''): PlateCell => ({ group: '', od, dilution })
const plate1x1 = (cell: PlateCell): PlateCell[][] => [[cell]]

describe('computePlateResults', () => {
  it('非法 OD → odInvalid=true', () => {
    const result = computePlateResults(plate1x1(makeCell('abc')), null, false, 0, 1, 100)
    expect(result[0][0].odInvalid).toBe(true)
  })

  it('空 OD → odInvalid=false', () => {
    const result = computePlateResults(plate1x1(makeCell('')), null, false, 0, 1, 100)
    expect(result[0][0].odInvalid).toBe(false)
  })

  it('未拟合时非法稀释倍数仍然 dilInvalid=true', () => {
    const result = computePlateResults(plate1x1(makeCell('1.5', 'abc')), null, false, 0, 1, 100)
    expect(result[0][0].dilInvalid).toBe(true)
  })

  it('OD 非法时非法稀释倍数仍然 dilInvalid=true', () => {
    const result = computePlateResults(plate1x1(makeCell('abc', 'xyz')), null, false, 0, 1, 100)
    expect(result[0][0].odInvalid).toBe(true)
    expect(result[0][0].dilInvalid).toBe(true)
  })

  it('空稀释倍数 → dilInvalid=false, 默认 1 (由 parseDil 处理)', () => {
    const result = computePlateResults(plate1x1(makeCell('1.5', '')), null, false, 0, 1, 100)
    expect(result[0][0].dilInvalid).toBe(false)
  })

  it('合法稀释倍数 → dilInvalid=false', () => {
    const result = computePlateResults(plate1x1(makeCell('1.5', '2')), null, false, 0, 1, 100)
    expect(result[0][0].dilInvalid).toBe(false)
  })
})

describe('computeUnkResult', () => {
  it('非法 OD → odInvalid=true', () => {
    const result = computeUnkResult('abc', '', null, false, 0, 1, 100)
    expect(result.odInvalid).toBe(true)
  })

  it('未拟合时非法稀释倍数仍然 dilInvalid=true', () => {
    const result = computeUnkResult('1.5', 'abc', null, false, 0, 1, 100)
    expect(result.dilInvalid).toBe(true)
  })

  it('OD 非法时非法稀释倍数仍然 dilInvalid=true', () => {
    const result = computeUnkResult('abc', 'xyz', null, false, 0, 1, 100)
    expect(result.odInvalid).toBe(true)
    expect(result.dilInvalid).toBe(true)
  })

  it('与 computePlateResults 对同一非法输入产生一致的错误状态', () => {
    const plateResult = computePlateResults(plate1x1(makeCell('abc', 'xyz')), null, false, 0, 1, 100)[0][0]
    const unkResult = computeUnkResult('abc', 'xyz', null, false, 0, 1, 100)
    expect(plateResult.odInvalid).toBe(unkResult.odInvalid)
    expect(plateResult.dilInvalid).toBe(unkResult.dilInvalid)
  })
})
