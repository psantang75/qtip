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

## 6. Secret rotation (JWT_SECRET, REFRESH_TOKEN_SECRET)

Rotation is an **operational task on the production host**. It does **not**
require a code change, a new release, a `git push`, or an `npm install` — you
are only changing environment-variable values and restarting the API.

### 6.1 When to rotate

- Immediately if a signed JWT has leaked (e.g. a token committed to git
  history, pasted into a ticket, or posted to a log aggregator).
- On a regular cadence (recommended: every 90 days) as defence in depth.
- Whenever an employee with access to the production `.env` leaves the team.

### 6.2 Generate new values

Both secrets must be long (≥ 48 bytes) and random. Generate on any machine:

```powershell
# Windows / PowerShell
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

```bash
# Linux / macOS
openssl rand -base64 48
```

Run twice — one value per secret. Do not reuse `JWT_SECRET` as
`REFRESH_TOKEN_SECRET`.

### 6.3 Apply on the production host

1. Stage the new values in the deploy channel / password manager.
2. Edit the production `.env` (or PM2 `ecosystem.config.cjs` env block, or
   Windows service env — whichever the host uses) and replace:

   ```
   JWT_SECRET=<new value 1>
   REFRESH_TOKEN_SECRET=<new value 2>
   ```

3. Restart the API to pick up the new values:

   ```powershell
   pm2 restart qtip-backend
   ```

   Workers do not mint JWTs and do not need to restart.

### 6.4 Expected user impact

All currently logged-in users are bumped back to `/login` on their next
request, because their stored access and refresh tokens no longer verify
against the new secret. This is expected and harmless. Post a brief notice
in the ops channel if the maintenance window does not already cover it.

### 6.5 Verification

After restart:

- `pm2 logs qtip-backend --lines 50` should show no "invalid signature" loops
  other than the expected one-time re-auth of active sessions.
- `/api/auth/login` with a known-good canary must return 200 and set a
  new CSRF cookie (§5 smoke test covers this).
- The old token (the one that prompted the rotation, if any) must now return
  401 on any authenticated endpoint.

### 6.6 Rollback

If the new value was mistyped and no user can log in, restore the previous
`.env` value and `pm2 restart qtip-backend`. Nothing is persisted server-side
against the in-flight secret, so the rollback is instantaneous.

---

## 7. Staggered migration caveat

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
