// ELISA_BUGFIXES_20260728
import { useMemo, useRef, useState } from 'react'
import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from 'recharts'
import { Plus, Trash2, Sparkles, Eraser, Calculator, Info, Pencil, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { fitFourPL, fourPL, fourPLInverse, curvePoints, fmt, standardsSignature, type FitResult, type FitReason, type FourPLParams } from '@/lib/fourPL'
interface StdRow {
  conc: string
  od: string
}

interface UnkRow {
  name: string
  od: string
  dilution: string
}

interface PlateCell {
  group: string
  od: string
  dilution: string
}

const EXAMPLE_STDS: StdRow[] = [
  { conc: '2000', od: '2.512' },
  { conc: '1000', od: '2.127' },
  { conc: '500', od: '1.564' },
  { conc: '250', od: '0.987' },
  { conc: '125', od: '0.573' },
  { conc: '62.5', od: '0.326' },
  { conc: '31.25', od: '0.191' },
  { conc: '0', od: '0.055' },
]
const EXAMPLE_UNKS: UnkRow[] = [
  { name: '样本 1', od: '1.456', dilution: '1' },
  { name: '样本 2', od: '0.842', dilution: '1' },
  { name: '样本 3', od: '0.289', dilution: '1' },
]

const ROWS = 'ABCDEFGH'
const COLS = Array.from({ length: 12 }, (_, i) => i + 1)

/** 拟合未收敛原因的中文说明 */
const FIT_REASON_TEXT: Record<FitReason, string> = {
  tolerance: '达到误差阈值',
  'max-iterations': '达到最大迭代次数',
  singular: '矩阵奇异，无法求解',
  'no-improvement': '多次迭代仍无改善',
}

/** 未知样本浓度状态 */
type SampleStatus = 'valid' | 'below-range' | 'above-range' | 'invalid'
const SAMPLE_STATUS_TEXT: Record<SampleStatus, string> = {
  valid: '有效',
  'below-range': '低于标准曲线范围',
  'above-range': '高于标准曲线范围',
  invalid: '无法计算',
}

const emptyStd = (): StdRow => ({ conc: '', od: '' })
const emptyUnk = (): UnkRow => ({ name: '', od: '', dilution: '1' })
const emptyPlate = (): PlateCell[][] =>
  ROWS.split('').map(() => COLS.map(() => ({ group: '', od: '', dilution: '' })))
/** 根据四参数生成可读公式 */
function formula(p: FourPLParams): string {
  return `y = ${fmt(p.d)} + (${fmt(p.a)} − ${fmt(p.d)}) / (1 + (x / ${fmt(p.c)})${fmt(p.b, 3)})`
}
/** 96 孔板小格颜色（按数值深浅） */
function cellStyle(v: number | null, min: number, max: number): string {
  if (v === null) return 'bg-white text-slate-300'
  const t = max > min ? (v - min) / (max - min) : 0.5
  if (t > 0.66) return 'bg-teal-600 text-white'
  if (t > 0.33) return 'bg-teal-400 text-teal-950'
  if (t > 0.1) return 'bg-teal-200 text-teal-950'
  return 'bg-teal-50 text-teal-900'
}
export default function Home() {
  const [stds, setStds] = useState<StdRow[]>(() => Array.from({ length: 8 }, emptyStd))
  const [stdsCollapsed, setStdsCollapsed] = useState(false)
  const [unkRows, setUnkRows] = useState<UnkRow[]>([emptyUnk()])
  const [plate, setPlate] = useState<PlateCell[][]>(emptyPlate)
  const [unit, setUnit] = useState('pg/mL')
  const [blankSub, setBlankSub] = useState(true)
  /** 拟合结果及其对应的标准品输入签名（签名不一致即失效） */
  const [fitState, setFitState] = useState<{ result: FitResult; sig: string } | null>(null)
  const [fitError, setFitError] = useState<string | null>(null)
  const [selectedCell, setSelectedCell] = useState<{ r: number; c: number } | null>(null)
  /** 孔板录入模式：格内输入的内容（默认 OD） */
  const [entryMode, setEntryMode] = useState<'od' | 'group' | 'dilution'>('od')
  const [heatMap, setHeatMap] = useState(false)
  const [copiedMode, setCopiedMode] = useState<'concentration' | 'group-concentration' | null>(null)
  const odBoardRef = useRef<HTMLDivElement>(null)
  const concBoardRef = useRef<HTMLDivElement>(null)
  const syncingRef = useRef(false)
  /** 「已复制」状态的复位定时器 */
  const copyTimerRef = useRef<number | null>(null)
  /** 96 孔 OD 录入格子的引用，用于键盘导航 */
  const odInputRefs = useRef(new Map<string, HTMLInputElement>())
  /** 上下孔板滚动同步 */
  const syncScroll = (source: 'od' | 'conc') => (e: React.UIEvent<HTMLDivElement>) => {
    if (syncingRef.current) return
    syncingRef.current = true
    const target = source === 'od' ? concBoardRef.current : odBoardRef.current
    if (target) target.scrollLeft = (e.target as HTMLDivElement).scrollLeft
    requestAnimationFrame(() => {
      syncingRef.current = false
    })
  }
  // 标准品数据点
  const stdPoints = useMemo(() => {
    const rows = stds
      .map((r) => ({ conc: parseFloat(r.conc), od: parseFloat(r.od) }))
      .filter((r) => isFinite(r.conc) && isFinite(r.od))
    const blankRow = rows.find((r) => r.conc === 0)
    const blank = blankSub && blankRow ? blankRow.od : 0
    const pts = rows.filter((r) => r.conc > 0).map((r) => ({ conc: r.conc, od: r.od - blank }))
    return { pts, blank }
  }, [stds, blankSub])
  const minC = useMemo(() => Math.min(...stdPoints.pts.map((p) => p.conc)), [stdPoints])
  const maxC = useMemo(() => Math.max(...stdPoints.pts.map((p) => p.conc)), [stdPoints])
  /** 当前标准品输入签名：修改浓度 / OD、增删行、切换空白校正等都会使其改变 */
  const currentSig = useMemo(() => standardsSignature(stdPoints.pts, stdPoints.blank), [stdPoints])
  /** 签名不一致时旧拟合立即失效，不再展示旧曲线、参数与样本换算结果 */
  const fit = fitState && fitState.sig === currentSig ? fitState.result : null
  /** 存在旧拟合但输入已变化 → 提示重新拟合 */
  const fitStale = fitState !== null && fitState.sig !== currentSig

  const doFit = () => {
    // 检查不同浓度的数量，复孔不算作新的浓度水平
    const uniqueConcs = new Set(stdPoints.pts.map((p) => p.conc))
    if (uniqueConcs.size < 5) {
      setFitState(null)
      setFitError('至少需要 5 个不同的标准品浓度（重复孔不算作新的浓度水平）。')
      return
    }
    const res = fitFourPL(stdPoints.pts)
    if (!res) {
      setFitState(null)
      setFitError('有效标准品数据不足（至少需要 5 个非零浓度的数据点），无法拟合。')
      return
    }
    if (!res.converged) {
      // 未收敛的结果不作为有效拟合，不用于样本浓度计算
      setFitState(null)
      setFitError(`拟合未收敛（${FIT_REASON_TEXT[res.reason]}），请检查标准品数据后重试。`)
      return
    }
    setFitState({ result: res, sig: currentSig })
    setFitError(null)
    setStdsCollapsed(true)
  }
  /** 由原始 OD 求曲线上的浓度（仅空白校正，不乘稀释倍数） */
  const rawConc = (od: number): number | null => {
    if (!fit) return null
    const adj = blankSub ? od - stdPoints.blank : od
    return fourPLInverse(adj, fit.params)
  }
  /** 由曲线浓度（未乘稀释倍数）判断未知样本状态 */
  const sampleStatus = (raw: number | null): SampleStatus => {
    if (raw === null) return 'invalid'
    if (raw < minC) return 'below-range'
    if (raw > maxC) return 'above-range'
    return 'valid'
  }

  const parseDil = (s: string): number => {
    const v = parseFloat(s)
    return isFinite(v) && v > 0 ? v : 1
  }
  // 96 孔板结果（每孔 OD × 每孔稀释倍数）
  const plateResults = useMemo(() => {
    return plate.map((row) =>
      row.map((cell) => {
        const od = parseFloat(cell.od)
        if (!fit || !isFinite(od)) return null
        const raw = rawConc(od)
        return raw === null ? null : raw * parseDil(cell.dilution)
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plate, fit, blankSub, stdPoints])
  const plateOdValues = useMemo(
    () => plate.flat().map((v) => parseFloat(v.od)).filter(isFinite),
    [plate],
  )
  // 热图编码值：有拟合时按浓度（越浓颜色越深），无拟合时退回按 OD 编码
  const plateConcValues = useMemo(
    () => plateResults.flat().filter((v): v is number => v !== null && isFinite(v)),
    [plateResults],
  )
  const heatValues = fit && plateConcValues.length > 0 ? plateConcValues : plateOdValues
  const plateMin = heatValues.length ? Math.min(...heatValues) : 0
  const plateMax = heatValues.length ? Math.max(...heatValues) : 1
  // 绘图数据
  const chartData = useMemo(() => {
    if (!fit || stdPoints.pts.length === 0) return null
    const concs = stdPoints.pts.map((p) => p.conc)
    const lo = Math.min(...concs)
    const hi = Math.max(...concs)
    const scatter = stdPoints.pts.map((p) => ({ conc: p.conc, od: p.od }))
    const curve = curvePoints(fit.params, lo * 0.5, hi * 2)
    const unkDots = unkRows
      .map((u) => {
        const od = parseFloat(u.od)
        if (!isFinite(od)) return null
        const raw = rawConc(od)
        if (raw === null) return null
        const adj = blankSub ? od - stdPoints.blank : od
        return { conc: raw, od: adj }
      })
      .filter(Boolean) as { conc: number; od: number }[]
    return { scatter, curve, unkDots, lo, hi }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, stdPoints, unkRows, blankSub])
  // 回算表
  const backCalc = useMemo(() => {
    if (!fit) return []
    return stdPoints.pts
      .map((p) => {
        const back = fourPLInverse(p.od, fit.params)
        return { ...p, back, recovery: back !== null ? (back / p.conc) * 100 : null }
      })
      .sort((a, b) => b.conc - a.conc)
  }, [fit, stdPoints])

  const updateStd = (i: number, field: 'conc' | 'od', value: string) => {
    setStds((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }
  const updateUnk = (i: number, field: 'name' | 'od' | 'dilution', value: string) => {
    setUnkRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }

  const updatePlateCell = (r: number, c: number, field: 'group' | 'od' | 'dilution', value: string) => {
    setPlate((prev) =>
      prev.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? { ...cell, [field]: value } : cell)) : row)),
    )
  }

  /** 聚焦并全选某个孔位的 OD 输入框 */
  const focusOdCell = (r: number, c: number) => {
    const el = odInputRefs.current.get(`${r}-${c}`)
    if (el) {
      el.focus()
      el.select()
    }
  }

  /** 孔位录入键盘导航：方向键移动；Enter 下移一格，到底部则跳到下一列顶端。
   *  分组（自由文本）模式下只处理 Enter，方向键保留给文本光标 */
  const onOdCellKeyDown = (r: number, c: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (entryMode === 'group') {
      if (e.key !== 'Enter') return
      e.preventDefault()
      const nr = r + 1 > 7 ? 0 : r + 1
      const nc = r + 1 > 7 ? c + 1 : c
      if (nc > 11) return
      focusOdCell(nr, nc)
      return
    }
    let nr = r
    let nc = c
    if (e.key === 'ArrowUp') nr = r - 1
    else if (e.key === 'ArrowDown') nr = r + 1
    else if (e.key === 'ArrowLeft') nc = c - 1
    else if (e.key === 'ArrowRight') nc = c + 1
    else if (e.key === 'Enter') {
      nr = r + 1
      if (nr > 7) {
        nr = 0
        nc = c + 1
      }
    } else return
    // 越界时不拦截按键，保留输入框内光标移动等默认行为
    if (nr < 0 || nr > 7 || nc < 0 || nc > 11) return
    e.preventDefault()
    focusOdCell(nr, nc)
  }

  /** 写入剪贴板，并兼容部分不支持 Clipboard API 的浏览器 */
  const copyText = async (
    text: string,
    mode: 'concentration' | 'group-concentration',
  ) => {
    // 先清掉上一次复制的复位定时器，避免提前清掉本次的「已复制」状态
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    const markCopied = () => {
      setCopiedMode(mode)
      copyTimerRef.current = window.setTimeout(() => setCopiedMode(null), 2000)
    }
    try {
      await navigator.clipboard.writeText(text)
      markCopied()
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      textarea.style.pointerEvents = 'none'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()

      const success = document.execCommand('copy')
      document.body.removeChild(textarea)

      if (success) {
        markCopied()
      } else {
        window.alert('复制失败，请检查浏览器的剪贴板权限。')
      }
    }
  }

  /** 与结果板口径一致的浓度导出文本：范围内给数值；
   *  无法计算 / 超出标准曲线范围给状态文本，不导出外推浓度 */
  const exportConc = (r: number, c: number): string => {
    const cell = plate[r][c]
    const hasOd = isFinite(parseFloat(cell.od))
    const v = plateResults[r][c]
    if (v === null || !Number.isFinite(v)) return hasOd ? 'N/A' : ''
    const status = sampleStatus(v / parseDil(cell.dilution))
    if (status === 'valid') return v.toFixed(3)
    return status === 'invalid' ? 'N/A' : status === 'below-range' ? '低于范围' : '高于范围'
  }

  /** 只复制浓度：粘贴后保持 8×12 孔板矩阵 */
  const copyPlateConcentrations = async () => {
    if (!fit) return

    const text = plateResults
      .map((row, r) => row.map((_, c) => exportConc(r, c)).join('\t'))
      .join('\n')

    await copyText(text, 'concentration')
  }

  /**
   * 复制分组 + 浓度：按列输出（A1→H1→A2→H2→…→A12→H12），每孔一行。
   * 左列为分组，右列为浓度，每个已录入分组或 OD 的孔占一行。
   */
  const copyPlateGroupsAndConcentrations = async () => {
    if (!fit) return

    const lines: string[] = []

    for (let c = 0; c < COLS.length; c++) {
      for (let r = 0; r < ROWS.length; r++) {
        const cell = plate[r][c]
        const group = cell.group.trim()
        const hasOd = Number.isFinite(Number.parseFloat(cell.od))

        // 完全空白的孔不复制
        if (!group && !hasOd) continue

        lines.push(`${group}\t${exportConc(r, c)}`)
      }
    }

    await copyText(lines.join('\n'), 'group-concentration')
  }

  return (
    <div className="min-h-screen bg-[#F7F4EE]">
      {/* 头部：极简学术风品牌栏 */}
      <header className="border-b border-slate-200/80 bg-white/70 backdrop-blur">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4 flex items-center gap-3 sm:gap-4">
          <div className="shrink-0 leading-none">
            <span className="font-serif text-lg sm:text-xl font-semibold tracking-tight text-slate-900">YDchen</span>
            <span className="ml-1.5 text-lg sm:text-xl font-light text-slate-400">Tools</span>
          </div>
          <div className="w-px h-8 sm:h-9 bg-slate-300/80 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-semibold text-slate-800 leading-tight">ELISA 4PL Curve Tool</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">4PL 标曲拟合 · 浓度计算 · 96 孔板换算</p>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* 第一步：标准曲线 */}
        {!stdsCollapsed || fitStale ? (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="text-base">第 1 步 · 标准品数据</CardTitle>
                  <CardDescription>输入浓度与 OD 值；浓度为 0 的行作为空白孔</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setStds(EXAMPLE_STDS)}>
                    <Sparkles className="w-4 h-4 mr-1" />
                    载入示例
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setStds([emptyStd()])}>
                    <Eraser className="w-4 h-4 mr-1" />
                    清空
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full max-w-md text-sm">
                  <thead>
                    <tr className="text-slate-500 border-b">
                      <th className="text-left py-2 pr-2 font-medium">浓度 ({unit})</th>
                      <th className="text-left py-2 px-1 font-medium">OD</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {stds.map((r, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-1 pr-2">
                          <Input value={r.conc} onChange={(e) => updateStd(i, 'conc', e.target.value)} placeholder="1000" className="h-8 w-24 sm:w-36" />
                        </td>
                        <td className="py-1 px-1">
                          <Input value={r.od} onChange={(e) => updateStd(i, 'od', e.target.value)} placeholder="0.000" className="h-8 w-24 sm:w-36" />
                        </td>
                        <td>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-500" onClick={() => setStds((p) => p.filter((_, k) => k !== i))}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setStds((p) => [...p, emptyStd()])}>
                <Plus className="w-4 h-4 mr-1" />
                添加浓度点
              </Button>
              <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={blankSub} onChange={(e) => setBlankSub(e.target.checked)} className="accent-teal-600" />
                  空白孔校正（减去 0 浓度 OD）
                </label>
                <label className="flex items-center gap-2">
                  单位
                  <Input value={unit} onChange={(e) => setUnit(e.target.value)} className="h-8 w-24" />
                </label>
              </div>
              <Button className="mt-4 bg-teal-600 hover:bg-teal-700 w-full sm:w-auto" onClick={doFit}>
                <Calculator className="w-4 h-4 mr-2" />
                拟合曲线
              </Button>
              {fitStale && <p className="mt-2 text-sm text-amber-600">标准品数据已变化，请重新拟合。</p>}
              {fitError && <p className="mt-2 text-sm text-red-600">{fitError}</p>}
            </CardContent>
          </Card>
        ) : (
          fit && (
            <Card className="border-teal-200 bg-teal-50/40">
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-2 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800">标准曲线公式</span>
                      <Badge variant={fit.rSquared >= 0.99 ? 'default' : 'secondary'} className={fit.rSquared >= 0.99 ? 'bg-teal-600' : ''}>
                        R² = {fit.rSquared.toFixed(5)}
                      </Badge>
                    </div>
                    <p className="font-mono text-sm bg-white border rounded px-3 py-2 break-all select-all">{formula(fit.params)}</p>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                      <span>A = {fmt(fit.params.a)}</span>
                      <span>B（Hill 斜率）= {fmt(fit.params.b)}</span>
                      <span>C / EC50 = {fmt(fit.params.c)} {unit}</span>
                      <span>D = {fmt(fit.params.d)}</span>
                      <span>标准曲线范围 {fmt(minC)} – {fmt(maxC)} {unit}</span>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => setStdsCollapsed(false)}>
                    <Pencil className="w-4 h-4 mr-1" />
                    修改标曲
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        )}
        {/* 曲线图 + 回算 */}
        {fit && (
          <div className="grid gap-6 lg:grid-cols-2">
            {chartData && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">标准曲线（对数浓度轴）</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={320}>
                    <ComposedChart margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        type="number"
                        dataKey="conc"
                        scale="log"
                        domain={[chartData.lo * 0.4, chartData.hi * 3]}
                        ticks={[minC, maxC]}
                        tickFormatter={(v: number) => fmt(v)}
                        tick={{ fontSize: 11 }}
                        label={{ value: `浓度 (${unit})`, position: 'insideBottom', offset: -12, fontSize: 12 }}
                        allowDuplicatedCategory={false}
                      />
                      <YAxis tick={{ fontSize: 11 }} label={{ value: 'OD', angle: -90, position: 'insideLeft', fontSize: 12 }} />
                      <Tooltip formatter={(v: number, name: string) => [fmt(v), name]} labelFormatter={(v: number) => `浓度: ${fmt(v)} ${unit}`} />
                      {/* 标准曲线范围高亮 */}
                      <ReferenceArea x1={minC} x2={maxC} fill="#0d9488" fillOpacity={0.06} />
                      <ReferenceLine x={minC} stroke="#0d9488" strokeOpacity={0.5} strokeDasharray="4 4" />
                      <ReferenceLine x={maxC} stroke="#0d9488" strokeOpacity={0.5} strokeDasharray="4 4" />
                      <Line data={chartData.curve} dataKey="od" dot={false} stroke="#0d9488" strokeWidth={2.5} name="4PL 拟合曲线" isAnimationActive={false} />
                      <Scatter data={chartData.scatter} dataKey="od" fill="#1e40af" name="标准品" />
                      <Scatter data={chartData.unkDots} dataKey="od" fill="#dc2626" shape="diamond" name="未知样本" />
                      <ReferenceLine x={fit.params.c} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'EC50', position: 'insideTopRight', fontSize: 11 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div className="flex justify-center gap-6 text-xs text-slate-500 mt-1">
                    <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-teal-600 inline-block"></span>拟合曲线</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-800 inline-block"></span>标准品</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rotate-45 bg-red-600 inline-block"></span>未知样本</span>
                  </div>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">标准品回算（回收率验证）</CardTitle>
                <CardDescription>回算浓度应在标示浓度的 80%–120% 之间</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white">
                      <tr className="text-slate-500 border-b">
                        <th className="text-left py-2 font-medium">标示浓度</th>
                        <th className="text-right py-2 font-medium">实测 OD</th>
                        <th className="text-right py-2 font-medium">拟合 OD</th>
                        <th className="text-right py-2 font-medium">回算浓度</th>
                        <th className="text-right py-2 font-medium">回收率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backCalc.map((r, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td className="py-1.5 font-mono">{fmt(r.conc)}</td>
                          <td className="py-1.5 text-right font-mono">{(blankSub ? r.od + stdPoints.blank : r.od).toFixed(3)}</td>
                          <td className="py-1.5 text-right font-mono">{fourPL(r.conc, fit.params).toFixed(3)}</td>
                          <td className="py-1.5 text-right font-mono">{r.back !== null ? fmt(r.back) : '—'}</td>
                          <td className={`py-1.5 text-right font-mono ${r.recovery !== null && (r.recovery < 80 || r.recovery > 120) ? 'text-amber-600 font-semibold' : ''}`}>
                            {r.recovery !== null ? `${r.recovery.toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        {/* 第二步：未知样本 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">第 2 步 · 未知样本浓度计算</CardTitle>
            <CardDescription>
              {fit ? '输入 OD 值即可实时换算浓度' : '请先完成第 1 步的曲线拟合'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="plate">
              <TabsList>
                <TabsTrigger value="plate">96 孔板模式</TabsTrigger>
                <TabsTrigger value="mapping">OD 浓度映射</TabsTrigger>
              </TabsList>
              {/* 模式一：映射 */}
              <TabsContent value="mapping" className="mt-4">
                <div className="flex gap-2 mb-3">
                  <Button variant="outline" size="sm" onClick={() => setUnkRows(EXAMPLE_UNKS)}>
                    <Sparkles className="w-4 h-4 mr-1" />
                    示例
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setUnkRows([emptyUnk()])}>
                    <Eraser className="w-4 h-4 mr-1" />
                    清空
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-500 border-b">
                        <th className="text-left py-2 pr-2 font-medium">样本名</th>
                        <th className="text-left py-2 px-1 font-medium">OD</th>
                        <th className="text-left py-2 px-1 font-medium">稀释倍数</th>
                        <th className="text-right py-2 px-2 font-medium">计算浓度 ({unit})</th>
                        <th className="text-right py-2 font-medium">状态</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {unkRows.map((r, i) => {
                        const od = parseFloat(r.od)
                        const df = parseDil(r.dilution)
                        const raw = isFinite(od) && fit ? rawConc(od) : null
                        const status = isFinite(od) && fit ? sampleStatus(raw) : null
                        // 只有状态为「有效」时才展示换算浓度，外推结果不作为正常结果
                        const conc = status === 'valid' && raw !== null ? raw * df : null
                        return (
                          <tr key={i} className="border-b border-slate-100">
                            <td className="py-1 pr-2">
                              <Input value={r.name} onChange={(e) => updateUnk(i, 'name', e.target.value)} placeholder={`样本 ${i + 1}`} className="h-8 w-24 sm:w-32" />
                            </td>
                            <td className="py-1 px-1">
                              <Input value={r.od} onChange={(e) => updateUnk(i, 'od', e.target.value)} placeholder="0.000" className="h-8 w-24 sm:w-32" />
                            </td>
                            <td className="py-1 px-1">
                              <Input value={r.dilution} onChange={(e) => updateUnk(i, 'dilution', e.target.value)} placeholder="1" className="h-8 w-16 sm:w-20" />
                            </td>
                            <td className="py-1 px-2 text-right font-mono font-semibold text-teal-700">
                              {fit ? (isFinite(od) ? (conc !== null ? fmt(conc) : '—') : '—') : '待拟合'}
                            </td>
                            <td className="py-1 text-right">
                              {status && (
                                <Badge
                                  variant={status === 'invalid' ? 'destructive' : status === 'valid' ? 'default' : 'secondary'}
                                  className={status === 'valid' ? 'bg-teal-600' : status === 'invalid' ? '' : 'bg-amber-100 text-amber-700'}
                                >
                                  {SAMPLE_STATUS_TEXT[status]}
                                </Badge>
                              )}
                            </td>
                            <td>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-500" onClick={() => setUnkRows((p) => p.filter((_, k) => k !== i))}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setUnkRows((p) => [...p, emptyUnk()])}>
                  <Plus className="w-4 h-4 mr-1" />
                  添加样本
                </Button>
              </TabsContent>
              {/* 模式二：96 孔板 */}
              <TabsContent value="plate" className="mt-4 space-y-6">
                <div className="flex gap-2 flex-wrap items-center">
                  <Button variant="outline" size="sm" onClick={() => { setPlate(emptyPlate()); setSelectedCell(null) }}>
                    <Eraser className="w-4 h-4 mr-1" />
                    清空孔板
                  </Button>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" checked={heatMap} onChange={(e) => setHeatMap(e.target.checked)} className="accent-teal-600" />
                    浓度可视化（越浓颜色越深）
                  </label>
                </div>
                {/* 上板：格内直接录入，可选分组 / OD / 稀释倍数三种录入模式 */}
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-3">
                    <h3 className="text-sm font-medium text-slate-700">
                      孔位录入板 <span className="font-normal text-slate-400">（格内直接输入；方向键 / Enter 切换孔位）</span>
                    </h3>
                    {/* 录入模式切换 */}
                    <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
                      {([
                        ['od', 'OD'],
                        ['group', '分组'],
                        ['dilution', '稀释倍数'],
                      ] as const).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setEntryMode(mode)}
                          className={`px-2.5 py-1 text-xs ${entryMode === mode ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex -mx-2 px-2 sm:mx-0 sm:px-0">
                    {/* 固定行标列（不随孔板滚动） */}
                    <div className="shrink-0 z-10 bg-white border-r border-slate-200 pr-1 mr-0.5 sm:mr-1">
                      <div className="h-[18px] sm:h-[22px] mb-0.5 sm:mb-1" />
                      {ROWS.split('').map((letter) => (
                        <div key={letter} className="w-4 sm:w-6 h-9 mb-0.5 sm:mb-1 flex items-center justify-center text-[10px] sm:text-xs text-slate-500 font-medium">
                          {letter}
                        </div>
                      ))}
                    </div>
                    {/* 可滚动孔格区 */}
                    <div ref={odBoardRef} onScroll={syncScroll('od')} className="overflow-x-auto pb-2 flex-1">
                      <div className="inline-block">
                        <div className="flex gap-0.5 sm:gap-1 mb-0.5 sm:mb-1">
                          {COLS.map((c) => (
                            <div key={c} className="w-[47px] sm:w-[73px] shrink-0 text-center text-[10px] sm:text-xs text-slate-400">{c}</div>
                          ))}
                        </div>
                        {plate.map((row, r) => (
                          <div key={r} className="flex gap-0.5 sm:gap-1 mb-0.5 sm:mb-1 items-center">
                            {row.map((cell, c) => {
                              const num = parseFloat(cell.od)
                              const raw = isFinite(num) && fit ? rawConc(num) : null
                              const outOfRange = raw !== null && (raw < minC || raw > maxC)
                              const uncomputable = isFinite(num) && fit && raw === null
                              const selected = selectedCell?.r === r && selectedCell?.c === c
                              // 热图颜色按浓度编码（无拟合时退回 OD）；分组 / 倍数模式下空格用深色文字保证可读
                              const heatValue = fit && plateResults[r][c] !== null ? (plateResults[r][c] as number) : num
                              const baseCls = !isFinite(num)
                                ? entryMode === 'od'
                                  ? 'bg-white text-slate-300'
                                  : 'bg-white text-slate-700'
                                : uncomputable || outOfRange
                                  ? 'bg-red-100 text-red-700 border-red-300'
                                  : heatMap
                                    ? cellStyle(heatValue, plateMin, plateMax)
                                    : 'bg-teal-50 text-teal-900'
                              return (
                                <input
                                  key={c}
                                  ref={(el) => {
                                    const k = `${r}-${c}`
                                    if (el) odInputRefs.current.set(k, el)
                                    else odInputRefs.current.delete(k)
                                  }}
                                  value={cell[entryMode]}
                                  inputMode={entryMode === 'group' ? 'text' : 'decimal'}
                                  placeholder={entryMode === 'dilution' ? '1' : '—'}
                                  title={`${ROWS[r]}${c + 1}`}
                                  onChange={(e) => updatePlateCell(r, c, entryMode, e.target.value)}
                                  onFocus={() => setSelectedCell({ r, c })}
                                  onKeyDown={onOdCellKeyDown(r, c)}
                                  className={`w-[47px] h-9 sm:w-[73px] sm:h-9 shrink-0 text-[10px] sm:text-xs text-center border rounded ${entryMode === 'group' ? '' : 'font-mono'} px-0.5 outline-none placeholder:text-slate-300 ${baseCls} ${selected ? 'ring-2 ring-inset ring-teal-600' : ''}`}
                                />
                              )
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  {/* 选中孔位编辑面板 */}
                  {selectedCell && (() => {
                    const { r, c } = selectedCell
                    const cell = plate[r][c]
                    const pos = `${ROWS[r]}${c + 1}`
                    const od = parseFloat(cell.od)
                    const df = parseDil(cell.dilution)
                    const raw = isFinite(od) && fit ? rawConc(od) : null
                    const status = isFinite(od) && fit ? sampleStatus(raw) : null
                    const conc = status === 'valid' && raw !== null ? raw * df : null
                    return (
                      <div className="mt-3 rounded-lg border bg-slate-50 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-700">孔位 {pos}</span>
                          <Button variant="ghost" size="sm" className="h-7 text-slate-400" onClick={() => setSelectedCell(null)}>收起</Button>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="flex items-center gap-2 text-sm">
                            分组
                            <Input
                              value={cell.group}
                              onChange={(e) => updatePlateCell(r, c, 'group', e.target.value)}
                              placeholder="例如：对照组"
                              className="h-9 w-32 sm:w-40"
                            />
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            OD
                            <Input
                              value={cell.od}
                              inputMode="decimal"
                              onChange={(e) => updatePlateCell(r, c, 'od', e.target.value)}
                              placeholder="0.000"
                              className="h-9 w-28"
                            />
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            稀释倍数
                            <Input
                              value={cell.dilution}
                              inputMode="decimal"
                              onChange={(e) => updatePlateCell(r, c, 'dilution', e.target.value)}
                              placeholder="1"
                              className="h-9 w-20"
                            />
                          </label>
                          <span className="font-mono text-sm font-semibold text-teal-700">
                            浓度 = {status === null ? (fit ? '—' : '待拟合') : conc !== null ? `${fmt(conc)} ${unit}` : SAMPLE_STATUS_TEXT[status]}
                          </span>
                        </div>
                        {/* 上下左右切换孔位 */}
                        <div className="flex items-center gap-1 pt-1">
                          <Button variant="outline" size="icon" className="h-8 w-8" disabled={c === 0} onClick={() => focusOdCell(r, c - 1)}>
                            <ChevronLeft className="w-4 h-4" />
                          </Button>
                          <Button variant="outline" size="icon" className="h-8 w-8" disabled={c === 11} onClick={() => focusOdCell(r, c + 1)}>
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                          <Button variant="outline" size="icon" className="h-8 w-8" disabled={r === 0} onClick={() => focusOdCell(r - 1, c)}>
                            <ChevronUp className="w-4 h-4" />
                          </Button>
                          <Button variant="outline" size="icon" className="h-8 w-8" disabled={r === 7} onClick={() => focusOdCell(r + 1, c)}>
                            <ChevronDown className="w-4 h-4" />
                          </Button>
                          <span className="text-xs text-slate-400 ml-1">切换孔位</span>
                        </div>
                      </div>
                    )
                  })()}
                </div>
                {/* 下板：浓度结果 */}
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium text-slate-700">
                      浓度结果板 <span className="font-normal text-slate-400">({unit})</span>
                      {!fit && <span className="ml-2 text-amber-600 font-normal">— 请先完成第 1 步拟合</span>}
                    </h3>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!fit}
                        onClick={copyPlateConcentrations}
                        className={copiedMode === 'concentration'
                          ? 'shrink-0 border-emerald-300 bg-emerald-50 text-emerald-700'
                          : 'shrink-0 border-teal-300 text-teal-700 hover:bg-teal-50'}
                      >
                        {copiedMode === 'concentration' ? (
                          <>
                            <Check className="w-4 h-4 mr-1.5" />
                            已复制浓度
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 mr-1.5" />
                            只复制浓度
                          </>
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!fit}
                        onClick={copyPlateGroupsAndConcentrations}
                        className={copiedMode === 'group-concentration'
                          ? 'shrink-0 border-emerald-300 bg-emerald-50 text-emerald-700'
                          : 'shrink-0 border-teal-300 text-teal-700 hover:bg-teal-50'}
                      >
                        {copiedMode === 'group-concentration' ? (
                          <>
                            <Check className="w-4 h-4 mr-1.5" />
                            已复制分组+浓度
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 mr-1.5" />
                            复制分组+浓度
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="flex -mx-2 px-2 sm:mx-0 sm:px-0">
                    {/* 固定行标列（不随孔板滚动） */}
                    <div className="shrink-0 z-10 bg-white border-r border-slate-200 pr-1 mr-0.5 sm:mr-1">
                      <div className="h-[18px] sm:h-[22px] mb-0.5 sm:mb-1" />
                      {ROWS.split('').map((letter) => (
                        <div key={letter} className="w-4 sm:w-6 h-12 sm:h-14 mb-0.5 sm:mb-1 flex items-center justify-center text-[10px] sm:text-xs text-slate-500 font-medium">
                          {letter}
                        </div>
                      ))}
                    </div>
                    {/* 可滚动孔格区 */}
                    <div ref={concBoardRef} onScroll={syncScroll('conc')} className="overflow-x-auto pb-2 flex-1">
                      <div className="inline-block">
                        <div className="flex gap-0.5 sm:gap-1 mb-0.5 sm:mb-1">
                          {COLS.map((c) => (
                            <div key={c} className="w-[47px] sm:w-[73px] shrink-0 text-center text-[10px] sm:text-xs text-slate-400">{c}</div>
                          ))}
                        </div>
                        {plateResults.map((row, r) => (
                          <div key={r} className="flex gap-0.5 sm:gap-1 mb-0.5 sm:mb-1 items-center">
                          {row.map((v, c) => {
                            const cell = plate[r]?.[c]
                            const group = cell?.group.trim() ?? ''
                            const hasOd = isFinite(parseFloat(cell?.od ?? ''))
                            const df = parseDil(cell?.dilution ?? '')
                            let cls = 'bg-white text-slate-300 border-slate-200'
                            let text = '—'
                            let statusText = ''
                            if (hasOd && fit) {
                              const status = sampleStatus(v === null ? null : v / df)
                              statusText = SAMPLE_STATUS_TEXT[status]
                              if (status === 'valid' && v !== null) {
                                cls = 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                text = fmt(v, 3)
                              } else {
                                // 超出范围 / 无法计算时不展示外推浓度
                                cls = 'bg-red-100 text-red-700 border-red-300'
                                text = status === 'invalid' ? 'N/A' : status === 'below-range' ? '低于范围' : '高于范围'
                              }
                            }
                            const selected = selectedCell?.r === r && selectedCell?.c === c
                            return (
                              <button
                                key={c}
                                type="button"
                                onClick={() => focusOdCell(r, c)}
                                title={`${ROWS[r]}${c + 1}${group ? ` · ${group}` : ''} · ${statusText || text}`}
                                className={`w-[47px] h-12 sm:w-[73px] sm:h-14 shrink-0 flex flex-col items-center justify-center gap-0.5 border rounded px-0.5 overflow-hidden ${cls} ${selected ? 'ring-2 ring-inset ring-teal-600' : ''}`}
                              >
                                <span className="w-full text-[8px] sm:text-[10px] leading-tight opacity-80 break-all line-clamp-2">
                                  {group || ' '}
                                </span>
                                <span className="block w-full truncate font-mono text-[10px] sm:text-xs leading-tight">
                                  {text}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      ))}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
                    <Info className="w-3.5 h-3.5 shrink-0" />
                    绿色 = 标准曲线范围内；红色 = 超出标准曲线范围或无法计算（建议调整稀释倍数后复测）。每孔浓度 = 曲线浓度 × 该孔稀释倍数（默认 1）。
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </main>
      <footer className="text-center text-xs text-slate-400 py-6">
        4PL 模型：y = d + (a − d) / (1 + (x/c)^b) · Levenberg-Marquardt 非线性最小二乘拟合 · 仅供科研参考
      </footer>
    </div>
  )
}
