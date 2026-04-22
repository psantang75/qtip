-- coaching_cadence previously had the same SQL as coaching_delivery_rate
-- (both = sessDelivered / sessTotal), making the two metrics meaningless
-- duplicates. Redefine cadence as the share of SCHEDULED sessions that we
-- actually delivered (commitment reliability), which is meaningfully
-- distinct from delivery_rate (overall throughput against all sessions).

UPDATE ie_kpi
SET description = 'Of coaching sessions that were scheduled in the period, the share that were actually delivered.',
    formula     = 'COUNT(coaching_sessions WHERE delivered_at IS NOT NULL) / COUNT(coaching_sessions WHERE status = ''SCHEDULED'') * 100'
WHERE kpi_code = 'coaching_cadence';
