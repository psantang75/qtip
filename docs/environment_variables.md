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
| `PHONE_DB_HOST` `PHONE_DB_USER` `PHONE_DB_PASSWORD` `PHONE_DB_NAME` `PHONE_DB_CONNECTION_LIMIT` | External Phone System DB (read-only consumer for transcripts / recordings). All four required values must be set together; otherwise the `'phone'` pool is not created and `PhoneSystemService` calls throw. |
| `PHONE_RECORDING_BASE_PATH` | Optional rewrite for `tblConversationRecording.RecordingPath` before the `/api/phone-system/audio/:recordingId` streaming endpoint opens the MP3. Leave blank on Windows (the stored UNC path `\\wagoneer\DMCMS\PhoneSystem Recording\<id>.mp3` is read directly). On Linux, mount the share and set this to the local mount root (e.g. `/mnt/phonesystem-recordings`); the leading UNC root is rewritten to this value with `/` separators so the filename suffix is preserved. |
| `CRM_DB_HOST` `CRM_DB_USER` `CRM_DB_PASSWORD` `CRM_DB_NAME` `CRM_DB_CONNECTION_LIMIT` | External CRM DB (Phase 2; read-only consumer for ticket data). Same all-or-nothing rule as the phone DB block. |
| `OPENAI_API_KEY` `OPENAI_DEFAULT_MODEL` `OPENAI_TIMEOUT_MS` `OPENAI_MAX_RETRIES` | Enables the OpenAI client in `services/ai/`. When `OPENAI_API_KEY` is unset, `pingOpenAI()` reports `not_configured` and `getOpenAIClient()` throws. |
| `ANTHROPIC_API_KEY` `ANTHROPIC_DEFAULT_MODEL` `ANTHROPIC_TIMEOUT_MS` `ANTHROPIC_MAX_RETRIES` | Same pattern for the Anthropic client. The default ping does a key-shape check only; pass `liveCheck: true` when you want to actually round-trip the API. |
| `AI_REVIEWER_USER_ID`             | Integer `users.id` of the synthetic "AI Reviewer" account that AI-driven submissions are attributed to. **Per-environment** — each env's `users` table seeds this row with its own id. Seed the row by running `npx ts-node backend/scripts/seed-ai-reviewer.ts` against the target DB; the script is idempotent and prints `AI_REVIEWER_USER_ID=<n>` for you to paste into `.env`. When unset, `aiReviewerConfig` is `null` and every `/api/ai-reviewer/*` endpoint answers `503 NOT_CONFIGURED`. See [`deployment_runbook.md` §3.4a](./deployment_runbook.md#34a-ai-reviewer-system-user-once-per-env). |
| `BOOKSTACK_BASE_URL` `BOOKSTACK_TOKEN_ID` `BOOKSTACK_TOKEN_SECRET` `BOOKSTACK_TIMEOUT_MS` `BOOKSTACK_MAX_RETRIES` | Read-only client for the internal BookStack KB. All three of base URL + token ID + token secret must be set for the integration to activate; otherwise `/api/kb/*` returns `503 not_configured`. See [`bookstack_kb_integration.md`](./bookstack_kb_integration.md). |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASSWORD`                  | Outbound SMTP relay used by the email/notification system. Internal relay (`yukon.dm.local:25`) needs no auth; leave `SMTP_USER`/`SMTP_PASSWORD` blank. **Leave `SMTP_HOST` blank to disable mail entirely** — `EmailService.isConfigured()` returns `false` and every `notify()` becomes a logged no-op. |
| `MAIL_FROM_ADDRESS` `MAIL_FROM_NAME`                                  | From identity. Defaults to `noreply.qtip@dm-us.com` / `QTIP Notifications`. |
| `MAIL_DEV_DRY_RUN`                                                    | When `true`, every send is logged but never reaches the relay. Defaults to `true` in non-production, `false` in production. Set explicitly in stage when you want to exercise the real relay. |
| `MAIL_OVERRIDE_RECIPIENT`                                             | Staging guardrail: when set, every outbound `To/Cc` is rewritten to this address and the original recipient is prepended to the subject. Leave blank in production. |
| `MAIL_QUIET_HOURS`                                                    | Local quiet window in `HH-HH` form (wraps midnight). Critical / locked templates ignore this; routine notifications are skipped. Default `23-06`. |
| `MAIL_GLOBAL_RATE_LIMIT`                                              | Sends per 5-minute window above which the global circuit breaker opens and pauses non-locked templates. Default `1000`. Admins receive a one-shot `system.circuit_tripped` alert when this fires. |
| `MAIL_TIMEZONE`                                                       | IANA timezone used for date formatting and digest scheduling. Default `America/New_York`. |
| `APP_BASE_URL`                                                        | Used to build deep-link URLs inside emails (CTA buttons, password-reset links). Production must point at the real public host. |
| `EXCHANGE_EWS_URL` `EXCHANGE_USER` `EXCHANGE_PASSWORD` `EXCHANGE_MAILBOX` | Inbound mailbox import: the Exchange Web Services endpoint QTIP polls for emailed Excel reports, plus the account that owns the mailbox. `EXCHANGE_USER` is NTLM, so `DOMAIN\user` — not an SMTP address. **Leave `EXCHANGE_EWS_URL` blank to disable the poller entirely.** EWS rather than IMAP because IMAP/POP3 are closed on the mail server. See [`mailbox_import.md`](./mailbox_import.md). |
| `MAILBOX_IMPORT_POLL_MINUTES`                                         | How often to check the mailbox. Default `10`. A fixed interval rather than a 6am cron, so hand-run reports arriving mid-day are picked up too. |
| `MAILBOX_IMPORT_DRY_RUN`                                              | When `true`, the poller reads mail and logs what it *would* import without importing or moving anything. **Defaults to `true` in every environment including production** — unlike `MAIL_DEV_DRY_RUN`, because this writes to warehouse tables and must be switched on deliberately. |
| `MAILBOX_IMPORT_USER_ID`                                              | Integer `users.id` credited on `import_logs` rows the poller creates. Normally the only attribution available: the Paychex punch report arrives from an automated no-reply address that is nobody's QTIP account. A sender that *does* match an active user is credited to them instead. Without this, a non-matching sender is refused. |
| `MAILBOX_IMPORT_IGNORE_BEFORE`                                        | Optional `YYYY-MM-DD` floor. Mail received before it is left untouched, so enabling the poller cannot sweep up a backlog of stale reports. |
| `MAILBOX_IMPORT_ALLOWED_TYPES`                                       | Comma-separated allowlist of report types the mailbox may ingest. **Defaults to `punch_data` only** — in practice the Paychex punch feed is the sole report that arrives by email; every other `*_raw` dataset comes from the warehouse queries. Any recognised-but-not-allowed file emailed in is refused to `QTIP Failed` (with an ingestion alert). Unknown tokens are ignored, and if nothing valid remains it falls back to the default, so a typo can neither open the gate to every type nor strand the punch feed. Valid tokens: `call_activity`, `sales_margin`, `lead_sales_margin`, `lead_source`, `ticket_task`, `email_stats`, `punch_data`. |
| `IMPORT_ALLOWED_TYPES`                                               | Comma-separated allowlist of report types the **manual Import Center** (Admin > Manual Upload, and the `/api/imports/{upload,preview}` API) may ingest. **Defaults to `punch_data` only.** The six non-punch `*_raw` datasets have no unique grain and are fed automatically by the warehouse sync (→ idempotent `ie_fact_*`), so hand-uploading them would only inject duplicate rows into the Data Explorer's raw tables. This is the authoritative backend guard; the frontend `MANUAL_UPLOAD_TYPES` registry mirrors it for UX. Same parse/fallback semantics and valid tokens as `MAILBOX_IMPORT_ALLOWED_TYPES`. |
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
