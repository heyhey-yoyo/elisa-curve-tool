# ELISA 曲线拟合工具 — 项目说明（供 AI 编程代理阅读）

## 项目概览

**ELISA 四参数 Logistic（4PL）曲线拟合工具** —— 一个纯前端单页应用（SPA），供科研人员在浏览器中完成 ELISA 标准曲线拟合与样本浓度计算。无任何后端、无数据持久化，所有计算在客户端完成。

核心功能：

- 4PL 标曲拟合：`y = d + (a − d) / (1 + (x/c)^b)`，采用 Levenberg-Marquardt 非线性最小二乘算法（自实现，在对数浓度空间拟合，多起点重启取最优），输出参数 a/b/c(EC50)/d、R² 与收敛状态。约定 b > 0、c > 0（内部用 logB/logC 参数化保证），曲线方向由 a 与 d 的大小关系决定（a > d 降低，a < d 升高），不用负 b 表示方向。
- 标准品回算与回收率验证（期望 80%–120%）；启用空白校正时，实测与拟合 OD 均按原始读数口径展示，避免口径不一致导致的视觉偏差。
- 未知样本浓度计算，两种录入模式：
  - **96 孔板模式**：8×12（A–H × 1–12）孔位录入分组 / OD / 稀释倍数（录入板可切换三种录入模式，默认 OD，方向键 / Enter 在格子间移动），上下双板（孔位录入板 + 浓度结果板）横向滚动同步，结果可一键复制（只复制浓度 / 复制分组+浓度，制表符分隔，可直接粘贴到 Excel）。
  - **OD 浓度映射模式**：逐行录入样本名 / OD / 稀释倍数。
- 未知样本带状态标识：有效 / 低于标准曲线范围 / 高于标准曲线范围 / 无法计算；超出范围时不展示外推浓度。映射表中未录入 OD 的空行保持空白（通过 `hasOdInput` 判断），不再误报「无法计算」。
- 空白孔校正（浓度为 0 的标准品行作为空白，从所有 OD 中减去）。
- 标准曲线可视化（对数浓度轴，recharts 绘制拟合曲线、标准品散点、未知样本点、标准曲线范围与 EC50 参考线）。

## 技术栈

- **React 19 + TypeScript（strict）+ Vite 7**（`@vitejs/plugin-react`，dev 端口 3000，`base: './'` 支持相对路径部署）
- **路由**：react-router v7（`BrowserRouter`，目前仅 `/` 一条路由）
- **UI**：shadcn/ui（new-york 风格，组件已生成在 `src/components/ui/`，共 50+ 个）+ Radix UI primitives + Tailwind CSS v3.4（CSS 变量主题，slate 基色）+ lucide-react 图标 + tailwindcss-animate
- **图表**：recharts v2
- **其他**：zod / react-hook-form / @hookform/resolvers（shadcn form 组件的配套依赖，业务代码暂未使用）
- **开发工具**：`kimi-plugin-inspect-react`（Vite 插件，用于元素检查，勿移除）

