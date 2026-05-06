-- ─────────────────────────────────────────────────────────────────────────────
-- BASELINE SEED — canonical role rows.
--
-- These six rows are referenced as foreign keys by downstream migrations
-- (e.g. 20260407000000_seed_qc_kpis populates ie_page_role_access.role_id =
-- 1, 2, 4, 5) and as integer constants throughout the backend
-- (UserService validates role_id in 1..6; QCKpiService / EnhancedPerformanceGoalService
-- query `WHERE role_id = 3` for the active CSR cohort; controllers / repositories
-- match by role_name string 'Admin', 'QA', 'CSR', 'Trainer', 'Manager', 'Director').
--
-- On dev this row set is normally created by `prisma/seed.ts` from the CSV
-- bootstrap in QTIP_data/. Stage and prod don't have those CSVs, so without
-- this migration the qc_kpis seed migration fails on a foreign-key
-- constraint when inserting into ie_page_role_access.
--
-- INSERT IGNORE makes this idempotent: dev DBs that already have rows for
-- these IDs (from the CSV bootstrap) silently skip them; fresh DBs get the
-- canonical set.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT IGNORE INTO `roles` (`id`, `role_name`) VALUES
  (1, 'Admin'),
  (2, 'QA'),
  (3, 'CSR'),
  (4, 'Trainer'),
  (5, 'Manager'),
  (6, 'Director');
