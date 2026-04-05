-- ie_kpi: KPI registry — every metric displayed in the Insights Engine
CREATE TABLE `ie_kpi` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `kpi_code`        VARCHAR(50)   NOT NULL,
  `kpi_name`        VARCHAR(100)  NOT NULL,
  `description`     TEXT          NULL,
  `category`        VARCHAR(50)   NOT NULL,
  `formula_type`    ENUM('SQL','DERIVED','COMPOSITE') NOT NULL DEFAULT 'SQL',
  `formula`         TEXT          NOT NULL,
  `source_table`    VARCHAR(100)  NULL,
  `format_type`     ENUM('PERCENT','NUMBER','CURRENCY','DURATION','RATIO') NOT NULL,
  `decimal_places`  TINYINT       NOT NULL DEFAULT 1,
  `direction`       ENUM('UP_IS_GOOD','DOWN_IS_GOOD','NEUTRAL') NOT NULL,
  `unit_label`      VARCHAR(20)   NULL,
  `is_active`       BOOLEAN       NOT NULL DEFAULT TRUE,
  `sort_order`      INT           NOT NULL DEFAULT 0,
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by`      INT           NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_kpi_code` (`kpi_code`),
  INDEX `idx_kpi_category` (`category`, `is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ie_kpi_threshold: Goal/warning/critical thresholds per KPI, scoped by department
CREATE TABLE `ie_kpi_threshold` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `kpi_id`          INT           NOT NULL,
  `department_key`  INT           NULL,
  `goal_value`      DECIMAL(12,4) NULL,
  `warning_value`   DECIMAL(12,4) NULL,
  `critical_value`  DECIMAL(12,4) NULL,
  `effective_from`  DATE          NOT NULL,
  `effective_to`    DATE          NULL,
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_kpi_dept_effective` (`kpi_id`, `department_key`, `effective_from`),
  CONSTRAINT `fk_threshold_kpi` FOREIGN KEY (`kpi_id`) REFERENCES `ie_kpi`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_threshold_dept` FOREIGN KEY (`department_key`) REFERENCES `ie_dim_department`(`department_key`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ie_page: Report page registry for Insights Engine navigation
CREATE TABLE `ie_page` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `page_key`        VARCHAR(50)   NOT NULL,
  `page_name`       VARCHAR(100)  NOT NULL,
  `description`     TEXT          NULL,
  `category`        VARCHAR(50)   NOT NULL,
  `route_path`      VARCHAR(200)  NOT NULL,
  `icon`            VARCHAR(50)   NULL,
  `sort_order`      INT           NOT NULL DEFAULT 0,
  `is_active`       BOOLEAN       NOT NULL DEFAULT TRUE,
  `requires_section` VARCHAR(50)  NULL,
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_page_key` (`page_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ie_page_role_access: Default access level per role per page
CREATE TABLE `ie_page_role_access` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `page_id`         INT           NOT NULL,
  `role_id`         INT           NOT NULL,
  `can_access`      BOOLEAN       NOT NULL DEFAULT FALSE,
  `data_scope`      ENUM('ALL','DIVISION','DEPARTMENT','SELF') NOT NULL DEFAULT 'SELF',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_page_role` (`page_id`, `role_id`),
  CONSTRAINT `fk_page_role_page` FOREIGN KEY (`page_id`) REFERENCES `ie_page`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_page_role_role` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ie_page_user_override: Per-user access exceptions for specific pages
CREATE TABLE `ie_page_user_override` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `page_id`         INT           NOT NULL,
  `user_id`         INT           NOT NULL,
  `can_access`      BOOLEAN       NOT NULL,
  `data_scope`      ENUM('ALL','DIVISION','DEPARTMENT','SELF') NULL,
  `granted_by`      INT           NOT NULL,
  `granted_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`      DATETIME      NULL,
  `reason`          VARCHAR(255)  NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_page_user` (`page_id`, `user_id`),
  CONSTRAINT `fk_override_page` FOREIGN KEY (`page_id`) REFERENCES `ie_page`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_override_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_override_granter` FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
