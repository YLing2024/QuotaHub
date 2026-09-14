# AGENTS.md — QuotaHub（LLM 平台余额监控）

> AI 编码代理进入本仓库先读本文件。README.md 是面向人的介绍；冲突时以本文件为准。

## 这个项目是什么

开源的多平台 LLM 余额 / 配额监控面板：卡片式展示各平台余额、趋势图、自动采集、操作日志、预设系统、导入导出。

npm workspaces monorepo：`server/`（TS + Express 5 + SQLite）+ `frontend/`（React 18 + Vite + TS）。

生产：`quotahub.service`，`127.0.0.1:5300`，对外挂在自建子域（部署方配置：nginx Basic Auth + 应用层 `QUOTAHUB_TOKEN` 双密码）。

## 技术栈

| 侧 | 栈 |
|---|---|
| server | TypeScript、Express 5、better-sqlite3、zod；`tsc` 编译到 `dist/`，**systemd 跑 `server/dist/index.js`** |
| frontend | React 18 + Vite + TypeScript、zustand、CodeMirror（脚本编辑）、手写 CSS |
| 测试 | vitest（server + frontend 都有） |
| 数据 | `data/platforms.json`（配置）+ `data/monitor.db`（SQLite 采样）+ `data/logs.json`（操作日志） |

## 目录结构

```
server/src/
├── app.ts / index.ts / config.ts / types.ts
├── db/{connection,init}.ts
├── lib/{fetcher,storage}.ts        # 请求抓取（含 SSRF 防护）+ 脚本沙箱
├── middleware/auth.ts
├── repositories/                   # platformRepo / historyRepo / logRepo / presetRepo / settingsRepo
├── routes/                         # platforms / presets / settings / logs / transfer
├── services/                       # platformService / monitorService / logService / presetService / settingsService / transferService
└── __tests__/                      # vitest 用例
frontend/src/
├── api/ auth/ store/ lib/ styles/ types.ts
└── components/{Dashboard,Config,Logs,Transfer,TrendChart}/
public/                             # 前端构建产物（不入库，后端 express.static 托管）
data/                               # 运行时数据（不入库）
scripts/migrate-json-to-sqlite.mjs
```

## 命令

```bash
npm install                       # 根目录，workspaces 一次装齐
npm run dev                       # server tsx watch
npm run build                     # server tsc + frontend vite build（→ 仓库根 public/）
npm start                         # node server/dist/index.js
npm test                          # server + frontend vitest
npm run lint
# 单侧：
npm run test -w server / npm run typecheck -w server / npm run build -w frontend
```

**改完必须跑：`npm test` + `npm run build`**（前端 `build` 含 `tsc -b`，能拦住类型错误）。

## 部署

```bash
npm run build                     # 构建前后端（前端产物直接落仓库根 public/）
systemctl restart quotahub        # 跑 server/dist/index.js
systemctl status quotahub
```

- nginx：`<自建域名>` → `127.0.0.1:5300`，外层 Basic Auth，`/api/*` 另有 SSO 探针。
- 若配置了镜像域名，改 nginx 时几个域名体系要同步。

## 架构要点

- **分层**：routes → services → repositories → db。新增接口照这条链路加，不要把 SQL 写进 route。
- **平台通用性**：任何 HTTP 接口靠一个「处理函数」（`function (raw) { ... }`）完成解析 + 提取；JSON 走 `JSON.parse`，非 JSON（JS 表达式协议）在函数内 `eval`。处理函数在**沙箱**里执行，有 `QUOTAHUB_SCRIPT_TIMEOUT_MS`（默认 2000ms，限 100~30000）超时上限。
- **SSRF 防护**：默认拒绝内网/环回地址，`QUOTAHUB_ALLOW_PRIVATE=1` 才放行。
- **自动采集**：`monitorService.start()` 由 `settings` 变更和**启动回调**触发。`server/src/index.ts` 里 `if (interval > 0) monitorService.start()` 不能删——曾因缺失导致冷重启后自动采集静默停摆。
- **日志**：采集/操作日志写 `data/logs.json`（`logService` → `logRepo`），**不走 console/journalctl**。journalctl 只有启动横幅，排查自动采集要看 `logs.json` 里 `action=fetch` 的记录。
- **采样时间**：`history_samples.time` 是 **UTC ISO 字符串**，最新采样 = `MAX(time)`。
- **显示格式**：每个平台有自己的 `format` 函数（前缀/后缀）。判断单位别用 `'%' in fmt`——opencode/commandcode 的 format 里有取模 `v % 1`，会误判成百分号。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` / `HOST` | `3000` / `127.0.0.1` | 生产 systemd 设 `PORT=5300` |
| `QUOTAHUB_TOKEN` | 空 | 设置后 `/api/*` 需 `Authorization: Bearer` 或 `X-Quotahub-Token` / `X-Auth-Token` |
| `QUOTAHUB_DATA_DIR` | `./data` | 配置 + SQLite 目录 |
| `QUOTAHUB_STATIC_DIR` | 自动向上查找 `public/` | 静态前端目录覆盖 |
| `QUOTAHUB_SCRIPT_TIMEOUT_MS` | `2000` | 沙箱脚本超时 |
| `QUOTAHUB_ALLOW_PRIVATE` | 空 | `=1` 放行内网地址 |
| `VITE_AUTH_CENTER_URL`（frontend） | 占位 `https://auth.example.com/auth` | **构建时注入**，真实值只存本地 `.env` |

## 安全与仓库红线

- 🔒 **`data/` 曾经在旧 git 历史里被跟踪过**：`.gitignore` 对**曾跟踪**的文件无效。**任何 git 历史操作（rebase / reset --hard / cherry-pick / filter-branch）之前，必须先 `cp -r data/ /root/backups/quotahub-data-$(date +%s)`**。配置数据没有 git 兜底，丢了只能靠旧历史或用户重导。
- 旧历史里曾有含真实 API token 的误提交（已 force push 抹除，但 clone 里可能残留）——推送前扫一遍 `sk-`、真实域名、token。
- 前端构建产物 `public/` **不入库**（构建会注入真实私有地址，提交等于泄漏）；仓库只提交 `.env.example`。
- 私有地址（认证中心域名、`monitor.` 子域、服务器 IP）**只能**通过 `import.meta.env.VITE_*` 注入，源码里不得硬编码。
- 推送到公开仓库前自检：`grep -rn "<你的域名>\|<你的公网IP>\|sk-" --exclude-dir=node_modules .` 应为 0。

## 已知坑

- **验收别裸起服务**：直接 `node server/dist/index.js` 起实例会和 `quotahub.service` 抢端口/把 systemd 单元挤成 inactive；验收后记得 `systemctl restart quotahub` 拉回。
- `public/` 是构建输出目录且被 gitignore，别手动往里塞文件。
- 前端 `build` 是 `tsc -b && vite build`，只跑 vite 会漏类型错误。
- 新增 SQLite 字段要走 `db/init.ts` 的迁移路径，不要假设表结构自动更新。
