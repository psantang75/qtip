-- Consolidate the `disputes.status` value `REJECTED` into `UPHELD`.
--
-- Background:
--   The dispute resolution UI only ever produces UPHOLD or ADJUST. Historical
--   data and a deprecated backend code path produced 118 rows with status
--   `REJECTED`. Every consumer (KPI engine, analytics service, manager filter,
--   status badges) already treats REJECTED and UPHELD identically — both mean
--   "the auditor's original score stood." Two synonyms for one outcome was a
--   source of confusion (e.g. dispute_upheld_rate showed 60% but the literal
--   `UPHELD` count was 0 because everything was filed as REJECTED).
--
-- Effect:
--   * KPI numbers are unchanged (the IN ('UPHELD','REJECTED') filters already
--     counted both as upheld).
--   * Status badges that previously rendered red "Rejected" now render green
--     "Upheld".
--   * audit_logs entries that recorded the original RESOLVE_DISPUTE event are
--     left untouched — they correctly preserve historical intent.
--
-- Schema:
--   The MySQL ENUM definition keeps `REJECTED` as a legal-but-unused value so
--   no ALTER TABLE is required. Same for the Prisma `DisputeStatus` enum.

UPDATE disputes
SET    status = 'UPHELD'
WHERE  status = 'REJECTED';
