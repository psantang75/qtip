-- ─────────────────────────────────────────────────────────────────────────────
-- ie_fact_collections_task: customer-keyed lookup index
--
-- `collections_call.transform.sql` attaches a call to the task that preceded it
-- by joining the task fact on customer plus a `created_on` lookback window, and
-- then re-checks "no closer task exists" with a correlated NOT EXISTS. The fact
-- had no index on `customer_id` (EXPLAIN reported `possible_keys: NULL`), so the
-- outer join degraded to a hash join over the whole table and the subquery
-- re-scanned all ~22.8k rows per staged call. That cost is not backfill-only:
-- the report runs every 240 minutes over a rolling 7-day window.
--
-- Composite rather than `customer_id` alone: the predicate is an equality on
-- customer plus a range on `created_on`, so carrying the timestamp as the
-- second column resolves the range inside the index instead of via row lookups,
-- and serves the NOT EXISTS probe as well. Selectivity is favorable — ~11.5k
-- distinct customers across ~22.8k rows, so ~2 rows per probe.
--
-- The table is RANGE-partitioned on `date_key`. That constrains unique keys
-- only, so this non-unique secondary index does not need `date_key` in it.
--
-- Idempotent via the SET @sql / PREPARE / EXECUTE pattern established in
-- 20260423120000_add_qc_performance_indexes ('SELECT 1' is the no-op branch).
-- Hand-authored SQL applied with `prisma migrate deploy` because the Insights
-- `ie_fact_*` / `ie_stg_*` warehouse layer is unmodeled in schema.prisma by
-- design, so `prisma migrate dev` cannot be used here.
-- ─────────────────────────────────────────────────────────────────────────────

SET @sql := IF((SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'ie_fact_collections_task' AND index_name = 'idx_fct_task_cust_created') = 0, 'CREATE INDEX `idx_fct_task_cust_created` ON `ie_fact_collections_task` (`customer_id`, `created_on`)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
