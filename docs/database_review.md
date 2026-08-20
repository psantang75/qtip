# Database efficiency review

Read-only assessment of the QTIP schema
([`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma), ~108 data
models across 116 migrations). Its purpose is to keep the database efficient and
well-maintained without growing it unnecessarily.

> Status: **PARTIALLY APPLIED.** The HIGH-value indexes and the `ScheduleShift`
> redundant-index drop were approved and shipped as migration
> `20260818190000_add_perf_indexes_drop_redundant_shift_index` (hand-authored SQL
> applied via `prisma migrate deploy` — see the migration-workflow note in
> [`database_schema_updates.md`](./database_schema_updates.md)). Each index was
> verified with `EXPLAIN` before/after (e.g. `auth_logs` went `type=ALL` full scan
> → `range` seek; `audit_logs` lost its `Using filesort`). Everything else below
> (data-integrity `*Raw` grains, schema-drift correctness fixes, hygiene) remains
> **OBSERVATIONS ONLY — not applied.** Per project rule, no further table/schema
> change ships without explicit, per-item approval.

## How to read the indexing findings (important nuance)

MySQL/MariaDB (InnoDB) **automatically creates an index for every foreign-key
column**. Prisma relation fields (`@relation`) generate FK constraints, so those
columns are already indexed even without an explicit `@@index`. Therefore:

- A model with relations but no `@@index` is **not** truly "unindexed" — its FK
  columns are covered.
- The real gaps are (a) tables with **no FK at all** (nothing auto-indexed),
  (b) **composite** indexes for multi-column filters/sorts that a single-column
  FK index cannot serve, and (c) indexes on **non-FK filter columns** (status,
  dates, booleans) that are never the leading column of an existing index.

The recommendations are framed accordingly, which corrects the earlier scan's
"zero-index hot tables" phrasing.

## HIGH value — indexes (APPLIED in migration `20260818190000`)

Each item lists the model, the query pattern it serves, and the index. All seven
below are now live (verified present in `information_schema.STATISTICS`).

- `AuthLog` (`auth_logs`) — the one genuinely unindexed hot table (no FK, no
  index). Login-throttling / lockout logic filters by `email` and time.
  - Proposed: `@@index([email, attempted_at])`.
- `AuditAssignment` (`audit_assignments`) — FK auto-indexes exist on `form_id`,
  `created_by`, `qa_id`, but the hot query is "active assignments for a QA in a
  window." The lone `qa_id` FK index cannot cover the `is_active` + `start_date`
  predicate.
  - Proposed: `@@index([qa_id, is_active, start_date])`.
- `Call` (`calls`) — has `@@index([call_date])` and a `csr_id` FK index, but
  "a CSR's calls in a date range" needs both columns together.
  - Proposed: `@@index([csr_id, call_date])`.
- `ScoreSnapshot` (`score_snapshots`) — FK indexes on `csr_id` / `submission_id`
  only; trend queries filter `csr_id` + `snapshot_date`.
  - Proposed: `@@index([csr_id, snapshot_date])`.
- `ImportLog` (`import_logs`) — Import Center lists by data type / status / recency.
  - Proposed: `@@index([data_type, created_at])` (optionally include `status`).
- `AuditLog` (`audit_logs`) — audit trail is queried by actor-over-time and by
  target. Only the `user_id` FK index exists.
  - Proposed: `@@index([user_id, created_at])` and `@@index([target_type, target_id])`.

Note: `Submission` is already well-indexed
(`[status, submitted_at]`, `[form_id, status, submitted_at]`, `[case_id]`), so
the earlier "Submission(submitted_by, submitted_at) missing" item is **not**
needed — `submitted_by` is FK-indexed and the composite paths already exist.
`SubmissionAnswer`'s `[submission_id, question_id]` point-lookup is largely
served by the `submission_id` FK index prefix; treat an explicit composite as
LOW value, not HIGH.

## Data-integrity — raw ingestion tables (mitigation APPLIED 2026-08-20; UNIQUE migration deferred)

The `*Raw` import tables accept bulk `createMany` loads in
[`backend/src/services/importService.ts`](../backend/src/services/importService.ts)
(the `import*` handlers; `runImport.ts` only orchestrates them). Except
`PunchRaw` — which `upsert`s on its `@unique post_id` — none has a **unique
grain**, so importing the *same report twice* (a second manual upload, or the
source emailing the same non-punch report as two separate messages) would
**duplicate rows in those six tables**.

**Corrected blast radius (this is NOT the "highest data-integrity risk in the
system" as originally written).** Traced end-to-end 2026-08-19:

- The Insights **dashboards** read the conformed warehouse (`ie_fact_*`), which
  is built from the **source systems** (phone/CRM/mail) via a separate,
  inherently idempotent pipeline (`ie_stg_*` TRUNCATEd each run → `ie_fact_*`
  upsert / DELETE+INSERT). See `insightsAgentActivity.service.ts` + the
  `workers/sql/*.extract.sql` FROM clauses. **The dashboards never read the
  `*Raw` tables.**
- The `*Raw` tables have exactly two touchpoints in the backend: written by
  `importService.ts`, read **only** by `rawDataService.ts` — i.e. the
  **Insights → Data Explorer / raw export** (`/app/insights/explorer`) and
  nothing else. So a duplicate `*Raw` row can only inflate the *raw explorer /
  Excel export*, never a report number.
- Automated ingestion is already largely dup-safe: the mailbox poller claims
  each message once (`findUnread` + `markRead`-before-import + move to
  `QTIP Processed`), and punches self-heal via `post_id`. The only residual dup
  vector is the *same report* arriving as two distinct emails/uploads for the
  six non-punch types.

**Decision (2026-08-19):** DEFER the destructive dedupe + `UNIQUE` migration. In
reality these six files are **not manually uploaded** — they arrive automated
from the source, so the practical dup vector is near-zero.

**Mitigation APPLIED (2026-08-20):** the manual-upload path is now **restricted
to an allowlist** instead of running the schema migration. Prerequisite (1) was
confirmed by tracing the pipelines: the six non-punch `*_raw` tables are fed
ONLY by manual upload / mailbox, while the dashboards read the idempotent
`ie_fact_*` tables produced by `SourceReportSyncWorker` (delete-window+insert) —
two independent paths, so blocking manual upload of the six cannot starve a
report. Restriction form (prerequisite 2) = **block the six dup-prone types**,
allowing only `punch_data` (which self-heals on `post_id`):

- Authoritative backend guard: `importController` rejects any `data_type` not in
  `IMPORT_ALLOWED_TYPES` (default `punch_data`) on both `/upload` and `/preview`,
  via the shared `resolveAllowedDataTypes` helper (the same one the mailbox
  poller uses — one allowlist implementation, two entry points).
- Frontend `MANUAL_UPLOAD_TYPES` registry mirrors it (derived from the full
  `INGESTABLE_DATA_TYPES` catalog, which the Email Feeds config still uses in
  full) so the UI only offers `punch_data`.
- Unit tests: `resolveAllowedDataTypes.test.ts` + `importController.guard.test.ts`.

Re-open the unique-grain work below (apply the PunchRaw-style upsert) only if a
read-only dup probe shows real duplicates, or if manual upload of the six is
re-enabled by widening `IMPORT_ALLOWED_TYPES`.

### Proposed unique grain per table

Derived from each handler's row shape in `importService.ts`. Grains marked
"CONFIRM" need a product decision because the source can legitimately emit
multiple rows per user/day and/or the key column is nullable (MySQL allows
multiple NULLs in a UNIQUE index, which silently defeats it).

| Table | Proposed `@@unique` | Notes |
| --- | --- | --- |
| `call_activity_raw` | `(user_id, report_date)` | One row per user/day. Clean. |
| `email_stats_raw` | `(user_id, report_date)` | One row per user/day. Clean. |
| `lead_sales_margin_raw` | `(user_id, report_date)` | One row per user/day. Clean. |
| `lead_source_raw` | `(user_id, report_date, source_name)` | `source_name` is `NOT NULL` (defaults `'Unknown'`) — safe composite. |
| `sales_margin_raw` | `(user_id, report_date, product_category)` **CONFIRM** | `product_category` is **nullable** → NULL rows won't dedupe. If the source is one row/user/day, use `(user_id, report_date)` instead. |
| `ticket_task_raw` | **CONFIRM** — likely `(user_id, report_date, ticket_id)` | `ticket_id` is **nullable**; many rows can share user/day/status. Needs the real identity of a "ticket" row before we can pick a safe key. |

### Mandatory pre-step: existing rows are probably already duplicated

Because these tables have run without a unique key, they likely already hold
duplicate rows. **Adding a UNIQUE constraint will fail on duplicate data**, so
the migration must dedupe first (keep the newest `id` per grain, delete the
rest) — a **data-mutating** change that must be backed up and approved. Size the
problem first with this read-only probe (example for `call_activity_raw`; repeat
per table with its proposed grain):

```sql
SELECT user_id, report_date, COUNT(*) AS n
FROM call_activity_raw
GROUP BY user_id, report_date
HAVING n > 1
ORDER BY n DESC
LIMIT 50;
```

### Code change (lands atomically with the migration)

Switch the six `createMany` calls in `importService.ts` to the proven `PunchRaw`
pattern: chunked `$transaction` of `upsert`s keyed on the new compound
`@@unique`. Upsert (not `createMany({ skipDuplicates })`) so a re-import **heals
corrected values** in place instead of silently skipping them — matching how
punch data already behaves. `import_id` updates to the latest run on conflict.

- Prefer reusing these existing tables and enforcing grain over adding new
  staging tables.
- `EntityRaw` (if present) follows the same treatment once its grain is confirmed.

## Schema drift / correctness

- `AiFormRulePackAssignment.form_id` had an `@@index` and `@@unique([form_id,
  rule_pack_id])` but **no `@relation` to `Form`** — so there was no FK / no
  `onDelete`, and deleting a form left orphan assignment rows.
  - **APPLIED** (migration `20260820120000`): added the Prisma `@relation` +
    `ai_form_rule_pack_assignment_form_id_fkey` FK with `onDelete: Cascade`
    (mirrors the sibling `rule_pack` FK). Orphan probe = 0 before applying.
- `ScheduleShift` had both `@@unique([user_id, shift_date])` and
  `@@index([user_id, shift_date])` on the **same columns** — the unique
  constraint already provides that index, so the explicit `@@index` was redundant.
  - **APPLIED** (migration `20260818190000`): dropped `idx_schedule_shift_user_date`.
- Coaching `list_items` foreign keys lacked FKs on `coaching_purpose`,
  `coaching_format`, and `source_type` (each a `// FK -> list_items.id` scalar).
  - **APPLIED** (migration `20260820120000`): added three DB-level FKs into
    `list_items(id)` with `ON DELETE SET NULL` (columns are nullable, so history
    is preserved; list items are only ever soft-deleted so this never fires in
    practice). These are **DB-level only** — `ListItem` is `@@ignore`d in
    `schema.prisma` (raw-SQL-managed via List Management), exactly like the four
    FKs that already point into it (`quiz_topics`, `resource_topics`,
    `coaching_session_behavior_flags`, `write_up_list_items`), so they cannot be
    modeled as Prisma `@relation`s. This is expected, guardrail-covered drift.

## Efficiency / hygiene (lower priority, mostly consistent already)

- Money uses `Decimal` consistently (e.g. `total_score Decimal(5,2)`,
  `pass_score Decimal(5,2)`) — good; no `Float`-for-money issues found in spot checks.
- Several status/scope columns are `VarChar` where an enum *might* look safer.
  **CLOSED — no change (reviewed 2026-08-20):** on inspection none of the
  `RecordUnlock` columns are a good enum candidate:
  - `reason_code` is **intentionally** a string — it holds a code from the
    admin-managed `unlock_reason` list (`list_items`), curated in List
    Management (see the model doc-comment). An enum would defeat that.
  - `prior_status` is a **cross-entity status snapshot** — it stores the prior
    status of *either* a submission *or* a dispute (`entity_type` selects which),
    so no single enum vocabulary fits it, and historical rows may hold values
    outside any current enum. Leaving it `VarChar(20)` is correct.
  - `new_status` does **not exist** on the model (the record captures a
    `prior_snapshot` for the auto re-lock sweep instead), so there is nothing to
    convert. Item resolved as "leave as-is."
- `@updatedAt` is present on high-churn tables (`Call`, `AgentActivity`,
  `ScheduleShift`) but missing on some append-only logs — acceptable for
  immutable logs.
- Migration churn: multiple `agent_activity` KPI migrations and repeated renames.
  A baseline squash is possible but only worthwhile if you accept resetting
  migration history; not recommended solely for cosmetics.

## Suggested rollout (only if/when approved)

1. Approve the HIGH-value indexes as one reviewed migration; measure with
   `EXPLAIN` on the target queries before/after.
2. Approve the `AiFormRulePackAssignment` relation + `ScheduleShift` redundant
   index drop (correctness, low risk) in the same or a follow-up migration.
3. Address `*Raw` unique grain + idempotent import together (schema + code) so
   the constraint and the upsert land atomically. **Pre-req:** confirm the two
   CONFIRM grains, run the duplicate probes, then back up and dedupe existing
   rows in the same migration *before* adding each `@@unique` (a UNIQUE add fails
   on pre-existing duplicates).

Nothing above changes behavior until you explicitly approve the specific item.
