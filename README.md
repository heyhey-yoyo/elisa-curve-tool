# ELISA 曲线拟合工具

纯前端单页应用，在浏览器中完成 ELISA 标准曲线的四参数 Logistic（4PL）拟合与样本浓度计算。无后端、无数据持久化，所有计算均在客户端完成。

## 功能特性

- **4PL 标曲拟合**：`y = d + (a − d) / (1 + (x/c)^b)`，自实现 Levenberg-Marquardt 非线性最小二乘（对数浓度空间拟合，多起点重启取最优），输出参数 a/b/c(EC50)/d、R² 与收敛状态
  - 约定 b > 0、c > 0，曲线方向由 a 与 d 的大小关系决定（a > d 降低，a < d 升高）
  - 未收敛的拟合（达到最大迭代 / 矩阵奇异 / 无改善）会明确报错，不用于浓度计算
  - 要求至少 5 个**不同**的标准品浓度，复孔不计入
  - 标准品数据一旦修改，旧拟合立即失效并提示重新拟合
- **标准品回算**：自动回算各标准点浓度并给出回收率（期望 80%–120%）
- **样本浓度计算**，两种录入模式：
  - **96 孔板模式**：8×12（A–H × 1–12）孔位录入，格内直接输入，可在 分组 / OD / 稀释倍数 三种录入模式间切换（默认 OD），方向键 / Enter 在格子间移动；上下双板（孔位录入板 + 浓度结果板）横向滚动同步；结果一键复制（只复制浓度 / 复制分组+浓度，制表符分隔，可直接粘贴到 Excel）
  - **OD 浓度映射模式**：逐行录入样本名 / OD / 稀释倍数
- **样本状态标识**：有效 / 低于标准曲线范围 / 高于标准曲线范围 / 无法计算，超出范围不展示外推浓度
- **空白孔校正**：浓度为 0 的标准品行作为空白，从所有 OD 中减去
- **标准曲线可视化**：对数浓度轴，拟合曲线、标准品散点、未知样本点、标准曲线范围与 EC50 参考线

页面首次打开为标准品空表，点击「载入示例」可填入示例数据体验完整流程。

## 技术栈

- React 19 + TypeScript（strict）+ Vite 7
- 路由：react-router v7
- UI：shadcn/ui + Radix UI + Tailwind CSS v3.4 + lucide-react
- 图表：recharts v2
- 测试：Vitest

## 开发

要求 Node.js 20。

```bash
npm install     # 安装依赖
npm run dev     # 开发服务器（http://localhost:3000，支持 HMR）
npm run build   # 生产构建（先 tsc -b 类型检查，再 vite build 输出到 dist/）
npm run preview # 预览生产构建
npm run lint    # ESLint 检查
npm run test    # Vitest 单元测试
```

提交代码前请确保 `npm run build`、`npm run lint` 与 `npm run test` 均通过。

## 目录结构

```
src/
├── main.tsx            # 入口
├── App.tsx             # 路由表（/ → Home）
├── pages/
│   └── Home.tsx        # 全部业务页面：标准品录入、拟合、图表、回算表、
│                       # 96 孔板 / 映射两种浓度计算模式、剪贴板导出
├── lib/
│   ├── fourPL.ts       # 核心算法：4PL 正/反函数、LM 拟合、曲线点生成、
│   │                   # 标准品签名（拟合失效判断）、数字格式化
│   ├── fourPL.test.ts  # 算法单元测试（Vitest）
│   └── utils.ts        # cn() —— clsx + tailwind-merge
├── hooks/
│   └── use-mobile.ts   # 移动端断点 hook
└── components/ui/      # shadcn/ui 生成的组件
```

## 部署

纯静态站点。`npm run build` 产出 `dist/`，因 Vite 配置 `base: './'`，可部署到任意静态托管的任意子路径（GitHub Pages、对象存储、CDN 等），无需服务端配置。

## 注意事项

- 应用不发送网络请求、不存储用户数据，无认证逻辑，无环境变量 / 密钥。
- 算法正确性是核心价值：修改 `src/lib/fourPL.ts` 后请确保 `npm run test` 全绿，并用页面示例数据（R² 应 ≥ 0.99）回归验证。
- `fourPLInverse` 对超出渐近线区间的 OD 返回 `null`，页面据此显示「无法计算 / N/A」。
- 浓度为 0 的标准品行只用于空白校正，不参与拟合。

---

## AI 维护提醒

> **⚠️ 任何修改此项目的 AI 代理（Claude Code、Cursor、Copilot 等）都必须同步更新本文件与 AGENTS.md。**
>
> - 新增功能 → 在 README 中添加用户可理解的说明
> - 新增/删除文件 → 更新本文和 AGENTS.md 中的文件清单
> - 修改架构 → 更新 AGENTS.md 的架构说明
> - 部署方式变更 → 同步更新本文部署章节
> - 保持 **README 面向人类用户**，**AGENTS.md 面向 AI 代理**，两份文件不可互相替代
