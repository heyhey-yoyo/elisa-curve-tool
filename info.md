# 技术环境索引

开发环境、构建入口与代码结构索引。

- 应用：React、TypeScript、Vite、Tailwind、shadcn/Radix 组件；依赖与实际锁定版本见 package.json 和 package-lock.json。
- 页面直接渲染 Home，不按 pathname 筛选路由；部署支持根目录和带末尾斜杠的子目录，以及对应 index.html 入口。
- 安装使用 npm ci；Node 需满足锁定 Vite 的 engines，建议使用与项目构建环境一致的 Node 22.12+。
- 入口：index.html、src/main.tsx、src/App.tsx；全局样式 src/index.css，组件 src/components/。
- 开发 npm run dev；检查 npm run lint、npm test；生产构建 npm run build；产物在 dist/。
- 工具说明见 [README.md](./README.md)，模块、拟合计算、热图和维护约束见 [AGENTS.md](./AGENTS.md)。
