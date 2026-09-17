-- ─────────────────────────────────────────────────────────────────────────────
-- Collections: split Declined ACH into its 1st and 16th runs.
--
-- ACH has always billed on both the 1st and the 16th, exactly as credit card does.
-- The gateway log carries ACH order ids on both cycles (collections_billing.extract.sql
-- measures them separately: 100% on the 1st cycle, 99.9% on the 16th), and the ACH
-- recurring run writes invoices on both days. Only card was ever split, so ACH was the
-- one instrument whose two cycles could not be compared with each other and whose
-- reported figures silently averaged two different books of accounts.
--
-- 'ACH' is RETIRED rather than removed. Migrations here are additive, and a fact row
-- loaded before this release still carries the old key until its next full reload, so
-- the row stays as a decode and is pushed to the end of the sort order. Every
-- collections fact is FULL_RELOAD_WINDOW / re-derived nightly, so the key disappears
-- from the facts on the next ingestion pass — there is deliberately NO data backfill
-- here, because re-deriving campaign_key in a migration would be a second copy of the
-- rule that collections_task.extract.sql and collections_invoice.transform.sql own.
--
-- Where the 1st/16th day comes from, per fact:
--   invoice  order_date  — IS the run date, by construction. Exact.
--   billing  attempt_date — the gateway's own timestamp; an ACH return posts against
--            the cycle it belongs to. Exact.
--   task     the ACH recurring run behind the task, looked up on the billing group the
--            run was configured to charge. NOT the task's created date: an ACH return
--            raises its task 3-21 days later (median ~6), so a created-date rule would
--            scramble the split it is meant to make. See collections_task.extract.sql.
--   touch / subscription  inherited from the task fact in their transforms, so the rule
--            above exists once instead of being re-derived three times.
--
-- Idempotent (INSERT ... ON DUPLICATE KEY UPDATE) and additive: no schema is altered
-- and no table is created. Mirrors the seed in 20260907170000_create_collections_facts.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO `ie_dim_collections_campaign`
  (`campaign_key`, `label`, `instrument`, `cycle`, `success_kind`, `dept_id`, `color`, `sort_order`)
VALUES
  ('CC_1_15',   'Declined CC (1st)',       'CC',     '1_15',  'RECOVERY_DOLLARS', 2, '#00aeef', 1),
  ('CC_16_31',  'Declined CC (16th)',      'CC',     '16_31', 'RECOVERY_DOLLARS', 2, '#0090c8', 2),
  ('ACH_1_15',  'Declined ACH (1st)',      'ACH',    '1_15',  'RECOVERY_DOLLARS', 2, '#1abc9c', 3),
  ('ACH_16_31', 'Declined ACH (16th)',     'ACH',    '16_31', 'RECOVERY_DOLLARS', 2, '#16a085', 4),
  ('CHECK',     'Check',                   'CHECK',  'NA',    'RECOVERY_DOLLARS', 2, '#f39c12', 5),
  ('EXP_CC',    'Expiring Credit Card',    'EXP_CC', 'NA',    'CARD_UPDATE',      2, '#9b59b6', 6),
  ('SALES_AR',  'Sales AR',                'SALES',  'NA',    'RECOVERY_DOLLARS', 1, '#e67e22', 7),
  ('ACH',       'Declined ACH (pre-split)', 'ACH',   'NA',    'RECOVERY_DOLLARS', 2, '#1abc9c', 99)
ON DUPLICATE KEY UPDATE
  `label`        = VALUES(`label`),
  `instrument`   = VALUES(`instrument`),
  `cycle`        = VALUES(`cycle`),
  `success_kind` = VALUES(`success_kind`),
  `dept_id`      = VALUES(`dept_id`),
  `color`        = VALUES(`color`),
  `sort_order`   = VALUES(`sort_order`);
