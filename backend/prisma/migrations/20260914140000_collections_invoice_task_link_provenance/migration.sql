-- ─────────────────────────────────────────────────────────────────────────────
-- Collections: the explicit CRM invoice→task link, and how each link was made.
--
-- An AR task is matched to the invoice it chased. Until now that was pure inference:
-- find a task on the billing group the recurring run charged, inside a time window.
-- The inference is sound for most of the population and is staying, but it cannot
-- reach the cases where CRM put the task somewhere else, and it has no way to say how
-- confident it is.
--
-- Invoice 1919833 is the case it cannot reach. It declined 2026-08-01 on group 68054
-- and was paid 08-03 on group 112957; its AR task 1104237 is recorded against 112957,
-- the group that PAID. No rule keyed on the charged group can find it, and no rule
-- keyed on the header can be trusted, because CRM rewrites the header to the paying
-- group. CRM does hold the answer explicitly, in tblTaskOrder.
--
-- 1. crm_task_id / crm_task_count (STAGING ONLY). tblTaskOrder is a general
--    order↔task table — across 2026-08/09 its links are mostly provisioning types
--    (25, 30, 27, 26). Restricted to the AR types this report already uses
--    (1, 33, 34, 4, 9) it yields 103 links over 88 invoices, and against the
--    inference it agrees on 35, DISAGREES on 13 worth 6,911.42, and supplies 55 worth
--    8,741.62 that the inference finds no task for at all. The count comes across
--    beside the id because several AR tasks can link to one invoice, and that is a
--    real ambiguity to report rather than a tie to break silently. Staging only: the
--    fact already has task_id, and this is the raw evidence the transform resolves,
--    not a fact-grain attribute.
--
-- 2. task_link_source (FACT). Which rule produced task_id, so the page can tell the
--    four states apart instead of guessing:
--      EXPLICIT  — one AR task linked in tblTaskOrder. Authoritative.
--      AMBIGUOUS — several AR tasks linked; the earliest is used and the doubt is
--                  reported rather than hidden.
--      TRIGGERED — inferred: raised on the charged group on/after the invoice, while
--                  it was still owed. "New task created".
--      COVERED   — inferred: opened earlier on the charged group and still open when
--                  the invoice landed. "Existing task covers invoice" (1932164).
--      NULL      — no task. "No matching task".
--    Without it the read layer has to re-derive TRIGGERED vs COVERED from a date
--    comparison, which is a second copy of a rule the transform already applied and
--    cannot express EXPLICIT or AMBIGUOUS at all.
--
-- Purely additive: nullable columns, no index, no existing column, key or partition
-- touched. Idempotent via the information_schema guard used by
-- 20260914120000_collections_invoice_financial_event_times.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── the explicit link CRM recorded, and how many there were ───────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_invoice' AND COLUMN_NAME = 'crm_task_id') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_invoice` ADD COLUMN `crm_task_id` INT NULL');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_stg_collections_invoice' AND COLUMN_NAME = 'crm_task_count') > 0,
  'DO 0',
  'ALTER TABLE `ie_stg_collections_invoice` ADD COLUMN `crm_task_count` SMALLINT NULL');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ── which rule made the link the fact carries ─────────────────────────────────
SET @ddl := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ie_fact_collections_invoice' AND COLUMN_NAME = 'task_link_source') > 0,
  'DO 0',
  'ALTER TABLE `ie_fact_collections_invoice` ADD COLUMN `task_link_source` VARCHAR(16) NULL AFTER `task_id`');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
