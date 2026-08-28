-- ─────────────────────────────────────────────────────────────────────────────
-- Phone Queue Coverage — who should be staffing which phone queue, and when.
--
-- A global queue LIBRARY is defined once in List Management, then ASSIGNED to
-- one or more departments. The assignment row is where the numbers live, because
-- the same queue can matter more to one department than another: fill_priority
-- (which queue is filled first), min/target/max headcount. phone_queue_window
-- varies those numbers by time of day where the queue's demand is not flat.
--
-- MEMBERSHIP says who may staff a queue and in what order they get pulled into
-- it (person_priority), which queue is their home, and whether they are pinned
-- there. phone_queue_policy holds the per-department rules that are not
-- per-queue.
--
-- Nothing stores a solved assignment. Coverage is computed on read from the work
-- schedule (shifts + exceptions + activity segments), the same way the campaign
-- month is projected rather than materialised. phone_queue_assignment_override
-- is the only stored plan data: a manager's manual add/remove for one day, which
-- always beats the solver.
--
-- QTIP is the plan of record only — nothing here is pushed to Genesys, whose
-- database QTIP reads and never writes.
--
-- Conventions match 20260803180000_add_campaigns:
--   utf8mb4 / utf8mb4_unicode_ci, `CREATE TABLE IF NOT EXISTS`, `INSERT IGNORE`,
--   uq_* unique keys, idx_* indexes, fk_* constraints with explicit ON DELETE.
--   created_by carries NO foreign key (users are deactivated, not deleted).
--   These are operational tables, not ie_fact_/ie_stg_, so the warehouse
--   partitioning rule does not apply.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Queue library — global, like campaign_category. queue_code is the operator's
--    label for the matching Genesys queue so a supervisor knows what to change;
--    it is not an integration key and nothing joins on it.
CREATE TABLE IF NOT EXISTS `phone_queue` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `queue_name`  VARCHAR(120) NOT NULL,
  `queue_code`  VARCHAR(120) NULL,
  `description` VARCHAR(500) NULL,
  `color`       VARCHAR(20)  NOT NULL DEFAULT '#00aeef',
  `sort_order`  INT          NOT NULL DEFAULT 0,
  `is_active`   BOOLEAN      NOT NULL DEFAULT TRUE,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_phone_queue_name` (`queue_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Queue assigned to a department, with that department's rules for it.