## 构建与运行命令

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器（http://localhost:3000，支持 HMR）
npm run build      # 生产构建：先 tsc -b 做类型检查，再 vite build 输出到 dist/
npm run preview    # 预览生产构建
npm run lint       # ESLint 检查（eslint.config.js，flat config）
npm run test       # Vitest 单元测试（src/lib/fourPL.test.ts）
```

要求 Node.js 20。提交代码前请确保 `npm run build`、`npm run lint` 与 `npm run test` 均通过（`build` 中的 `tsc -b` 即类型检查）。

## 目录结构与代码组织

```text
src/
├── main.tsx          # 入口：createRoot + StrictMode + BrowserRouter
├── App.tsx           # 路由表（目前只有 / → Home）
├── pages/
│   └── Home.tsx      # 页面组件：状态管理 + UI 渲染，业务逻辑委托给 lib/ 模块；
│                     # 内部含纯展示小组件（PlateRowLabels / PlateColNumbers /
│                     # CopyButton / SelectedCellPanel）与显示文本助手
│                     # （resultText / boardCellDisplay / cellStyle），只读 props 无独立状态
├── lib/
│   ├── fourPL.ts     # 核心算法：4PL 正/反函数、LM 拟合（fitFourPL）、
│   │                 # 曲线点生成（curvePoints）、数字格式化（fmt）、
│   │                 # 公式生成（formula）、EC50 位置诊断（FitDiagnostics）
│   ├── fourPL.test.ts# 算法单元测试（Vitest）
│   ├── parsing.test.ts# parseNumber / parseDil 测试
│   ├── parsing.ts    # 严格数字解析：parseNumber / parseDil
│   ├── standards.test.ts# validateStandardRows 测试
│   ├── standards.ts  # 标准品数据处理：deriveStandardPoints / validateStandards /
│   │                 # validateStandardRows
│   ├── sample.test.ts# computePlateResults / computeUnkResult 测试
│   ├── sample.ts     # 样本浓度计算：computeRawConcentration / computeSampleStatus /
│   │                 # computeUnkResult（单孔结果唯一实现，computePlateResults 逐孔
│   │                 # 复用同一函数，保证板与映射口径一致）/ computeChartUnkDots /
│   │                 # computeBackCalc
│   └── utils.ts      # cn() —— clsx + tailwind-merge（shadcn 约定）
├── hooks/
│   └── use-mobile.ts # shadcn 附带的移动端断点 hook
├── components/ui/    # shadcn/ui 生成的基础组件，勿手写修改，通过 shadcn CLI 增删
├── index.css         # Tailwind 指令 + 主题 CSS 变量（:root / .dark）
└── App.css           # 少量全局样式
```

关键配置文件：`vite.config.ts`（`@` → `./src` 别名、端口 3000、`base: './'`）、`tailwind.config.js`、`components.json`（shadcn 配置）、`tsconfig.app.json`（strict、`@/*` paths）、`eslint.config.js`。

## 代码风格约定

- **代码注释与 UI 文案使用中文**；标识符、类型名用英文。例如 `fourPL.ts` 中的注释和 `Home.tsx` 中的界面文字均为简体中文。
- 一律使用 `@/` 路径别名导入（如 `@/components/ui/button`、`@/lib/fourPL`），不用相对路径跨目录引用。
- UI 组件一律从 `@/components/ui/*` 导入 shadcn 组件，用 `cn()` 合并 Tailwind 类名；主题色为 teal（主按钮、选中态、拟合曲线）。
- 纯图标按钮（无可见文本）必须添加 `aria-label`，例如删除按钮、孔位方向切换按钮。
- TypeScript 严格模式生效：`noUnusedLocals`、`noUnusedParameters`、`verbatimModuleSyntax`（类型导入需 `import type` 或内联 `type` 修饰符）、`erasableSyntaxOnly`（禁用 enum / namespace / 参数属性等需运行时语法的 TS 特性）。
- `eslint.config.js` 对 `src/components/ui/**`（shadcn 生成代码）关闭了 `react-refresh/only-export-components` 与 `react-hooks/purity` 两条规则，属有意豁免，不要为通过 lint 去改这些生成文件。

## 测试策略

项目使用 **Vitest**（`npm run test` / `vitest run`），测试分布在 `src/lib/` 下的四个测试文件：`fourPL.test.ts`（4PL 正/反函数、拟合、平坦拒绝、签名）、`parsing.test.ts`（数字解析）、`standards.test.ts`（行校验、平坦拒绝）、`sample.test.ts`（浓度计算、板结果）。页面层无组件测试，UI 改动通过 `npm run build` + `npm run lint` + 手动运行 `npm run dev` 验证；修改算法后必须保证测试全绿，并用页面内置示例数据（`EXAMPLE_STDS`，R² 应 ≥ 0.99）回归验证。

## 部署

纯静态站点：`npm run build` 产出 `dist/`，因 `base: './'` 可部署到任意静态托管的任意子路径（GitHub Pages、对象存储、CDN 等），无需服务端配置（当前只有一条路由，无需 history fallback）。

## 安全与其他注意事项

- 应用不发送网络请求、不存储用户数据、不使用 Cookie / localStorage，无认证逻辑，无环境变量 / 密钥；浏览器剪贴板写入带有 `execCommand` 降级方案（见 `copyText`）。
- 算法正确性是本项目的核心价值：修改 `src/lib/fourPL.ts` 前请理解 LM 迭代、解析雅可比（`modelWithGrad`，替换了有限差分）、多起点策略与拟合后 EC50 诊断，并用页面内置的示例数据（`EXAMPLE_STDS`，R² 应 ≥ 0.99）回归验证。Logistic 计算统一走数值稳定的 `stableW`（`fourPL` 与 `model` 共用）与 `stablePair`（仅 `modelWithGrad` 使用，返回 w 与 w(1−w)），分支形式避免 `exp(s)` 溢出 / 下溢产生 NaN；`modelWithGrad` 内 NaN 与 |s|>700 的特判是刻意的（梯度在渐近线处归零），不要用通用公式替换。
- `fourPLInverse` 对超出渐近线区间的 OD 返回 `null`，页面据此显示「无法计算 / N/A」——新增逻辑请保持这一约定。
- `fitFourPL` 要求至少 5 个**不同**的浓度（复孔不计入）；标准品 OD 必须存在响应变化（`Math.max(ods) !== Math.min(ods)`），平坦数据（所有 OD 相等）直接返回 null，不进行优化。`validateStandards` 也包含相同检查并给出明确中文错误提示。
- `FitResult.converged` / `reason` 是真实的收敛状态（tolerance / max-iterations / singular / no-improvement）：未收敛的结果页面不得作为有效拟合展示，也不用于样本浓度计算。
- `FitResult.diagnostics.ec50Location` 为拟合后诊断（inside-standard-range / outside-standard-range / extreme），不参与优化过程。EC50 优化中不再被硬边界裁剪，可自由移动以寻找真实驻点。
- `FitResult` 不含 `iterations` 字段（多起点迭代总和无参考价值）。
- 标准品任何变化（浓度 / OD / 增删行 / 空白校正）都会改变 `Home.tsx` 中的 `currentSig`（`JSON.stringify({ stds, blankSub })`），使旧拟合立即失效（派生的 `fit` 置空并提示重新拟合）——修改标准品相关逻辑时请保持这一签名失效机制。
- 页面首次打开为标准品空表，示例数据需点击「载入示例」才加载。
- 数字解析使用 `parseNumber()` 严格校验：空字符串返回 `null`；非法 / 不完整输入（如 `100abc`）返回 `null`（不会像 `parseFloat` 那样部分解析）。稀释倍数使用 `parseDil()`：空字符串默认 1，非法非空返回 `null`（页面显示「稀释倍数无效」）。
- `src/components/ui/` 为 shadcn 生成代码，不要手工编辑样式逻辑；需要新组件时用 shadcn CLI 添加。

---

## AI 维护提醒

> **⚠️ 任何修改此项目的 AI 代理（包括未来的你自己）都必须遵守：**
>
> - **修改代码后必须同步更新本 AGENTS.md 与 README.md** — 新增文件、架构变更、功能增删、部署方式变更都需要在两份文档中体现
> - README.md 面向**人类用户**（功能介绍、运行方法、部署步骤），AGENTS.md 面向 **AI 代理**（架构、代码组织、测试策略、开发约定）
> - 两份文件**不可互相替代**，各有所众
> - 项目的实际文件结构必须与 AGENTS.md 中列出的文件清单保持一致
