-- ie_dim_date: Pre-populated calendar dimension covering 5 years
CREATE TABLE `ie_dim_date` (
  `date_key`        INT           NOT NULL,
  `full_date`       DATE          NOT NULL,
  `day_of_week`     TINYINT       NOT NULL,
  `day_name`        VARCHAR(10)   NOT NULL,
  `day_of_month`    TINYINT       NOT NULL,
  `day_of_year`     SMALLINT      NOT NULL,
  `week_of_year`    TINYINT       NOT NULL,
  `month_number`    TINYINT       NOT NULL,
  `month_name`      VARCHAR(10)   NOT NULL,
  `quarter`         TINYINT       NOT NULL,
  `year`            SMALLINT      NOT NULL,
  `is_weekend`      BOOLEAN       NOT NULL DEFAULT FALSE,
  `is_business_day` BOOLEAN       NOT NULL DEFAULT TRUE,
  `fiscal_year`     SMALLINT      NULL,
  `fiscal_quarter`  TINYINT       NULL,
  PRIMARY KEY (`date_key`),
  UNIQUE KEY `uq_dim_date_full` (`full_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ie_dim_department: SCD Type 2 department dimension synced from Qtip departments
CREATE TABLE `ie_dim_department` (
  `department_key`  INT           NOT NULL AUTO_INCREMENT,
  `department_id`   INT           NOT NULL,
  `department_name` VARCHAR(100)  NOT NULL,
  `parent_id`       INT           NULL,
  `hierarchy_level` TINYINT       NOT NULL DEFAULT 0,
  `hierarchy_path`  VARCHAR(500)  NULL,
  `is_active`       BOOLEAN       NOT NULL DEFAULT TRUE,
  `effective_from`  DATE          NOT NULL,
  `effective_to`    DATE          NULL,
  `is_current`      BOOLEAN       NOT NULL DEFAULT TRUE,
  PRIMARY KEY (`department_key`),
  INDEX `idx_dim_dept_current` (`is_current`, `is_active`),
  INDEX `idx_dim_dept_qtip_id` (`department_id`),
  CONSTRAINT `fk_dim_dept_parent` FOREIGN KEY (`parent_id`) REFERENCES `ie_dim_department`(`department_key`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ie_dim_employee: SCD Type 2 employee dimension synced from Qtip users
CREATE TABLE `ie_dim_employee` (
  `employee_key`    INT           NOT NULL AUTO_INCREMENT,
  `user_id`         INT           NOT NULL,
  `username`        VARCHAR(100)  NOT NULL,
  `email`           VARCHAR(255)  NULL,
  `role_name`       VARCHAR(50)   NOT NULL,
  `department_key`  INT           NULL,
  `manager_user_id` INT           NULL,
  `title`           VARCHAR(100)  NULL,
  `is_active`       BOOLEAN       NOT NULL DEFAULT TRUE,
  `effective_from`  DATE          NOT NULL,
  `effective_to`    DATE          NULL,
  `is_current`      BOOLEAN       NOT NULL DEFAULT TRUE,
  PRIMARY KEY (`employee_key`),
  INDEX `idx_dim_emp_current` (`is_current`, `is_active`),
  INDEX `idx_dim_emp_user_id` (`user_id`),
  INDEX `idx_dim_emp_dept` (`department_key`),
  CONSTRAINT `fk_dim_emp_dept` FOREIGN KEY (`department_key`) REFERENCES `ie_dim_department`(`department_key`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
