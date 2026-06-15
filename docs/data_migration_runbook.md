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

### Phase 6 — Validate

1. **Row-count parity** vs the legacy DB you exported from.
2. **FK integrity** — run `scripts/backups/fk_integrity_checks.sql`; 16
   checks should each return 0 orphans.
3. **Coaching/write-up split** — `19 ONE_ON_ONE + 90 SIDE_BY_SIDE` coaching
   + `5 VERBAL_WARNING + 7 WRITTEN_WARNING` write-ups for the 3/23 dataset.
   These counts will differ on a fresher export; spot-check that legacy's
   `Verbal Warning` / `Written Warning` row count matches new
   `write_ups`, and that legacy's other coaching types match new
   `coaching_sessions`.
4. **AUTO_INCREMENT reset** — confirmed automatically by the loader's
   final "Resetting AUTO_INCREMENT values..." block.
5. **Live upload smoke** —
   `ssh $HOST "cd /opt/qtip && npx ts-node scripts/backups/smoke_uploads.ts"`.
   Should print matching SHAs for both write-up and coaching upload paths.

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
