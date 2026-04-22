-- Shortens the descriptions on the two critical-fail KPIs so they read like
-- the rest of the Quality catalog (avg_qa_score, dispute_rate, etc. are all
-- 38-65 chars / single sentence). The previous text referenced the internal
-- `critical_cap_percent` column and was 3x the length of its peers.

UPDATE ie_kpi
SET description = 'Percentage of finalized audits capped at the critical-fail score.'
WHERE kpi_code = 'critical_fail_rate';

UPDATE ie_kpi
SET description = 'Average critical-fail questions missed per finalized audit.'
WHERE kpi_code = 'avg_criticals_per_audit';
