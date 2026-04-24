# QTIP Scripts

Operational PowerShell + SQL scripts for QTIP. Everything in this folder is
intended to be run **manually** by an operator or invoked from
`package.json` (`npm run deploy:*`, `npm run db:deploy:*`, etc.) — there are
no auto-run hooks.

If a script in this folder no longer corresponds to a current workflow,
delete it. We removed a batch of one-offs in the pre-production cleanup
(see review item #53); please don't reintroduce that pattern.

---

## Application deployment

| Script                          | Purpose                                                                  |
| ------------------------------- | ------------------------------------------------------------------------ |
| `deploy_application.ps1`        | Deploy frontend + backend to a target env. Wired to `npm run deploy:*`.  |
| `prepare_production.ps1`        | Pre-flight environment checks before a prod deploy.                      |
| `start_app.ps1`                 | Bring up the local dev stack (backend + frontend).                       |
| `kill-dev-servers.ps1`          | Kill processes holding port 3000 (backend) / 5173 (frontend) / 4173.     |

## Database lifecycle

Prisma owns the migration source-of-truth (`backend/prisma/migrations/`).
The scripts below are operator-facing wrappers around `prisma migrate` /
`mysql` for production-style workflows.

| Script                              | Purpose                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| `deploy_database.ps1`               | Apply Prisma migrations to a target env. Wired to `npm run db:deploy:*`. |
| `setup_production_database.ps1`     | First-time production DB bring-up.                                   |
| `setup_users.ps1`                   | Seed local-dev admin + reset all passwords to `pass1234`.            |
| `seed_performance_goals.ps1`        | Seed performance-goal reference data.                                |
| `update_scoring_schema.ps1`         | Apply scoring-engine schema deltas.                                  |
| `export_production_schema.ps1`      | Dump the live prod schema for diffing / forensics.                   |
| `build_production_database.sql`     | Bare-metal SQL to rebuild prod (used by `setup_production_database`). |

## Backup / restore

Database snapshots are **never** committed (see `.gitignore` — `scripts/backups/`
is ignored, and `truncate-all-data.sql` was removed entirely in the
pre-production cleanup).

| Script                              | Purpose                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| `backup-before-migration.ps1`       | Take a snapshot before running a destructive migration.              |
| `restore-backup.ps1`                | Restore from a snapshot taken by the script above.                   |
| `restore-insights-from-backup.ps1`  | Insights-only restore (faster than full DB restore).                 |

## Verification

| Script                              | Purpose                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| `run_verification.ps1`              | Smoke-test a deployed env (auth, key endpoints).                     |
| `verify-migration.ps1`              | Sanity-check a freshly applied migration.                            |

---

## PowerShell quoting reminders

This is a Windows / PowerShell repo. Two recurring footguns:

1. **No `&&` chaining** — use `;` between commands, or check `$LASTEXITCODE`
   between calls when sequencing matters.
2. **MySQL via `-e`, not redirection** — `mysql -u root -p"…" -e "source x.sql"`,
   never `mysql … < x.sql` (redirection breaks in PowerShell). See the
   workspace MySQL/PowerShell rules.