--    fill_priority ascends: 1 is filled to its minimum before 2. Ties break on
--    the library sort_order, so the order is always total and never arbitrary.
CREATE TABLE IF NOT EXISTS `phone_queue_department` (
  `id`            INT      NOT NULL AUTO_INCREMENT,
  `queue_id`      INT      NOT NULL,
  `department_id` INT      NOT NULL,
  `fill_priority` INT      NOT NULL DEFAULT 100,
  `min_agents`    INT      NOT NULL DEFAULT 1,
  `target_agents` INT      NOT NULL DEFAULT 1,
  `max_agents`    INT      NULL,
  `is_active`     BOOLEAN  NOT NULL DEFAULT TRUE,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_phone_queue_department` (`queue_id`, `department_id`),
  INDEX `idx_phone_queue_department_dept` (`department_id`, `fill_priority`),
  CONSTRAINT `fk_phone_queue_department_queue`
    FOREIGN KEY (`queue_id`) REFERENCES `phone_queue`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_phone_queue_department_dept`
    FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Time-of-day override of a queue's numbers. These do NOT define the coverage
--    time frames — those come from schedule_coverage_window so queue coverage is
--    graded on the same clock as schedule coverage. A frame takes the numbers of
--    whichever window contains its start minute, falling back to the row in
--    phone_queue_department. So these never need to align with each other.
CREATE TABLE IF NOT EXISTS `phone_queue_window` (
  `id`                  INT      NOT NULL AUTO_INCREMENT,
  `queue_department_id` INT      NOT NULL,
  `start_time`          TIME     NOT NULL,
  `end_time`            TIME     NOT NULL,
  `min_agents`          INT      NOT NULL DEFAULT 1,
  `target_agents`       INT      NOT NULL DEFAULT 1,
  `max_agents`          INT      NULL,
  `sort_order`          INT      NOT NULL DEFAULT 0,
  `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_phone_queue_window_qd` (`queue_department_id`, `sort_order`),
  CONSTRAINT `fk_phone_queue_window_qd`
    FOREIGN KEY (`queue_department_id`) REFERENCES `phone_queue_department`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Who may staff a queue. person_priority ascends — 1 is pulled into a
--    higher-priority queue before 2. is_home marks the queue somebody sits in by
--    default; is_pinned means never move them off it, whatever the shortfall.
CREATE TABLE IF NOT EXISTS `phone_queue_member` (
  `id`              INT      NOT NULL AUTO_INCREMENT,
  `queue_id`        INT      NOT NULL,
  `user_id`         INT      NOT NULL,
  `is_home`         BOOLEAN  NOT NULL DEFAULT FALSE,
  `person_priority` INT      NOT NULL DEFAULT 100,
  `is_pinned`       BOOLEAN  NOT NULL DEFAULT FALSE,
  `is_active`       BOOLEAN  NOT NULL DEFAULT TRUE,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_phone_queue_member` (`queue_id`, `user_id`),
  INDEX `idx_phone_queue_member_user` (`user_id`),
  CONSTRAINT `fk_phone_queue_member_queue`
    FOREIGN KEY (`queue_id`) REFERENCES `phone_queue`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_phone_queue_member_user`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Per-department rules that are not per-queue. One row per department, the
--    same shape as schedule_coverage_threshold. require_min_one_per_queue is the
--    floor rule: every active queue gets a body before any queue is filled to its
--    minimum, because a queue with nobody in it does not ring.
CREATE TABLE IF NOT EXISTS `phone_queue_policy` (
  `id`                        INT      NOT NULL AUTO_INCREMENT,
  `department_id`             INT      NOT NULL,
  `is_enabled`                BOOLEAN  NOT NULL DEFAULT TRUE,
  `max_queues_per_person`     INT      NOT NULL DEFAULT 1,
  `require_min_one_per_queue` BOOLEAN  NOT NULL DEFAULT TRUE,
  `respect_pins`              BOOLEAN  NOT NULL DEFAULT TRUE,
  `created_at`                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_phone_queue_policy_dept` (`department_id`),
  CONSTRAINT `fk_phone_queue_policy_dept`
    FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. The manual layer over the computed plan, mirroring campaign_schedule_override.
--    ASSIGN forces somebody into a queue for one day; EXCLUDE keeps them out of it.
--    Applied last, so a manager's call always wins over the solver.
CREATE TABLE IF NOT EXISTS `phone_queue_assignment_override` (
  `id`              INT      NOT NULL AUTO_INCREMENT,
  `department_id`   INT      NOT NULL,
  `assignment_date` DATE     NOT NULL,
  `user_id`         INT      NOT NULL,
  `queue_id`        INT      NOT NULL,
  `action`          ENUM('ASSIGN','EXCLUDE') NOT NULL,
  `created_by`      INT      NULL,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_phone_queue_override` (`department_id`, `assignment_date`, `user_id`, `queue_id`),
  INDEX `idx_phone_queue_override_dept_date` (`department_id`, `assignment_date`),
  CONSTRAINT `fk_phone_queue_override_dept`
    FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_phone_queue_override_user`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_phone_queue_override_queue`
    FOREIGN KEY (`queue_id`) REFERENCES `phone_queue`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: app_page catalog. section = 'scheduling', after Call Campaigns (30).
-- The queue library is edited in List Management (admin-only); this page is the
-- department coverage view. supports_self is FALSE and there is deliberately NO
-- CSR grant — an OWN viewer would land on a manager page with no self view built
-- for them. Add CSR OWN together with a "My Queue" route, not before.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `app_page`
  (`page_key`, `page_name`, `section`, `route_path`, `icon`, `sort_order`, `supports_self`, `self_route_path`, `self_label`, `self_icon`) VALUES
  ('sched_queues', 'Phone Queues', 'scheduling', '/app/scheduling/queues', 'PhoneCall', 40, FALSE, NULL, NULL, NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: role grants — Admin EDIT, Manager EDIT, Director ALL.
--
-- Joined on `roles.role_name`, not on a hardcoded role id. Director is a real
-- role in the permission matrix but has no `roles` row in every environment, so
-- an id-based insert is either wrong or a silent no-op depending on where it
-- runs. The join grants Director wherever the role exists and skips it cleanly
-- where it does not.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`, `access_level`)
SELECT p.id, r.id, TRUE, r.role_name <> 'Director', IF(r.role_name = 'Director', 'ALL', 'EDIT')
FROM `app_page` p
JOIN `roles` r ON r.role_name IN ('Admin', 'Manager', 'Director')
WHERE p.page_key = 'sched_queues';
