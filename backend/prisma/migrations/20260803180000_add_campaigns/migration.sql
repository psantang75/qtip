-- ─────────────────────────────────────────────────────────────────────────────
-- Call Campaign Schedule — department-scoped, auto-projected campaign calendars.
--
-- A shared campaign LIBRARY (categories + campaigns, each with a color at the
-- category level and a timing rule at the item level) is defined once in List
-- Management. Each department gets one or more named SCHEDULES; membership picks
-- which campaigns are enabled. For any month the system projects each enabled
-- campaign onto that month's business days via its anchor rule (computed on read
-- — no stored per-month rows), and a small OVERRIDES table records the manager's
-- manual per-day add/remove tweaks.
--
-- Conventions match 20260731170000_add_scheduling:
--   utf8mb4 / utf8mb4_unicode_ci, `CREATE TABLE IF NOT EXISTS`, `INSERT IGNORE`,
--   uq_* unique keys, idx_* indexes, fk_* constraints with explicit ON DELETE.
--   created_by carries NO foreign key (users are deactivated, not deleted).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Campaign categories — colors live here (category level), like the PDF's
--    grouped call types. Global library, not department-scoped.
CREATE TABLE IF NOT EXISTS `campaign_category` (
  `id`         INT          NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(100) NOT NULL,
  `color`      VARCHAR(20)  NOT NULL DEFAULT '#00aeef',
  `sort_order` INT          NOT NULL DEFAULT 0,
  `is_active`  BOOLEAN      NOT NULL DEFAULT TRUE,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_campaign_category_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Campaign items — one campaign with a pluggable timing rule.
--    anchor_type + anchor_offset (+ anchor_ref_item_id for RELATIVE) drive the
--    monthly projection over business days. not_on_friday shifts a Friday hit to
--    the next workday.
CREATE TABLE IF NOT EXISTS `campaign_item` (
  `id`                 INT          NOT NULL AUTO_INCREMENT,
  `category_id`        INT          NOT NULL,
  `label`              VARCHAR(150) NOT NULL,
  `anchor_type`        ENUM('BD_FROM_START','BD_FROM_END','RELATIVE_TO_CAMPAIGN') NOT NULL DEFAULT 'BD_FROM_START',
  `anchor_offset`      INT          NOT NULL DEFAULT 1,
  `anchor_ref_item_id` INT          NULL,
  `not_on_friday`      BOOLEAN      NOT NULL DEFAULT FALSE,
  `sort_order`         INT          NOT NULL DEFAULT 0,
  `is_active`          BOOLEAN      NOT NULL DEFAULT TRUE,
  `created_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_campaign_item_category` (`category_id`),
  INDEX `idx_campaign_item_ref` (`anchor_ref_item_id`),
  CONSTRAINT `fk_campaign_item_category`
    FOREIGN KEY (`category_id`) REFERENCES `campaign_category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_campaign_item_ref`
    FOREIGN KEY (`anchor_ref_item_id`) REFERENCES `campaign_item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Campaign schedules — a named calendar owned by one department. A department
--    may own several (e.g. "Customer Service AR", "Retention").
CREATE TABLE IF NOT EXISTS `campaign_schedule` (
  `id`            INT          NOT NULL AUTO_INCREMENT,
  `name`          VARCHAR(120) NOT NULL,
  `department_id` INT          NOT NULL,
  `is_active`     BOOLEAN      NOT NULL DEFAULT TRUE,
  `created_by`    INT          NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_campaign_schedule_dept_name` (`department_id`, `name`),
  INDEX `idx_campaign_schedule_department` (`department_id`),
  CONSTRAINT `fk_campaign_schedule_department`
    FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Schedule membership — which campaigns are enabled in a schedule. The "build"
--    step. Absence of a row means "use the default" (enabled) at read time.
CREATE TABLE IF NOT EXISTS `campaign_schedule_item` (
  `id`               INT     NOT NULL AUTO_INCREMENT,
  `schedule_id`      INT     NOT NULL,
  `campaign_item_id` INT     NOT NULL,
  `is_enabled`       BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_campaign_schedule_item` (`schedule_id`, `campaign_item_id`),
  INDEX `idx_campaign_schedule_item_schedule` (`schedule_id`),
  CONSTRAINT `fk_campaign_schedule_item_schedule`
    FOREIGN KEY (`schedule_id`) REFERENCES `campaign_schedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_campaign_schedule_item_item`
    FOREIGN KEY (`campaign_item_id`) REFERENCES `campaign_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Per-day overrides — the manual tweaks vs the generated set. REMOVE hides a
--    generated occurrence; ADD inserts a manual one on that date.
CREATE TABLE IF NOT EXISTS `campaign_schedule_override` (
  `id`               INT      NOT NULL AUTO_INCREMENT,
  `schedule_id`      INT      NOT NULL,
  `occurrence_date`  DATE     NOT NULL,
  `campaign_item_id` INT      NOT NULL,
  `action`           ENUM('ADD','REMOVE') NOT NULL,
  `created_by`       INT      NULL,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_campaign_schedule_override` (`schedule_id`, `occurrence_date`, `campaign_item_id`),
  INDEX `idx_campaign_schedule_override_schedule_date` (`schedule_id`, `occurrence_date`),
  CONSTRAINT `fk_campaign_schedule_override_schedule`
    FOREIGN KEY (`schedule_id`) REFERENCES `campaign_schedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_campaign_schedule_override_item`
    FOREIGN KEY (`campaign_item_id`) REFERENCES `campaign_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: app_page catalog. section = 'scheduling', after Attendance Exceptions.
-- Library (categories/items) is edited in List Management (admin-only); the
-- calendar page itself is Admin/Manager EDIT, Director ALL, members OWN — mirrors
-- sched_calendar so the department-scoping in resolveScope applies unchanged.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `app_page`
  (`page_key`, `page_name`, `section`, `route_path`, `icon`, `sort_order`, `supports_self`, `self_route_path`, `self_label`, `self_icon`) VALUES
  ('sched_campaigns', 'Call Campaigns', 'scheduling', '/app/scheduling/campaigns', 'Megaphone', 30, FALSE, NULL, NULL, NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: role grants. Role ids 1=Admin, 2=QA, 3=CSR, 4=Trainer, 5=Manager, 6=Director.
--   sched_campaigns: Admin EDIT, Manager EDIT, Director ALL, CSR OWN
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `app_page_role_access` (`page_id`, `role_id`, `can_access`, `can_write`, `access_level`)
SELECT id, 1, TRUE,  TRUE,  'EDIT' FROM `app_page` WHERE `page_key`='sched_campaigns' UNION ALL
SELECT id, 5, TRUE,  TRUE,  'EDIT' FROM `app_page` WHERE `page_key`='sched_campaigns' UNION ALL
SELECT id, 6, TRUE,  FALSE, 'ALL'  FROM `app_page` WHERE `page_key`='sched_campaigns' UNION ALL
SELECT id, 3, TRUE,  FALSE, 'OWN'  FROM `app_page` WHERE `page_key`='sched_campaigns';
