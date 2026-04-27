# Deployment runbook

Canonical order of operations for deploying a QTIP release. This complements
[`PRODUCTION_GUIDE.md`](./PRODUCTION_GUIDE.md) (feature-level overview) by
turning the steps into a checklist an operator can follow top-to-bottom.

---

## 1. Platform choice — PM2 vs IIS

QTIP ships with configuration for two host patterns. Pick **one** per
environment.

### PM2 (recommended for Linux hosts, Windows VMs on-site)

- `ecosystem.config.cjs` at the repo root defines the API process
  (`qtip-backend`) and the five nightly workers.
- Workers run as cron one-shots inside the 01:00–02:00 UTC window; see the
  file-header comment for the timing rationale.
- Process log rotation is handled by `pm2-logrotate`, file rotation by
  Winston's DailyRotateFile transport (see
  [`LOGGING_CONFIGURATION.md`](./LOGGING_CONFIGURATION.md)).

### IIS (legacy Windows hosts)

- `deploy/web.config.example` drives iisnode.
- Workers must still run via PM2 or Windows Scheduled Tasks — IIS does not
  schedule the nightly jobs. Document which mechanism the host uses in the
  ops runbook for that environment.
- Do not mix PM2 and IIS on the same host — they will fight for the port.

---

## 2. Pre-deploy checks (5 min)

| #   | Step                                                    | Command / Location                            |
| --- | ------------------------------------------------------- | --------------------------------------------- |
| 1   | Confirm target env in the correct git state             | `git status`, `git log -1`                    |
| 2   | Confirm `.env` on target host matches current template  | diff against `deploy/production_environment_template.env` |
| 3   | Confirm free disk for DB backup                         | ≥ 2× current `qtip_production` size           |
| 4   | Confirm maintenance window is posted (if prod)          | ops channel                                   |
| 5   | `npm run typecheck` and `npm test` green on the commit  | CI build for the commit                       |

---

## 3. Deploy order — step by step

> Run every command from the repo root on the deploy host unless noted.

### 3.1 Database backup (always)

```powershell
.\scripts\backup-before-migration.ps1
```

Writes `scripts\backups\pre-migration-YYYYMMDD_HHmmss.sql` and prints the
path. Keep the path handy — it's the rollback target.

### 3.2 Pull code + install

```powershell
git fetch --all
git checkout <release-tag-or-commit>
npm ci --prefix .
npm run build --prefix backend
npm run build --prefix frontend
```

### 3.3 Apply Prisma migrations

```powershell
.\scripts\deploy_database.ps1 -Environment production
# Equivalent to: prisma migrate deploy --schema backend/prisma/schema.prisma
```

Prisma applies migrations in lexicographic order of the folder name. See
[`backend/prisma/migrations/README.md`](../backend/prisma/migrations/README.md)
for the duplicate-timestamp tolerance rule.

### 3.4 Stop workers (so they don't race the new schema)

```powershell
pm2 stop ie-dept-sync ie-emp-sync ie-calendar-sync ie-partition-manager ie-rollup
```

### 3.5 Restart the API

```powershell
pm2 reload qtip-backend
```

`reload` does zero-downtime rolling restart across cluster workers. Use
`pm2 restart qtip-backend` only when the zero-downtime semantics don't
apply (first boot, ecosystem.config.cjs changed).

### 3.6 Smoke test (see §5 below)

Only after §5 passes, resume workers:

### 3.7 Resume workers

```powershell
pm2 start ie-dept-sync ie-emp-sync ie-calendar-sync ie-partition-manager ie-rollup
pm2 save
```

### 3.8 Swap the frontend bundle

The bundle lives in `frontend/dist`. The exact copy mechanism depends on
the host (nginx served directly, rsync to IIS root, blob-storage push).
Swap the bundle **last** so users never see a new UI calling a stale API.

---

## 4. Rollback procedure

Trigger conditions: §3.5 or §5 fails, or observability (§
[`observability.md`](./observability.md)) fires an alert within 15 min
of deploy.

1. `pm2 stop qtip-backend` (and workers from §3.4).
2. `git checkout <previous-release-tag>`; rebuild backend per §3.2.
3. `.\scripts\restore-backup.ps1 -BackupFile <path-from-§3.1>`
   - If the migration in §3.3 was schema-only and safe to skip, you can
     instead run `prisma migrate resolve --rolled-back <migration_name>`
     and re-apply an older migration. The full restore is always safe.
4. `pm2 reload qtip-backend`; resume workers from §3.7.
5. Swap the frontend bundle back to the prior release.
6. Post an incident note referencing the backup file, the commit deployed,
   and the failing signal.

A partial restore — only the insights / KPI tables — is available via
`scripts\restore-insights-from-backup.ps1` for the case where the data
drift is limited to insights rollups.

---

## 5. Post-deploy smoke test

Run after every deploy, **before** declaring the release live.

```powershell
.\scripts\run_verification.ps1 -Environment production
```

What the script exercises:

- `/health`, `/ready`, `/live` monitoring endpoints
- `/api/auth/login` with a canary account (expects 200 + CSRF cookie)
- `/api/qa/health` (database + cache booleans)
- `/api/csrf-token` (CSRF token mint)
- Smoke GET against `/api/insights/qc-quality?limit=1`

If any step returns non-2xx, treat it as a rollback trigger.

### Manual UI smoke (≤ 2 min)

| Surface              | What to verify                                                               |
| -------------------- | ---------------------------------------------------------------------------- |
| `/login`             | Page renders; login with a known admin completes; CSRF token cookie present. |
| `/app/insights/qc-quality` | Page loads, KPI tiles render, no 5xx in the network tab.               |
| `/app/insights/on-demand-reports` | List renders, one report opens without error.                   |
| `/api-docs`          | Swagger UI loads; spec loads without 500s (content coverage is a separate audit — see [`openapi_coverage.md`](./openapi_coverage.md)). |

---

## 6. Staggered migration caveat

For migrations that add **not-null columns** or drop columns still in use:

1. Deploy a code release that handles **both** old and new shapes (write +
   read tolerant of either).
2. Run the migration during the next window.
3. Deploy a follow-up release that assumes the new shape.

Prisma cannot do this automatically. Plan it into the migration PR.

---

## Related documents

- [`environment_variables.md`](./environment_variables.md) — env-var contract
- [`observability.md`](./observability.md) — metrics, alerts, SLOs
- [`backup_restore_runbook.md`](./backup_restore_runbook.md) — detailed DB recovery
- [`role_permission_matrix.md`](./role_permission_matrix.md) — which roles hit which surfaces
- [`LOGGING_CONFIGURATION.md`](./LOGGING_CONFIGURATION.md) — log targets
- [`scripts/README.md`](../scripts/README.md) — script inventory
