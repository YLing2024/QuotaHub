# BFF SSO 自测实录（原始输出）

对应 `docs/BFF-SSO-MIGRATION.md` §4。全程只起临时实例 **PORT=15300 / 15302**（mock issuer 用 15301），未触碰 5300 及生产服务。
运行环境：`PATH=/root/.nvm/versions/node/v24.19.0/bin`（Node v24.19.0，与 systemd 一致）。

```bash
# 实例 1（§4 逐项）: issuer 指向未监听端口，验证 callback 失败处理
cd server
PORT=15300 HOST=127.0.0.1 \
  QUOTAHUB_DATA_DIR=/tmp/opencode/qh-sso-test \
  QUOTAHUB_SSO_ISSUER=http://127.0.0.1:15999 \
  npx tsx src/index.ts
```

## §4 逐项输出

```
### 1) GET /sso/login -> 302 + Location
HTTP/1.1 302 Found
Location: http://127.0.0.1:15999/authorize?client_id=quotahub&redirect_uri=http%3A%2F%2F127.0.0.1%3A15300%2Fsso%2Fcallback&response_type=code&scope=openid+profile&state=2c37ea0a487f9b8426e9a5a7e9c3bd76&code_challenge=uG8UXiF_xvuOm1gxtiVW1DfT2-izrwtrBIhic0656xo&code_challenge_method=S256
state=2c37ea0a487f9b8426e9a5a7e9c3bd76

### 2) GET /sso/callback (乱写 state) -> 400
{"error":"无效或已过期的 state"}
HTTP 400

### 3) GET /sso/callback (刚生成的 state + 假 code) -> 502, 之后 state 复用 -> 400
{"error":"登录换取令牌失败"}
HTTP 502
reuse same state -> HTTP 400

### 4) GET /api/me (无 cookie) -> 401
{"error":"未登录"}
HTTP 401

### 5) GET /api/me (伪造 cookie) -> 401
{"error":"未登录"}
HTTP 401
random 64hex cookie -> HTTP 401

### 6) POST /sso/logout (无 cookie) -> 204
HTTP/1.1 204 No Content
Set-Cookie: __Host-quotahub_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax

### 7) 业务接口回归 (无 cookie)
GET /api/settings  -> HTTP 200
GET /api/platforms -> HTTP 200
```

> 说明：实例 1 的 issuer 指向未监听端口，故回调换票统一走 `502`；这正是「返回认证中心报错或 502 处理得当」，
> 且**同一 state 再次使用返回 400**，证明 state 已被一次性消费。

## 附加：全链路成功路径（mock 认证中心）与旧令牌通道共存

```bash
# mock issuer: /token 返回 mock-at/mock-rt, /userinfo 返回 {sub:u-1,name:测试用户,role:admin}
# 实例 2: 同时设置 QUOTAHUB_TOKEN=legacy-token，验证「会话优先 + 旧令牌兜底」
PORT=15302 HOST=127.0.0.1 QUOTAHUB_DATA_DIR=.../qh-sso-test2 QUOTAHUB_TOKEN=legacy-token \
  QUOTAHUB_SSO_ISSUER=http://127.0.0.1:15301 \
  QUOTAHUB_SSO_CLIENT_SECRET_FILE=.../dummy-clients.env npx tsx src/index.ts
```

```
### A) 无 cookie 访问 /api/settings (旧令牌通道生效: QUOTAHUB_TOKEN 已设) -> 401
HTTP 401

### B) GET /sso/login 拿 state
state=a61af746b0fc620346c907aeac9d3a99

### C) GET /sso/callback (mock 换票成功) -> 302 + Set-Cookie __Host-quotahub_session
HTTP/1.1 302 Found
Set-Cookie: __Host-quotahub_session=f0109d13fdb949bf181a2f76a922719c517bf71dddbb3e11b96c55dee58cc239; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax
Location: /
sid_len=64

### D) 带会话 cookie GET /api/me -> 200 {name, role}
{"name":"测试用户","role":"admin"}
HTTP 200

### E) 带会话 cookie 且无 Authorization, 访问 /api/settings (会话优先放行) -> 200
HTTP 200

### F) 错误会话 cookie 访问 /api/settings (仍走旧令牌 -> 401)
HTTP 401

### G) POST /sso/logout 带 cookie -> 204, 之后同 cookie /api/me -> 401
HTTP/1.1 204 No Content
Set-Cookie: __Host-quotahub_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax
after logout /api/me -> HTTP 401
```

## 测试 / 构建

```
$ npm test -w server        # 13 files, 158 passed
$ npm test -w frontend      # 4 files, 85 passed（删掉 sso.test.ts 的 14 项）
$ npm run build -w frontend # tsc -b && vite build ✓ built in 3.96s
$ npm run lint -w server    # 0 error
```

> 注：`npm run lint -w frontend` 有 1 处 `react-hooks/purity` 报错，位于
> `frontend/src/components/TrendChart/index.tsx`，为本次改动之前既有问题，与本任务无关。
