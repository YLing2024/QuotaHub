# QuotaHub · 前端改 Ant Design 设计语言（含 ECharts）· 需求书

> 执行者：opencode（build agent）。本文件自包含，读完直接实现，不要提问；与仓库现实冲突时以仓库现实为准。
> 用户原话：「QuotaHub，也改成 antdesign 的设计语言」「antdesign，然后图表就用 echarts」。

## 0. 一句话目标

把 `frontend/` 的用户界面**整体换成 Ant Design 5 的默认设计语言**，趋势图改用 **ECharts**；
配色 / 圆角 / 字体 / 组件外观一律用 antd 默认值，**不做任何自定义 token 映射**。

## 1. 铁律（踩过坑，逐条遵守）

1. **设计语言 = antd 默认**。本项目现在的暖纸白 + 墨黑 + 琥珀 + 直角 + 自托管字体（Inter Tight / Inter / JetBrains Mono）
   属于**旧设计语言**，要整体退场：
   - 主色回 antd 默认 `#1677ff`，圆角 antd 默认（6px），动效 antd 默认，字体用 antd 默认字体栈。
   - **不要**把 `--bg/--fg/--accent` 等既有令牌映射进 antd token —— 那样看起来"还是老样子"，用户已明确否决过这种做法的同类结果。
   - `ConfigProvider` 只保留 `algorithm`（浅色 `defaultAlgorithm` / 深色 `darkAlgorithm`）+ `locale={zhCN}`；
     深浅色沿用现有 `prefers-color-scheme` 的机制决定用哪个 algorithm。
2. **删掉自托管字体**（`src/fonts/`：fonts.css + 9 个 woff2）与所有 `@font-face` / `--font*` 用法；构建产物里不应再出现 woff2。
3. **旧 CSS 不许与 antd 争样式**：`src/styles/style.css`（1486 行）里凡是被 antd 组件取代的规则要删掉；
   **元素级规则**（`button {}`、`input {}`、`table {}` 之类）会命中 antd 组件，必须收窄（如 `button:not([class*='ant-'])`）或删除。
   最终 `style.css` 只保留布局 glue（尺寸、栅格、间距、滚动容器），不留视觉样式。
4. **图表一律 ECharts**：`echarts/core` + 按需注册（LineChart、Grid/Tooltip/Legend/DataZoom 等），**不要 import 整包、不要 CDN、
   不要引入除 echarts 外的库**；图表组件用 `React.lazy` / 动态 import，**不进主入口 chunk**；加载中给 antd `Skeleton`；
   深浅色切换要重建或重设 option；容器尺寸变化能正确 resize；组件卸载 `dispose`（不许泄漏实例）。
5. 零自定义色值 / 圆角 / 字号 / 字距 / 阴影；图表配色取 antd 主题 token（`theme.useToken()` 的 colorPrimary/colorSuccess/colorError 等）。

## 2. 不许动（红线）

- **`server/` 一个字都不许改**（接口、SQLite、认证、沙箱、SSRF 全不碰）；根 `package.json` 的 workspaces 结构不动。
- **接口契约**：`src/api/*`（`endpoints.ts` / `client.ts` / `auth.ts` / `authMode.ts`）的路径、方法、请求/响应字段与
  401 分发、`authMode` 探测（**失败按 sso，绝不回退 builtin**）一律不变。加依赖只能改 `frontend/package.json`。
- **文案逐字**：所有标题、按钮、提示、错误、空态、单位、图例名、二次确认，一个字都不改。
- **登录页语义**：`AUTH_MODE=builtin` 自带账号登录（口令、错误提示、限速提示文案）与 `sso` 下不出现本地登录页的行为不变。
- **功能语义**：预设系统（内置预设只收录官方开放 API）、脚本编辑（CodeMirror 保留，样式交 antd 外观包围即可，
  编辑器本体的主题色可保留其默认）、导入导出、操作日志（`data/logs.json`）、转移/合并、余额与趋势的数据口径与单位全部不变。
- **公开仓库红线**：源码与文档里不得出现真实域名 / 公网 IP / `sk-` 之类密钥；`public/` 是构建产物且已 gitignore，不要提交它。
- `data/` 不要动；也不要做任何 git 历史操作。

## 3. 分轮实施（每轮独立 commit、独立自检）

