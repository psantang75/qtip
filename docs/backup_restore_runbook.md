# Backup & restore runbook

Time-ordered procedure for taking a pre-migration backup, restoring it
during a rollback, and handling partial-restore cases. All scripts live in
[`scripts/`](../scripts/); this file is the "which script, in what order,
when something goes wrong" reference.

> **Never commit a dump.** `scripts/backups/` is gitignored (see review
> item #7 / #56). If a restore fails because the backup file is missing,
> that's the fire-drill — escalate immediately.

---

## 1. Roles & artefacts

| Artefact                                   | Purpose                                                  |
| ------------------------------------------ | -------------------------------------------------------- |
| `scripts\backup-before-migration.ps1`      | Take a full `mysqldump` into `scripts\backups\`.          |
| `scripts\backups\pre-migration-YYYYMMDD_HHmmss.sql` | Dump file emitted by the script above.          |
| `scripts\restore-backup.ps1`               | Full-database restore from a dump file.                  |
| `scripts\restore-insights-from-backup.ps1` | Partial restore — insights tables only.                  |
| `scripts\verify-migration.ps1`             | Post-migration sanity check (row counts, core tables).   |

Credentials are loaded from `backend\.env` (the `Load-Env` helper in each
script). Do **not** pass passwords on the command line — PowerShell history
preserves them.

---

## 2. Before every destructive migration

Run before `prisma migrate deploy` on any env where data loss would be
painful (test, staging, prod):

```powershell
.\scripts\backup-before-migration.ps1
```

Verify the tail of the output:

```
SUCCESS: Backup saved to scripts\backups\pre-migration-20260427_093015.sql
```

Record that path in the deploy ticket. It is the only rollback target for
the window.

### Integrity spot-check (30 seconds)

```powershell
# Count statements — a dump under 100 KB is almost certainly broken
(Get-Item "scripts\backups\pre-migration-20260427_093015.sql").Length

# Confirm it contains a CREATE TABLE for a critical table
Select-String -Path "scripts\backups\pre-migration-20260427_093015.sql" `
    -Pattern "CREATE TABLE \`users\`" -SimpleMatch | Select-Object -First 1
```

If either check fails, **stop the deploy** and investigate before running
the migration.

---

## 3. Restoring from a backup

Two failure modes. Pick the right one:

### 3a. Full rollback — migration broke something production uses

Trigger: smoke test fails, `/health` stays unhealthy, unexpected 5xx
spike within 15 min of deploy.

```powershell
# 1. Stop the API + workers so they don't write while we restore.
pm2 stop qtip-backend ie-dept-sync ie-emp-sync ie-calendar-sync `
        ie-partition-manager ie-rollup

# 2. Restore the snapshot.
.\scripts\restore-backup.ps1 `
    -BackupFile "scripts\backups\pre-migration-20260427_093015.sql"

# 3. Re-check Prisma migration history. The restore drops and recreates
#    _prisma_migrations, so the migration we were rolling back is gone —
#    good. If it's still showing as "applied", mark it rolled back:
npx prisma migrate resolve --rolled-back "<migration_folder_name>"

# 4. Re-deploy the previous code release (see deployment_runbook.md §4).

# 5. Restart processes.
pm2 start qtip-backend ie-dept-sync ie-emp-sync ie-calendar-sync `
         ie-partition-manager ie-rollup
pm2 save
```

### 3b. Partial rollback — only insights rollups are broken

Trigger: KPI tiles show wrong numbers after a rollup worker run, but
transactional tables (users, submissions, coaching) are intact.

```powershell
# 1. Stop only the insights workers.
pm2 stop ie-dept-sync ie-emp-sync ie-calendar-sync ie-rollup

# 2. Restore only the insights tables from the backup.
.\scripts\restore-insights-from-backup.ps1 `
    -BackupFile "scripts\backups\pre-migration-20260427_093015.sql"

# 3. Replay the affected ingestion window (manual via admin UI, or
#    trigger the workers for the specific date range).

# 4. Resume workers.
pm2 start ie-dept-sync ie-emp-sync ie-calendar-sync ie-rollup
```

The API stays up for this flow. Users may see stale KPIs until step 3
finishes — that's acceptable because we know the alternative is wrong
numbers.

---

## 4. Verification after restore

Always run, regardless of 3a or 3b:

```powershell
.\scripts\verify-migration.ps1 -Environment <env>
```

The script should print a table of per-critical-table row counts and
either a `PASS` or `FAIL` line. A `FAIL` means the restore succeeded but
the schema drifted — open an incident before traffic resumes.

Manual UI check — 60 seconds:

- `/login` completes as a known Admin.
- `/app/insights/qc-quality` loads without 5xx.
- `/app/quality/submissions` shows the last known submission count from
  before the deploy.

---

## 5. Scheduled backup policy

Pre-migration backups (§2) are the only backups this repo ships. Host-
level daily backups are the operator's responsibility and live outside
source control. Minimum expectations:

- Full nightly `mysqldump` retained 14 days on a different volume.
- Weekly offsite copy retained 90 days.
- Quarterly restore-to-scratch drill (restore the oldest backup in the
  offsite set into a disposable DB, run `verify-migration.ps1`, destroy
  the DB). Record the drill outcome in the ops log.

If one of those drills fails, treat it as a P1 incident — our rollback
plan assumes the nightly backup is valid.

---

## 6. Non-goals

- **Point-in-time recovery.** Not configured. If you need PITR, turn on
  MySQL binlog retention at the host level and document the recovery
  command here. Don't add it piecemeal to the scripts.
- **Schema-only backups.** `mysqldump` in this repo always dumps data
  too. For schema forensics use `scripts\export_production_schema.ps1`
  instead — it dumps `--no-data`.

---

## Related documents

- [`deployment_runbook.md`](./deployment_runbook.md) — where the backup step fits in a deploy
- [`database_schema.md`](./database_schema.md) — what tables you're protecting
- [`scripts/README.md`](../scripts/README.md) — script inventory
