# AGENTS.md

## 项目概览

**ELISA 四参数 Logistic（4PL）曲线拟合工具** —— 一个纯前端单页应用（SPA），供科研人员在浏览器中完成 ELISA 标准曲线拟合与样本浓度计算。无任何后端、无数据持久化，所有计算在客户端完成。

核心功能：

- 4PL 标曲拟合：`y = d + (a − d) / (1 + (x/c)^b)`，采用 Levenberg-Marquardt 非线性最小二乘算法（自实现，在对数浓度空间拟合，多起点重启取最优），输出参数 a/b/c(EC50)/d、R² 与收敛状态。约定 b > 0、c > 0（内部用 logB/logC 参数化保证），曲线方向由 a 与 d 的大小关系决定（a > d 降低，a < d 升高），不用负 b 表示方向。
- 标准品回算与回收率验证（期望 80%–120%）。
- 未知样本浓度计算，两种录入模式：
  - **96 孔板模式**：8×12（A–H × 1–12）孔位录入分组 / OD / 稀释倍数（录入板可切换三种录入模式，默认 OD，方向键 / Enter 在格子间移动），上下双板（孔位录入板 + 浓度结果板）横向滚动同步，结果可一键复制（只复制浓度 / 复制分组+浓度，制表符分隔，可直接粘贴到 Excel）。
  - **OD 浓度映射模式**：逐行录入样本名 / OD / 稀释倍数。
- 未知样本带状态标识：有效 / 低于标准曲线范围 / 高于标准曲线范围 / 无法计算；超出范围时不展示外推浓度。
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

```
src/
├── main.tsx          # 入口：createRoot + StrictMode + BrowserRouter
├── App.tsx           # 路由表（目前只有 / → Home）
├── pages/
│   └── Home.tsx      # 全部业务页面：标准品录入、拟合触发、图表、回算表、
│                     # 96 孔板 / 映射两种浓度计算模式、剪贴板导出
├── lib/
│   ├── fourPL.ts     # 核心算法：4PL 正/反函数、LM 拟合（fitFourPL）、
│   │                 # 曲线点生成（curvePoints）、数字格式化（fmt）
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
- TypeScript 严格模式生效：`noUnusedLocals`、`noUnusedParameters`、`verbatimModuleSyntax`（类型导入需 `import type` 或内联 `type` 修饰符）、`erasableSyntaxOnly`（禁用 enum / namespace / 参数属性等需运行时语法的 TS 特性）。
- `Home.tsx` 中刻意省略部分 `useMemo` 依赖的地方保留了 `eslint-disable-next-line react-hooks/exhaustive-deps`，属有意为之。
- `Home.tsx` 第 1 行有一个功能版本标记注释（格式为 `ELISA_<功能>_<日期>`，当前为 `ELISA_REVIEW_FIXES_20260728`），更新相关功能时按现有惯例同步维护。
- `eslint.config.js` 对 `src/components/ui/**`（shadcn 生成代码）关闭了 `react-refresh/only-export-components` 与 `react-hooks/purity` 两条规则，属有意豁免，不要为通过 lint 去改这些生成文件。

## 测试策略

项目使用 **Vitest**（`npm run test` / `vitest run`），测试集中在 `src/lib/fourPL.test.ts`，覆盖 4PL 正/反函数往返、升高/降低曲线拟合、唯一浓度数量检查、复孔处理、无法收敛情形（singular / max-iterations）、超出曲线范围与标准品签名失效。页面层无组件测试，UI 改动通过 `npm run build` + `npm run lint` + 手动运行 `npm run dev` 验证；修改算法后必须保证测试全绿，并用页面内置示例数据（`EXAMPLE_STDS`，R² 应 ≥ 0.99）回归验证。

## 部署

纯静态站点：`npm run build` 产出 `dist/`，因 `base: './'` 可部署到任意静态托管的任意子路径（GitHub Pages、对象存储、CDN 等），无需服务端配置（当前只有一条路由，无需 history fallback）。

## 安全与其他注意事项

- 应用不发送网络请求、不存储用户数据、不使用 Cookie / localStorage，无认证逻辑，无环境变量 / 密钥；浏览器剪贴板写入带有 `execCommand` 降级方案（见 `copyText`）。
- 算法正确性是本项目的核心价值：修改 `src/lib/fourPL.ts` 前请理解 LM 迭代、有限差分雅可比与多起点策略，并用页面内置的示例数据（`EXAMPLE_STDS`，R² 应 ≥ 0.99）回归验证。
- `fourPLInverse` 对超出渐近线区间的 OD 返回 `null`，页面据此显示「无法计算 / N/A」——新增逻辑请保持这一约定。
- `fitFourPL` 要求至少 5 个**不同**的浓度（复孔不计入）；浓度为 0 的行只用于空白校正，不参与拟合。
- `FitResult.converged` / `reason` 是真实的收敛状态（tolerance / max-iterations / singular / no-improvement）：未收敛的结果页面不得作为有效拟合展示，也不用于样本浓度计算。
- 标准品任何变化（浓度 / OD / 增删行 / 空白校正）都会改变 `standardsSignature`，使旧拟合立即失效（`Home.tsx` 中派生的 `fit` 置空并提示重新拟合）——修改标准品相关逻辑时请保持这一机制。
- 页面首次打开为标准品空表，示例数据需点击「载入示例」才加载。
- `src/components/ui/` 为 shadcn 生成代码，不要手工编辑样式逻辑；需要新组件时用 shadcn CLI 添加。
