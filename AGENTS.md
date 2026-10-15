# AGENTS.md — QuotaHub（LLM 平台余额监控）

> 维护本仓库前先读本文件。README.md 是面向用户的介绍；冲突时以本文件为准。

## 这个项目是什么

开源的多平台 LLM 余额 / 配额监控面板：卡片式展示各平台余额、趋势图、自动采集、操作日志、预设系统、导入导出。

npm workspaces monorepo：`server/`（TS + Express 5 + SQLite）+ `frontend/`（React 18 + Vite + TS）。

生产：`quotahub.service`，`127.0.0.1:5300`，对外挂在自建子域，以 `AUTH_MODE=sso` 接 **Auth Gateway**（`127.0.0.1:18920`，nginx 反代进来）：登录 / OAuth2 / state / PKCE / 会话都在网关；`/api/*` 身份来自网关注入的 `X-Auth-User` 头，本仓库零 OAuth / token 代码。**仓库默认 `AUTH_MODE=builtin`**：自带账号 + 登录页，陌生人 clone 下来开箱即用。

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
├── lib/{fetcher,storage,cookies}.ts # 请求抓取（含 SSRF 防护）+ 脚本沙箱 + 会话 cookie
├── middleware/auth.ts               # 按 AUTH_MODE 分支: builtin 校验会话 / sso 读 X-Auth-User
├── repositories/                   # platformRepo / historyRepo / logRepo / presetRepo / settingsRepo / userRepo / sessionRepo
├── routes/                         # platforms / presets / settings / logs / transfer / auth
├── services/                       # platformService / monitorService / logService / presetService / settingsService / transferService / authService
└── __tests__/                      # vitest 用例
frontend/src/
├── api/ store/ lib/ styles/ types.ts
└── components/{Dashboard,Config,Logs,Transfer,TrendChart,Auth}/
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

- nginx：`<自建域名>` → Auth Gateway（`127.0.0.1:18920`）；网关鉴权后把 `/api/*` 反代到 `127.0.0.1:5300` 并注入 `X-Auth-User`，静态页面 `/` 直连后端。配置里**不再有** `auth_request` / 探针 / `?token=`。
- 若配置了镜像域名，改 nginx 时几个域名体系要同步。

## 架构要点

