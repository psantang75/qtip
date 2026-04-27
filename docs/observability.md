# Observability spec

What QTIP exposes for monitoring, what alerts fire against it, and the
SLOs the application commits to. Source file:
[`backend/src/routes/monitoring.routes.ts`](../backend/src/routes/monitoring.routes.ts).

---

## 1. Endpoints

All monitoring endpoints are unauthenticated and mounted at the root
(not under `/api`) so infra-level probes can hit them without JWTs.

| Endpoint                      | Purpose                                               | Expected status |
| ----------------------------- | ----------------------------------------------------- | --------------- |
| `GET /health`                 | Shallow check — DB + cache health                     | 200 healthy / 503 unhealthy |
| `GET /health/database`        | DB-only probe (round-trips `SELECT 1`)                | 200 / 500       |
| `GET /ready`                  | Readiness — DB + required env vars set                | 200 / 503       |
| `GET /live`                   | Liveness — always 200 when the process is up          | 200             |
| `GET /metrics`                | Prometheus scrape — `prom-client` output              | 200 text/plain  |
| `GET /info`                   | App version / environment                             | 200             |
| `GET /api/qa/health`          | QA subsystem health (trimmed — see item #98)          | 200 / 503       |
| `GET /api/monitoring/database-metrics` | DB-pool + query-perf snapshot                 | 200             |
| `GET /api/monitoring/cache-metrics` | Cache hit/miss per layer                         | 200             |
| `GET /api/monitoring/system-metrics` | Combined DB + cache + memory snapshot           | 200             |

Uptime monitors should target `/live` (cheap) and `/health` (deeper).
Kubernetes readiness-probe analogue is `/ready`.

---

## 2. Metrics exposed at `/metrics`

Registered by `prom-client` via `collectDefaultMetrics()` plus the custom
counters / histograms / gauges in `monitoring.routes.ts`.

### Custom

| Metric                           | Type      | Labels                          | Emit site                                |
| -------------------------------- | --------- | ------------------------------- | ---------------------------------------- |
| `http_requests_total`            | Counter   | `method`, `route`, `status_code`| `metricsMiddleware` (every request)      |
| `http_request_duration_seconds`  | Histogram | `method`, `route`, `status_code`| `metricsMiddleware` (every request)      |
| `database_connections_active`    | Gauge     | —                               | reserved (not yet updated)                |
| `auth_attempts_total`            | Counter   | `status` (`success` / `failure`)| `trackAuthAttempt(...)` — call on every login outcome |
| `app_uptime_seconds`             | Gauge     | —                               | interval tick (30 s)                     |

Histogram buckets: `0.1, 0.5, 1, 2, 5` seconds.

### Default (from `collectDefaultMetrics`)

`process_cpu_seconds_total`, `process_resident_memory_bytes`,
`nodejs_eventloop_lag_seconds`, `nodejs_heap_size_total_bytes`,
`nodejs_active_handles`, `nodejs_active_requests`, etc. — standard
Node.js set.

---

## 3. Alerts

Define all alerts against the `/metrics` scrape. Alert spec lives in
Prometheus / Alertmanager config on the monitoring side, but these are
the **contractual alert names** QTIP's ops ladder expects to receive.

| Alert                             | Query sketch                                                                 | Severity | Notes |
| --------------------------------- | ---------------------------------------------------------------------------- | -------- | ----- |
| `QtipApiDown`                     | `up{job="qtip-backend"} == 0 for 2m`                                         | P1       | Pages on-call immediately. |
| `QtipHealthUnhealthy`             | `probe_http_status_code{target=~".*/health"} >= 500 for 5m`                  | P1       | Health probe flipped to 503. |
| `QtipHighErrorRate`               | `sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.01 for 5m` | P2 | 1 % error floor. |
| `QtipLatencyP95High`              | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2` for 10m | P2 | See SLO below. |
| `QtipAuthFailureSpike`            | `rate(auth_attempts_total{status="failure"}[5m]) > 5 * rate(auth_attempts_total{status="failure"}[1h]) for 5m` | P3 | Credential-stuffing signal. |
| `QtipEventLoopLagHigh`            | `nodejs_eventloop_lag_seconds > 0.5 for 5m`                                  | P3       | Sign of blocking work on the main thread. |
| `QtipMemoryHigh`                  | `process_resident_memory_bytes > 1.5e9 for 15m`                              | P3       | RSS > 1.5 GB. |
| `QtipDbPoolExhausted`             | `database_connections_active == DB_CONNECTION_LIMIT for 2m`                  | P2       | Requires the gauge to be wired (see §4). |
| `QtipWorkerDidNotRun`             | Absence of `IeIngestionLog` row for the scheduled window                     | P2       | Cron-schedule gap — check PM2 and insights ingestion log. |

Severity ladder: P1 pages on-call, P2 opens an incident in business
hours, P3 raises a warning for triage the next morning.

---

## 4. Known gaps

Track these as follow-ups; do not ship production without at least the
first two closed.

1. **`database_connections_active` gauge is declared but never updated.**
   Needs to be set from the Prisma pool on each query or at a 5 s tick.
   Without it, `QtipDbPoolExhausted` cannot fire.
2. **`trackAuthAttempt` is exported but not called from
   `AuthenticationService.login`.** Wire it into the success and failure
   paths so `QtipAuthFailureSpike` has a signal.
3. **No per-route p95 breakdown.** Histogram labels include `route`, but
   we don't have a recording rule precomputing p95 per route. Add one on
   the monitoring side when the API shape settles.
4. **Workers emit Winston logs but no Prometheus counters.** Consider
   adding `ie_worker_runs_total{worker, status}` if worker observability
   becomes a pain point.
5. **`/api-docs` and `/metrics` are publicly reachable.** Restrict at the
   reverse proxy (office subnet allow-list or basic auth) until a proper
   role guard is wired — see
   [`openapi_coverage.md`](./openapi_coverage.md#swagger-ui-exposure).

---

## 5. SLOs

These are the numbers the product commits to. They drive alert thresholds
above and inform capacity planning.

| SLO                         | Target                                      | Measured via                                       |
| --------------------------- | ------------------------------------------- | -------------------------------------------------- |
| API availability            | 99.5 % monthly (≈ 3.6 h/month downtime)     | `QtipApiDown` + `QtipHealthUnhealthy` minutes      |
| API latency p95             | ≤ 2 s for authenticated `/api/*` GETs       | `http_request_duration_seconds_bucket` histogram   |
| Login success latency p95   | ≤ 1 s                                       | Same histogram, filtered to `route="/api/auth/login"` |
| Insights dashboard render   | ≤ 3 s p95 end-to-end                        | Frontend-side RUM (not yet wired)                  |
| Nightly ingestion          | 100 % of scheduled runs land a row in `IeIngestionLog` within the window | Worker log + `QtipWorkerDidNotRun` alert |
| Backup freshness            | Pre-migration backup no older than the last deploy | Deploy runbook §3.1 enforcement                    |

Breach-handling policy:

- One-time breach → incident ticket, no SLO review.
- Two breaches of the same SLO in a rolling 30-day window → SLO review
  with product, alert thresholds rechecked.
- Sustained breach (> 3 days) → stop shipping non-critical changes until
  the burn-rate returns to budget.

---

## 6. Logs, not metrics

Metrics answer "is it broken?"; logs answer "why?". The log contract
lives in [`LOGGING_CONFIGURATION.md`](./LOGGING_CONFIGURATION.md) — every
error-level log MUST include a `correlationId` so alerts and logs can be
cross-referenced. The rich-envelope error shape (see
`utils/errorHandler.ts` header) echoes the same id in the response
`X-Correlation-ID` header for UI correlation.

---

## Related documents

- [`deployment_runbook.md`](./deployment_runbook.md) — smoke tests reference these endpoints
- [`backup_restore_runbook.md`](./backup_restore_runbook.md) — incident response
- [`LOGGING_CONFIGURATION.md`](./LOGGING_CONFIGURATION.md) — log targets
- [`environment_variables.md`](./environment_variables.md) — tunables that affect metrics (`LOG_LEVEL`, `DB_CONNECTION_LIMIT`, …)
