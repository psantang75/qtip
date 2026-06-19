# Data migration runbook (legacy QTIP -> new QTIP)

Wipe-and-reload procedure for re-importing data from the **old** QTIP
installation into the **new** QTIP schema. Used for cutovers and for
periodic refreshes while the two systems run in parallel.

> Legacy DB is read-only-from-our-side. The exporter takes an explicit
> `SET SESSION TRANSACTION READ ONLY` before the first query.

## Source / target connection details

The legacy database lives on the corp network. The connection details are
**not** committed to the repo; they live in `backend/.env` on whichever box
runs the export. The environment templates in `deploy/*.env` carry the
variable names with blank values so the structure is discoverable.

| Variable | Value (as of 2026-06-15) |
| --- | --- |
| `LEGACY_DB_HOST` | `rubicon.dm.local` |
| `LEGACY_DB_PORT` | `3306` |
| `LEGACY_DB_USER` | `dmcms` (read-only) |
| `LEGACY_DB_PASSWORD` | (ask the QTIP DBA — historically also `dmcms`) |
| `LEGACY_DB_NAME` | `qtip` |

Targets:

| Env | DB host | DB name | App host (PM2) |
| --- | --- | --- | --- |
| Stage | `qtip-db-stage.dm.local` | `qtip_stage` | `qtip-admin@10.90.15.6` |
| Prod | `qtip-db-prod.dm.local` | `qtip_prod` | `qtip-admin@10.90.15.5` |

## When to run

- **Cutover** — final migration of legacy data when the old QTIP is shut
  down for good.
- **Periodic refresh while running in parallel** — pull anything that
  changed in the legacy system into stage/prod. *Wipe-and-reload, not
  incremental: rows in the new DB that don't exist in legacy are dropped.*
- **Never run while users are actively entering data into the new QTIP.**
  Anything they entered between the previous load and this run will be
  destroyed when Phase 3 truncates. Coordinate a maintenance window.

## Pipeline

```
[old QTIP DB]  --(1) export-legacy-qtip.ts-->  [CSV bundle]
                                                      |
                                                      | (2) scp
                                                      v
                              [stage box]  --(3) migrate-production-data.ts-->  [stage DB]
                              [prod box]   --(3) migrate-production-data.ts-->  [prod DB]
```

Two scripts do all the work:

- `backend/src/scripts/export-legacy-qtip.ts` — reads from `LEGACY_DB_*`,
  writes a CSV bundle to `<EXPORT_OUTPUT_ROOT>/QTIP_data_prod_<TIMESTAMP>/`.
- `backend/src/scripts/migrate-production-data.ts` — reads a CSV bundle and
  loads it into the local `DB_*`. Hardcoded source path:
  `<repo-root>/../QTIP_data_prod_3_23_2026/QTIP_data_prod_3_23_2026/`.
  On Linux hosts that means `/opt/QTIP_data_prod_3_23_2026/QTIP_data_prod_3_23_2026/`.
  Point a symlink at the day's fresh bundle (see Phase 1).

## Phases (per environment)

Run **stage end-to-end first**, spot-check the UI, then **repeat on prod**.

### Phase 0 — Pre-flight checklist

1. Confirm legacy is quiesced: `SELECT MAX(created_at) FROM submissions;`
   against `LEGACY_DB_HOST` should show a timestamp before your
   maintenance window started.
2. Confirm the new-side API is stoppable: nobody mid-flight on stage/prod.
3. `LEGACY_DB_*` is populated in `backend/.env` on the export box.

### Phase 1 — Export

Run on whichever box has `LEGACY_DB_*` set (developer workstation works;
the legacy DB is on the corp network):

```bash
cd backend
npx ts-node src/scripts/export-legacy-qtip.ts
```

Outputs `scripts/backups/QTIP_data_prod_<TIMESTAMP>/<table>_<TIMESTAMP>.csv`
(31 tables). Bundle is ~10–15 MB.

### Phase 2 — Ship the bundle

```bash
# Pick stage OR prod, run separately
HOST=qtip-admin@10.90.15.6              # stage; use 10.90.15.5 for prod
BUNDLE=QTIP_data_prod_<TIMESTAMP>        # from Phase 1 output

scp -r scripts/backups/$BUNDLE $HOST:/opt/qtip/data/
ssh $HOST "ln -sfn /opt/qtip/data/$BUNDLE /opt/QTIP_data_prod_3_23_2026/QTIP_data_prod_3_23_2026 && ls -la /opt/QTIP_data_prod_3_23_2026/QTIP_data_prod_3_23_2026 | head -3"
```

> The symlink target name `QTIP_data_prod_3_23_2026/...` is the hardcoded
> path baked into `migrate-production-data.ts`. The historical 3/23 bundle
> name is preserved so the loader keeps working without code changes.