- **分层**：routes → services → repositories → db。新增接口照这条链路加，不要把 SQL 写进 route。
- **平台通用性**：任何 HTTP 接口靠一个「处理函数」（`function (raw) { ... }`）完成解析 + 提取；JSON 走 `JSON.parse`，非 JSON（JS 表达式协议）在函数内 `eval`。处理函数在**沙箱**里执行，有 `QUOTAHUB_SCRIPT_TIMEOUT_MS`（默认 2000ms，限 100~30000）超时上限。
- **SSRF 防护**：默认拒绝内网/环回地址，`QUOTAHUB_ALLOW_PRIVATE=1` 才放行。
- **自动采集**：`monitorService.start()` 由 `settings` 变更和**启动回调**触发。`server/src/index.ts` 里 `if (interval > 0) monitorService.start()` 不能删——曾因缺失导致冷重启后自动采集静默停摆。
- **日志**：采集/操作日志写 `data/logs.json`（`logService` → `logRepo`），**不走 console/journalctl**。journalctl 只有启动横幅，排查自动采集要看 `logs.json` 里 `action=fetch` 的记录。
- **采样时间**：`history_samples.time` 是 **UTC ISO 字符串**，最新采样 = `MAX(time)`。
- **显示格式**：每个平台有自己的 `format` 函数（前缀/后缀）。判断单位别用 `'%' in fmt`——某些上游的 format 里有取模 `v % 1`，会误判成百分号。
- **认证（`AUTH_MODE`）**：默认 `builtin`（自带账号，开箱即用），可选 `sso`（关掉自带口令，只认 `X-Auth-User`）。未设置/非法值一律 `builtin`。
  - 分层：`middleware/auth.ts` 按模式分支 → `authService`（scrypt 哈希、会话滑动续期、按 IP 限速）→ `userRepo`/`sessionRepo`（SQLite `users`/`sessions` 表，建表在 `db/init.ts`）。**不要**把 SQL 写进 `routes/auth.ts`。
  - `builtin` **忽略** `X-Auth-User`；`sso` **忽略**会话，只读网关注入头。两种模式都不 302、不做 OIDC 跳转。
  - `GET /api/auth-mode` 免鉴权；`/api/auth/{login,logout,me}` 仅 builtin 存在（sso 下 404）。会话 cookie 名 `quotahub_session`（HttpOnly/SameSite=Lax，HTTPS 加 Secure），也接受 `Authorization: Bearer <token>`。
  - 前端 `api/authMode.ts` 探测模式（**探测失败按 `sso`，绝不回退 `builtin`**）；`api/client.ts` 全局 401 按模式分发（sso 跳网关登录页且已在 `/_auth/` 不重复跳；builtin 切回本地登录页）。
  - 首启 `users` 为空时创建管理员，口令来自 `QUOTAHUB_ADMIN_PASSWORD`，未设则随机生成并**只在启动日志打印一次**；已有用户不覆盖口令。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` / `HOST` | `3000` / `127.0.0.1` | 生产 systemd 设 `PORT=5300` |
| `QUOTAHUB_DATA_DIR` | `./data` | 配置 + SQLite 目录 |
| `QUOTAHUB_STATIC_DIR` | 自动向上查找 `public/` | 静态前端目录覆盖 |
| `QUOTAHUB_SCRIPT_TIMEOUT_MS` | `2000` | 沙箱脚本超时 |
| `QUOTAHUB_ALLOW_PRIVATE` | 空 | `=1` 放行内网地址 |
| `AUTH_MODE` | `builtin` | `builtin`（自带账号）/ `sso`（关掉自带口令，只认 `X-Auth-User`）；非法值回退 `builtin` |
| `QUOTAHUB_ADMIN_USER` | `admin` | 首启创建的管理员用户名 |
| `QUOTAHUB_ADMIN_PASSWORD` | 空 | 管理员口令；空则首启随机生成并只打印一次 |
| `QUOTAHUB_SESSION_TTL_HOURS` | `12` | 自带账号会话有效期（小时） |

> 生产以 `AUTH_MODE=sso` 跑时，登录态完全在前置认证层，本服务不写 OAuth / token 代码。

## 安全与仓库红线

- 🔒 **`data/` 曾经在旧 git 历史里被跟踪过**：`.gitignore` 对**曾跟踪**的文件无效。**任何 git 历史操作（rebase / reset --hard / cherry-pick / filter-branch）之前，必须先 `cp -r data/ ./backups/quotahub-data-$(date +%s)`**。配置数据没有 git 兜底，丢了只能靠旧历史或用户重导。
- 推送前扫一遍 `sk-`、真实域名、token。
- 前端构建产物 `public/` **不入库**（本地构建，由后端 `express.static` 托管）；仓库只提交 `.env.example`。
- 鉴权分流：`builtin` 自带账号（`node:crypto` scrypt，不引入新依赖），`sso` 交给前置认证层；本仓库**不写**任何 OAuth / SSO 跳转 / 上游 token 代码；源码里不得硬编码认证中心域名、部署域名或服务器 IP。
- 推送到公开仓库前自检：`grep -rn "<你的域名>\|<你的公网IP>\|sk-" --exclude-dir=node_modules .` 应为 0。

## 已知坑

- **验收别裸起服务**：直接 `node server/dist/index.js` 起实例会和 `quotahub.service` 抢端口/把 systemd 单元挤成 inactive；验收后记得 `systemctl restart quotahub` 拉回。
- `public/` 是构建输出目录且被 gitignore，别手动往里塞文件。
- 前端 `build` 是 `tsc -b && vite build`，只跑 vite 会漏类型错误。
- 新增 SQLite 字段要走 `db/init.ts` 的迁移路径，不要假设表结构自动更新。

