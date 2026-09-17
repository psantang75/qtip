-- ─────────────────────────────────────────────────────────────────────────────
-- Put the Collections subscription feed back under active monitoring.
--
-- Registry row only — no schema change.
--
-- `collections_subscription` is an active source report on a 1440-minute cadence
-- and has been loading daily, but its `ie_dataset_monitor` row carried
-- is_active = 0, so `MonitoringWorker` skipped it. That is the one Collections
-- feed behind Campaign & Touch's Subscription Outcomes — retained, terminated
-- and reactivated, plus the MRR either side of them — so a silent stall would
-- have shown as a section quietly reading zero with no WARN/RED alert and
-- nothing on the Admin → Insights → Monitoring dashboard.
--
-- Its six siblings (billing, call, invoice, recovery, task, touch) are all
-- active, and this row already matches them on every other column: same
-- producer_kind (source_report), same producer_ref convention, same
-- run_recency check against its own fact table. Only the flag differed, which
-- is why this is a flag flip and not a re-seed — the thresholds an operator may
-- have tuned from the Monitoring screen are left exactly as they are.
--
-- Required by .cursor/rules/insights-report-page.mdc §2: the dataset behind a
-- report page must be covered by the monitoring system, because a feed nobody
-- watches is indistinguishable from a feed with no data.
--
-- Idempotent: re-running matches the same key and sets the same value.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE `ie_dataset_monitor`
   SET `is_active` = TRUE
 WHERE `dataset_code` = 'collections_subscription';
