-- Adds a `segment` dimension to the Tickets & Tasks productivity roll-up so the
-- Sales Productivity page can split the "Contact Manager" task type out from all
-- other tickets/tasks. Segments:
--   contact_manager = tasks whose task type title is 'Contact Manager'
--   other           = every other task type + all tickets
-- CSR is unaffected: its rows are always 'other', and the read collapses the
-- segment for the CSR area, so its output is unchanged.
--
-- Additive + destroys no data: existing rows take the DEFAULT 'other' and stay
-- unique under the widened PK. Backfilled rows are then recomputed with
-- `--productivity --force`, which re-splits them by segment.
ALTER TABLE `ie_ticket_task_productivity_daily`
  ADD COLUMN `segment` ENUM('contact_manager','other') NOT NULL DEFAULT 'other' AFTER `employee_key`;

ALTER TABLE `ie_ticket_task_productivity_daily`
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (`snapshot_date`, `area`, `employee_key`, `segment`);
