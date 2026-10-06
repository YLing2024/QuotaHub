[简体中文](README.md) ｜ [English](README.en.md)

# QuotaHub

自托管的多平台 LLM 余额监控面板，统一查看各平台的配额与余额。

## 它能做什么

- **监控面板**：按平台卡片展示最新余额与最近更新时间，可单卡刷新或整体「立即刷新」。
- **余额趋势图**：每张卡片可打开折线图查看余额随时间的变化，支持拖动时间窗口、悬停读数，鼠标与触摸共用一套指针操作。
- **自动采集**：在「设置」里配置采集间隔（秒），按时抓取所有平台并记录采样点；设为 0 即关闭。
- **任意 HTTP 接口适配**：一个处理函数 `function (raw) { ... }` 同时完成解析与取值。JSON 接口可直接 `JSON.parse`；返回 JS 表达式的接口可在函数内 `eval`。
- **预设**：内置 NEWAPI 模板，可新建 / 编辑 / 重置 / 导出预设，并交互式套用到平台配置。
- **平台配置**：填写请求方法、URL、请求头与处理函数，可先校验再保存，并可调整平台顺序。
- **导入导出**：完整配置、单个平台、单个预设均可导出为 JSON 并再次导入。
- **显示格式**：每个平台独立的前缀 / 后缀，例如 `$8.51` 或 `41 %`。
- **操作日志**：记录增删改、抓取、导入导出、设置变更等操作，最多保留 2000 条，可查看与清空。

## 快速开始

```bash
npm install
npm run build
npm start
# 浏览器打开 http://127.0.0.1:3000
```

开发时前后端分别启动：

```bash
npm run dev              # 后端 tsx watch（默认 127.0.0.1:3000）
npm run dev -w frontend  # 前端 Vite dev server，/api 代理到 127.0.0.1:3000
```

## 数据存放

- `data/platforms.json`、`data/presets.json`、`data/settings.json`：平台、预设与设置。
- `data/logs.json`：操作日志，最多 2000 条。
- `data/monitor.db`：SQLite，存放历史采样点，以及 builtin 模式的账号与会话。

从旧版 JSON 历史迁移到 SQLite：

```bash
npm run migrate
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 服务端口 |
| `HOST` | `127.0.0.1` | 绑定地址 |
| `QUOTAHUB_DATA_DIR` | `<仓库根>/data` | 数据目录；相对路径按当前工作目录解析 |
| `QUOTAHUB_STATIC_DIR` | `<仓库根>/public`（存在时启用） | 前端静态目录覆盖 |
| `QUOTAHUB_SCRIPT_TIMEOUT_MS` | `2000` | 处理函数执行超时，钳制在 100~30000 |
| `QUOTAHUB_ALLOW_PRIVATE` | 空 | `=1` 时允许抓取内网 / 环回地址 |
| `AUTH_MODE` | `builtin` | 认证模式：`builtin` / `sso`；非法值回退 `builtin` |
| `QUOTAHUB_ADMIN_USER` | `admin` | builtin 模式首启创建的管理员用户名 |
| `QUOTAHUB_ADMIN_PASSWORD` | 空 | 该管理员口令；留空则首启随机生成并只在启动日志打印一次 |
| `QUOTAHUB_SESSION_TTL_HOURS` | `12` | builtin 会话有效期（小时），上限 720 |

仓库根与 `server/` 下有 `.env.example`，可复制为 `.env` 使用。

## 部署

```bash
npm run build          # server tsc + frontend vite build，前端产物写入仓库根 public/
systemctl restart quotahub
systemctl status quotahub
```

- systemd 单元 `quotahub.service` 运行 `server/dist/index.js`，监听地址与端口由 `PORT` / `HOST` 等环境变量控制。
- nginx 负责域名与 TLS，把页面和 `/api/*` 反代到本服务；域名由部署方自行配置。

## 认证与安全

- `builtin`（默认）：自带账号密码，首次启动创建管理员，口令以 `node:crypto` 的 scrypt 加盐哈希存入 SQLite。会话 cookie 名 `quotahub_session`（HttpOnly、SameSite=Lax，HTTPS 下加 Secure），也接受 `Authorization: Bearer <token>`。登录失败按来源 IP 限速。
- `sso`：不带账号口令，`/api/auth/*` 一律返回 404；`/api/*` 的身份取自前置认证网关注入的 `X-Auth-User` 头，缺失即 401。本仓库不含 OAuth / token 代码。
- `GET /api/auth-mode` 免鉴权，供前端探测当前模式。
- 处理函数在 Node `vm` 隔离上下文中执行，不注入宿主对象；响应体上限 1MB，执行时长受 `QUOTAHUB_SCRIPT_TIMEOUT_MS` 约束。
- 默认拒绝环回 / 内网 / 云元数据地址，仅允许 http 与 https；确需监控内网平台时设 `QUOTAHUB_ALLOW_PRIVATE=1`。
- 默认只监听 `127.0.0.1`；数据目录 `data/` 已被 `.gitignore` 忽略，凭据只随配置导出。

## 常用接口

| 接口 | 说明 |
|---|---|
| `GET /api/platforms/balances` | 面板数据（不含凭据） |
| `POST /api/platforms/refresh` | 刷新全部平台 |
| `GET /api/platforms/:id/history` | 单平台历史采样点 |
| `POST /api/platforms/validate` | 校验抓取配置（不保存） |
| `PUT /api/platforms/reorder` | 调整平台顺序 |
| `GET/PUT /api/settings` | 读取 / 更新设置，含 `collectIntervalSeconds` |
| `GET/DELETE /api/logs` | 查看 / 清空操作日志 |
| `GET /api/export`、`POST /api/import` | 配置导出与导入 |

## 开发

```bash
npm test    # server + frontend vitest
npm run lint
```

## 许可

MIT License，见 `LICENSE`。