### 第 1 轮 · 依赖 + 主题 + 外壳 + 登录页
- `frontend/package.json` 加 `antd`（^5）与 `echarts`（^6 或与项目兼容的 5.x）；不引入其它 UI 库。
- `src/main.tsx`：包 `ConfigProvider`（`locale={zhCN}`、algorithm 随深浅色）+ `App`（供 message/modal 静态用法）。
- `src/App.tsx`：顶部导航 / 布局改成 antd（`Layout` / `Menu` 或 `Tabs` / `Space`），深浅色跟随系统。
- `src/components/Auth/LoginPage.tsx`：antd `Form` + `Input` + `Button` + `Alert`；文案逐字保留；回车提交、错误提示语义不变。
- 删除字体文件与 `@font-face`；`index.html` 里如有字体 preload 也要删。

### 第 2 轮 · Dashboard + 趋势图
- `src/components/Dashboard/index.tsx`：平台卡片改用 antd `Card` / `Statistic` / `Tag` / `Badge` / `Progress` / `Skeleton`；
  数值用 antd 常规文本（不要等宽自定义字体），余额/额度的展示格式与单位口径不变。
- `src/components/TrendChart/*`：折线图换 ECharts（按需 + 懒加载）；`chartLogic.ts` 的**算法与数据口径不许改**
  （它带单测 `chartLogic.test.ts`，测试必须继续通过）；`TrendChartModal.tsx` 的弹层换 antd `Modal`，
  图例/时间范围切换/空态语义与文案不变。

### 第 3 轮 · Config + Logs
- `src/components/Config/index.tsx`、`UsePresetModal.tsx`、`EditPresetModal.tsx`：表单/表格/弹层换 antd；
  `CodeEditor.tsx`（CodeMirror）保留，外层容器换 antd 外观；预设的内置/自定义区分、错误提示、字段校验语义不变。
- `src/components/Logs/index.tsx`：列表/表格换 antd `Table`/`List`/`Tag`，日志字段与分页语义不变。

### 第 4 轮 · Transfer + 收尾
- `src/components/Transfer/*`：`TransferModal.tsx` 换 antd；`classify.ts` 的判定逻辑与其单测不许改。
- 收尾：清空 `style.css` 里所有已被 antd 取代的规则（只留布局 glue）；确认产物里无 woff2、无自定义色值；
  `README.md` 里若描述了旧设计语言（字体 / 配色），同步改成 antd 的说法（**只改描述，不改功能说明**）。

## 4. 自检（每轮都要，输出证据）

```bash
npm run test -w frontend        # vitest，必须全过（含 chartLogic/classify/store 既有用例）
npm test                        # 根：server + frontend 全过
npm run typecheck -w server     # 不应受影响
npm run build                   # tsc -b && vite build（前端产物落仓库根 public/）
```
另需打印：
- 改动文件里 `from 'antd'` 的组件使用数、自定义色值（`#rrggbb` / `rgba(`）命中数（应为 0，含 style.css）。
- ECharts 引入片段（证明按需 + 动态 import），以及 `public/assets/` 里主入口 chunk 与图表 chunk 的体积（图表必须独立成 chunk）。
- `find public -name '*.woff2' | wc -l` 应为 0。
- `src/styles/style.css` 行数变化（改前 1486）。

## 5. 验收隔离（我自己做，你不许动生产）

- **不要** `systemctl`（生产 `quotahub.service` 跑在 5300，抢端口会把单元挤 inactive）、不要 kill/pkill、不要碰仓库外路径。
- 需要起实例自测时：`PORT=5399 QUOTAHUB_DATA_DIR=/tmp/quota-verify-data AUTH_MODE=builtin` + 只监听 127.0.0.1。
- 命令一律带 `timeout`；构建用 `npm run build`（其产物本就落 `public/`，是仓库约定，允许）；
  验收完不要动 `data/`。

## 6. 流程纪律

- 在当前分支 `main` 上**小步 commit**（conventional commits），每条完成后立即提交；**禁止** `git push` / 建分支 / rebase / reset / merge /
  任何历史操作（`data/` 曾进过旧历史，历史操作前必须先备份）。
- 提交信息里不得出现工具署名（Hermes / opencode / Co-Authored-By / Generated 等）。
- 报告写到 `docs/` 之外？**不要**：每轮把报告写进 `/tmp/quotahub-round<N>-report.md` 并 `cat` 出来。
