-- Schedule Adherence: retune the csr_att_compliance KPI to the conformance-based
-- metric and raise the red/yellow/green bands to a very high standard. Data-only
-- (no schema change): the percentage now measures TOTAL time worked (make-up
-- allowed, lunch/break overage counted by duration, capped at 100%), so the
-- registry name/description/formula and the thresholds are refreshed to match.

UPDATE `ie_kpi`
SET `kpi_name`    = 'Schedule Adherence',
    `description` = 'Total time actually worked as a share of scheduled paid time, over the rolling window. Work minutes plus paid break up to the scheduled allowance, divided by scheduled paid minutes (unpaid lunch excluded), capped at 100%. Timing-neutral: a break delayed for coverage or a late arrival made up by staying late still nets to 100%; a long lunch or a break beyond the allowance lowers it. Full-day excused days are removed from both sides. Arrival/departure timing is scored separately as attendance points.',
    `formula`     = 'MIN(scheduled_minutes, work_minutes + MIN(break_minutes, break_allowance)) / scheduled_minutes x 100'
WHERE `kpi_code` = 'csr_att_compliance';

-- Very high standard: Green >= 98%, Yellow 95-<98%, Red < 95%.
UPDATE `ie_kpi_threshold`
SET `goal_value` = 98.0000, `warning_value` = 95.0000, `critical_value` = 95.0000
WHERE `kpi_id` = (SELECT `id` FROM `ie_kpi` WHERE `kpi_code` = 'csr_att_compliance')
  AND `department_key` IS NULL;
