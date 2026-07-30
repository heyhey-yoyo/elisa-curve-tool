import { describe, it, expect } from 'vitest'
import { validateStandardRows, type StdRow } from './standards'

const emptyRow = (): StdRow => ({ conc: '', od: '' })

describe('validateStandardRows', () => {
  it('全部空行且 blankSub 关闭 → 通过（初始空表状态）', () => {
    expect(validateStandardRows([emptyRow(), emptyRow()], false)).toBeNull()
  })

  it('足够合法正浓度 → 通过', () => {
    const rows: StdRow[] = [
      { conc: '1000', od: '2.5' },
      { conc: '500', od: '1.5' },
      { conc: '250', od: '0.9' },
      { conc: '125', od: '0.5' },
      { conc: '62.5', od: '0.3' },
    ]
    expect(validateStandardRows(rows, false)).toBeNull()
  })

  it('一条 blank 且 blankSub 开启 → 通过', () => {
    const rows: StdRow[] = [
      { conc: '1000', od: '2.5' },
      { conc: '500', od: '1.5' },
      { conc: '250', od: '0.9' },
      { conc: '125', od: '0.5' },
      { conc: '62.5', od: '0.3' },
      { conc: '0', od: '0.05' },
    ]
    expect(validateStandardRows(rows, true)).toBeNull()
  })

  it('一条 blank 但 blankSub 关闭 → 通过', () => {
    const rows: StdRow[] = [
      { conc: '1000', od: '2.5' },
      { conc: '500', od: '1.5' },
      { conc: '250', od: '0.9' },
      { conc: '125', od: '0.5' },
      { conc: '62.5', od: '0.3' },
      { conc: '0', od: '0.05' },
    ]
    expect(validateStandardRows(rows, false)).toBeNull()
  })

  it('两条 blank → 错误', () => {
    const rows: StdRow[] = [
      { conc: '1000', od: '2.5' },
      { conc: '0', od: '0.05' },
      { conc: '0', od: '0.06' },
      { conc: '125', od: '0.5' },
      { conc: '62.5', od: '0.3' },
    ]
    const err = validateStandardRows(rows, true)
    expect(err).not.toBeNull()
    expect(err!).toContain('blank')
  })

  it('blankSub 开启但无 blank → 错误', () => {
    const rows: StdRow[] = [
      { conc: '1000', od: '2.5' },
      { conc: '500', od: '1.5' },
      { conc: '250', od: '0.9' },
      { conc: '125', od: '0.5' },
      { conc: '62.5', od: '0.3' },
    ]
    const err = validateStandardRows(rows, true)
    expect(err).not.toBeNull()
    expect(err!).toContain('空白')
  })

  it('blankSub 关闭且无 blank → 通过', () => {
    const rows: StdRow[] = [
      { conc: '1000', od: '2.5' },
      { conc: '500', od: '1.5' },
      { conc: '250', od: '0.9' },
      { conc: '125', od: '0.5' },
      { conc: '62.5', od: '0.3' },
    ]
    expect(validateStandardRows(rows, false)).toBeNull()
  })

  it('blank 只有浓度没有 OD → 行错误', () => {
    const rows: StdRow[] = [
      { conc: '1000', od: '2.5' },
      { conc: '0', od: '' },
      { conc: '250', od: '0.9' },
      { conc: '125', od: '0.5' },
      { conc: '62.5', od: '0.3' },
    ]
    const err = validateStandardRows(rows, true)
    expect(err).not.toBeNull()
    expect(err!).toContain('第 2 行')
  })

  it('单空行（仅填 OD）报具体行号', () => {
    const rows: StdRow[] = [
      { conc: '1000', od: '2.5' },
      { conc: '', od: '0.5' },
      { conc: '250', od: '0.9' },
      { conc: '125', od: '0.5' },
      { conc: '62.5', od: '0.3' },
    ]
    const err = validateStandardRows(rows, true)
    expect(err).not.toBeNull()
    expect(err!).toContain('第 2 行')
  })

  it('非法格式报具体行号', () => {
    const rows: StdRow[] = [
      { conc: '1000', od: '2.5' },
      { conc: 'abc', od: '0.5' },
      { conc: '250', od: '0.9' },
      { conc: '125', od: '0.5' },
      { conc: '62.5', od: '0.3' },
    ]
    const err = validateStandardRows(rows, true)
    expect(err).not.toBeNull()
    expect(err!).toContain('第 2 行')
  })
})