### Phase 3 — Backup current DB (rollback target)

```bash
ssh $HOST "set -e; \
  pm2 stop qtip-backend; \
  cd /opt/qtip; \
  STAMP=\$(date +%Y%m%d_%H%M%S); \
  DB_HOST=\$(grep '^DB_HOST=' backend/.env | cut -d= -f2-); \
  DB_USER=\$(grep '^DB_USER=' backend/.env | cut -d= -f2-); \
  DB_PASS=\$(grep '^DB_PASSWORD=' backend/.env | cut -d= -f2-); \
  DB_NAME=\$(grep '^DB_NAME=' backend/.env | cut -d= -f2-); \
  mysqldump -h \$DB_HOST -u \$DB_USER -p\$DB_PASS \$DB_NAME \
    > backups/\${DB_NAME}_pre_reload_\${STAMP}.sql; \
  ls -lh backups/\${DB_NAME}_pre_reload_\${STAMP}.sql"
```

**Abort if the dump is smaller than what you expect** (~10–250 MB for
populated environments; <1 MB usually means the dump errored).

### Phase 4 — Truncate transactional tables

The truncate script lives at `scripts/backups/truncate_for_dryrun.sql` on
each host (already there from Friday). It clears submissions, calls,
coaching_sessions, write_ups, disputes, audit_logs, and friends, while
preserving non-transactional reference data.

```bash
ssh $HOST "cd /opt/qtip; \
  DB_HOST=\$(grep '^DB_HOST=' backend/.env | cut -d= -f2-); \
  DB_USER=\$(grep '^DB_USER=' backend/.env | cut -d= -f2-); \
  DB_PASS=\$(grep '^DB_PASSWORD=' backend/.env | cut -d= -f2-); \
  DB_NAME=\$(grep '^DB_NAME=' backend/.env | cut -d= -f2-); \
  mysql -h \$DB_HOST -u \$DB_USER -p\$DB_PASS \$DB_NAME \
    < scripts/backups/truncate_for_dryrun.sql"
```

### Phase 5 — Load

```bash
ssh $HOST "cd /opt/qtip/backend && npx ts-node src/scripts/migrate-production-data.ts"
```

