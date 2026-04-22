-- coaching_cadence had no UI surface (no tile, no chart, no section binding)
-- and the previous attempt to give it a distinct formula
-- (see migration 20260422020000_fix_coaching_cadence) produced math that was
-- off by 50x because `sessScheduled` counts sessions whose CURRENT status is
-- SCHEDULED (i.e., still pending), not the original commitment count. Rather
-- than keep a stranded KPI in the registry that nothing renders, deactivate
-- the row. The row is kept (not deleted) so historical thresholds and audit
-- entries referencing the kpi_id remain intact — same approach used for
-- dispute_not_upheld_rate in migration 20260421000000_fix_kpi_metadata.
--
-- Backend (QCKpiService.ts) and frontend (kpiDefs.ts) no longer emit /
-- declare this KPI in the same change.

UPDATE ie_kpi
SET is_active = 0
WHERE kpi_code = 'coaching_cadence';
