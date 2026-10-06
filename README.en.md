[English](README.en.md) | [简体中文](README.md)

# QuotaHub

A self-hosted multi-platform LLM balance monitoring panel for viewing quotas and balances across platforms in one place.

## What it does

- **Dashboard**: platform cards showing the latest balance and last update time, with per-card refresh or a global "refresh now".
- **Balance trend chart**: each card can open a line chart of balance over time, with a draggable time window and hover readout; mouse and touch share one pointer interaction.
- **Automatic collection**: configure the collection interval (seconds) in Settings to fetch all platforms on schedule and record sample points; set it to 0 to disable.
- **Arbitrary HTTP endpoint adaptation**: one handler function `function (raw) { ... }` does both parsing and extraction. JSON endpoints can call `JSON.parse` directly; endpoints returning a JS expression can `eval` inside the function.
- **Presets**: a built-in NEWAPI template; create / edit / reset / export presets and apply them to a platform configuration interactively.
- **Platform configuration**: request method, URL, request headers and handler function, with validate-before-save and adjustable platform order.
- **Import and export**: the full configuration, a single platform or a single preset can all be exported as JSON and imported again.
- **Display format**: an independent prefix / suffix per platform, for example `$8.51` or `41 %`.
- **Operation log**: records create/update/delete, fetch, import/export and settings changes, kept up to 2000 entries, viewable and clearable.

## Quick start

```bash
npm install
npm run build
npm start
# open http://127.0.0.1:3000 in a browser
```

During development, start the frontend and backend separately:

```bash
npm run dev              # backend tsx watch (default 127.0.0.1:3000)
npm run dev -w frontend  # frontend Vite dev server, /api proxied to 127.0.0.1:3000
```

## Data storage

- `data/platforms.json`, `data/presets.json`, `data/settings.json`: platforms, presets and settings.
- `data/logs.json`: operation log, up to 2000 entries.
- `data/monitor.db`: SQLite, holding history sample points and, in builtin mode, accounts and sessions.

Migrating from the old JSON history to SQLite:

```bash
npm run migrate
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Service port |
| `HOST` | `127.0.0.1` | Bind address |
| `QUOTAHUB_DATA_DIR` | `<repo root>/data` | Data directory; relative paths resolve against the current working directory |
| `QUOTAHUB_STATIC_DIR` | `<repo root>/public` (enabled when present) | Frontend static directory override |
| `QUOTAHUB_SCRIPT_TIMEOUT_MS` | `2000` | Handler execution timeout, clamped to 100~30000 |
| `QUOTAHUB_ALLOW_PRIVATE` | empty | `=1` allows fetching private-network / loopback addresses |
| `AUTH_MODE` | `builtin` | Auth mode: `builtin` / `sso`; invalid values fall back to `builtin` |
| `QUOTAHUB_ADMIN_USER` | `admin` | Admin username created on first start in builtin mode |
| `QUOTAHUB_ADMIN_PASSWORD` | empty | Password for that admin; if empty, a random one is generated on first start and printed once in the startup log |
| `QUOTAHUB_SESSION_TTL_HOURS` | `12` | builtin session lifetime (hours), upper bound 720 |

There are `.env.example` files at the repo root and under `server/`; copy one to `.env` to use it.

## Deployment

```bash
npm run build          # server tsc + frontend vite build; frontend output goes to the repo-root public/
systemctl restart quotahub
systemctl status quotahub
```

- The systemd unit `quotahub.service` runs `server/dist/index.js`, with the listen address and port controlled by `PORT` / `HOST` and other environment variables.
- nginx handles the domain and TLS and reverse-proxies pages and `/api/*` to this service; the domain is configured by the deployer.

## Authentication and security

- `builtin` (default): built-in account and password; the admin is created on first start, and the password is salted and hashed with `node:crypto` scrypt into SQLite. The session cookie is named `quotahub_session` (HttpOnly, SameSite=Lax, plus Secure under HTTPS), and `Authorization: Bearer <token>` is also accepted. Login failures are rate-limited by source IP.
- `sso`: no account password; `/api/auth/*` always returns 404; the identity for `/api/*` comes from the `X-Auth-User` header injected by the upstream auth gateway, and a missing header is a 401. This repo contains no OAuth / token code.
- `GET /api/auth-mode` requires no auth, for the frontend to probe the current mode.
- Handler functions run in an isolated Node `vm` context with no host objects injected; the response body is capped at 1MB and execution time is bounded by `QUOTAHUB_SCRIPT_TIMEOUT_MS`.
- Loopback / private-network / cloud metadata addresses are denied by default, and only http and https are allowed; set `QUOTAHUB_ALLOW_PRIVATE=1` if you really need to monitor a private-network platform.
- By default it listens only on `127.0.0.1`; the data directory `data/` is gitignored, and credentials are only exported along with the configuration.

## Common APIs

| Endpoint | Description |
|---|---|
| `GET /api/platforms/balances` | Dashboard data (without credentials) |
| `POST /api/platforms/refresh` | Refresh all platforms |
| `GET /api/platforms/:id/history` | History sample points for one platform |
| `POST /api/platforms/validate` | Validate a fetch configuration (without saving) |
| `PUT /api/platforms/reorder` | Reorder platforms |
| `GET/PUT /api/settings` | Read / update settings, including `collectIntervalSeconds` |
| `GET/DELETE /api/logs` | View / clear the operation log |
| `GET /api/export`, `POST /api/import` | Configuration export and import |

## Development

```bash
npm test    # server + frontend vitest
npm run lint
```

## License

MIT License, see `LICENSE`.
