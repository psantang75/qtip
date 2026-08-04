-- ─────────────────────────────────────────────────────────────────────────────
-- Call Campaign schedules reach MORE THAN ONE department. A named calendar (say
-- "Customer Service AR") is often the same plan for several departments, and
-- copying it per department would mean several calendars to publish and keep in
-- step.
--
-- campaign_schedule.department_id stays as the OWNING department: it still backs
-- uq_campaign_schedule_dept_name and the write-scope guard. This table is the
-- list of departments that SEE the calendar, and it is the only thing visibility
-- reads — so every existing schedule is seeded with its current department and
-- nothing changes for anyone.
--
-- Mirrors report_definition_departments / performance_goal_departments;
-- conventions match 20260803180000_add_campaigns.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `campaign_schedule_department` (
  `id`            INT      NOT NULL AUTO_INCREMENT,
  `schedule_id`   INT      NOT NULL,
  `department_id` INT      NOT NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_campaign_schedule_department` (`schedule_id`, `department_id`),
  INDEX `idx_campaign_schedule_department_dept` (`department_id`),
  CONSTRAINT `fk_campaign_schedule_department_schedule`
    FOREIGN KEY (`schedule_id`) REFERENCES `campaign_schedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_campaign_schedule_department_department`
    FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the owning department, so a schedule that existed before this migration
-- is visible to exactly the department it already belonged to.
INSERT INTO `campaign_schedule_department` (`schedule_id`, `department_id`)
SELECT `id`, `department_id` FROM `campaign_schedule`
ON DUPLICATE KEY UPDATE `schedule_id` = `campaign_schedule_department`.`schedule_id`;