Outputs `[OK] <table>: N rows` for each table. Row counts should match
the source legacy DB exactly (with the documented coaching-sessions split:
coaching_sessions + write_ups should sum to legacy's coaching_sessions).

### Phase 5b — Seed Insights dimensions (first-time on a host)

`migrate-production-data.ts` only handles the transactional/legacy
tables. The Insights warehouse has two reference tables the loader
does NOT populate, and the Insights rollup worker produces empty KPIs
(audits assigned, etc.) until both are present:

| Table | Source | One-time setup |
| --- | --- | --- |
| `business_calendar_days` | manual admin entry / copied from sibling env | `mysqldump --replace ... business_calendar_days` from stage, scp, `mysql < dump.sql` on target |
| `ie_dim_date`             | derived (`seed-date-dimension.ts`) | `npx ts-node src/scripts/seed-date-dimension.ts` |

```bash
# 1. business_calendar_days  (copy from a healthy sibling env if blank)
ssh $SRC_HOST "mysqldump -h \$(grep '^DB_HOST=' /opt/qtip/backend/.env | cut -d= -f2-) \
  -u \$(grep '^DB_USER=' /opt/qtip/backend/.env | cut -d= -f2-) \
  -p\$(grep '^DB_PASSWORD=' /opt/qtip/backend/.env | cut -d= -f2-) \
  --no-create-info --skip-triggers --no-tablespaces --replace --single-transaction \
  \$(grep '^DB_NAME=' /opt/qtip/backend/.env | cut -d= -f2-) business_calendar_days \
  2>/tmp/mysqldump.stderr" > business_calendar_days.sql
scp business_calendar_days.sql $HOST:/tmp/
ssh $HOST "mysql -h \$(grep '^DB_HOST=' /opt/qtip/backend/.env | cut -d= -f2-) \
  -u \$(grep '^DB_USER=' /opt/qtip/backend/.env | cut -d= -f2-) \
  -p\$(grep '^DB_PASSWORD=' /opt/qtip/backend/.env | cut -d= -f2-) \
  \$(grep '^DB_NAME=' /opt/qtip/backend/.env | cut -d= -f2-) \
  < /tmp/business_calendar_days.sql"

# 2. ie_dim_date  (idempotent — the script no-ops if already populated)
ssh $HOST "cd /opt/qtip/backend && npx ts-node src/scripts/seed-date-dimension.ts"

# 3. trigger Insights workers immediately (skip the wait for the next :15/:45 cron)
ssh $HOST "pm2 restart ie-calendar-sync --update-env --no-autorestart && \
           sleep 5 && \
           pm2 restart ie-rollup        --update-env --no-autorestart"
```

> NEVER `mysqldump` with `> file 2>&1` — the warning lines end up
> inside the SQL file and the next `mysql < file` parse-fails on them.
> Always send stderr to a separate file (or `/dev/null`).

> Truncation (Phase 4) leaves both of these tables alone, so on
> subsequent re-loads of the same host you can skip Phase 5b entirely.

### Phase 6 — Validate

1. **Row-count parity** vs the legacy DB you exported from.
2. **Insights dimensions populated** —
   `SELECT COUNT(*) FROM business_calendar_days; SELECT COUNT(*) FROM ie_dim_date;`
   should both be non-zero on first-time hosts; `ie_dim_date` is 1827 rows
   for the current 2024-2028 window.
3. **FK integrity** — run `scripts/backups/fk_integrity_checks.sql`; 16
   checks should each return 0 orphans.
4. **Coaching/write-up split** — `19 ONE_ON_ONE + 90 SIDE_BY_SIDE` coaching
   + `5 VERBAL_WARNING + 7 WRITTEN_WARNING` write-ups for the 3/23 dataset.
   These counts will differ on a fresher export; spot-check that legacy's
   `Verbal Warning` / `Written Warning` row count matches new
   `write_ups`, and that legacy's other coaching types match new
   `coaching_sessions`.
5. **AUTO_INCREMENT reset** — confirmed automatically by the loader's
   final "Resetting AUTO_INCREMENT values..." block.
6. **Live upload smoke** —
   `ssh $HOST "cd /opt/qtip && npx ts-node scripts/backups/smoke_uploads.ts"`.
   Should print matching SHAs for both write-up and coaching upload paths.
7. **Insights dashboards** — after the next `ie-rollup` tick (every
   `:15`/`:45`), at least one cell in the Audits-Assigned KPI must be
   non-zero for a date in the current window. Empty grids here usually
   trace back to a skipped Phase 5b on a first-time host.

### Phase 7 — Restart the API + UI spot-check

```bash
ssh $HOST "pm2 restart qtip-backend --update-env; \
  sleep 5; \
  curl -fsS http://localhost:5000/health"
```

Open the SPA, log in, walk through:
- A QA submission detail page that pre-existed in legacy
- A coaching session detail page that pre-existed in legacy
- A write-up detail page (one of the converted-from-warning rows)
- The Insights dashboards — these will refresh on the next worker tick
  (every 30 min, see `ecosystem.config.cjs`).

## Rollback

```bash
ssh $HOST "set -e; pm2 stop qtip-backend; \
  DB_HOST=\$(grep '^DB_HOST=' /opt/qtip/backend/.env | cut -d= -f2-); \
  DB_USER=\$(grep '^DB_USER=' /opt/qtip/backend/.env | cut -d= -f2-); \
  DB_PASS=\$(grep '^DB_PASSWORD=' /opt/qtip/backend/.env | cut -d= -f2-); \
  DB_NAME=\$(grep '^DB_NAME=' /opt/qtip/backend/.env | cut -d= -f2-); \
  mysql -h \$DB_HOST -u \$DB_USER -p\$DB_PASS \$DB_NAME \
    < /opt/qtip/backups/<the Phase 3 dump file>; \
  pm2 restart qtip-backend"
```

## Reference signoffs

Past runs are documented under `scripts/backups/`:

- `stage-run-20260612_100906/SIGNOFF.md` — 2026-06-12 stage dry-run.
- `prod-run-20260612_112535/SIGNOFF.md` — 2026-06-12 prod cutover (first
  stand-up; legacy was still live).

Both used the 3/23/2026 CSV bundle that shipped with the cutover plan
rather than re-exporting from the legacy DB. Today's procedure replaces
Phase 1 of that pattern with a live `export-legacy-qtip.ts` run against
`rubicon.dm.local`.

---

# Additive feature deploy: Agent Activity - Sales (Insights)

This is a **feature push**, not the wipe-and-reload above. It is **purely
additive**: ship code, apply additive Prisma migrations, idempotently add the
sales reference data, then regenerate the Insights facts by running the jobs.
It does **NOT** truncate, drop, or modify any existing user, department, QA
form, submission, or other data. Run **stage end-to-end first**, validate, then
repeat on prod.

> Do NOT use `prisma db push` (it diffs against `schema.prisma` and can drop
> columns) and do NOT use `scripts/deploy_database.ps1` here (it `source`s the
> full `database/qtip_database_schema_*.sql`, which is destructive on a
> populated DB). Schema changes go through `prisma migrate deploy` only.

```
HOST=qtip-admin@10.90.15.6     # stage; use 10.90.15.5 for prod
```

### Step 1 — Backup (rollback target)

Same dump as Phase 3 above. Abort if the dump is implausibly small.

### Step 2 — Deploy + build code

```bash
ssh $HOST "set -e; cd /opt/qtip; git fetch && git checkout <branch> && git pull; \
  cd backend && npm ci && npm run build; \
  cd ../frontend && npm ci && npm run build"
```

`backend` build runs `copy:assets`, which copies `src/workers/sql/*.sql`
(incl. the fixed `order_margin.extract.sql` / `order_margin.transform.sql`)
into `dist/`.

### Step 3 — Apply additive migrations

```bash
ssh $HOST "cd /opt/qtip/backend && npx prisma migrate deploy"
```

Pre-check: stage must have a `_prisma_migrations` history (i.e. was previously
migrated, not `db push`-ed). If the `ie_*` tables exist but history is missing,
baseline first with `npx prisma migrate resolve --applied <name>` for the
already-present migrations, then re-run `migrate deploy`. All pending June-2026
migrations are `ie_*`-scoped only (CREATE TABLE IF NOT EXISTS + INSERT into
`ie_kpi`/`ie_page`/`ie_source_report`).

### Step 4 — Idempotent sales users + departments

```bash
scp scripts/stage_seed_sales_users_departments.sql $HOST:/tmp/
ssh $HOST "mysql -h \$(grep '^DB_HOST=' /opt/qtip/backend/.env | cut -d= -f2-) \
  -u \$(grep '^DB_USER=' /opt/qtip/backend/.env | cut -d= -f2-) \
  -p\$(grep '^DB_PASSWORD=' /opt/qtip/backend/.env | cut -d= -f2-) \
  \$(grep '^DB_NAME=' /opt/qtip/backend/.env | cut -d= -f2-) \
  -e 'source /tmp/stage_seed_sales_users_departments.sql'"
```

`INSERT IGNORE` keyed on unique `department_name` / `email` / `username`:
existing rows are skipped and never modified. Adds the `Sales Department - All`
hierarchy (+ 3 teams) and 8 sales CSRs; resolves `role_id`/`department_id` by
name (stage ids differ from dev). Safe to re-run. The trailing verification
SELECTs print the resulting departments + users.

### Step 5 — Dimensions (order: dept -> emp -> calendar)

Employee/department dims are built from the primary DB (`users`, `departments`),
so they must run **after** Step 4. On a host where `ie_dim_*` is already
populated, restart the sync workers; on a fresh host, run the one-time
bootstraps first.

```bash
# fresh host only:
ssh $HOST "cd /opt/qtip/backend && npx ts-node src/scripts/seed-department-dimension.ts && \
           npx ts-node src/scripts/seed-employee-dimension.ts && \
           npx ts-node src/scripts/seed-date-dimension.ts"

# every host (pick up the new users/departments now, don't wait for cron):
ssh $HOST "pm2 restart ie-dept-sync --update-env --no-autorestart && sleep 5 && \
           pm2 restart ie-emp-sync  --update-env --no-autorestart && sleep 5 && \
           pm2 restart ie-calendar-sync --update-env --no-autorestart"
```

Verify `ie_dim_department.hierarchy_path` contains `/Sales Department - All`
and the new employees have a non-null `department_key`.

### Step 6 — Backfill the touched report sections

Requires the `crm` and `phone` source-pool connections in stage `backend/.env`.

```bash
ssh $HOST "cd /opt/qtip/backend; \
  npx ts-node src/workers/run-source-backfill.ts call_activity 2026-01-01 <today> 10; \
  npx ts-node src/workers/run-source-backfill.ts email_activity 2026-01-01 <today> 10; \
  npx ts-node src/workers/run-source-backfill.ts lead <24mo-ago> <today> 31; \
  npx ts-node src/workers/run-source-backfill.ts order_margin <24mo-ago> <today> 31; \
  npx ts-node src/workers/run-source-backfill.ts ticket_open <today> <today> 1; \
  npx ts-node src/workers/run-source-backfill.ts task_open <today> <today> 1"
```

`ticket_open`/`task_open` are SNAPSHOT (single current run). The dispatcher
(`ie-source-dispatch`) keeps everything fresh afterward on its DB-driven
cadence.

### Step 7 — Restart + validate

```bash
ssh $HOST "pm2 restart qtip-backend --update-env; sleep 5; curl -fsS http://localhost:5000/health"
```

- The 5 Agent Activity - Sales pages render with data.
- Sales Margin subs/warranty match the authoritative "Margin Report - By Month"
  (spot-check a month, e.g. Megan 114 subs / warranty 2,659.46 for 2026-05).
- Existing data untouched: `users` / `departments` / `forms` row counts equal
  the pre-deploy counts plus only the added sales rows; open one pre-existing QA
  form.

### Rollback

Restore the Step 1 dump (same command as the `## Rollback` section above). The
migrations and seed are additive, so a code revert + dump restore fully backs
the change out.
