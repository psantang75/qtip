-- Corrects metadata on three `ie_kpi` rows so the public registry, KPI tiles,
-- and tooltip catalogs all agree with what the calculation engine actually
-- does at runtime (see backend/src/services/QCKpiService.ts).
--
-- This migration only updates DOCUMENTATION / METADATA fields. It does NOT
-- alter any schema and does NOT change calculation behavior.

-- 1. dispute_upheld_rate: a high upheld rate means the auditor's original
--    score was correct (the dispute did not change the score). Higher is
--    therefore better, not worse.
UPDATE ie_kpi
SET direction = 'UP_IS_GOOD'
WHERE kpi_code = 'dispute_upheld_rate';

-- 2. writeup_rate: the engine returns (writeups / active_users * 100), i.e.
--    a percentage. The format flag was previously stored as NUMBER, which
--    caused the tile to render the value with no `%` suffix.
UPDATE ie_kpi
SET format_type = 'PERCENT'
WHERE kpi_code = 'writeup_rate';

-- 3. dispute_not_upheld_rate: the engine never computes this KPI (it is
--    hard-coded to NULL — see kpiDefs.ts catalog and QCKpiService.ts).
--    Deactivate the row so it stops appearing in the registry / kpi-config
--    response. The row is kept (not deleted) so historical thresholds and
--    audit rows referencing the kpi_id remain intact.
UPDATE ie_kpi
SET is_active = 0
WHERE kpi_code = 'dispute_not_upheld_rate';
