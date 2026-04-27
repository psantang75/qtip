# Environment variables

Single reference for every environment variable the QTIP backend, workers,
and frontend read. Source of truth for the **backend** is
[`backend/src/config/environment.ts`](../backend/src/config/environment.ts);
any new variable must be added there (typed in `EnvironmentConfig`, sourced
from `process.env`, with a default strategy for dev) and reflected in the
template at [`deploy/production_environment_template.env`](../deploy/production_environment_template.env).

> **PII / secrets:** never commit real values. `.env` is gitignored. Use the
> production template as the starting point for `.env` in dev, test, and prod.

---

## Backend — required in production

These fail-fast in `production` / `test` when missing or set to a known dev
default (see `getJwtSecret` / `getJwtRefreshSecret` and `validateEnvironment`).

| Variable                   | Type     | Dev default                                  | Prod example                          | Used by                                   |
| -------------------------- | -------- | -------------------------------------------- | ------------------------------------- | ----------------------------------------- |
| `NODE_ENV`                 | enum     | `development`                                | `production`                          | Everywhere — gates logging, cookies, CORS |
| `PORT`                     | number   | `3000`                                       | `3000` (behind nginx/IIS)             | `index.ts`                                |
| `DB_HOST`                  | string   | `localhost`                                  | internal DB host                      | `config/prisma.ts`, `environment.ts`      |
| `DB_PORT`                  | number   | `3306`                                       | `3306`                                | `config/prisma.ts`                        |
| `DB_USER`                  | string   | `root`                                       | dedicated app user                    | `config/prisma.ts`, `environment.ts`      |
| `DB_PASSWORD`              | string   | `development_password_change_for_production` | **required**                          | `config/prisma.ts`, `environment.ts`      |
| `DB_NAME`                  | string   | `qtip`                                       | `qtip_production`                     | `config/prisma.ts`, `environment.ts`      |
| `DB_CONNECTION_LIMIT`      | number   | `25`                                         | `20`                                  | `environment.ts`                          |
| `JWT_SECRET`               | string   | dev placeholder (warned)                     | **≥ 32 random chars, unique**         | `middleware/auth.ts`                      |
| `REFRESH_TOKEN_SECRET`     | string   | dev placeholder (warned)                     | **≥ 32 random chars, unique**         | `services/AuthenticationService.ts`       |
| `JWT_EXPIRES_IN`           | duration | `24h`                                        | `8h`                                  | access-token TTL                          |
| `REFRESH_TOKEN_EXPIRES_IN` | duration | `7d`                                         | `7d`                                  | refresh-token TTL                         |
| `BCRYPT_ROUNDS`            | number   | `12`                                         | `12`                                  | password hashing cost                     |
| `RATE_LIMIT_WINDOW_MS`     | number   | `900000` (15 min)                            | `900000`                              | `middleware/security.ts`                  |
| `RATE_LIMIT_MAX_REQUESTS`  | number   | `100`                                        | `100`                                 | api limiter                               |
| `AUTH_RATE_LIMIT_MAX`      | number   | `5`                                          | `5`                                   | `/api/auth` limiter                       |
| `ALLOWED_ORIGINS`          | csv      | `http://localhost:5173, :3000`               | comma-separated https origins         | CORS                                      |
| `MAX_FILE_SIZE`            | number   | `5242880` (5 MB)                             | `5242880`                             | upload middleware                         |
| `UPLOAD_DIR`               | path     | `./uploads`                                  | absolute path on mounted volume       | attachment storage                        |
| `LOG_LEVEL`                | enum     | `info`                                       | `info` or `warn`                      | `config/logger.ts`                        |
| `LOG_FILE`                 | path     | unset                                        | `./logs/application.log`              | winston daily-rotate                      |
| `APP_NAME`                 | string   | `QTIP`                                       | `QTIP`                                | monitoring + swagger                      |
| `APP_VERSION`              | string   | `1.0.0`                                      | from `package.json`                   | `/info`, swagger                          |

## Backend — optional

Left unset in dev; set only when the matching feature is turned on.

| Variable                          | Purpose                                                                    |
| --------------------------------- | -------------------------------------------------------------------------- |
| `DB2_HOST` `DB2_USER` `DB2_PASSWORD` `DB2_NAME` `DB2_CONNECTION_LIMIT` | Secondary (analytics) DB pool — all four must be set together. |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASSWORD` `SMTP_SECURE`     | Outbound email (reserved — not yet consumed).                  |
| `OFFICE_VIEWER_ALLOWED_ORIGINS`   | CSV of allowed origins for Office-viewer `resource.controller` URLs.       |
| `QC_CACHE_TTL_MS`                 | TTL for `middleware/qcCache.ts`. Default `60000`.                          |
| `QC_CACHE_MAX_ENTRIES`            | Cap for `middleware/qcCache.ts`. Default `1000`.                           |
| `TOKEN_BLACKLIST_PATH`            | On-disk path for persistent JWT blacklist; defaults inside `logs/`.        |
| `ENABLE_DB_TESTS`                 | Set to `1` in test envs that intentionally hit a live DB. Off by default.  |
| `HEALTH_CHECK_INTERVAL`           | Reserved; monitor-side tuning.                                             |
| `ENABLE_METRICS`                  | Reserved; `/metrics` is currently always on.                               |
| `SSL_KEY_PATH` `SSL_CERT_PATH` `SSL_CA_PATH` | If running without a reverse proxy. Normally nginx/IIS terminates TLS. |

---

## Frontend — `import.meta.env.*`

Vite injects `DEV` / `PROD` automatically. No custom `VITE_*` variables are
required today. If one is introduced, it **must** be added here and surfaced
via `import.meta.env.VITE_*` (Vite only exposes `VITE_`-prefixed vars to the
browser).

| Variable           | Source                | Used by                                                                                               |
| ------------------ | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `import.meta.env.DEV`  | Vite                  | `services/apiClient.ts`, `components/common/ErrorBoundary.tsx`, `utils/forms/formConditions.ts` |
| `import.meta.env.PROD` | Vite                  | `utils/errorHandling.ts` — silences debug logs in prod                                          |

---

## Per-environment example values

### Development (`.env` alongside `backend/`)

```
NODE_ENV=development
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=Thrills0011**
DB_NAME=qtip
# JWT_SECRET / REFRESH_TOKEN_SECRET unset → dev defaults with one-time warning
LOG_LEVEL=debug
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

### Test

```
NODE_ENV=test
DB_HOST=localhost
DB_NAME=qtip_test
JWT_SECRET=test_only_secret_at_least_32_characters_xx
REFRESH_TOKEN_SECRET=test_only_refresh_secret_at_least_32_chars_x
LOG_LEVEL=error
ENABLE_DB_TESTS=1
```

### Production

Start from [`deploy/production_environment_template.env`](../deploy/production_environment_template.env),
fill in every `YOUR_…_HERE` placeholder with real values, and store the
file outside source control (a secrets manager or the deploy host only).

---

## Adding a new variable — checklist

1. Declare it on `EnvironmentConfig` in `backend/src/config/environment.ts`
   and source it from `process.env` with a dev-appropriate default.
2. If it's security-sensitive, add a dev-default detection path (see the
   JWT secret helpers for the pattern) so prod fails fast on placeholders.
3. Add a row to the right table in this file.
4. Add a row to `deploy/production_environment_template.env` (commented out
   if optional; required values as `YOUR_…_HERE` placeholders).
5. If the frontend needs it, expose via a `VITE_`-prefixed variable — never
   leak backend secrets into the client bundle.
