/**
 * PM2 configuration for the QTIP monorepo.
 *
 * ── Insights worker schedule ─────────────────────────────────────────────
 *
 * All four data-refresh workers run every 30 minutes as one-shot cron jobs
 * (`autorestart: false`), staggered by 5-minute offsets within each
 * half-hour so the ordering dept → emp → calendar → rollup is preserved:
 *
 *     :00 / :30   ie-dept-sync            ← department dimension sync
 *     :05 / :35   ie-emp-sync             ← employee dimension sync
 *     :10 / :40   ie-calendar-sync        ← calendar / schedule dimension
 *     :15 / :45   ie-rollup               ← KPI rollups (drives dashboards)
 *     :20 / :50   ie-source-dispatch      ← DB-driven source-report ingestion
 *     :25 / :55   ie-monitor              ← dataset health eval + alerts
 *     05:20 daily ie-missed-opportunities ← LLM review of yesterday's sales calls
 *     06:00 1st (monthly) ie-sales-plays-miner ← mine WON/LOST calls into plays
 *     00:00 UTC (monthly) ie-partition-manager ← partition housekeeping
 *
 * ie-source-dispatch is a fixed 30-min floor only; which reports actually run
 * (and how often) is data in ie_source_report.frequency_minutes — not cron.
 *
 * 5-minute gaps between the three dimension syncs are intentional: dept
 * must finish before emp (dept ids feed employee rows), and the rollup
 * runs last so it sees the refreshed dimensions. At current row counts
 * each worker finishes in well under a minute; if a worker routinely
 * exceeds its next sibling's start time:
 *   1. Tail the worker log in `logs/` to confirm it's running, not stuck.
 *   2. Push its sibling out by ≥5 more minutes here and redeploy.
 *   3. For persistent slowness, drop to hourly (`0,30` -> `0`) rather
 *      than stacking more work into each half-hour window.
 *
 * Cron expressions are interpreted in the server's local timezone per PM2
 * convention; the prod and stage hosts run in UTC.
 */
module.exports = {
  apps: [
    {
      name: 'qtip-backend',
      script: './backend/dist/index.js',
      watch: false,
      env: {
        NODE_ENV: 'development',
        PORT: 5000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000
      },
      env_staging: {
        NODE_ENV: 'staging',
        PORT: 5000
      }
    },
    {
      name: 'ie-dept-sync',
      script: './backend/dist/workers/run-dept-sync.js',
      cron_restart: '0,30 * * * *',
      watch: false,
      autorestart: false,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'ie-emp-sync',
      script: './backend/dist/workers/run-emp-sync.js',
      cron_restart: '5,35 * * * *',
      watch: false,
      autorestart: false,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'ie-calendar-sync',
      script: './backend/dist/workers/run-calendar-sync.js',
      cron_restart: '10,40 * * * *',
      watch: false,
      autorestart: false,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'ie-partition-manager',
      script: './backend/dist/workers/run-partition-manager.js',
      cron_restart: '0 0 1 * *',
      watch: false,
      autorestart: false,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'ie-rollup',
      script: './backend/dist/workers/run-rollup.js',
      cron_restart: '15,45 * * * *',
      watch: false,
      autorestart: false,
      env: { NODE_ENV: 'production' }
    },
    {
      // DB-driven source-report ingestion dispatcher. Ticks every 30 minutes
      // and runs only the ie_source_report rows that are due. Per-report cadence
      // lives in the DB (frequency_minutes / run_only_hours) — retune a report
      // by editing its row, no redeploy. This is the single entrypoint for all
      // Agent Activity report ingestion (call/email/leads/margin/tickets).
      name: 'ie-source-dispatch',
      script: './backend/dist/workers/run-source-dispatch.js',
      cron_restart: '20,50 * * * *',
      watch: false,
      autorestart: false,
      env: { NODE_ENV: 'production' }
    },
    {
      // Active monitoring: evaluates every ie_dataset_monitor row for freshness
      // and volume anomalies, upserts ie_dataset_health, and emails on a status
      // transition to WARN/RED. Runs at :25/:55 — AFTER ie-rollup (:15/:45) and
      // ie-source-dispatch (:20/:50) so the cycle's loads have landed first.
      name: 'ie-monitor',
      script: './backend/dist/workers/run-monitor.js',
      cron_restart: '25,55 * * * *',
      watch: false,
      autorestart: false,
      env: { NODE_ENV: 'production' }
    },
    {
      // Missed Opportunities: one LLM pass per connected sales call for the
      // PRIOR business day, so the review is waiting when managers log in.
      // Unlike the half-hourly workers this is a daily job — each run costs
      // real money (capped by ie_config.missed_opps_daily_usd_cap), and the
      // material it reads (yesterday's transcripts + CRM notes) does not
      // change during the day. Runs at 05:20 so it lands after the overnight
      // dimension syncs but well before the workday.
      //
      // Idempotent by run_date, so a manual re-run after a rule-set change
      // replaces the day cleanly:
      //   node backend/dist/workers/run-missed-opportunities.js 2026-09-04
      name: 'ie-missed-opportunities',
      script: './backend/dist/workers/run-missed-opportunities.js',
      cron_restart: '20 5 * * *',
      watch: false,
      autorestart: false,
      env: { NODE_ENV: 'production' }
    },
    {
      // Sales Plays miner (Phase 2 learning loop): once a month, mine the active
      // sales team's WON/LOST calls since the last mined day into 'proposed'
      // plays for admin approval. Monthly (1st, 06:00) because it is incremental
      // and budget-capped (missed_opps_plays_monthly_usd_cap) — running it more
      // often just re-scans the same calls. The whole loop is also gated by
      // missed_opps_plays_enabled, so the worker exits immediately when off.
      name: 'ie-sales-plays-miner',
      script: './backend/dist/workers/run-sales-plays-miner.js',
      cron_restart: '0 6 1 * *',
      watch: false,
      autorestart: false,
      env: { NODE_ENV: 'production' }
    }
  ]

  // Note: the `deploy` block was intentionally removed during the
  // pre-production review (item #85). The previous contents were placeholder
  // values (SSH_USERNAME, SSH_HOSTMACHINE, GIT_REPOSITORY) that would have
  // errored out if anyone actually ran `pm2 deploy`. Deployment for this
  // project is driven by `scripts/deploy_application.ps1` instead — see
  // `docs/PRODUCTION_GUIDE.md`. If `pm2 deploy` is ever needed again, add a
  // real deploy block here with concrete values from the target environment.
}; 