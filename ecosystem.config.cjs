/**
 * PM2 configuration for the QTIP monorepo.
 *
 * ── Nightly worker schedule (runbook — pre-production review item #95) ────
 *
 * All insights workers run as one-shot cron jobs within the 01:00–02:00 UTC
 * window and `autorestart: false`, so their timing is fire-and-forget:
 *
 *     01:00 UTC   ie-dept-sync            ← department dimension sync
 *     01:10 UTC   ie-emp-sync             ← employee dimension sync
 *     01:20 UTC   ie-calendar-sync        ← calendar / schedule dimension
 *     02:00 UTC   ie-rollup               ← nightly KPI rollups
 *     00:00 UTC (monthly) ie-partition-manager ← partition housekeeping
 *
 * Ten-minute gaps between the three dimension syncs are intentional: they
 * all pound the same source MySQL instance, and dept must finish before
 * emp (dept ids feed employee rows). The rollup runs at 02:00 so it sees
 * the refreshed dimensions from the earlier jobs.
 *
 * If a worker routinely exceeds its next sibling's start time:
 *   1. Tail the worker log in `logs/` to confirm it's running, not stuck.
 *   2. Push its sibling out by ≥15 minutes here and redeploy.
 *   3. For persistent slowness, add a dedicated off-peak window rather
 *      than stacking more work into 01:00–02:00.
 *
 * All timestamps are server-local per PM2 convention; deploy the prod
 * host in UTC to keep this comment accurate.
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
      cron_restart: '0 1 * * *',
      watch: false,
      autorestart: false,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'ie-emp-sync',
      script: './backend/dist/workers/run-emp-sync.js',
      cron_restart: '10 1 * * *',
      watch: false,
      autorestart: false,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'ie-calendar-sync',
      script: './backend/dist/workers/run-calendar-sync.js',
      cron_restart: '20 1 * * *',
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
      cron_restart: '0 2 * * *',
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