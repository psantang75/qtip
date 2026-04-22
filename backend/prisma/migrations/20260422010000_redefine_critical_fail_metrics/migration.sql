-- Redefines the two critical-fail KPIs to answer the questions QA leadership
-- actually asks:
--
--   critical_fail_rate     -> "What % of audits had ANY critical question
--                              answered NO?" (regardless of whether the score
--                              cap actually clipped the result)
--
--   avg_criticals_per_audit -> "On average, how many critical questions are
--                              missed per audit?" (can exceed 1 when multiple
--                              critical questions are missed on the same form)
--
-- The previous critical_fail_rate counted only audits where score_capped = 1
-- (i.e. the cap actually fired); that's a narrower reporting question we may
-- expose later as a separate metric.

UPDATE ie_kpi
SET description = 'Percentage of finalized audits where at least one critical question was missed.',
    formula     = 'COUNT(submissions WHERE critical_fail_count > 0) / COUNT(submissions WHERE status = ''FINALIZED'') * 100'
WHERE kpi_code = 'critical_fail_rate';

UPDATE ie_kpi
SET description = 'Average critical questions missed per finalized audit (counts every NO, so can exceed 1).',
    formula     = 'SUM(submissions.critical_fail_count) / COUNT(submissions WHERE status = ''FINALIZED'')'
WHERE kpi_code = 'avg_criticals_per_audit';
