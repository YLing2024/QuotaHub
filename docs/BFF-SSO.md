# QuotaHub · BFF 模式 SSO（标准 OAuth2）

把原先「前端 localStorage 存 token + nginx 探针」的接入方式，改为标准 OAuth2 的 **BFF（Backend For Frontend）**：

> **前端不碰 token、不碰 code；换 token 全在服务端；每站只认自己的 `__Host-quotahub_session` cookie。**

## 端点

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/sso/login` | 生成 `state` + PKCE（S256），302 到认证中心 `/authorize` |
| GET | `/sso/callback` | 校验并一次性消费 `state` → 服务端换 token → 建站内会话 → 种 cookie → 302 回 `/` |
| GET | `/api/me` | 读会话 cookie，返回 `{ name, role }`；未登录 `401` |
| POST | `/sso/logout` | 删站内会话 + 调 `/revoke` 撤 token + 清 cookie，返回 `204` |
| 中间件 | 其余 `/api/*` | 有有效会话则放行并注入 `req.user`；无会话退回原 `requireToken`（见下「兼容」） |

## Cookie

```
__Host-quotahub_session=<sid>; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax
```

- `sid` = 32 字节随机 hex；服务端只存 `sha256(sid)`（进程内 Map，TTL 7 天滑动）。
- `__Host-` 前缀要求 `Secure` + `Path=/` + 不带 `Domain`，因此**只能在 HTTPS 下生效**（生产经 nginx TLS）。
- 登出时下发同名 `Max-Age=0` 清除。

## 流程

```
浏览器 ── GET / api/me ──▶ 401
   └─ location.href = /sso/login
        └─ 302 ▶ 认证中心 /authorize?...&state=..&code_challenge=..&code_challenge_method=S256
             └─ 用户登录 ▶ 302 /sso/callback?code=..&state=..
                  └─ 服务端 POST /token 换 access/id/refresh_token（只留服务端）
                       └─ 302 / + Set-Cookie __Host-quotahub_session=…
```

- `state → verifier` 与 `sha256(sid) → 会话` 都存**进程内 Map**（不引 Redis、不新增依赖）；重启后会话失效（预期）。
- `state` 一次性：回调时查不到或不一致 → `400`，不入会话（防会话固定）。
- token 换票失败（认证中心拒绝 / 网络异常）→ `502`，不泄漏内部细节。

## 配置（全部走环境变量，源码不硬编码私有地址）

| 变量 | 默认 | 说明 |
|---|---|---|
| `QUOTAHUB_SSO_ISSUER` | `https://auth.example.com` | 认证中心 issuer；**生产必须覆盖** |
| `QUOTAHUB_SSO_CLIENT_ID` | `quotahub` | 注册的 client_id |
| `QUOTAHUB_SSO_REDIRECT_URI` | 空（按请求推导） | 生产建议显式固定，与认证中心注册值**逐字符一致** |
| `QUOTAHUB_SSO_CLIENT_SECRET_FILE` | `/root/.sso_clients.env` | 0600 密钥文件；只读、不打印、不提交 |
| `QUOTAHUB_SSO_CLIENT_SECRET_KEY` | `QUOTAHUB_CLIENT_SECRET` | 密钥文件里的键名 |
| `QUOTAHUB_SSO_COOKIE_NAME` | `__Host-quotahub_session` | 会话 cookie 名，勿改 |

`redirect_uri` 推导规则：读 `X-Forwarded-Proto`（取第一段）与请求 `Host`，拼 `<proto>://<host>/sso/callback`；反代需正确传这两个头。

## 兼容（切换由 Hermes 做）

- 旧的应用层令牌鉴权 `QUOTAHUB_TOKEN`（`Authorization: Bearer` / `X-Quotahub-Token` / `X-Auth-Token`）**代码保留未改**。
- `/api/*` 中间件**会话优先**：有有效会话直接放行；无会话才退回旧 `requireToken`，所以**不带 cookie 时行为与改造前完全一致**（未设 token 时放行、设了 token 时 401）。
- nginx 撤探针、改反代由 Hermes 在验收后执行，本仓库不动 nginx。

## 本地测试

```bash
# 后端（独立端口 15300 + 独立数据目录，绝不用 5300）
cd server
PORT=15300 HOST=127.0.0.1 \
  QUOTAHUB_DATA_DIR=/tmp/qh-sso-test \
  QUOTAHUB_SSO_ISSUER=http://127.0.0.1:15999 \
  npx tsx src/index.ts

# 逐项自测见 docs/BFF-SSO-SELFTEST.md（含原始输出）
```
