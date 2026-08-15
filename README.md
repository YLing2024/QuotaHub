# QuotaHub

开源 LLM 平台余额监控工具 —— 统一查看各 LLM 平台的配额与余额。

![License](https://img.shields.io/badge/license-MIT-blue)

## 功能特性

- **多平台监控面板**：卡片式展示各平台余额/用量，支持手动刷新、平台排序
- **余额变化趋势图**：每个平台的「已获取」旁有仪表盘图标，点击弹出折线图，展示余额随时间变化，支持时间范围筛选（全部/24小时/7天/30天）、网格刻度、首末值标注与涨跌统计
- **自动采集（监控）**：可在「设置」中配置采集间隔（秒），每隔多久自动采集一次所有平台余额并写入历史；设为 0 秒关闭自动采集
- **操作日志**：记录平台增删改、余额获取、导入导出、设置变更等操作，持久化保存（最多最近 2000 条），支持查看与清空
- **任意 HTTP 接口适配**：一个「处理函数」搞定解析+提取（`function (raw) { ... }`），JSON 接口一行 `JSON.parse`，非 JSON 响应（如 opencode 的 JS 表达式协议）可在函数内用 `eval` 处理
- **预设系统**：快速配置模板（URL / 请求头 / 处理函数模板 + 字段交互式编辑），内置 NEWAPI 预设，支持编辑/重置/导出分享
- **导入 / 导出**：完整配置、单个平台、单个预设的 JSON 导入导出（弹窗复制粘贴，自动识别格式）
- **显示定制**：每平台独立的前缀/后缀（如 `$8.51 USD`、`41 %`），弱化显示不抢眼
- **本地优先**：数据存本地 JSON 文件，无数据库、无外部依赖服务

## 快速开始

```bash
npm install
npm start
# 打开 http://127.0.0.1:3000
```

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `PORT` | 服务端口 | `3000` |
| `HOST` | 绑定地址（默认仅本机；局域网访问设 `0.0.0.0` 并建议配令牌） | `127.0.0.1` |
| `QUOTAHUB_TOKEN` | 设置后 `/api/*` 需 `Authorization: Bearer <token>` | 空（不鉴权） |
| `QUOTAHUB_SCRIPT_TIMEOUT_MS` | 沙箱脚本执行时长上限 | `2000`（限 100~30000） |
| `QUOTAHUB_ALLOW_PRIVATE` | `=1` 时允许请求内网/环回地址（SSRF 防护例外，用于监控内网平台） | 空（拦截） |
| `QUOTAHUB_DATA_DIR` | 数据目录 | `./data` |

## 平台配置

在「平台配置」页添加平台，需要四个部分：

1. **请求方法 / URL / 请求头**：任意 HTTP(S) 接口，凭据放在请求头（如 `Authorization: Bearer sk-xxx`）
2. **处理函数**：`function (raw) { ... }`，`raw` 为原始响应文本，返回余额数值
   - JSON 接口：`function (raw) { return JSON.parse(raw).balance }`
   - 非 JSON 接口（返回 JS 表达式，如 opencode）：可在函数内用标准 `eval` 执行响应代码
3. **显示前缀 / 后缀**：面板卡片显示格式，仅影响展示
4. 保存后可在面板「获取余额」或「立即刷新」

> 懒得手动配置？把本仓库和调用方式丢给 AI，让它按上面的配置格式生成平台 JSON，再用「导入」功能导入即可。

## 安全设计

- **处理函数沙箱**：所有函数在 Node `vm` 隔离上下文中执行，不注入任何宿主对象——`process` / `require` / `fs` 不可达，逃逸链实测封死；脚本执行有超时上限（可配），响应体限制 1MB
- **凭据完全由用户掌控**：编辑与导出时可见完整凭据（Authorization / Cookie 等），自由修改、验证、迁移；本工具是本地单机工具，页面与接口的访问控制由本机绑定 + 可选令牌鉴权保证
- **SSRF 防护**：默认拒绝环回、内网、云元数据地址（`169.254.*` 等），仅允许 http/https
- **默认本机绑定**：只监听 `127.0.0.1`；对外开放需显式 `HOST=0.0.0.0`，并建议 `QUOTAHUB_TOKEN`
- **凭据不入库**：`data/` 目录已加入 `.gitignore`，密钥文件不会被 git 跟踪

## 常用 API

| 接口 | 说明 |
|---|---|
| `GET /api/platforms/balances` | 面板数据（无凭据字段） |
| `POST /api/platforms/refresh` | 刷新全部平台余额 |
| `GET /api/platforms/:id/history` | 某平台余额历史采样点（折线图数据） |
| `GET/PUT /api/settings` | 读取/更新设置（`collectIntervalSeconds` 自动采集间隔） |
| `GET /api/logs` · `DELETE /api/logs` | 查看 / 清空操作日志 |
| `GET /api/export` · `POST /api/import` | 配置导入导出（完整/单平台/单预设） |
| `PUT /api/platforms/reorder` | 平台排序 |

## 测试

```bash
node test-frontend.js   # 前端 jsdom 回归测试
```

## License

MIT
